/**
 * Dashboard, Duplicates and Big videos helpers (redesign R7c). Pure functions, unit-tested.
 */
import type { DashboardOverview, DuplicateGroupItem } from "../../types";
import { formatSize } from "../import/importFormat";

export { formatSize };

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export interface StorageSegment {
  key: "media" | "app" | "other";
  label: string;
  bytes: number;
  percent: number;
}

/** Drive bar: photos and videos, app data, other files (free is what's left). */
export function storageSegments(overview: DashboardOverview): StorageSegment[] {
  const drive = overview.drive_storage;
  const total = drive?.total_bytes || 0;
  if (total <= 0) return [];
  const media = overview.app_storage?.media_bytes || 0;
  const app = Math.max(0, (overview.app_storage?.total_bytes || 0) - media);
  const other = Math.max(0, total - drive.free_bytes - media - app);
  const pct = (b: number) => Math.min(100, Math.max(0, (b / total) * 100));
  return [
    { key: "media", label: "Photos and videos", bytes: media, percent: pct(media) },
    { key: "app", label: "App data", bytes: app, percent: pct(app) },
    { key: "other", label: "Other files", bytes: other, percent: pct(other) },
  ];
}

/** Bytes freed if, in each group, every photo not chosen to keep goes to Trash. */
export function reclaimableBytes(groups: DuplicateGroupItem[], keep: Record<string, number[]>): number {
  return groups.reduce((total, group) => {
    const kept = keep[group.group_id] ?? [group.suggested_best_photo_id];
    return total + group.photos.filter((p) => !kept.includes(p.id)).reduce((sum, p) => sum + (p.file_size || 0), 0);
  }, 0);
}

/** "Remove 2 copies", or "Keep all" when nothing would be removed. */
export function resolveLabel(group: DuplicateGroupItem, kept: number[]): string {
  const removing = group.photos.length - kept.length;
  return removing <= 0 ? "Keep all" : `Remove ${plural(removing, "copy", "copies")}`;
}

export function groupTitle(group: DuplicateGroupItem): string {
  return group.match_type === "exact" ? "Exact copies" : "Similar shots";
}

/** "4:32" from seconds; empty when unknown. */
export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

export interface OldOriginalsCleanup {
  removed?: number;
  freed_bytes?: number;
  moved_to_trash?: number;
  kept?: number;
  acknowledged?: boolean;
  status?: string;
}

/** One-time note about the cleanup of video originals older versions left hidden (R7c2); null when there is nothing to say. */
export function oldOriginalsNote(r: OldOriginalsCleanup | null): string | null {
  if (!r || r.acknowledged || r.status) return null;
  const removed = r.removed ?? 0;
  const moved = r.moved_to_trash ?? 0;
  const parts: string[] = [];
  if (removed > 0) {
    parts.push(
      `Removed ${plural(removed, "full-size video copy", "full-size video copies")} an earlier version had kept hidden after making videos smaller. ${formatSize(r.freed_bytes ?? 0)} freed.`,
    );
  }
  if (moved > 0) {
    parts.push(`The originals of ${plural(moved, "enhanced video")} are now in Trash, where you can restore them for 30 days.`);
  }
  return parts.length ? parts.join(" ") : null;
}
