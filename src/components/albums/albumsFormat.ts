/**
 * Albums helpers (redesign R7d). Pure functions, unit-tested.
 */
import type { AlbumItem, PhotoItem } from "../../types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Reads the date part of a stored timestamp ("2026-11-08 09:00:00" or ISO) without time-zone shifts. */
function parseDay(value?: string | null): { y: number; m: number; d: number } | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

/** "Nov 2026", "Oct – Dec 2025" or "Dec 2024 – Jan 2025". */
export function monthSpan(first?: string | null, last?: string | null): string {
  const a = parseDay(first);
  const b = parseDay(last) ?? a;
  if (!a || !b) return "";
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.y}`;
  if (a.y === b.y) return `${MONTHS[a.m]} – ${MONTHS[b.m]} ${a.y}`;
  return `${MONTHS[a.m]} ${a.y} – ${MONTHS[b.m]} ${b.y}`;
}

/** "12 Nov 2026", "8–12 Nov 2026", "28 Oct – 3 Nov 2026" or "28 Dec 2024 – 3 Jan 2025". */
export function daySpan(first?: string | null, last?: string | null): string {
  const a = parseDay(first);
  const b = parseDay(last) ?? a;
  if (!a || !b) return "";
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${a.d} ${MONTHS[a.m]} ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[a.m]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m]} – ${b.d} ${MONTHS[b.m]} ${a.y}`;
  return `${a.d} ${MONTHS[a.m]} ${a.y} – ${b.d} ${MONTHS[b.m]} ${b.y}`;
}

/** Under an album cover: "86 photos · Nov 2026", or "Empty". */
export function albumMeta(album: Pick<AlbumItem, "photo_count" | "first_taken_at" | "last_taken_at">): string {
  const count = album.photo_count ?? 0;
  if (count === 0) return "Empty";
  const when = monthSpan(album.first_taken_at, album.last_taken_at);
  return when ? `${plural(count, "photo")} · ${when}` : plural(count, "photo");
}

/** On the album page: "86 photos · 8–12 Nov 2026" from the photos themselves. */
export function albumPageMeta(photos: Pick<PhotoItem, "taken_at">[]): string {
  if (photos.length === 0) return "Empty";
  const days = photos.map((p) => p.taken_at).filter((t): t is string => !!parseDay(t)).sort();
  const when = days.length ? daySpan(days[0], days[days.length - 1]) : "";
  return when ? `${plural(photos.length, "photo")} · ${when}` : plural(photos.length, "photo");
}

/** The automatic "Collages" album is listed under "Made for you", not with your own albums. */
export function isCollagesAlbum(album: Pick<AlbumItem, "name">): boolean {
  return album.name.trim().toLowerCase() === "collages";
}

/** Albums whose name contains the search text (case-insensitive). */
export function filterAlbums<T extends Pick<AlbumItem, "name">>(albums: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? albums.filter((a) => a.name.toLowerCase().includes(q)) : albums;
}
