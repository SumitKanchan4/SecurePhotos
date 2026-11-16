/**
 * Old-photo improvements for the photo open in the viewer (H10 / A3).
 *
 * Owner rules (A1 board, 2026-11-16): nothing changes in the viewer until the user picks
 * an improvement from the "…" menu; the result shows first with a before/after slider; only
 * then does the app ask Keep both / Replace / Discard (unless "Remember my choice" was ticked).
 * The original is never deleted on the spot: Replace sends it to Trash for 30 days.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getApiUrl } from "../../services/api";
import type { PhotoItem } from "../../types";

export type ImproveKind = "colour" | "fade";
export type KeepChoice = "keep_both" | "replace" | "discard";

export interface RestoreJob {
  id: number;
  photo_id: number;
  kind: ImproveKind | "faces" | "scratches";
  status: "queued" | "working" | "review" | "done" | "discarded" | "failed" | "cancelled";
  progress: number;
  error: string | null;
  result_photo_id: number | null;
}

export interface VersionMember {
  id: number;
  is_original: boolean;
  ai_kind: string | null;
  trashed: boolean;
}

export interface ModelDownload {
  model: string;
  done: number;
  total: number;
}

/** Plain words for each improvement (no technical terms; A1 board). */
export const IMPROVE_LABELS: Record<string, { action: string; working: string; done: string }> = {
  colour: { action: "Add colour", working: "Adding colour", done: "Colour added" },
  fade: { action: "Fix faded colours", working: "Fixing colours", done: "Colours fixed" },
  faces: { action: "Sharpen faces", working: "Sharpening faces", done: "Faces sharpened" },
  scratches: { action: "Remove scratches and spots", working: "Removing scratches", done: "Scratches removed" },
};

const POLL_MS = 1000;

export function useOldPhoto(photo: PhotoItem | undefined, isOpen: boolean) {
  const photoId = photo?.id;
  const [options, setOptions] = useState<{ colour: boolean; fade: boolean } | null>(null);
  const [job, setJob] = useState<RestoreJob | null>(null);
  const [versions, setVersions] = useState<VersionMember[]>([]);
  const [style, setStyle] = useState<"natural" | "vivid">("natural");
  const [intensity, setIntensity] = useState(1);
  const [download, setDownload] = useState<ModelDownload | null>(null);
  const [resultVersion, setResultVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isEligible = Boolean(photo && !photo.mime_type?.startsWith("video/") && !photo.is_document);

  // Which actions fit this photo, and its Original / Improved family.
  useEffect(() => {
    setOptions(null);
    setJob(null);
    setVersions([]);
    setIntensity(1);
    setStyle("natural");
    if (!isOpen || !photoId || !isEligible) return;
    let cancelled = false;
    // One request per photo: which actions fit, its Original / Improved family, and a job
    // started earlier for it (e.g. before the viewer was closed), which picks up again.
    apiFetch(`/api/restore/photos/${photoId}/state`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setOptions(data.options ?? null);
        setVersions(data.members ?? []);
        if (data.job) setJob(data.job);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [photoId, isOpen, isEligible]);

  // Follow the job while it waits or works.
  const active = job && (job.status === "queued" || job.status === "working");
  useEffect(() => {
    if (!active || !job) return;
    const jobId = job.id;
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch("/api/restore/jobs");
        if (!res.ok) return;
        const data = await res.json();
        const all: RestoreJob[] = [...data.working, ...data.waiting, ...data.review, ...data.finished_today];
        const found = all.find((j) => j.id === jobId);
        setDownload(data.download ?? null);
        if (found) {
          setJob(found);
          if (found.status === "review") setResultVersion((v) => v + 1);
        }
      } catch {
        /* The engine is busy; try again next tick. */
      }
    }, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [active, job?.id]);

  const start = useCallback(
    async (kind: ImproveKind, nextStyle: "natural" | "vivid" = "natural") => {
      if (!photoId) return;
      setBusy(true);
      try {
        // Trying the other style replaces the result waiting for a decision.
        if (job?.status === "review") await apiFetch(`/api/restore/jobs/${job.id}/keep`, jsonPost({ choice: "discard" }));
        const res = await apiFetch("/api/restore/jobs", jsonPost({ photo_ids: [photoId], kind, params: kind === "colour" ? { style: nextStyle } : {} }));
        if (!res.ok) throw new Error(await res.text());
        const { job_ids } = await res.json();
        setStyle(nextStyle);
        setIntensity(1);
        setJob({ id: job_ids[0], photo_id: photoId, kind, status: "queued", progress: 0, error: null, result_photo_id: null });
      } finally {
        setBusy(false);
      }
    },
    [photoId, job],
  );

  const cancel = useCallback(async () => {
    if (!job) return;
    await apiFetch(`/api/restore/jobs/${job.id}/cancel`, { method: "POST" }).catch(() => undefined);
    setJob(null);
  }, [job]);

  /** Returns the new photo's id (null for discard). Throws with the engine's message on failure. */
  const keep = useCallback(
    async (choice: KeepChoice, remember = false): Promise<number | null> => {
      if (!job) return null;
      setBusy(true);
      try {
        const res = await apiFetch(`/api/restore/jobs/${job.id}/keep`, jsonPost({ choice, remember, intensity }));
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "Could not save the result.");
        const { photo_id } = await res.json();
        setJob(null);
        return photo_id ?? null;
      } finally {
        setBusy(false);
      }
    },
    [job, intensity],
  );

  const downloadModels = useCallback(async () => {
    await apiFetch("/api/restore/models/download", { method: "POST" });
    setDownload({ model: "", done: 0, total: 1 });
    const timer = setInterval(async () => {
      const res = await apiFetch("/api/restore/models").catch(() => null);
      if (!res?.ok) return;
      const data = await res.json();
      setDownload(data.download ?? null);
      if (!data.download) {
        clearInterval(timer);
        const ready = (data.models ?? []).every((m: { ready: boolean }) => m.ready);
        if (ready && job && (job.kind === "colour" || job.kind === "fade")) await start(job.kind, style);
        else setDownload(null);
      }
    }, POLL_MS);
  }, [job, start, style]);

  const restoreOriginal = useCallback(async () => {
    if (!photoId) return null;
    const res = await apiFetch(`/api/restore/photos/${photoId}/restore-original`, { method: "POST" });
    if (!res.ok) return null;
    return (await res.json()).original_id as number;
  }, [photoId]);

  const reviewUrl =
    job?.status === "review" ? getApiUrl(`/api/restore/jobs/${job.id}/result?v=${resultVersion}`) : null;
  const label = job ? IMPROVE_LABELS[job.kind] : null;
  const statusText =
    job && label && (job.status === "queued" || job.status === "working")
      ? job.status === "queued"
        ? `${label.working} · waiting`
        : `${label.working} · ${job.progress}%`
      : null;
  const needsModels = job?.status === "failed" && job.error === "models_missing";

  return {
    options,
    job,
    versions,
    style,
    intensity,
    setIntensity,
    download,
    busy,
    reviewUrl,
    statusText,
    needsModels,
    panelOpen: Boolean(job && job.status !== "done" && job.status !== "discarded" && job.status !== "cancelled"),
    start,
    cancel,
    keep,
    downloadModels,
    restoreOriginal,
    dismiss: () => setJob(null),
  };
}

export type OldPhotoState = ReturnType<typeof useOldPhoto>;

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
