/**
 * PhotoTimeline: the Photos screen grid (redesign R2).
 *
 * The whole library, newest first, in month sections of justified rows (photos keep
 * their shape). Only rows near the viewport are rendered, so tens of thousands of
 * photos stay smooth. A month/year scrubber on the right replaces the scrollbar and
 * the old year ribbon. While anything is selected, clicking a photo selects it
 * instead of opening it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Heart, Loader2, Play } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import type { TimelinePhoto } from "../../types";
import { getThumbnailUrl } from "../../services/api";
import {
  allSelected,
  buildLayout,
  groupByMonth,
  LayoutEntry,
  MonthSection,
  monthKey,
  scrubberEntries,
  sectionAt,
  shortMonthLabel,
  UNDATED_KEY,
  visibleRange,
} from "../../utils/photoTimeline";

const ROW_HEIGHT = { compact: 150, comfortable: 210, spacious: 300 } as const;
const GAP = 4;
const PAD_LEFT = 24;
const PAD_RIGHT = 76; // room for the scrubber
const SCRUB_ENTRY_HEIGHT = 30; // one scrubber entry and its gap
const PAD_TOP = 8;
const PAD_BOTTOM = 96; // room for the selection dock

/** A video still being converted can't be played yet. */
export function isVideoProcessing(photo: TimelinePhoto, activeVideoId?: number | null): boolean {
  return photo.is_video && ((!photo.is_enhanced && !photo.is_optimized) || activeVideoId === photo.id);
}

interface TileProps {
  photo: TimelinePhoto;
  index: number;
  left: number;
  width: number;
  height: number;
  isSelected: boolean;
  selectionMode: boolean;
  selectable: boolean;
  isVault: boolean;
  processing: boolean;
  onActivate: (index: number, photo: TimelinePhoto, event: React.MouseEvent | React.KeyboardEvent) => void;
  onToggleSelect: (id: number) => void;
  onToggleFavorite?: (id: number) => void;
}

