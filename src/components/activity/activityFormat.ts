/**
 * Activity (H10 / A4): turns the engine's background-work reports into one list of plain
 * items for the Activity page, the rail's status ring and the Photos header pill.
 * Pure functions, unit-tested. Vault photos are never named (the page blurs them).
 * A8: the page, the ring and the pill count the same things (every photo or video still to do);
 * every card shows the photo being worked on; names made by devices are never shown.
 */
import type { ImportProgressState, OptimizationProgress, VideoOptimizationProgress } from "../../types";
import { IMPROVE_LABELS, type RestoreJob } from "../viewer/useOldPhoto";
import { humanName } from "../../utils/displayName";

export interface RestoreJobView extends RestoreJob {
  private: boolean;
  filename: string | null;
  finished_at?: string | null;
}

export interface RestoreJobsReport {
  working: RestoreJobView[];
  waiting: RestoreJobView[];
  review: RestoreJobView[];
  finished_today: RestoreJobView[];
  paused: boolean;
  paused_reason: string | null;
  download: { model: string; done: number; total: number } | null;
  /** A8: improved copies kept automatically, waiting for "improved, original or both". */
  choices?: { photo_id: number; original_id: number; ai_kind: string | null }[];
  choices_total?: number;
}

export type ActivityKind = "colour" | "fade" | "faces" | "scratches" | "import" | "enhance" | "video" | "models" | "prepare";

export interface ActivityItem {
  key: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  /** 0-100, or null when there is no meaningful percentage. */
  progress: number | null;
  photoId?: number;
  jobId?: number;
  private?: boolean;
  /** Restore jobs can be cancelled one by one; imports have their own Stop. */
  cancel?: "job" | "import";
  /** Finished items: what happened, in a few words. */
  outcome?: string;
  /** Waiting groups ("12 photos to enhance"): how many items the tile stands for. */
  count?: number;
}

export interface ActivityModel {
  working: ActivityItem[];
  waiting: ActivityItem[];
  ready: ActivityItem[];
  /** Finished today but needing the user (a download, or a photo that couldn't be improved). */
  attention: ActivityItem[];
  /** A8: improved photos kept automatically, waiting for "what to keep" (the Photos pill;
   *  the choice itself is made on the What to keep page, not in Activity). */
  choicesTotal: number;
  /** Items still to do (shown on the rail ring). */
  remaining: number;
  paused: boolean;
  /** One line for the header pill and the ring's tooltip, or null when idle. */
  headline: string | null;
}

/** The after-import process (P1): reading text and finding faces, newest photos first. */
export interface PreparingProgress {
  active: boolean;
  step: "text" | "faces" | "rules" | "duplicates" | null;
  photo_id: number | null;
  paused_reason: string | null;
  text_waiting: number;
  faces_waiting: number;
  rules_waiting?: number;
  dups_waiting?: number;
  /** P4: photos with any step left, 8K included (one Activity card for all of it). */
  preparing_total?: number;
  /** P4: what the last import brought, once its photos are ready. */
  import_summary?: ImportSummary | null;
}

export interface ImportSummary {
  batch: number;
  added: number;
  people: number;
  documents: number;
  old_photos: number;
  duplicates: number;
}

/** "124 added · 18 people · 3 documents · 5 old photos improved" (only what's there). */
export function importSummaryLine(s: ImportSummary): string {
  const parts = [`${s.added.toLocaleString()} added`];
  if (s.people) parts.push(plural(s.people, "person").replace(/persons$/, "people"));
  if (s.documents) parts.push(plural(s.documents, "document"));
  if (s.old_photos) parts.push(`${plural(s.old_photos, "old photo")} improved`);
  if (s.duplicates) parts.push(`${plural(s.duplicates, "possible duplicate")}`);
  return parts.join(" · ");
}

const STEP_LABELS: Record<string, string> = {
  text: "Reading text",
  faces: "Finding faces",
  rules: "Checking old prints",
  duplicates: "Looking for duplicates",
};

