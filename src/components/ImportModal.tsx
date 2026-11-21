/**
 * ImportModal: "Bring photos in" (redesign R6).
 *
 * Two states. Before: a drop area with Choose files / Choose a folder, then a card for the
 * selection ("Goa trip · 48 photos, 3 videos (2.1 GB) · 4 are already in your library") and a
 * "Remove the originals after importing" switch that is off by default. While importing: "Copying 29 of 47 ·
 * about 1 min left", Stop import and Hide. Hiding keeps the import going (the Photos header shows
 * its progress, the result still appears when it ends), and reopening the dialog reconnects to it.
 */
import React, { useEffect, useRef, useState } from "react";
import { FolderOpen, Images, Loader2, UploadCloud, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";
import { apiFetch } from "../services/api";
import {
  contentsLine,
  duplicatesLine,
  importButtonLabel,
  ImportPreview,
  ImportResult,
  largeImportNote,
  resultMessage,
  vaultButtonLabel,
  vaultResultMessage,
  timeLeft,
} from "./import/importFormat";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
  /** Owner, 2026-11-21: straight into the private vault. Each photo is encrypted as it is copied,
   *  and "Remove the originals" starts from Settings → Vault (on by default). */
  intoVault?: boolean;
}

interface Progress {
  is_active: boolean;
  total_count: number;
  completed_count: number;
  started_at: number | null;
  cancel_requested?: boolean;
}

/** A single dropped item without an extension is treated as a folder. */
export function selectionFromPaths(paths: string[]): { folder: string | null; files: string[] } {
  if (paths.length === 1 && !/\.[a-zA-Z0-9]+$/.test(paths[0])) return { folder: paths[0], files: [] };
  return { folder: null, files: paths };
}

/**
 * After-import P4 ("Add more", owner feedback): a new choice adds to what is already chosen
 * instead of replacing it. One folder alone stays a folder; anything more is sent as one list
 * (the engine walks the folders in it and counts a file picked twice once).
 */
