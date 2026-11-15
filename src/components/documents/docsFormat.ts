/**
 * Documents screen helpers (redesign R7b): categories, counts, ordering and plain dates.
 * Pure functions, unit-tested.
 */
import type { DocumentItem } from "../../types";

export const DOCUMENT_CATEGORIES: { id: string; label: string }[] = [
  { id: "receipt", label: "Receipts & bills" },
  { id: "identity", label: "IDs" },
  { id: "tax", label: "Tax" },
  { id: "medical", label: "Medical" },
  { id: "legal", label: "Legal" },
  { id: "warranty", label: "Warranties" },
  { id: "other", label: "Other" },
];

export function categoryLabel(id: string): string {
  return DOCUMENT_CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}

/** Chips: All plus each category that has documents (Other only when used), with counts. */
export function categoryChips(docs: DocumentItem[]): { id: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    const id = DOCUMENT_CATEGORIES.some((c) => c.id === doc.category) ? doc.category : "other";
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [
    { id: "all", label: "All", count: docs.length },
    ...DOCUMENT_CATEGORIES.filter((c) => c.id !== "other" || counts.get("other")).map((c) => ({ ...c, count: counts.get(c.id) ?? 0 })),
  ];
}

export function inCategory(doc: DocumentItem, category: string): boolean {
  if (category === "all") return true;
  if (category === "other") return !DOCUMENT_CATEGORIES.some((c) => c.id !== "other" && c.id === doc.category);
  return doc.category === category;
}

/** Newest first ("2026-11-09" dates), then by id. */
export function sortByDate(docs: DocumentItem[]): DocumentItem[] {
  return [...docs].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Nov 2026" from "2026-11-09"; "No date" otherwise. */
export function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || "");
  if (!m) return "No date";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function documentsLabel(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "document" : "documents"}`;
}
