import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Lock,
  EyeOff,
  Eye,
  Loader2,
  HelpCircle,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { PhotoTimeline } from "./photos/PhotoTimeline";
import { fromPhotoItem, sortNewestFirst } from "../utils/photoTimeline";
import { PhotoItem, VaultAlbumItem } from "../types";
import { VaultSetupWizard } from "./VaultSetupWizard";
import { VaultPasswordResetModal } from "./VaultPasswordResetModal";
import { VaultLockCard } from "./vault/VaultLockCard";
import { VaultAlbumPage, VaultAlbumsGrid, VaultDocuments, VaultIntro, VaultShield } from "./vault/VaultScreens";
import { apiFetch } from "../services/api";

interface VaultViewProps {
  onUnlockRequest?: () => void;
  onPhotoClick?: (index: number, photos?: PhotoItem[]) => void;
}

const DEFAULT_AUTO_LOCK_SECONDS = 300; // Used until the saved setting is loaded.


/**
 * VaultView Component
 *
 * Encrypted Private Vault (redesign R4): calm header with the auto-lock countdown, privacy
 * shield (P) and Lock now; Photos / Albums / Documents tabs; photos in month sections with the
 * month/year scrubber once the vault spans several months. Locked: one card with the PIN (or
 * password) and the Emergency Card link. Factory reset lives in Settings → Private Vault.
 */
/** How often activity on the vault screen is reported to the engine at most. */
export const ACTIVITY_PING_MS = 15_000;

