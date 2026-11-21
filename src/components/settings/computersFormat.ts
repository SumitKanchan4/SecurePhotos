/**
 * Wording for "Your computers" (T3): the three choices and when a computer was last used.
 */
import type { ComputerChoice } from "../../services/computers";

export const CHOICE_OPTIONS: { value: ComputerChoice; label: string }[] = [
  { value: "always", label: "Always does the work" },
  { value: "ask", label: "Asks each time" },
  { value: "view", label: "Only views" },
];

/** One line under a computer's name: when it was last used, and what its choice means. */
export function computerDescription(choice: ComputerChoice, lastSeen: string | null, isThis: boolean, now = new Date()): string {
  const when = isThis ? "In use now" : `Last used ${lastUsed(lastSeen, now)}`;
  const meaning =
    choice === "always"
      ? "Improves your photos here."
      : choice === "ask"
        ? "Asks each time the drive is plugged in."
        : "Only for viewing. Improving waits for another computer.";
  return `${when}. ${meaning}`;
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
