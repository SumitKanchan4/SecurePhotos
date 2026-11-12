import React, { useRef, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Sparkles, Heart, Loader2, Image as ImageIcon, Clock, Play, Folder } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { PhotoItem, OptimizationProgress, VideoOptimizationProgress } from "../types";
import { getThumbnailUrl } from "../services/api";

import { EmptyLibraryState } from "./EmptyLibraryState";

interface PhotoGridProps {
  photos?: PhotoItem[];
  optimizationProgress?: OptimizationProgress | null;
  videoProgress?: VideoOptimizationProgress | null;
  onPhotoClick?: (index: number) => void;
  onImportClick?: () => void;
  onDropFiles?: (files: FileList) => void;
  onToggleFavorite?: (photoId: number) => void;
}

// Mock dataset generator for benchmark testing
export const generateMockPhotos = (count: number): PhotoItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    filename: `IMG_2026_${(i + 1).toString().padStart(5, "0")}.avif`,
    filepath: `originals/2026/08/IMG_2026_${(i + 1).toString().padStart(5, "0")}.avif`,
    file_size: 1024 * 1024 * 1.2,
    mime_type: "image/avif",
    width: 3840,
    height: 2160,
    taken_at: new Date(Date.now() - i * 3600 * 1000 * 4).toISOString(),
    is_favorite: i % 7 === 0,
    is_encrypted: false,
    is_optimized: true,
    is_enhanced: i % 5 === 0,
    caption: `Scene #${i + 1}`,
  }));
};

interface PhotoCardProps {
  photo: PhotoItem;
  globalIndex: number;
  isSelected: boolean;
  optimizationProgress?: OptimizationProgress | null;
  videoProgress?: VideoOptimizationProgress | null;
  onPhotoClick?: (index: number) => void;
  togglePhotoSelection: (id: number) => void;
  onToggleFavorite?: (photoId: number) => void;
}

