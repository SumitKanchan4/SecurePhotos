/**
 * Lightbox: the photo and video viewer (redesign R3).
 *
 * Dark surround in both themes so colours look true (the root forces the dark tokens);
 * only the details panel follows the app theme. Top bar: back, title with a small
 * quality chip and the date, then Favourite (Pin for documents), Download, Details,
 * and, set apart, Trash and the lime Move to Vault lock. Nothing sits on the photo
 * except the previous/next arrows; a filmstrip shows the neighbours.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Info,
  Loader2,
  Clock,
  Trash2,
  Download,
  Printer,
  Lock,
  Unlock,
  Pin,
  Play,
  Volume2,
  Volume1,
  VolumeX,
  Zap,
} from "lucide-react";
import { PhotoItem, OptimizationProgress, PhotoContext } from "../types";
import { useAppStore } from "../store/useAppStore";
import { apiFetch, getApiUrl, getThumbnailUrl } from "../services/api";
import {
  filmstripRange,
  formatTakenLine,
  qualityChip,
  viewerTitle,
} from "./viewer/viewerFormat";
import { ViewerDetails } from "./viewer/ViewerDetails";
import { useVolumeBooster } from "./viewer/useVolumeBooster";
import { useOldPhoto } from "./viewer/useOldPhoto";
import { BeforeAfter, ImproveMenu, ModelDialog, OldPhotoPanel, VersionSwitch } from "./viewer/OldPhotoPanel";

interface LightboxProps {
  photos: PhotoItem[];
  currentIndex: number;
  isOpen: boolean;
  optimizationProgress?: OptimizationProgress | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDelete?: (photoId: number) => void;
  onToggleFavorite?: (photoId: number) => void;
  onTogglePin?: (photoId: number) => void;
  onUnlockRequest?: (pendingAction?: () => void) => void;
  onVaultStatusChange?: (photoId: number, isEncrypted: boolean) => void;
  isDocumentView?: boolean;
  /** When `photos` is a window of a longer list: position of photos[0] in it, and its length. */
  indexOffset?: number;
  totalCount?: number;
  /** H10: an improved copy was kept (or an original replaced), so the lists should reload. */
  onLibraryChanged?: () => void;
}

