/**
 * Dashboard (redesign R7c, approved board): one calm page about the library. What is in it,
 * how full the drive is, and two jobs worth doing (duplicates, big videos) with the space each
 * frees. Background photo enhancement shows its progress with Pause / Resume. Duplicates and
 * Big videos open as their own pages with a way back.
 */
import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { DashboardOverview, DuplicateSummaryResponse, OptimizationStatusResponse, PhotoItem, VideoSummary } from "../types";
import type { NavTab } from "../store/useAppStore";
import { apiFetch } from "../services/api";
import { DuplicatesView } from "./DuplicatesView";
import { WhatToKeepView } from "./WhatToKeepView";
import { VideoOptimizerView } from "./VideoOptimizerView";
import { formatSize, oldOriginalsNote, plural, storageSegments } from "./dashboard/dashFormat";
import { StorageBreakdown } from "./dashboard/StorageBreakdown";
import type { OldOriginalsCleanup } from "./dashboard/dashFormat";

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
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, onPhotoClick, initialPage = "overview", backTo, onOpenPhoto, onLibraryChanged, choicesTotal = 0 }) => {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [dupes, setDupes] = useState<DuplicateSummaryResponse | null>(null);
  const [videos, setVideos] = useState<VideoSummary | null>(null);
  const [enhance, setEnhance] = useState<OptimizationStatusResponse | null>(null);
  const [page, setPage] = useState<DashboardPage>(initialPage);
  useEffect(() => setPage(initialPage), [initialPage]);
  const back = backTo && page === initialPage && page !== "overview" ? backTo : { label: "Dashboard", onBack: () => setPage("overview") };
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cleanup, setCleanup] = useState<OldOriginalsCleanup | null>(null);

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
    const [o, d, v, e, c] = await Promise.all([
      json<DashboardOverview>("/api/system/dashboard"),
      json<DuplicateSummaryResponse>("/api/duplicates/summary"),
      json<VideoSummary>("/api/videos/summary"),
      json<OptimizationStatusResponse>("/api/system/optimization-status"),
      json<OldOriginalsCleanup>("/api/videos/old-originals"),
    ]);
    setOverview(o);
    setDupes(d);
    setVideos(v);
    setEnhance(e);
    setCleanup(c);
    setFailed(!o);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Follow enhancement progress while it runs.
  useEffect(() => {
    if (enhance?.service_status !== "processing") return;
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch("/api/system/optimization-status");
        if (res.ok) setEnhance(await res.json());
      } catch {
        /* keep the last known state */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [enhance?.service_status]);

  const control = async (action: "pause" | "resume" | "trigger") => {
    try {
      await apiFetch(`/api/system/optimization/${action}`, { method: "POST" });
    } finally {
      load();
    }
  };

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

  const counts = overview?.media_counts;
  const tiles: { label: string; value: number; tab: NavTab }[] = counts
    ? [
        { label: "Photos", value: counts.images, tab: "photos" },
        { label: "Videos", value: counts.videos, tab: "photos" },
        { label: "Documents", value: counts.documents, tab: "documents" },
        { label: "People", value: counts.people, tab: "people" },
        { label: "Albums", value: counts.albums, tab: "albums" },
      ]
    : [];
  const segments = overview ? storageSegments(overview) : [];
  const drive = overview?.drive_storage;
  const enhanced = enhance ? enhance.images_optimized : 0;
  const enhanceTotal = enhance ? enhance.images_total : 0;
  const enhancePct = enhanceTotal > 0 ? Math.round((enhanced / enhanceTotal) * 100) : 0;

  return (
    <div className="dash-page">
      <div className="dash-header">
        <h1 className="dash-title">Dashboard</h1>
        {drive && (
          <span className="dash-subtitle">
            Library on {drive.volume_name || "this drive"}
            {drive.drive_letter ? ` (${drive.drive_letter.replace(/\\$/, "")})` : ""}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="dash-icon-btn" aria-label="Refresh" title="Refresh" onClick={load} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? "spin" : ""} />
        </button>
      </div>

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
        <div className="dash-counts">
          {tiles.map((tile) => (
            <button key={tile.label} type="button" className="dash-count" onClick={() => onNavigate(tile.tab)}>
              <span className="dash-count-value">{tile.value.toLocaleString()}</span>
              <span className="dash-count-label">{tile.label}</span>
            </button>
          ))}
        </div>
      )}

      {drive && drive.total_bytes > 0 && (
        <section className="dash-card" aria-labelledby="dash-storage">
          <div className="dash-card-head">
            <h2 id="dash-storage">Storage</h2>
            <span className="dash-muted">
              SecurePhotos uses {formatSize(overview?.app_storage?.total_bytes || 0)} · {formatSize(drive.free_bytes)} free of{" "}
              {formatSize(drive.total_bytes)}
            </span>
          </div>
          <div
            className="dash-bar"
            role="img"
            aria-label={segments.map((s) => `${s.label} ${formatSize(s.bytes)}`).join(", ") + `, free ${formatSize(drive.free_bytes)}`}
          >
            {segments.map((s) => (
              <span key={s.key} className={`dash-bar-${s.key}`} style={{ width: `${s.percent}%` }} />
            ))}
          </div>
          <div className="dash-legend">
            {segments.map((s) => (
              <span key={s.key}>
                <span className={`dash-swatch dash-bar-${s.key}`} aria-hidden="true" />
                {s.label} {formatSize(s.bytes)}
              </span>
            ))}
            <span>
              <span className="dash-swatch dash-bar-free" aria-hidden="true" />
              Free {formatSize(drive.free_bytes)}
            </span>
          </div>
          <h3 className="dash-usage-title">What SecurePhotos uses</h3>
          <StorageBreakdown stats={overview?.app_storage} />
        </section>
      )}

      <div className="dash-jobs">
        <section className="dash-card" aria-labelledby="dash-dupes">
          <h2 id="dash-dupes">Duplicates</h2>
          <p className="dash-muted">
            {!dupes
              ? "Checking for copies…"
              : dupes.total_groups > 0
              ? `${plural(dupes.total_groups, "group")} of copies and bursts. About ${formatSize(dupes.reclaimable_bytes)} can be freed.`
              : "No duplicates found."}
          </p>
          <div>
            <button
              type="button"
              className={dupes && dupes.total_groups > 0 ? "dash-btn dash-btn-primary" : "dash-btn"}
              onClick={() => setPage("duplicates")}
            >
              {dupes && dupes.total_groups > 0 ? "Review duplicates" : "Look for duplicates"}
            </button>
          </div>
        </section>

        {choicesTotal > 0 && (
          <section className="dash-card" aria-labelledby="dash-keep">
            <h2 id="dash-keep">What to keep</h2>
            <p className="dash-muted">
              {plural(choicesTotal, "photo")} improved automatically. Keep the improved one, the original, or both.
            </p>
            <div>
              <button type="button" className="dash-btn dash-btn-primary" onClick={() => setPage("keep")}>
                Choose
              </button>
            </div>
          </section>
        )}

        <section className="dash-card" aria-labelledby="dash-videos">
          <h2 id="dash-videos">Big videos</h2>
          <p className="dash-muted">
            {!videos
              ? "Checking your videos…"
              : !videos.runtime_available
              ? "Video tools aren't available on this computer."
              : videos.compressible_count > 0
              ? `${plural(videos.compressible_count, "video")} can be made smaller without visible change. About ${formatSize(videos.projected_reclaimable_bytes)} to save.`
              : "Your videos are already a good size."}
          </p>
          <div>
            <button type="button" className="dash-btn" onClick={() => setPage("videos")} disabled={videos ? !videos.runtime_available : false}>
              Review videos
            </button>
          </div>
        </section>
      </div>

      {enhance && enhanceTotal > 0 && (
        <section className="dash-card" aria-labelledby="dash-enhance">
          <div className="dash-card-head">
            <h2 id="dash-enhance">Photo enhancement</h2>
            <div style={{ flex: 1 }} />
            {enhance.service_status === "processing" ? (
              <button type="button" className="dash-btn dash-btn-small" onClick={() => control("pause")}>
                Pause
              </button>
            ) : enhance.service_status === "paused" ? (
              <button type="button" className="dash-btn dash-btn-small" onClick={() => control("resume")}>
                Resume
              </button>
            ) : enhance.images_pending > 0 ? (
              <button type="button" className="dash-btn dash-btn-small" onClick={() => control("trigger")}>
                Start now
              </button>
            ) : null}
          </div>
          <p className="dash-muted">
            {enhanced.toLocaleString()} of {plural(enhanceTotal, "photo")} enhanced
            {enhance.reclaimed_bytes > 0 ? ` · ${formatSize(enhance.reclaimed_bytes)} saved so far` : ""}
            {enhance.service_status === "paused" ? " · paused" : ""}
          </p>
          <div className="dash-progress" role="progressbar" aria-label="Photos enhanced" aria-valuemin={0} aria-valuemax={100} aria-valuenow={enhancePct}>
            <span style={{ width: `${enhancePct}%` }} />
          </div>
        </section>
      )}
    </div>
  );
};
