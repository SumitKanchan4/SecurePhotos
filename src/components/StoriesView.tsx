import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
  Sparkles, 
  Play, 
  RefreshCw, 
  Music, 
  ChevronLeft, 
  ChevronRight, 
  Layers,
  Upload,
  X,
  Volume2,
  VolumeX,
  Disc3,
  Calendar,
  Plane,
  User,
  Sun,
  Trash2
} from "lucide-react";
import { StoryModel, MusicTrackItem } from "../types";
import { NavTab } from "../store/useAppStore";

const API_BASE = "http://127.0.0.1:8000/api";

interface StoriesViewProps {
  onPlayStory: (storyId: number) => void;
  onNavigate: (tab: NavTab) => void;
}

/**
 * Story archetype details helper for Google Photos-style badges and styling.
 */
function getArchetypeDetails(storyType?: string, title?: string) {
  switch (storyType) {
    case "on_this_day":
      return {
        label: "📅 On This Day",
        icon: Calendar,
        bg: "rgba(245, 158, 11, 0.2)",
        color: "#fbbf24",
        border: "rgba(245, 158, 11, 0.4)",
      };
    case "vacation_adventure":
      return {
        label: "✈️ Vacation Memories",
        icon: Plane,
        bg: "rgba(14, 165, 233, 0.2)",
        color: "#38bdf8",
        border: "rgba(14, 165, 233, 0.4)",
      };
    case "through_the_years":
      return {
        label: "👤 Growth Journey",
        icon: User,
        bg: "rgba(16, 185, 129, 0.2)",
        color: "#34d399",
        border: "rgba(16, 185, 129, 0.4)",
      };
    case "seasonal_highlight": {
      const sIcon = title?.includes("Summer") ? "☀️" : title?.includes("Winter") ? "❄️" : title?.includes("Spring") ? "🌸" : "🍂";
      return {
        label: `${sIcon} Seasonal Retrospective`,
        icon: Sun,
        bg: "rgba(168, 85, 247, 0.2)",
        color: "#c084fc",
        border: "rgba(168, 85, 247, 0.4)",
      };
    }
    default:
      return {
        label: "✨ Curated Story",
        icon: Sparkles,
        bg: "rgba(59, 130, 246, 0.2)",
        color: "#60a5fa",
        border: "rgba(59, 130, 246, 0.4)",
      };
  }
}

/**
 * StoriesView Component
 *
 * Dedicated cinema & memory theater for AI-curated nostalgia montages,
 * "Through the Years" journeys, Vacation bursts, On This Day anniversaries,
 * and user soundtracks with automated mood tagging.
 */