export const VaultView: React.FC<VaultViewProps> = ({ onPhotoClick }) => {
  const { 
    isVaultUnlocked, 
    setIsVaultUnlocked,
    isVaultConfigured,
    vaultPasswordHint,
    checkVaultStatus,
    setActiveTab,
    showToast 
  } = useAppStore();

  const [isPrivacyShieldActive, setIsPrivacyShieldActive] = useState(false);
  const [vaultPhotos, setVaultPhotos] = useState<PhotoItem[]>([]);
  const [vaultAlbums, setVaultAlbums] = useState<VaultAlbumItem[]>([]);
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
  const [isLoadingAlbums, setIsLoadingAlbums] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [activeVaultSection, setActiveVaultSection] = useState<"photos" | "albums" | "documents">("photos");

  // Vault Album Drilldown State
  const [activeVaultAlbumId, setActiveVaultAlbumId] = useState<number | null>(null);
  const [vaultAlbumPhotos, setVaultAlbumPhotos] = useState<PhotoItem[]>([]);
  const [isLoadingAlbumPhotos, setIsLoadingAlbumPhotos] = useState(false);
  const [restoringAlbumId, setRestoringAlbumId] = useState<number | null>(null);
  const [restoringDocId, setRestoringDocId] = useState<number | null>(null);

  // The password hint (header button) and, after an Emergency Card reset, a fresh lock card
  // that asks for the new password.
  const [showHint, setShowHint] = useState(false);
  const [passwordResetCount, setPasswordResetCount] = useState(0);

  const [showPasswordResetModal, setShowPasswordResetModal] = useState(false);

  // Auto-lock countdown timer (5 minutes = 300s)
  // Idle timeout from Settings (auto_lock_duration); the engine enforces the same value (M8).
  const [autoLockSeconds, setAutoLockSeconds] = useState(DEFAULT_AUTO_LOCK_SECONDS);
  const [secondsRemaining, setSecondsRemaining] = useState(DEFAULT_AUTO_LOCK_SECONDS);

  useEffect(() => {
    if (!isVaultUnlocked) return;
    apiFetch("/api/system/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const seconds = Number(data?.settings?.auto_lock_duration);
        if (seconds > 0) {
          setAutoLockSeconds(seconds);
          setSecondsRemaining(seconds);
        }
      })
      .catch(() => {});
  }, [isVaultUnlocked]);
  const lastActivityRef = useRef<number>(Date.now());

  // Derived content partitions
  const visualPhotos = useMemo(() => {
    return sortNewestFirst(vaultPhotos.filter((p) => !p.is_document && !p.mime_type?.includes("pdf") && !p.filename?.toLowerCase().endsWith(".pdf")));
  }, [vaultPhotos]);
  const visualTimeline = useMemo(() => visualPhotos.map(fromPhotoItem), [visualPhotos]);
  const sortedAlbumPhotos = useMemo(() => sortNewestFirst(vaultAlbumPhotos), [vaultAlbumPhotos]);

  const documentPhotos = useMemo(() => {
    return vaultPhotos.filter((p) => Boolean(p.is_document) || p.mime_type?.includes("pdf") || p.filename?.toLowerCase().endsWith(".pdf") || p.vault_type === "documents");
  }, [vaultPhotos]);

  // Memoized photo click handlers to prevent child PhotoCard re-renders on auto-lock countdown ticks
  const activeAlbum = vaultAlbums.find((a) => a.id === activeVaultAlbumId) ?? null;

  const handlePhotoClick = useCallback((idx: number) => {
    onPhotoClick?.(idx, visualPhotos);
  }, [onPhotoClick, visualPhotos]);

  const handleAlbumPhotoClick = useCallback((idx: number) => {
    onPhotoClick?.(idx, sortedAlbumPhotos);
  }, [onPhotoClick, sortedAlbumPhotos]);


  // Check vault configuration on mount
  useEffect(() => {
    checkVaultStatus();
  }, [checkVaultStatus]);

  // Fetch locked albums
  const fetchVaultAlbums = useCallback(async () => {
    if (!isVaultUnlocked) return;
    setIsLoadingAlbums(true);
    try {
      const res = await apiFetch("/api/vault/albums");
      if (res.ok) {
        const albums: VaultAlbumItem[] = await res.json();
        setVaultAlbums(albums);
      }
    } catch (err) {
      console.error("Failed to load vault albums:", err);
    } finally {
      setIsLoadingAlbums(false);
    }
  }, [isVaultUnlocked]);

  // Fetch photos for a specific locked album
  const fetchVaultAlbumPhotos = useCallback(async (albumId: number) => {
    setIsLoadingAlbumPhotos(true);
    try {
      const res = await apiFetch(`/api/vault/albums/${albumId}/photos`);
      if (res.ok) {
        const photos: PhotoItem[] = await res.json();
        setVaultAlbumPhotos(photos);
      }
    } catch (err) {
      console.error("Failed to load vault album photos:", err);
    } finally {
      setIsLoadingAlbumPhotos(false);
    }
  }, []);

  useEffect(() => {
    if (activeVaultAlbumId) {
      fetchVaultAlbumPhotos(activeVaultAlbumId);
    }
  }, [activeVaultAlbumId, fetchVaultAlbumPhotos]);

  // Fetch decrypted vault photos whenever unlocked
  const fetchVaultPhotos = useCallback(async () => {
    if (!isVaultUnlocked) return;
    setIsLoadingPhotos(true);
    try {
      const res = await apiFetch("/api/vault/photos");
      if (res.ok) {
        const photos: PhotoItem[] = await res.json();
        setVaultPhotos(photos);
      } else if (res.status === 401) {
        setIsVaultUnlocked(false);
      }
    } catch (err) {
      console.error("Failed to load vault photos:", err);
    } finally {
      setIsLoadingPhotos(false);
    }
  }, [isVaultUnlocked, setIsVaultUnlocked]);

  useEffect(() => {
    if (isVaultUnlocked) {
      fetchVaultPhotos();
      fetchVaultAlbums();
    }
  }, [isVaultUnlocked, fetchVaultPhotos, fetchVaultAlbums]);

  // Background enhancement of vault photos (C7). The engine answers this without
  // counting it as activity, so polling never keeps the vault from auto-locking.
  const [vaultEnhancement, setVaultEnhancement] = useState<{
    is_active: boolean;
    completed_count: number;
    total_count: number;
    paused_reason: string | null;
  } | null>(null);

  useEffect(() => {
    if (!isVaultUnlocked) {
      setVaultEnhancement(null);
      return;
    }
    let cancelled = false;
    const poll = () =>
      apiFetch("/api/vault/enhancement-progress")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled) setVaultEnhancement(data);
        })
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isVaultUnlocked]);

  const handleRestoreAlbum = async (albumId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRestoringAlbumId(albumId);
    try {
      const res = await apiFetch(`/api/vault/albums/${albumId}/unlock`, { method: "POST" });
      if (res.ok) {
        showToast(`Moved ${vaultAlbums.find((a) => a.id === albumId)?.name ?? "the album"} back to your library.`, "success");
        setVaultAlbums((prev) => prev.filter((a) => a.id !== albumId));
        if (activeVaultAlbumId === albumId) {
          setActiveVaultAlbumId(null);
          setVaultAlbumPhotos([]);
        }
        fetchVaultPhotos();
      } else {
        showToast("The album couldn't be moved back. Try again.", "warning");
      }
    } catch (err) {
      console.error("Error restoring vault album:", err);
      showToast("The album couldn't be moved back. Try again.", "warning");
    } finally {
      setRestoringAlbumId(null);
    }
  };

  const handleRestoreItem = async (photoId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRestoringDocId(photoId);
    try {
      const res = await apiFetch("/api/vault/photos/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: [photoId] }),
      });
      if (res.ok) {
        showToast("Moved back to your library.", "success");
        setVaultPhotos((prev) => prev.filter((p) => p.id !== photoId));
        fetchVaultAlbums();
      } else {
        showToast("That couldn't be moved back. Try again.", "warning");
      }
    } catch (err) {
      console.error("Error restoring item:", err);
      showToast("That couldn't be moved back. Try again.", "warning");
    } finally {
      setRestoringDocId(null);
    }
  };

  // Auto-lock countdown (configured timeout) and activity tracking
  useEffect(() => {
    if (!isVaultUnlocked) return;

    // Activity on this screen is reported to the engine (at most every 15 s), and the countdown
    // restarts only when it is: both clocks then agree, so the engine never locks before the
    // countdown ends (M8 follow-up). If the engine has locked already, show the lock card.
    const resetActivity = () => {
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_PING_MS) return;
      lastActivityRef.current = now;
      setSecondsRemaining(autoLockSeconds);
      apiFetch("/api/vault/activity", { method: "POST" })
        .then((res) => {
          if (res.status === 401) handleManualLock();
        })
        .catch(() => {});
    };

    window.addEventListener("mousemove", resetActivity);
    window.addEventListener("keydown", resetActivity);
    window.addEventListener("click", resetActivity);

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastActivityRef.current) / 1000);
      const remaining = Math.max(0, autoLockSeconds - elapsed);
      setSecondsRemaining(remaining);

      if (remaining <= 0) {
        handleManualLock();
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      window.removeEventListener("mousemove", resetActivity);
      window.removeEventListener("keydown", resetActivity);
      window.removeEventListener("click", resetActivity);
    };
  }, [isVaultUnlocked, autoLockSeconds]);

  const handleManualLock = async () => {
    setIsVaultUnlocked(false);
    setVaultPhotos([]);
    setVaultAlbums([]);
    setActiveVaultAlbumId(null);
    setVaultAlbumPhotos([]);
    let pinCanReopen = false;
    try {
      const res = await apiFetch("/api/vault/lock", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      pinCanReopen = Boolean(data.pin_unlock_available);
    } catch (err) {
      console.error("Error locking vault:", err);
    }
    await checkVaultStatus();
    showToast(pinCanReopen ? "Vault locked. Your PIN can reopen it." : "Vault locked.", "info");
  };

  // Auto-lock countdown as m:ss ("locks in 4:58").
  const formatTimeRemaining = (totalSec: number) => `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;

  // P toggles the privacy shield while the vault is open (not while typing).
  useEffect(() => {
    if (!isVaultUnlocked) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "p" || e.key === "P") setIsPrivacyShieldActive((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isVaultUnlocked]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", padding: "16px 24px 0", gap: "16px" }}>
      
      {/* ── Header (redesign R4): title, calm status, privacy shield, Lock now ── */}
      <div className="vault-header">
        <h1 className="vault-title">Private Vault</h1>
        {isVaultUnlocked ? (
          <span className="vault-status" role="status" aria-live="off">
            <span className={`vault-status-dot${secondsRemaining <= 30 ? " is-soon" : ""}`} />
            Unlocked · locks in {formatTimeRemaining(secondsRemaining)}
          </span>
        ) : (
          <span className="vault-status vault-status-muted">{isVaultConfigured ? "Locked" : "Not set up yet"}</span>
        )}
        {isVaultUnlocked && vaultEnhancement?.is_active && vaultEnhancement.total_count > 0 && (
          <span className="vault-work" title="Vault photos are enhanced only while the vault is open. Nothing is ever stored unencrypted.">
            <Loader2 size={12} className="spin" />
            {vaultEnhancement.paused_reason === "on_battery"
              ? `Enhancing paused on battery (${vaultEnhancement.completed_count} of ${vaultEnhancement.total_count} done)`
              : `Enhancing vault photos · ${Math.min(vaultEnhancement.completed_count + 1, vaultEnhancement.total_count)} of ${vaultEnhancement.total_count}`}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {isVaultUnlocked ? (
          <>
            <button
              type="button"
              className={`vault-icon-btn${isPrivacyShieldActive ? " is-on" : ""}`}
              aria-label={isPrivacyShieldActive ? "Privacy shield: show photos" : "Privacy shield: blur photos"}
              aria-pressed={isPrivacyShieldActive}
              title="Privacy shield (P)"
              onClick={() => setIsPrivacyShieldActive((v) => !v)}
            >
              {isPrivacyShieldActive ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <button type="button" className="vault-lock-btn" onClick={handleManualLock} title="Lock the vault now (L)">
              <Lock size={14} strokeWidth={2.4} /> Lock now
            </button>
          </>
        ) : !isVaultConfigured ? null : vaultPasswordHint ? (
          <button type="button" className="vault-ghost-btn" onClick={() => setShowHint(!showHint)} title="Show your password hint">
            <HelpCircle size={13} /> Hint
          </button>
        ) : null}
      </div>

      {/* Photos | Albums | Documents */}
      {isVaultUnlocked && !isPrivacyShieldActive && !activeVaultAlbumId && (
        <div className="vault-tabs" role="tablist" aria-label="Vault sections">
          {([
            { id: "photos", label: "Photos", count: visualPhotos.length },
            { id: "albums", label: "Albums", count: vaultAlbums.length },
            { id: "documents", label: "Documents", count: documentPhotos.length },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeVaultSection === tab.id}
              className={`vault-tab${activeVaultSection === tab.id ? " is-active" : ""}`}
              onClick={() => setActiveVaultSection(tab.id)}
            >
              {tab.label} <span className="vault-tab-count">{tab.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Main area: setup, lock card, shield, or the open vault (R4 + R11) ── */}
      {isSetupMode ? (
        <VaultSetupWizard
          onComplete={() => {
            checkVaultStatus();
            setIsSetupMode(false);
            fetchVaultPhotos();
          }}
          onSwitchToUnlock={isVaultConfigured ? () => setIsSetupMode(false) : undefined}
          onCancel={() => setIsSetupMode(false)}
        />
      ) : !isVaultConfigured ? (
        <VaultIntro onSetUp={() => setIsSetupMode(true)} />
      ) : !isVaultUnlocked ? (
        /* Locked: one card with the PIN (or password) and the Emergency Card link (redesign R4) */
        <VaultLockCard
          key={passwordResetCount}
          startWithPassword={passwordResetCount > 0}
          showHint={showHint}
          onForgotPassword={() => setShowPasswordResetModal(true)}
        />
      ) : isPrivacyShieldActive ? (
        <VaultShield onShow={() => setIsPrivacyShieldActive(false)} />
      ) : activeAlbum ? (
        <VaultAlbumPage
          album={activeAlbum}
          photos={sortedAlbumPhotos}
          loading={isLoadingAlbumPhotos}
          moving={restoringAlbumId === activeAlbum.id}
          onBack={() => {
            setActiveVaultAlbumId(null);
            setVaultAlbumPhotos([]);
          }}
          onOpenPhoto={handleAlbumPhotoClick}
          onMoveOut={() => handleRestoreAlbum(activeAlbum.id)}
        />
      ) : activeVaultSection === "photos" ? (
        isLoadingPhotos ? (
          <div className="dash-empty">
            <Loader2 size={22} className="spin" />
          </div>
        ) : visualPhotos.length === 0 ? (
          <div className="dash-empty">
            <Lock size={26} aria-hidden="true" />
            <h2>Your vault is empty</h2>
            <p>Open a photo or video and press the lock (or L) to move it here. It disappears from Photos until you move it back.</p>
            <button type="button" className="dash-btn" onClick={() => setActiveTab("photos")}>
              Go to Photos
            </button>
          </div>
        ) : (
          <div className="vault-timeline">
            <PhotoTimeline photos={visualTimeline} onOpen={handlePhotoClick} vault minScrubberSections={4} />
          </div>
        )
      ) : activeVaultSection === "albums" ? (
        <div className="vault-section">
          <VaultAlbumsGrid albums={vaultAlbums} loading={isLoadingAlbums} onOpen={(album) => setActiveVaultAlbumId(album.id)} />
        </div>
      ) : (
        <div className="vault-section">
          <VaultDocuments
            docs={documentPhotos}
            loading={isLoadingPhotos}
            movingId={restoringDocId}
            onOpen={(idx) => onPhotoClick?.(idx, documentPhotos)}
            onMoveOut={(doc) => handleRestoreItem(doc.id)}
          />
        </div>
      )}

      <VaultPasswordResetModal
        isOpen={showPasswordResetModal}
        onClose={() => setShowPasswordResetModal(false)}
        onSuccess={() => {
          setShowPasswordResetModal(false);
          showToast("Master password reset successfully! Please unlock with your new password.", "success");
          setPasswordResetCount((n) => n + 1);
        }}
      />
    </div>
  );
};
