import React, { useState, useEffect, useCallback, useMemo } from "react";
import { 
  ArrowLeft, 
  Sparkles, 
  RefreshCw, 
  HardDrive, 
  Zap, 
  CheckCircle2, 
  Play, 
  Cpu, 
  ShieldCheck, 
  TrendingDown
} from "lucide-react";
import { VideoCandidate, VideoSummary, VideoOptimizationProgress, PhotoItem } from "../types";

const API_BASE = "http://127.0.0.1:8000/api";

interface VideoOptimizerViewProps {
  onBack: () => void;
  onPhotoClick?: (index: number, photos: PhotoItem[]) => void;
  onRefreshTelemetry?: () => void;
}

/**
 * Formats byte counts into human-readable strings (B, KB, MB, GB).
 */
function formatBytes(bytes: number, decimals: number = 1): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

/**
 * VideoOptimizerView Component
 *
 * Enterprise video workspace providing:
 * 1. Space Saver: Visually lossless H.265 transcoding with audio bitstream copying.
 * 2. Vintage Restorer: Multi-stage temporal denoising and Lanczos HD upscaling for vintage clips.
 * 3. 30-Day Trash safety guard and hardware-accelerated encoder self-discovery.
 */
export const VideoOptimizerView: React.FC<VideoOptimizerViewProps> = ({
  onBack,
  onPhotoClick,
  onRefreshTelemetry,
}) => {
  const [activeTab, setActiveTab] = useState<"compress" | "enhance">("compress");
  const [summary, setSummary] = useState<VideoSummary | null>(null);
  const [candidates, setCandidates] = useState<VideoCandidate[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [targetHeights, setTargetHeights] = useState<Record<number, number>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<VideoOptimizationProgress | null>(null);

  // Load summary and candidates from API
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sumRes, candRes] = await Promise.all([
        fetch(`${API_BASE}/videos/summary`),
        fetch(`${API_BASE}/videos/candidates`),
      ]);

      if (sumRes.ok) {
        const sumData: VideoSummary = await sumRes.json();
        setSummary(sumData);
      }
      if (candRes.ok) {
        const candData: VideoCandidate[] = await candRes.json();
        setCandidates(candData);
      }
    } catch (err) {
      console.error("Failed to load video optimization data:", err);
      setStatusMessage("Failed to connect to video optimization engine.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll video optimization progress in real-time
  useEffect(() => {
    let wasActive = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/videos/optimization-progress`);
        if (res.ok) {
          const data: VideoOptimizationProgress = await res.json();
          setVideoProgress(data);
          if (wasActive && !data.is_active) {
            fetchData();
            onRefreshTelemetry?.();
          }
          wasActive = data.is_active;
        }
      } catch {}
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchData, onRefreshTelemetry]);

  // Filter candidates by tab
  const compressibleVideos = useMemo(() => {
    return candidates.filter((c) => c.optimization_plan.action === "compress");
  }, [candidates]);

  const vintageVideos = useMemo(() => {
    return candidates.filter((c) => c.optimization_plan.action === "enhance");
  }, [candidates]);

  const totalCompressibleSavings = useMemo(() => {
    return compressibleVideos.reduce(
      (sum, c) => sum + (c.optimization_plan.projected_savings_bytes || 0),
      0
    );
  }, [compressibleVideos]);

  // Handle single video compression
  const handleCompressVideo = async (photoId: number) => {
    setProcessingIds((prev) => new Set(prev).add(photoId));
    setStatusMessage("Compressing video to visually lossless H.265...");
    try {
      const res = await fetch(`${API_BASE}/videos/${photoId}/compress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crf: 23 }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage(`Compressed! Saved ${formatBytes(data.saved_bytes)} (${data.savings_pct}% reduction).`);
        await fetchData();
        onRefreshTelemetry?.();
      } else {
        setStatusMessage(data.error || "Compression skipped: " + (data.message || "Quality guard"));
      }
    } catch (err) {
      console.error("Compression request failed:", err);
      setStatusMessage("Error communicating with compression service.");
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  };

  // Handle batch compression of all candidates
  const handleCompressAll = async () => {
    if (compressibleVideos.length === 0) return;
    setIsBatchProcessing(true);
    setStatusMessage(`Batch optimizing ${compressibleVideos.length} heavy videos...`);
    try {
      const res = await fetch(`${API_BASE}/videos/compress-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crf: 23 }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage(
          `Batch optimization complete! Reclaimed ${formatBytes(data.total_saved_bytes)} across ${data.optimized_count} videos.`
        );
        await fetchData();
        onRefreshTelemetry?.();
      } else {
        setStatusMessage(data.detail || "Batch optimization encountered an issue.");
      }
    } catch (err) {
      console.error("Batch compression failed:", err);
      setStatusMessage("Failed to execute batch compression.");
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Handle single vintage video enhancement
  const handleEnhanceVideo = async (photoId: number) => {
    const targetH = targetHeights[photoId] || 720;
    setProcessingIds((prev) => new Set(prev).add(photoId));
    setStatusMessage(`Restoring & upscaling clip to ${targetH}p HD with temporal denoising...`);
    try {
      const res = await fetch(`${API_BASE}/videos/${photoId}/enhance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_height: targetH, denoise: true, deinterlace: true }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage(`Enhanced clip successfully to ${data.width}x${data.height} HD!`);
        await fetchData();
        onRefreshTelemetry?.();
      } else {
        setStatusMessage(data.error || "Enhancement failed.");
      }
    } catch (err) {
      console.error("Enhancement request failed:", err);
      setStatusMessage("Error communicating with video enhancement service.");
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  };

  return (
    <div 
      style={{ 
        flex: 1, 
        display: "flex", 
        flexDirection: "column", 
        height: "100%", 
        overflow: "hidden", 
        backgroundColor: "var(--bg-app)" 
      }}
    >
      {/* ── Section 4 Modern-Web-UI Floating Liquid Glass Header ───────────── */}
      <div
        style={{
          margin: "12px 16px 8px 16px",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid var(--glass-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--glass-shadow)",
          color: "var(--text-primary)",
          zIndex: 10,
        }}
      >
        {/* Left Column (flex: 1): Navigation and Tab Switcher Pills */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={onBack}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-border)",
              color: "var(--text-secondary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <ArrowLeft size={13} />
            <span>Dashboard</span>
          </button>

          <button
            onClick={fetchData}
            disabled={isLoading}
            className="clickable"
            title="Refresh video candidates and telemetry"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-border)",
              color: isLoading ? "var(--accent-primary)" : "var(--text-secondary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: isLoading ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <RefreshCw size={12} className={isLoading ? "spin-animation" : ""} />
            <span>Refresh</span>
          </button>

          {/* Tab Filter Switcher */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "2px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-border)",
            }}
          >
            <button
              onClick={() => setActiveTab("compress")}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "4px 12px",
                borderRadius: "var(--radius-full)",
                backgroundColor: activeTab === "compress" ? "var(--accent-primary)" : "transparent",
                border: "none",
                color: activeTab === "compress" ? "#ffffff" : "var(--text-secondary)",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <HardDrive size={11} />
              <span>Space Saver ({compressibleVideos.length})</span>
            </button>

            <button
              onClick={() => setActiveTab("enhance")}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "4px 12px",
                borderRadius: "var(--radius-full)",
                backgroundColor: activeTab === "enhance" ? "var(--accent-primary)" : "transparent",
                border: "none",
                color: activeTab === "enhance" ? "#ffffff" : "var(--text-secondary)",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <Sparkles size={11} />
              <span>Vintage Restorer ({vintageVideos.length})</span>
            </button>
          </div>
        </div>

        {/* Center Column (flex: 0 1 auto): Centered Title & Inline Capsule Badge */}
        <div
          style={{
            flex: "0 1 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "22px",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              fontFamily: "Plus Jakarta Sans, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            Video Optimizer
          </h1>

          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "4px 12px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-border)",
              color: "var(--accent-primary)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            {activeTab === "compress"
              ? `${compressibleVideos.length} candidates • ~${formatBytes(totalCompressibleSavings)} Reclaimable`
              : `${vintageVideos.length} vintage clips ready for HD enhancement`}
          </span>
        </div>

        {/* Right Column (flex: 1): Primary Batch Action Pill */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
          {activeTab === "compress" && (
            <button
              onClick={handleCompressAll}
              disabled={compressibleVideos.length === 0 || isBatchProcessing || videoProgress?.is_active}
              className="clickable"
              title="Automatically transcode all heavy videos to visually lossless H.265"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 16px",
                borderRadius: "var(--radius-full)",
                backgroundColor:
                  compressibleVideos.length > 0 && !videoProgress?.is_active
                    ? "var(--accent-primary)"
                    : "var(--glass-pill-bg)",
                border: `1px solid ${compressibleVideos.length > 0 && !videoProgress?.is_active ? "transparent" : "var(--glass-border)"}`,
                color: compressibleVideos.length > 0 && !videoProgress?.is_active ? "#ffffff" : "var(--text-muted)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: compressibleVideos.length === 0 || isBatchProcessing || videoProgress?.is_active ? "not-allowed" : "pointer",
                boxShadow: compressibleVideos.length > 0 && !videoProgress?.is_active ? "0 2px 10px var(--accent-glow)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              <Zap size={13} className={isBatchProcessing || videoProgress?.is_active ? "spin-animation" : ""} />
              <span>
                {videoProgress?.is_active
                  ? videoProgress.total_count > 1
                    ? `Optimizing (${videoProgress.completed_count + 1} of ${videoProgress.total_count})...`
                    : "Optimizing..."
                  : isBatchProcessing
                  ? "Compressing All..."
                  : `Compress All (~${formatBytes(totalCompressibleSavings)})`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* ── Engine & Safety Status Banner ─────────────────────────────────── */}
      <div
        style={{
          margin: "0 16px 8px 16px",
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--glass-surface)",
          border: "1px solid var(--glass-border)",
          fontSize: "11px",
          color: "var(--text-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Cpu size={13} style={{ color: "var(--accent-primary)" }} />
            <span>
              <strong>Encoder:</strong>{" "}
              {summary?.encoder_info
                ? `${summary.encoder_info.encoder} (${summary.encoder_info.type === "hardware" ? "GPU Hardware Accelerated" : "High-Fidelity CPU"})`
                : "libx265 (CPU Fallback)"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <ShieldCheck size={13} style={{ color: "var(--accent-success, #10b981)" }} />
            <span>
              <strong>Zero Data Loss:</strong> Originals preserved in 30-Day Trash (.trash/)
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Zap size={13} style={{ color: "#f59e0b" }} />
            <span>
              <strong>Lossless Audio:</strong> Bitstream audio copy (-c:a copy)
            </span>
          </div>
        </div>

        {videoProgress?.is_active ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontWeight: 700, color: "var(--accent-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
              <RefreshCw size={12} className="spin-animation" />
              <span>
                {videoProgress.total_count > 1
                  ? `Optimizing video (${videoProgress.completed_count + 1} of ${videoProgress.total_count}): ${videoProgress.active_filename || "Transcoding"}`
                  : `Optimizing video: ${videoProgress.active_filename || "Transcoding"}`}
              </span>
            </span>
            {(videoProgress.total_reclaimed_bytes ?? 0) > 0 && (
              <span style={{ color: "var(--accent-success, #10b981)", fontWeight: 600 }}>
                (Reclaimed {formatBytes(videoProgress.total_reclaimed_bytes ?? 0)} so far)
              </span>
            )}
          </div>
        ) : statusMessage ? (
          <span style={{ fontWeight: 600, color: "var(--text-primary)", fontStyle: "italic" }}>
            {statusMessage}
          </span>
        ) : null}
      </div>

      {/* ── Main Scrollable Workspace ──────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 16px 24px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {activeTab === "compress" ? (
          // ── Space Saver Candidate Cards ──
          compressibleVideos.length === 0 ? (
            <div
              style={{
                flex: 1,
                minHeight: "300px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--glass-surface)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--glass-border)",
                padding: "32px",
                textAlign: "center",
              }}
            >
              <CheckCircle2 size={48} style={{ color: "var(--accent-success, #10b981)", marginBottom: "12px" }} />
              <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>
                Library Perfectly Optimized
              </h3>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)", maxWidth: "420px" }}>
                All your videos are already encoded in modern, high-efficiency codecs (H.265/AV1) or are already compact. Zero disk space wasted!
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
                gap: "12px",
              }}
            >
              {compressibleVideos.map((video) => {
                const isThisVideoActive = videoProgress?.is_active && videoProgress.active_video_id === video.id;
                const isProcessing = processingIds.has(video.id) || isBatchProcessing || isThisVideoActive;
                const isBatchQueued = videoProgress?.is_active && !isThisVideoActive;
                const thumbUrl = `http://127.0.0.1:8000/api/photos/${video.id}/thumbnail`;

                return (
                  <div
                    key={video.id}
                    style={{
                      display: "flex",
                      backgroundColor: "var(--glass-surface)",
                      borderRadius: "var(--radius-lg)",
                      border: isThisVideoActive ? "1px solid var(--accent-primary)" : "1px solid var(--glass-border)",
                      overflow: "hidden",
                      boxShadow: isThisVideoActive ? "0 0 12px var(--accent-glow)" : "var(--glass-shadow)",
                      transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                    }}
                  >
                    {/* Video Thumbnail Preview */}
                    <div
                      style={{
                        position: "relative",
                        width: "130px",
                        minWidth: "130px",
                        backgroundColor: "#000000",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                      onClick={() => onPhotoClick?.(0, [video as unknown as PhotoItem])}
                    >
                      <img
                        src={thumbUrl}
                        alt={video.filename}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          bottom: "6px",
                          left: "6px",
                          padding: "2px 6px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "rgba(0,0,0,0.7)",
                          color: "#ffffff",
                          fontSize: "9px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        <Play size={8} fill="#ffffff" />
                        <span>
                          {video.duration
                            ? `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, "0")}`
                            : "VIDEO"}
                        </span>
                      </div>
                    </div>

                    {/* Details and Action */}
                    <div
                      style={{
                        flex: 1,
                        padding: "12px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        minWidth: 0,
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                          <span
                            style={{
                              fontSize: "12px",
                              fontWeight: 700,
                              color: "var(--text-primary)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={video.filename}
                          >
                            {video.filename}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: "var(--radius-xs)",
                              backgroundColor: "var(--glass-pill-bg)",
                              border: "1px solid var(--glass-border)",
                              color: "var(--accent-primary)",
                              textTransform: "uppercase",
                            }}
                          >
                            {video.codec || "H.264"}
                          </span>
                        </div>

                        {/* Specs & Savings Grid */}
                        <div
                          style={{
                            marginTop: "8px",
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "4px",
                            fontSize: "11px",
                          }}
                        >
                          <div>
                            <span style={{ color: "var(--text-muted)", display: "block", fontSize: "10px" }}>Current Size</span>
                            <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{formatBytes(video.file_size)}</span>
                          </div>
                          <div>
                            <span style={{ color: "var(--text-muted)", display: "block", fontSize: "10px" }}>Estimated H.265</span>
                            <span style={{ fontWeight: 600, color: "var(--accent-success, #10b981)" }}>
                              ~{formatBytes(video.file_size - video.optimization_plan.projected_savings_bytes)}
                            </span>
                          </div>
                        </div>

                        {/* Savings pill */}
                        <div
                          style={{
                            marginTop: "6px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 6px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "rgba(16, 185, 129, 0.1)",
                            color: "var(--accent-success, #10b981)",
                            fontSize: "10px",
                            fontWeight: 700,
                          }}
                        >
                          <TrendingDown size={11} />
                          <span>Reclaims ~{formatBytes(video.optimization_plan.projected_savings_bytes)} (-{video.optimization_plan.projected_savings_pct}%)</span>
                        </div>
                      </div>

                      {/* Compress Button */}
                      <button
                        onClick={() => handleCompressVideo(video.id)}
                        disabled={isProcessing || isBatchQueued}
                        className="clickable"
                        style={{
                          marginTop: "8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: isProcessing
                            ? "var(--glass-pill-bg)"
                            : isBatchQueued
                            ? "var(--glass-pill-bg)"
                            : "var(--accent-primary)",
                          border: "1px solid var(--glass-border)",
                          color: isProcessing
                            ? "var(--accent-primary)"
                            : isBatchQueued
                            ? "var(--text-muted)"
                            : "#ffffff",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: isProcessing || isBatchQueued ? "not-allowed" : "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <Zap size={11} className={isProcessing ? "spin-animation" : ""} />
                        <span>{isProcessing ? "Compressing..." : isBatchQueued ? "Queued" : "Compress (H.265)"}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          // ── Vintage Restorer Candidate Cards ──
          vintageVideos.length === 0 ? (
            <div
              style={{
                flex: 1,
                minHeight: "300px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--glass-surface)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--glass-border)",
                padding: "32px",
                textAlign: "center",
              }}
            >
              <Sparkles size={48} style={{ color: "var(--accent-primary)", marginBottom: "12px" }} />
              <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>
                No Vintage Low-Res Videos Detected
              </h3>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)", maxWidth: "420px" }}>
                All videos in your library are already in high definition (720p HD or higher). Any older 240p/360p clips added in the future will automatically appear here.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
                gap: "12px",
              }}
            >
              {vintageVideos.map((video) => {
                const isThisVideoActive = videoProgress?.is_active && videoProgress.active_video_id === video.id;
                const isProcessing = processingIds.has(video.id) || isThisVideoActive;
                const isBatchQueued = videoProgress?.is_active && !isThisVideoActive;
                const thumbUrl = `http://127.0.0.1:8000/api/photos/${video.id}/thumbnail`;
                const targetH = targetHeights[video.id] || 720;

                return (
                  <div
                    key={video.id}
                    style={{
                      display: "flex",
                      backgroundColor: "var(--glass-surface)",
                      borderRadius: "var(--radius-lg)",
                      border: isThisVideoActive ? "1px solid var(--accent-primary)" : "1px solid var(--glass-border)",
                      overflow: "hidden",
                      boxShadow: isThisVideoActive ? "0 0 12px var(--accent-glow)" : "var(--glass-shadow)",
                      transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                    }}
                  >
                    {/* Thumbnail Preview */}
                    <div
                      style={{
                        position: "relative",
                        width: "130px",
                        minWidth: "130px",
                        backgroundColor: "#000000",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                      onClick={() => onPhotoClick?.(0, [video as unknown as PhotoItem])}
                    >
                      <img
                        src={thumbUrl}
                        alt={video.filename}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          bottom: "6px",
                          left: "6px",
                          padding: "2px 6px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "rgba(0,0,0,0.7)",
                          color: "#ffffff",
                          fontSize: "9px",
                          fontWeight: 700,
                        }}
                      >
                        {video.width} × {video.height}
                      </div>
                    </div>

                    {/* Details & Enhancement Controls */}
                    <div
                      style={{
                        flex: 1,
                        padding: "12px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        minWidth: 0,
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span
                            style={{
                              fontSize: "12px",
                              fontWeight: 700,
                              color: "var(--text-primary)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={video.filename}
                          >
                            {video.filename}
                          </span>
                          <span
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: "var(--radius-xs)",
                              backgroundColor: "rgba(245, 158, 11, 0.12)",
                              border: "1px solid rgba(245, 158, 11, 0.3)",
                              color: "#f59e0b",
                            }}
                          >
                            Vintage {video.height}p
                          </span>
                        </div>

                        {/* Upscaling Features */}
                        <div style={{ marginTop: "6px", fontSize: "10px", color: "var(--text-muted)" }}>
                          3D Temporal Denoising (hqdn3d) + Yadif De-interlace + Lanczos Unsharp Upscaling
                        </div>

                        {/* Target Resolution Radio */}
                        <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                          <button
                            onClick={() => setTargetHeights((prev) => ({ ...prev, [video.id]: 720 }))}
                            style={{
                              padding: "3px 8px",
                              borderRadius: "var(--radius-full)",
                              backgroundColor: targetH === 720 ? "var(--accent-primary)" : "var(--glass-pill-bg)",
                              border: "1px solid var(--glass-border)",
                              color: targetH === 720 ? "#ffffff" : "var(--text-secondary)",
                              fontSize: "10px",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            720p HD
                          </button>
                          <button
                            onClick={() => setTargetHeights((prev) => ({ ...prev, [video.id]: 1080 }))}
                            style={{
                              padding: "3px 8px",
                              borderRadius: "var(--radius-full)",
                              backgroundColor: targetH === 1080 ? "var(--accent-primary)" : "var(--glass-pill-bg)",
                              border: "1px solid var(--glass-border)",
                              color: targetH === 1080 ? "#ffffff" : "var(--text-secondary)",
                              fontSize: "10px",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            1080p FHD
                          </button>
                        </div>
                      </div>

                      {/* Enhance Button */}
                      <button
                        onClick={() => handleEnhanceVideo(video.id)}
                        disabled={isProcessing || isBatchQueued}
                        className="clickable"
                        style={{
                          marginTop: "8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: isProcessing
                            ? "var(--glass-pill-bg)"
                            : isBatchQueued
                            ? "var(--glass-pill-bg)"
                            : "var(--accent-primary)",
                          border: "1px solid var(--glass-border)",
                          color: isProcessing
                            ? "var(--accent-primary)"
                            : isBatchQueued
                            ? "var(--text-muted)"
                            : "#ffffff",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: isProcessing || isBatchQueued ? "not-allowed" : "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <Sparkles size={11} className={isProcessing ? "spin-animation" : ""} />
                        <span>{isProcessing ? "Enhancing..." : isBatchQueued ? "Queued" : `Enhance to ${targetH}p HD`}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
};