export interface ActivityInput {
  restore?: RestoreJobsReport | null;
  enhance?: OptimizationProgress | null;
  video?: VideoOptimizationProgress | null;
  importing?: ImportProgressState | null;
  preparing?: PreparingProgress | null;
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function jobItem(job: RestoreJobView): ActivityItem {
  const label = IMPROVE_LABELS[job.kind] ?? IMPROVE_LABELS.colour;
  const name = job.private ? "Private photo" : humanName(job.filename) ?? "";
  return {
    key: `job-${job.id}`,
    kind: job.kind,
    title: label.working,
    detail: name,
    progress: job.status === "working" ? job.progress : null,
    photoId: job.photo_id,
    jobId: job.id,
    private: job.private,
    cancel: "job",
  };
}

function finishedOutcome(job: RestoreJobView): string {
  const label = IMPROVE_LABELS[job.kind] ?? IMPROVE_LABELS.colour;
  if (job.status === "done") return label.done;
  if (job.status === "discarded") return job.error === "nothing_to_fix" ? "Nothing to fix" : "Not kept";
  if (job.status === "cancelled") return "Cancelled";
  return job.error === "models_missing" ? "Needs a download" : "Couldn't be improved";
}

// T3: "other_computer" while this computer only views; improving waits for one of the others.
const PAUSED_NOTE: Record<string, string> = {
  on_battery: " · waiting: battery low",
  by_user: " · paused",
  other_computer: " · waiting for one of your other computers",
};

export function buildActivity({ restore, enhance, video, importing, preparing }: ActivityInput): ActivityModel {
  const working: ActivityItem[] = [];
  const waiting: ActivityItem[] = [];
  let remaining = 0;

  // P4: one card for everything a photo goes through after import (8K included). Older engines
  // report only text and faces (a photo waits for faces only once its text is read: no overlap).
  const quickLeft = preparing ? preparing.text_waiting + preparing.faces_waiting + (preparing.rules_waiting ?? 0) + (preparing.dups_waiting ?? 0) : 0;
  const preparingLeft = preparing ? Math.max(preparing.preparing_total ?? 0, quickLeft) : 0;
  const foldsEnhance = Boolean(preparing && preparing.preparing_total !== undefined && preparingLeft > 0);
  if (preparing && preparingLeft > 0) {
    const onEnhance = !preparing.step && Boolean(enhance?.is_active);
    const doing = preparing.step
      ? STEP_LABELS[preparing.step] ?? "Getting ready"
      : onEnhance
      ? "Enhancing to 8K"
      : preparing.text_waiting
      ? "Reading text"
      : preparing.faces_waiting
      ? "Finding faces"
      : "Enhancing to 8K";
    const paused = PAUSED_NOTE[preparing.paused_reason ?? ""] ?? (onEnhance ? PAUSED_NOTE[enhance?.paused_reason ?? ""] ?? "" : "");
    working.push({
      key: "prepare",
      kind: "prepare",
      title: `Getting ${plural(preparingLeft, "photo")} ready`,
      detail: `${doing}${paused}`,
      progress: onEnhance ? enhance?.item_progress ?? null : null,
      photoId: (onEnhance ? enhance?.active_photo_id : preparing.photo_id) ?? undefined,
    });
    remaining += preparingLeft;
  }

  if (importing?.is_active) {
    const left = Math.max(importing.total_count - importing.completed_count, 0);
    working.push({
      key: "import",
      kind: "import",
      title: importing.album_name ? `Adding to "${importing.album_name}"` : "Importing",
      detail: `${importing.completed_count.toLocaleString()} of ${plural(importing.total_count, "item")}`,
      progress: importing.total_count ? Math.round((importing.completed_count / importing.total_count) * 100) : null,
      cancel: "import",
    });
    remaining += left;
  }
  if (restore?.download) {
    const { done, total } = restore.download;
    working.push({
      key: "models",
      kind: "models",
      title: "Getting the old-photo models",
      detail: `${(done / 1e9).toFixed(1)} of ${(total / 1e9).toFixed(1)} GB · once only`,
      progress: total ? Math.round((done / total) * 100) : null,
    });
  }
  for (const job of restore?.working ?? []) working.push(jobItem(job));
  for (const job of restore?.waiting ?? []) waiting.push(jobItem(job));
  remaining += (restore?.working.length ?? 0) + (restore?.waiting.length ?? 0);

  if (video?.is_active) {
    const left = Math.max(video.total_count - video.completed_count, 0);
    working.push({
      key: "video",
      kind: "video",
      title: "Preparing a video",
      detail: "For smooth playback",
      progress: video.item_progress ?? null,
      photoId: video.active_video_id ?? undefined,
    });
    remaining += left;
    if (left > 1) {
      waiting.push({ key: "video-waiting", kind: "video", title: "Videos to prepare", detail: plural(left - 1, "video"), progress: null, count: left - 1 });
    }
  }
  // Nothing to enhance (an empty library, or all done): no item, even while the loop waits.
  if (enhance?.is_active && enhance.total_count > 0 && !foldsEnhance) {
    const left = Math.max(enhance.total_count - enhance.completed_count, 0);
    const pausedNote = (enhance.paused_reason && PAUSED_NOTE[enhance.paused_reason]) || "";
    working.push({
      key: "enhance",
      kind: "enhance",
      title: "Enhancing to 8K",
      detail: `${Math.min(enhance.completed_count + 1, enhance.total_count).toLocaleString()} of ${enhance.total_count.toLocaleString()}${pausedNote}`,
      progress: enhance.item_progress ?? null,
      photoId: enhance.active_photo_id ?? undefined,
    });
    remaining += left;
    if (left > 1) {
      waiting.push({ key: "enhance-waiting", kind: "enhance", title: "Photos to enhance", detail: plural(left - 1, "photo"), progress: null, count: left - 1 });
    }
  }

  const ready = (restore?.review ?? []).map((job) => ({
    ...jobItem(job),
    title: `${(IMPROVE_LABELS[job.kind] ?? IMPROVE_LABELS.colour).done} · ready to look at`,
    progress: null,
  }));
  // Only what still needs the user: a download, or a photo that couldn't be improved.
  // Kept results are in the library; "nothing to fix", cancelled and not-kept need nothing.
  const attention = (restore?.finished_today ?? [])
    .filter((job) => job.status === "failed")
    .slice()
    .reverse()
    .map((job) => ({ ...jobItem(job), cancel: undefined, progress: null, outcome: finishedOutcome(job) }));

  const choicesTotal = Math.max(restore?.choices_total ?? 0, restore?.choices?.length ?? 0);

  const paused = Boolean(restore?.paused);
  const first = working[0] ?? waiting[0];
  // T3: on a computer that only views, the work waits for another one; say so, not "Enhancing".
  const elsewhere = first?.key === "enhance" && enhance?.paused_reason === "other_computer";
  const headline = first
    ? paused
      ? `Paused · ${plural(remaining, "item")} left`
      : elsewhere
      ? `Waiting for another computer · ${plural(remaining, "item")} left`
      : remaining > 1
      ? `${first.title} · ${plural(remaining, "item")} left`
      : first.title
    : ready.length
    ? `${plural(ready.length, "photo")} ready to look at`
    : null;

  return { working, waiting, ready, attention, choicesTotal, remaining, paused, headline };
}

/** "Colour added · faces sharpened" from an improved copy's kinds. */
export function improvedLabel(aiKind: string | null | undefined): string {
  const kinds = (aiKind ?? "").split(",").filter((k) => IMPROVE_LABELS[k]);
  if (!kinds.length) return "Improved";
  const words = kinds.map((k) => IMPROVE_LABELS[k].done.toLowerCase());
  return words.join(" · ").replace(/^./, (c) => c.toUpperCase());
}
