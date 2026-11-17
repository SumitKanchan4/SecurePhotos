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

export type ActivityKind = "colour" | "fade" | "faces" | "scratches" | "import" | "enhance" | "video" | "models";

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
  /** A8: improved photos kept automatically: keep the improved one, the original, or both? */
  choices: ActivityItem[];
  /** All of them (the tiles show the newest few). */
  choicesTotal: number;
  /** Items still to do (shown on the rail ring). */
  remaining: number;
  paused: boolean;
  /** One line for the header pill and the ring's tooltip, or null when idle. */
  headline: string | null;
}

export interface ActivityInput {
  restore?: RestoreJobsReport | null;
  enhance?: OptimizationProgress | null;
  video?: VideoOptimizationProgress | null;
  importing?: ImportProgressState | null;
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

export function buildActivity({ restore, enhance, video, importing }: ActivityInput): ActivityModel {
  const working: ActivityItem[] = [];
  const waiting: ActivityItem[] = [];
  let remaining = 0;

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
  if (enhance?.is_active) {
    const left = Math.max(enhance.total_count - enhance.completed_count, 0);
    const pausedNote = enhance.paused_reason === "on_battery" ? " · waiting: battery low" : enhance.paused_reason === "by_user" ? " · paused" : "";
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

  const choices: ActivityItem[] = (restore?.choices ?? []).map((c) => ({
    key: `choice-${c.photo_id}`,
    kind: (c.ai_kind?.split(",")[0] as ActivityKind) || "colour",
    title: improvedLabel(c.ai_kind),
    detail: "",
    progress: null,
    photoId: c.photo_id,
  }));
  const choicesTotal = Math.max(restore?.choices_total ?? 0, choices.length);

  const paused = Boolean(restore?.paused);
  const first = working[0] ?? waiting[0];
  const headline = first
    ? paused
      ? `Paused · ${plural(remaining, "item")} left`
      : remaining > 1
      ? `${first.title} · ${plural(remaining, "item")} left`
      : first.title
    : ready.length
    ? `${plural(ready.length, "photo")} ready to look at`
    : choicesTotal
    ? `${plural(choicesTotal, "improved photo")}: choose what to keep`
    : null;

  return { working, waiting, ready, attention, choices, choicesTotal, remaining, paused, headline };
}

/** "Colour added · faces sharpened" from an improved copy's kinds. */
export function improvedLabel(aiKind: string | null | undefined): string {
  const kinds = (aiKind ?? "").split(",").filter((k) => IMPROVE_LABELS[k]);
  if (!kinds.length) return "Improved";
  const words = kinds.map((k) => IMPROVE_LABELS[k].done.toLowerCase());
  return words.join(" · ").replace(/^./, (c) => c.toUpperCase());
}
