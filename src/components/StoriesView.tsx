import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { 
  Sparkles, 
  Play, 
  RefreshCw, 
  Music, 
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
  Trash2,
  Bookmark,
  Search,
  Download,
  Check
} from "lucide-react";
import { StoryModel, MusicTrackItem, SuggestedCollage } from "../types";
import { NavTab, useAppStore } from "../store/useAppStore";

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
 * StoriesView Component (AI Cinema Studio)
 *
 * Dedicated cinema & memory theater for AI-curated nostalgia montages,
 * "Through the Years" journeys, Vacation bursts, On This Day anniversaries,
 * and user soundtracks with automated mood tagging.
 */
export const StoriesView: React.FC<StoriesViewProps> = ({ onPlayStory, onNavigate }) => {
  const [stories, setStories] = useState<StoryModel[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Intelligent 4K Collages state
  const [collages, setCollages] = useState<SuggestedCollage[]>([]);
  const [isLoadingCollages, setIsLoadingCollages] = useState<boolean>(true);
  const [savingCollageId, setSavingCollageId] = useState<string | null>(null);
  const showToast = useAppStore((state) => state.showToast);

  // Soundtracks modal state
  const [showMusicModal, setShowMusicModal] = useState<boolean>(false);
  const [musicTracks, setMusicTracks] = useState<MusicTrackItem[]>([]);
  const [musicSearchQuery, setMusicSearchQuery] = useState<string>("");
  const [isLoadingMusic, setIsLoadingMusic] = useState<boolean>(false);
  const [isUploadingMusic, setIsUploadingMusic] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [musicFeedback, setMusicFeedback] = useState<string | null>(null);
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDeleteStory = async (e: React.MouseEvent, storyId: number) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/stories/${storyId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setStories((prev) => prev.filter((s) => s.id !== storyId));
      }
    } catch (err) {
      console.error("Failed to delete story:", err);
    }
  };

  const handleToggleSaveStory = async (e: React.MouseEvent, storyId: number, currentSaved?: boolean) => {
    e.stopPropagation();
    const nextSaved = !currentSaved;
    try {
      const res = await fetch(`${API_BASE}/stories/${storyId}/save`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_saved: nextSaved }),
      });
      if (res.ok) {
        if (nextSaved) {
          // Auto-archive off ephemeral suggestions shelf into Saved Stories smart album
          setStories((prev) => prev.filter((s) => s.id !== storyId));
        } else {
          setStories((prev) => prev.map((s) => (s.id === storyId ? { ...s, is_saved: false } : s)));
        }
        window.dispatchEvent(
          new CustomEvent("stories-changed", { detail: { storyId, action: "saved", isSaved: nextSaved } })
        );
      }
    } catch (err) {
      console.error("Failed to toggle save story:", err);
    }
  };

  const fetchStories = useCallback(async () => {
    try {
      // Shelf displays ephemeral suggestions; saved stories are preserved in Saved Stories smart album
      const res = await fetch(`${API_BASE}/stories?ephemeral_only=true`);
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
    }
  }, []);

  const fetchCollages = useCallback(async () => {
    setIsLoadingCollages(true);
    try {
      const res = await fetch(`${API_BASE}/creatives/suggestions`);
      if (res.ok) {
        const data = await res.json();
        setCollages(data.suggestions || []);
      }
    } catch (err) {
      console.error("Failed to load collage suggestions:", err);
    } finally {
      setIsLoadingCollages(false);
    }
  }, []);

  const handleSaveCollage = async (e: React.MouseEvent, suggestion: SuggestedCollage) => {
    e.stopPropagation();
    if (savingCollageId || suggestion.is_already_saved) return;
    setSavingCollageId(suggestion.id);
    try {
      const res = await fetch(`${API_BASE}/creatives/suggestions/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestion_id: suggestion.id,
          photo_ids: suggestion.photo_ids,
          layout: suggestion.layout,
          title: suggestion.title,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setCollages((prev) =>
          prev.map((c) =>
            c.id === suggestion.id
              ? { ...c, is_already_saved: true, saved_photo_id: result.photo_id }
              : c
          )
        );
        showToast("Saved 4K collage to your Collages collection", "success");
        window.dispatchEvent(new CustomEvent("library-changed"));
      } else {
        showToast("Failed to save collage", "warning");
      }
    } catch (err) {
      console.error("Failed to save collage:", err);
      showToast("Failed to save collage", "warning");
    } finally {
      setSavingCollageId(null);
    }
  };

  const handleDownloadCollage = (e: React.MouseEvent, photoId?: number | null) => {
    e.stopPropagation();
    if (!photoId) return;
    window.open(`${API_BASE}/photos/${photoId}/download`, "_blank");
  };

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
    fetchCollages();
  }, [fetchStories, fetchCollages]);

  useEffect(() => {
    const handleStoriesChanged = () => {
      fetchStories();
      fetchCollages();
    };
    window.addEventListener("stories-changed", handleStoriesChanged);
    return () => window.removeEventListener("stories-changed", handleStoriesChanged);
  }, [fetchStories, fetchCollages]);

  const filteredMusicTracks = useMemo(() => {
    if (!musicSearchQuery.trim()) return musicTracks;
    const q = musicSearchQuery.toLowerCase().trim();
    return musicTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        t.mood.toLowerCase().includes(q) ||
        (t.detected_mood && t.detected_mood.toLowerCase().includes(q))
    );
  }, [musicTracks, musicSearchQuery]);

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
      const streamUrl = track.stream_url.startsWith("http")
        ? track.stream_url
        : `http://127.0.0.1:8000${track.stream_url.startsWith("/") ? "" : "/"}${track.stream_url}`;
      const audio = new Audio(streamUrl);
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
        {/* Left Column (flex: 1): Balanced breathing room */}
        <div style={{ flex: 1 }} />

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
            AI Cinema Studio
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

      {/* ── Empty State when no stories curated ──────────────── */}
      {stories.length === 0 ? (
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
            Stories are synthesized automatically as memories unfold. You can also generate new cinematic highlights right now.
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
              cursor: isGenerating ? "not-allowed" : "pointer",
              marginTop: "4px",
            }}
          >
            <Sparkles size={13} className={isGenerating ? "spin-animation" : ""} />
            <span>{isGenerating ? "Synthesizing..." : "Synthesize Highlights Now"}</span>
          </button>
        </div>
      ) : (
        /* ── Milestone Stories Collection Shelf ──────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <Layers size={16} style={{ color: "var(--accent-primary)" }} />
              Milestone Stories Collection
            </h2>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {stories.length} {stories.length === 1 ? "story" : "stories"} available
            </span>
          </div>

          <div 
            style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", 
              gap: "14px" 
            }}
          >
            {stories.map((story) => {
              const coverId = story.cover_photo_id || (story.slides && story.slides[0]?.photo_id);
              const cardArchetype = getArchetypeDetails(story.story_type, story.title);

              return (
                <div
                  key={story.id}
                  onClick={() => onPlayStory(story.id)}
                  className="clickable glass-panel"
                  style={{
                    borderRadius: "var(--radius-md)",
                    overflow: "hidden",
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-surface)",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    cursor: "pointer",
                    transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
                    boxShadow: "var(--shadow-sm)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent-primary)";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-subtle)";
                    e.currentTarget.style.transform = "none";
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

                    {/* Top Floating Archetype & Saved Badges */}
                    <div style={{ position: "absolute", top: "8px", left: "8px", display: "flex", gap: "6px", alignItems: "center", zIndex: 2 }}>
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
                      {story.is_saved && (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            backgroundColor: "rgba(59, 130, 246, 0.9)",
                            color: "#ffffff",
                            backdropFilter: "blur(8px)",
                            padding: "2px 7px",
                            borderRadius: "var(--radius-full)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                          }}
                        >
                          <Bookmark size={9} fill="#ffffff" />
                          Saved
                        </span>
                      )}
                    </div>

                    {/* Top Right Save & Delete Action Buttons */}
                    <div 
                      style={{ 
                        position: "absolute", 
                        top: "8px", 
                        right: "8px", 
                        display: "flex", 
                        alignItems: "center", 
                        gap: "5px",
                        zIndex: 3,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={(e) => handleToggleSaveStory(e, story.id, story.is_saved)}
                        className="clickable"
                        title={story.is_saved ? "Remove from saved" : "Save story"}
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          backgroundColor: story.is_saved ? "var(--accent-primary)" : "rgba(0, 0, 0, 0.55)",
                          backdropFilter: "blur(6px)",
                          border: story.is_saved ? "1px solid var(--accent-primary)" : "1px solid rgba(255, 255, 255, 0.25)",
                          color: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                        }}
                      >
                        <Bookmark size={12} fill={story.is_saved ? "#ffffff" : "none"} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteStory(e, story.id)}
                        className="clickable"
                        title="Delete story"
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          backgroundColor: "rgba(0, 0, 0, 0.55)",
                          backdropFilter: "blur(6px)",
                          border: "1px solid rgba(255, 255, 255, 0.25)",
                          color: "rgba(255, 255, 255, 0.8)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.85)";
                          e.currentTarget.style.borderColor = "transparent";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.55)";
                          e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.25)";
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
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
                      <span>{story.slides_count || story.slides?.length || 0} moments</span>
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

      {/* ── Intelligent 4K Collages Shelf ──────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: stories.length > 0 ? "24px" : "8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <Sparkles size={16} style={{ color: "var(--accent-primary)" }} />
            Intelligent 4K Collages
          </h2>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {collages.length} {collages.length === 1 ? "composition" : "compositions"} ready
          </span>
        </div>

        {isLoadingCollages ? (
          <div style={{ padding: "30px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
            Curating intelligent 4K collage compositions...
          </div>
        ) : collages.length === 0 ? (
          <div
            className="glass-panel"
            style={{
              padding: "24px",
              borderRadius: "var(--radius-md)",
              border: "1px dashed var(--border-subtle)",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "12px",
            }}
          >
            Collages will appear automatically as you add more photos and tag close ones.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "16px",
            }}
          >
            {collages.map((c) => {
              const isSaved = c.is_already_saved;
              const isSaving = savingCollageId === c.id;
              const layoutLabel = c.layout === "mosaic" ? "4K Mosaic" : c.layout === "hero_grid" ? "4K Hero Grid" : "4K Treemap";

              return (
                <div
                  key={c.id}
                  className="glass-panel"
                  style={{
                    borderRadius: "var(--radius-md)",
                    overflow: "hidden",
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-surface)",
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "var(--shadow-sm)",
                    transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent-primary)";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-subtle)";
                    e.currentTarget.style.transform = "none";
                  }}
                >
                  {/* 16:9 Composite Canvas Preview */}
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "16 / 9",
                      position: "relative",
                      backgroundColor: "rgba(15, 23, 42, 0.7)",
                      overflow: "hidden",
                    }}
                  >
                    {isSaved && c.saved_photo_id ? (
                      <img
                        src={`${API_BASE}/photos/${c.saved_photo_id}/preview`}
                        alt={c.title}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      /* Dynamic multi-photo layout representation */
                      c.layout === "hero_grid" && c.photo_ids.length >= 3 ? (
                        <div style={{ display: "flex", width: "100%", height: "100%", gap: "2px" }}>
                          <div style={{ flex: 1.6, height: "100%", overflow: "hidden" }}>
                            <img
                              src={`${API_BASE}/photos/${c.photo_ids[0]}/thumbnail`}
                              alt=""
                              loading="lazy"
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          </div>
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", height: "100%" }}>
                            {c.photo_ids.slice(1, 3).map((pid) => (
                              <div key={pid} style={{ flex: 1, overflow: "hidden" }}>
                                <img
                                  src={`${API_BASE}/photos/${pid}/thumbnail`}
                                  alt=""
                                  loading="lazy"
                                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : c.photo_ids.length === 4 ? (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: "2px", width: "100%", height: "100%" }}>
                          {c.photo_ids.slice(0, 4).map((pid) => (
                            <div key={pid} style={{ overflow: "hidden", width: "100%", height: "100%" }}>
                              <img
                                src={`${API_BASE}/photos/${pid}/thumbnail`}
                                alt=""
                                loading="lazy"
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        /* 3 vertical portrait columns filling 16:9 4K canvas without cropping */
                        <div style={{ display: "flex", width: "100%", height: "100%", gap: "2px" }}>
                          {c.photo_ids.slice(0, 3).map((pid) => (
                            <div key={pid} style={{ flex: 1, height: "100%", overflow: "hidden" }}>
                              <img
                                src={`${API_BASE}/photos/${pid}/thumbnail`}
                                alt=""
                                loading="lazy"
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            </div>
                          ))}
                        </div>
                      )
                    )}

                    {/* Gradient Overlay for badges */}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 40%)",
                        pointerEvents: "none",
                      }}
                    />

                    {/* Top Left Layout & Cluster Badges */}
                    <div style={{ position: "absolute", top: "8px", left: "8px", display: "flex", gap: "6px", alignItems: "center", zIndex: 2 }}>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          backgroundColor: "rgba(15, 23, 42, 0.75)",
                          color: "#ffffff",
                          border: "1px solid rgba(255, 255, 255, 0.2)",
                          backdropFilter: "blur(8px)",
                          padding: "2px 8px",
                          borderRadius: "var(--radius-full)",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {layoutLabel}
                      </span>
                      {isSaved && (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            backgroundColor: "rgba(16, 185, 129, 0.85)",
                            color: "#ffffff",
                            backdropFilter: "blur(8px)",
                            padding: "2px 7px",
                            borderRadius: "var(--radius-full)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                          }}
                        >
                          <Check size={9} strokeWidth={3} />
                          Saved
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Info & Action Footer */}
                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)" }}>
                        {c.title}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                        {c.subtitle}
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingTop: "4px" }}>
                      {isSaved ? (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigate("albums");
                            }}
                            className="clickable"
                            style={{
                              flex: 1,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                              padding: "6px 12px",
                              borderRadius: "var(--radius-full)",
                              backgroundColor: "var(--glass-pill-bg)",
                              border: "1px solid var(--glass-border)",
                              color: "var(--text-primary)",
                              fontSize: "11px",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            <Layers size={12} style={{ color: "var(--accent-primary)" }} />
                            <span>View in Collages</span>
                          </button>

                          {c.saved_photo_id && (
                            <button
                              onClick={(e) => handleDownloadCollage(e, c.saved_photo_id)}
                              className="clickable"
                              title="Download 4K Collage"
                              style={{
                                width: "30px",
                                height: "30px",
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "var(--glass-pill-bg)",
                                border: "1px solid var(--glass-border)",
                                color: "var(--text-secondary)",
                                cursor: "pointer",
                              }}
                            >
                              <Download size={13} />
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={(e) => handleSaveCollage(e, c)}
                          disabled={isSaving}
                          className="clickable"
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            padding: "7px 14px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: isSaving ? "var(--accent-primary)" : "var(--glass-pill-bg)",
                            border: isSaving ? "1px solid var(--accent-primary)" : "1px solid var(--glass-border)",
                            color: isSaving ? "#ffffff" : "var(--accent-primary)",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: isSaving ? "not-allowed" : "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {isSaving ? (
                            <>
                              <RefreshCw size={12} className="spin-animation" />
                              <span>Saving 4K...</span>
                            </>
                          ) : (
                            <>
                              <Bookmark size={12} />
                              <span>Save to Collages</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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

              {/* Search Bar */}
              <div style={{ position: "relative", width: "100%" }}>
                <Search 
                  size={14} 
                  style={{ 
                    position: "absolute", 
                    left: "14px", 
                    top: "50%", 
                    transform: "translateY(-50%)", 
                    color: "var(--text-muted)",
                    pointerEvents: "none",
                  }} 
                />
                <input
                  type="text"
                  value={musicSearchQuery}
                  onChange={(e) => setMusicSearchQuery(e.target.value)}
                  placeholder="Search songs, artists, or moods..."
                  style={{
                    width: "100%",
                    padding: "8px 32px 8px 36px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                {musicSearchQuery && (
                  <button
                    onClick={() => setMusicSearchQuery("")}
                    className="clickable"
                    style={{
                      position: "absolute",
                      right: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      fontSize: "14px",
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Sub-header Bar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                  All Soundtracks ({filteredMusicTracks.length})
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
                ) : filteredMusicTracks.length === 0 ? (
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
                      <p style={{ margin: 0, fontWeight: 700, color: "var(--text-primary)" }}>
                        {musicSearchQuery ? "No matching soundtracks found." : "No custom music added yet."}
                      </p>
                      <p style={{ margin: "4px 0 0 0", fontSize: "11px" }}>
                        {musicSearchQuery
                          ? "Try a different search term or clear the filter."
                          : "Click '+ Add Music' above or drag & drop audio files anywhere. Stories play dynamic ambient chords until you add tracks."}
                      </p>
                    </div>
                  </div>
                ) : (
                  filteredMusicTracks.map((trk) => {
                    const isPlaying = previewTrackId === trk.id;

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
                              {trk.bpm ? (
                                <>
                                  <span>•</span>
                                  <span>{Math.round(trk.bpm)} BPM</span>
                                </>
                              ) : null}
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
                              padding: "5px 12px",
                              cursor: "pointer",
                              fontWeight: 600,
                              outline: "none",
                            }}
                          >
                            <option value="auto">
                              {trk.mood === "auto" && trk.detected_mood
                                ? `✨ Auto (${trk.detected_mood.charAt(0).toUpperCase() + trk.detected_mood.slice(1)})`
                                : "✨ Auto Detect"}
                            </option>
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
