/**
 * Plain-language text for the photo viewer (redesign R3): title, date line, camera,
 * quality chip, sizes and the filmstrip range. Pure functions, unit-tested.
 */
import type { PhotoItem } from "../../types";
import { itemTitle } from "../../utils/displayName";

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

/** The small chip beside the title: "8K" for enhanced photos, "4K" / "HD" for videos. */
export function qualityChip(photo: Pick<PhotoItem, "mime_type" | "width" | "height" | "is_enhanced" | "is_optimized">): { label: string; title: string } | null {
  const w = photo.width ?? 0;
  const h = photo.height ?? 0;
  if (isVideoItem(photo)) {
    if (w >= 3840 || h >= 2160) return { label: "4K", title: photo.is_enhanced ? "Enhanced to 4K" : "4K video" };
    if (w >= 1280 || h >= 720) return { label: "HD", title: "HD video" };
    return null;
  }
  if (photo.is_enhanced || photo.is_optimized) return { label: "8K", title: "Enhanced to 8K" };
  return null;
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
export function printLine(photo: Pick<PhotoItem, "width" | "height">): string | null {
  if (!photo.width || !photo.height) return null;
  const cm = (px: number) => Math.round((px / 300) * 2.54);
  return `Sharp prints up to ${cm(photo.width)} × ${cm(photo.height)} cm`;
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
