/**
 * File names in the UI (A8, owner feedback): a name is shown only when a person wrote it
 * ("Grandma's wedding.jpg"). Names made by phones, cameras and apps (timestamps, GUIDs,
 * IMG_1234, PXL_…) mean nothing to people, so a plain title is shown instead.
 */

/** Our own suffix on improved copies: "<stem>_fade,scratches,faces". */
const IMPROVED_SUFFIX = /_(?:colour|fade|faces|scratches)(?:,(?:colour|fade|faces|scratches))*$/i;

const MACHINE_PATTERNS: RegExp[] = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // GUID
  /[0-9a-f]{24,}/i, // long hex hash
  /\d{8,}/, // timestamps, 20261115_181212 style dates and counters
  /^(?:img|dsc|dscn|dscf|pxl|vid|mvimg|pano|dji|gopr|gp|mov|cimg|sam|p|wp|photo|image|scan|scanned|document|doc|screenshot|screen ?shot|whatsapp ?(?:image|video)|signal|telegram)[\s_-]*[\d_\s-]*(?:\(\d+\))?$/i,
  /^(?:img|vid|pxl|dsc|screenshot|whatsapp ?(?:image|video))[\s_-]+\d/i,
  /^[\d\s_.()-]+$/, // only digits and separators
];

/** The file name without its extension or our improved-copy suffix. */
export function fileStem(filename: string | null | undefined): string {
  return (filename ?? "").replace(/\.[^/.]+$/, "").replace(IMPROVED_SUFFIX, "").trim();
}

/** True when the name was made by a device or app rather than written by a person. */
export function isMachineName(filename: string | null | undefined): boolean {
  const stem = fileStem(filename);
  if (stem.length < 2) return true;
  return MACHINE_PATTERNS.some((pattern) => pattern.test(stem));
}

/** The name a person gave the file (separators made into spaces), or null when it has none. */
export function humanName(filename: string | null | undefined): string | null {
  if (isMachineName(filename)) return null;
  return fileStem(filename).replace(/[_]+/g, " ").replace(/\s{2,}/g, " ").trim() || null;
}

/** A short title for any item: a person-written name, otherwise what it is. */
export function itemTitle(item: {
  filename?: string | null;
  mime_type?: string | null;
  is_document?: boolean | null;
  derived_from_id?: number | null;
}): string {
  const named = humanName(item.filename);
  if (named) return named;
  if (item.mime_type?.startsWith("video/")) return "Video";
  if (item.is_document || item.mime_type === "application/pdf") return "Document";
  if (item.derived_from_id) return "Improved photo";
  return "Photo";
}
