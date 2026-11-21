/**
 * Settings → Storage wording (owner, 2026-11-21): the drive the library is on, split into
 * SecurePhotos, other files and free space.
 */
import type { DriveStorageStats } from "../../types";

export interface DrivePart {
  key: "app" | "other" | "free";
  label: string;
  bytes: number;
  /** Share of the whole drive, 0–100. */
  percent: number;
}

/** The drive's name as people know it: "Photos (E:)", or "Drive E:" when it has no name. */
export function driveName(drive: Pick<DriveStorageStats, "drive_letter" | "volume_name">): string {
  const letter = drive.drive_letter.replace(/[\\/]+$/, "");
  return drive.volume_name ? `${drive.volume_name} (${letter})` : `Drive ${letter}`;
}

/** One plain line about the drive: external, or this computer's own. */
export function driveKind(drive: Pick<DriveStorageStats, "is_internal">): string {
  return drive.is_internal ? "This computer's own drive" : "External drive";
}

/** SecurePhotos, everything else, and what's free; parts without space are left out. */
export function driveParts(drive?: DriveStorageStats | null): DrivePart[] {
  if (!drive || drive.total_bytes <= 0) return [];
  const total = drive.total_bytes;
  const app = Math.max(0, drive.app_consumed_bytes);
  const free = Math.max(0, drive.free_bytes);
  const other = Math.max(0, total - app - free);
  return (
    [
      { key: "app", label: "SecurePhotos", bytes: app },
      { key: "other", label: "Other files", bytes: other },
      { key: "free", label: "Free", bytes: free },
    ] as const
  )
    .filter((part) => part.bytes > 0)
    .map((part) => ({ ...part, percent: (part.bytes / total) * 100 }));
}

/** "<1%" for a sliver, else a whole percentage. */
export function percentLabel(percent: number): string {
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}
