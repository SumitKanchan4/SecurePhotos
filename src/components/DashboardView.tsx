/**
 * Dashboard (T32, owner-approved mock-up 2026-11-22; before that R7c and owner feedback round 2
 * #4 "looks like a settings page"). The library opens as one sentence in big type over a strip
 * of its newest photos, every number a way in, with one quiet storage line (the detail is in
 * Settings › Storage). Below it, tiles about the library itself: On this day, Just added, Brought
 * back, People and Your year, each left out when it has nothing to show. Worth doing lists the
 * jobs that free space, biggest first. Duplicates, What to keep and Big videos open as their own
 * pages with a way back.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ChevronRight, HardDrive, RefreshCw, Sparkles } from "lucide-react";
import type { DashboardOverview, DuplicateSummaryResponse, PhotoItem, VideoSummary } from "../types";
import type { NavTab } from "../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../services/api";
import { useAppStore } from "../store/useAppStore";
import { DuplicatesView } from "./DuplicatesView";
import { WhatToKeepView } from "./WhatToKeepView";
import { VideoOptimizerView } from "./VideoOptimizerView";
import { greeting, librarySentence, oldOriginalsNote, savedPill, spaceCard, storageLine, worthDoing } from "./dashboard/dashFormat";
import type { Highlights, OldOriginalsCleanup, SpaceSummary, WorthJob } from "./dashboard/dashFormat";
import { BroughtBackTile, JustAddedTile, OnThisDayTile, PeopleTile, WorthDoing, YearTile } from "./dashboard/DashTiles";

export type DashboardPage = "overview" | "duplicates" | "videos" | "keep";

interface DashboardViewProps {
  onNavigate: (tab: NavTab) => void;
  onPhotoClick?: (index: number, photos: PhotoItem[]) => void;
  /** A8: opened from a Photos header pill ("12 improved", "3 duplicates"). */
  initialPage?: DashboardPage;
  /** Back from a page opened by a pill returns to Photos. */
  backTo?: { label: string; onBack: () => void };
  onOpenPhoto?: (photoId: number) => void;
  /** Something in the library changed (a choice, duplicates removed). */
  onLibraryChanged?: () => void;
  /** Improved photos waiting for "what to keep". */
  choicesTotal?: number;
  /** On this day › Play as a story. */
  onPlayStory?: (storyId: number) => void;
  /** Brought back, before the first one: Add photos. */
  onImport?: () => void;
}

