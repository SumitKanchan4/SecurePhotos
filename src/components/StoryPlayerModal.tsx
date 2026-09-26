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
  RefreshCw,
  Check,
  Disc3,
  Bookmark,
  Trash2
} from "lucide-react";
import { StoryModel, MusicTrackItem } from "../types";
import { apiFetch, getApiUrl } from "../services/api";

interface StoryPlayerModalProps {
  storyId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onStoryDeleted?: (storyId: number) => void;
  onStorySaveToggled?: (storyId: number, isSaved: boolean) => void;
}

/**
 * Procedural Web Audio Soundscape Generator tailored for Story Vibes.
 * Generates harmonic chords in real time when no custom audio file is provided.
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
      this.masterGain.gain.exponentialRampToValueAtTime(0.24, this.ctx.currentTime + 1.2);
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
    this.masterGain.gain.setValueAtTime(muted ? 0.0001 : 0.24, this.ctx.currentTime);
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
        this.masterGain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.3);
        setTimeout(() => {
          this.ctx?.close().catch(() => {});
          this.ctx = null;
        }, 400);
      } catch {
        this.ctx = null;
      }
    }
  }
}

/**
 * Story archetype metadata helper providing badge colors, icons, and human-first labels.
 */
function getArchetypeDetails(storyType?: string, title?: string) {
  switch (storyType) {
    case "on_this_day":
      return {
        label: "📅 On This Day",
        bg: "rgba(245, 158, 11, 0.2)",
        color: "#fbbf24",
        border: "rgba(245, 158, 11, 0.4)",
      };
    case "vacation_adventure":
      return {
        label: "✈️ Vacation Memories",
        bg: "rgba(14, 165, 233, 0.2)",
        color: "#38bdf8",
        border: "rgba(14, 165, 233, 0.4)",
      };
    case "through_the_years":
      return {
        label: "👤 Growth Journey",
        bg: "rgba(16, 185, 129, 0.2)",
        color: "#34d399",
        border: "rgba(16, 185, 129, 0.4)",
      };
    case "seasonal_highlight": {
      const sIcon = title?.includes("Summer") ? "☀️" : title?.includes("Winter") ? "❄️" : title?.includes("Spring") ? "🌸" : "🍂";
      return {
        label: `${sIcon} Seasonal Retrospective`,
        bg: "rgba(168, 85, 247, 0.2)",
        color: "#c084fc",
        border: "rgba(168, 85, 247, 0.4)",
      };
    }
    default:
      return {
        label: "✨ Curated Story",
        bg: "rgba(59, 130, 246, 0.2)",
        color: "#60a5fa",
        border: "rgba(59, 130, 246, 0.4)",
      };
  }
}

/**
 * Determines slide motion duration based on story vibe and music pacing.
 */
function getSlidePacing(vibeMood?: string): number {
  switch (vibeMood) {
    case "upbeat":
      return 3500;
    case "nostalgic":
      return 5500;
    case "acoustic":
      return 4500;
    case "cinematic":
      return 5000;
    default:
      return 4500;
  }
}

