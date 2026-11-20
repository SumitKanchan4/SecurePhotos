/**
 * Dashboard, Duplicates and Big videos helpers (redesign R7c). Pure functions, unit-tested.
 */
import type { AppStorageStats, DashboardOverview, DuplicateGroupItem, MediaCounts, StorageCategoryKey } from "../../types";
import type { NavTab } from "../../store/useAppStore";
import { formatSize } from "../import/importFormat";

export { formatSize };

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export interface StorageSegment {
  key: "library" | "other";
  label: string;
  bytes: number;
  percent: number;
}

/** Drive bar: what SecurePhotos uses and other files on the drive (free is what's left). */
export function storageSegments(overview: DashboardOverview): StorageSegment[] {
  const drive = overview.drive_storage;
  const total = drive?.total_bytes || 0;
  if (total <= 0) return [];
  const library = overview.app_storage?.total_bytes || 0;
  const other = Math.max(0, total - drive.free_bytes - library);
  const pct = (b: number) => Math.min(100, Math.max(0, (b / total) * 100));
  return [
    // A small library on a big drive would be invisible; keep it at least a sliver wide.
    { key: "library", label: "SecurePhotos", bytes: library, percent: library > 0 ? Math.max(pct(library), 0.8) : 0 },
    { key: "other", label: "Other files", bytes: other, percent: pct(other) },
  ];
}

const CATEGORY_TEXT: Record<StorageCategoryKey, { label: string; note?: string }> = {
  photos: { label: "Photos" },
  videos: { label: "Videos" },
  documents: { label: "Documents" },
  vault: { label: "Private Vault", note: "encrypted" },
  collages: { label: "Collages" },
  music: { label: "Story music" },
  trash: { label: "Trash", note: "deleted for good after 30 days" },
  thumbnails: { label: "Thumbnails and previews", note: "keep scrolling fast" },
  app: { label: "App data", note: "database and AI models" },
};

export interface StorageRow {
  key: StorageCategoryKey;
  label: string;
  note?: string;
  bytes: number;
  /** Share of everything SecurePhotos uses, 0–100. */
  percent: number;
}

/** "What SecurePhotos uses": one row per kind with something in it, biggest first. */
export function storageRows(stats?: AppStorageStats | null): StorageRow[] {
  const categories = (stats?.categories ?? []).filter((c) => c.bytes > 0 && c.key in CATEGORY_TEXT);
  const total = categories.reduce((sum, c) => sum + c.bytes, 0);
  if (total <= 0) return [];
  return categories
    .map((c) => ({ key: c.key, ...CATEGORY_TEXT[c.key], bytes: c.bytes, percent: (c.bytes / total) * 100 }))
    .sort((a, b) => b.bytes - a.bytes);
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

export interface SentencePart {
  key: string;
  value: number;
  label: string;
  tab: NavTab;
}

/** The Dashboard's opening line (round 2, #4): "12,480 photos, 342 videos, 24 people, 12 albums
 *  and 214 documents", only what the library has, each part a way into its screen. */
export function librarySentence(counts: MediaCounts): SentencePart[] {
  const all: SentencePart[] = [
    { key: "photos", value: counts.images, label: counts.images === 1 ? "photo" : "photos", tab: "photos" },
    { key: "videos", value: counts.videos, label: counts.videos === 1 ? "video" : "videos", tab: "photos" },
    { key: "people", value: counts.people, label: counts.people === 1 ? "person" : "people", tab: "people" },
    { key: "albums", value: counts.albums, label: counts.albums === 1 ? "album" : "albums", tab: "albums" },
    { key: "documents", value: counts.documents, label: counts.documents === 1 ? "document" : "documents", tab: "documents" },
  ];
  return all.filter((p) => p.value > 0);
}
