import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { 
  Lock, 
  Unlock, 
  ShieldCheck, 
  Clock, 
  EyeOff, 
  Eye, 
  ShieldAlert, 
  Loader2, 
  HelpCircle, 
  Sparkles, 
  KeyRound, 
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  FileText,
  Folder,
  Image as ImageIcon,
  Receipt,
  CreditCard,
  FileCheck2,
  ExternalLink
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { PhotoGrid } from "./PhotoGrid";
import { PhotoItem, VaultAlbumItem } from "../types";
import { VaultSetupWizard } from "./VaultSetupWizard";
import { VaultPasswordResetModal } from "./VaultPasswordResetModal";
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
 * Flagship Zero-Trust Encrypted Vault with configurable auto-lock (1-30 minutes),
 * 4-digit quick PIN unlock with brute-force lock protection,
 * Master Password fallback, Emergency Card password reset, and guarded factory reset.
 */
export const VaultView: React.FC<VaultViewProps> = ({ onPhotoClick }) => {
  const { 
    isVaultUnlocked, 
    setIsVaultUnlocked,
    isVaultConfigured,
    setIsVaultConfigured,
    vaultPasswordHint,
    hasVaultPin,
    isVaultPinLocked,
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

  // Authentication mode: "pin" (after a lock) | "password"
  const [authMode, setAuthMode] = useState<"pin" | "password">("password");

  // Form states
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState(["", "", "", ""]);
  const [showPassword, setShowPassword] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Guarded factory reset modal
  const [showResetModal, setShowResetModal] = useState(false);
  const [showPasswordResetModal, setShowPasswordResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  // What a reset would erase; fetched only when the reset screen opens (not polled).
  const [resetPreview, setResetPreview] = useState<{ photo_count: number; album_count: number } | null>(null);

  useEffect(() => {
    if (!showResetModal) {
      setResetPreview(null);
      return;
    }
    let cancelled = false;
    apiFetch("/api/vault/reset-preview")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setResetPreview(data);
      })
      .catch(() => {
        /* Count is informational; the generic warning still shows. */
      });
    return () => {
      cancelled = true;
    };
  }, [showResetModal]);

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
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Derived content partitions
  const visualPhotos = useMemo(() => {
    return vaultPhotos.filter((p) => !p.is_document && !p.mime_type?.includes("pdf") && !p.filename?.toLowerCase().endsWith(".pdf"));
  }, [vaultPhotos]);

  const documentPhotos = useMemo(() => {
    return vaultPhotos.filter((p) => Boolean(p.is_document) || p.mime_type?.includes("pdf") || p.filename?.toLowerCase().endsWith(".pdf") || p.vault_type === "documents");
  }, [vaultPhotos]);

  // Memoized photo click handlers to prevent child PhotoCard re-renders on auto-lock countdown ticks
  const handlePhotoClick = useCallback((idx: number) => {
    onPhotoClick?.(idx, visualPhotos);
  }, [onPhotoClick, visualPhotos]);

  const handleAlbumPhotoClick = useCallback((idx: number) => {
    onPhotoClick?.(idx, vaultAlbumPhotos);
  }, [onPhotoClick, vaultAlbumPhotos]);


  // Check vault configuration on mount
  useEffect(() => {
    checkVaultStatus();
  }, [checkVaultStatus]);

  // Adjust default auth mode based on configuration and lock status
  useEffect(() => {
    if (hasVaultPin && !isVaultPinLocked) {
      setAuthMode("pin");
    } else {
      setAuthMode("password");
    }
  }, [hasVaultPin, isVaultPinLocked]);

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

    const resetActivity = () => {
      lastActivityRef.current = Date.now();
      setSecondsRemaining(autoLockSeconds);
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
    setPassword("");
    setPin(["", "", "", ""]);
    setLoginError("");
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

  // Generic unlock submission
  const performUnlock = async (payload: { password?: string; pin?: string }) => {
    setLoginError("");
    setIsSubmitting(true);

    try {
      const res = await apiFetch("/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setIsVaultUnlocked(true);
        setPassword("");
        setPin(["", "", "", ""]);
        await checkVaultStatus();
        showToast("Private Vault unlocked.", "success");
      } else {
        const data = await res.json().catch(() => ({}));
        setLoginError(data.detail || "Authentication failed. Please try again.");
        await checkVaultStatus();
        if (payload.pin) {
          // Clear pin inputs on failure
          setPin(["", "", "", ""]);
          pinInputRefs.current[0]?.focus();
        }
      }
    } catch (err: unknown) {
      console.error("Unlock error:", err);
      setLoginError("Could not connect to authentication service.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    performUnlock({ password });
  };

  // PIN change with auto-submit on 4th digit
  const handlePinDigitChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const nextPin = [...pin];
    nextPin[index] = digit;
    setPin(nextPin);

    if (digit && index < 3) {
      pinInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit if all 4 digits are entered
    const completePin = nextPin.join("");
    if (completePin.length === 4) {
      performUnlock({ pin: completePin });
    }
  };

  const handlePinDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus();
    }
  };

  // Guarded factory reset
  const handleGuardedReset = async () => {
    if (resetConfirmText.trim() !== "ERASE ALL DATA") {
      setLoginError("Please type 'ERASE ALL DATA' exactly to confirm factory reset.");
      return;
    }

    setIsResetting(true);
    try {
      const res = await apiFetch("/api/vault/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send exactly what the user typed; the engine verifies the phrase itself.
        body: JSON.stringify({ confirm_phrase: resetConfirmText.trim() }),
      });

      if (res.ok) {
        setIsVaultConfigured(false);
        setIsVaultUnlocked(false);
        setShowResetModal(false);
        setResetConfirmText("");
        setIsSetupMode(true);
        await checkVaultStatus();
        showToast("Vault erased. You can now set up a new vault.", "info");
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.detail || "Reset failed.", "warning");
      }
    } catch (err) {
      console.error("Reset vault error:", err);
      showToast("Error resetting vault.", "warning");
    } finally {
      setIsResetting(false);
    }
  };

  // Formatted auto-lock timer string
  const formatTimeRemaining = (totalSec: number) => {
    if (totalSec < 60) return `${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s < 10 ? "0" : ""}${s}s`;
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", padding: "16px 24px 0", gap: "16px" }}>
      
      {/* ── Persistent 3-Column Liquid-Glass Header Toolbar ───────────────── */}
      <div 
        className="liquid-glass-toolbar"
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          gap: "12px",
          padding: "10px 20px",
          minHeight: "56px",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--glass-border)",
          boxShadow: "var(--glass-shadow)",
          position: "sticky",
          top: 0,
          zIndex: 20,
          flexShrink: 0,
        }}
      >
        {/* Left Column: Security Status Badge */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "10px", minWidth: "160px" }}>
          {isVaultUnlocked ? (
            <>
              <div 
                style={{
                  padding: "4px 10px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  color: "var(--accent-success)",
                  fontSize: "11px",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <ShieldCheck size={13} />
                <span>UNLOCKED</span>
              </div>

              <span 
                style={{ 
                  fontSize: "11px", 
                  color: secondsRemaining <= 30 ? "var(--accent-danger, #ef4444)" : "var(--text-muted)", 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "4px",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <Clock size={12} /> Auto-locks in {formatTimeRemaining(secondsRemaining)}
              </span>
            </>
          ) : !isVaultConfigured ? (
            <div 
              style={{
                padding: "4px 10px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--accent-ink) 30%, transparent)",
                color: "var(--accent-primary)",
                fontSize: "11px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <KeyRound size={13} />
              <span>SETUP REQUIRED</span>
            </div>
          ) : (
            <div 
              style={{
                padding: "4px 10px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "color-mix(in srgb, var(--accent-ink) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--accent-ink) 25%, transparent)",
                color: "var(--accent-primary)",
                fontSize: "11px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <Lock size={13} />
              <span>LOCKED</span>
            </div>
          )}
        </div>

        {/* Center Column: Centered Display Title & Baseline Capsule Badge */}
        <div 
          style={{ 
            flex: "0 1 auto", 
            display: "flex", 
            alignItems: "baseline", 
            justifyContent: "center", 
            gap: "10px", 
            minWidth: 0 
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Lock size={18} style={{ color: "var(--accent-primary)" }} />
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 800,
                fontFamily: "var(--font-display)",
                letterSpacing: "-0.03em",
                color: "var(--text-primary)",
                margin: 0,
                whiteSpace: "nowrap",
              }}
            >
              Encrypted Vault
            </h1>
          </div>

          {/* Inline Frosted Capsule Badge on same horizontal baseline */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-badge-bg)",
              border: "1px solid var(--glass-badge-border)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            {isVaultUnlocked 
              ? activeVaultAlbumId
                ? `${vaultAlbumPhotos.length} ${vaultAlbumPhotos.length === 1 ? "photo" : "photos"}`
                : activeVaultSection === "photos"
                  ? `${visualPhotos.length} ${visualPhotos.length === 1 ? "photo" : "photos"}`
                  : activeVaultSection === "albums"
                    ? `${vaultAlbums.length} ${vaultAlbums.length === 1 ? "album" : "albums"}`
                    : `${documentPhotos.length} ${documentPhotos.length === 1 ? "document" : "documents"}`
              : !isVaultConfigured 
                ? "Not Set Up" 
                : "Locked"}
          </span>
        </div>

        {/* Right Column: Actions */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", minWidth: "160px" }}>
          {isVaultUnlocked ? (
            <>
              {vaultEnhancement?.is_active && vaultEnhancement.total_count > 0 && (
                <span
                  title="Vault photos are enhanced only while the vault is open. Nothing is ever stored unencrypted."
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px 10px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-badge-bg)",
                    border: "1px solid var(--glass-badge-border)",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--accent-primary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Loader2 size={12} className="spin" />
                  {vaultEnhancement.paused_reason === "on_battery"
                    ? `Enhancing paused on battery (${vaultEnhancement.completed_count} of ${vaultEnhancement.total_count} done)`
                    : `Enhancing vault photos (${Math.min(vaultEnhancement.completed_count + 1, vaultEnhancement.total_count)} of ${vaultEnhancement.total_count})`}
                </span>
              )}
              <button
                onClick={() => setIsPrivacyShieldActive(!isPrivacyShieldActive)}
                className="clickable"
                title="Conceal gallery view immediately"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: isPrivacyShieldActive ? "var(--accent-fill)" : "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: isPrivacyShieldActive ? "var(--on-accent)" : "var(--text-secondary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <EyeOff size={13} />
                <span>{isPrivacyShieldActive ? "Shield Active" : "Privacy Shield"}</span>
              </button>

              <button
                onClick={handleManualLock}
                className="clickable"
                title="Lock the vault (L)"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 16px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(239, 68, 68, 0.14)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "var(--accent-danger, #ef4444)",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <Lock size={13} />
                <span>Lock (L)</span>
              </button>
            </>
          ) : !isVaultConfigured ? (
            <button
              onClick={() => setIsSetupMode(true)}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 16px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--accent-fill)",
                border: "none",
                color: "var(--on-accent)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Sparkles size={13} />
              <span>Set Up Vault</span>
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {vaultPasswordHint && (
                <button
                  type="button"
                  onClick={() => setShowHint(!showHint)}
                  className="clickable"
                  title="Show password hint"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "6px 12px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-secondary)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <HelpCircle size={12} />
                  <span>Hint</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3-Segment Content Switcher: Photos | Albums | Documents */}
      {isVaultUnlocked && !isPrivacyShieldActive && !activeVaultAlbumId && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "2px 0",
            flexShrink: 0,
          }}
        >
          {[
            { id: "photos", label: "Photos", count: visualPhotos.length, icon: ImageIcon },
            { id: "albums", label: "Albums", count: vaultAlbums.length, icon: Folder },
            { id: "documents", label: "Documents", count: documentPhotos.length, icon: FileText },
          ].map((tab) => {
            const isSelected = activeVaultSection === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveVaultSection(tab.id as any)}
                className="clickable"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "7px 16px",
                  borderRadius: "var(--radius-full)",
                  border: isSelected 
                    ? "1px solid var(--glass-border-highlight)" 
                    : "1px solid var(--glass-border)",
                  backgroundColor: isSelected 
                    ? "var(--glass-pill-active)" 
                    : "var(--glass-pill-bg)",
                  color: isSelected 
                    ? "var(--text-primary)" 
                    : "var(--text-secondary)",
                  fontSize: "12px",
                  fontWeight: isSelected ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: isSelected ? "var(--glass-shadow)" : "none",
                }}
              >
                <Icon size={14} style={{ color: isSelected ? "var(--accent-primary)" : "var(--text-muted)" }} />
                <span>{tab.label}</span>
                <span
                  style={{
                    padding: "1px 7px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: isSelected ? "color-mix(in srgb, var(--accent-ink) 20%, transparent)" : "var(--glass-badge-bg)",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    color: isSelected ? "var(--accent-primary)" : "var(--text-muted)",
                  }}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
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
        /* Locked Landing Screen with Quick PIN / Master Password (+ Emergency Card reset link) */
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
          {/* Circular Lock Emblem */}
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
            Your Private Vault is Locked
          </h2>

          <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "440px", lineHeight: "1.5", margin: "0 0 24px 0" }}>
            {authMode === "pin"
              ? "Enter your 4-digit quick PIN to unlock instantly."
              : "Enter your master password to decrypt and unlock."}
          </p>

          <div 
            style={{
              width: "100%",
              maxWidth: "380px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "14px",
            }}
          >
            {/* PIN not usable right now: first unlock since opening the app, or 5 wrong PINs */}
            {isVaultPinLocked && (
              <div
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-secondary)",
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  lineHeight: "1.4",
                }}
              >
                <ShieldAlert size={14} style={{ flexShrink: 0 }} />
                <span>Enter your master password. After that, your PIN reopens the vault until you close the app.</span>
              </div>
            )}

            {loginError && (
              <div 
                style={{
                  width: "100%",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "var(--accent-danger, #ef4444)",
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}
              >
                <ShieldAlert size={14} style={{ flexShrink: 0 }} />
                <span>{loginError}</span>
              </div>
            )}

            {showHint && vaultPasswordHint && (
              <div 
                style={{
                  width: "100%",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "color-mix(in srgb, var(--accent-ink) 8%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent-ink) 20%, transparent)",
                  color: "var(--text-secondary)",
                  fontSize: "12px",
                  textAlign: "center",
                }}
              >
                💡 Hint: <strong style={{ color: "var(--text-primary)" }}>{vaultPasswordHint}</strong>
              </div>
            )}

            {/* ── Mode 1: 4-Digit Quick PIN Input ── */}
            {authMode === "pin" && !isVaultPinLocked && (
              <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
                  {[0, 1, 2, 3].map((idx) => (
                    <input
                      key={`unlock-pin-${idx}`}
                      ref={(el) => { pinInputRefs.current[idx] = el; }}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      value={pin[idx]}
                      onChange={(e) => handlePinDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handlePinDigitKeyDown(idx, e)}
                      autoFocus={idx === 0}
                      disabled={isSubmitting}
                      style={{
                        width: "50px",
                        height: "56px",
                        borderRadius: "var(--radius-md)",
                        backgroundColor: "var(--glass-surface)",
                        border: `1.5px solid ${pin[idx] ? "var(--accent-primary)" : "var(--glass-border)"}`,
                        color: "var(--text-primary)",
                        fontSize: "24px",
                        fontWeight: 700,
                        textAlign: "center",
                        outline: "none",
                        boxShadow: pin[idx] ? "0 0 12px color-mix(in srgb, var(--accent-ink) 25%, transparent)" : "var(--glass-shadow)",
                        transition: "all 0.15s ease",
                      }}
                    />
                  ))}
                </div>

                {isSubmitting && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--accent-primary)" }}>
                    <Loader2 size={13} className="spin-animation" />
                    <span>Verifying PIN...</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("password");
                    setLoginError("");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: "4px",
                  }}
                >
                  Unlock with Master Password instead
                </button>
              </div>
            )}

            {/* ── Mode 2: Master Password Input ── */}
            {authMode === "password" && (
              <form onSubmit={handlePasswordSubmit} style={{ width: "100%", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div 
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    backgroundColor: "var(--glass-surface)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "var(--radius-full)",
                    boxShadow: "var(--glass-shadow)",
                    padding: "4px 5px 4px 16px",
                    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
                  }}
                >
                  <Lock size={15} style={{ color: "var(--text-muted)", marginRight: "10px", flexShrink: 0 }} />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Master Password..."
                    autoFocus
                    disabled={isSubmitting}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      padding: "6px 0",
                      minWidth: 0,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? "Hide password" : "Show password"}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: "6px 8px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !password}
                    className="clickable"
                    style={{
                      padding: "8px 18px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--accent-fill)",
                      border: "none",
                      color: "var(--on-accent)",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: isSubmitting || !password ? "default" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      flexShrink: 0,
                      opacity: isSubmitting || !password ? 0.6 : 1,
                      boxShadow: "0 2px 8px color-mix(in srgb, var(--accent-ink) 25%, transparent)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {isSubmitting ? (
                      <Loader2 size={13} className="spin-animation" />
                    ) : (
                      <Unlock size={13} />
                    )}
                    <span>{isSubmitting ? "Decrypting..." : "Unlock"}</span>
                  </button>
                </div>

                {hasVaultPin && !isVaultPinLocked && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode("pin");
                      setLoginError("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent-primary)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "2px",
                    }}
                  >
                    Unlock with 4-Digit PIN instead
                  </button>
                )}
              </form>
            )}

            {/* Bottom Links: Emergency Card password reset & Guarded Reset */}
            {(
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "center", marginTop: "4px" }}>
                <button
                  type="button"
                  onClick={() => setShowPasswordResetModal(true)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: "2px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <CreditCard size={13} />
                  <span>Forgot your password? Use your Emergency Card</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    fontSize: "10px",
                    cursor: "pointer",
                    marginTop: "8px",
                    opacity: 0.7,
                  }}
                >
                  Factory Reset Vault
                </button>
              </div>
            )}
          </div>
        </div>
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
              <PhotoGrid 
                photos={vaultAlbumPhotos} 
                onPhotoClick={handleAlbumPhotoClick} 
              />
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
                  Your Private Vault is Empty
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
              <PhotoGrid 
                photos={visualPhotos} 
                onPhotoClick={handlePhotoClick} 
              />
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

      {/* ── Guarded Factory Reset Modal ── */}
      {showResetModal && (
        <div 
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "20px",
          }}
        >
          <div 
            style={{
              width: "100%",
              maxWidth: "440px",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              borderRadius: "var(--radius-lg)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              boxShadow: "0 16px 36px rgba(0, 0, 0, 0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--accent-danger, #ef4444)" }}>
              <AlertTriangle size={24} />
              <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Erase Private Vault</h3>
            </div>

            <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
              {resetPreview && (resetPreview.photo_count > 0 || resetPreview.album_count > 0) ? (
                <>
                  This permanently erases{" "}
                  <strong style={{ color: "var(--text-primary)" }}>
                    {resetPreview.photo_count} {resetPreview.photo_count === 1 ? "photo" : "photos"}
                    {resetPreview.album_count > 0 &&
                      ` and ${resetPreview.album_count} ${resetPreview.album_count === 1 ? "album" : "albums"}`}
                  </strong>{" "}
                  from your vault, along with its password and PIN. This can't be undone.
                </>
              ) : (
                "This permanently erases everything in your vault, along with its password and PIN. This can't be undone."
              )}
            </p>

            <div>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>
                Type <strong style={{ color: "var(--text-primary)" }}>ERASE ALL DATA</strong> to confirm:
              </label>
              <input 
                type="text"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="ERASE ALL DATA"
                autoFocus
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "10px 12px",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  fontFamily: "var(--font-mono)",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
              <button
                type="button"
                onClick={() => {
                  setShowResetModal(false);
                  setResetConfirmText("");
                }}
                disabled={isResetting}
                style={{
                  padding: "8px 16px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-secondary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleGuardedReset}
                disabled={resetConfirmText.trim() !== "ERASE ALL DATA" || isResetting}
                style={{
                  padding: "8px 18px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: resetConfirmText.trim() === "ERASE ALL DATA" ? "var(--accent-danger, #ef4444)" : "var(--glass-border)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: resetConfirmText.trim() === "ERASE ALL DATA" && !isResetting ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {isResetting && <Loader2 size={13} className="spin-animation" />}
                <span>Permanently Reset</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <VaultPasswordResetModal
        isOpen={showPasswordResetModal}
        onClose={() => setShowPasswordResetModal(false)}
        onSuccess={() => {
          setShowPasswordResetModal(false);
          showToast("Master password reset successfully! Please unlock with your new password.", "success");
          setAuthMode("password");
        }}
      />
    </div>
  );
};
