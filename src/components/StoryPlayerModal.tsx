import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  X, 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Sparkles, 
  Music,
  ChevronLeft,
  ChevronRight,
  RefreshCw
} from "lucide-react";
import { StoryModel } from "../types";

const API_BASE = "http://127.0.0.1:8000/api";

interface StoryPlayerModalProps {
  storyId: number | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Procedural Web Audio Soundscape Generator tailored for Story Vibes.
 * Generates harmonic chords in real time with zero external MP3 dependencies.
 */
class StorySoundscapeGenerator {
  private ctx: AudioContext | null = null;
  private isPlaying: boolean = false;
  private masterGain: GainNode | null = null;
  private chordTimer: number | null = null;

  // Harmonious chord progressions tailored for nostalgia and reflection
  private chords = [
    [261.63, 329.63, 392.00, 523.25], // C Major
    [220.00, 261.63, 329.63, 440.00], // A Minor
    [174.61, 220.00, 261.63, 349.23], // F Major
    [196.00, 246.94, 293.66, 392.00], // G Major
  ];
  private chordIndex = 0;

  public async start() {
    if (this.isPlaying) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.isPlaying = true;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      this.masterGain.gain.exponentialRampToValueAtTime(0.28, this.ctx.currentTime + 1.2);
      this.masterGain.connect(this.ctx.destination);

      if (this.ctx.state === "suspended") {
        await this.ctx.resume().catch(() => {});
      }

      this.schedulePad();
    } catch (err) {
      console.warn("Audio autoplay blocked or unsupported:", err);
    }
  }

  public setMute(muted: boolean) {
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.setValueAtTime(muted ? 0.0001 : 0.28, this.ctx.currentTime);
  }

  private schedulePad() {
    if (!this.ctx || !this.isPlaying || !this.masterGain) return;

    if (this.ctx.state === "suspended") {
      this.ctx.resume().then(() => {
        if (this.isPlaying) this.schedulePad();
      }).catch(() => {});
      return;
    }

    const chord = this.chords[this.chordIndex % this.chords.length];
    this.chordIndex++;

    const now = this.ctx.currentTime;
    const duration = 5.0; // 5 seconds per harmonic chord transition

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(800, now);
    filter.Q.setValueAtTime(1.0, now);
    filter.connect(this.masterGain);

    chord.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();

      osc.type = idx % 2 === 0 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime((idx - 1.5) * 5, now);

      oscGain.gain.setValueAtTime(0.001, now);
      oscGain.gain.linearRampToValueAtTime(0.07, now + 1.2);
      oscGain.gain.setValueAtTime(0.07, now + duration - 1.5);
      oscGain.gain.linearRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(filter);

      osc.start(now);
      osc.stop(now + duration + 0.1);
    });

    this.chordTimer = window.setTimeout(() => {
      if (this.isPlaying) this.schedulePad();
    }, 4500);
  }

  public stop() {
    this.isPlaying = false;
    if (this.chordTimer) {
      clearTimeout(this.chordTimer);
      this.chordTimer = null;
    }
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.ctx.currentTime);
        this.masterGain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.4);
        setTimeout(() => {
          this.ctx?.close().catch(() => {});
          this.ctx = null;
        }, 500);
      } catch {
        this.ctx = null;
      }
    }
  }
}

