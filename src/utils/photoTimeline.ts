/**
 * Pure helpers for the Photos timeline (redesign R2): parse the engine's compact
 * rows, group photos by month, lay them out as justified rows, place the month/year
 * scrubber marks and pick which photos the viewer loads. No React, so all of it is
 * unit-tested directly.
 */
import type { PhotoItem, TimelinePhoto, TimelineResponse } from "../types";

/** Flag bits used by /api/photos/timeline (see engine/api/photos.py). */
export const FLAG_FAVORITE = 1;
export const FLAG_OPTIMIZED = 2;
export const FLAG_ENHANCED = 4;

export function parseTimeline(data: TimelineResponse): TimelinePhoto[] {
  return data.items.map(([id, takenAt, width, height, kind, flags]) => ({
    id,
    taken_at: takenAt,
    width,
    height,
    is_video: kind === "v",
    is_favorite: (flags & FLAG_FAVORITE) !== 0,
    is_optimized: (flags & FLAG_OPTIMIZED) !== 0,
    is_enhanced: (flags & FLAG_ENHANCED) !== 0,
  }));
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const UNDATED_KEY = "undated";

/** "2026-05" for any date string starting with YYYY-MM, otherwise "undated". */
export function monthKey(takenAt: string | null | undefined): string {
  const match = takenAt ? /^(\d{4})-(\d{2})/.exec(takenAt) : null;
  if (!match) return UNDATED_KEY;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : UNDATED_KEY;
}

export function monthLabel(key: string): string {
  if (key === UNDATED_KEY) return "No date";
  const [year, month] = key.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

export function shortMonthLabel(key: string): string {
  if (key === UNDATED_KEY) return "No date";
  const [year, month] = key.split("-");
  return `${MONTHS[Number(month) - 1].slice(0, 3)} ${year}`;
}

export interface MonthSection {
  key: string;
  label: string;
  /** Index of the section's first photo in the full list. */
  start: number;
  count: number;
}

/**
 * Splits photos into consecutive month sections. The engine already sorts newest
 * first with undated photos last, so sections follow the list order.
 */
export function groupByMonth(photos: Pick<TimelinePhoto, "taken_at">[]): MonthSection[] {
  const sections: MonthSection[] = [];
  photos.forEach((photo, index) => {
    const key = monthKey(photo.taken_at);
    const last = sections[sections.length - 1];
    if (last && last.key === key) {
      last.count += 1;
    } else {
      sections.push({ key, label: monthLabel(key), start: index, count: 1 });
    }
  });
  return sections;
}

/** Width / height, kept within limits so a panorama or a sliver can't wreck a row. */
export function aspectRatio(photo: Pick<TimelinePhoto, "width" | "height">): number {
  if (!photo.width || !photo.height) return 1;
  return Math.min(3, Math.max(0.5, photo.width / photo.height));
}

export interface LayoutTile {
  index: number;
  left: number;
  width: number;
}

export type LayoutEntry =
  | { kind: "header"; key: string; top: number; height: number; section: MonthSection }
  | { kind: "row"; key: string; top: number; height: number; sectionKey: string; tiles: LayoutTile[] };

export interface TimelineLayout {
  entries: LayoutEntry[];
  totalHeight: number;
  /** Top offset of each section's header, by section key. */
  sectionTops: Map<string, number>;
}

export interface LayoutOptions {
  width: number;
  targetRowHeight: number;
  gap?: number;
  headerHeight?: number;
  /** Space above every header except the first. */
  sectionGap?: number;
}

/**
 * Justified rows per month: photos keep their shape and each full row is scaled to
 * fill the width exactly (rows never get taller than the target). A month's last
 * row stays at the target height instead of stretching a lone photo.
 */
export function buildLayout(
  photos: Pick<TimelinePhoto, "taken_at" | "width" | "height">[],
  sections: MonthSection[],
  { width, targetRowHeight, gap = 4, headerHeight = 48, sectionGap = 16 }: LayoutOptions,
): TimelineLayout {
  const entries: LayoutEntry[] = [];
  const sectionTops = new Map<string, number>();
  let top = 0;
  if (width <= 0) return { entries, totalHeight: 0, sectionTops };

  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) top += sectionGap;
    sectionTops.set(section.key, top);
    entries.push({ kind: "header", key: `h:${section.key}`, top, height: headerHeight, section });
    top += headerHeight;

    let row: { index: number; ratio: number }[] = [];
    let ratioSum = 0;
    const flush = (isFull: boolean) => {
      if (row.length === 0) return;
      const gaps = gap * (row.length - 1);
      const height = isFull ? (width - gaps) / ratioSum : targetRowHeight;
      let left = 0;
      const tiles = row.map((item, i) => {
        // The last tile of a full row takes the remaining width, so rounding never leaves a gap.
        const tileWidth = isFull && i === row.length - 1 ? width - left : item.ratio * height;
        const tile = { index: item.index, left, width: tileWidth };
        left += tileWidth + gap;
        return tile;
      });
      entries.push({ kind: "row", key: `r:${row[0].index}`, top, height, sectionKey: section.key, tiles });
      top += height + gap;
      row = [];
      ratioSum = 0;
    };

    for (let index = section.start; index < section.start + section.count; index++) {
      const ratio = aspectRatio(photos[index]);
      row.push({ index, ratio });
      ratioSum += ratio;
      if (ratioSum * targetRowHeight + gap * (row.length - 1) >= width) flush(true);
    }
    flush(false);
    top -= gap; // no gap after a section's last row
  });

  return { entries, totalHeight: Math.max(0, top), sectionTops };
}

