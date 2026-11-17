/**
 * Old-photo improvements for the photo open in the viewer (H10 / A3).
 *
 * Owner rules (A1 board, 2026-11-16): nothing changes in the viewer until the user picks
 * an improvement from the "…" menu; the result shows first with a before/after slider; only
 * then does the app ask Keep both / Replace / Discard (unless "Remember my choice" was ticked).
 * The original is never deleted on the spot: Replace sends it to Trash for 30 days.
 *
 * Models (A2c): the installer downloads them. If one is still missing, picking an action
 * that needs it opens a popup that downloads it (and then starts the action). "Not now"
 * leaves only those actions locked; everything else keeps working.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getApiUrl } from "../../services/api";
import type { PhotoItem } from "../../types";

export type ImproveKind = "colour" | "fade" | "faces";

/** A face in a result waiting for a decision: its box in 0-1 of the picture (x, y, w, h). */
export interface ResultFace {
  box: [number, number, number, number];
  /** False when the identity check left it as it was (it no longer looked like the same person). */
  sharpened: boolean;
}
export type KeepChoice = "keep_both" | "replace" | "discard";

export interface RestoreJob {
  id: number;
  photo_id: number;
  kind: ImproveKind | "scratches";
  status: "queued" | "working" | "review" | "done" | "discarded" | "failed" | "cancelled";
  progress: number;
  error: string | null;
  result_photo_id: number | null;
  faces?: ResultFace[];
  /** Faces that could be sharpened too once the face model is downloaded (Fix faded colours). */
  faces_waiting?: number;
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

/** The popup asking to download the models an action needs. */
export interface ModelPrompt {
  /** The feature whose model is missing (names the popup). */
  kind: ImproveKind;
  /** What starts once it's downloaded (e.g. "Also sharpen faces" runs Fix faded colours again). */
  action: ImproveKind;
  style: "natural" | "vivid";
  bytes: number;
  phase: "ask" | "downloading" | "failed";
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
  const [options, setOptions] = useState<{ colour: boolean; fade: boolean; faces?: boolean } | null>(null);
  const [facesOff, setFacesOff] = useState<number[]>([]);
  const [job, setJob] = useState<RestoreJob | null>(null);
  const [versions, setVersions] = useState<VersionMember[]>([]);
  const [style, setStyle] = useState<"natural" | "vivid">("natural");
  const [intensity, setIntensity] = useState(1);
  const [download, setDownload] = useState<ModelDownload | null>(null);
  const [downloads, setDownloads] = useState<Partial<Record<ImproveKind, number>>>({});
  const [modelPrompt, setModelPrompt] = useState<ModelPrompt | null>(null);
  const downloadTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [resultVersion, setResultVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isEligible = Boolean(photo && !photo.mime_type?.startsWith("video/") && !photo.is_document);

  // Which actions fit this photo, and its Original / Improved family.
  useEffect(() => {
    setOptions(null);
    setDownloads({});
    setFacesOff([]);
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
        setDownloads(data.downloads ?? {});
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
          if (found.status === "review") {
            setFacesOff([]);
            setResultVersion((v) => v + 1);
          }
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
    async (kind: ImproveKind, nextStyle: "natural" | "vivid" = "natural", modelsJustArrived = false) => {
      if (!photoId) return;
      const bytes = downloads[kind];
      if (bytes && !modelsJustArrived) {
        setModelPrompt({ kind, action: kind, style: nextStyle, bytes, phase: "ask" });
        return;
      }
      setBusy(true);
      try {
        // Trying the other style replaces the result waiting for a decision.
        if (job?.status === "review") await apiFetch(`/api/restore/jobs/${job.id}/keep`, jsonPost({ choice: "discard" }));
        const res = await apiFetch("/api/restore/jobs", jsonPost({ photo_ids: [photoId], kind, params: kind === "colour" ? { style: nextStyle } : {} }));
        if (res.status === 409) {
          // A model went missing since the photo was opened: ask for it.
          setJob(null);
          setModelPrompt({ kind, action: kind, style: nextStyle, bytes: 0, phase: "ask" });
          return;
        }
        if (!res.ok) throw new Error(await res.text());
        const { job_ids } = await res.json();
        setStyle(nextStyle);
        setIntensity(1);
        setJob({ id: job_ids[0], photo_id: photoId, kind, status: "queued", progress: 0, error: null, result_photo_id: null });
      } finally {
        setBusy(false);
      }
    },
    [photoId, job, downloads],
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
        const res = await apiFetch(`/api/restore/jobs/${job.id}/keep`, jsonPost({ choice, remember, intensity, faces_off: facesOff }));
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "Could not save the result.");
        const { photo_id } = await res.json();
        setJob(null);
        return photo_id ?? null;
      } finally {
        setBusy(false);
      }
    },
    [job, intensity, facesOff],
  );