export const StoryPlayerModal: React.FC<StoryPlayerModalProps> = ({
  storyId,
  isOpen,
  onClose,
}) => {
  const [story, setStory] = useState<StoryModel | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const soundscapeRef = useRef<StorySoundscapeGenerator | null>(null);

  // Fetch story details from backend
  const fetchStory = useCallback(async (id: number) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/stories/${id}`);
      if (res.ok) {
        const data: StoryModel = await res.json();
        setStory(data);
        setCurrentSlideIndex(0);
      } else {
        // Fallback: try loading all stories and find matching ID
        const allRes = await fetch(`${API_BASE}/stories`);
        if (allRes.ok) {
          const allStories: StoryModel[] = await allRes.json();
          const found = allStories.find((s) => s.id === id);
          if (found) {
            setStory(found);
            setCurrentSlideIndex(0);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load story:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && storyId !== null) {
      fetchStory(storyId);
      setIsPlaying(true);

      // Initialize ambient soundscape
      soundscapeRef.current = new StorySoundscapeGenerator();
      soundscapeRef.current.start();
    } else {
      soundscapeRef.current?.stop();
      soundscapeRef.current = null;
    }

    return () => {
      soundscapeRef.current?.stop();
      soundscapeRef.current = null;
    };
  }, [isOpen, storyId, fetchStory]);

  // Handle Mute toggle
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    soundscapeRef.current?.setMute(nextMuted);
  };

  // Slides advancement timer
  useEffect(() => {
    if (!isOpen || !isPlaying || !story || story.slides.length === 0) return;

    const timer = setTimeout(() => {
      if (currentSlideIndex < story.slides.length - 1) {
        setCurrentSlideIndex((prev) => prev + 1);
      } else {
        // Loop back to start or pause
        setCurrentSlideIndex(0);
      }
    }, 4500);

    return () => clearTimeout(timer);
  }, [isOpen, isPlaying, currentSlideIndex, story]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        setCurrentSlideIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "ArrowRight") {
        if (story && story.slides.length > 0) {
          setCurrentSlideIndex((prev) => (prev + 1) % story.slides.length);
        }
      } else if (e.key === " ") {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, story]);

  if (!isOpen || storyId === null) return null;

  const slides = story?.slides || [];
  const currentSlide = slides[currentSlideIndex];

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
        {slides.map((slide, idx) => {
          const isPassed = idx < currentSlideIndex;
          const isCurrent = idx === currentSlideIndex;

          return (
            <div 
              key={slide.photo_id}
              onClick={() => setCurrentSlideIndex(idx)}
              style={{
                flex: 1,
                height: "3px",
                backgroundColor: "rgba(255, 255, 255, 0.25)",
                borderRadius: "var(--radius-full)",
                overflow: "hidden",
                cursor: "pointer",
              }}
            >
              <div 
                style={{
                  height: "100%",
                  width: isPassed ? "100%" : isCurrent ? "100%" : "0%",
                  backgroundColor: "#ffffff",
                  transition: isCurrent && isPlaying ? "width 4.5s linear" : "none",
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
          {currentSlide && (
            <span 
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                backdropFilter: "blur(16px)",
                padding: "4px 10px",
                borderRadius: "var(--radius-full)",
                fontSize: "12px",
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
              }}
            >
              {currentSlide.year_label}
            </span>
          )}
          <span style={{ fontSize: "15px", fontWeight: 700, textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
            {story?.title || "Curated Story"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Vibe Soundtrack Badge */}
          <div 
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(16px)",
              padding: "4px 12px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              border: "1px solid rgba(255, 255, 255, 0.15)",
            }}
          >
            <Music size={12} style={{ color: "var(--accent-primary)" }} />
            <span style={{ textTransform: "capitalize" }}>
              {story?.vibe_mood ? `${story.vibe_mood} Ambient` : "Nostalgic Ambient"}
            </span>
          </div>

          {/* Sound Mute Toggle */}
          <button
            onClick={toggleMute}
            className="clickable"
            title={isMuted ? "Unmute Ambient Music" : "Mute Music"}
            style={{
              background: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#ffffff",
              padding: "7px",
              borderRadius: "var(--radius-full)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>

          {/* Play / Pause Toggle */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="clickable"
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            style={{
              background: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#ffffff",
              padding: "7px",
              borderRadius: "var(--radius-full)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          </button>

          {/* Close Modal */}
          <button
            onClick={onClose}
            className="clickable"
            title="Close (Esc)"
            style={{
              background: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#ffffff",
              padding: "7px",
              borderRadius: "var(--radius-full)",
              marginLeft: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main Cinematic Viewport with Ken-Burns Motion */}
      <div 
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          backgroundColor: "#05060a",
        }}
      >
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", color: "var(--text-secondary)" }}>
            <RefreshCw size={28} className="spin" style={{ color: "var(--accent-primary)" }} />
            <span style={{ fontSize: "14px" }}>Loading Memory Story...</span>
          </div>
        ) : currentSlide ? (
          <div 
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {/* Real Photo with Subject-Focused Ken-Burns Motion */}
            <img
              key={currentSlide.photo_id}
              src={`${API_BASE}/photos/${currentSlide.photo_id}/preview`}
              onError={(e) => {
                // Fallback to original image if 8K preview proxy is not yet generated
                (e.target as HTMLImageElement).src = `${API_BASE}/photos/${currentSlide.photo_id}/original`;
              }}
              alt={currentSlide.filename}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                transformOrigin: `${((currentSlide.focal_x ?? 0.5) * 100).toFixed(1)}% ${((currentSlide.focal_y ?? 0.5) * 100).toFixed(1)}%`,
                transform: isPlaying ? "scale(1.14)" : "scale(1.0)",
                transition: "transform 4.5s cubic-bezier(0.25, 1, 0.5, 1)",
              }}
            />
          </div>
        ) : (
          <div style={{ color: "var(--text-secondary)", textAlign: "center" }}>
            <Sparkles size={36} style={{ color: "var(--accent-primary)", marginBottom: "8px" }} />
            <p>No photos found in this story.</p>
          </div>
        )}

        {/* Previous Slide Touch Zone / Button */}
        <div 
          onClick={() => setCurrentSlideIndex((prev) => Math.max(0, prev - 1))}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "25%",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            paddingLeft: "20px",
            opacity: 0,
            transition: "opacity 0.2s ease",
            zIndex: 30,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
        >
          <div 
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(12px)",
              borderRadius: "var(--radius-full)",
              padding: "10px",
              color: "#ffffff",
            }}
          >
            <ChevronLeft size={24} />
          </div>
        </div>

        {/* Next Slide Touch Zone / Button */}
        <div 
          onClick={() => {
            if (slides.length > 0) {
              setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
            }
          }}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "25%",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: "20px",
            opacity: 0,
            transition: "opacity 0.2s ease",
            zIndex: 30,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
        >
          <div 
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(12px)",
              borderRadius: "var(--radius-full)",
              padding: "10px",
              color: "#ffffff",
            }}
          >
            <ChevronRight size={24} />
          </div>
        </div>
      </div>

      {/* Bottom Footer Info Overlay */}
      <div 
        style={{
          position: "absolute",
          bottom: "20px",
          left: "24px",
          right: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "rgba(255, 255, 255, 0.7)",
          fontSize: "12px",
          zIndex: 40,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span>{currentSlideIndex + 1} of {slides.length}</span>
          <span>•</span>
          <span>{currentSlide?.filename || ""}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "11px", opacity: 0.8 }}>Space: Pause/Play • ←/→: Navigate • Esc: Exit</span>
        </div>
      </div>
    </div>
  );
};