interface KeepSummary {
  total: number;
  originals_bytes: number;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onPhotoClick,
  initialPage = "overview",
  backTo,
  onOpenPhoto,
  onLibraryChanged,
  choicesTotal = 0,
  onPlayStory,
  onImport,
}) => {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [dupes, setDupes] = useState<DuplicateSummaryResponse | null>(null);
  const [videos, setVideos] = useState<VideoSummary | null>(null);
  const [spaceSummary, setSpaceSummary] = useState<SpaceSummary | null>(null);
  const [highlights, setHighlights] = useState<Highlights | null>(null);
  const [keep, setKeep] = useState<KeepSummary | null>(null);
  const [page, setPage] = useState<DashboardPage>(initialPage);
  useEffect(() => setPage(initialPage), [initialPage]);
  const back = backTo && page === initialPage && page !== "overview" ? backTo : { label: "Dashboard", onBack: () => setPage("overview") };
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cleanup, setCleanup] = useState<OldOriginalsCleanup | null>(null);
  const [ribbon, setRibbon] = useState<number[]>([]);
  const [showSaved, setShowSaved] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const json = async <T,>(path: string): Promise<T | null> => {
      try {
        const res = await apiFetch(path);
        return res.ok ? ((await res.json()) as T) : null;
      } catch {
        return null;
      }
    };
    const [o, d, v, e, c, recent, h, k] = await Promise.all([
      json<DashboardOverview>("/api/system/dashboard"),
      json<DuplicateSummaryResponse>("/api/duplicates/summary"),
      json<VideoSummary>("/api/videos/summary"),
      json<SpaceSummary>("/api/system/space-summary"),
      json<OldOriginalsCleanup>("/api/videos/old-originals"),
      json<PhotoItem[]>("/api/photos?limit=14"),
      json<Highlights>("/api/system/highlights"),
      json<KeepSummary>("/api/restore/choices?limit=1"),
    ]);
    setRibbon(Array.isArray(recent) ? recent.filter((p) => !p.mime_type?.startsWith("video/")).map((p) => p.id).slice(0, 10) : []);
    setOverview(o);
    setDupes(d);
    setVideos(v);
    setSpaceSummary(e);
    setCleanup(c);
    setHighlights(h && Array.isArray(h.months) && h.people ? h : null);
    setKeep(k && typeof k.total === "number" ? k : null);
    setFailed(!o);
    setLoaded(true);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dismissCleanup = async () => {
    setCleanup(null);
    try {
      await apiFetch("/api/videos/old-originals/acknowledge", { method: "POST" });
    } catch {
      /* shown again next time; harmless */
    }
  };

  if (page === "duplicates") {
    return (
      <DuplicatesView
        onBack={back.onBack}
        backLabel={back.label}
        onPhotoClick={onPhotoClick}
        onRefreshTelemetry={() => {
          void load();
          onLibraryChanged?.();
        }}
      />
    );
  }
  if (page === "keep") {
    return (
      <WhatToKeepView
        onBack={back.onBack}
        backLabel={back.label}
        onOpenPhoto={(id) => onOpenPhoto?.(id)}
        onChanged={onLibraryChanged}
      />
    );
  }
  if (page === "videos") {
    return <VideoOptimizerView onBack={() => setPage("overview")} onPhotoClick={onPhotoClick} onRefreshTelemetry={load} />;
  }

  const store = useAppStore.getState;
  const counts = overview?.media_counts;
  const parts = counts ? librarySentence(counts) : [];
  const storage = storageLine(overview?.app_storage?.total_bytes || 0, overview?.drive_storage);
  const space = spaceCard(spaceSummary);
  const pill = savedPill(spaceSummary);
  const now = new Date();
  const jobs = worthDoing({
    duplicates: loaded ? (dupes ? { count: dupes.total_groups, bytes: dupes.reclaimable_bytes } : null) : undefined,
    videos: loaded ? (videos && !videos.runtime_available ? "off" : videos ? { count: videos.compressible_count, bytes: videos.projected_reclaimable_bytes } : null) : undefined,
    keep: loaded ? { count: keep?.total ?? choicesTotal, bytes: keep?.originals_bytes ?? 0 } : undefined,
    trash: loaded ? highlights?.trash ?? null : undefined,
  });
  const openJob = (key: WorthJob["key"]) => (key === "trash" ? onNavigate("trash") : setPage(key));

  return (
    <div className="dash-page">
      <div className="dash-header">
        <h1 className="dash-title">Dashboard</h1>
        <span className="dash-subtitle">{greeting(now)}</span>
        <div style={{ flex: 1 }} />
        {pill && (
          <button type="button" className="dash-saved-pill" aria-expanded={showSaved} onClick={() => setShowSaved((v) => !v)}>
            <Sparkles size={14} aria-hidden="true" />
            {pill}
          </button>
        )}
        <button type="button" className="dash-icon-btn" aria-label="Refresh" title="Refresh" onClick={load} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? "spin" : ""} />
        </button>
      </div>

      {/* T27 (owner, 2026-11-21): what enhancing did, in plain words, one press away. */}
      {showSaved && space && (
        <div className="dash-note dash-note-row" role="status">
          <span>{[space.detail, space.sorted && `${space.sorted}.`, space.waiting && `${space.waiting}.`].filter(Boolean).join(" ")}</span>
          {space.waiting && (
            <button type="button" className="dash-btn dash-btn-small" onClick={() => store().setActiveTab("activity")}>
              See Activity
            </button>
          )}
        </div>
      )}

      {oldOriginalsNote(cleanup) && (
        <div className="dash-note dash-note-row" role="status">
          <span>{oldOriginalsNote(cleanup)}</span>
          <button type="button" className="dash-btn dash-btn-small" onClick={dismissCleanup}>
            OK
          </button>
        </div>
      )}

      {failed && <p className="dash-note">The library details couldn't be loaded. Check that the photo engine is running (Settings → About).</p>}

      {counts && (
        <section className="dash-hero" aria-label="Your library">
          <p className="dash-sentence">
            {parts.map((part, i) => (
              <React.Fragment key={part.key}>
                {i > 0 && (i === parts.length - 1 ? " and " : " ")}
                {/* The comma stays with its number when the line wraps. */}
                <span className="dash-sentence-part">
                  <button type="button" className="dash-sentence-link" onClick={() => onNavigate(part.tab)}>
                    <span className="dash-count-value">{part.value.toLocaleString()}</span> <span className="dash-count-label">{part.label}</span>
                  </button>
                  {i < parts.length - 2 ? "," : i === parts.length - 1 ? "." : ""}
                </span>
              </React.Fragment>
            ))}
            {parts.length ? null : "Nothing here yet. Import photos to start your library."}
          </p>
          {ribbon.length > 0 && (
            <div className="dash-ribbon" aria-hidden="true">
              {ribbon.map((id) => (
                <img key={id} src={getThumbnailUrl(id)} alt="" loading="lazy" draggable={false} />
              ))}
            </div>
          )}
          {storage && (
            <p className={`dash-storage-line${storage.low ? " is-low" : ""}`}>
              <HardDrive size={16} aria-hidden="true" />
              <span>{storage.text}</span>
              <span className="dash-storage-meter" aria-hidden="true">
                <span style={{ width: `${storage.usedPercent}%` }} />
              </span>
              <button type="button" className="dash-link" onClick={() => store().openSettings("storage")}>
                Storage <ChevronRight size={14} aria-hidden="true" />
              </button>
            </p>
          )}
        </section>
      )}

      {highlights && (
        <section className="dash-tiles" aria-label="At a glance">
          {highlights.on_this_day && (
            <OnThisDayTile memory={highlights.on_this_day} now={now} onPlay={onPlayStory} onOpenPhoto={onOpenPhoto} />
          )}
          {highlights.just_added && (
            <JustAddedTile
              added={highlights.just_added}
              onOpenPhotos={() => onNavigate("photos")}
              onOpenActivity={() => store().setActiveTab("activity")}
            />
          )}
          <BroughtBackTile back={highlights.brought_back} onOpenPhoto={onOpenPhoto} onImport={onImport} />
          <PeopleTile
            people={highlights.people}
            total={counts?.people ?? highlights.people.top.length}
            onOpenPerson={(id) => store().openPerson(id)}
            onOpenPeople={() => onNavigate("people")}
          />
          <YearTile year={highlights.year} months={highlights.months} now={now} onOpenMonth={(key) => store().openMonth(key)} onImport={onImport} />
        </section>
      )}

      <WorthDoing jobs={jobs} onOpen={openJob} />
    </div>
  );
};