  const stopDownloadTimer = () => {
    if (downloadTimer.current) clearInterval(downloadTimer.current);
    downloadTimer.current = null;
  };
  useEffect(() => stopDownloadTimer, []);

  /** Asks the model popup for ``kind``'s model; ``action`` runs once it's here (default: the same).
   *  "Also sharpen faces" asks for the face model and then runs Fix faded colours again. */
  const askForModels = useCallback((kind: ImproveKind, action: ImproveKind = kind) => {
    setModelPrompt({ kind, action, style: style, bytes: downloads[kind] ?? 0, phase: "ask" });
  }, [downloads, style]);

  /** The popup's Download: fetches only what the action needs, then starts it. */
  const downloadModels = useCallback(async () => {
    const prompt = modelPrompt;
    if (!prompt) return;
    setModelPrompt({ ...prompt, phase: "downloading" });
    setDownload({ model: "", done: 0, total: prompt.bytes || 1 });
    const res = await apiFetch("/api/restore/models/download", jsonPost({ kind: prompt.kind })).catch(() => null);
    if (!res?.ok) {
      setDownload(null);
      setModelPrompt({ ...prompt, phase: "failed" });
      return;
    }
    stopDownloadTimer();
    downloadTimer.current = setInterval(async () => {
      const r = await apiFetch("/api/restore/models").catch(() => null);
      if (!r?.ok) return;
      const data = await r.json();
      setDownload(data.download ?? null);
      if (data.download) return;
      stopDownloadTimer();
      if (data.result === "done") {
        setDownloads((d) => ({ ...d, [prompt.kind]: undefined }));
        // Still in the popup: go straight on with what the user asked for.
        const stillWaiting = promptRef.current?.phase === "downloading";
        setModelPrompt(null);
        if (stillWaiting) void startRef.current(prompt.action, prompt.style, true);
      } else {
        setModelPrompt((current) => (current ? { ...current, phase: data.result === "cancelled" ? "ask" : "failed" } : current));
      }
    }, POLL_MS);
  }, [modelPrompt]);

  // The download's last tick uses the latest start() and popup (no stale closures).
  const startRef = useRef(start);
  startRef.current = start;
  const promptRef = useRef(modelPrompt);
  promptRef.current = modelPrompt;

  const cancelDownload = useCallback(async () => {
    await apiFetch("/api/restore/models/cancel-download", { method: "POST" }).catch(() => undefined);
  }, []);

  /** "Not now" (or "Keep browsing" while it downloads): the popup closes; a running download
   *  goes on in Activity, and only the actions that need it stay locked. */
  const closeModelPrompt = useCallback(() => setModelPrompt(null), []);

  const restoreOriginal = useCallback(async () => {
    if (!photoId) return null;
    const res = await apiFetch(`/api/restore/photos/${photoId}/restore-original`, { method: "POST" });
    if (!res.ok) return null;
    return (await res.json()).original_id as number;
  }, [photoId]);

  /** The per-face switch: a face switched off is kept as it was (the preview follows). */
  const toggleFace = useCallback((index: number) => {
    setFacesOff((off) => (off.includes(index) ? off.filter((i) => i !== index) : [...off, index].sort((a, b) => a - b)));
  }, []);

  const reviewUrl =
    job?.status === "review"
      ? getApiUrl(`/api/restore/jobs/${job.id}/result?v=${resultVersion}${facesOff.length ? `&faces_off=${facesOff.join(",")}` : ""}`)
      : null;
  const label = job ? IMPROVE_LABELS[job.kind] : null;
  const statusText =
    job && label && (job.status === "queued" || job.status === "working")
      ? job.status === "queued"
        ? `${label.working} · waiting`
        : `${label.working} · ${job.progress}%`
      : null;
  const needsModels = job?.status === "failed" && job.error === "models_missing";
  const locked = (Object.keys(downloads) as ImproveKind[]).filter((k) => downloads[k]);

  return {
    options,
    job,
    versions,
    style,
    intensity,
    setIntensity,
    download,
    downloads,
    locked,
    facesOff,
    toggleFace,
    modelPrompt,
    busy,
    reviewUrl,
    statusText,
    needsModels,
    panelOpen: Boolean(job && job.status !== "done" && job.status !== "discarded" && job.status !== "cancelled"),
    start,
    cancel,
    keep,
    downloadModels,
    askForModels,
    cancelDownload,
    closeModelPrompt,
    restoreOriginal,
    dismiss: () => setJob(null),
  };
}

export type OldPhotoState = ReturnType<typeof useOldPhoto>;

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
