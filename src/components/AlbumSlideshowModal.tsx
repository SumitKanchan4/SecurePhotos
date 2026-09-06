import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  X, 
  Play, 
  Pause, 
  ChevronLeft, 
  ChevronRight, 
  Volume2, 
  VolumeX, 
  Maximize,
  Sparkles 
} from "lucide-react";
import { PhotoItem } from "../types";

interface AlbumSlideshowModalProps {
  isOpen: boolean;
  albumName: string;
  photos: PhotoItem[];
  initialIndex?: number;
  onClose: () => void;
}

/**
 * Ambient Synthesizer using native Web Audio API.
 * Generates continuous, soothing ambient chord pads without any external audio files.
 */
class AmbientSoundscapeGenerator {
  private ctx: AudioContext | null = null;
  private isPlaying: boolean = false;
  private masterGain: GainNode | null = null;
  private timer: number | null = null;

  // Soothing warm chord progressions in the clearly audible 175Hz - 550Hz range
  private chords = [
    [261.63, 329.63, 392.00, 523.25], // C4, E4, G4, C5 (C Major)
    [220.00, 261.63, 329.63, 440.00], // A3, C4, E4, A4 (A minor)
    [293.66, 369.99, 440.00, 587.33], // D4, F#4, A4, D5 (D Major)
    [174.61, 261.63, 349.23, 392.00], // F3, C4, F4, G4 (F sus2)
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
      this.masterGain.gain.exponentialRampToValueAtTime(0.35, this.ctx.currentTime + 1.5);
      this.masterGain.connect(this.ctx.destination);

      if (this.ctx.state === "suspended") {
        await this.ctx.resume().catch(() => {});
      }

      this.scheduleNextPad();
    } catch (err) {
      console.warn("Web Audio API not allowed or supported:", err);
    }
  }

  public resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().then(() => {
        if (this.isPlaying && !this.timer) {
          this.scheduleNextPad();
        }
      }).catch(() => {});
    }
  }

  private scheduleNextPad() {
    if (!this.ctx || !this.isPlaying || !this.masterGain) return;

    // If context is suspended by the browser, wait for unlock
    if (this.ctx.state === "suspended") {
      this.ctx.resume().then(() => {
        if (this.isPlaying) this.scheduleNextPad();
      }).catch(() => {});
      return;
    }

    const chord = this.chords[this.chordIndex % this.chords.length];
    this.chordIndex++;

    const now = this.ctx.currentTime;
    const duration = 6.0; // 6 seconds per chord pad

    // Create a soft low-pass filter (950Hz provides rich warmth without muffling sound)
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(950, now);
    filter.Q.setValueAtTime(1.0, now);
    filter.connect(this.masterGain);

    chord.forEach((freq, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();

      // Soft sine + triangle for pure warm tone
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, now);

      // Subtle detune for rich celestial chorus
      osc.detune.setValueAtTime((i - 1.5) * 6, now);

      // Clear, gentle attack and release envelope
      const peakGain = 0.14;
      oscGain.gain.setValueAtTime(0.001, now);
      oscGain.gain.exponentialRampToValueAtTime(peakGain, now + 1.8);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(filter);

      osc.start(now);
      osc.stop(now + duration + 0.1);
    });

    this.timer = window.setTimeout(() => {
      if (this.isPlaying) this.scheduleNextPad();
    }, 4800); // 4.8s overlap creates smooth cross-dissolve chords
  }

  public setMute(muted: boolean) {
    if (!this.masterGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (muted) {
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    } else {
      this.resume();
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value || 0.001, now);
      this.masterGain.gain.exponentialRampToValueAtTime(0.35, now + 0.5);
    }
  }

  public stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {}
      this.ctx = null;
    }
  }
}

