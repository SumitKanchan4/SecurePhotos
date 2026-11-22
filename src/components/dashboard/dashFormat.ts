/**
 * Dashboard, Duplicates and Big videos helpers (redesign R7c). Pure functions, unit-tested.
 */
import type { AppStorageStats, DriveStorageStats, DuplicateGroupItem, MediaCounts, StorageCategoryKey } from "../../types";
import type { NavTab } from "../../store/useAppStore";
import { formatSize } from "../import/importFormat";

export { formatSize };

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
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

/** What enhancing did to the library (T27, owner 2026-11-21), from /api/system/space-summary. */
export interface SpaceSummary {
  enhanced: number;
  before_bytes: number;
  after_bytes: number;
  saved_bytes: number;
  kept_8k: number;
  enlarged_small: number;
  waiting: number;
}

/** The Dashboard's space card in plain words; null when nothing has been enhanced or is waiting. */
export function spaceCard(s?: SpaceSummary | null): { headline: string; detail: string | null; sorted: string | null; waiting: string | null } | null {
  if (!s || typeof s.enhanced !== "number" || (s.enhanced === 0 && !s.waiting)) return null;
  const photos = plural(s.enhanced, "enhanced photo");
  let headline: string;
  let detail: string | null = null;
  if (s.enhanced === 0) headline = "Your photos are being made sharper";
  else if (s.saved_bytes > 0) {
    headline = `${formatSize(s.saved_bytes)} saved`;
    detail = `Your ${photos} take ${formatSize(s.after_bytes)} instead of ${formatSize(s.before_bytes)}, and they are sharper.`;
  } else {
    headline = "Sharper photos";
    detail = `Your ${photos} take ${formatSize(s.after_bytes)}; they were ${formatSize(s.before_bytes)}. Enlarging small photos adds detail, and some size.`;
  }
  const parts: string[] = [];
  if (s.kept_8k) parts.push(`${plural(s.kept_8k, "full-size photo")} at 8K`);
  if (s.enlarged_small) parts.push(`${plural(s.enlarged_small, "smaller photo")} enlarged to 4K`);
  return {
    headline,
    detail,
    sorted: parts.length ? parts.join(" · ") : null,
    waiting: s.waiting ? `${plural(s.waiting, "photo")} still to enhance` : null,
  };
}

/** The space pill on What to keep, Duplicates and Big videos (owner, 2026-11-21): "Frees about
 *  1.2 GB", or null when there is nothing to free. */
export function freesLabel(bytes: number): string | null {
  return bytes > 0 ? `Frees about ${formatSize(bytes)}` : null;
}

// ── Dashboard tiles (T32, owner-approved mock-up 2026-11-22) ─────────────────────────────

