/**
 * Activity (H10 / A4): turns the engine's background-work reports into one list of plain
 * items for the Activity page, the rail's status ring and the Photos header pill.
 * Pure functions, unit-tested. Vault photos are never named (the page blurs them).
 */
import type { ImportProgressState, OptimizationProgress, VideoOptimizationProgress } from "../../types";
import { IMPROVE_LABELS, type RestoreJob } from "../viewer/useOldPhoto";

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
}

export interface ActivityModel {
  working: ActivityItem[];
  waiting: ActivityItem[];
  ready: ActivityItem[];
  finished: ActivityItem[];
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
  const name = job.private ? "Private photo" : job.filename ?? "Photo";
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
  if (job.status === "discarded") return "Not kept";
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
      title: video.total_count > 1 ? "Preparing videos" : "Preparing a video",
      detail: video.total_count > 1 ? `${(video.completed_count + 1).toLocaleString()} of ${video.total_count.toLocaleString()} · for smooth playback` : "For smooth playback",
      progress: video.item_progress ?? null,
    });
    remaining += left;
  }
  if (enhance?.is_active) {
    const left = Math.max(enhance.total_count - enhance.completed_count, 0);
    const pausedNote = enhance.paused_reason === "on_battery" ? " · waiting for the charger" : enhance.paused_reason === "by_user" ? " · paused" : "";
    working.push({
      key: "enhance",
      kind: "enhance",
      title: "Enhancing photos",
      detail: `${Math.min(enhance.completed_count + 1, enhance.total_count).toLocaleString()} of ${enhance.total_count.toLocaleString()}${pausedNote}`,
      progress: enhance.item_progress ?? null,
    });
    remaining += left;
  }

  const ready = (restore?.review ?? []).map((job) => ({
    ...jobItem(job),
    title: `${(IMPROVE_LABELS[job.kind] ?? IMPROVE_LABELS.colour).done} · ready to look at`,
    progress: null,
  }));
  const finished = (restore?.finished_today ?? [])
    .slice()
    .reverse()
    // A kept result opens the improved photo; anything else opens the photo it was for.
    .map((job) => ({ ...jobItem(job), photoId: job.result_photo_id ?? job.photo_id, cancel: undefined, progress: null, outcome: finishedOutcome(job) }));

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
    : null;

  return { working, waiting, ready, finished, remaining, paused, headline };
}
