/**
 * Big videos (redesign R7c, approved board; formerly the video optimizer). Each video shows its
 * size now and after. "Make smaller" re-encodes so it looks and sounds the same; the original is
 * deleted once the smaller copy is checked (same length, has a picture: owner decision R7c), so
 * the space is freed at once. Old, low-resolution clips can be enhanced instead.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Play } from "lucide-react";
import type { PhotoItem, VideoCandidate, VideoOptimizationProgress, VideoSummary } from "../types";
import { useAppStore } from "../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../services/api";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { formatDuration, formatSize, plural } from "./dashboard/dashFormat";

interface VideoOptimizerViewProps {
  onBack: () => void;
  onPhotoClick?: (index: number, photos: PhotoItem[]) => void;
  onRefreshTelemetry?: () => void;
}

const ENHANCE_TARGETS = [
  { value: 720, label: "HD" },
  { value: 1080, label: "Full HD" },
  { value: 2160, label: "4K" },
];

export const VideoOptimizerView: React.FC<VideoOptimizerViewProps> = ({ onBack, onRefreshTelemetry }) => {
  const showToast = useAppStore((s) => s.showToast);
  const [summary, setSummary] = useState<VideoSummary | null>(null);
  const [candidates, setCandidates] = useState<VideoCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [working, setWorking] = useState<Set<number>>(new Set());
  const [batch, setBatch] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmOne, setConfirmOne] = useState<VideoCandidate | null>(null);
  const [progress, setProgress] = useState<VideoOptimizationProgress | null>(null);
  const [targets, setTargets] = useState<Record<number, number>>({});

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([apiFetch("/api/videos/summary"), apiFetch("/api/videos/candidates")]);
      if (s.ok) setSummary(await s.json());
      if (c.ok) setCandidates(await c.json());
    } catch (err) {
      console.error("Failed to load videos:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Follow a running batch.
  useEffect(() => {
    if (!batch) return;
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch("/api/videos/optimization-progress");
        if (res.ok) setProgress(await res.json());
      } catch {
        /* keep the last known progress */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [batch]);

  const smaller = useMemo(() => candidates.filter((c) => c.optimization_plan.action === "compress"), [candidates]);
  const oldClips = useMemo(() => candidates.filter((c) => c.optimization_plan.action === "enhance"), [candidates]);
  const totalSaving = smaller.reduce((n, c) => n + (c.optimization_plan.projected_savings_bytes || 0), 0);

  const mark = (id: number, on: boolean) =>
    setWorking((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const makeSmaller = async (video: VideoCandidate) => {
    mark(video.id, true);
    try {
      const res = await apiFetch(`/api/videos/${video.id}/compress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crf: 23 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        showToast(`Made ${video.filename} smaller. ${formatSize(data.saved_bytes)} freed.`, "success");
        await load();
        onRefreshTelemetry?.();
      } else {
        showToast(data.error || "That video couldn't be made smaller. The original is unchanged.", "warning");
      }
    } catch {
      showToast("That video couldn't be made smaller. The original is unchanged.", "warning");
    } finally {
      mark(video.id, false);
    }
  };

  const makeAllSmaller = async () => {
    setConfirmAll(false);
    setBatch(true);
    setProgress(null);
    try {
      const res = await apiFetch("/api/videos/compress-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crf: 23 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      const done = data.processed_count ?? 0;
      showToast(
        done > 0
          ? `Made ${plural(done, "video")} smaller. ${formatSize(data.total_reclaimed_bytes || 0)} freed.`
          : "None of the videos could be made smaller. The originals are unchanged.",
        done > 0 ? "success" : "info",
      );
      await load();
      onRefreshTelemetry?.();
    } catch {
      showToast("Making the videos smaller stopped early. Videos already done stay smaller; the rest are unchanged.", "warning");
      load();
    } finally {
      setBatch(false);
    }
  };

  const enhanceClip = async (video: VideoCandidate) => {
    const target = targets[video.id] ?? 720;
    mark(video.id, true);
    try {
      const res = await apiFetch(`/api/videos/${video.id}/enhance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_height: target, denoise: true, deinterlace: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        showToast(`Enhanced ${video.filename} to ${ENHANCE_TARGETS.find((t) => t.value === target)?.label ?? `${target}p`}.`, "success");
        await load();
        onRefreshTelemetry?.();
      } else {
        showToast(data.error || "That clip couldn't be enhanced.", "warning");
      }
    } catch {
      showToast("That clip couldn't be enhanced.", "warning");
    } finally {
      mark(video.id, false);
    }
  };

  const row = (video: VideoCandidate, action: React.ReactNode) => {
    const plan = video.optimization_plan;
    const isActive = (batch && progress?.active_video_id === video.id) || working.has(video.id);
    return (
      <div key={video.id} className="vid-row">
        <span className="vid-thumb">
          <img
            src={getThumbnailUrl(video.id)}
            alt=""
            loading="lazy"
            draggable={false}
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
          {formatDuration(video.duration) && <span className="vid-length">{formatDuration(video.duration)}</span>}
          {!formatDuration(video.duration) && (
            <span className="vid-length">
              <Play size={9} fill="currentColor" />
            </span>
          )}
        </span>
        <span className="vid-text">
          <span className="vid-name">{video.filename}</span>
          <span className="dash-muted">
            {plan.action === "compress"
              ? `${formatSize(video.file_size)} now · about ${formatSize(Math.max(0, video.file_size - plan.projected_savings_bytes))} after`
              : `${video.width && video.height ? `${video.width} × ${video.height} · ` : ""}${formatSize(video.file_size)}`}
          </span>
          {isActive && <span className="vid-status"><Loader2 size={12} className="spin" /> {plan.action === "compress" ? "Making smaller…" : "Enhancing…"}</span>}
        </span>
        {!isActive && action}
      </div>
    );
  };

  const runtimeMissing = summary && !summary.runtime_available;
  return (
    <div className="dash-page">
      <div>
        <button type="button" className="dash-back" onClick={onBack}>
          <ArrowLeft size={15} /> Dashboard
        </button>
      </div>
      <div className="dash-header">
        <h1 className="dash-title">Big videos</h1>
        <span className="dash-subtitle">
          {batch && progress
            ? `Making videos smaller · ${progress.completed_count} of ${progress.total_count} done`
            : smaller.length
            ? `${plural(smaller.length, "video")} can be made smaller · about ${formatSize(totalSaving)} to save`
            : "Nothing to make smaller"}
        </span>
        <div style={{ flex: 1 }} />
        {smaller.length > 0 && (
          <button type="button" className="dash-btn dash-btn-primary" disabled={batch || working.size > 0} onClick={() => setConfirmAll(true)}>
            {batch && <Loader2 size={13} className="spin" />}
            {batch ? "Making smaller…" : "Make all smaller"}
          </button>
        )}
      </div>
      <p className="dash-muted">
        {batch
          ? "You can keep using the app while this runs."
          : "Videos look and sound the same afterwards. Each original is deleted once its smaller copy has been checked (same length, plays as a video), so the space is freed right away."}
      </p>

      {runtimeMissing ? (
        <div className="dash-empty">
          <h2>Video tools aren't available</h2>
          <p>This computer is missing the video tools the app needs. Check Settings → About.</p>
        </div>
      ) : isLoading ? null : (
        <>
          <section className="vid-section" aria-labelledby="vid-smaller">
            <h2 id="vid-smaller" className="dash-section-title">Can be made smaller</h2>
            {smaller.length ? (
              <div className="vid-list">
                {smaller.map((v) =>
                  row(
                    v,
                    <button type="button" className="dash-btn dash-btn-small" disabled={batch} onClick={() => setConfirmOne(v)}>
                      Make smaller
                    </button>,
                  ),
                )}
              </div>
            ) : (
              <p className="dash-muted">Your videos are already a good size.</p>
            )}
          </section>

          {oldClips.length > 0 && (
            <section className="vid-section" aria-labelledby="vid-old">
              <h2 id="vid-old" className="dash-section-title">Old or low-quality clips</h2>
              <div className="vid-list">
                {oldClips.map((v) =>
                  row(
                    v,
                    <span className="vid-actions">
                      <select
                        aria-label={`Enhance ${v.filename} to`}
                        className="vid-select"
                        value={targets[v.id] ?? 720}
                        onChange={(e) => setTargets((prev) => ({ ...prev, [v.id]: Number(e.target.value) }))}
                      >
                        {ENHANCE_TARGETS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="dash-btn dash-btn-small" disabled={batch} onClick={() => enhanceClip(v)}>
                        Enhance
                      </button>
                    </span>,
                  ),
                )}
              </div>
            </section>
          )}
        </>
      )}

      {confirmOne && (
        <ConfirmDialog
          title={`Make ${confirmOne.filename} smaller?`}
          message={`About ${formatSize(confirmOne.optimization_plan.projected_savings_bytes || 0)} will be freed. The original is deleted once the smaller copy has been checked; this can't be undone.`}
          confirmLabel="Make smaller"
          onConfirm={() => {
            const video = confirmOne;
            setConfirmOne(null);
            makeSmaller(video);
          }}
          onCancel={() => setConfirmOne(null)}
        />
      )}

      {confirmAll && (
        <ConfirmDialog
          title={`Make ${plural(smaller.length, "video")} smaller?`}
          message={`About ${formatSize(totalSaving)} will be freed. Each original is deleted once its smaller copy has been checked; this can't be undone.`}
          confirmLabel="Make all smaller"
          onConfirm={makeAllSmaller}
          onCancel={() => setConfirmAll(false)}
        />
      )}
    </div>
  );
};
