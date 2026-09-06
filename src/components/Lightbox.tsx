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
  Zap
} from "lucide-react";
import { PhotoItem } from "../types";

interface LightboxProps {
  photos: PhotoItem[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export const Lightbox: React.FC<LightboxProps> = ({
  photos,
  currentIndex,
  isOpen,
  onClose,
  onNavigate,
}) => {
  const [zoom, setZoom] = useState(1);
  const [showInfo, setShowInfo] = useState(false);
  const [showSplitSlider, setShowSplitSlider] = useState(false);
  const [splitPosition, setSplitPosition] = useState(50); // percentage 0 to 100
  const [isFavorite, setIsFavorite] = useState(false);
  const [isPreviewLoaded, setIsPreviewLoaded] = useState(false);
  const [previewHasError, setPreviewHasError] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isNeuralGenerating, setIsNeuralGenerating] = useState(false);
  const [neuralPreviewUrl, setNeuralPreviewUrl] = useState<string | null>(null);
  const [neuralStatusText, setNeuralStatusText] = useState<string | null>(null);

  const currentPhoto = photos[currentIndex];

  useEffect(() => {
    if (currentPhoto) {
      setIsFavorite(currentPhoto.is_favorite);
      setZoom(1);
      setShowSplitSlider(false);
      setIsPreviewLoaded(false);
      setPreviewHasError(false);
      setIsCopied(false);
      setIsNeuralGenerating(false);
      setNeuralStatusText(null);

      // Check if pre-computed neural preview exists
      fetch(`http://127.0.0.1:8000/api/photos/${currentPhoto.id}/neural-preview`, { method: "HEAD" })
        .then((r) => {
          if (r.ok) {
            setNeuralPreviewUrl(`http://127.0.0.1:8000/api/photos/${currentPhoto.id}/neural-preview`);
          } else {
            setNeuralPreviewUrl(null);
          }
        })
        .catch(() => setNeuralPreviewUrl(null));
    }
  }, [currentIndex, currentPhoto]);

  const handleRunNeuralEnhance = async () => {
    if (!currentPhoto || isNeuralGenerating) return;
    setIsNeuralGenerating(true);
    setNeuralStatusText("Synthesizing deep neural micro-textures (Real-ESRGAN)...");
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/photos/${currentPhoto.id}/neural-enhance`, {
        method: "POST",
      });
      if (res.ok) {
        setNeuralPreviewUrl(`http://127.0.0.1:8000/api/photos/${currentPhoto.id}/neural-preview?t=${Date.now()}`);
        setShowSplitSlider(true);
        setNeuralStatusText("Neural texture synthesis complete! Drag the slider to compare.");
        setTimeout(() => setNeuralStatusText(null), 4000);
      } else {
        const err = await res.json().catch(() => ({ detail: "Request failed" }));
        setNeuralStatusText(`Error: ${err.detail || "Failed to synthesize textures"}`);
        setTimeout(() => setNeuralStatusText(null), 5000);
      }
    } catch (e: any) {
      setNeuralStatusText(`Network error: ${e.message}`);
      setTimeout(() => setNeuralStatusText(null), 5000);
    } finally {
      setIsNeuralGenerating(false);
    }
  };

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
      } else if (e.key === "e" || e.key === "E") {
        setShowSplitSlider((prev) => !prev);
      } else if (e.key === "f" || e.key === "F") {
        setIsFavorite((prev) => !prev);
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

  const previewUrl = `http://127.0.0.1:8000/api/photos/${currentPhoto.id}/preview`;
  const thumbnailUrl = `http://127.0.0.1:8000/api/photos/${currentPhoto.id}/thumbnail`;

  const copyStoragePath = () => {
    navigator.clipboard.writeText(currentPhoto.filepath);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div 
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(5, 6, 10, 0.97)",
        backdropFilter: "blur(24px)",
        display: "flex",
        flexDirection: "column",
        zIndex: 3000,
        userSelect: "none",
      }}
    >
      {/* Lightbox Top Header Toolbar */}
      <div 
        style={{
          height: "50px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          backgroundColor: "rgba(14, 16, 23, 0.85)",
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
          {currentPhoto.is_enhanced && (
            <span 
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#ffffff",
                backgroundColor: "var(--accent-primary)",
                padding: "2px 6px",
                borderRadius: "var(--radius-xs)",
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
              }}
            >
              <Sparkles size={10} /> 8K ULTRA
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* 8K Split Slider Toggle Button */}
          <button
            onClick={() => setShowSplitSlider(!showSplitSlider)}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 10px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: showSplitSlider ? "var(--accent-primary)" : "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: showSplitSlider ? "#ffffff" : "var(--text-primary)",
              fontSize: "11px",
              fontWeight: 600,
            }}
          >
            <Sparkles size={13} />
            {showSplitSlider ? "Hide 8K Comparison" : "8K AI Comparison (E)"}
          </button>

          {/* Deep Texture Neural AI Button */}
          <button
            onClick={handleRunNeuralEnhance}
            disabled={isNeuralGenerating}
            className="clickable"
            title="Reconstruct realistic high-frequency micro-textures (hair, skin, fabric) via local Real-ESRGAN AI"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 10px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: neuralPreviewUrl ? "rgba(16, 185, 129, 0.2)" : "var(--bg-surface)",
              border: `1px solid ${neuralPreviewUrl ? "var(--accent-success)" : "var(--border-subtle)"}`,
              color: neuralPreviewUrl ? "var(--accent-success)" : "var(--text-primary)",
              fontSize: "11px",
              fontWeight: 600,
            }}
          >
            {isNeuralGenerating ? (
              <>
                <Loader2 size={13} className="spin" style={{ color: "var(--accent-primary)" }} />
                Synthesizing Textures...
              </>
            ) : neuralPreviewUrl ? (
              <>
                <Zap size={13} style={{ color: "var(--accent-success)" }} />
                Neural AI Active
              </>
            ) : (
              <>
                <Zap size={13} style={{ color: "var(--accent-primary)" }} />
                Deep Texture AI
              </>
            )}
          </button>

          {/* Zoom Controls */}
          <button 
            onClick={handleZoomOut} 
            disabled={zoom <= 1}
            className="clickable" 
            style={{ background: "transparent", border: "none", color: "var(--text-secondary)", padding: "4px" }}
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
            style={{ background: "transparent", border: "none", color: "var(--text-secondary)", padding: "4px" }}
          >
            <ZoomIn size={16} />
          </button>

          {/* Favorite Toggle */}
          <button
            onClick={() => setIsFavorite(!isFavorite)}
            className="clickable"
            style={{
              background: "transparent",
              border: "none",
              color: isFavorite ? "var(--accent-danger)" : "var(--text-secondary)",
              padding: "4px",
            }}
          >
            <Heart size={16} fill={isFavorite ? "var(--accent-danger)" : "none"} />
          </button>

          {/* EXIF Drawer Toggle */}
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="clickable"
            style={{
              background: showInfo ? "var(--accent-primary)" : "transparent",
              border: "none",
              color: showInfo ? "#ffffff" : "var(--text-secondary)",
              padding: "4px 8px",
              borderRadius: "var(--radius-xs)",
            }}
          >
            <Info size={16} />
          </button>

          {/* Close Lightbox */}
          <button
            onClick={onClose}
            className="clickable"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-primary)",
              padding: "4px",
              marginLeft: "8px",
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Viewport Container */}
      <div style={{ flex: 1, display: "flex", position: "relative", overflow: "hidden" }}>
        {/* Floating Neural AI Status Pill */}
        {neuralStatusText && (
          <div
            style={{
              position: "absolute",
              top: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "rgba(14, 16, 23, 0.95)",
              backdropFilter: "blur(12px)",
              border: "1px solid var(--accent-primary)",
              padding: "8px 18px",
              borderRadius: "var(--radius-full)",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              zIndex: 100,
              boxShadow: "0 4px 24px rgba(0,0,0,0.7)",
            }}
          >
            {isNeuralGenerating ? (
              <Loader2 size={14} className="spin" style={{ color: "var(--accent-primary)" }} />
            ) : (
              <Zap size={14} style={{ color: "var(--accent-success)" }} />
            )}
            <span>{neuralStatusText}</span>
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
              backgroundColor: "rgba(20, 23, 34, 0.75)",
              border: "1px solid var(--border-highlight)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 20,
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
              right: showInfo ? "320px" : "20px",
              top: "50%",
              transform: "translateY(-50%)",
              width: "44px",
              height: "44px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "rgba(20, 23, 34, 0.75)",
              border: "1px solid var(--border-highlight)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 20,
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
          {showSplitSlider ? (
            /* Interactive 4K AI Split Slider View */
            <div 
              style={{
                width: "92%",
                height: "90%",
                position: "relative",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                border: "1px solid var(--border-highlight)",
                backgroundColor: "#000000",
                cursor: "ew-resize",
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = ((e.clientX - rect.left) / rect.width) * 100;
                setSplitPosition(Math.max(5, Math.min(95, pos)));
              }}
            >
              {/* Left Side: Standard Image */}
              <img
                src={previewHasError ? thumbnailUrl : previewUrl}
                alt={currentPhoto.filename}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  filter: "brightness(0.95) contrast(0.95)",
                }}
              />
              <div 
                style={{
                  position: "absolute",
                  top: "16px",
                  left: "16px",
                  padding: "4px 10px",
                  borderRadius: "var(--radius-xs)",
                  backgroundColor: "rgba(0, 0, 0, 0.75)",
                  color: "#ffffff",
                  fontSize: "11px",
                  fontWeight: 600,
                  zIndex: 2,
                }}
              >
                Standard Preview
              </div>

              {/* Right Side: Enhanced 4K Clipped Layer */}
              <div 
                style={{
                  position: "absolute",
                  inset: 0,
                  clipPath: `polygon(${splitPosition}% 0, 100% 0, 100% 100%, ${splitPosition}% 100%)`,
                  overflow: "hidden",
                }}
              >
                <img
                  src={neuralPreviewUrl || (previewHasError ? thumbnailUrl : previewUrl)}
                  alt={currentPhoto.filename}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    filter: neuralPreviewUrl ? "none" : "contrast(1.08) saturate(1.05)",
                  }}
                />
                <div 
                  style={{
                    position: "absolute",
                    top: "16px",
                    right: "16px",
                    padding: "4px 10px",
                    borderRadius: "var(--radius-xs)",
                    backgroundColor: neuralPreviewUrl ? "rgba(16, 185, 129, 0.9)" : "rgba(59, 130, 246, 0.85)",
                    color: "#ffffff",
                    fontSize: "11px",
                    fontWeight: 700,
                    zIndex: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
                  }}
                >
                  {neuralPreviewUrl ? (
                    <>
                      <Zap size={12} /> Neural Texture AI (Real-ESRGAN)
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} /> 8K AI Enhanced
                    </>
                  )}
                </div>
              </div>

              {/* Split Line Divider */}
              <div 
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${splitPosition}%`,
                  width: "2px",
                  backgroundColor: "#ffffff",
                  boxShadow: "0 0 12px rgba(0,0,0,0.9)",
                  pointerEvents: "none",
                  zIndex: 5,
                }}
              >
                <div 
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: "30px",
                    height: "30px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-primary)",
                    border: "2px solid #ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ffffff",
                    fontSize: "10px",
                    fontWeight: 800,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
                  }}
                >
                  ⚡
                </div>
              </div>
            </div>
          ) : (
            /* Standard Lightbox Zoomable Media View with Real Image */
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
              {/* Instant Thumbnail Low-Res Backdrop while Preview Loads */}
              {!isPreviewLoaded && !previewHasError && (
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

              {/* High-Resolution Preview Image */}
              <img
                src={previewHasError ? thumbnailUrl : previewUrl}
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
                  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
                  cursor: zoom > 1 ? "grab" : "default",
                }}
              />

              {/* Loading Spinner */}
              {!isPreviewLoaded && (
                <div 
                  style={{
                    position: "absolute",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "rgba(0, 0, 0, 0.7)",
                    color: "#ffffff",
                    fontSize: "12px",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <Loader2 size={16} className="spin" style={{ color: "var(--accent-primary)" }} />
                  Loading 8K Preview...
                </div>
              )}
            </div>
          )}
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
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
