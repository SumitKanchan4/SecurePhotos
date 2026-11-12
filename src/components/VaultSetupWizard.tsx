import React, { useState, useRef, useEffect } from "react";
import { 
  KeyRound, 
  Eye, 
  EyeOff, 
  Copy, 
  Check, 
  Sparkles, 
  Lock, 
  ArrowRight, 
  ArrowLeft, 
  ShieldAlert, 
  Loader2, 
  Hash,
  Download,
  FileText,
  RefreshCw,
  CreditCard
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { apiFetch } from "../services/api";
import { downloadGridCardImage, downloadGridCardText, GridCardData } from "../utils/gridCardRenderer";

interface VaultSetupWizardProps {
  onComplete: () => void;
  onSwitchToUnlock?: () => void;
  onCancel?: () => void;
}

/**
 * VaultSetupWizard Component
 *
 * Streamlined 3-step first-time vault configuration:
 * Step 1: Master Password & Hint
 * Step 2: 4-Digit Quick PIN (daily rapid unlock)
 * Step 3: Printed Emergency Card (resets a forgotten password)
 */
export const VaultSetupWizard: React.FC<VaultSetupWizardProps> = ({ 
  onComplete, 
  onSwitchToUnlock, 
  onCancel 
}) => {
  const { showToast, setIsVaultUnlocked, setIsVaultConfigured, checkVaultStatus } = useAppStore();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Password
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Step 2: PIN
  const [pin, setPin] = useState(["", "", "", ""]);
  const [confirmPin, setConfirmPin] = useState(["", "", "", ""]);
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmPinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Step 3: Emergency Grid Card
  const [gridCard, setGridCard] = useState<GridCardData | null>(null);
  const [isLoadingCard, setIsLoadingCard] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [hasConfirmedSeed, setHasConfirmedSeed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchGridCard = async () => {
    setIsLoadingCard(true);
    try {
      const res = await apiFetch("/api/vault/grid-card/generate");
      if (res.ok) {
        const data = await res.json();
        setGridCard(data);
      }
    } catch (err) {
      console.error("Failed to generate grid card:", err);
    } finally {
      setIsLoadingCard(false);
    }
  };

  useEffect(() => {
    fetchGridCard();
  }, []);

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
  const strengthColors = ["#ef4444", "#f97316", "#eab308", "#c6ff00", "#10b981"];

  // Step 1 -> Step 2 validation
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

  // PIN input handlers with auto-advance and backspace support
  const handlePinChange = (
    index: number, 
    value: string, 
    isConfirm: boolean
  ) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const targetState = isConfirm ? [...confirmPin] : [...pin];
    targetState[index] = digit;

    if (isConfirm) {
      setConfirmPin(targetState);
    } else {
      setPin(targetState);
    }

    // Auto-advance to next input if digit entered
    if (digit) {
      const refs = isConfirm ? confirmPinInputRefs : pinInputRefs;
      if (index < 3) {
        refs.current[index + 1]?.focus();
      }
    }
  };

  const handlePinKeyDown = (
    index: number, 
    e: React.KeyboardEvent<HTMLInputElement>, 
    isConfirm: boolean
  ) => {
    const targetState = isConfirm ? confirmPin : pin;
    const refs = isConfirm ? confirmPinInputRefs : pinInputRefs;

    if (e.key === "Backspace") {
      if (!targetState[index] && index > 0) {
        refs.current[index - 1]?.focus();
      }
    }
  };

  // Step 2 -> Step 3 validation
  const handleProceedToStep3 = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    const pinStr = pin.join("");
    const confirmPinStr = confirmPin.join("");

    if (pinStr.length !== 4) {
      setErrorMessage("Please enter a complete 4-digit quick PIN.");
      return;
    }
    if (pinStr !== confirmPinStr) {
      setErrorMessage("PIN confirmation does not match. Please re-enter.");
      return;
    }

    setStep(3);
  };

  const handleDownloadCard = async () => {
    if (!gridCard) return;
    try {
      await downloadGridCardImage(gridCard);
      showToast("Emergency Grid Card downloaded! Keep it in your phone photos or USB drive.", "success");
      setHasConfirmedSeed(true);
    } catch {
      showToast("Failed to download card image.", "warning");
    }
  };

  const handleDownloadText = () => {
    if (!gridCard) return;
    downloadGridCardText(gridCard);
    showToast("Text backup downloaded.", "success");
    setHasConfirmedSeed(true);
  };

  const handleCopyKey = () => {
    if (!gridCard) return;
    navigator.clipboard.writeText(gridCard.card_token);
    setIsCopied(true);
    showToast("Emergency Card Key copied to clipboard.", "success");
    setTimeout(() => setIsCopied(false), 3000);
  };

  // Finalize setup
  const handleFinalizeSetup = async () => {
    if (!hasConfirmedSeed) {
      setErrorMessage("Please confirm that you have saved your Emergency Grid Card.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    const pinStr = pin.join("");

    try {
      const res = await apiFetch("/api/vault/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          pin: pinStr.length === 4 ? pinStr : undefined,
          grid_card: gridCard,
          password_hint: passwordHint.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to initialize vault.");
      }

      // Automatically unlock after successful setup
      const unlockRes = await apiFetch("/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (unlockRes.ok) {
        setIsVaultConfigured(true);
        setIsVaultUnlocked(true);
        await checkVaultStatus();
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

  const stepTitles = [
    "Create Master Password",
    "Set 4-Digit Quick PIN",
    "Save Emergency Grid Card"
  ];

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
            <span style={{ color: "var(--accent-primary)" }}>
              Step {step} of 3
            </span>
            <span>•</span>
            <span>{stepTitles[step - 1]}</span>
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
                  placeholder="Enter master password (minimum 8 characters)..."
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
                          backgroundColor: level <= strengthScore ? strengthColors[strengthScore - 1] || "var(--accent-fill)" : "var(--glass-border)",
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
                placeholder="e.g. Favorite book title or vacation memory"
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
                backgroundColor: "var(--accent-fill)",
                border: "none",
                color: "var(--on-accent)",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 16px var(--accent-glow)",
                transition: "all 0.15s ease",
              }}
            >
              <span>Continue to Quick PIN</span>
              <ArrowRight size={15} />
            </button>

            {onCancel && (
              <div style={{ textAlign: "center", marginTop: "4px" }}>
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

        {/* ── STEP 2: Set 4-Digit Quick PIN ─────────────────────────── */}
        {step === 2 && (
          <form onSubmit={handleProceedToStep3} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ textAlign: "center" }}>
              <div 
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent-ink) 25%, transparent)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-primary)",
                  marginBottom: "12px",
                }}
              >
                <Hash size={22} />
              </div>
              <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px 0" }}>
                Create 4-Digit Quick PIN
              </h3>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0, lineHeight: "1.4" }}>
                Use this PIN for instant daily unlock (&lt;0.5s). After 5 incorrect attempts, your master password will be required.
              </p>
            </div>

            {/* 4-Digit PIN Input */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textAlign: "center" }}>
                Enter 4 Digits
              </label>
              <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
                {[0, 1, 2, 3].map((idx) => (
                  <input
                    key={`pin-${idx}`}
                    ref={(el) => { pinInputRefs.current[idx] = el; }}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    value={pin[idx]}
                    onChange={(e) => handlePinChange(idx, e.target.value, false)}
                    onKeyDown={(e) => handlePinKeyDown(idx, e, false)}
                    autoFocus={idx === 0}
                    style={{
                      width: "48px",
                      height: "52px",
                      borderRadius: "var(--radius-md)",
                      backgroundColor: "var(--bg-surface)",
                      border: `1.5px solid ${pin[idx] ? "var(--accent-primary)" : "var(--glass-border)"}`,
                      color: "var(--text-primary)",
                      fontSize: "22px",
                      fontWeight: 700,
                      textAlign: "center",
                      outline: "none",
                      boxShadow: pin[idx] ? "0 0 12px color-mix(in srgb, var(--accent-ink) 20%, transparent)" : "none",
                      transition: "all 0.15s ease",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Confirm 4-Digit PIN Input */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textAlign: "center" }}>
                Confirm 4 Digits
              </label>
              <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
                {[0, 1, 2, 3].map((idx) => (
                  <input
                    key={`confirm-pin-${idx}`}
                    ref={(el) => { confirmPinInputRefs.current[idx] = el; }}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    value={confirmPin[idx]}
                    onChange={(e) => handlePinChange(idx, e.target.value, true)}
                    onKeyDown={(e) => handlePinKeyDown(idx, e, true)}
                    style={{
                      width: "48px",
                      height: "52px",
                      borderRadius: "var(--radius-md)",
                      backgroundColor: "var(--bg-surface)",
                      border: `1.5px solid ${confirmPin[idx] ? "var(--accent-primary)" : "var(--glass-border)"}`,
                      color: "var(--text-primary)",
                      fontSize: "22px",
                      fontWeight: 700,
                      textAlign: "center",
                      outline: "none",
                      boxShadow: confirmPin[idx] ? "0 0 12px color-mix(in srgb, var(--accent-ink) 20%, transparent)" : "none",
                      transition: "all 0.15s ease",
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="clickable"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
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
                <ArrowLeft size={14} />
                <span>Back</span>
              </button>

              <button
                type="submit"
                className="clickable"
                style={{
                  flex: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "12px 20px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--accent-fill)",
                  border: "none",
                  color: "var(--on-accent)",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 4px 16px var(--accent-glow)",
                  transition: "all 0.15s ease",
                }}
              >
                <span>Continue to Emergency Grid Card</span>
                <ArrowRight size={15} />
              </button>
            </div>
          </form>
        )}

        {/* ── STEP 3: ICICI-Style Emergency Grid Card ──────────────── */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <CreditCard size={16} style={{ color: "var(--accent-primary)" }} />
                <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                  Emergency Grid Card
                </span>
                {gridCard && (
                  <span
                    style={{
                      fontSize: "10px",
                      fontFamily: "var(--font-mono)",
                      color: "#fbbf24",
                      backgroundColor: "rgba(251, 191, 36, 0.12)",
                      padding: "2px 8px",
                      borderRadius: "var(--radius-full)",
                      border: "1px solid rgba(251, 191, 36, 0.25)",
                    }}
                  >
                    {gridCard.card_id}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={fetchGridCard}
                disabled={isLoadingCard}
                title="Generate new random grid card"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "4px 8px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-secondary)",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                <RefreshCw size={11} className={isLoadingCard ? "spin-animation" : ""} />
                <span>Shuffle</span>
              </button>
            </div>

            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0, lineHeight: "1.4" }}>
              Save this emergency card to your phone photos or USB drive. If you ever forget your master password, you can reset it instantly by uploading this image or typing 3 requested box numbers + your PIN.
            </p>

            {/* Virtual Metallic Grid Card Preview */}
            {gridCard ? (
              <div
                style={{
                  backgroundColor: "#0b0f19",
                  borderRadius: "16px",
                  border: "1.5px solid rgba(56, 189, 248, 0.35)",
                  padding: "14px",
                  boxShadow: "0 12px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                {/* Card Top Brand Strip */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div
                      style={{
                        width: "24px",
                        height: "18px",
                        borderRadius: "3px",
                        background: "linear-gradient(135deg, #fbbf24, #b45309)",
                        border: "1px solid rgba(0,0,0,0.3)",
                      }}
                    />
                    <span style={{ fontSize: "11px", fontWeight: 800, color: "#38bdf8", letterSpacing: "0.05em" }}>
                      SECUREPHOTOS
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "#facc15", fontWeight: 700 }}>
                    {gridCard.card_id}
                  </span>
                </div>

                {/* 4x4 Grid Matrix */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: "6px",
                  }}
                >
                  {["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"].map((letter) => (
                    <div
                      key={letter}
                      style={{
                        backgroundColor: "rgba(15, 23, 42, 0.8)",
                        borderRadius: "8px",
                        border: "1px solid rgba(56, 189, 248, 0.22)",
                        padding: "6px 8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ fontSize: "11px", fontWeight: 800, color: "#38bdf8" }}>{letter}</span>
                      <span style={{ fontSize: "14px", fontWeight: 700, fontFamily: "var(--font-mono)", color: "#f8fafc" }}>
                        {gridCard.cells[letter]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "140px" }}>
                <Loader2 size={24} className="spin-animation" style={{ color: "var(--accent-primary)" }} />
              </div>
            )}

            {/* Action Buttons: Download Card Image, Text Backup, Copy Key */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleDownloadCard}
                className="clickable"
                style={{
                  flex: "1 1 auto",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(56, 189, 248, 0.15)",
                  border: "1px solid rgba(56, 189, 248, 0.4)",
                  color: "#38bdf8",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <Download size={13} />
                <span>Save Card Image (.png)</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadText}
                className="clickable"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-secondary)",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <FileText size={12} />
                <span>Text Backup</span>
              </button>

              <button
                type="button"
                onClick={handleCopyKey}
                className="clickable"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "8px 12px",
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
                <span>{isCopied ? "Copied" : "Copy Key"}</span>
              </button>
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
                marginTop: "2px",
              }}
            >
              <input 
                type="checkbox"
                checked={hasConfirmedSeed}
                onChange={(e) => setHasConfirmedSeed(e.target.checked)}
                style={{ marginTop: "2px", accentColor: "var(--accent-primary)" }}
              />
              <span>I have downloaded or saved my Emergency Grid Card (keep it in phone photos or USB).</span>
            </label>

            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="clickable"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
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
                <ArrowLeft size={14} />
                <span>Back</span>
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
                  backgroundColor: hasConfirmedSeed ? "var(--accent-fill)" : "var(--glass-border)",
                  border: "none",
                  color: "var(--on-accent)",
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
