import React, { useState, useEffect, useCallback } from "react";
import { 
  Images, 
  Film, 
  FileText, 
  Heart, 
  Users, 
  FolderHeart, 
  HardDrive, 
  Sparkles, 
  Play, 
  RefreshCw, 
  Music, 
  ChevronLeft,
  ChevronRight,
  Disc
} from "lucide-react";


import { DashboardOverview, StoryModel } from "../types";
import { NavTab } from "../store/useAppStore";

interface DashboardViewProps {
  onPlayStory: (storyId: number) => void;
  onNavigate: (tab: NavTab) => void;
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

export const DashboardView: React.FC<DashboardViewProps> = ({ onPlayStory, onNavigate }) => {
  const [stats, setStats] = useState<DashboardOverview | null>(null);
  const [stories, setStories] = useState<StoryModel[]>([]);
  const [activeStoryIdx, setActiveStoryIdx] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isGeneratingStories, setIsGeneratingStories] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);


  const fetchDashboardData = useCallback(async (showRefreshingState: boolean = false) => {
    if (showRefreshingState) setIsRefreshing(true);
    try {
      const dashRes = await fetch("http://127.0.0.1:8000/api/system/dashboard");
      if (!dashRes.ok) throw new Error(`Dashboard API error: ${dashRes.statusText}`);
      const dashData: DashboardOverview = await dashRes.json();
      setStats(dashData);

      const storiesRes = await fetch("http://127.0.0.1:8000/api/stories");
      if (storiesRes.ok) {
        const storiesData: StoryModel[] = await storiesRes.json();
        setStories(storiesData);
      }
      setError(null);
    } catch (err: unknown) {
      console.error("Failed to load dashboard data:", err);
      setError(err instanceof Error ? err.message : "Failed to load dashboard metrics");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const handleGenerateStories = async () => {
    setIsGeneratingStories(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/stories/generate", {
        method: "POST",
      });
      if (res.ok) {
        const updatedStories: StoryModel[] = await res.json();
        setStories(updatedStories);
        setActiveStoryIdx(0);
      }
    } catch (err) {
      console.error("Error generating stories:", err);
    } finally {
      setIsGeneratingStories(false);
    }
  };

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
        <span style={{ fontSize: "13px" }}>Loading Telemetry...</span>
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

  const activeStory = stories.length > 0 ? stories[activeStoryIdx % stories.length] : null;


  return (
    <div 
      style={{ 
        flex: 1, 
        overflowY: "auto", 
        padding: "20px 24px", 
        display: "flex", 
        flexDirection: "column", 
        gap: "18px",
        maxHeight: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* ── Compact Header Bar ────────────────────────────────────────── */}
      <div 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "-0.3px", margin: 0 }}>
            Library Overview
          </h1>
          <span 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "2px 7px",
              borderRadius: "var(--radius-full)",
              fontSize: "10px",
              fontWeight: 600,
              backgroundColor: "rgba(16, 185, 129, 0.12)",
              color: "var(--accent-success)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
            }}
          >
            <span 
              style={{ 
                width: "5px", 
                height: "5px", 
                borderRadius: "50%", 
                backgroundColor: "var(--accent-success)",
              }} 
            />
            Online
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            onClick={() => fetchDashboardData(true)}
            disabled={isRefreshing}
            className="clickable"
            title="Refresh metrics"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 10px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
              fontSize: "11px",
              fontWeight: 500,
              cursor: "pointer",
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
            padding: "8px 12px", 
            borderRadius: "var(--radius-sm)", 
            backgroundColor: "rgba(239, 68, 68, 0.1)", 
            border: "1px solid rgba(239, 68, 68, 0.25)",
            color: "var(--accent-danger)",
            fontSize: "11px"
          }}
        >
          {error}
        </div>
      )}

      {/* ── BENTO GRID ROW 1: Hero Story + Storage & Drive HUD ───────── */}
      <div 
        style={{ 
          display: "grid", 
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", 
          gap: "16px",
          alignItems: "stretch",
        }}
      >
        {/* Bento Tile A: Cinematic Story Spotlight */}
        <div
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "20px",
            minHeight: "230px",
            background: activeStory
              ? "linear-gradient(135deg, rgba(30, 27, 75, 0.85) 0%, rgba(15, 23, 42, 0.95) 100%)"
              : "linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.9) 100%)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {/* Ambient Glow Orb */}
          <div 
            style={{
              position: "absolute",
              top: "-40px",
              right: "-40px",
              width: "160px",
              height: "160px",
              borderRadius: "50%",
              backgroundColor: "rgba(139, 92, 246, 0.25)",
              filter: "blur(50px)",
              pointerEvents: "none",
            }}
          />

          {/* Top Bar: Vibe Tag + Navigation Controls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span 
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  backgroundColor: "rgba(139, 92, 246, 0.2)",
                  color: "#c4b5fd",
                  border: "1px solid rgba(139, 92, 246, 0.35)",
                  padding: "3px 10px",
                  borderRadius: "var(--radius-full)",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <Sparkles size={11} style={{ color: "#a78bfa" }} />
                AI Memory Spotlight
              </span>

              {activeStory && (
                <span 
                  style={{
                    fontSize: "10px",
                    fontWeight: 500,
                    color: "rgba(255, 255, 255, 0.7)",
                    backgroundColor: "rgba(0, 0, 0, 0.3)",
                    padding: "3px 8px",
                    borderRadius: "var(--radius-full)",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <Music size={10} />
                  {activeStory.vibe_mood}
                </span>
              )}
            </div>

            {/* Next / Prev Carousel Controls */}
            {stories.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  onClick={() => setActiveStoryIdx((prev) => (prev > 0 ? prev - 1 : stories.length - 1))}
                  className="clickable"
                  title="Previous Story"
                  style={{
                    width: "26px",
                    height: "26px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <span style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.6)", fontFamily: "var(--font-mono)" }}>
                  {activeStoryIdx + 1}/{stories.length}
                </span>
                <button
                  onClick={() => setActiveStoryIdx((prev) => (prev + 1) % stories.length)}
                  className="clickable"
                  title="Next Story"
                  style={{
                    width: "26px",
                    height: "26px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Center Story Content */}
          {activeStory ? (
            <div style={{ margin: "14px 0", zIndex: 2 }}>
              <h2 
                style={{ 
                  fontSize: "18px", 
                  fontWeight: 700, 
                  color: "#ffffff", 
                  letterSpacing: "-0.3px",
                  lineHeight: 1.3,
                  margin: "0 0 6px 0",
                }}
              >
                {activeStory.title}
              </h2>
              <p style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.75)", margin: 0 }}>
                {activeStory.slides.length} cinematic moments • Beat-synchronized soundtrack
              </p>
            </div>
          ) : (
            <div style={{ margin: "14px 0", zIndex: 2 }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#ffffff", margin: "0 0 4px 0" }}>
                Curate Your Milestone Memories
              </h2>
              <p style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.7)", margin: 0 }}>
                Automatically synthesize nostalgia reels, year reviews, and close friend journeys.
              </p>
            </div>
          )}

          {/* Bottom Action Triggers */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", zIndex: 2 }}>
            {activeStory ? (
              <button
                onClick={() => onPlayStory(activeStory.id)}
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 18px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "#ffffff",
                  color: "#0f172a",
                  fontWeight: 700,
                  fontSize: "12px",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 2px 10px rgba(255,255,255,0.2)",
                  transition: "transform 0.15s ease",
                }}
              >
                <Play size={13} fill="#0f172a" />
                <span>Play Montage</span>
              </button>
            ) : null}

            <button
              onClick={handleGenerateStories}
              disabled={isGeneratingStories}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "rgba(255, 255, 255, 0.12)",
                color: "#ffffff",
                fontWeight: 600,
                fontSize: "12px",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                cursor: "pointer",
              }}
            >
              <Sparkles size={12} className={isGeneratingStories ? "spin-animation" : ""} />
              <span>{isGeneratingStories ? "Curating..." : activeStory ? "Curate More" : "Synthesize Stories"}</span>
            </button>
          </div>
        </div>

        {/* Bento Tile B: Storage & Drive HUD (Donut + Telemetry) */}
        <div
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: "230px",
          }}
        >
          {/* Top Title & Drive Chip */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <HardDrive size={15} style={{ color: "var(--accent-vault)" }} />
              <span style={{ fontSize: "13px", fontWeight: 700 }}>
                Storage Allocation
              </span>
            </div>

            <span 
              title={stats?.drive_storage.is_internal ? "Internal partition shared with Windows OS" : "External USB"}
              style={{
                fontSize: "10px",
                fontWeight: 600,
                padding: "2px 7px",
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
          <div style={{ display: "flex", alignItems: "center", gap: "18px", margin: "8px 0" }}>
            {/* SVG Circular Donut Chart */}
            <div style={{ position: "relative", width: "90px", height: "90px", flexShrink: 0 }}>
              <svg width="90" height="90" viewBox="0 0 90 90" style={{ transform: "rotate(-90deg)" }}>
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
                {/* SecurePhotos App System Segment (Purple) */}
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
              {/* Center Donut Label */}
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
                <Disc size={16} style={{ color: "var(--accent-vault)" }} />
              </div>
            </div>

            {/* Concise 4-Tier Legend */}
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", flex: 1, fontSize: "11px" }}>
              {/* 1. Media Content */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#3b82f6" }} />
                  <span style={{ color: "var(--text-secondary)" }}>Media Content:</span>
                </div>
                <strong style={{ color: "#60a5fa", fontFamily: "var(--font-mono)" }}>
                  {formatBytes(mediaBytes)}
                </strong>
              </div>

              {/* 2. App & Database */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#8b5cf6" }} />
                  <span style={{ color: "var(--text-secondary)" }}>App & Engine:</span>
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

          {/* Bottom Note & Drive Capacity */}
          <div 
            style={{ 
              borderTop: "1px solid var(--border-subtle)", 
              paddingTop: "10px", 
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              fontSize: "11px",
              color: "var(--text-muted)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Drive: <strong style={{ color: "var(--text-secondary)" }}>{formatBytes(totalDrive)}</strong></span>
              <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{stats?.drive_storage.drive_letter}</span>
            </div>
            <p style={{ margin: 0, fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.4 }}>
              ✦ Note: Drive space is shared with other files and software stored on this drive.
            </p>
          </div>
        </div>
      </div>


      {/* ── BENTO GRID ROW 2: High-Density Metric Cards Strip ─────────── */}
      <div 
        style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", 
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
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Albums
            </div>
          </div>
        </div>
      </div>

      {/* ── BENTO GRID ROW 3: Secondary Story Reels Shelf (if > 1 story) ─ */}
      {stories.length > 1 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
              More Curated Stories ({stories.length})
            </span>
          </div>

          <div 
            style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", 
              gap: "10px" 
            }}
          >
            {stories.map((story, idx) => {
              const isSelected = idx === activeStoryIdx;
              return (
                <div
                  key={story.id}
                  onClick={() => {
                    setActiveStoryIdx(idx);
                    onPlayStory(story.id);
                  }}
                  className="clickable"
                  style={{
                    padding: "10px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: isSelected ? "var(--bg-surface-elevated)" : "var(--bg-surface)",
                    border: `1px solid ${isSelected ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ minWidth: 0, paddingRight: "8px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {story.title}
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                      {story.slides.length} moments • {story.vibe_mood}
                    </div>
                  </div>
                  <Play size={12} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
