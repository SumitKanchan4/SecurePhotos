import React, { useState, useEffect, useCallback } from "react";
import { 
  Sparkles, 
  Play, 
  RefreshCw, 
  Music, 
  ChevronLeft, 
  ChevronRight, 
  Layers
} from "lucide-react";
import { StoryModel } from "../types";
import { NavTab } from "../store/useAppStore";

interface StoriesViewProps {
  onPlayStory: (storyId: number) => void;
  onNavigate: (tab: NavTab) => void;
}

/**
 * StoriesView Component
 *
 * Dedicated cinema & memory theater for AI-curated nostalgia montages,
 * "Through the Years" journeys, and milestone reels with beat-synchronized soundtracks.
 */
export const StoriesView: React.FC<StoriesViewProps> = ({ onPlayStory }) => {
  const [stories, setStories] = useState<StoryModel[]>([]);
  const [activeStoryIdx, setActiveStoryIdx] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStories = useCallback(async (showRefreshingState: boolean = false) => {
    if (showRefreshingState) setIsRefreshing(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/stories");
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

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  const handleGenerateStories = async () => {
    setIsGenerating(true);
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
      setIsGenerating(false);
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

          <button
            onClick={handleGenerateStories}
            disabled={isGenerating}
            className="clickable"
            title="Synthesize and curate new AI stories"
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
            border: "1px solid rgba(255, 255, 255, 0.12)",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "28px",
            minHeight: "280px",
            background: "linear-gradient(135deg, rgba(24, 20, 56, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.4)",
          }}
        >
          {/* Ambient Glow Aura */}
          <div 
            style={{
              position: "absolute",
              top: "-50px",
              right: "-50px",
              width: "220px",
              height: "220px",
              borderRadius: "50%",
              backgroundColor: "rgba(139, 92, 246, 0.3)",
              filter: "blur(65px)",
              pointerEvents: "none",
            }}
          />

          {/* Top Bar: Vibe Tag + Navigation Controls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span 
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  backgroundColor: "rgba(139, 92, 246, 0.25)",
                  color: "#ddd6fe",
                  border: "1px solid rgba(139, 92, 246, 0.4)",
                  padding: "4px 12px",
                  borderRadius: "var(--radius-full)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                <Sparkles size={12} style={{ color: "#a78bfa" }} />
                Featured Reel
              </span>

              <span 
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "rgba(255, 255, 255, 0.8)",
                  backgroundColor: "rgba(0, 0, 0, 0.4)",
                  padding: "4px 10px",
                  borderRadius: "var(--radius-full)",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <Music size={11} />
                {activeStory.vibe_mood}
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
                <span style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.7)", fontFamily: "var(--font-mono)", padding: "0 4px" }}>
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
            <p style={{ fontSize: "13px", color: "rgba(255, 255, 255, 0.8)", margin: 0 }}>
              {activeStory.slides.length} cinematic moments • Beat-synchronized soundtrack • Automated pan & zoom Ken Burns
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
            Click &ldquo;Curate Stories&rdquo; to automatically synthesize nostalgic reels, year reviews, and close friend journeys.
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
                        src={`http://127.0.0.1:8000/api/photos/${coverId}/thumbnail`} 
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
                        background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)",
                      }}
                    />

                    {/* Top Floating Vibe Badge */}
                    <span 
                      style={{
                        position: "absolute",
                        top: "8px",
                        left: "8px",
                        fontSize: "10px",
                        fontWeight: 600,
                        backgroundColor: "rgba(0, 0, 0, 0.55)",
                        backdropFilter: "blur(6px)",
                        color: "#ffffff",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-full)",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <Music size={10} />
                      {story.vibe_mood}
                    </span>

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
                      <span style={{ textTransform: "capitalize" }}>{story.story_type.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