/** Index range of entries that overlap the visible area (plus overscan), for windowing. */
export function visibleRange(entries: LayoutEntry[], scrollTop: number, viewportHeight: number, overscan = 600): [number, number] {
  if (entries.length === 0) return [0, -1];
  const from = scrollTop - overscan;
  const to = scrollTop + viewportHeight + overscan;
  // First entry whose bottom is below `from` (binary search; entries are sorted by top).
  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].top + entries[mid].height < from) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end + 1 < entries.length && entries[end + 1].top <= to) end++;
  return [lo, end];
}

/** The section shown at a scroll position: the last one whose header starts at or above it. */
export function sectionAt(sections: MonthSection[], sectionTops: Map<string, number>, scrollTop: number): MonthSection | null {
  let current: MonthSection | null = sections[0] ?? null;
  for (const section of sections) {
    if ((sectionTops.get(section.key) ?? 0) <= scrollTop + 1) current = section;
    else break;
  }
  return current;
}

export interface ScrubberEntry {
  /** Section to jump to (the entry's first month). */
  key: string;
  /** "Nov" for a month of the newest year, "2025" for an older year, "No date". */
  label: string;
  /** Spoken / hover name: "November 2026", "2025", "No date". */
  name: string;
  /** Every section the entry stands for (to mark it current). */
  keys: string[];
}

/**
 * The month/year scrubber as on the approved Photos board (R9d): the newest year's months
 * one by one, then one entry per older year, then "No date", stacked evenly from the top.
 * When there are more entries than fit (`maxEntries`), the newest year collapses to one entry.
 */
export function scrubberEntries(sections: MonthSection[], maxEntries = Infinity): ScrubberEntry[] {
  const years: { year: string; sections: MonthSection[] }[] = [];
  let undated: MonthSection | null = null;
  for (const section of sections) {
    if (section.key === UNDATED_KEY) {
      undated = section;
      continue;
    }
    const year = section.key.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last.year === year) last.sections.push(section);
    else years.push({ year, sections: [section] });
  }
  const yearEntry = (y: { year: string; sections: MonthSection[] }): ScrubberEntry => ({
    key: y.sections[0].key,
    label: y.year,
    name: y.year,
    keys: y.sections.map((x) => x.key),
  });
  const tail = years.slice(1).map(yearEntry);
  if (undated) tail.push({ key: UNDATED_KEY, label: "No date", name: "No date", keys: [UNDATED_KEY] });
  if (!years.length) return tail;
  const months = years[0].sections.map((x) => ({
    key: x.key,
    label: shortMonthLabel(x.key).slice(0, 3),
    name: monthLabel(x.key),
    keys: [x.key],
  }));
  return months.length + tail.length <= maxEntries ? [...months, ...tail] : [yearEntry(years[0]), ...tail];
}

/**
 * Which photos the viewer loads full details for: up to `size` ids centred on the
 * opened one (the details endpoint accepts at most 500 per request).
 */
export function viewerWindow<T extends { id: number }>(photos: T[], index: number, size = 300): { ids: number[]; offset: number } {
  const half = Math.floor(size / 2);
  const start = Math.max(0, Math.min(index - half, photos.length - size));
  const ids = photos.slice(start, start + size).map((p) => p.id);
  return { ids, offset: index - start };
}

/** A full photo record as a timeline row (vault items arrive as full records). */
export function fromPhotoItem(photo: PhotoItem): TimelinePhoto {
  return {
    id: photo.id,
    taken_at: photo.taken_at ?? null,
    width: photo.width ?? 0,
    height: photo.height ?? 0,
    is_video: Boolean(photo.mime_type?.startsWith("video/")),
    is_favorite: photo.is_favorite,
    is_optimized: photo.is_optimized,
    is_enhanced: photo.is_enhanced,
  };
}

/**
 * Newest first, undated last, then by id (newest first): the order the engine uses for the
 * library, applied to lists that arrive in another order (vault items, redesign R4).
 */
export function sortNewestFirst<T extends { id: number; taken_at?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = a.taken_at ?? "";
    const tb = b.taken_at ?? "";
    if (ta !== tb) {
      if (!ta) return 1;
      if (!tb) return -1;
      return ta < tb ? 1 : -1;
    }
    return b.id - a.id;
  });
}

/** Whether every id in the list is selected (false for an empty list). */
export function allSelected(ids: number[], selected: Set<number>): boolean {
  return ids.length > 0 && ids.every((id) => selected.has(id));
}
