/**
 * The space a page's clean-up frees, in a lime pill beside its title (owner, 2026-11-21: What to
 * keep, Duplicates and Big videos say how much space can be saved). ``viaTrash`` adds that the
 * space comes back when Trash is emptied (What to keep, Duplicates); Big videos frees it at once.
 */
import React from "react";
import { HardDriveDownload } from "lucide-react";
import { freesLabel } from "./dashFormat";

export const FreesPill: React.FC<{ bytes: number; viaTrash?: boolean }> = ({ bytes, viaTrash }) => {
  const label = freesLabel(bytes);
  if (!label) return null;
  return (
    <span
      className="dash-frees"
      title={viaTrash ? "What you don't keep goes to Trash; the space comes back when Trash is emptied, or after 30 days." : "Freed as soon as each video is done."}
    >
      <HardDriveDownload size={14} aria-hidden="true" />
      {label}
      {viaTrash && <span className="dash-frees-note"> after emptying Trash</span>}
    </span>
  );
};
