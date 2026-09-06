import React, { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Sparkles, Heart, Loader2, Image as ImageIcon, Clock } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { PhotoItem, OptimizationProgress } from "../types";

import { EmptyLibraryState } from "./EmptyLibraryState";

interface PhotoGridProps {
  photos?: PhotoItem[];
  optimizationProgress?: OptimizationProgress | null;
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
  onPhotoClick?: (index: number) => void;
  togglePhotoSelection: (id: number) => void;
  onToggleFavorite?: (photoId: number) => void;
}

const PhotoCard: React.FC<PhotoCardProps> = React.memo(({
  photo,
  globalIndex,
  isSelected,
  optimizationProgress,
  onPhotoClick,
  togglePhotoSelection,
  onToggleFavorite,
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const thumbnailUrl = `http://127.0.0.1:8000/api/photos/${photo.id}/thumbnail`;
  const isOptimizingThis = Boolean(optimizationProgress?.is_active && optimizationProgress.active_photo_id === photo.id);
  const isQueued = Boolean(optimizationProgress?.is_active && !photo.is_optimized && !isOptimizingThis);

  return (
    <div
      onClick={(e) => {
        if (e.shiftKey || e.ctrlKey) {
          togglePhotoSelection(photo.id);
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
        aspectRatio: "16 / 10",
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
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: isLoaded ? 1 : 0,
            transition: "opacity 0.35s ease",
            zIndex: 1,
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
              background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
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

      {/* 5. Hover Scrim with Filename & Resolution */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 45%, transparent 100%)",
          opacity: isHovered ? 1 : 0,
          transition: "opacity 0.2s ease",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "8px",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        <span style={{ fontSize: "11px", fontWeight: 600, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {photo.filename}
        </span>
        <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.7)", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
          {photo.width && photo.height ? `${photo.width} × ${photo.height}` : "8K ULTRA"}
        </span>
      </div>

      {/* 6. Badges (Top Right) */}
      <div 
        style={{
          position: "absolute",
          top: "6px",
          right: "6px",
          display: "flex",
          gap: "4px",
          zIndex: 3,
        }}
      >
        {/* Resolution / AI Enhancement Badge */}
        {(() => {
          const is8k = photo.is_enhanced || photo.is_optimized;
          const maxDim = Math.max(photo.width || 0, photo.height || 0);
          const isHighRes = maxDim >= 3840;

          if (is8k) {
            return (
              <span 
                title="8K ULTRA Super-Resolution Optimized"
                style={{
                  backgroundColor: "rgba(59, 130, 246, 0.9)",
                  color: "#ffffff",
                  padding: "2px 6px",
                  borderRadius: "var(--radius-xs)",
                  fontSize: "9px",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                }}
              >
                <Sparkles size={9} /> 8K ULTRA
              </span>
            );
          }

          if (isHighRes) {
            return (
              <span 
                title="High-Resolution Source"
                style={{
                  backgroundColor: "rgba(16, 185, 129, 0.85)",
                  color: "#ffffff",
                  padding: "2px 5px",
                  borderRadius: "var(--radius-xs)",
                  fontSize: "9px",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: "2px",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                }}
              >
                {maxDim >= 7680 ? "8K" : "HQ"}
              </span>
            );
          }

          return null;
        })()}
        <button
          type="button"
          title={photo.is_favorite ? "Remove from Favorites" : "Add to Favorites"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite?.(photo.id);
          }}
          style={{
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
          }}
        >
          <Heart 
            size={18} 
            fill={photo.is_favorite ? "#ef4444" : "none"} 
            stroke={photo.is_favorite ? "#ef4444" : "#ffffff"}
            strokeWidth={2}
          />
        </button>
      </div>

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
          backgroundColor: isSelected ? "var(--accent-primary)" : "rgba(0, 0, 0, 0.45)",
          border: isSelected ? "none" : "1px solid rgba(255, 255, 255, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
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
  onPhotoClick,
  onImportClick,
  onDropFiles,
  onToggleFavorite,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const { selectedPhotoIds, togglePhotoSelection } = useAppStore();
  
  const allPhotos = photos ?? [];

  const COLUMNS = 5;
  const rowCount = Math.ceil(allPhotos.length / COLUMNS);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 180,
    overscan: 2,
  });

  if (allPhotos.length === 0) {
    return (
      <EmptyLibraryState 
        onSelectFolder={onImportClick || (() => {})} 
        onDropFiles={onDropFiles}
      />
    );
  }

  return (
    <div 
      ref={parentRef}
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px",
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
          const startIndex = virtualRow.index * COLUMNS;
          const rowPhotos = allPhotos.slice(startIndex, startIndex + COLUMNS);

          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
                gap: "10px",
                paddingBottom: "10px",
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
