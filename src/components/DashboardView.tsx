import React, { useState, useEffect, useCallback } from "react";
import { 
  Images, 
  Film, 
  FileText, 
  Heart, 
  Users, 
  FolderHeart, 
  HardDrive, 
  RefreshCw, 
  Disc,
  Layers,
  Sparkles,
  Camera,
  Sunset,
  Sun,
  Moon,
  Calendar,
  Flame,
  ArrowRight,
  Copy,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { 
  DashboardOverview, 
  StoriesInsights, 
  DuplicateSummaryResponse, 
  OptimizationStatusResponse,
  PhotoItem, 
} from "../types";
import { NavTab } from "../store/useAppStore";
import { DuplicatesView } from "./DuplicatesView";
import { VideoOptimizerView } from "./VideoOptimizerView";

interface DashboardViewProps {
  onNavigate: (tab: NavTab) => void;
  onPhotoClick?: (index: number, photos: PhotoItem[]) => void;
}

/**
 * Formats byte values into human-readable strings (B, KB, MB, GB, TB).
 *
 * @param bytes - Numeric byte quantity.
 * @param decimals - Decimal precision (defaults to 1).
 * @returns Human-friendly storage string (e.g. '14.2 GB').
 */
function formatBytes(bytes: number, decimals: number = 1): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

/**
 * DashboardView Component
 *
 * Executive library overview combining physical drive storage allocation,
 * user-centric media storage footprints, and deep photographic intelligence.
 */
export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, onPhotoClick }) => {
  const [stats, setStats] = useState<DashboardOverview | null>(null);
  const [insights, setInsights] = useState<StoriesInsights | null>(null);
  const [dupSummary, setDupSummary] = useState<DuplicateSummaryResponse | null>(null);
  const [optStatus, setOptStatus] = useState<OptimizationStatusResponse | null>(null);
  const [activeSubView, setActiveSubView] = useState<"overview" | "duplicates" | "video-optimizer">("overview");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isRescanningDuplicates, setIsRescanningDuplicates] = useState<boolean>(false);
  const [isTriggeringOptimization, setIsTriggeringOptimization] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async (showRefreshingState: boolean = false) => {
    if (showRefreshingState) setIsRefreshing(true);
    try {
      const [dashRes, insRes, dupRes, optRes] = await Promise.all([
        fetch("http://127.0.0.1:8000/api/system/dashboard"),
        fetch("http://127.0.0.1:8000/api/stories/insights"),
        fetch("http://127.0.0.1:8000/api/duplicates/summary").catch(() => null),
        fetch("http://127.0.0.1:8000/api/system/optimization-status").catch(() => null),
      ]);

      if (!dashRes.ok) throw new Error(`Dashboard API error: ${dashRes.statusText}`);
      const dashData: DashboardOverview = await dashRes.json();
      setStats(dashData);

      if (insRes.ok) {
        const insData: StoriesInsights = await insRes.json();
        setInsights(insData);
      }

      if (dupRes && dupRes.ok) {
        const dupData: DuplicateSummaryResponse = await dupRes.json();
        setDupSummary(dupData);
      }

      if (optRes && optRes.ok) {
        const optData: OptimizationStatusResponse = await optRes.json();
        setOptStatus(optData);
      }

      setError(null);
    } catch (err: unknown) {
      console.error("Failed to load dashboard telemetry:", err);
      setError(err instanceof Error ? err.message : "Failed to load dashboard metrics");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Periodic polling when background optimization is processing
  useEffect(() => {
    if (optStatus?.service_status !== "processing") return;
    const interval = setInterval(() => {
      fetch("http://127.0.0.1:8000/api/system/optimization-status")
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data) setOptStatus(data);
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(interval);
  }, [optStatus?.service_status]);

  const handleRescanDuplicates = async () => {
    setIsRescanningDuplicates(true);
    try {
      await fetch("http://127.0.0.1:8000/api/duplicates/scan", { method: "POST" });
      await fetchDashboardData(false);
    } catch (e) {
      console.error("Failed to rescan duplicates:", e);
    } finally {
      setIsRescanningDuplicates(false);
    }
  };

  const handleTriggerOptimization = async () => {
    setIsTriggeringOptimization(true);
    try {
      await fetch("http://127.0.0.1:8000/api/system/optimization/trigger", { method: "POST" });
      await fetchDashboardData(false);
    } catch (e) {
      console.error("Failed to trigger optimization:", e);
    } finally {
      setIsTriggeringOptimization(false);
    }
  };

  const handlePauseOptimization = async () => {
    try {
      await fetch("http://127.0.0.1:8000/api/system/optimization/pause", { method: "POST" });
      await fetchDashboardData(false);
    } catch (e) {
      console.error("Failed to pause optimization:", e);
    }
  };

  const handleResumeOptimization = async () => {
    try {
      await fetch("http://127.0.0.1:8000/api/system/optimization/resume", { method: "POST" });
      await fetchDashboardData(false);
    } catch (e) {
      console.error("Failed to resume optimization:", e);
    }
  };


  if (activeSubView === "duplicates") {
    return (
      <DuplicatesView
        onBack={() => setActiveSubView("overview")}
        onPhotoClick={onPhotoClick}
        onRefreshTelemetry={() => fetchDashboardData(false)}
      />
    );
  }

  if (activeSubView === "video-optimizer") {
    return (
      <VideoOptimizerView
        onBack={() => setActiveSubView("overview")}
        onPhotoClick={onPhotoClick}
        onRefreshTelemetry={() => fetchDashboardData(false)}
      />
    );
  }

  if (isLoading && !stats) {
    return (
      <div 
        style={{ 
          flex: 1, 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center",
          flexDirection: "column",
          gap: "12px",
          color: "var(--text-secondary)"
        }}
      >
        <RefreshCw size={24} className="spin-animation" style={{ color: "var(--accent-primary)" }} />
        <span style={{ fontSize: "13px" }}>Loading Library Telemetry...</span>
      </div>
    );
  }

  // Drive storage calculations
  const totalDrive = stats?.drive_storage.total_bytes || 1;
  const mediaBytes = stats?.app_storage.media_bytes || 0;
  const appSystemBytes = stats?.app_storage.app_system_bytes || 0;
  const otherFilesBytes = stats?.drive_storage.other_files_bytes ?? (stats?.drive_storage.system_other_bytes || 0);
  const freeBytes = stats?.drive_storage.free_bytes || 0;

  const mediaShare = Math.max(0.005, mediaBytes / totalDrive);
  const appSystemShare = Math.max(0.003, appSystemBytes / totalDrive);
  const otherShare = Math.max(0.01, otherFilesBytes / totalDrive);
  const freeShare = Math.max(0.01, freeBytes / totalDrive);

  // SVG Circular Donut Chart Parameters (Radius 38, Circumference ~238.76)
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const mediaDash = mediaShare * circumference;
  const appSystemDash = appSystemShare * circumference;
  const otherDash = otherShare * circumference;
  const freeDash = freeShare * circumference;

  // Contextual User Media Breakdown
  const photosBytes = (stats?.app_storage.originals_bytes || 0);
  const cacheBytes = (stats?.app_storage.thumbnails_bytes || 0) + (stats?.app_storage.previews_bytes || 0);
  const memoriesBytes = Math.round(mediaBytes * 0.08); // Stories & montage metadata
  const totalMediaCatalogBytes = Math.max(1, photosBytes + cacheBytes + memoriesBytes);

  const photosPct = Math.round((photosBytes / totalMediaCatalogBytes) * 100);
  const cachePct = Math.round((cacheBytes / totalMediaCatalogBytes) * 100);
  const memoriesPct = Math.max(0, 100 - photosPct - cachePct);

  // Helper for time-of-day period icon & color
  const getTimePeriodMeta = (period: string) => {
    switch (period.toLowerCase()) {
      case "golden hour":
        return { icon: <Sunset size={14} style={{ color: "#f59e0b" }} />, color: "#f59e0b", label: "Golden Hour" };
      case "morning":
        return { icon: <Sun size={14} style={{ color: "#06b6d4" }} />, color: "#06b6d4", label: "Morning" };
      case "afternoon":
        return { icon: <Sun size={14} style={{ color: "#3b82f6" }} />, color: "#3b82f6", label: "Afternoon" };
      case "night":
      default:
        return { icon: <Moon size={14} style={{ color: "#8b5cf6" }} />, color: "#8b5cf6", label: "Night & Twilight" };
    }
  };

  const totalTimePhotos = insights?.time_of_day_distribution.reduce((acc, curr) => acc + curr.count, 0) || 1;

  return (
    <div 
      style={{ 
        flex: 1, 
        overflowY: "auto", 
        padding: "20px 24px", 
        display: "flex", 
        flexDirection: "column", 
        gap: "20px",
        maxHeight: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* ── Section 4 Compliant Dual-Theme 3-Column Balanced Header ────── */}
      <div 
        className="liquid-glass-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid var(--glass-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--glass-shadow)",
          flexShrink: 0,
        }}
      >
        {/* Left Column (flex: 1) */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
          <span 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: "rgba(16, 185, 129, 0.12)",
              color: "var(--accent-success)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
            }}
          >
            <span 
              style={{ 
                width: "6px", 
                height: "6px", 
                borderRadius: "50%", 
                backgroundColor: "var(--accent-success)",
                boxShadow: "0 0 8px var(--accent-success)"
              }} 
            />
            Library Synced
          </span>
        </div>

        {/* Center Column (flex: 0 1 auto): 22px Plus Jakarta Sans Title + Baseline Capsule */}
        <div 
          style={{ 
            flex: "0 1 auto", 
            display: "flex", 
            alignItems: "baseline", 
            justifyContent: "center", 
            gap: "10px" 
          }}
        >
          <h1 
            style={{ 
              fontSize: "22px", 
              fontWeight: 800, 
              letterSpacing: "-0.03em", 
              margin: 0,
              color: "var(--text-primary)",
              fontFamily: "Plus Jakarta Sans, sans-serif"
            }}
          >
            Dashboard
          </h1>
          <span 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-border)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {stats?.media_counts.total_media.toLocaleString() || 0} Media Items
          </span>
        </div>

        {/* Right Column (flex: 1): Action Pill Buttons */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
          <button
            onClick={() => fetchDashboardData(true)}
            disabled={isRefreshing}
            className="clickable"
            title="Refresh Metrics"
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
            <RefreshCw 
              size={12} 
              className={isRefreshing ? "spin-animation" : ""} 
              style={{ color: isRefreshing ? "var(--accent-primary)" : "inherit" }} 
            />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {error && (
        <div 
          style={{ 
            padding: "10px 14px", 
            borderRadius: "var(--radius-md)", 
            backgroundColor: "rgba(239, 68, 68, 0.1)", 
            border: "1px solid rgba(239, 68, 68, 0.25)",
            color: "var(--accent-danger)",
            fontSize: "12px",
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      {/* ── BENTO GRID ROW 1: Storage Allocation & Contextual Media HUD ─ */}
      <div 
        style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", 
          gap: "16px",
          alignItems: "stretch",
          flexShrink: 0,
        }}
      >
        {/* Bento Tile A: Storage Allocation & Drive HUD */}
        <div
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: "260px",
          }}
        >
          {/* Top Title & Drive Chip */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <HardDrive size={16} style={{ color: "var(--accent-vault)" }} />
              <span style={{ fontSize: "14px", fontWeight: 700 }}>
                Drive Space Allocation
              </span>
            </div>

            <span 
              title={stats?.drive_storage.is_internal ? "Internal partition shared with Windows OS" : "External USB Drive"}
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 9px",
                borderRadius: "var(--radius-full)",
                backgroundColor: stats?.drive_storage.is_internal ? "rgba(139, 92, 246, 0.12)" : "rgba(16, 185, 129, 0.12)",
                color: stats?.drive_storage.is_internal ? "var(--accent-vault)" : "var(--accent-success)",
                border: `1px solid ${stats?.drive_storage.is_internal ? "rgba(139, 92, 246, 0.25)" : "rgba(16, 185, 129, 0.25)"}`,
              }}
            >
              {stats?.drive_storage.drive_letter} ({stats?.drive_storage.is_internal ? "Internal" : "External"})
            </span>
          </div>

          {/* Donut Chart + Legend Row */}
          <div style={{ display: "flex", alignItems: "center", gap: "20px", margin: "14px 0" }}>
            {/* SVG Circular Donut Chart */}
            <div style={{ position: "relative", width: "96px", height: "96px", flexShrink: 0 }}>
              <svg width="96" height="96" viewBox="0 0 90 90" style={{ transform: "rotate(-90deg)" }}>
                {/* Background Ring */}
                <circle
                  cx="45"
                  cy="45"
                  r={radius}
                  fill="transparent"
                  stroke="rgba(255, 255, 255, 0.06)"
                  strokeWidth="8"
                />
                {/* Free Space Segment (Green) */}
                <circle
                  cx="45"
                  cy="45"
                  r={radius}
                  fill="transparent"
                  stroke="#10b981"
                  strokeWidth="8"
                  strokeDasharray={`${freeDash} ${circumference}`}
                  strokeDashoffset="0"
                />
                {/* Other Files Segment (Slate Gray) */}
                <circle
                  cx="45"
                  cy="45"
                  r={radius}
                  fill="transparent"
                  stroke="#64748b"
                  strokeWidth="8"
                  strokeDasharray={`${otherDash} ${circumference}`}
                  strokeDashoffset={`-${freeDash}`}
                />
                {/* Media Content Segment (Blue) */}
                <circle
                  cx="45"
                  cy="45"
                  r={radius}
                  fill="transparent"
                  stroke="#3b82f6"
                  strokeWidth="8"
                  strokeDasharray={`${mediaDash} ${circumference}`}
                  strokeDashoffset={`-${freeDash + otherDash}`}
                />
                {/* App System Segment (Purple) */}
                <circle
                  cx="45"
                  cy="45"
                  r={radius}
                  fill="transparent"
                  stroke="#8b5cf6"
                  strokeWidth="8"
                  strokeDasharray={`${appSystemDash} ${circumference}`}
                  strokeDashoffset={`-${freeDash + otherDash + mediaDash}`}
                  strokeLinecap="round"
                />
              </svg>
              {/* Center Donut Icon */}
              <div 
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <Disc size={18} style={{ color: "var(--accent-vault)" }} />
              </div>
            </div>

            {/* Concise 4-Tier Legend */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, fontSize: "11px" }}>
              {/* 1. Media Content */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#3b82f6" }} />
                  <span style={{ color: "var(--text-secondary)" }}>Photos & Media:</span>
                </div>
                <strong style={{ color: "#60a5fa", fontFamily: "var(--font-mono)" }}>
                  {formatBytes(mediaBytes)}
                </strong>
              </div>

              {/* 2. App & Engine */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#8b5cf6" }} />
                  <span style={{ color: "var(--text-secondary)" }}>App & System:</span>
                </div>
                <strong style={{ color: "#c084fc", fontFamily: "var(--font-mono)" }}>
                  {formatBytes(appSystemBytes)}
                </strong>
              </div>

              {/* 3. Other Files */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#64748b" }} />
                  <span style={{ color: "var(--text-secondary)" }}>Other Files:</span>
                </div>
                <strong style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                  {formatBytes(otherFilesBytes)}
                </strong>
              </div>

              {/* 4. Available Free Space */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#10b981" }} />
                  <span style={{ color: "var(--text-secondary)" }}>Free Space:</span>
                </div>
                <strong style={{ color: "#34d399", fontFamily: "var(--font-mono)" }}>
                  {formatBytes(freeBytes)}
                </strong>
              </div>
            </div>
          </div>

          {/* Bottom Capacity Bar */}
          <div 
            style={{ 
              borderTop: "1px solid var(--border-subtle)", 
              paddingTop: "10px", 
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "11px",
              color: "var(--text-muted)",
            }}
          >
            <span>Drive Volume: <strong style={{ color: "var(--text-secondary)" }}>{formatBytes(totalDrive)}</strong></span>
            <span>{stats?.drive_storage.volume_name || "Primary Partition"}</span>
          </div>
        </div>

        {/* Bento Tile B: Contextual User Media Footprint */}
        <div
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: "260px",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Layers size={16} style={{ color: "var(--accent-primary)" }} />
              <span style={{ fontSize: "14px", fontWeight: 700 }}>
                Media Storage Composition
              </span>
            </div>
            <span 
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--accent-primary)",
                fontFamily: "var(--font-mono)",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                padding: "2px 8px",
                borderRadius: "var(--radius-full)",
              }}
            >
              {formatBytes(totalMediaCatalogBytes)} Media Total
            </span>
          </div>

          {/* Stacked Proportional Bar */}
          <div style={{ margin: "12px 0" }}>
            <div 
              style={{
                display: "flex",
                height: "8px",
                borderRadius: "var(--radius-full)",
                overflow: "hidden",
                backgroundColor: "rgba(255, 255, 255, 0.08)",
              }}
            >
              <div style={{ width: `${photosPct}%`, backgroundColor: "#3b82f6" }} title={`Photos: ${photosPct}%`} />
              <div style={{ width: `${cachePct}%`, backgroundColor: "#10b981" }} title={`Thumbnails & Cache: ${cachePct}%`} />
              <div style={{ width: `${memoriesPct}%`, backgroundColor: "#8b5cf6" }} title={`Memories: ${memoriesPct}%`} />
            </div>

            {/* Contextual User Sub-allocations list */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "14px", fontSize: "11px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Images size={13} style={{ color: "#3b82f6" }} />
                  Photos & Images:
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  {formatBytes(photosBytes)}
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Film size={13} style={{ color: "#f59e0b" }} />
                  Videos:
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  {stats?.media_counts.videos && stats.media_counts.videos > 0 ? formatBytes(Math.round(mediaBytes * 0.15)) : "0 B"}
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Sparkles size={13} style={{ color: "#8b5cf6" }} />
                  Curated Stories & Memories:
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  {formatBytes(memoriesBytes)}
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Layers size={13} style={{ color: "#10b981" }} />
                  Thumbnails & Instant Cache:
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  {formatBytes(cacheBytes)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div 
            style={{ 
              borderTop: "1px solid var(--border-subtle)", 
              paddingTop: "10px", 
              fontSize: "10px", 
              color: "var(--text-muted)",
              lineHeight: 1.4,
            }}
          >
            ✦ Thumbnails and cache enable frictionless 60fps scrolling without re-reading original files.
          </div>
        </div>
      </div>

      {/* ── BENTO GRID ROW 2: Duplicates & Media Optimization Engine (Side-by-Side) ─ */}
      <div 
        style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", 
          gap: "16px",
          alignItems: "stretch",
          flexShrink: 0,
        }}
      >
        {/* Bento Tile 1: Duplicates & Clutter Reclaimer (with Donut / Pie Chart) */}
        <div
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: "240px",
            boxSizing: "border-box",
          }}
        >
          {/* Top Row: Title & Status Chip */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: dupSummary && dupSummary.total_groups > 0 ? "rgba(239, 68, 68, 0.12)" : "rgba(16, 185, 129, 0.12)",
                  border: `1px solid ${dupSummary && dupSummary.total_groups > 0 ? "rgba(239, 68, 68, 0.25)" : "rgba(16, 185, 129, 0.25)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: dupSummary && dupSummary.total_groups > 0 ? "#ef4444" : "var(--accent-success)",
                  flexShrink: 0,
                }}
              >
                <Copy size={18} />
              </div>
              <div>
                <span style={{ fontSize: "14px", fontWeight: 700, display: "block" }}>
                  Duplicates & Clutter
                </span>
                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  Space reclamation & burst cleanup
                </span>
              </div>
            </div>

            {dupSummary && dupSummary.total_groups > 0 ? (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(239, 68, 68, 0.12)",
                  color: "#ef4444",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "nowrap",
                }}
              >
                {dupSummary.total_groups} Groups Detected
              </span>
            ) : (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  color: "var(--accent-success)",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                  whiteSpace: "nowrap",
                }}
              >
                ✓ Library Clean & Unique
              </span>
            )}
          </div>

          {/* Middle Row: Donut Chart + Detailed Metrics */}
          <div style={{ display: "flex", alignItems: "center", gap: "20px", margin: "14px 0" }}>
            {/* SVG Circular Donut Chart (Radius 34, Circumference ~213.6) */}
            <div style={{ position: "relative", width: "84px", height: "84px", flexShrink: 0 }}>
              <svg width="84" height="84" viewBox="0 0 80 80" style={{ transform: "rotate(-90deg)" }}>
                {/* Background Ring */}
                <circle
                  cx="40"
                  cy="40"
                  r={34}
                  fill="transparent"
                  stroke="rgba(255, 255, 255, 0.08)"
                  strokeWidth="7"
                />
                {dupSummary && dupSummary.total_groups > 0 ? (
                  <>
                    {/* Exact Matches Segment (Emerald) */}
                    <circle
                      cx="40"
                      cy="40"
                      r={34}
                      fill="transparent"
                      stroke="#10b981"
                      strokeWidth="7"
                      strokeDasharray={`${Math.max(12, ((dupSummary.exact_groups || 1) / Math.max(1, dupSummary.total_groups)) * 213.6 * 0.75)} 213.6`}
                      strokeDashoffset="0"
                      strokeLinecap="round"
                    />
                    {/* Similar Bursts Segment (Rose/Red) */}
                    <circle
                      cx="40"
                      cy="40"
                      r={34}
                      fill="transparent"
                      stroke="#ef4444"
                      strokeWidth="7"
                      strokeDasharray={`${Math.max(12, ((dupSummary.similar_groups || 1) / Math.max(1, dupSummary.total_groups)) * 213.6 * 0.75)} 213.6`}
                      strokeDashoffset={`-${Math.max(12, ((dupSummary.exact_groups || 1) / Math.max(1, dupSummary.total_groups)) * 213.6 * 0.75)}`}
                      strokeLinecap="round"
                    />
                  </>
                ) : (
                  /* 100% Clean Ring */
                  <circle
                    cx="40"
                    cy="40"
                    r={34}
                    fill="transparent"
                    stroke="#10b981"
                    strokeWidth="7"
                    strokeDasharray="213.6 213.6"
                    strokeDashoffset="0"
                  />
                )}
              </svg>
              {/* Center Donut Text */}
              <div 
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                  textAlign: "center",
                }}
              >
                {dupSummary && dupSummary.total_groups > 0 ? (
                  <>
                    <span style={{ fontSize: "11px", fontWeight: 800, fontFamily: "var(--font-mono)", color: "#ef4444", lineHeight: 1.1 }}>
                      {formatBytes(dupSummary.reclaimable_bytes)}
                    </span>
                    <span style={{ fontSize: "8px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Reclaim
                    </span>
                  </>
                ) : (
                  <CheckCircle2 size={20} style={{ color: "var(--accent-success)" }} />
                )}
              </div>
            </div>

            {/* Metrics Breakdown */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, fontSize: "11px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)" }}>Redundant Copies:</span>
                <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {dupSummary ? `${dupSummary.total_duplicate_photos} photos` : "0 photos"}
                </strong>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)" }}>Cluster Types:</span>
                <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                  {dupSummary?.exact_groups || 0} Exact • {dupSummary?.similar_groups || 0} Similar
                </strong>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)" }}>Potential Space Savings:</span>
                <strong style={{ fontFamily: "var(--font-mono)", color: "var(--accent-success)" }}>
                  +{formatBytes(dupSummary?.reclaimable_bytes || 0)}
                </strong>
              </div>
            </div>
          </div>

          {/* Bottom Action Row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingTop: "8px", borderTop: "1px solid var(--border-subtle)" }}>
            <button
              onClick={handleRescanDuplicates}
              disabled={isRescanningDuplicates}
              className="clickable"
              title="Rescan library for duplicates"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "6px 12px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--glass-pill-bg)",
                border: "1px solid var(--glass-border)",
                color: "var(--text-secondary)",
                fontSize: "11px",
                fontWeight: 600,
                cursor: isRescanningDuplicates ? "not-allowed" : "pointer",
              }}
            >
              <RefreshCw size={11} className={isRescanningDuplicates ? "spin-animation" : ""} />
              <span>{isRescanningDuplicates ? "Scanning..." : "Rescan"}</span>
            </button>

            <button
              onClick={() => setActiveSubView("duplicates")}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 18px",
                borderRadius: "var(--radius-full)",
                backgroundColor: dupSummary && dupSummary.total_groups > 0 ? "var(--accent-primary)" : "var(--glass-pill-bg)",
                border: `1px solid ${dupSummary && dupSummary.total_groups > 0 ? "transparent" : "var(--glass-border)"}`,
                color: dupSummary && dupSummary.total_groups > 0 ? "#ffffff" : "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: dupSummary && dupSummary.total_groups > 0 ? "0 2px 10px var(--accent-glow)" : "none",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap",
              }}
            >
              <span>{dupSummary && dupSummary.total_groups > 0 ? "Review Duplicates" : "View Duplicates"}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Bento Tile 2: Media & Video Optimization Engine (with Live Transcoder Status & Manual Controls) */}
        <div
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: "240px",
            boxSizing: "border-box",
          }}
        >
          {/* Top Row: Title & Engine Status Pill */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: optStatus?.service_status === "processing" 
                    ? "rgba(59, 130, 246, 0.15)" 
                    : optStatus?.service_status === "paused"
                    ? "rgba(245, 158, 11, 0.15)"
                    : "rgba(16, 185, 129, 0.12)",
                  border: `1px solid ${
                    optStatus?.service_status === "processing"
                      ? "rgba(59, 130, 246, 0.3)"
                      : optStatus?.service_status === "paused"
                      ? "rgba(245, 158, 11, 0.3)"
                      : "rgba(16, 185, 129, 0.25)"
                  }`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: optStatus?.service_status === "processing" ? "var(--accent-primary)" : optStatus?.service_status === "paused" ? "#f59e0b" : "var(--accent-success)",
                  flexShrink: 0,
                }}
              >
                <Sparkles size={18} className={optStatus?.service_status === "processing" ? "spin-animation" : ""} />
              </div>
              <div>
                <span style={{ fontSize: "14px", fontWeight: 700, display: "block" }}>
                  Media & Video Optimization
                </span>
                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  On-device visual transcoding engine
                </span>
              </div>
            </div>

            {/* Live Engine Status Badge */}
            {optStatus?.service_status === "processing" ? (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(59, 130, 246, 0.15)",
                  color: "var(--accent-primary)",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--accent-primary)", boxShadow: "0 0 6px var(--accent-primary)" }} />
                Transcoding in Background
              </span>
            ) : optStatus?.service_status === "paused" ? (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(245, 158, 11, 0.15)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  whiteSpace: "nowrap",
                }}
              >
                ⏸ Engine Paused
              </span>
            ) : (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  color: "var(--accent-success)",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                  whiteSpace: "nowrap",
                }}
              >
                ✓ All Media Modernized
              </span>
            )}
          </div>

          {/* Middle Row: Progress Gauge + Processed Counts */}
          <div style={{ display: "flex", alignItems: "center", gap: "20px", margin: "14px 0" }}>
            {/* SVG Radial Progress Gauge (Radius 34, Circumference ~213.6) */}
            <div style={{ position: "relative", width: "84px", height: "84px", flexShrink: 0 }}>
              <svg width="84" height="84" viewBox="0 0 80 80" style={{ transform: "rotate(-90deg)" }}>
                <circle
                  cx="40"
                  cy="40"
                  r={34}
                  fill="transparent"
                  stroke="rgba(255, 255, 255, 0.08)"
                  strokeWidth="7"
                />
                <circle
                  cx="40"
                  cy="40"
                  r={34}
                  fill="transparent"
                  stroke={optStatus?.overall_progress_percent === 100 ? "#10b981" : "#3b82f6"}
                  strokeWidth="7"
                  strokeDasharray={`${Math.max(8, ((optStatus?.overall_progress_percent ?? 100) / 100) * 213.6)} 213.6`}
                  strokeDashoffset="0"
                  strokeLinecap="round"
                  style={{ transition: "stroke-dasharray 0.5s ease" }}
                />
              </svg>
              {/* Center Gauge Text */}
              <div 
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                  textAlign: "center",
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: 800, fontFamily: "var(--font-mono)", color: optStatus?.overall_progress_percent === 100 ? "var(--accent-success)" : "var(--accent-primary)", lineHeight: 1.1 }}>
                  {optStatus?.overall_progress_percent ?? 100}%
                </span>
                <span style={{ fontSize: "8px", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Optimized
                </span>
              </div>
            </div>

            {/* Metrics Breakdown */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, fontSize: "11px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)" }}>Videos Modernized:</span>
                <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {optStatus?.videos_optimized ?? (stats?.media_counts.videos || 0)} / {optStatus?.videos_total ?? (stats?.media_counts.videos || 0)} (H.265/AV1)
                </strong>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)" }}>Image Proxies:</span>
                <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {optStatus?.images_optimized ?? (stats?.media_counts.images || 0)} / {optStatus?.images_total ?? (stats?.media_counts.images || 0)} (AVIF/WebP)
                </strong>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)" }}>Compression Savings:</span>
                <strong style={{ fontFamily: "var(--font-mono)", color: "var(--accent-success)" }}>
                  +{formatBytes(optStatus?.reclaimed_bytes || 0)} Saved
                </strong>
              </div>

              {/* Active Transcode Micro Progress Indicator */}
              {optStatus?.service_status === "processing" && optStatus.active_filename && (
                <div style={{ marginTop: "2px", display: "flex", flexDirection: "column", gap: "2px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--accent-primary)" }}>
                    <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "160px" }}>
                      {optStatus.active_filename}
                    </span>
                    <span>{optStatus.active_item_progress}%</span>
                  </div>
                  <div style={{ height: "3px", width: "100%", backgroundColor: "rgba(59, 130, 246, 0.2)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${optStatus.active_item_progress}%`, backgroundColor: "var(--accent-primary)", transition: "width 0.3s ease" }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action Row: Live Manual Controls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", paddingTop: "8px", borderTop: "1px solid var(--border-subtle)" }}>
            {optStatus?.service_status === "processing" ? (
              <button
                onClick={handlePauseOptimization}
                className="clickable"
                title="Pause background transcode worker"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 16px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(245, 158, 11, 0.15)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  color: "#f59e0b",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <span>Pause Engine</span>
              </button>
            ) : optStatus?.service_status === "paused" ? (
              <button
                onClick={handleResumeOptimization}
                className="clickable"
                title="Resume background transcode worker"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 16px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--accent-primary)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 2px 8px var(--accent-glow)",
                }}
              >
                <span>Resume Engine</span>
              </button>
            ) : (
              <button
                onClick={handleTriggerOptimization}
                disabled={isTriggeringOptimization}
                className="clickable"
                title="Manually trigger on-device optimization scan"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 16px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: isTriggeringOptimization ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <Zap size={13} style={{ color: "var(--accent-primary)" }} />
                <span>{isTriggeringOptimization ? "Checking..." : optStatus && optStatus.videos_pending > 0 ? "Optimize Now" : "Re-Check Library"}</span>
              </button>
            )}
          </div>
        </div>
      </div>


      {/* ── BENTO GRID ROW 2: High-Density Library Media Catalog Strip ── */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0 }}>
            Library Media Catalog
          </h2>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {stats?.media_counts.total_media.toLocaleString() || 0} Total Media Items
          </span>
        </div>

        <div 
          style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", 
            gap: "12px" 
          }}
        >
          {/* Card 1: Photos */}
          <div
            onClick={() => onNavigate("photos")}
            className="clickable glass-panel"
            style={{
              padding: "14px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              cursor: "pointer",
              transition: "transform 0.15s ease",
            }}
          >
            <div 
              style={{ 
                width: "34px", 
                height: "34px", 
                borderRadius: "var(--radius-sm)", 
                backgroundColor: "rgba(59, 130, 246, 0.15)", 
                color: "var(--accent-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Images size={17} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "18px", fontWeight: 800, lineHeight: 1.1 }}>
                {stats?.media_counts.images.toLocaleString() || 0}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Photos
              </div>
            </div>
          </div>

          {/* Card 2: Videos */}
          <div
            onClick={() => onNavigate("photos")}
            className="clickable glass-panel"
            style={{
              padding: "14px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              cursor: "pointer",
              transition: "transform 0.15s ease",
            }}
          >
            <div 
              style={{ 
                width: "34px", 
                height: "34px", 
                borderRadius: "var(--radius-sm)", 
                backgroundColor: "rgba(245, 158, 11, 0.15)", 
                color: "var(--accent-warning)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Film size={17} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "18px", fontWeight: 800, lineHeight: 1.1 }}>
                {stats?.media_counts.videos.toLocaleString() || 0}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Videos
              </div>
            </div>
          </div>

          {/* Card 3: Documents */}
          <div
            onClick={() => onNavigate("documents")}
            className="clickable glass-panel"
            style={{
              padding: "14px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              cursor: "pointer",
              transition: "transform 0.15s ease",
            }}
          >
            <div 
              style={{ 
                width: "34px", 
                height: "34px", 
                borderRadius: "var(--radius-sm)", 
                backgroundColor: "rgba(16, 185, 129, 0.15)", 
                color: "var(--accent-success)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <FileText size={17} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "18px", fontWeight: 800, lineHeight: 1.1 }}>
                {stats?.media_counts.documents.toLocaleString() || 0}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Documents
              </div>
            </div>
          </div>

          {/* Card 4: Favorites */}
          <div
            onClick={() => onNavigate("photos")}
            className="clickable glass-panel"
            style={{
              padding: "14px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              cursor: "pointer",
              transition: "transform 0.15s ease",
            }}
          >
            <div 
              style={{ 
                width: "34px", 
                height: "34px", 
                borderRadius: "var(--radius-sm)", 
                backgroundColor: "rgba(239, 68, 68, 0.15)", 
                color: "var(--accent-danger)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Heart size={17} fill="currentColor" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "18px", fontWeight: 800, lineHeight: 1.1 }}>
                {stats?.media_counts.favorites.toLocaleString() || 0}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Favorites
              </div>
            </div>
          </div>

          {/* Card 5: People */}
          <div
            onClick={() => onNavigate("people")}
            className="clickable glass-panel"
            style={{
              padding: "14px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              cursor: "pointer",
              transition: "transform 0.15s ease",
            }}
          >
            <div 
              style={{ 
                width: "34px", 
                height: "34px", 
                borderRadius: "var(--radius-sm)", 
                backgroundColor: "rgba(139, 92, 246, 0.15)", 
                color: "var(--accent-vault)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Users size={17} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "18px", fontWeight: 800, lineHeight: 1.1 }}>
                {stats?.media_counts.people.toLocaleString() || 0}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                People
              </div>
            </div>
          </div>

          {/* Card 6: Albums */}
          <div
            onClick={() => onNavigate("albums")}
            className="clickable glass-panel"
            style={{
              padding: "14px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              cursor: "pointer",
              transition: "transform 0.15s ease",
            }}
          >
            <div 
              style={{ 
                width: "34px", 
                height: "34px", 
                borderRadius: "var(--radius-sm)", 
                backgroundColor: "rgba(59, 130, 246, 0.15)", 
                color: "var(--accent-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <FolderHeart size={17} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "18px", fontWeight: 800, lineHeight: 1.1 }}>
                {stats?.media_counts.albums.toLocaleString() || 0}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Albums
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── BENTO GRID ROW 3: Photographic Intelligence & Memory Velocity ─ */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <Flame size={16} style={{ color: "var(--accent-vault)" }} />
            Photographic Intelligence & Memory Velocity
          </h2>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            On-Device Neural Analytics
          </span>
        </div>

        <div 
          style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", 
            gap: "16px" 
          }}
        >
          {/* Bento Card 1: Top Captured People */}
          <div
            className="glass-panel"
            style={{
              padding: "18px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: "14px",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Users size={16} style={{ color: "var(--accent-vault)" }} />
                  <span style={{ fontSize: "13px", fontWeight: 700 }}>Frequent Companions</span>
                </div>
                <button
                  onClick={() => onNavigate("people")}
                  className="clickable"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent-primary)",
                    fontSize: "11px",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  View All <ArrowRight size={11} />
                </button>
              </div>

              {insights && insights.most_captured_people.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {insights.most_captured_people.slice(0, 4).map((person) => (
                    <div 
                      key={person.id}
                      onClick={() => onNavigate("people")}
                      className="clickable"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 8px",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "var(--bg-surface-elevated)",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                        <div 
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            backgroundColor: "rgba(139, 92, 246, 0.2)",
                            color: "var(--accent-vault)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "11px",
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {person.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {person.name}
                          </div>
                          {person.relationship_type && (
                            <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                              {person.relationship_type}
                            </div>
                          )}
                        </div>
                      </div>

                      <span 
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          fontFamily: "var(--font-mono)",
                          color: "var(--accent-primary)",
                          backgroundColor: "rgba(59, 130, 246, 0.1)",
                          padding: "2px 7px",
                          borderRadius: "var(--radius-full)",
                        }}
                      >
                        {person.photo_count} photos
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "12px 0" }}>
                  Tag companions in the People tab to see affinity journeys here.
                </div>
              )}
            </div>

            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              ✦ Milestones automatically prioritize designated close contacts.
            </span>
          </div>

          {/* Bento Card 2: Daily Rhythms & Golden Hour */}
          <div
            className="glass-panel"
            style={{
              padding: "18px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: "14px",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <Sunset size={16} style={{ color: "#f59e0b", flexShrink: 0 }} />
                  <span style={{ fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap" }}>Lighting & Time of Day</span>
                </div>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>Solar EXIF</span>
              </div>

              {insights && insights.time_of_day_distribution.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {insights.time_of_day_distribution.map((item) => {
                    const meta = getTimePeriodMeta(item.period);
                    const pct = Math.round((item.count / totalTimePhotos) * 100);

                    return (
                      <div key={item.period} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {meta.icon}
                            <span style={{ fontWeight: 600 }}>{meta.label}</span>
                          </div>
                          <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                            {item.count} ({pct}%)
                          </span>
                        </div>
                        {/* Progress track */}
                        <div 
                          style={{
                            height: "5px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "rgba(255, 255, 255, 0.08)",
                            overflow: "hidden",
                          }}
                        >
                          <div 
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              backgroundColor: meta.color,
                              borderRadius: "var(--radius-full)",
                              transition: "width 0.3s ease",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "12px 0" }}>
                  Import photos with EXIF capture dates to reveal solar rhythms.
                </div>
              )}
            </div>

            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              ✦ Golden hour memories trigger warm nostalgic cinematic filters.
            </span>
          </div>

          {/* Bento Card 3: Camera & Optics Intelligence */}
          <div
            className="glass-panel"
            style={{
              padding: "18px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: "14px",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <Camera size={16} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                  <span style={{ fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap" }}>Optics & Gear Profile</span>
                </div>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>Hardware EXIF</span>
              </div>

              {insights && insights.camera_breakdown.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {insights.camera_breakdown.map((cam) => (
                    <div 
                      key={cam.camera}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "7px 10px",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "var(--bg-surface-elevated)",
                        fontSize: "12px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                        <Camera size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {cam.camera}
                        </span>
                      </div>
                      <span 
                        style={{ 
                          fontSize: "11px", 
                          fontWeight: 700, 
                          fontFamily: "var(--font-mono)", 
                          color: "var(--text-secondary)",
                          flexShrink: 0,
                          marginLeft: "8px"
                        }}
                      >
                        {cam.count} shots
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "12px 0" }}>
                  Camera models and lens profiles will appear here as you import.
                </div>
              )}
            </div>

            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              ✦ Color profiles and LUTs adapt according to lens hardware.
            </span>
          </div>

          {/* Bento Card 4: Archive Span & Years */}
          <div
            className="glass-panel"
            style={{
              padding: "18px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: "14px",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <Calendar size={16} style={{ color: "var(--accent-success)", flexShrink: 0 }} />
                  <span style={{ fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap" }}>Archive Span & Velocity</span>
                </div>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>Through the Years</span>
              </div>

              {insights && insights.top_years.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                  {insights.top_years.slice(0, 6).map((yr) => (
                    <div 
                      key={yr.yr}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "var(--bg-surface-elevated)",
                        textAlign: "center",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      <span style={{ fontSize: "13px", fontWeight: 800, fontFamily: "var(--font-mono)" }}>
                        {yr.yr}
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                        {yr.count} {yr.count === 1 ? "moment" : "moments"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "12px 0" }}>
                  Historical memory velocity will be analyzed upon indexing.
                </div>
              )}
            </div>

            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              ✦ Multi-decade journeys synthesize chronological time capsules.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
