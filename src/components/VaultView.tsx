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
 * Flagship Zero-Trust Encrypted Vault with intuitive liquid-glass login screen,
 * first-time setup wizard, 30s auto-lock countdown, and decrypted in-memory photo grid.
 */
export const VaultView: React.FC<VaultViewProps> = ({ onPhotoClick }) => {
  const { 
    isVaultUnlocked, 
    setIsVaultUnlocked,
    isVaultConfigured,
    vaultPasswordHint,
    hasVaultTotp,
    checkVaultStatus,
    showToast 
  } = useAppStore();

  const [isPrivacyShieldActive, setIsPrivacyShieldActive] = useState(false);
  const [vaultPhotos, setVaultPhotos] = useState<PhotoItem[]>([]);
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);

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

  // ── SCENARIO A: First-Time Setup Wizard ─────────────────────────────
  if (!isVaultConfigured) {
    return (
      <VaultSetupWizard 
        onComplete={() => {
          checkVaultStatus();
          fetchVaultPhotos();
        }} 
      />
    );
  }

  // ── SCENARIO B: Intuitive Liquid-Glass Login Gate ──────────────────
  if (!isVaultUnlocked) {
    return (
      <div 
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 24px",
          overflowY: "auto",
        }}
      >
        <div 
          className="liquid-glass-toolbar"
          style={{
            width: "100%",
            maxWidth: "440px",
            backgroundColor: "var(--glass-surface)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--glass-border)",
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.35), 0 0 30px var(--accent-vault-glow)",
            padding: "36px 32px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            position: "relative",
          }}
        >
          {/* Header Icon & Title */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "10px" }}>
            <div 
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "rgba(139, 92, 246, 0.15)",
                border: "1px solid var(--accent-vault-glow)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-vault)",
                boxShadow: "0 0 20px var(--accent-vault-glow)",
                marginBottom: "4px",
              }}
            >
              <Lock size={30} />
            </div>

            <h2
              style={{
                fontFamily: "Plus Jakarta Sans, sans-serif",
                fontSize: "22px",
                fontWeight: 800,
                letterSpacing: "-0.03em",
                color: "var(--text-primary)",
                margin: 0,
              }}
            >
              Private Vault Locked
            </h2>

            <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0, lineHeight: "1.5" }}>
              Enter your master password to unlock your protected gallery.
            </p>
          </div>

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
                          color: "var(--accent-vault)",
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
                          backgroundColor: "rgba(139, 92, 246, 0.1)",
                          border: "1px solid rgba(139, 92, 246, 0.25)",
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
                marginTop: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "12px 20px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--accent-vault)",
                border: "none",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 16px var(--accent-vault-glow)",
                transition: "all 0.15s ease",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={15} className="spin-animation" />
                  <span>Unlocking...</span>
                </>
              ) : (
                <>
                  <Unlock size={15} />
                  <span>Unlock Vault</span>
                </>
              )}
            </button>
          </form>

          {/* Alternate Unlock Switcher */}
          <div style={{ textAlign: "center", paddingTop: "4px" }}>
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
                padding: "4px",
              }}
            >
              {useRecoveryPhrase 
                ? "Back to Master Password" 
                : "Forgot password? Unlock with Recovery Phrase"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── SCENARIO C: Unlocked Vault Gallery ─────────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", padding: "16px 24px 0", gap: "16px" }}>
      
      {/* Balanced 3-Column Glassmorphic Header Toolbar (Complies with modern-web-ui Section 4) */}
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
              backgroundColor: "rgba(139, 92, 246, 0.15)",
              border: "1px solid rgba(139, 92, 246, 0.35)",
              color: "var(--accent-vault)",
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
            <Lock size={18} style={{ color: "var(--accent-vault)" }} />
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
              backgroundColor: isPrivacyShieldActive ? "var(--accent-vault)" : "var(--glass-pill-bg)",
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
          <Lock size={48} style={{ color: "var(--accent-vault)", marginBottom: "16px" }} />
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
              backgroundColor: "var(--accent-vault)",
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
          <Loader2 size={24} className="spin-animation" style={{ color: "var(--accent-vault)" }} />
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
              backgroundColor: "rgba(139, 92, 246, 0.1)",
              border: "1px solid var(--accent-vault-glow)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent-vault)",
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
