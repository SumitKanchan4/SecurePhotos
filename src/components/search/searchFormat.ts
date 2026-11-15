/**
 * Search page helpers (R9c). Pure functions, unit-tested.
 */
import type { SearchPhotoItem, TimelinePhoto } from "../../types";

/** Quick searches offered before anything is typed: label shown, words searched. */
export function quickSearches(now = new Date()): { label: string; query: string }[] {
  const year = now.getFullYear();
  return [
    { label: "Videos", query: "videos" },
    { label: "Favourites", query: "favourites" },
    { label: "Documents", query: "documents" },
    { label: String(year), query: String(year) },
    { label: String(year - 1), query: String(year - 1) },
  ];
}

/** Search results in the shape the photo grid uses (with their sizes, so rows are justified like Photos). */
export function toTimeline(photos: SearchPhotoItem[]): TimelinePhoto[] {
  return photos.map((p) => ({
    id: p.id,
    taken_at: p.taken_at || null,
    width: p.width ?? 0,
    height: p.height ?? 0,
    is_video: Boolean(p.mime_type?.startsWith("video/")),
    is_favorite: p.is_favorite,
    // Unknown counts as ready: these only decide whether a video can play yet.
    is_optimized: p.is_optimized ?? true,
    is_enhanced: p.is_enhanced ?? true,
  }));
}

/** "24 photos and videos" / "1 photo or video". */
export function resultsLabel(total: number): string {
  return total === 1 ? "1 photo or video" : `${total.toLocaleString()} photos and videos`;
}
