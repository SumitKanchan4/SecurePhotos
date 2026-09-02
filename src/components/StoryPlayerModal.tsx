import React, { useState, useEffect } from "react";
import { 
  X, 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Download, 
  Sparkles, 
  Music,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

interface StoryPlayerModalProps {
  storyId: number | null;
  isOpen: boolean;
  onClose: () => void;
}

const mockStorySlides = [
  { id: 1, year: "2014", title: "First Steps in the Garden", durationMs: 4000 },
  { id: 2, year: "2017", title: "Starting Kindergarten", durationMs: 4000 },
  { id: 3, year: "2020", title: "Summer Seaside Camping", durationMs: 4000 },
  { id: 4, year: "2023", title: "School Science Fair Winner", durationMs: 4000 },
  { id: 5, year: "2026", title: "Middle School Graduation", durationMs: 4000 },
];

export const StoryPlayerModal: React.FC<StoryPlayerModalProps> = ({
  storyId,
  isOpen,
  onClose,
}) => {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!isOpen || !isPlaying) return;

    const timer = setTimeout(() => {
      if (currentSlideIndex < mockStorySlides.length - 1) {
        setCurrentSlideIndex((prev) => prev + 1);
      } else {
        setIsPlaying(false);
      }
    }, mockStorySlides[currentSlideIndex].durationMs);

    return () => clearTimeout(timer);
  }, [isOpen, isPlaying, currentSlideIndex]);

  if (!isOpen || storyId === null) return null;

  const currentSlide = mockStorySlides[currentSlideIndex];

  const handleExport4K = () => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      alert("4K Beat-Synced Video Montage exported to external drive: creatives/montages/Alice_Through_The_Years_4K.mp4");
    }, 1200);
  };

  return (
    <div 
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#000000",
        display: "flex",
        flexDirection: "column",
        zIndex: 3500,
        userSelect: "none",
      }}
    >
      {/* Top Segmented Progress Bar */}
      <div 
        style={{
          position: "absolute",
          top: "16px",
          left: "20px",
          right: "20px",
          display: "flex",
          gap: "6px",
          zIndex: 40,
        }}
      >
        {mockStorySlides.map((slide, idx) => {
          const isPassed = idx < currentSlideIndex;
          const isCurrent = idx === currentSlideIndex;

          return (
            <div 
              key={slide.id}
              style={{
                flex: 1,
                height: "3px",
                backgroundColor: "rgba(255, 255, 255, 0.25)",
                borderRadius: "var(--radius-full)",
                overflow: "hidden",
              }}
            >
              <div 
                style={{
                  height: "100%",
                  width: isPassed ? "100%" : isCurrent ? "100%" : "0%",
                  backgroundColor: "#ffffff",
                  transition: isCurrent ? "width 4s linear" : "none",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Top Header Overlay */}
      <div 
        style={{
          position: "absolute",
          top: "28px",
          left: "20px",
          right: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#ffffff",
          zIndex: 40,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span 
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.4)",
              backdropFilter: "blur(12px)",
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              fontSize: "12px",
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
            }}
          >
            {currentSlide.year}
          </span>
          <span style={{ fontSize: "14px", fontWeight: 600, textShadow: "0 2px 4px rgba(0,0,0,0.6)" }}>
            {currentSlide.title}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Vibe Soundtrack Badge */}
          <div 
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.4)",
              backdropFilter: "blur(12px)",
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Music size={12} />
            <span>Nostalgic Piano (BPM: 74)</span>
          </div>

          <button
            onClick={() => setIsMuted(!isMuted)}
            className="clickable"
            style={{
              background: "rgba(0, 0, 0, 0.4)",
              border: "none",
              color: "#ffffff",
              padding: "6px",
              borderRadius: "var(--radius-full)",
            }}
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>

          <button
            onClick={onClose}
            className="clickable"
            style={{
              background: "rgba(0, 0, 0, 0.4)",
              border: "none",
              color: "#ffffff",
              padding: "6px",
              borderRadius: "var(--radius-full)",
              marginLeft: "6px",
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Cinematic Video / Photo Viewport with Ken-Burns Motion */}
      <div 
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div 
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(circle, rgba(20,25,38,1) 0%, rgba(5,6,10,1) 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            transform: isPlaying ? "scale(1.08) translate(10px, -5px)" : "scale(1.0)",
            transition: "transform 4s ease-out",
          }}
        >
          <Sparkles size={72} style={{ color: "var(--accent-primary)", opacity: 0.8, marginBottom: "20px" }} />
          <h2 style={{ fontSize: "28px", fontWeight: 800, color: "#ffffff", letterSpacing: "-0.5px" }}>
            {currentSlide.title}
          </h2>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: "6px" }}>
            4K 60fps Ken-Burns Motion • Synchronized Beat Cut
          </p>
        </div>

        {/* Navigation Overlays */}
        {currentSlideIndex > 0 && (
          <button
            onClick={() => setCurrentSlideIndex(currentSlideIndex - 1)}
            className="clickable"
            style={{
              position: "absolute",
              left: "24px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "rgba(0, 0, 0, 0.3)",
              border: "none",
              color: "#ffffff",
              padding: "10px",
              borderRadius: "var(--radius-full)",
              zIndex: 30,
            }}
          >
            <ChevronLeft size={28} />
          </button>
        )}

        {currentSlideIndex < mockStorySlides.length - 1 && (
          <button
            onClick={() => setCurrentSlideIndex(currentSlideIndex + 1)}
            className="clickable"
            style={{
              position: "absolute",
              right: "24px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "rgba(0, 0, 0, 0.3)",
              border: "none",
              color: "#ffffff",
              padding: "10px",
              borderRadius: "var(--radius-full)",
              zIndex: 30,
            }}
          >
            <ChevronRight size={28} />
          </button>
        )}
      </div>

      {/* Bottom Floating Control Bar */}
      <div 
        style={{
          position: "absolute",
          bottom: "24px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          backgroundColor: "rgba(14, 16, 23, 0.85)",
          backdropFilter: "blur(16px)",
          padding: "8px 18px",
          borderRadius: "var(--radius-full)",
          border: "1px solid var(--border-subtle)",
          zIndex: 40,
        }}
      >
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="clickable"
          style={{
            background: "transparent",
            border: "none",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            padding: "4px",
          }}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} fill="#ffffff" />}
        </button>

        <div style={{ width: "1px", height: "18px", backgroundColor: "var(--border-subtle)" }} />

        <button
          onClick={handleExport4K}
          disabled={isExporting}
          className="clickable"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "var(--accent-primary)",
            border: "none",
            color: "#ffffff",
            padding: "6px 14px",
            borderRadius: "var(--radius-full)",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          <Download size={14} />
          {isExporting ? "Rendering 4K MP4..." : "Export 4K Video"}
        </button>
      </div>
    </div>
  );
};