export const AlbumSlideshowModal: React.FC<AlbumSlideshowModalProps> = ({
  isOpen,
  albumName,
  photos,
  initialIndex = 0,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [animationKey, setAnimationKey] = useState(0);

  const soundscapeRef = useRef<AmbientSoundscapeGenerator | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  // Initialize soundscape
  useEffect(() => {
    if (isOpen) {
      soundscapeRef.current = new AmbientSoundscapeGenerator();
      soundscapeRef.current.start();
    }
    return () => {
      soundscapeRef.current?.stop();
      soundscapeRef.current = null;
    };
  }, [isOpen]);

  // Unlock audio on any user gesture (click anywhere, touch, or keydown)
  useEffect(() => {
    if (!isOpen) return;

    const unlockAudio = () => {
      soundscapeRef.current?.resume();
    };

    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [isOpen]);

  // Handle mute changes
  useEffect(() => {
    soundscapeRef.current?.setMute(isMuted);
  }, [isMuted]);

  // Slideshow auto-advance timer (5 seconds per slide)
  useEffect(() => {
    if (!isOpen || !isPlaying || photos.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % photos.length);
      setAnimationKey((k) => k + 1);
    }, 5000);

    return () => clearInterval(interval);
  }, [isOpen, isPlaying, photos.length]);

  const handleNext = useCallback(() => {
    if (photos.length <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % photos.length);
    setAnimationKey((k) => k + 1);
  }, [photos.length]);

  const handlePrev = useCallback(() => {
    if (photos.length <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + photos.length) % photos.length);
    setAnimationKey((k) => k + 1);
  }, [photos.length]);

  // Keyboard controls
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === " " || e.key === "k") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === "ArrowRight" || e.key === "l") {
        handleNext();
      } else if (e.key === "ArrowLeft" || e.key === "j") {
        handlePrev();
      } else if (e.key === "m" || e.key === "M") {
        setIsMuted((m) => !m);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handleNext, handlePrev]);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Auto-hide controls when mouse is inactive
  const handleMouseMove = () => {
    setShowControls(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  if (!isOpen || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex];
  const imageUrl = `http://127.0.0.1:8000/api/photos/${currentPhoto?.id}/preview`;

  return (
    <div
      onMouseMove={handleMouseMove}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#000000",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        cursor: showControls ? "default" : "none",
      }}
    >
      {/* Dynamic Keyframes for Ken Burns Pan & Zoom */}
      <style>{`
        @keyframes kenBurnsEffect {
          0% {
            transform: scale(1.0) translate(0%, 0%);
            opacity: 0.85;
          }
          15% {
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          100% {
            transform: scale(1.08) translate(1.2%, -0.8%);
            opacity: 0.95;
          }
        }
      `}</style>

      {/* Main Animated Photo Container */}
      <div
        key={animationKey}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animation: isPlaying ? "kenBurnsEffect 5.2s ease-out forwards" : "none",
          transformOrigin: "center center",
          willChange: "transform, opacity",
        }}
      >
        <img
          src={imageUrl}
          alt={currentPhoto?.filename}
          style={{
            maxWidth: "100vw",
            maxHeight: "100vh",
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </div>

      {/* Top Floating Bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "20px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)",
          opacity: showControls ? 1 : 0,
          transition: "opacity 0.3s ease",
          zIndex: 10,
        }}
      >
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#ffffff", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <Sparkles size={16} style={{ color: "var(--accent-primary, #6366f1)" }} />
            {albumName}
          </h2>
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)", margin: "2px 0 0", fontFamily: "var(--font-mono)" }}>
            Photo {currentIndex + 1} of {photos.length}
          </p>
        </div>

        <button
          onClick={onClose}
          className="clickable"
          title="Exit Slideshow (Esc)"
          style={{
            background: "rgba(255, 255, 255, 0.12)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "50%",
            color: "#ffffff",
            width: "36px",
            height: "36px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            backdropFilter: "blur(8px)",
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Left / Right Nav Touch Triggers */}
      {photos.length > 1 && (
        <>
          <button
            onClick={() => {
              soundscapeRef.current?.resume();
              handlePrev();
            }}
            style={{
              position: "absolute",
              left: "20px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "rgba(0,0,0,0.5)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "50%",
              color: "#ffffff",
              width: "44px",
              height: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              opacity: showControls ? 0.8 : 0,
              transition: "opacity 0.3s ease",
              zIndex: 10,
              backdropFilter: "blur(6px)",
            }}
            title="Previous (Left Arrow)"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={() => {
              soundscapeRef.current?.resume();
              handleNext();
            }}
            style={{
              position: "absolute",
              right: "20px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "rgba(0,0,0,0.5)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "50%",
              color: "#ffffff",
              width: "44px",
              height: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              opacity: showControls ? 0.8 : 0,
              transition: "opacity 0.3s ease",
              zIndex: 10,
              backdropFilter: "blur(6px)",
            }}
            title="Next (Right Arrow)"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}

      {/* Bottom Floating Control Bar */}
      <div
        style={{
          position: "absolute",
          bottom: "28px",
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "8px 18px",
          borderRadius: "var(--radius-full, 9999px)",
          background: "rgba(15, 17, 26, 0.75)",
          border: "1px solid rgba(255, 255, 255, 0.18)",
          backdropFilter: "blur(16px)",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.8)",
          opacity: showControls ? 1 : 0,
          transition: "opacity 0.3s ease",
          zIndex: 10,
        }}
      >
        {/* Play / Pause Toggle */}
        <button
          onClick={() => {
            soundscapeRef.current?.resume();
            setIsPlaying((p) => !p);
          }}
          className="clickable"
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          style={{
            background: isPlaying ? "var(--accent-primary, #6366f1)" : "rgba(255,255,255,0.15)",
            border: "none",
            borderRadius: "50%",
            color: "#ffffff",
            width: "36px",
            height: "36px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {isPlaying ? <Pause size={16} fill="#ffffff" /> : <Play size={16} fill="#ffffff" style={{ marginLeft: "2px" }} />}
        </button>

        {/* Ambient Music Toggle */}
        <button
          onClick={() => {
            soundscapeRef.current?.resume();
            setIsMuted((m) => !m);
          }}
          className="clickable"
          title={isMuted ? "Unmute Ambient Music (M)" : "Mute Ambient Music (M)"}
          style={{
            background: "transparent",
            border: "none",
            color: isMuted ? "var(--text-muted, #94a3b8)" : "#fbbf24",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            padding: "6px 10px",
            borderRadius: "var(--radius-sm, 6px)",
          }}
        >
          {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          <span>{isMuted ? "Music Off" : "Ambient Music"}</span>
        </button>

        <span style={{ height: "18px", width: "1px", background: "rgba(255,255,255,0.2)" }} />

        {/* Timeline Progress Pip */}
        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.8)", fontFamily: "var(--font-mono)" }}>
          {currentIndex + 1} / {photos.length}
        </span>

        <span style={{ height: "18px", width: "1px", background: "rgba(255,255,255,0.2)" }} />

        {/* Fullscreen Toggle */}
        <button
          onClick={toggleFullScreen}
          className="clickable"
          title="Toggle Fullscreen"
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: "4px",
          }}
        >
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
};
