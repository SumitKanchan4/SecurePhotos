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
  Sparkles,
  Music,
  SkipForward
} from "lucide-react";
import { PhotoItem } from "../types";
import { apiFetch, getApiUrl, getThumbnailUrl, getPreviewUrl, getVideoStreamUrl } from "../services/api";

interface MusicTrackItem {
  id: string;
  filename: string;
  title: string;
  artist: string;
  mood: string;
  duration_formatted: string;
  stream_url: string;
}

interface AlbumSlideshowModalProps {
  isOpen: boolean;
  albumName: string;
  photos: PhotoItem[];
  initialIndex?: number;
  onClose: () => void;
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

  // Soundtrack streaming state
  const [tracks, setTracks] = useState<MusicTrackItem[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  // Load real music tracks from backend
  useEffect(() => {
    if (!isOpen) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      return;
    }
    const loadTracks = async () => {
      try {
        const res = await apiFetch("/api/stories/music");
        if (res.ok) {
          const list: MusicTrackItem[] = await res.json();
          setTracks(list);
          if (list.length > 0) {
            // Pick a random starting soundtrack
            setCurrentTrackIndex(Math.floor(Math.random() * list.length));
          }
        }
      } catch (err) {
        console.error("Failed to load slideshow music tracks:", err);
      }
    };
    loadTracks();
  }, [isOpen]);

  const activeTrack = tracks[currentTrackIndex] || null;
  const audioSrc = activeTrack
    ? (activeTrack.stream_url.startsWith("http")
        ? activeTrack.stream_url
        : getApiUrl(activeTrack.stream_url))
    : null;

  // Synchronize soundtrack playback with slideshow play/pause and mute
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying && !isMuted && audioSrc) {
      audioRef.current.play().catch((e) => {
        console.warn("Audio playback awaiting user gesture:", e);
      });
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, isMuted, audioSrc]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Audio unlock listener for browser autoplay policy
  useEffect(() => {
    if (!isOpen) return;

    const unlockAudio = () => {
      if (audioRef.current && isPlaying && !isMuted) {
        audioRef.current.play().catch(() => {});
      }
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [isOpen, isPlaying, isMuted]);

  const handleNextTrack = useCallback(() => {
    if (tracks.length <= 1) return;
    setCurrentTrackIndex((prev) => (prev + 1) % tracks.length);
  }, [tracks.length]);

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
  const isVideo = Boolean(
    currentPhoto?.mime_type?.startsWith("video/") ||
    currentPhoto?.filename?.match(/\.(mp4|mov|webm|avi|mkv)$/i)
  );
  const imageUrl = currentPhoto ? getPreviewUrl(currentPhoto.id) : "";
  const videoUrl = currentPhoto ? getVideoStreamUrl(currentPhoto.id) : "";

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

      {/* Main Animated Photo or Video Container */}
      {isVideo ? (
        <div
          key={`video-${currentPhoto?.id}`}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <video
            src={videoUrl}
            poster={currentPhoto ? getThumbnailUrl(currentPhoto.id) : undefined}
            autoPlay
            playsInline
            muted={isMuted}
            onEnded={handleNext}
            style={{
              maxWidth: "100vw",
              maxHeight: "100vh",
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />
        </div>
      ) : (
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
      )}

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

      {/* Hidden Audio Element for Genuine Story Soundtrack Streaming */}
      <audio
        ref={audioRef}
        src={audioSrc || undefined}
        loop
        preload="auto"
      />

      {/* Left / Right Nav Touch Triggers */}
      {photos.length > 1 && (
        <>
          <button
            onClick={handlePrev}
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
            onClick={handleNext}
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
          onClick={() => setIsPlaying((p) => !p)}
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

        {/* Real Soundtrack Music Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            onClick={() => setIsMuted((m) => !m)}
            className="clickable"
            title={isMuted ? "Unmute Music (M)" : "Mute Music (M)"}
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
              padding: "6px 8px",
              borderRadius: "var(--radius-sm, 6px)",
            }}
          >
            {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            <Music size={13} style={{ opacity: 0.85 }} />
            <span style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {isMuted
                ? "Music Off"
                : (activeTrack ? activeTrack.title : "Soundtrack")}
            </span>
          </button>

          {tracks.length > 1 && (
            <button
              onClick={handleNextTrack}
              className="clickable"
              title="Next Track"
              style={{
                background: "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: "50%",
                color: "#ffffff",
                width: "26px",
                height: "26px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <SkipForward size={13} />
            </button>
          )}
        </div>

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
