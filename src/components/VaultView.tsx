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
  HardDrive,
  FileCheck,
  EyeOff as EyeOffIcon,
  RotateCcw
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
 * Flagship Zero-Trust Encrypted Vault with native app aesthetic,
 * educational introduction, first-time setup toggle, and in-memory photo gallery.
 */
export const VaultView: React.FC<VaultViewProps> = ({ onPhotoClick }) => {
  const { 
    isVaultUnlocked, 
    setIsVaultUnlocked,
    isVaultConfigured,
    setIsVaultConfigured,
    vaultPasswordHint,
    hasVaultTotp,
    checkVaultStatus,
    showToast 
  } = useAppStore();

  const [isPrivacyShieldActive, setIsPrivacyShieldActive] = useState(false);
  const [vaultPhotos, setVaultPhotos] = useState<PhotoItem[]>([]);
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);

  // Login form state
  const [password, setPassword] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [totpCode, setTotpCode] = useState("");
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
    setTotpCode("");
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
      if (totpCode) {
        payload.totp_code = totpCode.trim();
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

  // ── SCENARIO A: First-Time Setup Wizard ─────────────────────────────
  if (!isVaultConfigured || isSetupMode) {
    return (
      <VaultSetupWizard 
        onComplete={() => {
          checkVaultStatus();
          setIsSetupMode(false);
          fetchVaultPhotos();
        }} 
        onSwitchToUnlock={isVaultConfigured ? () => setIsSetupMode(false) : undefined}
      />
    );
  }

  // ── SCENARIO B: Intuitive Native Login Gate & Feature Explainer ─────
  if (!isVaultUnlocked) {
    return (
      <div 
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "36px 24px",
          overflowY: "auto",
          gap: "28px",
        }}
      >
        {/* Hero & Value Proposition (Explaining what this screen is and why it exists) */}
        <div 
          style={{ 
            maxWidth: "680px", 
            width: "100%", 
            display: "flex", 
            flexDirection: "column", 
            alignItems: "center", 
            textAlign: "center", 
            gap: "12px" 
          }}
        >
          <div 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "rgba(59, 130, 246, 0.10)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              color: "var(--accent-primary)",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.02em",
            }}
          >
            <ShieldCheck size={14} />
            <span>ZERO-TRUST PRIVATE VAULT</span>
          </div>

          <h1
            style={{
              fontFamily: "Plus Jakarta Sans, sans-serif",
              fontSize: "28px",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Your Private Digital Safe
          </h1>

          <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0, lineHeight: "1.6", maxWidth: "560px" }}>
            The Encrypted Vault is a mathematically isolated local repository. Photos and documents moved here are encrypted on your device and hidden from your main photo timeline, albums, and searches.
          </p>

          {/* 3 Pillar Informational Cards */}
          <div 
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "12px",
              width: "100%",
              marginTop: "8px",
              textAlign: "left",
            }}
          >
            <div 
              style={{
                padding: "14px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--glass-surface)",
                border: "1px solid var(--glass-border)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--accent-primary)" }}>
                <HardDrive size={16} />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>100% On-Device</span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: "1.4" }}>
                Encrypted with AES-256-GCM. Unreadable by any cloud sync tools or outside applications.
              </p>
            </div>

            <div 
              style={{
                padding: "14px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--glass-surface)",
                border: "1px solid var(--glass-border)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--accent-success)" }}>
                <EyeOffIcon size={16} />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>Concealed Media</span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: "1.4" }}>
                Locked photos disappear from the public timeline, albums, and search until unlocked.
              </p>
            </div>

            <div 
              style={{
                padding: "14px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--glass-surface)",
                border: "1px solid var(--glass-border)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--accent-primary)" }}>
                <FileCheck size={16} />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>Zero-Disk Traces</span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: "1.4" }}>
                Decrypted only in volatile memory while viewing. Zero unencrypted files are ever saved to disk.
              </p>
            </div>
          </div>
        </div>

        {/* Floating Unlock Card (Native Sapphire Blue & Liquid Glass) */}
        <div 
          className="liquid-glass-toolbar"
          style={{
            width: "100%",
            maxWidth: "460px",
            backgroundColor: "var(--glass-surface)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--glass-border)",
            boxShadow: "var(--glass-shadow)",
            padding: "32px",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Lock size={18} style={{ color: "var(--accent-primary)" }} />
              <h2
                style={{
                  fontFamily: "Plus Jakarta Sans, sans-serif",
                  fontSize: "18px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "var(--text-primary)",
                  margin: 0,
                }}
              >
                Unlock Private Vault
              </h2>
            </div>

            <span 
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--text-muted)",
                backgroundColor: "var(--glass-pill-bg)",
                padding: "2px 8px",
                borderRadius: "var(--radius-full)",
                border: "1px solid var(--glass-border)",
              }}
            >
              Locked
            </span>
          </div>

          <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0, lineHeight: "1.5" }}>
            Enter your master password to decrypt your session and view your private photos.
          </p>

          {loginError && (
            <div 
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#f87171",
                fontSize: "12px",
                lineHeight: "1.4",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <ShieldAlert size={14} style={{ flexShrink: 0 }} />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleUnlockSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {!useRecoveryPhrase ? (
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Master Password
                </label>
                <div 
                  style={{
                    display: "flex",
                    alignItems: "center",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "var(--radius-sm)",
                    padding: "2px 12px",
                  }}
                >
                  <Lock size={15} style={{ color: "var(--text-muted)", marginRight: "8px" }} />
                  <input 
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter master password..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    required
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      padding: "10px 0",
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px" }}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                {/* Password Hint Pill */}
                {vaultPasswordHint && (
                  <div style={{ marginTop: "6px" }}>
                    {!showHint ? (
                      <button
                        type="button"
                        onClick={() => setShowHint(true)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--accent-primary)",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: "0",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <HelpCircle size={12} />
                        <span>Show Password Hint</span>
                      </button>
                    ) : (
                      <div 
                        style={{
                          padding: "6px 10px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "rgba(59, 130, 246, 0.08)",
                          border: "1px solid rgba(59, 130, 246, 0.25)",
                          fontSize: "11px",
                          color: "var(--text-secondary)",
                        }}
                      >
                        💡 <strong>Hint:</strong> {vaultPasswordHint}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                  24-Word Recovery Phrase
                </label>
                <textarea 
                  placeholder="Paste your 24 words separated by spaces..."
                  value={recoveryPhrase}
                  onChange={(e) => setRecoveryPhrase(e.target.value)}
                  autoFocus
                  required
                  rows={3}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "var(--radius-sm)",
                    padding: "10px 12px",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                    lineHeight: "1.5",
                    outline: "none",
                    resize: "none",
                  }}
                />
              </div>
            )}

            {/* TOTP Input if 2FA is active */}
            {hasVaultTotp && (
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                  6-Digit Authenticator Code
                </label>
                <input 
                  type="text"
                  maxLength={6}
                  placeholder="000 000"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "var(--radius-sm)",
                    padding: "10px 14px",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.2em",
                    textAlign: "center",
                    outline: "none",
                  }}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="clickable"
              style={{
                marginTop: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "12px 20px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--accent-primary)",
                border: "none",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 16px var(--accent-glow)",
                transition: "all 0.15s ease",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={15} className="spin-animation" />
                  <span>Decrypting...</span>
                </>
              ) : (
                <>
                  <Unlock size={15} />
                  <span>Unlock Vault</span>
                </>
              )}
            </button>
          </form>

          {/* Alternate Unlock & Setup Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "center", paddingTop: "4px" }}>
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
                fontSize: "12px",
                cursor: "pointer",
                textDecoration: "underline",
                padding: "2px",
              }}
            >
              {useRecoveryPhrase 
                ? "Back to Master Password" 
                : "Forgot password? Unlock with Recovery Phrase"}
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}>
              <button
                type="button"
                onClick={() => setIsSetupMode(true)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
              >
                Set up a new vault
              </button>

              <span style={{ color: "var(--border-subtle)" }}>•</span>

              <button
                type="button"
                onClick={handleResetVault}
                title="Clear current vault password configuration"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: "12px",
                  cursor: "pointer",
                  padding: "4px 8px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <RotateCcw size={11} />
                <span>Reset configuration</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── SCENARIO C: Unlocked Vault Gallery ─────────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", padding: "16px 24px 0", gap: "16px" }}>
      
      {/* Balanced 3-Column Glassmorphic Header Toolbar (Complies strictly with modern-web-ui Section 4) */}
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
        {/* Left Column: Security Status Badge & Auto-Lock Countdown */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "10px", minWidth: "140px" }}>
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
        </div>

        {/* Center Column: Centered Display Title & Inline Frosted Capsule Badge */}
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
            {vaultPhotos.length} {vaultPhotos.length === 1 ? "photo" : "photos"}
          </span>
        </div>

        {/* Right Column: Privacy Shield & Lock Now Button */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", minWidth: "140px" }}>
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
        </div>
      </div>

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
            Reveal Vault
          </button>
        </div>
      )}

      {/* Decrypted Vault Gallery */}
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
          }}
        >
          <Loader2 size={24} className="spin-animation" style={{ color: "var(--accent-primary)" }} />
          <span style={{ fontSize: "13px" }}>Decrypting Vault Gallery...</span>
        </div>
      ) : vaultPhotos.length === 0 ? (
        <div 
          style={{
            marginTop: "80px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            textAlign: "center",
            padding: "0 20px",
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
          <p style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px 0" }}>
            Your Private Vault is Empty
          </p>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "420px", lineHeight: "1.5", margin: 0 }}>
            Select any photo or video from your library and press <strong>"L"</strong> or choose <strong>"Move to Vault"</strong> to securely encrypt it on this device.
          </p>
        </div>
      ) : (
        <PhotoGrid 
          photos={vaultPhotos} 
          onPhotoClick={(idx) => onPhotoClick?.(idx, vaultPhotos)} 
        />
      )}
    </div>
  );
};
