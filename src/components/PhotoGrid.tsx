import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Sparkles, Heart } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { PhotoItem } from "../types";

import { EmptyLibraryState } from "./EmptyLibraryState";

interface PhotoGridProps {
  photos?: PhotoItem[];
  onPhotoClick?: (index: number) => void;
  onImportClick?: () => void;
  onDropFiles?: (files: FileList) => void;
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

export const PhotoGrid: React.FC<PhotoGridProps> = ({ 
  photos, 
  onPhotoClick,
  onImportClick,
  onDropFiles
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
                  <div
                    key={photo.id}
                    onClick={(e) => {
                      if (e.shiftKey || e.ctrlKey) {
                        togglePhotoSelection(photo.id);
                      } else {
                        onPhotoClick?.(globalIndex);
                      }
                    }}
                    className="clickable"
                    style={{
                      position: "relative",
                      borderRadius: "var(--radius-sm)",
                      overflow: "hidden",
                      backgroundColor: "var(--bg-surface-elevated)",
                      border: isSelected 
                        ? "2px solid var(--accent-primary)" 
                        : "1px solid var(--border-subtle)",
                      boxShadow: isSelected ? "0 0 12px var(--accent-glow)" : "var(--shadow-sm)",
                      aspectRatio: "16 / 10",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {/* Shimmering Aspect-Ratio Placeholder Skeleton (CLS=0) */}
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
                      }}
                    >
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        4K • {photo.filename.split(".")[0]}
                      </span>
                    </div>

                    {/* Top Right Badges */}
                    <div 
                      style={{
                        position: "absolute",
                        top: "6px",
                        right: "6px",
                        display: "flex",
                        gap: "4px",
                        zIndex: 2,
                      }}
                    >
                      {photo.is_enhanced && (
                        <span 
                          title="4K AI Super-Resolution Enhanced"
                          style={{
                            backgroundColor: "rgba(59, 130, 246, 0.85)",
                            color: "#ffffff",
                            padding: "2px 4px",
                            borderRadius: "var(--radius-xs)",
                            fontSize: "9px",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: "2px",
                          }}
                        >
                          <Sparkles size={9} /> 4K
                        </span>
                      )}
                      {photo.is_favorite && (
                        <span 
                          style={{
                            backgroundColor: "rgba(239, 68, 68, 0.85)",
                            color: "#ffffff",
                            padding: "2px 4px",
                            borderRadius: "var(--radius-xs)",
                          }}
                        >
                          <Heart size={9} fill="#ffffff" />
                        </span>
                      )}
                    </div>

                    {/* Selection Checkbox */}
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
                        backgroundColor: isSelected ? "var(--accent-primary)" : "rgba(0, 0, 0, 0.4)",
                        border: isSelected ? "none" : "1px solid rgba(255, 255, 255, 0.4)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#ffffff",
                        zIndex: 2,
                        opacity: isSelected ? 1 : 0.4,
                      }}
                    >
                      {isSelected && <Check size={12} strokeWidth={3} />}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
