/**
 * Plain-language text for the Import dialog (redesign R6). Pure functions, unit-tested.
 */

export interface ImportPreview {
  name: string;
  is_folder: boolean;
  photos: number;
  videos: number;
  documents: number;
  total_bytes: number;
  already_in_library: number;
  to_import: number;
  unsupported: number;
}

export interface ImportResult {
  total_found: number;
  imported: number;
  skipped: number;
  failed: number;
  cancelled?: boolean;
  /** Into the vault: "vault_locked" when the vault locked and the rest stopped. */
  stopped_reason?: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** "48 photos, 3 videos (2.1 GB)". */
export function contentsLine(p: ImportPreview): string {
  const parts: string[] = [];
  if (p.photos) parts.push(plural(p.photos, "photo"));
  if (p.videos) parts.push(plural(p.videos, "video"));
  if (p.documents) parts.push(plural(p.documents, "PDF"));
  if (parts.length === 0) return "No photos or videos here";
  return `${parts.join(", ")} (${formatSize(p.total_bytes)})`;
}

/** "4 are already in your library and will be skipped", or null. */
export function duplicatesLine(p: ImportPreview): string | null {
  if (p.already_in_library === 0) return null;
  if (p.already_in_library === p.to_import + p.already_in_library) return "Everything here is already in your library";
  return p.already_in_library === 1
    ? "1 is already in your library and will be skipped"
    : `${p.already_in_library.toLocaleString()} are already in your library and will be skipped`;
}

/** P4: a big selection is fine; say so, so "Add more" never feels risky. Null for small ones. */
export function largeImportNote(p: ImportPreview): string | null {
  if (p.to_import < 500 && p.total_bytes < 10 * 1024 ** 3) return null;
  return "A big import is fine: everything is added first, then prepared in the background, newest first. You can keep using the app.";
}

export function importButtonLabel(p: ImportPreview | null): string {
  if (!p) return "Import";
  if (p.to_import === 0) return "Nothing new to import";
  return `Import ${plural(p.to_import, "item")}`;
}

/** "about 1 min left" from the pace so far; null until there is a pace to go on. */
export function timeLeft(completed: number, total: number, startedAtSec: number | null, nowSec: number): string | null {
  if (!startedAtSec || completed < 2 || completed >= total) return null;
  const elapsed = nowSec - startedAtSec;
  if (elapsed <= 0) return null;
  const remaining = ((total - completed) * elapsed) / completed;
  if (remaining < 45) return "less than a minute left";
  const minutes = Math.round(remaining / 60);
  if (minutes < 60) return `about ${Math.max(1, minutes)} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `about ${hours} h${rest ? ` ${rest} min` : ""} left`;
}

/** Into the vault (owner, 2026-11-21): photos already in the library are moved in too, so the
 *  button counts them; only photos already in the vault are left out by the import itself. */
export function vaultButtonLabel(p: ImportPreview | null): string {
  if (!p) return "Add to vault";
  const count = p.to_import + p.already_in_library;
  return count === 0 ? "Nothing to add" : `Add ${plural(count, "item")} to the vault`;
}

/** The message shown when an import into the vault ends. */
export function vaultResultMessage(r: ImportResult): { text: string; tone: "success" | "info" | "warning" } {
  const added = plural(r.imported, "item");
  const extras: string[] = [];
  if (r.skipped) extras.push(`${r.skipped.toLocaleString()} already in the vault or in Trash`);
  if (r.failed) extras.push(`${r.failed.toLocaleString()} couldn't be added`);
  const tail = extras.length ? ` (${extras.join(", ")})` : "";
  if (r.stopped_reason === "vault_locked")
    return { text: `The vault locked, so adding stopped. ${added} went in safely${tail}; the rest are where they were.`, tone: "info" };
  if (r.cancelled) return { text: `Stopped. ${added} went into the vault${tail}; the rest are where they were.`, tone: "info" };
  if (r.imported > 0) return { text: `Added ${added} to your vault${tail}.`, tone: "success" };
  if (r.failed > 0 && r.skipped === 0) return { text: `Couldn't add ${plural(r.failed, "item")} to the vault. Check that the files can be opened.`, tone: "warning" };
  if (r.skipped > 0) return { text: `Everything was already in your vault${r.failed ? ` (${r.failed.toLocaleString()} couldn't be added)` : ""}.`, tone: "info" };
  return { text: "There was nothing to add.", tone: "info" };
}

/** The message shown when an import ends (also after the dialog was hidden). */
export function resultMessage(r: ImportResult): { text: string; tone: "success" | "info" | "warning" } {
  const added = plural(r.imported, "item");
  const extras: string[] = [];
  if (r.skipped) extras.push(`${r.skipped.toLocaleString()} already in your library`);
  if (r.failed) extras.push(`${r.failed.toLocaleString()} couldn't be read`);
  const tail = extras.length ? ` (${extras.join(", ")})` : "";
  if (r.cancelled) return { text: `Import stopped. Added ${added}${tail}; nothing else was changed.`, tone: "info" };
  if (r.imported > 0) return { text: `Added ${added} to your library${tail}.`, tone: "success" };
  if (r.failed > 0 && r.skipped === 0) return { text: `Couldn't import ${plural(r.failed, "item")}. Check that the files can be opened.`, tone: "warning" };
  if (r.skipped > 0) return { text: `Everything was already in your library${r.failed ? ` (${r.failed.toLocaleString()} couldn't be read)` : ""}.`, tone: "info" };
  return { text: "There was nothing new to import.", tone: "info" };
}
