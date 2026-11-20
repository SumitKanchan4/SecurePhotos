/**
 * First run: an empty library (owner feedback 2026-11-19). The app's own icon instead of an empty
 * folder, plain words, one way in (Import) and one way back to a library you already have (the
 * same wording as Settings → Storage), and what the app does for you, in the one accent colour.
 * Photos, videos or folders can also be dropped anywhere on it.
 */
import React, { useState } from "react";
import { FolderOpen, Lock, Plus, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import appIcon from "../assets/brand/app-icon.svg";

interface EmptyLibraryStateProps {
  onSelectFolder: () => void;
  onImportMedia?: () => void;
  onDropFiles?: (files: FileList) => void;
}

export const EmptyLibraryState: React.FC<EmptyLibraryStateProps> = ({ onSelectFolder, onImportMedia, onDropFiles }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const startImport = onImportMedia || onSelectFolder;

  const openLibrary = async () => {
    setOpenError(null);
    setIsOpening(true);
    try {
      const selected = await invoke<string | null>("select_import_folder");
      if (!selected) {
        setIsOpening(false);
        return;
      }
      await invoke("reconnect_library", { newPath: selected });
      window.location.reload();
    } catch (err: unknown) {
      const message = typeof err === "string" ? err : (err as Error)?.message;
      setOpenError(message || "That folder couldn't be opened as a library.");
      setIsOpening(false);
    }
  };

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
        Bring in your photos and videos to begin. They stay on this computer: nothing is uploaded, and the app works without the internet.
      </p>

      <div className="welcome-actions">
        <button type="button" className="welcome-primary" onClick={startImport}>
          <Plus size={17} strokeWidth={2.6} /> Import photos and videos
        </button>
        <button type="button" className="welcome-secondary" onClick={openLibrary} disabled={isOpening}>
          <FolderOpen size={16} /> {isOpening ? "Opening…" : "Open a library folder"}
        </button>
      </div>
      <p className="welcome-hint">Moved to a new computer, or restoring a backup? Open the library folder you copied.<br />You can also drop photos and folders anywhere here.</p>
      {openError && (
        <p className="welcome-error" role="alert">
          {openError}
        </p>
      )}

      <ul className="welcome-points" aria-label="What SecurePhotos does">
        <li>
          <ShieldCheck size={15} aria-hidden="true" /> Everything stays on this computer
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
