/**
 * Wording for "Your computers" (T3): the three choices, what each means, and when a computer was
 * last used.
 */
import type { ComputerChoice } from "../../services/computers";

export const CHOICE_OPTIONS: { value: ComputerChoice; label: string }[] = [
  { value: "always", label: "Always does the work" },
  { value: "ask", label: "Asks each time" },
  { value: "view", label: "Only views" },
];

/** What a choice means for that computer, in one plain line. */
export function choiceMeaning(choice: ComputerChoice): string {
  if (choice === "always") return "Improves your photos whenever your drive is plugged in.";
  if (choice === "ask") return "Asks whether to improve photos each time your drive is plugged in.";
  return "Only for viewing. Improving waits for one of your other computers.";
}

/** "In use now" for this computer, else "Last used today / yesterday / 2 Nov 2026". */
export function lastUsedLine(lastSeen: string | null, isThis: boolean, now = new Date()): string {
  return isThis ? "In use now" : `Last used ${lastUsed(lastSeen, now)}`;
}

/** "today", "yesterday" or a date such as "12 Nov 2026". Stored times are UTC ("YYYY-MM-DD HH:MM:SS"). */
export function lastUsed(lastSeen: string | null, now = new Date()): string {
  if (!lastSeen) return "some time ago";
  const seen = new Date(`${lastSeen.replace(" ", "T")}Z`);
  if (Number.isNaN(seen.getTime())) return "some time ago";
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(seen)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return seen.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
