import React, { useState, useEffect, useCallback, useRef } from "react";
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
  RotateCcw,
  ArrowRight
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { PhotoGrid } from "./PhotoGrid";
import { PhotoItem } from "../types";
import { VaultSetupWizard } from "./VaultSetupWizard";

interface VaultViewProps {
  onUnlockRequest?: () => void;
  onPhotoClick?: (index: number, photos?: PhotoItem[]) => void;
}

/**
 * VaultView Component
 *
 * Flagship Zero-Trust Encrypted Vault matching the reference desktop UI.
 * Features a persistent 3-column liquid-glass toolbar, Option A seamless inline glass input,
 * zero marketing clutter, and an exact match to the empty/unlocked screenshot.
 */
export const VaultView: React.FC<VaultViewProps> = ({ onPhotoClick }) => {
  const { 
    isVaultUnlocked, 
    setIsVaultUnlocked,
    isVaultConfigured,
    setIsVaultConfigured,
    vaultPasswordHint,
    checkVaultStatus,
    setActiveTab,
    showToast 
  } = useAppStore();

  const [isPrivacyShieldActive, setIsPrivacyShieldActive] = useState(false);
  const [vaultPhotos, setVaultPhotos] = useState<PhotoItem[]>([]);
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);

  // Login form state
  const [password, setPassword] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [useRecoveryPhrase, setUseRecoveryPhrase] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");

  // 30-Second Auto-lock countdown timer
  const [secondsRemaining, setSecondsRemaining] = useState(30);
  const lastActivityRef = useRef<number>(Date.now());

  // Check vault configuration on mount
  useEffect(() => {
    checkVaultStatus();
  }, [checkVaultStatus]);

  // Fetch decrypted vault photos whenever unlocked
  const fetchVaultPhotos = useCallback(async () => {
    if (!isVaultUnlocked) return;
    setIsLoadingPhotos(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/vault/photos");
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
    }
  }, [isVaultUnlocked, fetchVaultPhotos]);

  // Handle auto-lock countdown and activity tracking
  useEffect(() => {
    if (!isVaultUnlocked) return;

    const resetActivity = () => {
      lastActivityRef.current = Date.now();
      setSecondsRemaining(30);
    };

    window.addEventListener("mousemove", resetActivity);
    window.addEventListener("keydown", resetActivity);
    window.addEventListener("click", resetActivity);

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastActivityRef.current) / 1000);
      const remaining = Math.max(0, 30 - elapsed);
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
  }, [isVaultUnlocked]);

  const handleManualLock = async () => {
    setIsVaultUnlocked(false);
    setPassword("");
    setRecoveryPhrase("");
    setLoginError("");
    setVaultPhotos([]);
    try {
      await fetch("http://127.0.0.1:8000/api/vault/lock", { method: "POST" });
    } catch (err) {
      console.error("Error locking vault:", err);
    }
    showToast("Vault locked and RAM purged.", "info");
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setIsSubmitting(true);

    try {
      const payload: Record<string, string> = {};
      if (useRecoveryPhrase) {
        payload.recovery_phrase = recoveryPhrase.trim();
      } else {
        payload.password = password;
      }

      const res = await fetch("http://127.0.0.1:8000/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setIsVaultUnlocked(true);
        setPassword("");
        setRecoveryPhrase("");
        showToast("Private Vault unlocked.", "success");
      } else {
        const data = await res.json().catch(() => ({}));
        setLoginError(data.detail || "Incorrect master password. Please try again.");
      }
    } catch (err: unknown) {
      console.error("Unlock error:", err);
      setLoginError("Could not connect to authentication service.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetVault = async () => {
    if (!window.confirm("Are you sure you want to reset this vault? This allows you to set up a brand new master password.")) {
      return;
    }
    try {
      await fetch("http://127.0.0.1:8000/api/vault/reset", { method: "POST" });
      setIsVaultConfigured(false);
      setIsVaultUnlocked(false);
      setIsSetupMode(true);
      showToast("Vault configuration cleared. You can now set up a new password.", "info");
    } catch (err) {
      console.error("Reset vault error:", err);
    }
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
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "10px", minWidth: "140px" }}>
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
                  color: secondsRemaining <= 10 ? "var(--accent-danger, #ef4444)" : "var(--text-muted)", 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "4px",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <Clock size={12} /> Auto-locks in {secondsRemaining}s
              </span>
            </>
          ) : !isVaultConfigured ? (
            <div 
              style={{
                padding: "4px 10px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "rgba(59, 130, 246, 0.12)",
                border: "1px solid rgba(59, 130, 246, 0.3)",
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
                backgroundColor: "rgba(59, 130, 246, 0.10)",
                border: "1px solid rgba(59, 130, 246, 0.25)",
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
                fontFamily: "Plus Jakarta Sans, sans-serif",
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
              ? `${vaultPhotos.length} ${vaultPhotos.length === 1 ? "photo" : "photos"}`
              : !isVaultConfigured 
                ? "Not Set Up" 
                : "Locked"}
          </span>
        </div>

        {/* Right Column: Actions */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", minWidth: "140px" }}>
          {isVaultUnlocked ? (
            <>
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
                  backgroundColor: isPrivacyShieldActive ? "var(--accent-primary)" : "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: isPrivacyShieldActive ? "#ffffff" : "var(--text-secondary)",
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
                title="Lock Vault and purge RAM immediately (L)"
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
                backgroundColor: "var(--accent-primary)",
                border: "none",
                color: "#ffffff",
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
              <button
                type="button"
                onClick={handleResetVault}
                className="clickable"
                title="Reset vault configuration"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-muted)",
                  fontSize: "11px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <RotateCcw size={11} />
                <span>Reset</span>
              </button>
            </div>
          )}
        </div>
      </div>

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
              backgroundColor: "rgba(59, 130, 246, 0.1)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent-primary)",
              marginBottom: "16px",
            }}
          >
            <Lock size={28} />
          </div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0", fontFamily: "Plus Jakarta Sans, sans-serif" }}>
            Protect Your Sensitive Media
          </h2>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "440px", lineHeight: "1.5", margin: "0 0 24px 0" }}>
            Create a personal encrypted vault with on-device AES-256-GCM encryption. Everything stays 100% on this device, protected by your master password.
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
              backgroundColor: "var(--accent-primary)",
              border: "none",
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(59, 130, 246, 0.3)",
              transition: "all 0.15s ease",
            }}
          >
            <Sparkles size={15} />
            <span>Set Up Encrypted Vault</span>
          </button>
        </div>
      ) : !isVaultUnlocked ? (
        /* Locked Landing Screen with Option A: Seamless Inline Glass Input */
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
          {/* Circular Lock Emblem (Matches Reference Screenshot) */}
          <div 
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "rgba(59, 130, 246, 0.1)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent-primary)",
              marginBottom: "16px",
            }}
          >
            <Lock size={28} />
          </div>

          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0", fontFamily: "Plus Jakarta Sans, sans-serif" }}>
            Your Private Vault is Locked
          </h2>

          <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "440px", lineHeight: "1.5", margin: "0 0 24px 0" }}>
            Photos and videos inside are protected with on-device encryption. Enter your master password to unlock.
          </p>

          {/* Option A: Seamless Inline Glass Input Bar (0 Extra Clicks) */}
          <form 
            onSubmit={handleUnlockSubmit}
            style={{
              width: "100%",
              maxWidth: useRecoveryPhrase ? "460px" : "380px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
            }}
          >
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
                <ShieldAlert size={14} />
                <span>{loginError}</span>
              </div>
            )}

            {showHint && vaultPasswordHint && (
              <div 
                style={{
                  width: "100%",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "rgba(59, 130, 246, 0.08)",
                  border: "1px solid rgba(59, 130, 246, 0.2)",
                  color: "var(--text-secondary)",
                  fontSize: "12px",
                  textAlign: "center",
                }}
              >
                💡 Hint: <strong style={{ color: "var(--text-primary)" }}>{vaultPasswordHint}</strong>
              </div>
            )}

            {useRecoveryPhrase ? (
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
                <textarea
                  value={recoveryPhrase}
                  onChange={(e) => setRecoveryPhrase(e.target.value)}
                  placeholder="Enter 24-word recovery phrase (separated by spaces)..."
                  rows={3}
                  autoFocus
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "12px 16px",
                    borderRadius: "var(--radius-md)",
                    backgroundColor: "var(--glass-surface)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    fontFamily: "var(--font-mono)",
                    resize: "none",
                    outline: "none",
                    boxShadow: "var(--glass-shadow)",
                  }}
                />
                <button
                  type="submit"
                  disabled={isSubmitting || !recoveryPhrase.trim()}
                  className="clickable"
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-primary)",
                    border: "none",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: isSubmitting || !recoveryPhrase.trim() ? "default" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    opacity: isSubmitting || !recoveryPhrase.trim() ? 0.6 : 1,
                  }}
                >
                  {isSubmitting ? <Loader2 size={14} className="spin-animation" /> : <Unlock size={14} />}
                  <span>{isSubmitting ? "Verifying Phrase..." : "Unlock with Phrase"}</span>
                </button>
              </div>
            ) : (
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
                    backgroundColor: "var(--accent-primary)",
                    border: "none",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: isSubmitting || !password ? "default" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    flexShrink: 0,
                    opacity: isSubmitting || !password ? 0.6 : 1,
                    boxShadow: "0 2px 8px rgba(59, 130, 246, 0.25)",
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
            )}

            {/* Subtle Recovery & Setup Links */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "center", marginTop: "4px" }}>
              <button
                type="button"
                onClick={() => {
                  setUseRecoveryPhrase(!useRecoveryPhrase);
                  setLoginError("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: "11px",
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: "2px",
                }}
              >
                {useRecoveryPhrase 
                  ? "Back to Master Password" 
                  : "Forgot password? Unlock with Recovery Phrase"}
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
                <button
                  type="button"
                  onClick={() => setIsSetupMode(true)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent-primary)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: "2px 6px",
                  }}
                >
                  Set up a new vault
                </button>

                <span style={{ color: "var(--border-subtle)", fontSize: "10px" }}>•</span>

                <button
                  type="button"
                  onClick={handleResetVault}
                  title="Clear current vault password configuration"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    fontSize: "11px",
                    cursor: "pointer",
                    padding: "2px 6px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                  }}
                >
                  <RotateCcw size={10} />
                  <span>Reset configuration</span>
                </button>
              </div>
            </div>
          </form>
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
                  backgroundColor: "var(--accent-primary)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Dismiss Shield
              </button>
            </div>
          )}

          {isLoadingPhotos ? (
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
          ) : vaultPhotos.length === 0 ? (
            /* Unlocked Empty State (100% Exact Match to User Screenshot) */
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
                  backgroundColor: "rgba(59, 130, 246, 0.1)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-primary)",
                  marginBottom: "16px",
                }}
              >
                <Lock size={28} />
              </div>
              <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0", fontFamily: "Plus Jakarta Sans, sans-serif" }}>
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
              photos={vaultPhotos} 
              onPhotoClick={(idx) => onPhotoClick?.(idx, vaultPhotos)} 
            />
          )}
        </div>
      )}
    </div>
  );
};