export const Lightbox: React.FC<LightboxProps> = ({
  photos,
  currentIndex,
  isOpen,
  optimizationProgress,
  onClose,
  onNavigate,
  onDelete,
  onToggleFavorite,
  onTogglePin,
  indexOffset = 0,
  totalCount,
  onUnlockRequest,
  onVaultStatusChange,
  isDocumentView = false,
  onLibraryChanged,
}) => {
  const showToast = useAppStore((state) => state.showToast);
  const isVaultUnlocked = useAppStore((state) => state.isVaultUnlocked);
  const isVaultConfigured = useAppStore((state) => state.isVaultConfigured);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startPanX: 0, startPanY: 0 });
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const [showInfo, setShowInfo] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isPreviewLoaded, setIsPreviewLoaded] = useState(false);
  const [previewHasError, setPreviewHasError] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEnhancing4K, setIsEnhancing4K] = useState(false);
  const [videoVersion, setVideoVersion] = useState(0);
  const appTheme = useAppStore((state) => state.theme);
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const [context, setContext] = useState<PhotoContext | null>(null);
  const contextCache = useRef(new Map<number, PhotoContext>());

  const currentPhoto = photos[currentIndex];
  const isVideo = Boolean(currentPhoto?.mime_type?.startsWith("video/"));

  // VLC-style audio pre-amp (0% - 200%) for videos.
  const { volumeBoost, isMuted, showVolumeHud, volumeBoostRef, isMutedRef, videoElementRef, ensureAudioContext, connectVideoToPreamp, applyVolume, toggleMute } =
    useVolumeBooster();

  const isCompleted = Boolean(currentPhoto?.is_optimized || currentPhoto?.is_enhanced);
  const isOptimizingThis = Boolean(!isVideo && optimizationProgress?.is_active && optimizationProgress.active_photo_id === currentPhoto?.id);
  const isQueued = Boolean(!isVideo && optimizationProgress?.is_active && !currentPhoto?.is_optimized && !isOptimizingThis);

  const isVaultItem = Boolean(currentPhoto?.is_encrypted);
  const vaultStreamUrl = getApiUrl(`/api/vault/stream/${currentPhoto?.id}`);
  const previewUrl = isVaultItem 
    ? vaultStreamUrl 
    : getApiUrl(`/api/photos/${currentPhoto?.id}/preview`);
  const originalUrl = isVaultItem 
    ? vaultStreamUrl 
    : getApiUrl(`/api/photos/${currentPhoto?.id}/original${videoVersion > 0 ? `?v=${videoVersion}` : ""}`);
  const videoStreamUrl = isVaultItem
    ? vaultStreamUrl
    : getApiUrl(`/api/videos/${currentPhoto?.id}/stream${videoVersion > 0 ? `?v=${videoVersion}` : ""}`);
  const thumbnailUrl = isVaultItem 
    ? getApiUrl(`/api/vault/thumbnail/${currentPhoto?.id}`) 
    : getApiUrl(`/api/photos/${currentPhoto?.id}/thumbnail`);

  // Display the enhanced proxy if completed; otherwise display the unprocessed original
  const primaryImageUrl = isCompleted ? previewUrl : originalUrl;

  useEffect(() => {
    if (currentPhoto) {
      setIsFavorite(currentPhoto.is_favorite);
      setIsPinned(Boolean(currentPhoto.is_pinned));
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
      setIsDragging(false);
      setIsPreviewLoaded(false);
      setPreviewHasError(false);
      setIsCopied(false);
      setIsDownloadMenuOpen(false);
    }
  }, [currentIndex, currentPhoto?.id, currentPhoto?.is_pinned]);

  // People, albums and import date for the details panel (library photos only, loaded when shown).
  const contextPhotoId = currentPhoto && !currentPhoto.is_encrypted && !isDocumentView ? currentPhoto.id : null;
  // Details stay open while stepping through photos, but every new viewing starts with them hidden.
  useEffect(() => {
    if (!isOpen) setShowInfo(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) contextCache.current.clear();
    if (!isOpen || !showInfo || contextPhotoId === null) {
      setContext(null);
      return;
    }
    const cached = contextCache.current.get(contextPhotoId);
    if (cached) {
      setContext(cached);
      return;
    }
    let alive = true;
    setContext(null);
    apiFetch(`/api/photos/${contextPhotoId}/context`)
      .then(async (res) => {
        if (!res.ok) return;
        const data: PhotoContext = await res.json();
        contextCache.current.set(contextPhotoId, data);
        if (alive) setContext(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isOpen, showInfo, contextPhotoId]);

  // Keyboard navigation shortcuts. The listener is added once while the viewer is open and
  // always calls the latest handler: re-adding it on every render meant a key that caused a
  // re-render mid-event (Escape also clears the selection) never reached the viewer.
  keyHandlerRef.current = (e: KeyboardEvent) => {
    // A dialog on top of the viewer (e.g. "Keep the improved photo?") handles its own keys:
    // Escape closes only the dialog, and arrows never switch photos behind it.
    if (document.querySelector(".alb-dialog-backdrop, .danger-dialog-backdrop")) return;
    // Sliders, checkboxes and text fields keep their own keys (arrows move the strength slider).
    const target = e.target as HTMLElement | null;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) && e.key !== "Escape") return;
    if (e.key === "Escape") {
      if (isDownloadMenuOpen) setIsDownloadMenuOpen(false);
      else onClose();
    } else if (!isVideo && (e.key === "+" || e.key === "=")) {
      setZoom((z) => Math.min(z + 0.5, 4));
    } else if (!isVideo && e.key === "-") {
      handleZoomOut();
    } else if (!isVideo && e.key === "0") {
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    } else if ((e.key === "i" || e.key === "I") && !e.ctrlKey && !e.metaKey) {
      setShowInfo((prev) => !prev);
    } else if (e.key === "ArrowRight" || e.key === "j" || e.key === "J") {
      if (currentIndex < photos.length - 1) onNavigate(currentIndex + 1);
    } else if (e.key === "ArrowLeft" || e.key === "k" || e.key === "K") {
      if (currentIndex > 0) onNavigate(currentIndex - 1);
    } else if (e.key === "f" || e.key === "F" || ((e.key === "p" || e.key === "P") && isDocumentView)) {
      if (currentPhoto) {
        if (isDocumentView) {
          setIsPinned((prev) => !prev);
          onTogglePin?.(currentPhoto.id);
        } else {
          setIsFavorite((prev) => !prev);
          onToggleFavorite?.(currentPhoto.id);
        }
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      handleDelete();
    } else if (e.key === "l" || e.key === "L") {
      handleToggleVault();
    } else if (e.key === "i" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setShowInfo((prev) => !prev);
    } else if (isVideo && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const delta = e.key === "ArrowUp" ? 10 : -10;
      const current = isMutedRef.current ? 0 : volumeBoostRef.current;
      applyVolume(current + delta, false);
    } else if (isVideo && (e.key === "m" || e.key === "M")) {
      e.preventDefault();
      toggleMute();
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Window drag/pan listener when zoomed into photos
  useEffect(() => {
    if (!isOpen || !isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;
      const maxPan = (zoom - 1) * 450;
      setPanOffset({
        x: Math.max(-maxPan, Math.min(maxPan, dragStartRef.current.startPanX + deltaX)),
        y: Math.max(-maxPan, Math.min(maxPan, dragStartRef.current.startPanY + deltaY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isOpen, isDragging, zoom]);

  // H10: old-photo improvements for the open photo (nothing shows until the user asks).
  const old = useOldPhoto(currentPhoto, isOpen);

  if (!isOpen || !currentPhoto) return null;

  const handleZoomOut = () => {
    setZoom((z) => {
      const next = Math.max(z - 0.5, 1);
      if (next === 1) setPanOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const handleImageDoubleClick = () => {
    if (zoom > 1) {
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    } else {
      setZoom(2.5);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startPanX: panOffset.x,
      startPanY: panOffset.y,
    };
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || zoom > 1) {
      e.preventDefault();
      if (e.deltaY < 0) {
        setZoom((z) => Math.min(z + 0.25, 4));
      } else {
        setZoom((z) => {
          const next = Math.max(z - 0.25, 1);
          if (next === 1) setPanOffset({ x: 0, y: 0 });
          return next;
        });
      }
    }
  };

  const executeRestore = async (photoId: number) => {
    try {
      const res = await apiFetch("/api/vault/photos/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: [photoId] }),
      });
      if (res.ok) {
        showToast("Restored photo to public library.", "success");
        if (currentPhoto) currentPhoto.is_encrypted = false;
        onVaultStatusChange?.(photoId, false);
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.detail || "Failed to restore photo from vault.", "warning");
      }
    } catch (err) {
      console.error("Restore error:", err);
      showToast("Error updating vault status.", "warning");
    }
  };

  const executeLock = async (photoId: number) => {
    try {
      const res = await apiFetch("/api/vault/photos/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: [photoId] }),
      });
      if (res.ok) {
        showToast("Photo encrypted and moved into Private Vault.", "success");
        if (currentPhoto) currentPhoto.is_encrypted = true;
        onVaultStatusChange?.(photoId, true);
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.detail || "Failed to move photo into vault.", "warning");
      }
    } catch (err) {
      console.error("Lock error:", err);
      showToast("Error updating vault status.", "warning");
    }
  };

  const handleToggleVault = async () => {
    if (!currentPhoto) return;
    try {
      if (currentPhoto.is_encrypted) {
        if (!isVaultUnlocked) {
          if (onUnlockRequest) {
            onUnlockRequest(async () => {
              await executeRestore(currentPhoto.id);
            });
          } else {
            showToast("Please unlock your Vault before restoring items.", "warning");
          }
          return;
        }
        await executeRestore(currentPhoto.id);
      } else {
        if (!isVaultConfigured) {
          showToast("Please set up your Private Vault first.", "info");
          return;
        }
        if (!isVaultUnlocked) {
          if (onUnlockRequest) {
            onUnlockRequest(async () => {
              await executeLock(currentPhoto.id);
            });
          } else {
            showToast("Please unlock your Vault before moving items.", "warning");
          }
          return;
        }
        await executeLock(currentPhoto.id);
      }
    } catch (err) {
      console.error("Vault toggle error:", err);
      showToast("Error updating vault status.", "warning");
    }
  };

  const copyStoragePath = () => {
    navigator.clipboard.writeText(currentPhoto.filepath);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!currentPhoto || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await apiFetch(`/api/photos/${currentPhoto.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onDelete?.(currentPhoto.id);
      }
    } catch (err) {
      console.error("Failed to delete photo:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEnhanceVideo = async () => {
    try {
      setIsEnhancing4K(true);
      showToast("Enhancing this video to 4K. This can take a few minutes.", "info");
      const res = await apiFetch(`/api/videos/${currentPhoto.id}/enhance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_height: 2160 }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.already_enhanced) {
          showToast("This video is already at 4K UHD resolution.", "info");
        } else {
          showToast("✨ Enhanced video to 4K UHD successfully!", "success");
          // Update current photo in-place so UI badge immediately changes to 4K UHD
          if (currentPhoto) {
            currentPhoto.is_enhanced = true;
            currentPhoto.is_optimized = true;
            currentPhoto.height = data.height || 2160;
            currentPhoto.width = data.width || currentPhoto.width;
            if (data.file_size) currentPhoto.file_size = data.file_size;
          }
          // Invalidate video stream cache so player reloads the 4K stream
          setIsPreviewLoaded(false);
          setVideoVersion((v) => v + 1);
        }
      } else {
        showToast(data.error || "Video enhancement failed", "warning");
      }
    } catch {
      showToast("Failed to connect to video enhancement engine", "warning");
    } finally {
      setIsEnhancing4K(false);
    }
  };

  const handleDownload = (mode: "original" | "studio_print" = "original") => {
    if (!currentPhoto) return;
    const baseName = currentPhoto.filename ? currentPhoto.filename.replace(/\.[^/.]+$/, "") : "media";
    const defaultExt = isVideo ? ".mp4" : ".jpg";
    const filename = mode === "studio_print" ? `${baseName}_studio_300dpi.jpg` : (currentPhoto.filename || `media${defaultExt}`);
    const mediaTypeLabel = isVideo ? "video" : "photo";

    if (mode === "studio_print") {
      showToast(`🖨️ Downloading print-ready photo "${filename}" to your computer's Downloads folder...`, "info");
    } else {
      showToast(`📥 Downloading ${mediaTypeLabel} "${filename}" to your computer's Downloads folder...`, "info");
    }

    const downloadUrl = getApiUrl(`/api/photos/${currentPhoto.id}/download?mode=${mode}`);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const title = viewerTitle(currentPhoto);
  const chip = qualityChip(currentPhoto);
  const statusText = old.statusText
    ? old.statusText
    : isOptimizingThis
    ? `Enhancing to 8K · ${optimizationProgress?.item_progress ?? 0}%`
    : isQueued
    ? "Waiting to be enhanced"
    : null;
  const [filmStart, filmEnd] = filmstripRange(currentIndex, photos.length);
  const filmIndexes = photos.length > 1 ? Array.from({ length: filmEnd - filmStart + 1 }, (_, i) => filmStart + i) : [];
  // Opens the person's page or the album itself (R9c; it used to set a hidden search filter).
  const openInSection = (tab: "people" | "albums", id: number) => {
    const store = useAppStore.getState();
    if (tab === "people") store.openPerson(id);
    else store.openAlbum(id);
    onClose();
  };

  return (
    <div className="viewer" data-theme="dark" role="dialog" aria-modal="true" aria-label={`Viewing ${title}`}>
      <div className="viewer-main">
        <header className="viewer-bar">
          <button type="button" className="viewer-icon-btn" aria-label="Back" title="Back (Esc)" onClick={onClose}>
            <ChevronLeft size={18} strokeWidth={2.4} />
          </button>
          <div className="viewer-title-block">
            <div className="viewer-title-row">
              <h2 className="viewer-title" title={currentPhoto.filename}>{title}</h2>
              {chip && (
                <span className="viewer-chip" title={chip.title}>
                  {chip.label}
                </span>
              )}
            </div>
            <div className="viewer-subline">
              <span>{formatTakenLine(currentPhoto.taken_at)}</span>
              {photos.length > 1 || totalCount ? (
                <span className="viewer-count">
                  {(indexOffset + currentIndex + 1).toLocaleString()} of {(totalCount ?? photos.length).toLocaleString()}
                </span>
              ) : null}
              {statusText && (
                <span className="viewer-status">
                  {isOptimizingThis || old.statusText ? <Loader2 size={11} className="spin" /> : <Clock size={11} />}
                  {statusText}
                </span>
              )}
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <VersionSwitch
            old={old}
            currentId={currentPhoto.id}
            onOpen={(id) => {
              const index = photos.findIndex((p) => p.id === id);
              if (index >= 0) onNavigate(index);
              return index >= 0;
            }}
          />

          {zoom > 1 && (
            <button
              type="button"
              className="viewer-zoom-pill"
              title="Back to fit (0)"
              onClick={() => {
                setZoom(1);
                setPanOffset({ x: 0, y: 0 });
              }}
            >
              {Math.round(zoom * 100)}%
            </button>
          )}

          {isDocumentView ? (
            <button
              type="button"
              className={`viewer-icon-btn${isPinned ? " is-pinned" : ""}`}
              aria-label={isPinned ? "Unpin document" : "Pin document"}
              aria-pressed={isPinned}
              title={isPinned ? "Unpin (P)" : "Pin to the top (P)"}
              onClick={() => {
                setIsPinned(!isPinned);
                onTogglePin?.(currentPhoto.id);
              }}
            >
              <Pin size={17} fill={isPinned ? "currentColor" : "none"} />
            </button>
          ) : (
            <button
              type="button"
              className={`viewer-icon-btn${isFavorite ? " is-favourite" : ""}`}
              aria-label={isFavorite ? "Remove from favourites" : "Add to favourites"}
              aria-pressed={isFavorite}
              title={isFavorite ? "Remove from favourites (F)" : "Add to favourites (F)"}
              onClick={() => {
                setIsFavorite(!isFavorite);
                onToggleFavorite?.(currentPhoto.id);
              }}
            >
              <Heart size={17} fill={isFavorite ? "currentColor" : "none"} />
            </button>
          )}

          {!isDocumentView && !isVideo && <ImproveMenu old={old} />}

          <div className="viewer-menu-anchor">
            <button
              type="button"
              className={`viewer-icon-btn${isDownloadMenuOpen ? " is-on" : ""}`}
              aria-label="Download"
              aria-haspopup="menu"
              aria-expanded={isDownloadMenuOpen}
              title="Download"
              onClick={() => setIsDownloadMenuOpen((v) => !v)}
            >
              <Download size={17} />
            </button>
            {isDownloadMenuOpen && (
              <>
                <div className="viewer-menu-backdrop" onClick={() => setIsDownloadMenuOpen(false)} />
                <div className="viewer-menu" role="menu" aria-label="Download">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsDownloadMenuOpen(false);
                      handleDownload("original");
                    }}
                  >
                    <Download size={15} />
                    <span>
                      <strong>{isVideo ? "Video" : "Photo"}</strong>
                      <small>The file as it is in your library</small>
                    </span>
                  </button>
                  {!isVideo && !isVaultItem && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsDownloadMenuOpen(false);
                        handleDownload("studio_print");
                      }}
                    >
                      <Printer size={15} />
                      <span>
                        <strong>Print-ready copy</strong>
                        <small>300 dpi JPEG for prints and posters</small>
                      </span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            className={`viewer-icon-btn${showInfo ? " is-on" : ""}`}
            aria-label={showInfo ? "Hide details" : "Show details"}
            aria-pressed={showInfo}
            title="Details (I)"
            onClick={() => setShowInfo((v) => !v)}
          >
            <Info size={17} />
          </button>

          <div className="viewer-divider" />

          <button
            type="button"
            className="viewer-icon-btn viewer-trash"
            aria-label="Move to Trash"
            title="Move to Trash (Delete)"
            disabled={isDeleting}
            onClick={handleDelete}
          >
            {isDeleting ? <Loader2 size={17} className="spin" /> : <Trash2 size={17} />}
          </button>
          <button
            type="button"
            className={`viewer-icon-btn${isVaultItem ? "" : " viewer-vault"}`}
            aria-label={isVaultItem ? "Restore to library" : "Move to Vault"}
            title={isVaultItem ? "Restore to your library (L)" : "Move to Private Vault (L)"}
            onClick={handleToggleVault}
          >
            {isVaultItem ? <Unlock size={17} /> : <Lock size={17} strokeWidth={2.4} />}
          </button>
        </header>

        <div className="viewer-stage" onWheel={isVideo ? undefined : handleWheel}>
          {currentIndex > 0 && (
            <button type="button" className="viewer-nav viewer-nav-prev" aria-label="Previous photo" title="Previous (←)" onClick={() => onNavigate(currentIndex - 1)}>
              <ChevronLeft size={22} strokeWidth={2.4} />
            </button>
          )}
          {currentIndex < photos.length - 1 && (
            <button type="button" className="viewer-nav viewer-nav-next" aria-label="Next photo" title="Next (→)" onClick={() => onNavigate(currentIndex + 1)}>
              <ChevronRight size={22} strokeWidth={2.4} />
            </button>
          )}
          <div className="viewer-media">
            {/* Instant Thumbnail Low-Res Backdrop while High-Res Loads (Photos only) */}
            {!isVideo && !isVaultItem && !isPreviewLoaded && !previewHasError && (
              <img
                src={thumbnailUrl}
                alt={currentPhoto.filename}
                style={{
                  maxWidth: "92%",
                  maxHeight: "88%",
                  objectFit: "contain",
                  filter: "blur(8px)",
                  opacity: 0.6,
                  position: "absolute",
                }}
              />
            )}

            {/* If photo is encrypted and Vault is locked (or stream returned 401 error) */}
            {isVaultItem && (!isVaultUnlocked || previewHasError) ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "44px 36px",
                  borderRadius: "var(--radius-lg)",
                  backgroundColor: "var(--glass-surface)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  border: "1px solid var(--glass-border)",
                  boxShadow: "var(--glass-shadow)",
                  maxWidth: "460px",
                  textAlign: "center",
                  zIndex: 15,
                  animation: "fadeIn 0.2s ease",
                }}
              >
                <div
                  style={{
                    width: "68px",
                    height: "68px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--accent-ink) 30%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "20px",
                    color: "var(--accent-primary)",
                    boxShadow: "0 0 20px color-mix(in srgb, var(--accent-ink) 20%, transparent)",
                  }}
                >
                  <Lock size={32} />
                </div>
                <h3
                  style={{
                    fontSize: "20px",
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    color: "var(--text-primary)",
                    margin: "0 0 8px 0",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  Encrypted Private Asset
                </h3>
                <p
                  style={{
                    fontSize: "13px",
                    lineHeight: "1.5",
                    color: "var(--text-secondary)",
                    margin: "0 0 24px 0",
                  }}
                >
                  {!isVaultConfigured 
                    ? "This photo is encrypted on-device. Set up your Private Vault to authenticate and view or restore this asset."
                    : "This photo is protected by on-device encryption. Enter your PIN or Master Password to view or restore this photo."}
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isVaultConfigured) {
                        useAppStore.getState().setActiveTab("vault");
                        onClose();
                        return;
                      }
                      if (onUnlockRequest) {
                        onUnlockRequest();
                      } else {
                        showToast("Please open the Vault tab to unlock.", "info");
                      }
                    }}
                    className="clickable"
                    style={{
                      padding: "10px 22px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--accent-fill)",
                      border: "none",
                      color: "var(--on-accent)",
                      fontSize: "13px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "7px",
                      boxShadow: "0 4px 14px color-mix(in srgb, var(--accent-ink) 40%, transparent)",
                    }}
                  >
                    <Unlock size={15} />
                    <span>{!isVaultConfigured ? "Set Up Vault" : "Unlock Vault"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleVault}
                    className="clickable"
                    style={{
                      padding: "10px 20px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-pill-border)",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <span>Restore Photo</span>
                  </button>
                </div>
              </div>
            ) : currentPhoto.mime_type?.startsWith("video/") ? (
              <div
                style={{
                  position: "relative",
                  maxWidth: "94%",
                  maxHeight: "100%",
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                }}
              >
                {/* Temporary Volume HUD Pill Overlay */}
                {showVolumeHud && (
                  <div
                    style={{
                      position: "absolute",
                      top: "16px",
                      zIndex: 30,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "7px 16px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-surface)",
                      border: "1px solid var(--glass-border)",
                      backdropFilter: "blur(20px)",
                      WebkitBackdropFilter: "blur(20px)",
                      boxShadow: "var(--glass-shadow)",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      fontWeight: 700,
                      pointerEvents: "none",
                      animation: "fadeIn 0.15s ease",
                    }}
                  >
                    {isMuted || volumeBoost === 0 ? (
                      <VolumeX size={16} style={{ color: "var(--text-muted)" }} />
                    ) : volumeBoost > 100 ? (
                      <Zap size={16} style={{ color: "#fbbf24" }} />
                    ) : volumeBoost > 50 ? (
                      <Volume2 size={16} style={{ color: "var(--accent-primary)" }} />
                    ) : (
                      <Volume1 size={16} style={{ color: "var(--accent-primary)" }} />
                    )}
                    <span>
                      {isMuted ? "Audio Muted" : `Volume: ${volumeBoost}%`}
                    </span>
                    {volumeBoost > 100 && !isMuted && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: "#fbbf24",
                          backgroundColor: "rgba(251, 191, 36, 0.15)",
                          padding: "2px 6px",
                          borderRadius: "var(--radius-full)",
                          border: "1px solid rgba(251, 191, 36, 0.3)",
                        }}
                      >
                        ⚡ Boost Active
                      </span>
                    )}
                  </div>
                )}

                <video
                  key={`${currentPhoto.id}_${videoVersion}`}
                  ref={(el) => {
                    videoElementRef.current = el;
                    if (el) {
                      connectVideoToPreamp(el);
                    }
                  }}
                  src={videoStreamUrl}
                  poster={thumbnailUrl}
                  // CORS-enabled for the Web Audio preamp, *with* the engine's session
                  // cookie: "anonymous" sends no cookie, so the engine answered 403 (H6).
                  crossOrigin="use-credentials"
                  controls
                  playsInline
                  preload="auto"
                  autoPlay={false}
                  onPlay={() => {
                    ensureAudioContext();
                    if (videoElementRef.current) {
                      connectVideoToPreamp(videoElementRef.current);
                    }
                  }}
                  onLoadedMetadata={() => setIsPreviewLoaded(true)}
                  onLoadedData={() => setIsPreviewLoaded(true)}
                  onCanPlay={() => setIsPreviewLoaded(true)}
                  onError={(e) => {
                    const videoEl = e.currentTarget;
                    console.warn("Video stream error for photo", currentPhoto.id, videoEl.error);
                    setPreviewHasError(true);
                    setIsPreviewLoaded(true);
                  }}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "calc(100vh - 240px)",
                    borderRadius: "var(--radius-md)",
                    boxShadow: "var(--shadow-lightbox)",
                    backgroundColor: "#000000",
                    outline: "none",
                  }}
                />

                {/* Floating VLC-Style Audio Pre-Amp Booster Island */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    padding: "6px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-surface)",
                    border: "1px solid var(--glass-border)",
                    backdropFilter: "blur(24px)",
                    WebkitBackdropFilter: "blur(24px)",
                    boxShadow: "var(--glass-shadow)",
                    width: "100%",
                    maxWidth: "500px",
                    zIndex: 10,
                  }}
                >
                  {/* Mute / Unmute Button */}
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="clickable"
                    title={isMuted ? "Unmute (M)" : "Mute (M)"}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: isMuted ? "var(--text-muted)" : volumeBoost > 100 ? "#fbbf24" : "var(--accent-primary)",
                      display: "flex",
                      alignItems: "center",
                      cursor: "pointer",
                      padding: "4px",
                      borderRadius: "var(--radius-full)",
                      transition: "color 0.15s ease",
                    }}
                  >
                    {isMuted || volumeBoost === 0 ? (
                      <VolumeX size={17} />
                    ) : volumeBoost > 100 ? (
                      <Zap size={17} />
                    ) : volumeBoost > 50 ? (
                      <Volume2 size={17} />
                    ) : (
                      <Volume1 size={17} />
                    )}
                  </button>

                  {/* Range Slider (0 to 200%) */}
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      step={1}
                      value={isMuted ? 0 : volumeBoost}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        applyVolume(val, false);
                      }}
                      style={{
                        flex: 1,
                        cursor: "pointer",
                        accentColor: volumeBoost > 100 ? "#f59e0b" : "var(--accent-primary)",
                        height: "5px",
                      }}
                      title={`Audio Pre-Amp Gain: ${volumeBoost}% (Up to 200% VLC-style boost)`}
                    />
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        fontFamily: "var(--font-mono, monospace)",
                        minWidth: "38px",
                        textAlign: "right",
                        color: isMuted ? "var(--text-muted)" : volumeBoost > 100 ? "#fbbf24" : "var(--text-primary)",
                      }}
                    >
                      {isMuted ? "0%" : `${volumeBoost}%`}
                    </span>
                  </div>

                  {/* Preset Pills */}
                  <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    {[
                      { label: "100%", value: 100 },
                      { label: "150%", value: 150 },
                      { label: "200% ⚡", value: 200 },
                    ].map((preset) => {
                      const isActive = !isMuted && volumeBoost === preset.value;
                      return (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => applyVolume(preset.value, false)}
                          className="clickable"
                          title={`Set audio gain to ${preset.value}%`}
                          style={{
                            padding: "3px 8px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: isActive
                              ? (preset.value > 100 ? "rgba(251, 191, 36, 0.2)" : "color-mix(in srgb, var(--accent-ink) 20%, transparent)")
                              : "var(--glass-pill-bg)",
                            border: isActive
                              ? (preset.value > 100 ? "1px solid rgba(251, 191, 36, 0.5)" : "1px solid color-mix(in srgb, var(--accent-ink) 50%, transparent)")
                              : "1px solid var(--glass-border)",
                            color: isActive
                              ? (preset.value > 100 ? "#fbbf24" : "var(--accent-primary)")
                              : "var(--text-secondary)",
                            fontSize: "10px",
                            fontWeight: 700,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div
                onWheel={handleWheel}
                style={{
                  maxWidth: "94%",
                  maxHeight: "90%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <img
                  src={previewHasError ? thumbnailUrl : primaryImageUrl}
                  alt={currentPhoto.filename}
                  onLoad={() => setIsPreviewLoaded(true)}
                  onError={() => {
                    setPreviewHasError(true);
                    setIsPreviewLoaded(true);
                  }}
                  onMouseDown={handleMouseDown}
                  onDoubleClick={handleImageDoubleClick}
                  draggable={false}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "calc(100vh - 168px)",
                    objectFit: "contain",
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                    transition: isDragging ? "none" : zoom === 1 ? "transform 0.15s ease, opacity 0.25s ease" : "transform 0.08s ease-out",
                    opacity: isPreviewLoaded ? 1 : 0.4,
                    borderRadius: "10px",
                    cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default",
                    userSelect: "none",
                  }}
                />
              </div>
            )}

            {/* Loading Spinner */}
            {!isPreviewLoaded && (
              <div 
                style={{
                  position: "absolute",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 16px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-surface)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  backdropFilter: "blur(16px)",
                  WebkitBackdropFilter: "blur(16px)",
                  boxShadow: "var(--glass-shadow)",
                  pointerEvents: "none",
                }}
              >
                <Loader2 size={16} className="spin" style={{ color: "var(--accent-primary)" }} />
                {isVideo
                  ? (isCompleted ? "Loading High-Definition Video..." : "Loading Video...")
                  : (isCompleted ? "Loading Enhanced Photo..." : "Loading Original Photo...")}
              </div>
            )}

            {/* Video Load Error Overlay with Retry */}
            {isVideo && previewHasError && (
              <div 
                style={{
                  position: "absolute",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "8px",
                  padding: "20px 28px",
                  borderRadius: "var(--radius-lg)",
                  backgroundColor: "rgba(14, 16, 23, 0.92)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  boxShadow: "var(--glass-shadow)",
                  maxWidth: "380px",
                  textAlign: "center",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--accent-warning, #f59e0b)" }}>
                  Preparing Web Video
                </span>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  This video is being prepared for web streaming. Click below to refresh playback.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewHasError(false);
                    setIsPreviewLoaded(false);
                    setVideoVersion((v) => v + 1);
                  }}
                  className="clickable"
                  style={{
                    marginTop: "10px",
                    padding: "7px 18px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-fill)",
                    border: "none",
                    color: "var(--on-accent)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 2px 10px color-mix(in srgb, var(--accent-ink) 30%, transparent)",
                  }}
                >
                  Retry Playback
                </button>
              </div>
            )}
          </div>
          {old.reviewUrl && (
            <BeforeAfter
              before={primaryImageUrl}
              after={old.reviewUrl}
              intensity={old.intensity}
              faces={old.job?.faces}
              facesOff={old.facesOff}
              onToggleFace={old.toggleFace}
            />
          )}
        </div>

        {filmIndexes.length > 0 && (
          <nav className="viewer-film" aria-label="Nearby photos">
            {filmIndexes.map((i) => {
              const item = photos[i];
              const isCurrent = i === currentIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`viewer-film-item${isCurrent ? " is-current" : ""}`}
                  aria-label={`Open ${viewerTitle(item)}`}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => !isCurrent && onNavigate(i)}
                >
                  <img src={getThumbnailUrl(item.id, item.is_encrypted)} alt="" loading="lazy" draggable={false} />
                  {item.mime_type?.startsWith("video/") && (
                    <span className="viewer-film-play">
                      <Play size={9} fill="currentColor" />
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {old.panelOpen && (
        <OldPhotoPanel
          old={old}
          onError={(message) => showToast(message, "warning")}
          onKept={(choice) => {
            if (choice === "discard") return;
            onLibraryChanged?.();
            if (choice === "replace") {
              showToast("Replaced. The original is in Trash for 30 days.", "success");
              onClose();
            } else {
              showToast("Kept. The improved photo is next to the original.", "success");
            }
          }}
        />
      )}

      {old.modelPrompt && (
        <ModelDialog
          prompt={old.modelPrompt}
          progress={old.download}
          onDownload={() => void old.downloadModels()}
          onCancelDownload={() => void old.cancelDownload()}
          onClose={old.closeModelPrompt}
        />
      )}

      {showInfo && !old.panelOpen && (
        <ViewerDetails
          photo={currentPhoto}
          context={context}
          theme={appTheme}
          isVideo={isVideo}
          isVaultItem={isVaultItem}
          chipLabel={chip?.label}
          isEnhancing4K={isEnhancing4K}
          isCopied={isCopied}
          onClose={() => setShowInfo(false)}
          onDownloadPrint={() => handleDownload("studio_print")}
          onEnhanceVideo={handleEnhanceVideo}
          onCopyPath={copyStoragePath}
          onOpenPerson={(id) => openInSection("people", id)}
          onOpenAlbum={(id) => openInSection("albums", id)}
        />
      )}
    </div>
  );
};
