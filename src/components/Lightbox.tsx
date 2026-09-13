import React, { useState, useEffect } from "react";
import { 
  X, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  Heart, 
  Info, 
  ZoomIn, 
  ZoomOut, 
  Copy,
  Check,
  Loader2,
  Camera,
  MapPin,
  Aperture,
  ExternalLink,
  Clock,
  Trash2,
  Download,
  Printer,
  Film,
} from "lucide-react";
import { PhotoItem, OptimizationProgress } from "../types";
import { useAppStore } from "../store/useAppStore";

interface LightboxProps {
  photos: PhotoItem[];
  currentIndex: number;
  isOpen: boolean;
  optimizationProgress?: OptimizationProgress | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDelete?: (photoId: number) => void;
  onToggleFavorite?: (photoId: number) => void;
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
}) => {
  const showToast = useAppStore((state) => state.showToast);
  const [zoom, setZoom] = useState(1);
  const [showInfo, setShowInfo] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isPreviewLoaded, setIsPreviewLoaded] = useState(false);
  const [previewHasError, setPreviewHasError] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const currentPhoto = photos[currentIndex];
  const isVideo = Boolean(currentPhoto?.mime_type?.startsWith("video/"));

  const isCompleted = Boolean(currentPhoto?.is_optimized || currentPhoto?.is_enhanced);
  const isOptimizingThis = Boolean(!isVideo && optimizationProgress?.is_active && optimizationProgress.active_photo_id === currentPhoto?.id);
  const isQueued = Boolean(!isVideo && optimizationProgress?.is_active && !currentPhoto?.is_optimized && !isOptimizingThis);

  const previewUrl = `http://127.0.0.1:8000/api/photos/${currentPhoto?.id}/preview`;
  const originalUrl = `http://127.0.0.1:8000/api/photos/${currentPhoto?.id}/original`;
  const thumbnailUrl = `http://127.0.0.1:8000/api/photos/${currentPhoto?.id}/thumbnail`;

  // Display the enhanced proxy if completed; otherwise display the unprocessed original
  const primaryImageUrl = isCompleted ? previewUrl : originalUrl;

  useEffect(() => {
    if (currentPhoto) {
      setIsFavorite(currentPhoto.is_favorite);
      setZoom(1);
      setIsPreviewLoaded(false);
      setPreviewHasError(false);
      setIsCopied(false);
    }
  }, [currentIndex, currentPhoto?.id]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "j" || e.key === "J") {
        if (currentIndex < photos.length - 1) onNavigate(currentIndex + 1);
      } else if (e.key === "ArrowLeft" || e.key === "k" || e.key === "K") {
        if (currentIndex > 0) onNavigate(currentIndex - 1);
      } else if (e.key === "f" || e.key === "F") {
        if (currentPhoto) {
          setIsFavorite((prev) => !prev);
          onToggleFavorite?.(currentPhoto.id);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        handleDelete();
      } else if (e.key === "i" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setShowInfo((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentIndex, photos.length, onClose, onNavigate]);

  if (!isOpen || !currentPhoto) return null;

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.5, 4));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.5, 1));

  const copyStoragePath = () => {
    navigator.clipboard.writeText(currentPhoto.filepath);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!currentPhoto || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/photos/${currentPhoto.id}`, {
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

    const downloadUrl = `http://127.0.0.1:8000/api/photos/${currentPhoto.id}/download?mode=${mode}`;
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div 
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "var(--lightbox-backdrop)",
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        display: "flex",
        flexDirection: "column",
        zIndex: 3000,
        userSelect: "none",
      }}
    >
      {/* Lightbox Top Header Toolbar */}
      <div 
        style={{
          height: "52px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          backgroundColor: "var(--lightbox-toolbar-bg)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderBottom: "1px solid var(--border-subtle)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
            {currentPhoto.filename}
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {currentIndex + 1} of {photos.length}
          </span>
          {isVideo ? (() => {
            const isEnhanced = Boolean(currentPhoto.is_enhanced);
            const is4K = Boolean((currentPhoto.height && currentPhoto.height >= 2160) || (currentPhoto.width && currentPhoto.width >= 3840));
            const isHD = Boolean((currentPhoto.height && currentPhoto.height >= 720) || (currentPhoto.width && currentPhoto.width >= 1280));
            return (
              <span 
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: isEnhanced ? "#fbbf24" : "rgba(255, 255, 255, 0.9)",
                  backgroundColor: isEnhanced ? "rgba(251, 191, 36, 0.15)" : "rgba(255, 255, 255, 0.12)",
                  border: isEnhanced ? "1px solid rgba(251, 191, 36, 0.35)" : "1px solid var(--glass-border)",
                  padding: "2px 8px",
                  borderRadius: "var(--radius-full)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                {isEnhanced ? <Sparkles size={10} style={{ color: "#fbbf24" }} /> : <Film size={10} />}
                <span>{is4K ? "4K UHD" : isHD ? "HD" : "VIDEO"}</span>
              </span>
            );
          })() : currentPhoto.is_enhanced ? (
            <span 
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#fbbf24",
                backgroundColor: "rgba(251, 191, 36, 0.15)",
                border: "1px solid rgba(251, 191, 36, 0.35)",
                padding: "2px 8px",
                borderRadius: "var(--radius-full)",
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
              }}
            >
              <Sparkles size={10} style={{ color: "#fbbf24" }} /> 8K UHD
            </span>
          ) : null}
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Zoom Controls */}
          <button 
            onClick={handleZoomOut} 
            disabled={zoom <= 1}
            className="clickable" 
            style={{ background: "transparent", border: "none", color: "var(--text-primary)", padding: "4px", opacity: zoom <= 1 ? 0.4 : 1 }}
          >
            <ZoomOut size={16} />
          </button>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button 
            onClick={handleZoomIn} 
            disabled={zoom >= 4}
            className="clickable" 
            style={{ background: "transparent", border: "none", color: "var(--text-primary)", padding: "4px", opacity: zoom >= 4 ? 0.4 : 1 }}
          >
            <ZoomIn size={16} />
          </button>

          {/* Favorite Toggle */}
          <button
            onClick={() => {
              if (currentPhoto) {
                setIsFavorite(!isFavorite);
                onToggleFavorite?.(currentPhoto.id);
              }
            }}
            className="clickable"
            title={isFavorite ? "Remove from Favorites (F)" : "Add to Favorites (F)"}
            style={{
              background: isFavorite ? "rgba(239, 68, 68, 0.15)" : "var(--glass-pill-bg)",
              borderRadius: "var(--radius-full)",
              border: isFavorite ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid var(--glass-pill-border)",
              color: isFavorite ? "var(--accent-danger)" : "var(--text-primary)",
              padding: "4px 10px",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              cursor: "pointer",
            }}
          >
            <Heart size={15} fill={isFavorite ? "var(--accent-danger)" : "none"} />
            <span style={{ fontSize: "11px", fontWeight: 600 }}>{isFavorite ? "Liked" : "Like"}</span>
          </button>

          {/* Standard Download */}
          <button
            onClick={() => handleDownload("original")}
            className="clickable"
            title="Download image file to your computer"
            style={{
              background: "var(--glass-pill-bg)",
              borderRadius: "var(--radius-full)",
              border: "1px solid var(--glass-pill-border)",
              color: "var(--text-primary)",
              padding: "4px 10px",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              cursor: "pointer",
            }}
          >
            <Download size={14} />
            <span style={{ fontSize: "11px", fontWeight: 600 }}>Download</span>
          </button>

          {/* Studio Print Export Button (Photos Only) */}
          {!currentPhoto.mime_type?.startsWith("video/") && (
            <button
              onClick={() => handleDownload("studio_print")}
              className="clickable"
              title="Download print-ready photo for studio printing, posters, and framing"
              style={{
                background: "rgba(59, 130, 246, 0.12)",
                borderRadius: "var(--radius-full)",
                border: "1px solid rgba(59, 130, 246, 0.35)",
                color: "var(--accent-primary)",
                padding: "4px 12px",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                cursor: "pointer",
              }}
            >
              <Printer size={14} />
              <span style={{ fontSize: "11px", fontWeight: 600 }}>Print Ready</span>
            </button>
          )}

          {/* Delete / Move to Trash */}
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="clickable"
            title="Move to Trash (Delete / Backspace)"
            style={{
              background: "var(--glass-pill-bg)",
              borderRadius: "var(--radius-full)",
              border: "1px solid var(--glass-pill-border)",
              color: "var(--text-secondary)",
              padding: "5px 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-danger)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
          >
            {isDeleting ? (
              <Loader2 size={15} className="spin" style={{ color: "var(--accent-danger)" }} />
            ) : (
              <Trash2 size={15} />
            )}
          </button>

          {/* EXIF Drawer Toggle */}
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="clickable"
            style={{
              background: showInfo ? "var(--accent-primary)" : "var(--glass-pill-bg)",
              border: showInfo ? "1px solid var(--accent-primary)" : "1px solid var(--glass-pill-border)",
              color: showInfo ? "#ffffff" : "var(--text-primary)",
              padding: "5px 10px",
              borderRadius: "var(--radius-full)",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Info size={15} />
            <span style={{ fontSize: "11px", fontWeight: 600 }}>Info</span>
          </button>

          {/* Close Lightbox */}
          <button
            onClick={onClose}
            className="clickable"
            style={{
              background: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-pill-border)",
              borderRadius: "var(--radius-full)",
              color: "var(--text-primary)",
              padding: "5px",
              marginLeft: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main Viewport Container */}
      <div style={{ flex: 1, display: "flex", position: "relative", overflow: "hidden" }}>
        {/* Floating In-Progress / Queued Status Pill (Photos actively in optimization only) */}
        {!isVideo && (isOptimizingThis || isQueued) && (
          <div
            style={{
              position: "absolute",
              top: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "var(--glass-surface)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: isOptimizingThis ? "1px solid var(--accent-primary)" : "1px solid var(--glass-border)",
              padding: "8px 18px",
              borderRadius: "var(--radius-full)",
              color: "var(--text-primary)",
              fontSize: "12px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              zIndex: 100,
              boxShadow: "var(--glass-shadow)",
            }}
          >
            {isOptimizingThis ? (
              <>
                <Loader2 size={14} className="spin" style={{ color: "var(--accent-primary)" }} />
                <span>
                  Optimizing to 8K UHD ({optimizationProgress?.item_progress || 0}%) — Showing original photo
                </span>
              </>
            ) : (
              <>
                <Clock size={14} style={{ color: "var(--text-muted)" }} />
                <span>Queued for 8K UHD — Showing original photo</span>
              </>
            )}
          </div>
        )}

        {/* Navigation Arrows */}
        {currentIndex > 0 && (
          <button
            onClick={() => onNavigate(currentIndex - 1)}
            className="clickable"
            style={{
              position: "absolute",
              left: "20px",
              top: "50%",
              transform: "translateY(-50%)",
              width: "44px",
              height: "44px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--lightbox-nav-bg)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid var(--lightbox-nav-border)",
              color: "var(--lightbox-nav-color)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 20,
              boxShadow: "var(--glass-shadow)",
            }}
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {currentIndex < photos.length - 1 && (
          <button
            onClick={() => onNavigate(currentIndex + 1)}
            className="clickable"
            style={{
              position: "absolute",
              right: showInfo ? "360px" : "20px",
              top: "50%",
              transform: "translateY(-50%)",
              width: "44px",
              height: "44px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--lightbox-nav-bg)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid var(--lightbox-nav-border)",
              color: "var(--lightbox-nav-color)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 20,
              boxShadow: "var(--glass-shadow)",
              transition: "right 0.2s ease",
            }}
          >
            <ChevronRight size={24} />
          </button>
        )}

        {/* Image Rendering Area */}
        <div 
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Standard Lightbox Zoomable Media View with Real Image */}
          <div 
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            {/* Instant Thumbnail Low-Res Backdrop while High-Res Loads (Photos only) */}
            {!isVideo && !isPreviewLoaded && !previewHasError && (
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

            {/* High-Resolution Media Image or Interactive Video Player */}
            {currentPhoto.mime_type?.startsWith("video/") ? (
              <div
                style={{
                  position: "relative",
                  maxWidth: "94%",
                  maxHeight: "88vh",
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <video
                  key={currentPhoto.id}
                  src={originalUrl}
                  poster={thumbnailUrl}
                  controls
                  playsInline
                  preload="metadata"
                  autoPlay={false}
                  onLoadedData={() => setIsPreviewLoaded(true)}
                  onError={() => {
                    setPreviewHasError(true);
                    setIsPreviewLoaded(true);
                  }}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "84vh",
                    borderRadius: "var(--radius-md)",
                    boxShadow: "var(--shadow-lightbox)",
                    backgroundColor: "#000000",
                    outline: "none",
                  }}
                />
              </div>
            ) : (
              <img
                src={previewHasError ? thumbnailUrl : primaryImageUrl}
                alt={currentPhoto.filename}
                onLoad={() => setIsPreviewLoaded(true)}
                onError={() => {
                  setPreviewHasError(true);
                  setIsPreviewLoaded(true);
                }}
                style={{
                  maxWidth: "94%",
                  maxHeight: "90%",
                  objectFit: "contain",
                  transform: `scale(${zoom})`,
                  transition: zoom === 1 ? "transform 0.15s ease, opacity 0.25s ease" : "none",
                  opacity: isPreviewLoaded ? 1 : 0.4,
                  borderRadius: "var(--radius-sm)",
                  boxShadow: "var(--shadow-lightbox)",
                  cursor: zoom > 1 ? "grab" : "default",
                }}
              />
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
                }}
              >
                <Loader2 size={16} className="spin" style={{ color: "var(--accent-primary)" }} />
                {isVideo
                  ? (isCompleted ? "Loading High-Definition Video..." : "Loading Video...")
                  : (isCompleted ? "Loading Enhanced Photo..." : "Loading Original Photo...")}
              </div>
            )}

            {/* Video Load Error Overlay */}
            {isVideo && previewHasError && (
              <div 
                style={{
                  position: "absolute",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "8px",
                  padding: "16px 24px",
                  borderRadius: "var(--radius-lg)",
                  backgroundColor: "rgba(14, 16, 23, 0.9)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                  boxShadow: "var(--glass-shadow)",
                }}
              >
                <span style={{ fontWeight: 700, color: "var(--accent-warning, #f59e0b)" }}>
                  Video Unavailable
                </span>
                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  This video may still be processing in the background or the original file was moved.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Collapsible EXIF Metadata Drawer */}
        {showInfo && (
          <aside 
            style={{
              width: "340px",
              backgroundColor: "var(--bg-sidebar)",
              borderLeft: "1px solid var(--border-subtle)",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              overflowY: "auto",
              zIndex: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                <Info size={16} style={{ color: "var(--accent-primary)" }} />
                Media Details & EXIF
              </h3>
              <button
                onClick={() => setShowInfo(false)}
                className="clickable"
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", padding: "2px" }}
              >
                <X size={16} />
              </button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "12px" }}>
              {/* File & Dimension Card */}
              <div style={{ backgroundColor: "var(--bg-surface)", padding: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                <div style={{ marginBottom: "8px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "11px", display: "block", marginBottom: "2px" }}>Filename:</span>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)", wordBreak: "break-all" }}>
                    {currentPhoto.filename}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }}>
                  <div>
                    <span style={{ color: "var(--text-muted)", fontSize: "11px", display: "block" }}>Resolution:</span>
                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      {currentPhoto.width || "?"} × {currentPhoto.height || "?"}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-muted)", fontSize: "11px", display: "block" }}>File Size:</span>
                    <span style={{ fontWeight: 500, fontFamily: "var(--font-mono)" }}>
                      {(currentPhoto.file_size / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </div>
                </div>

                <div style={{ marginTop: "8px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "11px", display: "block" }}>Date Taken:</span>
                  <span style={{ fontWeight: 500 }}>
                    {currentPhoto.taken_at ? new Date(currentPhoto.taken_at).toLocaleString() : "Unknown"}
                  </span>
                </div>
              </div>

              {/* Camera & Optics Card */}
              <div style={{ backgroundColor: "var(--bg-surface)", padding: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", color: "var(--text-primary)", fontWeight: 600 }}>
                  <Camera size={14} style={{ color: "var(--accent-primary)" }} />
                  <span>Camera & Optics</span>
                </div>

                <div style={{ marginBottom: "8px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "11px", display: "block" }}>Device:</span>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                    {(() => {
                      const make = (currentPhoto.camera_make || "").trim();
                      const model = (currentPhoto.camera_model || "").trim();
                      if (!make && !model) return "Standard Camera";
                      if (!make) return model;
                      if (!model) return make;
                      if (model.toLowerCase().startsWith(make.toLowerCase())) return model;
                      return `${make} ${model}`;
                    })()}
                  </span>
                </div>

                {/* Optical Badges Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px", marginTop: "6px" }}>
                  {currentPhoto.aperture ? (
                    <div style={{ backgroundColor: "var(--bg-card)", padding: "6px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-subtle)" }}>
                      <span style={{ color: "var(--text-muted)", fontSize: "10px", display: "flex", alignItems: "center", gap: "3px" }}>
                        <Aperture size={10} style={{ color: "var(--accent-primary)" }} /> Aperture
                      </span>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>f/{currentPhoto.aperture.toFixed(1)}</span>
                    </div>
                  ) : null}

                  {currentPhoto.shutter_speed ? (
                    <div style={{ backgroundColor: "var(--bg-card)", padding: "6px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-subtle)" }}>
                      <span style={{ color: "var(--text-muted)", fontSize: "10px", display: "block" }}>Shutter</span>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{currentPhoto.shutter_speed}</span>
                    </div>
                  ) : null}

                  {currentPhoto.iso ? (
                    <div style={{ backgroundColor: "var(--bg-card)", padding: "6px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-subtle)" }}>
                      <span style={{ color: "var(--text-muted)", fontSize: "10px", display: "block" }}>ISO Speed</span>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>ISO {currentPhoto.iso}</span>
                    </div>
                  ) : null}

                  {currentPhoto.focal_length ? (
                    <div style={{ backgroundColor: "var(--bg-card)", padding: "6px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-subtle)" }}>
                      <span style={{ color: "var(--text-muted)", fontSize: "10px", display: "block" }}>Focal Length</span>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{currentPhoto.focal_length.toFixed(1)} mm</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Location & GPS Card */}
              {currentPhoto.latitude != null && currentPhoto.longitude != null && (
                <div style={{ backgroundColor: "var(--bg-surface)", padding: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-primary)", fontWeight: 600 }}>
                      <MapPin size={14} style={{ color: "var(--accent-primary)" }} />
                      <span>GPS Location</span>
                    </div>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${currentPhoto.latitude}&mlon=${currentPhoto.longitude}#map=16/${currentPhoto.latitude}/${currentPhoto.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="clickable"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        color: "var(--accent-primary)",
                        textDecoration: "none",
                        fontWeight: 600,
                      }}
                    >
                      Open Map <ExternalLink size={11} />
                    </a>
                  </div>

                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                    {currentPhoto.latitude.toFixed(4)}° {currentPhoto.latitude >= 0 ? "N" : "S"},{" "}
                    {currentPhoto.longitude.toFixed(4)}° {currentPhoto.longitude >= 0 ? "E" : "W"}
                  </div>
                </div>
              )}

              {/* Storage & Quality Card */}
              <div style={{ backgroundColor: "var(--bg-surface)", padding: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>Local Storage:</span>
                  <button
                    onClick={copyStoragePath}
                    className="clickable"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      background: "transparent",
                      border: "none",
                      color: isCopied ? "var(--accent-success)" : "var(--accent-primary)",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "2px 6px",
                      borderRadius: "var(--radius-xs)",
                    }}
                  >
                    {isCopied ? (
                      <>
                        <Check size={12} /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> Copy Path
                      </>
                    )}
                  </button>
                </div>
                <div 
                  style={{ 
                    fontFamily: "var(--font-mono)", 
                    fontSize: "10px", 
                    wordBreak: "break-all",
                    backgroundColor: "var(--bg-card)",
                    padding: "8px 10px",
                    borderRadius: "var(--radius-xs)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-secondary)",
                    lineHeight: "1.4",
                    marginBottom: "10px",
                  }}
                >
                  {currentPhoto.filepath}
                </div>

                <div>
                  <span style={{ color: "var(--text-muted)", fontSize: "11px", display: "block", marginBottom: "2px" }}>Optimization Tier:</span>
                  <span style={{ color: currentPhoto.is_optimized ? "var(--accent-success)" : "var(--accent-primary)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    {currentPhoto.is_optimized ? (
                      <>
                        <Sparkles size={12} /> 8K ULTRA Lossless (CRF 19)
                      </>
                    ) : (
                      "Original Camera Master"
                    )}
                  </span>
                </div>
              </div>

              {/* Studio Poster Print Readiness Card (Photos Only) OR Video Specifications & Quality Card (Videos) */}
              {!isVideo ? (
                (() => {
                  const w = currentPhoto.width || 0;
                  const h = currentPhoto.height || 0;
                  const dpi300W = w > 0 ? (w / 300).toFixed(1) : "0";
                  const dpi300H = h > 0 ? (h / 300).toFixed(1) : "0";
                  const dpi300Wcm = w > 0 ? ((w / 300) * 2.54).toFixed(0) : "0";
                  const dpi300Hcm = h > 0 ? ((h / 300) * 2.54).toFixed(0) : "0";

                  const dpi200W = w > 0 ? (w / 200).toFixed(1) : "0";
                  const dpi200H = h > 0 ? (h / 200).toFixed(1) : "0";
                  const dpi200Wcm = w > 0 ? ((w / 200) * 2.54).toFixed(0) : "0";
                  const dpi200Hcm = h > 0 ? ((h / 200) * 2.54).toFixed(0) : "0";

                  const maxDim = Math.max(w, h);
                  const isPosterReady = maxDim >= 4500;
                  const isMediumReady = maxDim >= 2400;

                  return (
                    <div style={{ backgroundColor: "var(--bg-surface)", padding: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-primary)", fontWeight: 600 }}>
                          <Printer size={14} style={{ color: "var(--accent-primary)" }} />
                          <span>Studio Print Readiness</span>
                        </div>
                        <span style={{ 
                          fontSize: "10px", 
                          fontWeight: 700, 
                          padding: "2px 6px", 
                          borderRadius: "var(--radius-xs)",
                          backgroundColor: isPosterReady ? "rgba(16, 185, 129, 0.15)" : isMediumReady ? "rgba(59, 130, 246, 0.15)" : "rgba(245, 158, 11, 0.15)",
                          color: isPosterReady ? "var(--accent-success)" : isMediumReady ? "var(--accent-primary)" : "var(--accent-warning)",
                          border: `1px solid ${isPosterReady ? "rgba(16, 185, 129, 0.4)" : isMediumReady ? "rgba(59, 130, 246, 0.4)" : "rgba(245, 158, 11, 0.4)"}`
                        }}>
                          {isPosterReady ? "✓ Studio Poster Ready" : isMediumReady ? "✓ Studio Photo Ready" : "Desk Print Ready"}
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
                        <div style={{ backgroundColor: "var(--bg-card)", padding: "6px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-subtle)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>300 DPI (Studio Glossy / Framing)</span>
                            <span style={{ color: "var(--accent-success)", fontWeight: 700 }}>Razor Sharp</span>
                          </div>
                          <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>
                            Max Crisp Size: <strong style={{ color: "var(--text-secondary)" }}>{dpi300W}" × {dpi300H}"</strong> ({dpi300Wcm} × {dpi300Hcm} cm)
                          </div>
                        </div>

                        <div style={{ backgroundColor: "var(--bg-card)", padding: "6px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-subtle)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>200 DPI (Wall Poster / Canvas)</span>
                            <span style={{ color: "var(--accent-primary)", fontWeight: 700 }}>Poster Grade</span>
                          </div>
                          <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>
                            Max Poster Size: <strong style={{ color: "var(--text-secondary)" }}>{dpi200W}" × {dpi200H}"</strong> ({dpi200Wcm} × {dpi200Hcm} cm)
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDownload("studio_print")}
                        className="clickable"
                        title="Download print-ready photo to your computer's Downloads folder"
                        style={{
                          width: "100%",
                          marginTop: "10px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          padding: "7px 10px",
                          borderRadius: "var(--radius-xs)",
                          backgroundColor: "var(--accent-primary)",
                          border: "none",
                          color: "#ffffff",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <Printer size={13} /> Download Print-Ready Photo
                      </button>
                    </div>
                  );
                })()
              ) : (
                (() => {
                  const w = currentPhoto.width || 0;
                  const h = currentPhoto.height || 0;
                  const isEnhanced = Boolean(currentPhoto.is_enhanced);
                  const is4K = isEnhanced && (h >= 2160 || w >= 3840);
                  const is1080p = h >= 1080 || w >= 1920;
                  const is720p = h >= 720 || w >= 1280;

                  const resolutionTier = is4K
                    ? "4K Ultra HD"
                    : is1080p
                    ? "1080p Full HD"
                    : is720p
                    ? "720p HD"
                    : w > 0 && h > 0
                    ? `${w} × ${h} SD`
                    : "Standard Definition";

                  const durationStr = currentPhoto.duration
                    ? `${Math.floor(currentPhoto.duration / 60)}m ${Math.floor(currentPhoto.duration % 60)}s`
                    : null;

                  return (
                    <div style={{ backgroundColor: "var(--bg-surface)", padding: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-primary)", fontWeight: 600 }}>
                          <Film size={14} style={{ color: isEnhanced ? "#fbbf24" : "var(--accent-primary)" }} />
                          <span>Video Playback & Quality</span>
                        </div>
                        <span style={{ 
                          fontSize: "10px", 
                          fontWeight: 700, 
                          padding: "2px 6px", 
                          borderRadius: "var(--radius-xs)",
                          backgroundColor: isEnhanced 
                            ? "rgba(251, 191, 36, 0.15)" 
                            : "rgba(59, 130, 246, 0.15)",
                          color: isEnhanced 
                            ? "#fbbf24" 
                            : "var(--accent-primary)",
                          border: `1px solid ${isEnhanced ? "rgba(251, 191, 36, 0.4)" : "rgba(59, 130, 246, 0.4)"}`,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px"
                        }}>
                          {isEnhanced && <Sparkles size={9} style={{ color: "#fbbf24" }} />}
                          {isEnhanced ? (is4K ? "4K UHD" : "HD") : (is4K ? "4K UHD" : (currentPhoto.height && currentPhoto.height >= 720 ? "HD" : "Original Video"))}
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
                        <div style={{ backgroundColor: "var(--bg-card)", padding: "6px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-subtle)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>Resolution & Tier</span>
                            <span style={{ color: isEnhanced ? "#fbbf24" : "var(--accent-primary)", fontWeight: 700 }}>
                              {resolutionTier}
                            </span>
                          </div>
                          <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>
                            Dimensions: <strong style={{ color: "var(--text-secondary)" }}>{w > 0 && h > 0 ? `${w} × ${h} px` : "Native stream"}</strong>
                          </div>
                        </div>

                        {durationStr && (
                          <div style={{ backgroundColor: "var(--bg-card)", padding: "6px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-subtle)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>Total Duration</span>
                              <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>{durationStr}</span>
                            </div>
                            <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>
                              Frame Timing: <strong style={{ color: "var(--text-secondary)" }}>Full playback available</strong>
                            </div>
                          </div>
                        )}
                      </div>

                      {!is4K && (
                        <button
                          onClick={async () => {
                            try {
                              showToast("Starting background enhancement to 4K UHD...", "info");
                              const res = await fetch(`http://127.0.0.1:8000/api/videos/${currentPhoto.id}/enhance`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ target_height: 2160 }),
                              });
                              const data = await res.json();
                              if (res.ok && data.success) {
                                showToast("Enhanced video to 4K UHD successfully!", "success");
                              } else {
                                showToast(data.error || "Video enhancement failed", "warning");
                              }
                            } catch {
                              showToast("Failed to connect to video enhancement engine", "warning");
                            }
                          }}
                          className="clickable"
                          title="Upscale video to 4K UHD with Lanczos & 3D temporal denoising"
                          style={{
                            width: "100%",
                            marginTop: "10px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            padding: "7px 10px",
                            borderRadius: "var(--radius-xs)",
                            backgroundColor: "rgba(251, 191, 36, 0.15)",
                            border: "1px solid rgba(251, 191, 36, 0.4)",
                            color: "#fbbf24",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          <Sparkles size={13} style={{ color: "#fbbf24" }} /> Enhance to 4K UHD
                        </button>
                      )}

                      <button
                        onClick={() => handleDownload("original")}
                        className="clickable"
                        title="Save video file to your computer's Downloads folder"
                        style={{
                          width: "100%",
                          marginTop: "8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          padding: "7px 10px",
                          borderRadius: "var(--radius-xs)",
                          backgroundColor: isEnhanced ? "#d97706" : "var(--accent-primary)",
                          border: "none",
                          color: "#ffffff",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <Download size={13} /> Save Video to Downloads
                      </button>
                    </div>
                  );
                })()
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
