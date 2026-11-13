/**
 * Plain-language helpers for Trash (redesign R7a). Pure functions, unit-tested.
 */

export interface TrashedItem {
  id: number;
  filename: string;
  filepath: string;
  file_size: number;
  formatted_size: string;
  trashed_at: string;
  days_remaining: number;
  is_vault_item?: boolean;
  mime_type?: string | null;
}

/** Items close to being deleted for good get an amber label. */
export const ENDING_SOON_DAYS = 3;

export function daysLeftLabel(days: number): string {
  if (days <= 0) return "Deleted today";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

export function isEndingSoon(days: number): boolean {
  return days <= ENDING_SOON_DAYS;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Deleted this month" / "Deleted in October 2026", from the trash date ("2026-11-12 10:00:00"). */
export function trashMonthLabel(trashedAt: string, now: Date): string {
  const m = /^(\d{4})-(\d{2})/.exec(trashedAt);
  if (!m) return "Deleted earlier";
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (year === now.getFullYear() && month === now.getMonth()) return "Deleted this month";
  return `Deleted in ${MONTHS[month]} ${year}`;
}

/** Consecutive sections by the month items were deleted (the engine sends newest first). */
export function groupByTrashMonth(items: TrashedItem[], now: Date): { label: string; items: TrashedItem[] }[] {
  const groups: { label: string; items: TrashedItem[] }[] = [];
  for (const item of items) {
    const label = trashMonthLabel(item.trashed_at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function itemsLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "item" : "items"}`;
}
