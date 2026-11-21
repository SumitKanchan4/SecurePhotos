/**
 * First run: an empty library (owner feedback 2026-11-19). The app's own icon instead of an empty
 * folder, plain words, one way in (Import), and what the app does for you, in the one accent
 * colour. Photos, videos or folders can also be dropped anywhere on it.
 *
 * Owner, 2026-11-21: no "Open a library folder" here. The app and its library live together on
 * the drive, so a new computer needs nothing; restoring a backup is in Settings → Storage.
 */
import React, { useState } from "react";
import { Lock, Plus, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";
import appIcon from "../assets/brand/app-icon.svg";

interface EmptyLibraryStateProps {
  onSelectFolder: () => void;
  onImportMedia?: () => void;
  onDropFiles?: (files: FileList) => void;
}

export const EmptyLibraryState: React.FC<EmptyLibraryStateProps> = ({ onSelectFolder, onImportMedia, onDropFiles }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const startImport = onImportMedia || onSelectFolder;

  return (
    <div
      className={`welcome${isDragOver ? " is-dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) onDropFiles?.(e.dataTransfer.files);
      }}
    >
      <div className="welcome-mark" aria-hidden="true">
        {isDragOver ? <UploadCloud size={44} /> : <img src={appIcon} alt="" draggable={false} />}
      </div>

      <h2 className="welcome-title">{isDragOver ? "Drop to import" : "Welcome to SecurePhotos"}</h2>
      <p className="welcome-text">
        Bring in your photos and videos to begin. They stay with SecurePhotos on your drive: nothing is uploaded, and the app works without the internet.
      </p>

      <div className="welcome-actions">
        <button type="button" className="welcome-primary" onClick={startImport}>
          <Plus size={17} strokeWidth={2.6} /> Import photos and videos
        </button>
      </div>
      <p className="welcome-hint">You can also drop photos and folders anywhere here.</p>

      <ul className="welcome-points" aria-label="What SecurePhotos does">
        <li>
          <ShieldCheck size={15} aria-hidden="true" /> Everything stays on your drive
        </li>
        <li>
          <Sparkles size={15} aria-hidden="true" /> Photos made sharper, old prints brought back
        </li>
        <li>
          <Lock size={15} aria-hidden="true" /> A locked vault for private photos
        </li>
      </ul>
    </div>
  );
};