const PhotoCard: React.FC<PhotoCardProps> = React.memo(({
  photo,
  globalIndex,
  isSelected,
  optimizationProgress,
  videoProgress,
  onPhotoClick,
  togglePhotoSelection,
  onToggleFavorite,
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPortrait, setIsPortrait] = useState<boolean>(() => {
    return Boolean(photo.height && photo.width && photo.height > photo.width);
  });

  const thumbnailUrl = getThumbnailUrl(photo.id, photo.is_encrypted);
  const isVideo = Boolean(photo.mime_type?.startsWith("video/"));
  const isPhoto = !isVideo;
  const isOptimizingThis = Boolean(isPhoto && optimizationProgress?.is_active && optimizationProgress.active_photo_id === photo.id);
  const isQueued = Boolean(isPhoto && optimizationProgress?.is_active && !photo.is_optimized && !isOptimizingThis);

  const isVideoProcessing = Boolean(
    isVideo && (
      (!photo.is_enhanced && !photo.is_optimized) ||
      (videoProgress?.is_active && videoProgress.active_video_id === photo.id)
    )
  );

  return (
    <div
      onClick={(e) => {
        if (e.shiftKey || e.ctrlKey) {
          togglePhotoSelection(photo.id);
        } else if (isVideoProcessing) {
          useAppStore.getState().showToast(
            "⏳ Video is currently being enhanced to high-definition. It will be ready to watch in a moment.",
            "info"
          );
        } else {
          onPhotoClick?.(globalIndex);
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="clickable"
      style={{
        position: "relative",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        backgroundColor: "var(--bg-surface-elevated)",
        border: isSelected 
          ? "2px solid var(--accent-primary)" 
          : isOptimizingThis
            ? "2px solid var(--accent-primary)"
            : isHovered 
              ? "1px solid var(--border-highlight)" 
              : "1px solid var(--border-subtle)",
        boxShadow: isSelected 
          ? "0 0 14px var(--accent-glow)" 
          : isOptimizingThis
            ? "0 0 16px var(--accent-glow)"
            : isHovered 
              ? "var(--shadow-md)" 
              : "var(--shadow-sm)",
        aspectRatio: "1",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
        transform: isHovered ? "scale(1.015)" : "scale(1)",
      }}
    >
      {/* 1. Actual Real Thumbnail Image */}
      {!hasError && (
        <img
          src={thumbnailUrl}
          alt={photo.filename}
          loading="lazy"
          decoding="async"
          onLoad={(e) => {
            setIsLoaded(true);
            const img = e.currentTarget;
            if (img.naturalHeight && img.naturalWidth && img.naturalHeight > img.naturalWidth) {
              setIsPortrait(true);
            }
          }}
          onError={() => setHasError(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: isPortrait ? "center 18%" : "center center",
            opacity: isLoaded ? 1 : 0,
            transition: "opacity 0.35s ease",
            zIndex: 1,
            imageRendering: "-webkit-optimize-contrast",
          }}
        />
      )}

      {/* 2. Shimmering Skeleton + Filename (while image is loading or fallback) */}
      {!isLoaded && (
        <div 
          className="skeleton-shimmer"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px",
            zIndex: 0,
          }}
        >
          {hasError ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
              <ImageIcon size={20} style={{ color: "var(--text-muted)", opacity: 0.7 }} />
              <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {photo.filename.split(".")[0]}
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
              <Loader2 size={16} className="spin" style={{ color: "var(--accent-primary)", opacity: 0.8 }} />
              <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {photo.filename.split(".")[0]}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 3. Live Progress Bar on the actively processing photo */}
      {isOptimizingThis && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "4px",
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            overflow: "hidden",
            zIndex: 4,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${optimizationProgress?.item_progress || 30}%`,
              background: "var(--accent-fill)",
              borderRadius: "2px",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      )}

      {/* 4. Active / Queued Status Badge */}
      {isOptimizingThis ? (
        <div
          style={{
            position: "absolute",
            bottom: "8px",
            padding: "3px 8px",
            borderRadius: "var(--radius-full)",
            backgroundColor: "rgba(14, 16, 23, 0.9)",
            backdropFilter: "blur(4px)",
            border: "1px solid var(--accent-primary)",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            zIndex: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
          }}
        >
          <Loader2 size={10} className="spin" style={{ color: "var(--accent-primary)" }} />
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--accent-primary)", letterSpacing: "0.2px" }}>
            Optimizing: {optimizationProgress?.item_progress}%
          </span>
        </div>
      ) : isQueued ? (
        <div
          style={{
            position: "absolute",
            bottom: "8px",
            padding: "2px 7px",
            borderRadius: "var(--radius-full)",
            backgroundColor: "rgba(14, 16, 23, 0.75)",
            backdropFilter: "blur(4px)",
            border: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            zIndex: 3,
          }}
        >
          <Clock size={9} style={{ color: "var(--text-muted)" }} />
          <span style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: 500 }}>
            Queued
          </span>
        </div>
      ) : null}

      {/* 5. Subtle Hover Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 40%)",
          opacity: isHovered ? 1 : 0,
          transition: "opacity 0.2s ease",
          zIndex: 2,
          pointerEvents: "none",
        }}
      />

      {/* 6a. Bottom-Left Video Duration / Resolution / AI Optimization Frosted Glass Tag */}
      {photo.mime_type?.startsWith("video/") ? (() => {
        if (isVideoProcessing) {
          return (
            <div
              title="This video is currently being enhanced in the background."
              style={{
                position: "absolute",
                bottom: "7px",
                left: "7px",
                zIndex: 3,
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "3px 8px",
                borderRadius: "var(--radius-full)",
                background: "rgba(10, 12, 18, 0.85)",
                backdropFilter: "blur(12px)",
                border: "1px solid color-mix(in srgb, var(--accent-ink) 60%, transparent)",
                color: "var(--accent-ink)",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.2px",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.6), 0 0 10px color-mix(in srgb, var(--accent-ink) 30%, transparent)",
                pointerEvents: "none",
              }}
            >
              <Loader2 size={10} className="spin" style={{ color: "var(--accent-ink)" }} />
              <span>Processing HD...</span>
            </div>
          );
        }

        const isEnhanced = Boolean(photo.is_enhanced);
        const is4K = Boolean((photo.height && photo.height >= 2160) || (photo.width && photo.width >= 3840));
        const isHD = Boolean((photo.height && photo.height >= 720) || (photo.width && photo.width >= 1280));
        const durationStr = photo.duration
          ? `${Math.floor(photo.duration / 60)}:${String(Math.floor(photo.duration % 60)).padStart(2, "0")}`
          : "VIDEO";

        return (
          <div
            title={`Video clip${photo.duration ? ` • ${Math.round(photo.duration)}s` : ""}${is4K ? " • 4K UHD" : isHD ? " • HD" : ""}${isEnhanced ? " (Enhanced)" : ""}`}
            style={{
              position: "absolute",
              bottom: "7px",
              left: "7px",
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 7px",
              borderRadius: "var(--radius-full)",
              background: "rgba(10, 12, 18, 0.75)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              border: isEnhanced 
                ? "1px solid rgba(251, 191, 36, 0.4)" 
                : "1px solid rgba(255, 255, 255, 0.2)",
              color: "#ffffff",
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.2px",
              boxShadow: isEnhanced 
                ? "0 2px 8px rgba(0, 0, 0, 0.6), 0 0 8px rgba(251, 191, 36, 0.2)" 
                : "0 2px 6px rgba(0, 0, 0, 0.6)",
              pointerEvents: "none",
            }}
          >
            <Play size={9} fill="#ffffff" color="#ffffff" />
            <span>{durationStr}</span>
            {(isEnhanced || is4K || isHD) && (
              <span 
                style={{ 
                  display: "inline-flex", 
                  alignItems: "center", 
                  gap: "2px", 
                  color: isEnhanced ? "#fbbf24" : "rgba(255, 255, 255, 0.8)", 
                  fontWeight: 800, 
                  fontSize: "9px" 
                }}
              >
                <span>•</span>
                {isEnhanced && <Sparkles size={8} style={{ color: "#fbbf24" }} />}
                <span>{is4K ? "4K UHD" : "HD"}</span>
              </span>
            )}
          </div>
        );
      })() : (() => {
        const is8k = photo.is_enhanced || photo.is_optimized;
        const maxDim = Math.max(photo.width || 0, photo.height || 0);
        const isHighRes = maxDim >= 3840;

        if (!is8k && !isHighRes) return null;

        return (
          <div
            title={is8k ? "8K UHD Resolution" : "High-Resolution Source"}
            style={{
              position: "absolute",
              bottom: "7px",
              left: "7px",
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              gap: "3px",
              padding: "2px 6px",
              borderRadius: "var(--radius-xs)",
              background: "rgba(10, 12, 18, 0.65)",
              backdropFilter: "blur(8px)",
              border: is8k 
                ? "1px solid rgba(251, 191, 36, 0.35)" 
                : "1px solid rgba(255, 255, 255, 0.15)",
              color: is8k ? "#fbbf24" : "#10b981",
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.3px",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.5)",
              pointerEvents: "none",
            }}
          >
            {is8k && <Sparkles size={9} style={{ color: "#fbbf24" }} />}
            <span>{is8k ? "8K UHD" : (maxDim >= 7680 ? "8K" : "HQ")}</span>
          </div>
        );
      })()}

      {/* 6c. Bottom-Right Album Membership Frosted Capsule Badge */}
      {photo.album_names && (
        <div
          title={`In Album: ${photo.album_names}`}
          style={{
            position: "absolute",
            bottom: "7px",
            right: "7px",
            zIndex: isHovered ? 1 : 3,
            display: isHovered ? "none" : "flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 7px",
            borderRadius: "var(--radius-full)",
            background: "rgba(10, 12, 18, 0.75)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            color: "#ffffff",
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.2px",
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.6)",
            maxWidth: "110px",
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <Folder size={9} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {photo.album_names}
          </span>
        </div>
      )}

      {/* 6b. Favorite Heart Button (Top Right - Pinned to corner) */}
      <button
        type="button"
        title={photo.is_favorite ? "Remove from Favorites" : "Add to Favorites"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite?.(photo.id);
        }}
        style={{
          position: "absolute",
          top: "6px",
          right: "6px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          width: "24px",
          height: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: photo.is_favorite || isHovered ? 1 : 0,
          transform: isHovered ? "scale(1.15)" : "scale(1)",
          transition: "opacity 0.15s ease, transform 0.15s ease",
          padding: 0,
          filter: "drop-shadow(0 1px 3px rgba(0, 0, 0, 0.75))",
          zIndex: 3,
        }}
      >
        <Heart 
          size={18} 
          fill={photo.is_favorite ? "#ef4444" : "none"} 
          stroke={photo.is_favorite ? "#ef4444" : "#ffffff"}
          strokeWidth={2}
        />
      </button>

      {/* 7. Selection Checkbox (Top Left) */}
      <div 
        onClick={(e) => {
          e.stopPropagation();
          togglePhotoSelection(photo.id);
        }}
        style={{
          position: "absolute",
          top: "6px",
          left: "6px",
          width: "18px",
          height: "18px",
          borderRadius: "var(--radius-xs)",
          backgroundColor: isSelected ? "var(--accent-fill)" : "rgba(0, 0, 0, 0.45)",
          border: isSelected ? "none" : "1px solid rgba(255, 255, 255, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--on-accent)",
          zIndex: 3,
          opacity: isSelected || isHovered ? 1 : 0.4,
          transition: "opacity 0.15s ease, background-color 0.15s ease",
        }}
      >
        {isSelected && <Check size={12} strokeWidth={3} />}
      </div>
    </div>
  );
});

export const PhotoGrid: React.FC<PhotoGridProps> = ({ 
  photos, 
  optimizationProgress,
  videoProgress,
  onPhotoClick,
  onImportClick,
  onDropFiles,
  onToggleFavorite,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const { selectedPhotoIds, togglePhotoSelection, gridDensity } = useAppStore();
  
  const allPhotos = photos ?? [];

  const [columns, setColumns] = useState<number>(5);
  const [rowHeight, setRowHeight] = useState<number>(195);

  useEffect(() => {
    if (!parentRef.current) return;
    const updateGrid = () => {
      if (!parentRef.current) return;
      const width = parentRef.current.clientWidth - 32; // 16px padding on each side
      if (width <= 0) return;
      const gap = 10;
      const targetSize = gridDensity === "compact" ? 130 : gridDensity === "spacious" ? 260 : 185;
      const cols = Math.max(2, Math.floor((width + gap) / (targetSize + gap)));
      const itemWidth = (width - (cols - 1) * gap) / cols;
      const cardAspectRatio = 1; // 1:1 Square (strictly matching Albums & People tabs)
      const itemHeight = Math.round(itemWidth / cardAspectRatio);

      setColumns((prevCols) => (prevCols !== cols ? cols : prevCols));
      setRowHeight((prevHeight) => (Math.abs(prevHeight - itemHeight) >= 2 ? itemHeight : prevHeight));
    };

    updateGrid();
    const observer = new ResizeObserver(updateGrid);
    observer.observe(parentRef.current);
    return () => observer.disconnect();
  }, [gridDensity]);

  const rowCount = Math.ceil(allPhotos.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    gap: 10,
    overscan: 2,
  });

  if (allPhotos.length === 0) {
    return (
      <EmptyLibraryState 
        onSelectFolder={onImportClick || (() => {})} 
        onImportMedia={onImportClick || (() => {})} 
        onDropFiles={onDropFiles}
      />
    );
  }

  return (
    <div 
      ref={parentRef}
      style={{
        flex: 1,
        overflowY: "scroll",
        scrollbarGutter: "stable",
        padding: "16px 16px 88px 16px",
        height: "100%",
        position: "relative",
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * columns;
          const rowPhotos = allPhotos.slice(startIndex, startIndex + columns);

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: "10px",
              }}
            >
              {rowPhotos.map((photo, itemIdx) => {
                const globalIndex = startIndex + itemIdx;
                const isSelected = selectedPhotoIds.has(photo.id);

                return (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    globalIndex={globalIndex}
                    isSelected={isSelected}
                    optimizationProgress={optimizationProgress}
                    videoProgress={videoProgress}
                    onPhotoClick={onPhotoClick}
                    togglePhotoSelection={togglePhotoSelection}
                    onToggleFavorite={onToggleFavorite}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
