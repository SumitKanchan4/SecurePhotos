import React from "react";
import { Sparkles, Play, Music } from "lucide-react";

interface StoryCardItem {
  id: number;
  title: string;
  subtitle: string;
  vibe: string;
  photoCount: number;
  coverGradient: string;
}

interface StoriesCarouselProps {
  onPlayStory: (storyId: number) => void;
}

export const StoriesCarousel: React.FC<StoriesCarouselProps> = ({ onPlayStory }) => {
  const stories: StoryCardItem[] = [
    {
      id: 1,
      title: "Alice: Through the Years",
      subtitle: "2012 — 2026 • 14 Milestones",
      vibe: "Warm Nostalgic Piano",
      photoCount: 14,
      coverGradient: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
    },
    {
      id: 2,
      title: "On This Day: 5 Years Ago",
      subtitle: "Summer Holiday in Kyoto",
      vibe: "Serene Acoustic Guitar",
      photoCount: 8,
      coverGradient: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    },
    {
      id: 3,
      title: "Paris Summer Duo Moments",
      subtitle: "Alice & Bob Highlights",
      vibe: "Summer Sunshine Lo-Fi",
      photoCount: 12,
      coverGradient: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)",
    },
  ];

  return (
    <div style={{ padding: "16px 20px 8px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <Sparkles size={16} style={{ color: "var(--accent-primary)" }} />
        <h2 style={{ fontSize: "14px", fontWeight: 700 }}>Curated Stories & Milestones</h2>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "4px" }}>
          (Filtered to Close Ones)
        </span>
      </div>

      <div 
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "14px",
        }}
      >
        {stories.map((story) => (
          <div
            key={story.id}
            onClick={() => onPlayStory(story.id)}
            className="clickable glass-panel"
            style={{
              borderRadius: "var(--radius-md)",
              padding: "16px",
              background: story.coverGradient,
              color: "#ffffff",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              height: "120px",
              position: "relative",
              overflow: "hidden",
              boxShadow: "var(--shadow-md)",
            }}
          >
            {/* Top Vibe Badge */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span 
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  backgroundColor: "rgba(0, 0, 0, 0.35)",
                  backdropFilter: "blur(8px)",
                  padding: "2px 8px",
                  borderRadius: "var(--radius-full)",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Music size={10} />
                {story.vibe}
              </span>

              <div 
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(255, 255, 255, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Play size={14} fill="#ffffff" />
              </div>
            </div>

            {/* Bottom Title & Subtitle */}
            <div>
              <h3 style={{ fontSize: "14px", fontWeight: 700, textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>
                {story.title}
              </h3>
              <p style={{ fontSize: "11px", opacity: 0.9, marginTop: "2px" }}>
                {story.subtitle}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
