import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Lock,
  Unlock,
  EyeOff,
  Eye,
  Loader2,
  HelpCircle,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  FileText,
  Folder,
  Receipt,
  CreditCard,
  FileCheck2,
  ExternalLink
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { PhotoTimeline } from "./photos/PhotoTimeline";
import { fromPhotoItem, sortNewestFirst } from "../utils/photoTimeline";
import { PhotoItem, VaultAlbumItem } from "../types";
import { VaultSetupWizard } from "./VaultSetupWizard";
import { VaultPasswordResetModal } from "./VaultPasswordResetModal";
import { VaultLockCard } from "./vault/VaultLockCard";
import { apiFetch, getApiUrl } from "../services/api";

interface VaultViewProps {
  onUnlockRequest?: () => void;
  onPhotoClick?: (index: number, photos?: PhotoItem[]) => void;
}

const DEFAULT_AUTO_LOCK_SECONDS = 300; // Used until the saved setting is loaded.

const formatBytes = (bytes?: number) => {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const getDocIcon = (doc: PhotoItem) => {
  const name = (doc.filename || "").toLowerCase();
  const text = (doc.ocr_text || "").toLowerCase();
  if (name.includes("receipt") || text.includes("receipt") || text.includes("total") || text.includes("invoice")) {
    return <Receipt size={18} />;
  }
  if (name.includes("passport") || name.includes("license") || name.includes("id") || text.includes("passport") || text.includes("identity")) {
    return <CreditCard size={18} />;
  }
  if (name.includes("tax") || name.includes("w2") || name.includes("1040") || text.includes("internal revenue") || text.includes("tax")) {
    return <FileCheck2 size={18} />;
  }
  return <FileText size={18} />;
};

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
  const albumTimeline = useMemo(() => sortedAlbumPhotos.map(fromPhotoItem), [sortedAlbumPhotos]);

  const documentPhotos = useMemo(() => {
    return vaultPhotos.filter((p) => Boolean(p.is_document) || p.mime_type?.includes("pdf") || p.filename?.toLowerCase().endsWith(".pdf") || p.vault_type === "documents");
  }, [vaultPhotos]);

  // Memoized photo click handlers to prevent child PhotoCard re-renders on auto-lock countdown ticks
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
        showToast("Album decrypted and restored to public library.", "success");
        setVaultAlbums((prev) => prev.filter((a) => a.id !== albumId));
        if (activeVaultAlbumId === albumId) {
          setActiveVaultAlbumId(null);
          setVaultAlbumPhotos([]);
        }
        fetchVaultPhotos();
      } else {
        showToast("Failed to restore album.", "warning");
      }
    } catch (err) {
      console.error("Error restoring vault album:", err);
      showToast("Error restoring album.", "warning");
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
        showToast("Item decrypted and restored to library.", "success");
        setVaultPhotos((prev) => prev.filter((p) => p.id !== photoId));
        fetchVaultAlbums();
      } else {
        showToast("Failed to restore item.", "warning");
      }
    } catch (err) {
      console.error("Error restoring item:", err);
      showToast("Error restoring item.", "warning");
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

      {/* Album Drill-Down Subheader */}
      {isVaultUnlocked && !isPrivacyShieldActive && activeVaultAlbumId && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            backgroundColor: "var(--glass-surface)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--glass-border)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            boxShadow: "var(--glass-shadow)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={() => {
                setActiveVaultAlbumId(null);
                setVaultAlbumPhotos([]);
              }}
              className="clickable"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--glass-pill-bg)",
                border: "1px solid var(--glass-border)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <ArrowLeft size={13} />
              <span>Back to Albums</span>
            </button>
            <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
              {vaultAlbums.find((a) => a.id === activeVaultAlbumId)?.name || "Album"}
            </h2>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--glass-badge-bg)",
                border: "1px solid var(--glass-badge-border)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--text-secondary)",
              }}
            >
              {vaultAlbumPhotos.length} {vaultAlbumPhotos.length === 1 ? "photo" : "photos"}
            </span>
          </div>

          <button
            onClick={(e) => handleRestoreAlbum(activeVaultAlbumId, e)}
            disabled={restoringAlbumId === activeVaultAlbumId}
            className="clickable"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 16px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-fill)",
              border: "none",
              color: "var(--on-accent)",
              fontSize: "12px",
              fontWeight: 700,
              cursor: restoringAlbumId === activeVaultAlbumId ? "default" : "pointer",
              opacity: restoringAlbumId === activeVaultAlbumId ? 0.7 : 1,
            }}
          >
            {restoringAlbumId === activeVaultAlbumId ? (
              <Loader2 size={13} className="spin-animation" />
            ) : (
              <Unlock size={13} />
            )}
            <span>Restore to Library</span>
          </button>
        </div>
      )}

      {/* ── Main Canvas ───────────────────────────────────────────────────── */}
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
        /* First-Time Setup Landing Screen (Sleek, Minimalist) */
        <div 
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            textAlign: "center",
            padding: "0 20px",
            minHeight: "440px",
          }}
        >
          <div 
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "color-mix(in srgb, var(--accent-ink) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent-ink) 25%, transparent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent-primary)",
              marginBottom: "16px",
            }}
          >
            <Lock size={28} />
          </div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0", fontFamily: "var(--font-display)" }}>
            Protect Your Sensitive Media
          </h2>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "440px", lineHeight: "1.5", margin: "0 0 24px 0" }}>
            Create a personal encrypted vault with on-device AES-256-GCM encryption. Everything stays 100% on this device, protected by your master password and quick PIN.
          </p>
          <button
            onClick={() => setIsSetupMode(true)}
            className="clickable"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 24px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-fill)",
              border: "none",
              color: "var(--on-accent)",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 16px color-mix(in srgb, var(--accent-ink) 30%, transparent)",
              transition: "all 0.15s ease",
            }}
          >
            <Sparkles size={15} />
            <span>Set Up Encrypted Vault</span>
          </button>
        </div>
      ) : !isVaultUnlocked ? (
        /* Locked: one card with the PIN (or password) and the Emergency Card link (redesign R4) */
        <VaultLockCard
          key={passwordResetCount}
          startWithPassword={passwordResetCount > 0}
          showHint={showHint}
          onForgotPassword={() => setShowPasswordResetModal(true)}
        />
      ) : (
        /* Unlocked State: Gallery or Empty Screen */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          
          {/* Frosted Privacy Shield Screen Overlay */}
          {isPrivacyShieldActive && (
            <div 
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: "rgba(9, 10, 15, 0.88)",
                backdropFilter: "blur(32px)",
                WebkitBackdropFilter: "blur(32px)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 50,
              }}
            >
              <Lock size={48} style={{ color: "var(--accent-primary)", marginBottom: "16px" }} />
              <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Privacy Shield Active</h3>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "6px" }}>
                Vault contents are obscured for privacy while unlocked.
              </p>
              <button
                onClick={() => setIsPrivacyShieldActive(false)}
                className="clickable"
                style={{
                  marginTop: "16px",
                  padding: "8px 20px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--accent-fill)",
                  border: "none",
                  color: "var(--on-accent)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Dismiss Shield
              </button>
            </div>
          )}

          {/* ── Active Album Drill-Down Content ── */}
          {activeVaultAlbumId ? (
            isLoadingAlbumPhotos ? (
              <div 
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "12px",
                  color: "var(--text-secondary)",
                  minHeight: "400px",
                }}
              >
                <Loader2 size={24} className="spin-animation" style={{ color: "var(--accent-primary)" }} />
                <span style={{ fontSize: "13px" }}>Decrypting Album Photos...</span>
              </div>
            ) : vaultAlbumPhotos.length === 0 ? (
              <div 
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                  textAlign: "center",
                  padding: "40px 20px",
                  minHeight: "400px",
                }}
              >
                <Folder size={40} style={{ color: "var(--accent-primary)", marginBottom: "12px", opacity: 0.7 }} />
                <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px 0" }}>
                  This Locked Album is Empty
                </h3>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  No active photos found in this album.
                </p>
              </div>
            ) : (
              <div className="vault-timeline">
                <PhotoTimeline photos={albumTimeline} onOpen={handleAlbumPhotoClick} vault minScrubberSections={4} />
              </div>
            )
          ) : activeVaultSection === "photos" ? (
            /* ── Section 1: Visual Photos ── */
            isLoadingPhotos ? (
              <div 
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "12px",
                  color: "var(--text-secondary)",
                  minHeight: "400px",
                }}
              >
                <Loader2 size={24} className="spin-animation" style={{ color: "var(--accent-primary)" }} />
                <span style={{ fontSize: "13px" }}>Decrypting Vault Gallery...</span>
              </div>
            ) : visualPhotos.length === 0 ? (
              <div 
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                  textAlign: "center",
                  padding: "0 20px",
                  minHeight: "440px",
                }}
              >
                <div 
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "color-mix(in srgb, var(--accent-ink) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--accent-ink) 25%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--accent-primary)",
                    marginBottom: "16px",
                  }}
                >
                  <Lock size={28} />
                </div>
                <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0", fontFamily: "var(--font-display)" }}>
                  Your vault is empty
                </h2>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "440px", lineHeight: "1.5", margin: "0 0 20px 0" }}>
                  Select any photo or video from your library and press <strong>"L"</strong> or choose <strong>"Move to Vault"</strong> to securely encrypt it on this device.
                </p>
                <button
                  onClick={() => setActiveTab("photos")}
                  className="clickable"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 18px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <span>Browse Photos Library</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            ) : (
              <div className="vault-timeline">
                <PhotoTimeline photos={visualTimeline} onOpen={handlePhotoClick} vault minScrubberSections={4} />
              </div>
            )
          ) : activeVaultSection === "albums" ? (
            /* ── Section 2: Locked Albums ── */
            isLoadingAlbums ? (
              <div 
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "12px",
                  color: "var(--text-secondary)",
                  minHeight: "400px",
                }}
              >
                <Loader2 size={24} className="spin-animation" style={{ color: "var(--accent-primary)" }} />
                <span style={{ fontSize: "13px" }}>Loading Locked Albums...</span>
              </div>
            ) : vaultAlbums.length === 0 ? (
              <div 
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                  textAlign: "center",
                  padding: "0 20px",
                  minHeight: "440px",
                }}
              >
                <div 
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "color-mix(in srgb, var(--accent-ink) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--accent-ink) 25%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--accent-primary)",
                    marginBottom: "16px",
                  }}
                >
                  <Folder size={28} />
                </div>
                <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0", fontFamily: "var(--font-display)" }}>
                  No Locked Albums
                </h2>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "440px", lineHeight: "1.5", margin: "0 0 20px 0" }}>
                  Lock any album from the Albums tab to encrypt all its member photos and isolate them inside the private vault.
                </p>
                <button
                  onClick={() => setActiveTab("albums")}
                  className="clickable"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 18px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <span>Browse Albums</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
                  {vaultAlbums.map((album) => (
                    <div
                      key={album.id}
                      onClick={() => setActiveVaultAlbumId(album.id)}
                      className="clickable glass-panel"
                      style={{
                        borderRadius: "var(--radius-lg)",
                        backgroundColor: "var(--glass-surface)",
                        border: "1px solid var(--glass-border)",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        boxShadow: "var(--glass-shadow)",
                        cursor: "pointer",
                        transition: "transform 0.18s ease, box-shadow 0.18s ease",
                      }}
                    >
                      <div style={{ position: "relative", width: "100%", height: "170px", backgroundColor: "rgba(15, 23, 42, 0.6)", overflow: "hidden" }}>
                        {album.cover_photo_id ? (
                          <img
                            src={getApiUrl(`/api/vault/thumbnail/${album.cover_photo_id}`)}
                            alt={album.name}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            onError={(e) => { (e.currentTarget as HTMLElement).style.display = "none"; }}
                          />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)" }}>
                            <Folder size={40} style={{ color: "var(--accent-primary)", opacity: 0.5 }} />
                          </div>
                        )}
                        <div style={{ position: "absolute", top: "10px", right: "10px", display: "flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "var(--radius-full)", backgroundColor: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(12px)", border: "1px solid color-mix(in srgb, var(--accent-ink) 40%, transparent)", color: "var(--accent-fill)", fontSize: "10px", fontWeight: 700 }}>
                          <Lock size={10} />
                          <span>LOCKED</span>
                        </div>
                      </div>

                      <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {album.name}
                          </h3>
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                            {album.photo_count} {album.photo_count === 1 ? "photo" : "photos"}
                          </span>
                        </div>

                        <button
                          onClick={(e) => handleRestoreAlbum(album.id, e)}
                          disabled={restoringAlbumId === album.id}
                          className="clickable"
                          title="Restore album and all its photos to public library"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "6px 12px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "var(--glass-pill-bg)",
                            border: "1px solid var(--glass-border)",
                            color: "var(--accent-primary)",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: restoringAlbumId === album.id ? "default" : "pointer",
                            flexShrink: 0,
                          }}
                        >
                          {restoringAlbumId === album.id ? (
                            <Loader2 size={11} className="spin-animation" />
                          ) : (
                            <Unlock size={11} />
                          )}
                          <span>Restore</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            /* ── Section 3: Encrypted Documents ── */
            isLoadingPhotos ? (
              <div 
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "12px",
                  color: "var(--text-secondary)",
                  minHeight: "400px",
                }}
              >
                <Loader2 size={24} className="spin-animation" style={{ color: "var(--accent-primary)" }} />
                <span style={{ fontSize: "13px" }}>Decrypting Documents...</span>
              </div>
            ) : documentPhotos.length === 0 ? (
              <div 
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                  textAlign: "center",
                  padding: "0 20px",
                  minHeight: "440px",
                }}
              >
                <div 
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "color-mix(in srgb, var(--accent-ink) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--accent-ink) 25%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--accent-primary)",
                    marginBottom: "16px",
                  }}
                >
                  <FileText size={28} />
                </div>
                <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0", fontFamily: "var(--font-display)" }}>
                  No Encrypted Documents
                </h2>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "440px", lineHeight: "1.5", margin: "0 0 20px 0" }}>
                  Passports, IDs, tax returns, receipts, and invoices moved to the vault appear here with on-device OCR text previews.
                </p>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }}>
                  {documentPhotos.map((doc, idx) => (
                    <div
                      key={doc.id}
                      className="glass-panel"
                      style={{
                        borderRadius: "var(--radius-lg)",
                        backgroundColor: "var(--glass-surface)",
                        border: "1px solid var(--glass-border)",
                        padding: "16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        boxShadow: "var(--glass-shadow)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                          <div
                            style={{
                              width: "38px",
                              height: "38px",
                              borderRadius: "var(--radius-md)",
                              backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--accent-ink) 25%, transparent)",
                              color: "var(--accent-primary)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {getDocIcon(doc)}
                          </div>

                          <div style={{ minWidth: 0 }}>
                            <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {doc.caption || doc.filename}
                            </h3>
                            <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                              {doc.taken_at ? doc.taken_at.split("T")[0] : "Document"} • {formatBytes(doc.file_size)}
                            </span>
                          </div>
                        </div>

                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                            border: "1px solid color-mix(in srgb, var(--accent-ink) 30%, transparent)",
                            color: "var(--accent-primary)",
                            fontSize: "10px",
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          <Lock size={10} /> ENCRYPTED
                        </span>
                      </div>

                      {/* OCR Extracted Snippet Preview */}
                      {doc.ocr_text ? (
                        <div
                          style={{
                            backgroundColor: "rgba(15, 23, 42, 0.4)",
                            padding: "10px 12px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--glass-border)",
                            fontSize: "11px",
                            fontFamily: "var(--font-mono)",
                            color: "var(--text-secondary)",
                            lineHeight: "1.4",
                            maxHeight: "72px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          <span style={{ color: "var(--accent-primary)", fontWeight: 600 }}>OCR Extracted: </span>
                          {doc.ocr_text}
                        </div>
                      ) : null}

                      {/* Document Action Row */}
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "auto" }}>
                        <button
                          onClick={() => onPhotoClick?.(idx, documentPhotos)}
                          className="clickable"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "6px 14px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "var(--glass-pill-bg)",
                            border: "1px solid var(--glass-border)",
                            color: "var(--text-primary)",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          <ExternalLink size={12} />
                          <span>Open Scan</span>
                        </button>

                        <button
                          onClick={(e) => handleRestoreItem(doc.id, e)}
                          disabled={restoringDocId === doc.id}
                          className="clickable"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "6px 14px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "var(--accent-fill)",
                            border: "none",
                            color: "var(--on-accent)",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: restoringDocId === doc.id ? "default" : "pointer",
                            opacity: restoringDocId === doc.id ? 0.7 : 1,
                          }}
                        >
                          {restoringDocId === doc.id ? (
                            <Loader2 size={12} className="spin-animation" />
                          ) : (
                            <Unlock size={12} />
                          )}
                          <span>Restore</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
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
