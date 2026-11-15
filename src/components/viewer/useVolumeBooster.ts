/**
 * Video volume booster for the viewer (Q5: moved out of Lightbox.tsx unchanged).
 * VLC-style pre-amp from 0% to 200% through Web Audio, remembered between viewings, with a
 * short on-screen readout after each change.
 */
import { useEffect, useRef, useState } from "react";

export function useVolumeBooster() {
  // ─── VLC-Style Audio Pre-Amp Booster (0% - 200%) ──────────────────────────────
  const [volumeBoost, setVolumeBoost] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("securephotos_video_volume");
      return saved !== null ? Math.max(0, Math.min(200, parseInt(saved, 10))) : 100;
    } catch {
      return 100;
    }
  });
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem("securephotos_video_muted") === "true";
    } catch {
      return false;
    }
  });
  const [showVolumeHud, setShowVolumeHud] = useState(false);
  const volumeHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeBoostRef = useRef(volumeBoost);
  const isMutedRef = useRef(isMuted);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);

  // Synchronize refs to avoid stale closures in window event listeners
  useEffect(() => {
    volumeBoostRef.current = volumeBoost;
  }, [volumeBoost]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const ensureAudioContext = () => {
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const gain = ctx.createGain();
          const initialGain = isMutedRef.current ? 0 : volumeBoostRef.current / 100;
          gain.gain.setValueAtTime(initialGain, ctx.currentTime);
          gain.connect(ctx.destination);
          audioContextRef.current = ctx;
          gainNodeRef.current = gain;
        }
      }
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
    } catch (err) {
      console.warn("AudioContext initialization warning:", err);
    }
  };

  const connectVideoToPreamp = (videoEl: HTMLVideoElement) => {
    try {
      ensureAudioContext();
      if (!audioContextRef.current || !gainNodeRef.current) return;
      const elWithFlag = videoEl as HTMLVideoElement & { __securephotos_preamp_connected?: boolean };
      if (!elWithFlag.__securephotos_preamp_connected) {
        const source = audioContextRef.current.createMediaElementSource(videoEl);
        source.connect(gainNodeRef.current);
        elWithFlag.__securephotos_preamp_connected = true;
      }
    } catch (err) {
      console.warn("Could not attach Web Audio pre-amp node to video:", err);
    }
  };

  const triggerVolumeHud = () => {
    setShowVolumeHud(true);
    if (volumeHudTimerRef.current) {
      clearTimeout(volumeHudTimerRef.current);
    }
    volumeHudTimerRef.current = setTimeout(() => {
      setShowVolumeHud(false);
    }, 1800);
  };

  const applyVolume = (newVol: number, newMuted?: boolean) => {
    const clamped = Math.max(0, Math.min(200, Math.round(newVol)));
    const targetMuted = newMuted !== undefined ? newMuted : (clamped === 0 ? true : isMutedRef.current);

    setVolumeBoost(clamped);
    volumeBoostRef.current = clamped;
    setIsMuted(targetMuted);
    isMutedRef.current = targetMuted;

    try {
      localStorage.setItem("securephotos_video_volume", String(clamped));
      localStorage.setItem("securephotos_video_muted", String(targetMuted));
    } catch {
      // Local storage unavailable or restricted
    }

    ensureAudioContext();
    if (gainNodeRef.current && audioContextRef.current) {
      const targetGain = targetMuted ? 0 : clamped / 100;
      gainNodeRef.current.gain.setValueAtTime(targetGain, audioContextRef.current.currentTime);
    }

    triggerVolumeHud();
  };

  const toggleMute = () => {
    const nextMuted = !isMutedRef.current;
    applyVolume(volumeBoostRef.current, nextMuted);
  };

  useEffect(() => {
    return () => {
      if (volumeHudTimerRef.current) {
        clearTimeout(volumeHudTimerRef.current);
      }
    };
  }, []);

  return {
    volumeBoost,
    isMuted,
    showVolumeHud,
    volumeBoostRef,
    isMutedRef,
    videoElementRef,
    ensureAudioContext,
    connectVideoToPreamp,
    applyVolume,
    toggleMute,
  };
}