export const StoryPlayerModal: React.FC<StoryPlayerModalProps> = ({
  storyId,
  isOpen,
  onClose,
  onStoryDeleted,
  onStorySaveToggled,
}) => {
  const [story, setStory] = useState<StoryModel | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Video element state & refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeVideoProgressBarRef = useRef<HTMLDivElement | null>(null);

  const slides = story?.slides || [];
  const currentSlide = slides[currentSlideIndex];
  const isCurrentSlideVideo = Boolean(
    currentSlide && (
      currentSlide.mime_type?.startsWith("video/") ||
      currentSlide.filename.match(/\.(mp4|mov|webm|avi|mkv)$/i)
    )
  );

  // Dynamic chromatic ambient color [r, g, b]
  const [ambientColor, setAmbientColor] = useState<[number, number, number]>([15, 23, 42]);

  // Audio system state
  const [availableTracks, setAvailableTracks] = useState<MusicTrackItem[]>([]);
  const [activeAudioUrl, setActiveAudioUrl] = useState<string | null>(null);
  const [activeTrackTitle, setActiveTrackTitle] = useState<string>("Procedural Ambient Chords");
  const [showSoundtrackMenu, setShowSoundtrackMenu] = useState(false);

  const soundscapeRef = useRef<StorySoundscapeGenerator | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Fetch available tracks for the in-player soundtrack picker
  const fetchMusicTracks = useCallback(async () => {
    try {
      const res = await apiFetch("/api/stories/music");
      if (res.ok) {
        const tracks: MusicTrackItem[] = await res.json();
        setAvailableTracks(tracks);
      }
    } catch {
      // Audio tracks load failed; fallback to procedural
    }
  }, []);

  // Fetch story details from backend
  const fetchStory = useCallback(async (id: number) => {
    setIsLoading(true);
    try {
      const res = await apiFetch(`/api/stories/${id}`);
      if (res.ok) {
        const data: StoryModel = await res.json();
        setStory(data);
        setCurrentSlideIndex(0);
        if (data.audio_url) {
          const streamUrl = data.audio_url.startsWith("http")
            ? data.audio_url
            : getApiUrl(data.audio_url);
          setActiveAudioUrl(streamUrl);
          setActiveTrackTitle(`${data.vibe_mood ? data.vibe_mood.charAt(0).toUpperCase() + data.vibe_mood.slice(1) : "Curated"} Soundtrack`);
        } else {
          setActiveAudioUrl(null);
          setActiveTrackTitle("Procedural Ambient Chords");
        }
      } else {
        // Fallback: try loading all stories and find matching ID
        const allRes = await apiFetch("/api/stories");
        if (allRes.ok) {
          const allStories: StoryModel[] = await allRes.json();
          const found = allStories.find((s) => s.id === id);
          if (found) {
            setStory(found);
            setCurrentSlideIndex(0);
            if (found.audio_url) {
              const streamUrl = found.audio_url.startsWith("http")
                ? found.audio_url
                : getApiUrl(found.audio_url);
              setActiveAudioUrl(streamUrl);
              setActiveTrackTitle(`${found.vibe_mood ? found.vibe_mood.charAt(0).toUpperCase() + found.vibe_mood.slice(1) : "Curated"} Soundtrack`);
            } else {
              setActiveAudioUrl(null);
              setActiveTrackTitle("Procedural Ambient Chords");
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to load story:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleToggleSave = async () => {
    if (!story) return;
    const nextSaved = !story.is_saved;
    try {
      const res = await apiFetch(`/api/stories/${story.id}/save`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_saved: nextSaved }),
      });
      if (res.ok) {
        setStory((prev) => (prev ? { ...prev, is_saved: nextSaved } : null));
        onStorySaveToggled?.(story.id, nextSaved);
      }
    } catch (err) {
      console.error("Failed to toggle story save:", err);
    }
  };

  const handleDelete = async () => {
    if (!story) return;
    try {
      const res = await apiFetch(`/api/stories/${story.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onStoryDeleted?.(story.id);
        onClose();
      }
    } catch (err) {
      console.error("Failed to delete story:", err);
    }
  };

  // Fetch story and tracks on modal open
  useEffect(() => {
    if (isOpen && storyId !== null) {
      fetchStory(storyId);
      fetchMusicTracks();
      setIsPlaying(true);
      setShowSoundtrackMenu(false);
    } else {
      stopAllAudio();
    }

    return () => {
      stopAllAudio();
    };
  }, [isOpen, storyId, fetchStory, fetchMusicTracks]);

  // Dynamic chromatic color extraction from current slide
  useEffect(() => {
    if (!isOpen || !story || story.slides.length === 0) return;
    const currentSlide = story.slides[currentSlideIndex];
    if (!currentSlide) return;

    const imgUrl = getApiUrl(`/api/photos/${currentSlide.photo_id}/preview`);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgUrl;

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 12;
        canvas.height = 12;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 12, 12);
        const data = ctx.getImageData(0, 0, 12, 12).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const br = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          // Filter out pure near-black or blown-out white to keep vibrant color atmosphere
          if (br > 20 && br < 235) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
        }
        if (count > 0) {
          setAmbientColor([Math.round(r / count), Math.round(g / count), Math.round(b / count)]);
        }
      } catch {
        // Fallback default ambient
        setAmbientColor([15, 23, 42]);
      }
    };
  }, [isOpen, story, currentSlideIndex]);

  // Audio Playback Controller
  const stopAllAudio = () => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = "";
      audioElementRef.current = null;
    }
    if (soundscapeRef.current) {
      soundscapeRef.current.stop();
      soundscapeRef.current = null;
    }
  };

  // Background soundtrack controller: auto-pauses during video slides so video plays its own native audio
  useEffect(() => {
    if (!isOpen) {
      stopAllAudio();
      return;
    }

    // Video slide priority: pause background soundtrack so video audio plays exclusively
    if (isCurrentSlideVideo) {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
      }
      if (soundscapeRef.current) {
        soundscapeRef.current.stop();
        soundscapeRef.current = null;
      }
      return;
    }

    if (activeAudioUrl) {
      // User-provided soundtrack via HTML5 Audio
      if (soundscapeRef.current) {
        soundscapeRef.current.stop();
        soundscapeRef.current = null;
      }

      if (!audioElementRef.current || audioElementRef.current.src !== activeAudioUrl) {
        if (audioElementRef.current) {
          audioElementRef.current.pause();
        }
        const streamUrl = activeAudioUrl.startsWith("http")
          ? activeAudioUrl
          : getApiUrl(activeAudioUrl);
        const audio = new Audio(streamUrl);
        audio.loop = true;
        audio.volume = 0.5;
        audio.muted = isMuted;
        audioElementRef.current = audio;
      }

      if (isPlaying && !isMuted) {
        audioElementRef.current.play().catch((e) => {
          console.warn("HTML5 audio playback blocked, falling back to procedural synthesizer:", e);
          soundscapeRef.current = new StorySoundscapeGenerator();
          soundscapeRef.current.start();
          soundscapeRef.current.setMute(isMuted);
        });
      } else {
        audioElementRef.current.pause();
      }
    } else {
      // Procedural Web Audio Synthesizer fallback
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current = null;
      }

      if (isPlaying && !isMuted) {
        if (!soundscapeRef.current) {
          soundscapeRef.current = new StorySoundscapeGenerator();
          soundscapeRef.current.start();
          soundscapeRef.current.setMute(isMuted);
        }
      } else {
        soundscapeRef.current?.stop();
        soundscapeRef.current = null;
      }
    }
  }, [isOpen, activeAudioUrl, isPlaying, isMuted, isCurrentSlideVideo]);

  // Video play/pause and mute synchronization
  useEffect(() => {
    if (!videoRef.current) return;
    if (isCurrentSlideVideo) {
      if (activeVideoProgressBarRef.current) {
        activeVideoProgressBarRef.current.style.width = "0%";
      }
      videoRef.current.muted = isMuted;
      if (isPlaying) {
        const playPromise = videoRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn("Unmuted video autoplay blocked by browser policy, falling back to muted:", err);
            if (videoRef.current) {
              videoRef.current.muted = true;
              videoRef.current.play().catch(() => {});
            }
          });
        }
      } else {
        videoRef.current.pause();
      }
    }
  }, [isCurrentSlideVideo, isPlaying, isMuted, currentSlideIndex]);

  // Handle Mute toggle
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioElementRef.current) {
      audioElementRef.current.muted = nextMuted;
    }
    soundscapeRef.current?.setMute(nextMuted);
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  };

  // Adaptive slide pacing
  const pacingMs = getSlidePacing(story?.vibe_mood);

  // Slides advancement timer
  useEffect(() => {
    if (!isOpen || !isPlaying || !story || story.slides.length === 0) return;

    if (isCurrentSlideVideo) {
      // For video slides, onEnded handles transition. Safety fallback ceiling of 45s
      const safetyTimer = setTimeout(() => {
        setCurrentSlideIndex((prev) => (prev + 1) % story.slides.length);
      }, 45000);
      return () => clearTimeout(safetyTimer);
    }

    const timer = setTimeout(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % story.slides.length);
    }, pacingMs);

    return () => clearTimeout(timer);
  }, [isOpen, isPlaying, currentSlideIndex, story, pacingMs, isCurrentSlideVideo]);

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

  const archetype = getArchetypeDetails(story?.story_type, story?.title);

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
      {/* Dynamic Keyframes for Cinematic Ken Burns Pan & Zoom in Stories */}
      <style>{`
        @keyframes storyKenBurns {
          0% {
            transform: scale(1.0) translate(0%, 0%);
            opacity: 0.88;
          }
          15% {
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          100% {
            transform: scale(1.08) translate(1.2%, -0.8%);
            opacity: 0.96;
          }
        }
      `}</style>

      {/* Top Segmented Progress Bar with Dynamic Pacing */}
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
                ref={isCurrent && isCurrentSlideVideo ? activeVideoProgressBarRef : undefined}
                style={{
                  height: "100%",
                  width: isPassed
                    ? "100%"
                    : isCurrent
                      ? (isCurrentSlideVideo ? "0%" : "100%")
                      : "0%",
                  backgroundColor: "#ffffff",
                  transition: isCurrent && isPlaying && !isCurrentSlideVideo ? `width ${pacingMs}ms linear` : "none",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Top Header Overlay with Liquid Glass & Archetype Badge */}
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
        {/* Left: Archetype Badge & Slide Timeline */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Dynamic Story Archetype Badge */}
          <span 
            style={{
              backgroundColor: archetype.bg,
              color: archetype.color,
              border: `1px solid ${archetype.border}`,
              padding: "4px 12px",
              borderRadius: "var(--radius-full)",
              fontSize: "12px",
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              backdropFilter: "blur(16px)",
            }}
          >
            {archetype.label}
          </span>

          {currentSlide && (
            <span 
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.55)",
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

          <span style={{ fontSize: "15px", fontWeight: 700, textShadow: "0 2px 8px rgba(0,0,0,0.85)" }}>
            {story?.title || "Curated Story"}
          </span>
        </div>

        {/* Right: Sound Control, Play/Pause, Close */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", position: "relative" }}>
          {/* Soundtrack Selector & Vibe Badge */}
          <button
            onClick={() => setShowSoundtrackMenu(!showSoundtrackMenu)}
            className="clickable"
            title="Choose Story Soundtrack"
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.55)",
              backdropFilter: "blur(16px)",
              padding: "4px 12px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              border: "1px solid rgba(255, 255, 255, 0.18)",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            <Music size={12} style={{ color: "var(--accent-primary)" }} />
            <span style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeTrackTitle}
            </span>
          </button>

          {/* Soundtrack Selector Popover */}
          {showSoundtrackMenu && (
            <div
              style={{
                position: "absolute",
                top: "40px",
                right: "120px",
                width: "280px",
                backgroundColor: "rgba(18, 20, 29, 0.95)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "0 16px 36px rgba(0,0,0,0.6)",
                padding: "10px",
                zIndex: 60,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", padding: "4px 8px" }}>
                Select Soundtrack
              </div>

              {/* Procedural Web Audio Option */}
              <div
                onClick={() => {
                  setActiveAudioUrl(null);
                  setActiveTrackTitle("Procedural Ambient Chords");
                  setShowSoundtrackMenu(false);
                }}
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: !activeAudioUrl ? "rgba(59, 130, 246, 0.2)" : "transparent",
                  color: "#ffffff",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Disc3 size={14} style={{ color: "var(--accent-primary)" }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>Ambient Chords</div>
                    <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)" }}>Procedural Synthesizer</div>
                  </div>
                </div>
                {!activeAudioUrl && <Check size={14} style={{ color: "var(--accent-primary)" }} />}
              </div>

              {/* User Custom Tracks */}
              {availableTracks.map((trk) => {
                const streamUrl = trk.stream_url.startsWith("http")
                  ? trk.stream_url
                  : getApiUrl(trk.stream_url);
                const isSelected = activeAudioUrl === streamUrl || activeAudioUrl === trk.stream_url;
                return (
                  <div
                    key={trk.id}
                    onClick={() => {
                      setActiveAudioUrl(streamUrl);
                      setActiveTrackTitle(trk.title || trk.filename);
                      setShowSoundtrackMenu(false);
                    }}
                    className="clickable"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      borderRadius: "var(--radius-md)",
                      backgroundColor: isSelected ? "rgba(59, 130, 246, 0.2)" : "transparent",
                      color: "#ffffff",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                      <Music size={14} style={{ color: isSelected ? "var(--accent-primary)" : "rgba(255,255,255,0.7)" }} />
                      <div style={{ overflow: "hidden" }}>
                        <div style={{ fontWeight: 600, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                          {trk.title}
                        </div>
                        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", display: "flex", gap: "6px" }}>
                          <span style={{ textTransform: "capitalize" }}>{trk.mood}</span>
                          {trk.auto_tagged && <span style={{ color: "var(--accent-primary)" }}>• Auto ✨</span>}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check size={14} style={{ color: "var(--accent-primary)" }} />}
                  </div>
                );
              })}
            </div>
          )}

          {/* Sound Mute Toggle */}
          <button
            onClick={toggleMute}
            className="clickable"
            title={isMuted ? "Unmute Ambient Music" : "Mute Music"}
            style={{
              background: "rgba(0, 0, 0, 0.55)",
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
              background: "rgba(0, 0, 0, 0.55)",
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

          {/* Save Story Bookmark Toggle */}
          <button
            onClick={handleToggleSave}
            className="clickable"
            title={story?.is_saved ? "Remove from Saved Stories" : "Save Story to Keep Permanently"}
            style={{
              background: story?.is_saved ? "rgba(245, 158, 11, 0.25)" : "rgba(0, 0, 0, 0.55)",
              backdropFilter: "blur(16px)",
              border: `1px solid ${story?.is_saved ? "rgba(245, 158, 11, 0.5)" : "rgba(255, 255, 255, 0.15)"}`,
              color: story?.is_saved ? "#fbbf24" : "#ffffff",
              padding: "5px 12px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <Bookmark size={12} fill={story?.is_saved ? "#fbbf24" : "none"} />
            <span>{story?.is_saved ? "Saved" : "Save"}</span>
          </button>

          {/* Delete Story Button */}
          <button
            onClick={handleDelete}
            className="clickable"
            title="Delete this Story"
            style={{
              background: "rgba(239, 68, 68, 0.2)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "#f87171",
              padding: "7px",
              borderRadius: "var(--radius-full)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Trash2 size={14} />
          </button>

          {/* Close Modal */}
          <button
            onClick={onClose}
            className="clickable"
            title="Close (Esc)"
            style={{
              background: "rgba(0, 0, 0, 0.55)",
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

      {/* Main Cinematic Viewport with Dynamic Chromatic Radial Glow */}
      <div 
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          background: `radial-gradient(ellipse at center, rgba(${ambientColor[0]}, ${ambientColor[1]}, ${ambientColor[2]}, 0.52) 0%, rgba(5, 6, 10, 0.95) 75%, #000000 100%)`,
          transition: "background 1.4s cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", color: "var(--text-secondary)" }}>
            <RefreshCw size={28} className="spin-animation" style={{ color: "var(--accent-primary)" }} />
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
            {/* Real Photo or Video with Subject-Focused Motion */}
            {isCurrentSlideVideo ? (
              <video
                ref={videoRef}
                key={`video-${currentSlide.photo_id}`}
                src={getApiUrl(`/api/videos/${currentSlide.photo_id}/stream`)}
                poster={getApiUrl(`/api/photos/${currentSlide.photo_id}/preview`)}
                autoPlay
                playsInline
                muted={isMuted}
                preload="auto"
                onLoadedMetadata={() => {
                  if (activeVideoProgressBarRef.current) {
                    activeVideoProgressBarRef.current.style.width = "0%";
                  }
                }}
                onTimeUpdate={(e) => {
                  const el = e.currentTarget;
                  if (el && el.duration) {
                    const pct = Math.min(100, (el.currentTime / el.duration) * 100);
                    if (activeVideoProgressBarRef.current) {
                      activeVideoProgressBarRef.current.style.width = `${pct}%`;
                    }
                  }
                }}
                onEnded={() => {
                  if (slides.length > 0) {
                    setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
                  }
                }}
                onError={(e) => {
                  console.warn("Video playback error in story, skipping to next slide:", e);
                  if (slides.length > 0) {
                    setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
                  }
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  transform: "none",
                  backgroundColor: "#000000",
                }}
              />
            ) : (
              <div
                key={`slide-${currentSlide.photo_id}-${currentSlideIndex}`}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  animation: `storyKenBurns ${pacingMs + 400}ms ease-out forwards`,
                  animationPlayState: isPlaying ? "running" : "paused",
                  transformOrigin: `${((currentSlide.focal_x ?? 0.5) * 100).toFixed(1)}% ${((currentSlide.focal_y ?? 0.5) * 100).toFixed(1)}%`,
                  willChange: "transform, opacity",
                }}
              >
                <img
                  src={getApiUrl(`/api/photos/${currentSlide.photo_id}/preview`)}
                  onError={(e) => {
                    // Fallback to original image if 8K preview proxy is not yet generated
                    (e.target as HTMLImageElement).src = getApiUrl(`/api/photos/${currentSlide.photo_id}/original`);
                  }}
                  alt={currentSlide.filename}
                  style={{
                    maxWidth: "100vw",
                    maxHeight: "100vh",
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              </div>
            )}
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
              backgroundColor: "rgba(0, 0, 0, 0.55)",
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
              backgroundColor: "rgba(0, 0, 0, 0.55)",
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