export function addToSelection(
  current: { folder: string | null; files: string[] },
  paths: string[],
): { folder: string | null; files: string[] } {
  const all = [...(current.folder ? [current.folder] : []), ...current.files, ...paths];
  const seen = new Set<string>();
  const unique = all.filter((p) => {
    const key = p.replace(/[\\/]+$/, "").toLowerCase(); // Windows paths: case and a trailing slash don't matter.
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length === 1 ? selectionFromPaths(unique) : { folder: null, files: unique };
}

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onImportComplete, intoVault = false }) => {
  const showToast = useAppStore((s) => s.showToast);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [moveOriginals, setMoveOriginals] = useState(false);
  // Into the vault, the switch starts from Settings → Vault (on unless turned off there).
  useEffect(() => {
    if (!isOpen || !intoVault) return;
    apiFetch("/api/system/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const value = data?.settings?.vault_import_remove_originals;
        if (typeof value === "boolean") setMoveOriginals(value);
      })
      .catch(() => {});
  }, [isOpen, intoVault]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // True while this dialog's own import request is running (its result comes from that request).
  const ownsImport = useRef(false);

  const importing = Boolean(progress?.is_active);
  const hasSelection = selectedFiles.length > 0 || selectedFolder !== null;

  // Fresh dialog each time; if an import is already running, show it.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedFiles([]);
    setSelectedFolder(null);
    setMoveOriginals(intoVault); // the vault's Settings value follows (effect above)
    setPreview(null);
    setPreviewState("idle");
    setIsStopping(false);
    apiFetch("/api/photos/import-progress")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Progress | null) => setProgress(data?.is_active ? data : null))
      .catch(() => {});
  }, [isOpen]);

  // While importing: follow progress; when an import started elsewhere ends, close.
  useEffect(() => {
    if (!isOpen || !importing) return;
    const timer = setInterval(async () => {
      setNowSec(Date.now() / 1000);
      try {
        const res = await apiFetch("/api/photos/import-progress");
        if (!res.ok) return;
        const data: Progress = await res.json();
        if (data.is_active) setProgress(data);
        else if (!ownsImport.current) {
          // An import started earlier finished; its own request shows the result.
          setProgress(null);
          onClose();
        }
      } catch {
        /* keep the last known progress */
      }
    }, 500);
    return () => clearInterval(timer);
  }, [isOpen, importing, onClose]);

  // What the selection holds.
  useEffect(() => {
    if (!isOpen || !hasSelection) return;
    let alive = true;
    setPreview(null);
    setPreviewState("loading");
    apiFetch("/api/photos/import-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selectedFolder ? { source_directory: selectedFolder } : { file_paths: selectedFiles }),
    })
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setPreview(await res.json());
        setPreviewState("idle");
      })
      .catch(() => alive && setPreviewState("error"));
    return () => {
      alive = false;
    };
  }, [isOpen, hasSelection, selectedFolder, selectedFiles]);

  // Escape: hide while importing (the import keeps going), otherwise close.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isBrowsing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isBrowsing, onClose]);

  // Native drag and drop (full file-system paths).
  useEffect(() => {
    if (!isOpen) return;
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "over") setIsDragging(true);
          else if (event.payload.type === "drop") {
            setIsDragging(false);
            if (event.payload.paths?.length) applyPaths(event.payload.paths);
          } else setIsDragging(false);
        }),
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* browser preview: no native drag and drop */
      });
    return () => unlisten?.();
  }, [isOpen]);

  if (!isOpen) return null;

  function applyPaths(paths: string[]) {
    const next = addToSelection({ folder: selectedFolder, files: selectedFiles }, paths);
    setSelectedFolder(next.folder);
    setSelectedFiles(next.files);
  }

  const chooseFiles = async () => {
    if (isBrowsing) return;
    setIsBrowsing(true);
    try {
      const files = await invoke<string[] | null>("select_import_files");
      if (files?.length) applyPaths(files);
    } catch {
      fileInputRef.current?.click();
    } finally {
      setIsBrowsing(false);
    }
  };

  const chooseFolder = async () => {
    if (isBrowsing) return;
    setIsBrowsing(true);
    try {
      const folder = await invoke<string | null>("select_import_folder");
      if (folder) applyPaths([folder]);
    } catch {
      showToast("The folder picker isn't available here.", "warning");
    } finally {
      setIsBrowsing(false);
    }
  };

  const pathsFromFileList = (files: FileList | null): string[] =>
    Array.from(files ?? [])
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => Boolean(p));

  const startImport = async () => {
    if (!hasSelection || !preview || (intoVault ? preview.to_import + preview.already_in_library : preview.to_import) === 0) return;
    setProgress({ is_active: true, total_count: preview.to_import + preview.already_in_library, completed_count: 0, started_at: null });
    ownsImport.current = true;
    try {
      const res = await apiFetch("/api/photos/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(selectedFolder ? { source_directory: selectedFolder } : { file_paths: selectedFiles }),
          mode: "managed",
          delete_source: moveOriginals,
          ...(intoVault ? { into_vault: true } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.detail || "The import didn't start. Please try again.", "warning");
        setProgress(null);
        return;
      }
      // This still runs after Hide: the result is shown and the library refreshed either way.
      const result = (await res.json()) as ImportResult;
      const message = intoVault ? vaultResultMessage(result) : resultMessage(result);
      showToast(message.text, message.tone);
      onImportComplete?.();
      setProgress(null);
      onClose();
    } catch {
      showToast("The import was interrupted. Photos already added are safe.", "warning");
      setProgress(null);
    } finally {
      ownsImport.current = false;
    }
  };

  const stopImport = async () => {
    setIsStopping(true);
    try {
      await apiFetch("/api/photos/import/cancel", { method: "POST" });
    } catch {
      setIsStopping(false);
    }
  };

  const verb = intoVault ? "Adding" : moveOriginals ? "Moving" : "Copying";
  const eta = progress ? timeLeft(progress.completed_count, progress.total_count, progress.started_at, nowSec) : null;
  const percent = progress && progress.total_count > 0 ? Math.round((progress.completed_count / progress.total_count) * 100) : 0;

  return (
    <div
      className="import-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isBrowsing) onClose();
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const paths = pathsFromFileList(e.target.files);
          if (paths.length) applyPaths(paths);
          else showToast("Restart the app to use the file picker.", "warning");
        }}
      />
      <div className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="import-head">
          <h2 id="import-title">{intoVault ? "Add to your vault" : "Bring photos in"}</h2>
          <button type="button" className="import-close" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {importing && progress ? (
          <div className="import-progress" role="status" aria-live="polite">
            <div className="import-progress-line">
              <span>
                {isStopping || progress.cancel_requested
                  ? "Stopping after this file…"
                  : `${verb} ${progress.completed_count.toLocaleString()} of ${progress.total_count.toLocaleString()}`}
              </span>
              {eta && !isStopping && <span className="import-muted">{eta}</span>}
            </div>
            <div className="import-bar" aria-hidden="true">
              <div style={{ width: `${percent}%` }} />
            </div>
            <p className="import-muted">You can close this window and keep using the app.</p>
            <div className="import-actions">
              <button type="button" className="import-ghost" disabled={isStopping || progress.cancel_requested} onClick={stopImport}>
                Stop import
              </button>
              <button type="button" className="import-secondary" onClick={onClose}>
                Hide
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`import-drop${isDragging ? " is-dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const paths = pathsFromFileList(e.dataTransfer.files);
                if (paths.length) applyPaths(paths);
              }}
            >
              <UploadCloud size={26} />
              <p>Drop photos, videos or folders here</p>
              <div className="import-drop-buttons">
                <button type="button" className="import-secondary" onClick={chooseFiles} disabled={isBrowsing}>
                  <Images size={15} /> {hasSelection ? "Add files" : "Choose files"}
                </button>
                <button type="button" className="import-secondary" onClick={chooseFolder} disabled={isBrowsing}>
                  <FolderOpen size={15} /> {hasSelection ? "Add a folder" : "Choose a folder"}
                </button>
              </div>
            </div>

            {hasSelection && (
              <div className="import-selection">
                <div className="import-selection-text">
                  <span className="import-label">
                    {selectedFolder ? "Selected folder" : preview?.is_folder ? "Selected places" : "Selected files"}
                  </span>
                  {previewState === "loading" ? (
                    <strong className="import-counting">
                      <Loader2 size={14} className="spin" /> Counting…
                    </strong>
                  ) : previewState === "error" || !preview ? (
                    <strong>That location couldn't be read. Choose another.</strong>
                  ) : (
                    <>
                      <strong>
                        {preview.name} · {contentsLine(preview)}
                      </strong>
                      {duplicatesLine(preview) && <span className="import-muted">{duplicatesLine(preview)}</span>}
                      {largeImportNote(preview) && <span className="import-muted">{largeImportNote(preview)}</span>}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="import-link"
                  onClick={() => {
                    setSelectedFiles([]);
                    setSelectedFolder(null);
                    setPreview(null);
                    setPreviewState("idle");
                  }}
                >
                  Clear
                </button>
              </div>
            )}

            <label className="import-switch-row">
              <span className="import-switch-text">
                {/* Owner feedback 2026-11-19: say what the switch does when it's on, in plain words. */}
                <strong>Remove the originals after importing</strong>
                <span className="import-muted">
                  {intoVault
                    ? moveOriginals
                      ? "Each photo is removed from where it was once its locked copy in the vault has been checked. If a copy fails, the original is kept."
                      : "Your photos also stay where they are now, where anyone using this computer can see them."
                    : moveOriginals
                    ? "Each photo is removed from where it was once its copy in your library has been checked. If a copy fails, the original is kept."
                    : "Your photos stay where they are now; the library keeps its own copy."}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={moveOriginals}
                aria-label="Remove the originals after importing"
                className={`import-switch${moveOriginals ? " is-on" : ""}`}
                onClick={() => setMoveOriginals((v) => !v)}
              >
                <span />
              </button>
            </label>

            <div className="import-actions">
              <button type="button" className="import-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="import-primary"
                disabled={!preview || (intoVault ? preview.to_import + preview.already_in_library : preview.to_import) === 0 || previewState !== "idle"}
                onClick={startImport}
              >
                {intoVault ? (hasSelection ? vaultButtonLabel(preview) : "Add to vault") : hasSelection ? importButtonLabel(preview) : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
