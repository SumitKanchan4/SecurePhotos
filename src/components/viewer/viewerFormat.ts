/**
 * Plain-language text for the photo viewer (redesign R3): title, date line, camera,
 * quality chip, sizes and the filmstrip range. Pure functions, unit-tested.
 */
import type { PhotoItem } from "../../types";
import { itemTitle } from "../../utils/displayName";
import { photoSizeLabel, videoSizeLabel } from "../../utils/photoTimeline";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Reads "2026-11-08 18:12:00" or ISO text as the local time it was taken (no time-zone shift). */
export function parseTakenAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  return Number.isNaN(date.getTime()) || date.getMonth() !== Number(m[2]) - 1 ? null : date;
}

export function formatDay(date: Date): string {
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatTime(date: Date): string {
  const h = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${minutes} ${h < 12 ? "am" : "pm"}`;
}

/** "Sat 8 Nov 2026 · 6:12 pm" (time left out when the photo has only a date). */
export function formatTakenLine(value: string | null | undefined): string {
  const date = parseTakenAt(value);
  if (!date) return "Date unknown";
  const hasTime = /[ T]\d{2}:\d{2}/.test(value ?? "");
  return hasTime ? `${formatDay(date)} · ${formatTime(date)}` : formatDay(date);
}

/** Short caption when there is one, then a name a person wrote, otherwise what it is ("Photo"). */
export function viewerTitle(photo: Pick<PhotoItem, "caption" | "filename"> & Partial<Pick<PhotoItem, "mime_type" | "is_document" | "derived_from_id">>): string {
  const caption = photo.caption?.trim();
  if (caption && caption.length <= 80) return caption.charAt(0).toUpperCase() + caption.slice(1);
  return itemTitle(photo);
}

export function cameraName(photo: Pick<PhotoItem, "camera_make" | "camera_model">): string | null {
  const make = (photo.camera_make ?? "").trim();
  const model = (photo.camera_model ?? "").trim();
  if (!make && !model) return null;
  if (!make) return model;
  if (!model || model.toLowerCase().startsWith(make.toLowerCase())) return model || make;
  return `${make} ${model}`;
}

/** "f/1.7 · 1/500 s · ISO 50 · 6.8 mm" from whatever the camera recorded. */
export function exposureLine(photo: Pick<PhotoItem, "aperture" | "shutter_speed" | "iso" | "focal_length">): string | null {
  const parts: string[] = [];
  if (photo.aperture) parts.push(`f/${Number(photo.aperture).toFixed(1).replace(/\.0$/, "")}`);
  if (photo.shutter_speed) parts.push(`${photo.shutter_speed}${/s$/.test(photo.shutter_speed) ? "" : " s"}`);
  if (photo.iso) parts.push(`ISO ${photo.iso}`);
  if (photo.focal_length) parts.push(`${Number(photo.focal_length).toFixed(1).replace(/\.0$/, "")} mm`);
  return parts.length ? parts.join(" · ") : null;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function isVideoItem(photo: Pick<PhotoItem, "mime_type">): boolean {
  return Boolean(photo.mime_type?.startsWith("video/"));
}

/** The small chip beside the title, with the same rules as the grid's tag: the enhanced photo's
 *  real size (8K / 4K / 2K), or the video's quality (4K / 2K / HD / SD). */
export function qualityChip(photo: Pick<PhotoItem, "mime_type" | "width" | "height" | "is_enhanced" | "is_optimized">): { label: string; title: string } | null {
  if (isVideoItem(photo)) {
    const label = videoSizeLabel(photo.width, photo.height);
    if (!label) return null;
    return { label, title: photo.is_enhanced && label !== "SD" ? `Enhanced to ${label}` : `${label} video` };
  }
  if (!(photo.is_enhanced || photo.is_optimized)) return null;
  const label = photoSizeLabel(photo.width, photo.height);
  return label ? { label, title: `Enhanced to ${label}` } : null;
}

/** "7680 × 5760" plus the quality label, or null when the size is unknown. */
export function dimensionsLine(photo: Pick<PhotoItem, "mime_type" | "width" | "height" | "is_enhanced" | "is_optimized">): string | null {
  if (!photo.width || !photo.height) return null;
  const chip = qualityChip(photo);
  return `${photo.width} × ${photo.height}${chip ? ` · ${chip.label}` : ""}`;
}

/** "Enhanced · 6.2 MB (was 9.8 MB)" or "Original · 9.8 MB". */
export function storageLine(photo: Pick<PhotoItem, "file_size" | "original_file_size" | "is_enhanced" | "is_optimized">): string {
  const size = formatBytes(photo.file_size);
  if (photo.is_enhanced || photo.is_optimized) {
    const before = photo.original_file_size;
    return before && before !== photo.file_size ? `Enhanced · ${size} (was ${formatBytes(before)})` : `Enhanced · ${size}`;
  }
  return `Original · ${size}`;
}

/** Largest sharp print at 300 dpi, in cm: "Sharp prints up to 65 × 49 cm". */
/** The print-ready copy is always made at 8K (T28): "Print copy at 8K: sharp up to 65 × 43 cm". */
export function printLine(photo: Pick<PhotoItem, "width" | "height">): string | null {
  if (!photo.width || !photo.height) return null;
  const scale = 7680 / Math.max(photo.width, photo.height);
  const cm = (px: number) => Math.round(((px * scale) / 300) * 2.54);
  return `Print copy at 8K: sharp up to ${cm(photo.width)} × ${cm(photo.height)} cm`;
}

export function coordinatesLine(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
}

/** Up to `count` neighbours centred on the current photo, for the filmstrip. */
export function filmstripRange(index: number, length: number, count = 9): [number, number] {
  if (length <= 0) return [0, -1];
  const size = Math.min(count, length);
  const start = Math.max(0, Math.min(index - Math.floor(size / 2), length - size));
  return [start, start + size - 1];
}

/** T29 (owner, 2026-11-21): the sizes a video can be made, above its current one (shorter side). */
export const VIDEO_TARGETS: { target: number; label: string; name: string }[] = [
  { target: 1080, label: "Full HD (1080p)", name: "Full HD" },
  { target: 1440, label: "2K (1440p)", name: "2K" },
  { target: 2160, label: "4K (2160p)", name: "4K" },
];

export function videoImproveOptions(width?: number | null, height?: number | null): typeof VIDEO_TARGETS {
  const short = Math.min(width || 0, height || 0);
  if (short <= 0) return [];
  return VIDEO_TARGETS.filter((t) => t.target > short);
}

/** T14 Try again: the compare labels, "Current · Natural" and "New · Vivid" (no style when no colour was added). */
export function tryAgainLabels(current: "natural" | "vivid" | null, next: "natural" | "vivid" | null): { before: string; after: string } {
  const name = (s: "natural" | "vivid" | null) => (s === "vivid" ? " · Vivid" : s === "natural" ? " · Natural" : "");
  return { before: `Current${name(current)}`, after: `New${name(next)}` };
}