export const StoriesView: React.FC<StoriesViewProps> = ({ onPlayStory }) => {
  const [stories, setStories] = useState<StoryModel[]>([]);
  const [activeStoryIdx, setActiveStoryIdx] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Soundtracks modal state
  const [showMusicModal, setShowMusicModal] = useState<boolean>(false);
  const [musicTracks, setMusicTracks] = useState<MusicTrackItem[]>([]);
  const [isLoadingMusic, setIsLoadingMusic] = useState<boolean>(false);
  const [isUploadingMusic, setIsUploadingMusic] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [musicFeedback, setMusicFeedback] = useState<string | null>(null);
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchStories = useCallback(async (showRefreshingState: boolean = false) => {
    if (showRefreshingState) setIsRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/stories`);
      if (res.ok) {
        const storiesData: StoryModel[] = await res.json();
        setStories(storiesData);
      }
      setError(null);
    } catch (err: unknown) {
      console.error("Failed to load stories:", err);
      setError(err instanceof Error ? err.message : "Failed to load curated stories");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const fetchMusicTracks = useCallback(async () => {
    setIsLoadingMusic(true);
    try {
      const res = await fetch(`${API_BASE}/stories/music`);
      if (res.ok) {
        const tracks: MusicTrackItem[] = await res.json();
        setMusicTracks(tracks);
      }
    } catch (err) {
      console.error("Failed to load music tracks:", err);
    } finally {
      setIsLoadingMusic(false);
    }
  }, []);

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  useEffect(() => {
    if (showMusicModal) {
      fetchMusicTracks();
    } else {
      // Stop preview audio if closing modal
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
        setPreviewTrackId(null);
      }
    }
  }, [showMusicModal, fetchMusicTracks]);

  const handleGenerateStories = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/stories/generate`, {
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
      setIsGenerating(false);
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);

    setIsUploadingMusic(true);
    setMusicFeedback(null);
    let successCount = 0;

    try {
      for (const file of fileList) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`${API_BASE}/stories/music/upload`, {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          const track: MusicTrackItem = await res.json();
          setMusicTracks((prev) => [track, ...prev.filter((t) => t.id !== track.id)]);
          successCount++;
        }
      }

      if (successCount > 0) {
        setMusicFeedback(
          successCount === 1
            ? `Soundtrack added and set to auto detect ✨`
            : `Added ${successCount} soundtracks, all set to auto detect ✨`
        );
      } else {
        setMusicFeedback("Failed to upload audio files.");
      }
    } catch (err) {
      console.error("Upload error:", err);
      setMusicFeedback("Network error uploading audio.");
    } finally {
      setIsUploadingMusic(false);
    }
  };

  const handleDeleteTrack = async (trackId: string) => {
    try {
      const res = await fetch(`${API_BASE}/stories/music/${trackId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMusicTracks((prev) => prev.filter((t) => t.id !== trackId));
        if (previewTrackId === trackId && previewAudioRef.current) {
          previewAudioRef.current.pause();
          previewAudioRef.current = null;
          setPreviewTrackId(null);
        }
        setMusicFeedback("Soundtrack removed.");
      } else {
        setMusicFeedback("Failed to delete soundtrack.");
      }
    } catch (err) {
      console.error("Delete error:", err);
      setMusicFeedback("Network error deleting soundtrack.");
    }
  };

  const handleUpdateMood = async (trackId: string, newMood: string) => {
    try {
      const res = await fetch(`${API_BASE}/stories/music/${trackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood: newMood }),
      });
      if (res.ok) {
        const updated: MusicTrackItem = await res.json();
        setMusicTracks((prev) => prev.map((t) => (t.id === trackId ? updated : t)));
        setMusicFeedback(
          newMood === "auto"
            ? "Mood is set to auto detect ✨"
            : `Mood updated to ${newMood.charAt(0).toUpperCase() + newMood.slice(1)}`
        );
      }
    } catch (err) {
      console.error("Failed to update mood:", err);
    }
  };

  const handleTogglePreview = (track: MusicTrackItem) => {
    if (previewTrackId === track.id) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      setPreviewTrackId(null);
    } else {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      const audio = new Audio(track.stream_url);
      audio.volume = 0.6;
      audio.play().catch((e) => console.warn("Audio play error:", e));
      audio.onended = () => setPreviewTrackId(null);
      previewAudioRef.current = audio;
      setPreviewTrackId(track.id);
    }
  };

  if (isLoading && stories.length === 0) {
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
        <span style={{ fontSize: "13px" }}>Curating Milestone Memories...</span>
      </div>
    );
  }

  const activeStory = stories.length > 0 ? stories[activeStoryIdx % stories.length] : null;
  const activeArchetype = activeStory ? getArchetypeDetails(activeStory.story_type, activeStory.title) : null;

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
        }}
      >
        {/* Left Column (flex: 1) */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px" }}>
          <span 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: "rgba(139, 92, 246, 0.12)",
              color: "var(--accent-vault)",
              border: "1px solid rgba(139, 92, 246, 0.25)",
            }}
          >
            <Sparkles size={12} style={{ color: "var(--accent-vault)" }} />
            AI Cinema Studio
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
            Curated Stories
          </h1>
          <span 
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: 700,
              backgroundColor: "var(--glass-badge-bg)",
              color: "var(--text-secondary)",
              border: "1px solid var(--glass-badge-border)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {stories.length} {stories.length === 1 ? "Story" : "Stories"} Active
          </span>
        </div>

        {/* Right Column (flex: 1): Action Pill Buttons */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
          {/* Soundtracks Studio Button */}
          <button
            onClick={() => setShowMusicModal(true)}
            className="clickable"
            title="Manage Story Soundtracks & Auto-Tagged Music"
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
            <Music size={13} style={{ color: "var(--accent-primary)" }} />
            <span>Soundtracks</span>
          </button>

          {/* Sync Button */}
          <button
            onClick={() => fetchStories(true)}
            disabled={isRefreshing}
            className="clickable"
            title="Refresh Stories"
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

          {/* Curate Stories Action */}
          <button
            onClick={handleGenerateStories}
            disabled={isGenerating}
            className="clickable"
            title="Synthesize and curate new milestone stories"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 16px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-primary)",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 700,
              border: "none",
              cursor: isGenerating ? "not-allowed" : "pointer",
              boxShadow: "0 2px 10px rgba(59, 130, 246, 0.3)",
              transition: "all 0.15s ease",
            }}
          >
            <Sparkles size={13} className={isGenerating ? "spin-animation" : ""} />
            <span>{isGenerating ? "Synthesizing..." : "Curate Stories"}</span>
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
            fontSize: "12px" 
          }}
        >
          {error}
        </div>
      )}

      {/* ── SECTION 1: Cinematic Hero Story Spotlight ──────────────────── */}
      {activeStory ? (
        <div
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            position: "relative",
            minHeight: "260px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "24px 30px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.85) 100%)",
            border: "1px solid var(--glass-border)",
          }}
        >
          {/* Background Blurred Ambient Cover Photo */}
          {activeStory.slides[0]?.photo_id && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `url(${API_BASE}/photos/${activeStory.slides[0].photo_id}/preview)`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(20px) brightness(0.35)",
                opacity: 0.65,
                transform: "scale(1.05)",
                zIndex: 0,
              }}
            />
          )}

          {/* Top Row Badges & Carousel Navigation */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              {/* Dynamic Story Archetype Badge */}
              {activeArchetype && (
                <span 
                  style={{
                    backgroundColor: activeArchetype.bg,
                    color: activeArchetype.color,
                    border: `1px solid ${activeArchetype.border}`,
                    padding: "4px 12px",
                    borderRadius: "var(--radius-full)",
                    fontSize: "11px",
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  {activeArchetype.label}
                </span>
              )}

              <span 
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "rgba(255, 255, 255, 0.85)",
                  backgroundColor: "rgba(0, 0, 0, 0.45)",
                  backdropFilter: "blur(10px)",
                  padding: "4px 10px",
                  borderRadius: "var(--radius-full)",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                }}
              >
                <Music size={11} style={{ color: "var(--accent-primary)" }} />
                <span style={{ textTransform: "capitalize" }}>{activeStory.vibe_mood} Vibe</span>
              </span>
            </div>

            {/* Next / Prev Carousel Controls */}
            {stories.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  onClick={() => setActiveStoryIdx((prev) => (prev > 0 ? prev - 1 : stories.length - 1))}
                  className="clickable"
                  title="Previous Story"
                  style={{
                    width: "30px",
                    height: "30px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(255, 255, 255, 0.12)",
                    border: "1px solid rgba(255, 255, 255, 0.2)",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
                <span style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.8)", fontFamily: "var(--font-mono)", padding: "0 4px" }}>
                  {activeStoryIdx + 1} / {stories.length}
                </span>
                <button
                  onClick={() => setActiveStoryIdx((prev) => (prev + 1) % stories.length)}
                  className="clickable"
                  title="Next Story"
                  style={{
                    width: "30px",
                    height: "30px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(255, 255, 255, 0.12)",
                    border: "1px solid rgba(255, 255, 255, 0.2)",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Center Story Content */}
          <div style={{ margin: "24px 0", zIndex: 2 }}>
            <h2 
              style={{ 
                fontSize: "26px", 
                fontWeight: 800, 
                color: "#ffffff", 
                letterSpacing: "-0.02em", 
                lineHeight: 1.2,
                margin: "0 0 8px 0",
              }}
            >
              {activeStory.title}
            </h2>
            <p style={{ fontSize: "13px", color: "rgba(255, 255, 255, 0.82)", margin: 0 }}>
              {activeStory.slides.length} moments • Dynamic chromatic ambient light • Beat-synchronized Ken-Burns motion
            </p>
          </div>

          {/* Bottom Action Triggers */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", zIndex: 2 }}>
            <button
              onClick={() => onPlayStory(activeStory.id)}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 24px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "#ffffff",
                color: "#0f172a",
                fontWeight: 800,
                fontSize: "13px",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 4px 14px rgba(255, 255, 255, 0.25)",
                transition: "transform 0.15s ease",
              }}
            >
              <Play size={14} fill="#0f172a" />
              <span>Play Montage</span>
            </button>
          </div>
        </div>
      ) : (
        <div
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border-subtle)",
            padding: "48px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "14px",
          }}
        >
          <Sparkles size={34} style={{ color: "var(--accent-primary)" }} />
          <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>
            No Milestone Stories Curated Yet
          </h3>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", maxWidth: "420px", margin: 0 }}>
            Click &ldquo;Curate Stories&rdquo; to automatically synthesize nostalgic reels, year reviews, vacation getaways, and on-this-day memories.
          </p>
          <button
            onClick={handleGenerateStories}
            disabled={isGenerating}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 20px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-primary)",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 700,
              border: "none",
              cursor: "pointer",
              marginTop: "4px",
            }}
          >
            <Sparkles size={13} className={isGenerating ? "spin-animation" : ""} />
            <span>Curate Stories Now</span>
          </button>
        </div>
      )}

      {/* ── SECTION 2: Milestone Stories Collection Shelf ──────────────── */}
      {stories.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <Layers size={16} style={{ color: "var(--accent-primary)" }} />
              Milestone Stories Collection
            </h2>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {stories.length} curations available
            </span>
          </div>

          <div 
            style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", 
              gap: "14px" 
            }}
          >
            {stories.map((story, idx) => {
              const isSelected = idx === activeStoryIdx;
              const coverId = story.cover_photo_id || story.slides[0]?.photo_id;
              const cardArchetype = getArchetypeDetails(story.story_type, story.title);

              return (
                <div
                  key={story.id}
                  onClick={() => {
                    setActiveStoryIdx(idx);
                    onPlayStory(story.id);
                  }}
                  className="clickable glass-panel"
                  style={{
                    borderRadius: "var(--radius-md)",
                    overflow: "hidden",
                    border: `1px solid ${isSelected ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    backgroundColor: "var(--bg-surface)",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    cursor: "pointer",
                    transition: "transform 0.15s ease, box-shadow 0.15s ease",
                    boxShadow: isSelected ? "0 4px 18px rgba(59, 130, 246, 0.2)" : "var(--shadow-sm)",
                  }}
                >
                  {/* Card Cover Preview */}
                  <div 
                    style={{ 
                      height: "130px", 
                      position: "relative", 
                      backgroundColor: "rgba(15, 23, 42, 0.6)",
                      overflow: "hidden" 
                    }}
                  >
                    {coverId ? (
                      <img 
                        src={`${API_BASE}/photos/${coverId}/thumbnail`} 
                        alt={story.title}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          transition: "transform 0.3s ease",
                        }}
                      />
                    ) : (
                      <div 
                        style={{
                          width: "100%",
                          height: "100%",
                          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Sparkles size={28} style={{ color: "rgba(255,255,255,0.4)" }} />
                      </div>
                    )}

                    {/* Gradient Overlay */}
                    <div 
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 60%)",
                      }}
                    />

                    {/* Top Floating Archetype & Vibe Badges */}
                    <div style={{ position: "absolute", top: "8px", left: "8px", display: "flex", gap: "6px" }}>
                      <span 
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          backgroundColor: cardArchetype.bg,
                          color: cardArchetype.color,
                          border: `1px solid ${cardArchetype.border}`,
                          backdropFilter: "blur(8px)",
                          padding: "2px 8px",
                          borderRadius: "var(--radius-full)",
                        }}
                      >
                        {cardArchetype.label}
                      </span>
                    </div>

                    {/* Play Icon Pill on Corner */}
                    <div 
                      style={{
                        position: "absolute",
                        bottom: "8px",
                        right: "8px",
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        backgroundColor: "rgba(255, 255, 255, 0.9)",
                        color: "#0f172a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                      }}
                    >
                      <Play size={12} fill="#0f172a" />
                    </div>
                  </div>

                  {/* Card Info Footer */}
                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {story.title}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>{story.slides.length} moments</span>
                      <span>•</span>
                      <span style={{ textTransform: "capitalize" }}>{story.vibe_mood} vibe</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SOUNDTRACK STUDIO MODAL (Upload & Auto-Tagging) ──────────────── */}
      {showMusicModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            zIndex: 4000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMusicModal(false);
          }}
        >
          <div
            className="glass-panel"
            style={{
              width: "100%",
              maxWidth: "680px",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              borderRadius: "var(--radius-lg)",
              backgroundColor: "var(--glass-surface)",
              backdropFilter: "blur(24px)",
              border: "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 24px",
                borderBottom: "1px solid var(--glass-border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "rgba(59, 130, 246, 0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--accent-primary)",
                  }}
                >
                  <Music size={18} />
                </div>
                <div>
                  <h2 style={{ fontSize: "16px", fontWeight: 800, margin: 0 }}>Story Soundtracks</h2>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                    100% private on-device music library
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="audio/mp3,audio/wav,audio/m4a,audio/aac,audio/flac,audio/ogg,.mp3,.m4a,.wav,.aac,.flac,.ogg"
                  style={{ display: "none" }}
                  onChange={(e) => handleFileUpload(e.target.files)}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingMusic}
                  className="clickable"
                  title="Add soundtrack files (select or drop multiple)"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 16px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-primary)",
                    color: "#ffffff",
                    border: "none",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: isUploadingMusic ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 10px var(--accent-glow)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Upload size={13} />
                  <span>{isUploadingMusic ? "Adding..." : "+ Add Music"}</span>
                </button>

                <button
                  onClick={() => setShowMusicModal(false)}
                  className="clickable"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    padding: "4px",
                    borderRadius: "var(--radius-full)",
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body: Track-First with Drag & Drop Area */}
            <div 
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingOver(false);
                handleFileUpload(e.dataTransfer.files);
              }}
              style={{ 
                padding: "20px 24px", 
                overflowY: "auto", 
                display: "flex", 
                flexDirection: "column", 
                gap: "14px",
                position: "relative",
              }}
            >
              {/* Drag-over Visual Overlay */}
              {isDraggingOver && (
                <div
                  style={{
                    position: "absolute",
                    inset: "12px",
                    borderRadius: "var(--radius-md)",
                    border: "2px dashed var(--accent-primary)",
                    backgroundColor: "rgba(59, 130, 246, 0.15)",
                    backdropFilter: "blur(8px)",
                    zIndex: 20,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    pointerEvents: "none",
                  }}
                >
                  <Upload size={32} style={{ color: "var(--accent-primary)" }} />
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "#ffffff" }}>
                    Drop audio files here to add to library
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                    Supports multiple files (MP3, M4A, WAV, AAC, FLAC)
                  </span>
                </div>
              )}

              {/* Feedback Alert */}
              {musicFeedback && (
                <div
                  style={{
                    padding: "8px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "rgba(59, 130, 246, 0.12)",
                    border: "1px solid rgba(59, 130, 246, 0.25)",
                    fontSize: "12px",
                    color: "var(--accent-primary)",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{musicFeedback}</span>
                  <button
                    onClick={() => setMusicFeedback(null)}
                    style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: "0 4px" }}
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Sub-header Bar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                  All Soundtracks ({musicTracks.length})
                </span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Select or drag & drop multiple files anywhere
                </span>
              </div>

              {/* Track List */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {isLoadingMusic ? (
                  <div style={{ textAlign: "center", padding: "20px", color: "var(--text-secondary)", fontSize: "13px" }}>
                    Loading soundtracks...
                  </div>
                ) : musicTracks.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "36px 16px",
                      borderRadius: "var(--radius-md)",
                      backgroundColor: "rgba(255, 255, 255, 0.02)",
                      border: "1px dashed var(--glass-border)",
                      color: "var(--text-secondary)",
                      fontSize: "13px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <Disc3 size={32} style={{ color: "var(--accent-primary)" }} />
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, color: "var(--text-primary)" }}>No custom music added yet.</p>
                      <p style={{ margin: "4px 0 0 0", fontSize: "11px" }}>
                        Click "+ Add Music" above or drag & drop audio files anywhere. Stories play dynamic ambient chords until you add tracks.
                      </p>
                    </div>
                  </div>
                ) : (
                  musicTracks.map((trk) => {
                    const isPlaying = previewTrackId === trk.id;
                    const isAuto = trk.mood === "auto";

                    return (
                      <div
                        key={trk.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "12px 14px",
                          borderRadius: "var(--radius-md)",
                          backgroundColor: isPlaying ? "rgba(59, 130, 246, 0.08)" : "rgba(255, 255, 255, 0.03)",
                          border: `1px solid ${isPlaying ? "rgba(59, 130, 246, 0.3)" : "var(--border-subtle)"}`,
                          gap: "12px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {/* Play/Pause Preview Button & Track Details */}
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                          <button
                            onClick={() => handleTogglePreview(trk)}
                            className="clickable"
                            title={isPlaying ? "Stop Preview" : "Preview Soundtrack"}
                            style={{
                              width: "34px",
                              height: "34px",
                              borderRadius: "50%",
                              backgroundColor: isPlaying ? "var(--accent-primary)" : "var(--glass-pill-bg)",
                              border: "1px solid var(--glass-border)",
                              color: "#ffffff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                              flexShrink: 0,
                              boxShadow: isPlaying ? "0 0 10px var(--accent-glow)" : "none",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {isPlaying ? <VolumeX size={15} /> : <Volume2 size={15} />}
                          </button>

                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: "13px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {trk.title}
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                              <span>{trk.artist || "Local Soundtrack"}</span>
                              <span>•</span>
                              <span>{trk.duration_formatted}</span>
                              <span>•</span>
                              <span>{trk.file_size_formatted}</span>
                            </div>
                            {/* Auto Detect Statement */}
                            <div style={{ fontSize: "11px", marginTop: "3px", display: "flex", alignItems: "center", gap: "6px" }}>
                              {isAuto ? (
                                <span style={{ color: "var(--accent-primary)", display: "inline-flex", alignItems: "center", gap: "5px", fontWeight: 600 }}>
                                  is set to auto detect
                                  {trk.detected_mood && (
                                    <span
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: 700,
                                        backgroundColor: "rgba(59, 130, 246, 0.15)",
                                        color: "var(--accent-primary)",
                                        padding: "1px 7px",
                                        borderRadius: "var(--radius-full)",
                                        border: "1px solid rgba(59, 130, 246, 0.25)",
                                      }}
                                    >
                                      {trk.detected_mood.toUpperCase()}{trk.bpm ? ` • ${Math.round(trk.bpm)} BPM` : ""} ✨
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span style={{ color: "var(--text-secondary)", opacity: 0.85 }}>
                                  Manual override ({trk.mood.charAt(0).toUpperCase() + trk.mood.slice(1)})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Controls on the Right: Tag Dropdown & Delete Button */}
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                          <select
                            value={trk.mood}
                            onChange={(e) => handleUpdateMood(trk.id, e.target.value)}
                            style={{
                              backgroundColor: "var(--glass-surface)",
                              color: "var(--text-primary)",
                              border: "1px solid var(--glass-border)",
                              borderRadius: "var(--radius-full)",
                              fontSize: "12px",
                              padding: "5px 10px",
                              cursor: "pointer",
                              fontWeight: 600,
                            }}
                          >
                            <option value="auto">Auto</option>
                            <option value="upbeat">Upbeat</option>
                            <option value="nostalgic">Nostalgic</option>
                            <option value="acoustic">Acoustic</option>
                            <option value="cinematic">Cinematic</option>
                          </select>

                          <button
                            onClick={() => handleDeleteTrack(trk.id)}
                            className="clickable"
                            title="Remove soundtrack"
                            style={{
                              width: "30px",
                              height: "30px",
                              borderRadius: "var(--radius-full)",
                              backgroundColor: "rgba(239, 68, 68, 0.08)",
                              border: "1px solid rgba(239, 68, 68, 0.2)",
                              color: "#ef4444",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.2)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.08)";
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "14px 24px",
                borderTop: "1px solid var(--glass-border)",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => setShowMusicModal(false)}
                className="clickable"
                style={{
                  padding: "6px 20px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
