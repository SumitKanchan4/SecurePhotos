import React, { useState } from "react";
import { 
  KeyRound, 
  Eye, 
  EyeOff, 
  Copy, 
  Check, 
  Sparkles, 
  Lock, 
  ArrowRight, 
  ShieldAlert, 
  Loader2 
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";

interface VaultSetupWizardProps {
  onComplete: () => void;
  onSwitchToUnlock?: () => void;
  onCancel?: () => void;
}

// 24 standard BIP-39 mnemonic seed words for cryptographic recovery
const SAMPLE_RECOVERY_WORDS = [
  "timber", "ocean", "canyon", "desert", "mountain", "river",
  "breeze", "stone", "valley", "thunder", "shadow", "apple",
  "harbor", "meadow", "beacon", "summit", "forest", "glacier",
  "aurora", "island", "pebble", "willow", "zenith", "crystal"
];

/**
 * VaultSetupWizard Component
 *
 * Clean, focused first-time configuration wizard.
 * Matches the application's native sapphire blue and deep obsidian palette.
 */
export const VaultSetupWizard: React.FC<VaultSetupWizardProps> = ({ onComplete, onSwitchToUnlock, onCancel }) => {
  const showToast = useAppStore((state) => state.showToast);
  const setIsVaultUnlocked = useAppStore((state) => state.setIsVaultUnlocked);
  const setIsVaultConfigured = useAppStore((state) => state.setIsVaultConfigured);

  const [step, setStep] = useState<1 | 2>(1);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [hasConfirmedSeed, setHasConfirmedSeed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const recoveryPhrase = SAMPLE_RECOVERY_WORDS.join(" ");

  // Password strength calculation
  const getPasswordStrength = () => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  };

  const strengthScore = getPasswordStrength();
  const strengthLabels = ["Too short", "Weak", "Fair", "Strong", "Very Strong"];
  const strengthColors = ["#ef4444", "#f97316", "#eab308", "#3b82f6", "#10b981"];

  const handleCopyPhrase = () => {
    navigator.clipboard.writeText(recoveryPhrase);
    setIsCopied(true);
    showToast("Recovery phrase copied to clipboard. Save it securely!", "success");
    setTimeout(() => setIsCopied(false), 3000);
  };

  const handleProceedToStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (password.length < 8) {
      setErrorMessage("Master password must be at least 8 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match. Please re-enter.");
      return;
    }

    setStep(2);
  };

  const handleFinalizeSetup = async () => {
    if (!hasConfirmedSeed) {
      setErrorMessage("Please confirm that you have saved your 24-word recovery phrase.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const res = await fetch("http://127.0.0.1:8000/api/vault/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          recovery_phrase: recoveryPhrase,
          password_hint: passwordHint.trim() || undefined,
          enable_totp: false,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to initialize vault.");
      }

      // Automatically unlock after successful setup
      const unlockRes = await fetch("http://127.0.0.1:8000/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (unlockRes.ok) {
        setIsVaultConfigured(true);
        setIsVaultUnlocked(true);
        showToast("Private Vault configured and unlocked successfully!", "success");
        onComplete();
      }
    } catch (err: unknown) {
      console.error("Vault setup error:", err);
      setErrorMessage(err instanceof Error ? err.message : "Error setting up vault");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        overflowY: "auto",
      }}
    >
      {/* Setup Form Card */}
      <div 
        className="liquid-glass-toolbar"
        style={{
          width: "100%",
          maxWidth: "520px",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--glass-border)",
          boxShadow: "var(--glass-shadow)",
          padding: "32px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        {/* Stepper Progress Pill */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div 
            style={{ 
              display: "inline-flex", 
              alignItems: "center", 
              gap: "8px", 
              padding: "4px 12px", 
              borderRadius: "var(--radius-full)", 
              backgroundColor: "var(--glass-pill-bg)", 
              border: "1px solid var(--glass-border)",
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--text-secondary)",
            }}
          >
            <span style={{ color: step === 1 ? "var(--accent-primary)" : "var(--accent-success)" }}>
              Step {step} of 2
            </span>
            <span>•</span>
            <span>{step === 1 ? "Create Master Password" : "Save Recovery Phrase"}</span>
          </div>

          {onSwitchToUnlock && (
            <button
              type="button"
              onClick={onSwitchToUnlock}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent-primary)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              Already set up? Unlock
            </button>
          )}
        </div>

        {errorMessage && (
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
            <span>{errorMessage}</span>
          </div>
        )}

        {/* ── STEP 1: Set Master Password ─────────────────────────── */}
        {step === 1 && (
          <form onSubmit={handleProceedToStep2} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                Create Master Password
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
                  placeholder="Enter a strong master password (min 8 characters)..."
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

              {/* Password Strength Meter */}
              {password && (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ display: "flex", height: "4px", gap: "4px", borderRadius: "2px", overflow: "hidden" }}>
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div 
                        key={level}
                        style={{
                          flex: 1,
                          backgroundColor: level <= strengthScore ? strengthColors[strengthScore - 1] || "var(--accent-primary)" : "var(--glass-border)",
                          transition: "background-color 0.2s ease",
                        }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: "11px", color: strengthColors[strengthScore - 1] || "var(--text-muted)", marginTop: "4px", display: "block" }}>
                    Strength: {strengthLabels[Math.max(0, strengthScore - 1)] || "Too short"}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                Confirm Master Password
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
                <KeyRound size={15} style={{ color: "var(--text-muted)", marginRight: "8px" }} />
                <input 
                  type={showPassword ? "text" : "password"}
                  placeholder="Repeat your password..."
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
              </div>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
                  Password Hint (Optional)
                </label>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Visible on lock screen</span>
              </div>
              <input 
                type="text"
                placeholder="e.g. Memory of first concert or favorite vacation"
                value={passwordHint}
                onChange={(e) => setPasswordHint(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "10px 14px",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
            </div>

            <button
              type="submit"
              className="clickable"
              style={{
                marginTop: "8px",
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
              }}
            >
              <span>Continue to Recovery Phrase</span>
              <ArrowRight size={15} />
            </button>

            {onSwitchToUnlock && (
              <div style={{ textAlign: "center", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={onSwitchToUnlock}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Already configured? Switch to Unlock
                </button>
              </div>
            )}

            {onCancel && (
              <div style={{ textAlign: "center", marginTop: "6px" }}>
                <button
                  type="button"
                  onClick={onCancel}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Cancel and go back
                </button>
              </div>
            )}
          </form>
        )}

        {/* ── STEP 2: 24-Word Recovery Phrase ─────────────────────── */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>
                Emergency 24-Word Recovery Phrase
              </span>
              <button
                type="button"
                onClick={handleCopyPhrase}
                className="clickable"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 12px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: isCopied ? "var(--accent-success)" : "var(--text-secondary)",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
                <span>{isCopied ? "Copied!" : "Copy Words"}</span>
              </button>
            </div>

            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0, lineHeight: "1.4" }}>
              Write these words down or save them in a safe place. If you ever forget your master password, this phrase is the only way to recover your vault photos.
            </p>

            {/* Recovery Words Grid */}
            <div 
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "6px",
                padding: "12px",
                backgroundColor: "var(--bg-surface)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--glass-border)",
              }}
            >
              {SAMPLE_RECOVERY_WORDS.map((word, idx) => (
                <div 
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "5px 8px",
                    backgroundColor: "var(--glass-pill-bg)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-primary)",
                  }}
                >
                  <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>{idx + 1}.</span>
                  <span style={{ fontWeight: 600 }}>{word}</span>
                </div>
              ))}
            </div>

            {/* Confirmation Checkbox */}
            <label 
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                fontSize: "12px",
                color: "var(--text-secondary)",
                cursor: "pointer",
                marginTop: "4px",
              }}
            >
              <input 
                type="checkbox"
                checked={hasConfirmedSeed}
                onChange={(e) => setHasConfirmedSeed(e.target.checked)}
                style={{ marginTop: "2px", accentColor: "var(--accent-primary)" }}
              />
              <span>I have safely written down or copied these 24 recovery words.</span>
            </label>

            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="clickable"
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-secondary)",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Back
              </button>

              <button
                type="button"
                onClick={handleFinalizeSetup}
                disabled={!hasConfirmedSeed || isSubmitting}
                className="clickable"
                style={{
                  flex: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "12px 20px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: hasConfirmedSeed ? "var(--accent-primary)" : "var(--glass-border)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: hasConfirmedSeed ? "pointer" : "not-allowed",
                  boxShadow: hasConfirmedSeed ? "0 4px 16px var(--accent-glow)" : "none",
                  opacity: isSubmitting ? 0.7 : 1,
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={15} className="spin-animation" />
                    <span>Encrypting Vault...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    <span>Initialize Private Vault</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
