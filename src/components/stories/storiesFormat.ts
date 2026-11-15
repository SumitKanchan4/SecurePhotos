/**
 * Stories helpers (redesign R7e). Pure functions, unit-tested.
 */
import type { MusicTrackItem, StoryModel } from "../../types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function parseDay(value?: string | null): { y: number; m: number; d: number } | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) } : null;
}

/** "12 Nov 2025", "Nov 2026", "Oct – Dec 2025" or "2019 – 2026". */
export function storySpan(first?: string | null, last?: string | null): string {
  const a = parseDay(first);
  const b = parseDay(last) ?? a;
  if (!a || !b) return "";
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${a.d} ${MONTHS[a.m]} ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.y}`;
  if (a.y === b.y) return `${MONTHS[a.m]} – ${MONTHS[b.m]} ${a.y}`;
  return `${a.y} – ${b.y}`;
}

/** Under a story's title: "Nov 2026 · 86 photos". */
export function storyMeta(story: Pick<StoryModel, "slides_count" | "first_taken_at" | "last_taken_at">): string {
  const when = storySpan(story.first_taken_at, story.last_taken_at);
  const count = story.slides_count ? plural(story.slides_count, "photo") : "";
  return [when, count].filter(Boolean).join(" · ");
}

export const MOODS = [
  { value: "auto", label: "Pick for me" },
  { value: "upbeat", label: "Upbeat" },
  { value: "nostalgic", label: "Nostalgic" },
  { value: "acoustic", label: "Acoustic" },
  { value: "cinematic", label: "Cinematic" },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The mood a track is used for, in words: "Upbeat", or "Picked for me: Nostalgic". */
export function moodLabel(track: Pick<MusicTrackItem, "mood" | "detected_mood">): string {
  if (track.mood === "auto") return track.detected_mood ? `Picked for me: ${cap(track.detected_mood)}` : "Pick for me";
  return MOODS.find((m) => m.value === track.mood)?.label ?? cap(track.mood);
}

/** Tracks whose title, artist or mood contains the search text. */
export function filterTracks<T extends Pick<MusicTrackItem, "title" | "artist" | "mood" | "detected_mood">>(tracks: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  return tracks.filter((t) => [t.title, t.artist, t.mood, t.detected_mood].some((v) => v && v.toLowerCase().includes(q)));
}