const Tile: React.FC<TileProps> = React.memo(
  ({ photo, index, left, width, height, isSelected, selectionMode, selectable, isVault, processing, onActivate, onToggleSelect, onToggleFavorite }) => {
    const [loaded, setLoaded] = useState(false);
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${photo.is_video ? "Video" : "Photo"}${monthKey(photo.taken_at) !== UNDATED_KEY ? ` from ${shortMonthLabel(monthKey(photo.taken_at))}` : ""}`}
        aria-pressed={selectable && selectionMode ? isSelected : undefined}
        data-photo-id={photo.id}
        className="timeline-tile"
        onClick={(e) => onActivate(index, photo, e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate(index, photo, e);
          }
        }}
        style={{ position: "absolute", left, top: 0, width, height }}
      >
        <div className={`timeline-tile-media${isSelected ? " is-selected" : ""}`}>
          <img
            src={getThumbnailUrl(photo.id, isVault)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            style={{ opacity: loaded ? 1 : 0 }}
          />
          {photo.is_video && (
            <span className="timeline-chip" title={processing ? "This video is being prepared. It can be played soon." : "Video"}>
              {processing ? <Loader2 size={11} className="spin" /> : <Play size={10} fill="currentColor" />}
              {processing ? "Preparing" : "Video"}
            </span>
          )}
          {photo.is_ai && (
            <span className="timeline-ai" title="Improved with AI (colour, faces or scratches)">
              AI
            </span>
          )}
          {photo.is_preparing && !photo.is_video && (
            <span
              className="timeline-preparing"
              role="img"
              aria-label="Still being prepared"
              title="Still being prepared: reading text, finding faces, enhancing. You can use it already."
            />
          )}
        </div>

        {selectable && (
          <button
            type="button"
            className={`timeline-select${isSelected ? " is-on" : ""}${selectionMode ? " is-visible" : ""}`}
            aria-label={isSelected ? "Unselect" : "Select"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(photo.id);
            }}
          >
            {isSelected && <Check size={13} strokeWidth={3} />}
          </button>
        )}

        {onToggleFavorite && (
          <button
            type="button"
            className={`timeline-fav${photo.is_favorite ? " is-on" : ""}`}
            aria-label={photo.is_favorite ? "Remove from favourites" : "Add to favourites"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(photo.id);
            }}
          >
            <Heart size={16} fill={photo.is_favorite ? "currentColor" : "none"} strokeWidth={2.2} />
          </button>
        )}
      </div>
    );
  },
);

interface SectionHeaderProps {
  section: MonthSection;
  ids: number[];
  selected: Set<number>;
  selectable: boolean;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ section, ids, selected, selectable }) => {
  const isAll = allSelected(ids, selected);
  return (
    <div className="timeline-header">
      <h2>{section.label}</h2>
      <span className="timeline-header-count">{section.count.toLocaleString()}</span>
      {selectable && (
      <button
        type="button"
        className={`timeline-select timeline-select-month${isAll ? " is-on" : ""}${selected.size > 0 ? " is-visible" : ""}`}
        aria-label={isAll ? `Unselect ${section.label}` : `Select all of ${section.label}`}
        onClick={() => {
          const next = new Set(selected);
          ids.forEach((id) => (isAll ? next.delete(id) : next.add(id)));
          useAppStore.setState({ selectedPhotoIds: next });
        }}
      >
        {isAll && <Check size={13} strokeWidth={3} />}
      </button>
      )}
    </div>
  );
};

interface PhotoTimelineProps {
  photos: TimelinePhoto[];
  onOpen: (index: number) => void;
  onToggleFavorite?: (id: number) => void;
  activeVideoId?: number | null;
  /** Shown instead of the grid when there are no photos. */
  empty?: React.ReactNode;
  /** Vault items (redesign R4): vault thumbnails, and no selection (the vault has no selection bar). */
  vault?: boolean;
  /** Show the month/year scrubber only when there are at least this many month sections. */
  minScrubberSections?: number;
  /** False where nothing acts on a selection (Search page, R9c): clicks always open. */
  selectable?: boolean;
}

export const PhotoTimeline: React.FC<PhotoTimelineProps> = ({
  photos,
  onOpen,
  onToggleFavorite,
  activeVideoId,
  empty,
  vault = false,
  minScrubberSections = 2,
  selectable: allowSelection = true,
}) => {
  const selectable = !vault && allowSelection;
  const { selectedPhotoIds, togglePhotoSelection, gridDensity, showToast } = useAppStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  // Track the container size (and fall back to one measurement where ResizeObserver is missing).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setSize((prev) => (prev.width === el.clientWidth && prev.height === el.clientHeight ? prev : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [photos.length === 0]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrollTop(el.scrollTop));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [photos.length === 0]);

  const sections = useMemo(() => groupByMonth(photos), [photos]);
  const contentWidth = Math.max(0, size.width - PAD_LEFT - PAD_RIGHT);
  const layout = useMemo(
    () => buildLayout(photos, sections, { width: contentWidth, targetRowHeight: ROW_HEIGHT[gridDensity] ?? 210, gap: GAP }),
    [photos, sections, contentWidth, gridDensity],
  );
  const sectionIds = useMemo(() => {
    const map = new Map<string, number[]>();
    sections.forEach((s) => map.set(s.key, photos.slice(s.start, s.start + s.count).map((p) => p.id)));
    return map;
  }, [photos, sections]);

  const contentTop = Math.max(0, scrollTop - PAD_TOP);
  const [first, last] = visibleRange(layout.entries, contentTop, size.height);
  const visible: LayoutEntry[] = layout.entries.slice(first, last + 1);
  const selectionMode = selectable && selectedPhotoIds.size > 0;

  const handleActivate = useCallback(
    (index: number, photo: TimelinePhoto, event: React.MouseEvent | React.KeyboardEvent) => {
      const state = useAppStore.getState();
      if (selectable && (state.selectedPhotoIds.size > 0 || event.shiftKey || event.ctrlKey || event.metaKey)) {
        state.togglePhotoSelection(photo.id);
      } else if (isVideoProcessing(photo, activeVideoId)) {
        showToast("This video is still being prepared. It will be ready to play in a moment.", "info");
      } else {
        onOpen(index);
      }
    },
    [activeVideoId, onOpen, showToast, selectable],
  );

  // ── Scrubber (approved Photos board, R9d) ───────────────────────────────
  // The newest year's months, then one entry per older year, stacked from the top; the one
  // you are looking at is the lime pill. Click to jump, or press and drag along the list.
  const trackRef = useRef<HTMLElement>(null);
  const [trackHeight, setTrackHeight] = useState(0);
  const dragging = useRef(false);
  useEffect(() => {
    setTrackHeight(trackRef.current?.clientHeight ?? 0);
  }, [size.height]);
  const entries = useMemo(
    () => scrubberEntries(sections, trackHeight > 0 ? Math.max(1, Math.floor(trackHeight / SCRUB_ENTRY_HEIGHT)) : Infinity),
    [sections, trackHeight],
  );
  const showScrubber = sections.length >= Math.max(2, minScrubberSections) && layout.totalHeight > size.height;
  const current = sectionAt(sections, layout.sectionTops, contentTop);

  const jumpTo = (key: string) => {
    const el = scrollRef.current;
    if (el) el.scrollTop = (layout.sectionTops.get(key) ?? 0) + PAD_TOP;
  };
  useEffect(() => {
    const stop = () => (dragging.current = false);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  if (photos.length === 0) return <>{empty}</>;

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
      <div
        ref={scrollRef}
        className="timeline-scroll"
        data-testid="photo-timeline"
        style={{ flex: 1, overflowY: "auto", position: "relative", padding: `${PAD_TOP}px ${PAD_RIGHT}px ${PAD_BOTTOM}px ${PAD_LEFT}px` }}
      >
        <div style={{ position: "relative", height: layout.totalHeight }}>
          {visible.map((entry) =>
            entry.kind === "header" ? (
              <div key={entry.key} style={{ position: "absolute", top: entry.top, left: 0, right: 0, height: entry.height }}>
                <SectionHeader section={entry.section} ids={sectionIds.get(entry.section.key) ?? []} selected={selectedPhotoIds} selectable={selectable} />
              </div>
            ) : (
              <div key={entry.key} style={{ position: "absolute", top: entry.top, left: 0, right: 0, height: entry.height }}>
                {entry.tiles.map((tile) => {
                  const p = photos[tile.index];
                  return (
                    <Tile
                      key={p.id}
                      photo={p}
                      index={tile.index}
                      left={tile.left}
                      width={tile.width}
                      height={entry.height}
                      isSelected={selectable && selectedPhotoIds.has(p.id)}
                      selectionMode={selectionMode}
                      selectable={selectable}
                      isVault={vault}
                      processing={isVideoProcessing(p, activeVideoId)}
                      onActivate={handleActivate}
                      onToggleSelect={togglePhotoSelection}
                      onToggleFavorite={onToggleFavorite}
                    />
                  );
                })}
              </div>
            ),
          )}
        </div>
      </div>

      {showScrubber && (
        <nav ref={trackRef} className="timeline-scrubber" aria-label="Jump to date">
          {entries.map((entry) => {
            const isCurrent = current ? entry.keys.includes(current.key) : false;
            return (
              <button
                key={entry.key}
                type="button"
                className={`timeline-scrub-entry${isCurrent ? " is-current" : ""}`}
                aria-label={entry.name}
                aria-current={isCurrent ? "true" : undefined}
                title={entry.name}
                onPointerDown={() => {
                  dragging.current = true;
                  jumpTo(entry.key);
                }}
                onPointerEnter={() => {
                  if (dragging.current) jumpTo(entry.key);
                }}
                onClick={() => jumpTo(entry.key)}
              >
                {entry.label}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
};
