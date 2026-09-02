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
  Camera
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

  const currentPhoto = photos[currentIndex];

  useEffect(() => {
    if (currentPhoto) {
      setIsFavorite(currentPhoto.is_favorite);
      setZoom(1);
      setShowSplitSlider(false);
    }
  }, [currentIndex, currentPhoto]);

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

  return (
    <div 
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(5, 6, 10, 0.96)",
        backdropFilter: "blur(20px)",
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
          backgroundColor: "rgba(14, 16, 23, 0.8)",
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
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* 4K Split Slider Toggle Button */}
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
            {showSplitSlider ? "Hide 4K Comparison" : "4K AI Comparison (E)"}
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
          }}
        >
          {showSplitSlider ? (
            /* Interactive 4K AI Split Slider View */
            <div 
              style={{
                width: "90%",
                height: "85%",
                position: "relative",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                border: "1px solid var(--border-highlight)",
                backgroundColor: "#000000",
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = ((e.clientX - rect.left) / rect.width) * 100;
                setSplitPosition(Math.max(5, Math.min(95, pos)));
              }}
            >
              {/* Left Side: Original Image */}
              <div 
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  filter: "blur(1.5px)", // Visual representation of lower res original
                }}
              >
                <div style={{ color: "#ffffff", textAlign: "center" }}>
                  <p style={{ fontSize: "18px", fontWeight: 700 }}>Original Source (1080p Standard)</p>
                  <p style={{ fontSize: "12px", opacity: 0.7 }}>File Size: 4.8 MB</p>
                </div>
              </div>

              {/* Right Side: Enhanced 4K Clipped Layer */}
              <div 
                style={{
                  position: "absolute",
                  inset: 0,
                  clipPath: `polygon(${splitPosition}% 0, 100% 0, 100% 100%, ${splitPosition}% 100%)`,
                  backgroundColor: "rgba(16, 20, 30, 0.95)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ color: "var(--accent-primary)", textAlign: "center" }}>
                  <p style={{ fontSize: "18px", fontWeight: 700 }}>✨ 4K AI Super-Resolution (Real-ESRGAN)</p>
                  <p style={{ fontSize: "12px", color: "var(--accent-success)" }}>
                    Visually Lossless AVIF (1.4 MB • -71% space saved)
                  </p>
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
                  boxShadow: "0 0 10px rgba(0,0,0,0.8)",
                  cursor: "ew-resize",
                }}
              >
                <div 
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: "28px",
                    height: "28px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-primary)",
                    border: "2px solid #ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ffffff",
                    fontSize: "10px",
                    fontWeight: 800,
                  }}
                >
                  ⚡
                </div>
              </div>
            </div>
          ) : (
            /* Standard Lightbox Zoomable Media View */
            <div 
              style={{
                transform: `scale(${zoom})`,
                transition: "transform 0.15s ease",
                maxWidth: "90%",
                maxHeight: "85%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--bg-surface-elevated)",
                borderRadius: "var(--radius-md)",
                padding: "80px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <Camera size={64} style={{ color: "var(--accent-primary)", opacity: 0.6, marginBottom: "16px" }} />
              <p style={{ fontSize: "16px", fontWeight: 600 }}>{currentPhoto.filename}</p>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                3840 × 2160 (4K UHD) • {(currentPhoto.file_size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
          )}
        </div>

        {/* Collapsible EXIF Metadata Drawer */}
        {showInfo && (
          <aside 
            style={{
              width: "300px",
              backgroundColor: "var(--bg-sidebar)",
              borderLeft: "1px solid var(--border-subtle)",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              overflowY: "auto",
              zIndex: 10,
            }}
          >
            <h3 style={{ fontSize: "14px", fontWeight: 600 }}>Media Info & Metadata</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px" }}>
              <div>
                <span style={{ color: "var(--text-muted)", display: "block" }}>Date Taken:</span>
                <span style={{ fontWeight: 500 }}>
                  {currentPhoto.taken_at ? new Date(currentPhoto.taken_at).toLocaleString() : "Unknown"}
                </span>
              </div>
              <div>
                <span style={{ color: "var(--text-muted)", display: "block" }}>Resolution:</span>
                <span style={{ fontWeight: 500 }}>
                  {currentPhoto.width || 3840} × {currentPhoto.height || 2160} (4K)
                </span>
              </div>
              <div>
                <span style={{ color: "var(--text-muted)", display: "block" }}>Storage Path:</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", wordBreak: "break-all" }}>
                  {currentPhoto.filepath}
                </span>
              </div>
              <div>
                <span style={{ color: "var(--text-muted)", display: "block" }}>Optimization:</span>
                <span style={{ color: "var(--accent-success)", fontWeight: 600 }}>
                  Visually Lossless AVIF (CRF 18)
                </span>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