/** /api/system/highlights: what the Dashboard tiles show. */
export interface Highlights {
  on_this_day: { year: number; years_ago: number; count: number; photo_ids: number[]; story_id: number | null } | null;
  just_added: { photos: number; videos: number; preparing: number; photo_ids: number[] } | null;
  brought_back: { before_id: number; after_id: number; kinds: string[]; total: number } | null;
  people: { top: { id: number; name: string; close: boolean; photo_count: number; face_id: number | null }[]; to_name: number };
  year: number;
  months: number[];
  trash: { count: number; bytes: number };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Good evening · Sunday 22 November". */
export function greeting(now: Date): string {
  const h = now.getHours();
  const part = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${part} · ${DAY_NAMES[now.getDay()]} ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}`;
}

/** The one storage line, and whether it should warn (under 10% of the drive free). */
export function storageLine(appBytes: number, drive?: DriveStorageStats | null): { text: string; low: boolean; usedPercent: number } | null {
  if (!drive || drive.total_bytes <= 0) return null;
  const letter = drive.drive_letter ? drive.drive_letter.replace(/\\$/, "") : "";
  const where = drive.volume_name ? `${drive.volume_name}${letter ? ` (${letter})` : ""}` : letter || "this drive";
  const low = drive.free_bytes / drive.total_bytes < 0.1;
  const free = `${formatSize(drive.free_bytes)} free on ${where}`;
  return {
    text: low ? `Running low: ${free} · SecurePhotos uses ${formatSize(appBytes)}` : `SecurePhotos uses ${formatSize(appBytes)} · ${free}`,
    low,
    usedPercent: Math.min(100, Math.max(0, 100 - (drive.free_bytes / drive.total_bytes) * 100)),
  };
}

/** The pill next to the title: "18.0 GB saved by enhancing" (null when there is nothing to say). */
export function savedPill(s?: SpaceSummary | null): string | null {
  const card = spaceCard(s);
  if (!card) return null;
  return s && s.saved_bytes > 0 && s.enhanced > 0 ? `${formatSize(s.saved_bytes)} saved by enhancing` : card.headline;
}

/** On this day: "This week, 3 years ago" and "14 photos from November 2023". */
export function onThisDayText(m: NonNullable<Highlights["on_this_day"]>, now: Date): { title: string; line: string } {
  const ago = m.years_ago === 1 ? "1 year ago" : `${m.years_ago} years ago`;
  return { title: `This week, ${ago}`, line: `${plural(m.count, "photo")} from ${MONTH_NAMES[now.getMonth()]} ${m.year}` };
}

/** Just added: "48 photos and 2 videos" and "12 still being prepared". */
export function justAddedText(j: NonNullable<Highlights["just_added"]>): { title: string; preparing: string | null } {
  const parts = [j.photos ? plural(j.photos, "photo") : "", j.videos ? plural(j.videos, "video") : ""].filter(Boolean);
  return {
    title: parts.join(" and ") || "Nothing new",
    preparing: j.preparing > 0 ? `${j.preparing.toLocaleString()} still being prepared` : null,
  };
}

const KIND_TEXT: Record<string, string> = {
  colour: "Colour added",
  fade: "Faded colours brought back",
  scratches: "Scratches removed",
  faces: "Faces made clearer",
};

/** Brought back: what the app did, "Faded colours brought back · Colour added". */
export function broughtBackText(kinds: string[]): string {
  const known = kinds.filter((k) => k in KIND_TEXT).map((k) => KIND_TEXT[k]);
  return known.length ? known.join(" · ") : "Brought back";
}

export interface MonthBar {
  key: string;
  letter: string;
  name: string;
  count: number;
  /** Height, 0–100 (at least a sliver for a month with photos). */
  height: number;
  current: boolean;
  busiest: boolean;
}

/** Your year: one bar per month, the current month and the busiest one marked. */
export function monthBars(year: number, counts: number[], now: Date): { bars: MonthBar[]; total: number; busiest: string | null } {
  const max = Math.max(0, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const busiestIndex = max > 0 ? counts.indexOf(max) : -1;
  const bars = MONTH_NAMES.map((name, i) => {
    const count = counts[i] ?? 0;
    return {
      key: `${year}-${String(i + 1).padStart(2, "0")}`,
      letter: name[0],
      name,
      count,
      height: count > 0 && max > 0 ? Math.max(6, Math.round((count / max) * 100)) : 0,
      current: now.getFullYear() === year && now.getMonth() === i,
      busiest: i === busiestIndex,
    };
  });
  return { bars, total, busiest: busiestIndex >= 0 ? `Busiest: ${MONTH_NAMES[busiestIndex]}, ${plural(max, "photo")}` : null };
}

export interface WorthJob {
  key: "duplicates" | "keep" | "videos" | "trash";
  title: string;
  line: string;
  bytes: number;
}

/** Worth doing: only jobs that free something, biggest first. */
export function worthDoing(input: {
  duplicates?: { groups: number; bytes: number } | null;
  keep?: { count: number; bytes: number } | null;
  videos?: { count: number; bytes: number } | null;
  trash?: { count: number; bytes: number } | null;
}): WorthJob[] {
  const jobs: WorthJob[] = [];
  const d = input.duplicates;
  if (d && d.groups > 0 && d.bytes > 0) jobs.push({ key: "duplicates", title: "Duplicates", line: `${plural(d.groups, "group")} of copies and bursts`, bytes: d.bytes });
  const k = input.keep;
  if (k && k.count > 0 && k.bytes > 0) jobs.push({ key: "keep", title: "What to keep", line: `${plural(k.count, "improved photo")} to choose`, bytes: k.bytes });
  const v = input.videos;
  if (v && v.count > 0 && v.bytes > 0) jobs.push({ key: "videos", title: "Big videos", line: `${plural(v.count, "video")} can be made smaller`, bytes: v.bytes });
  const t = input.trash;
  if (t && t.count > 0 && t.bytes > 0) jobs.push({ key: "trash", title: "Empty Trash", line: `${plural(t.count, "item")} waiting to be deleted`, bytes: t.bytes });
  return jobs.sort((a, b) => b.bytes - a.bytes);
}
