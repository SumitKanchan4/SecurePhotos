import React, { useState, useEffect, useRef } from "react";
import { 
  KeyRound, 
  Eye, 
  EyeOff, 
  Check, 
  AlertCircle, 
  Loader2, 
  CreditCard, 
  Upload, 
  ArrowLeft, 
  X,
  FileCheck
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { extractGridCardFromPng } from "../utils/gridCardRenderer";
import { apiFetch } from "../services/api";

/** How the user proves they own the vault before choosing a new password. */
type ResetTab = "upload" | "numbers" | "current";

const CARD_LETTERS = "ABCDEFGHIJKLMNOP".split("");
const emptyCardNumbers = (): Record<string, string> =>
  Object.fromEntries(CARD_LETTERS.map((l) => [l, ""]));

interface VaultPasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: ResetTab;
}

export const VaultPasswordResetModal: React.FC<VaultPasswordResetModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = "upload",
}) => {
  const { showToast } = useAppStore();

  const [activeTab, setActiveTab] = useState<ResetTab>(initialMode);
  const [stage, setStage] = useState<"verify" | "new-password">("verify");

  // Verification state
  const [cardToken, setCardToken] = useState("");
  const [verifiedCardId, setVerifiedCardId] = useState<string | null>(null);
  const [cardNumbers, setCardNumbers] = useState<Record<string, string>>(emptyCardNumbers);
  const cardInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");

  // New Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordHint, setNewPasswordHint] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Start each opening on the requested tab.
  useEffect(() => {
    if (isOpen) setActiveTab(initialMode);
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  // Handle Drag & Drop / File Select for Grid Card Image
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processCardFile(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processCardFile(file);
  };

  const processCardFile = async (file: File) => {
    setErrorMessage("");
    try {
      const card = await extractGridCardFromPng(file);
      if (card && card.card_token) {
        setCardToken(card.card_token);
        setVerifiedCardId(card.card_id);
        showToast(`Card ${card.card_id} verified successfully!`, "success");
        setStage("new-password");
      } else {
        setErrorMessage("No recovery key found inside this image. Please upload the original SecurePhotos_Emergency_Grid_Card.png or enter your Card Key.");
      }
    } catch {
      setErrorMessage("Could not read image file.");
    }
  };

  // Card number inputs: two digits each, jump to the next box when full.
  const handleCardNumberChange = (index: number, val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 2);
    setCardNumbers((prev) => ({ ...prev, [CARD_LETTERS[index]]: digits }));
    if (digits.length === 2 && index < CARD_LETTERS.length - 1) {
      cardInputRefs.current[index + 1]?.focus();
    }
  };
  const allCardNumbersFilled = CARD_LETTERS.every((l) => /^\d{2}$/.test(cardNumbers[l]));

  // Proceed from verification to new password
  const handleProceedFromVerification = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (activeTab === "upload") {
      if (!cardToken.trim()) {
        setErrorMessage("Please select your Emergency Grid Card image or paste your Card Key.");
        return;
      }
      setStage("new-password");
    } else if (activeTab === "numbers") {
      if (!allCardNumbersFilled) {
        setErrorMessage("Please enter all 16 two-digit numbers from your Emergency Card.");
        return;
      }
      setStage("new-password");
    } else if (activeTab === "current") {
      if (!currentPassword) {
        setErrorMessage("Please enter your current master password.");
        return;
      }
      setStage("new-password");
    }
  };

  // Password Strength Score
  const getStrengthScore = () => {
    if (!newPassword) return 0;
    let score = 0;
    if (newPassword.length >= 8) score++;
    if (newPassword.length >= 12) score++;
    if (/[A-Z]/.test(newPassword)) score++;
    if (/[0-9]/.test(newPassword)) score++;
    if (/[^A-Za-z0-9]/.test(newPassword)) score++;
    return score;
  };

  const strengthScore = getStrengthScore();
  const strengthLabels = ["Too short", "Weak", "Fair", "Strong", "Very Strong"];
  const strengthColors = ["#ef4444", "#f97316", "#eab308", "#3b82f6", "#10b981"];

  // Final Submit to Backend
  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (newPassword.length < 8) {
      setErrorMessage("New master password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match. Please re-enter.");
      return;
    }

    setIsSubmitting(true);
    const payload: Record<string, any> = {
      new_password: newPassword,
      new_password_hint: newPasswordHint.trim() || undefined,
    };

    if (activeTab === "upload") {
      payload.card_token = cardToken.trim();
    } else if (activeTab === "numbers") {
      payload.card_cells = cardNumbers;
    } else if (activeTab === "current") {
      payload.current_password = currentPassword;
    }

    try {
      const res = await apiFetch("/api/vault/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to reset master password.");
      }

      showToast("Master Password reset successfully!", "success");
      onSuccess();
      onClose();
    } catch (err: unknown) {
      console.error("Password reset error:", err);
      setErrorMessage(err instanceof Error ? err.message : "Error resetting password");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.72)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px",
      }}
    >
      <div
        className="liquid-glass-toolbar"
        style={{
          width: "100%",
          maxWidth: "480px",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--glass-border)",
          boxShadow: "0 24px 50px rgba(0, 0, 0, 0.6)",
          padding: "28px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        {/* Header Strip */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "rgba(56, 189, 248, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#38bdf8",
              }}
            >
              <KeyRound size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>
                {stage === "verify" ? "Reset Master Password" : "Set New Master Password"}
              </h3>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>
                {stage === "verify" 
                  ? "Use your Emergency Card or your current password" 
                  : "Choose a new strong password for your Private Vault"}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="clickable"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 14px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#ef4444",
              fontSize: "12px",
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* STAGE 1: VERIFICATION */}
        {stage === "verify" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Tab Navigation Pill */}
            <div
              style={{
                display: "flex",
                backgroundColor: "var(--bg-surface)",
                padding: "3px",
                borderRadius: "var(--radius-full)",
                border: "1px solid var(--glass-border)",
                gap: "2px",
              }}
            >
              <button
                type="button"
                onClick={() => { setActiveTab("upload"); setErrorMessage(""); }}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: "var(--radius-full)",
                  border: "none",
                  backgroundColor: activeTab === "upload" ? "var(--glass-pill-bg)" : "transparent",
                  color: activeTab === "upload" ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: "11px",
                  fontWeight: activeTab === "upload" ? 700 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <Upload size={12} />
                <span>Card file</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("numbers"); setErrorMessage(""); }}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: "var(--radius-full)",
                  border: "none",
                  backgroundColor: activeTab === "numbers" ? "var(--glass-pill-bg)" : "transparent",
                  color: activeTab === "numbers" ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: "11px",
                  fontWeight: activeTab === "numbers" ? 700 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <CreditCard size={12} />
                <span>Card numbers</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("current"); setErrorMessage(""); }}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: "var(--radius-full)",
                  border: "none",
                  backgroundColor: activeTab === "current" ? "var(--glass-pill-bg)" : "transparent",
                  color: activeTab === "current" ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: "11px",
                  fontWeight: activeTab === "current" ? 700 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <KeyRound size={12} />
                <span>Current password</span>
              </button>
            </div>

            {/* TAB 1: UPLOAD CARD IMAGE */}
            {activeTab === "upload" && (
              <form onSubmit={handleProceedFromVerification} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: "2px dashed rgba(56, 189, 248, 0.4)",
                    borderRadius: "var(--radius-md)",
                    padding: "24px 16px",
                    backgroundColor: "rgba(56, 189, 248, 0.04)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/*"
                    style={{ display: "none" }}
                    onChange={handleFileChange}
                  />
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "50%",
                      backgroundColor: "rgba(56, 189, 248, 0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#38bdf8",
                    }}
                  >
                    <Upload size={18} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ margin: "0 0 2px 0", fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                      Drop your Emergency Grid Card image here
                    </p>
                    <p style={{ margin: 0, fontSize: "11px", color: "var(--text-muted)" }}>
                      or click to browse from computer / USB drive
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--glass-border)" }} />
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>or enter Card Key manually</span>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--glass-border)" }} />
                </div>

                <div>
                  <input
                    type="text"
                    placeholder="Enter 64-character card token or 24 words..."
                    value={cardToken}
                    onChange={(e) => setCardToken(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-border)",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      fontFamily: "var(--font-mono)",
                      outline: "none",
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={!cardToken.trim()}
                  className="clickable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "10px 18px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-primary)",
                    border: "none",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: cardToken.trim() ? "pointer" : "default",
                    opacity: cardToken.trim() ? 1 : 0.6,
                    boxShadow: "0 4px 14px var(--accent-glow)",
                  }}
                >
                  <span>Continue to New Password</span>
                </button>
              </form>
            )}

            {/* TAB 2: ALL 16 NUMBERS FROM THE PRINTED CARD */}
            {activeTab === "numbers" && (
              <form onSubmit={handleProceedFromVerification} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                  Type all 16 numbers from your printed Emergency Card, box by box.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                  {CARD_LETTERS.map((letter, idx) => (
                    <label
                      key={letter}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 8px",
                        borderRadius: "var(--radius-md)",
                        backgroundColor: "var(--glass-pill-bg)",
                        border: "1px solid var(--glass-border)",
                      }}
                    >
                      <span style={{ fontSize: "12px", fontWeight: 800, color: "var(--accent-primary)", width: "12px" }}>{letter}</span>
                      <input
                        ref={(el) => { cardInputRefs.current[idx] = el; }}
                        aria-label={`Card box ${letter}`}
                        inputMode="numeric"
                        maxLength={2}
                        placeholder="00"
                        autoFocus={idx === 0}
                        value={cardNumbers[letter]}
                        onChange={(e) => handleCardNumberChange(idx, e.target.value)}
                        style={{
                          width: "100%",
                          minWidth: 0,
                          textAlign: "center",
                          fontSize: "16px",
                          fontWeight: 700,
                          fontFamily: "var(--font-mono)",
                          background: "transparent",
                          border: "none",
                          color: "var(--text-primary)",
                          outline: "none",
                        }}
                      />
                    </label>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={!allCardNumbersFilled}
                  className="clickable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "10px 18px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-primary)",
                    border: "none",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: allCardNumbersFilled ? "pointer" : "default",
                    opacity: allCardNumbersFilled ? 1 : 0.6,
                    boxShadow: "0 4px 14px var(--accent-glow)",
                  }}
                >
                  <span>Continue to New Password</span>
                </button>
              </form>
            )}

            {/* TAB 3: CURRENT PASSWORD (changing it from Settings) */}
            {activeTab === "current" && (
              <form onSubmit={handleProceedFromVerification} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                  Enter your current master password to choose a new one.
                </p>
                <input
                  type="password"
                  aria-label="Current master password"
                  placeholder="Current master password"
                  autoFocus
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                <button
                  type="submit"
                  disabled={!!!currentPassword}
                  className="clickable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "10px 18px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-primary)",
                    border: "none",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: !!currentPassword ? "pointer" : "default",
                    opacity: !!currentPassword ? 1 : 0.6,
                    boxShadow: "0 4px 14px var(--accent-glow)",
                  }}
                >
                  <span>Continue to New Password</span>
                </button>
              </form>
            )}
          </div>
        )}

        {/* STAGE 2: SET NEW MASTER PASSWORD */}
        {stage === "new-password" && (
          <form onSubmit={handleFinalSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {verifiedCardId && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  color: "#10b981",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                <FileCheck size={14} />
                <span>Verified with Card {verifiedCardId}</span>
              </div>
            )}

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px", display: "block" }}>
                New Master Password:
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters..."
                  autoFocus
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 38px 10px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Strength Meter */}
              {newPassword && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                  <div style={{ display: "flex", gap: "4px", flex: 1 }}>
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        style={{
                          height: "4px",
                          flex: 1,
                          borderRadius: "2px",
                          backgroundColor: level <= strengthScore ? strengthColors[strengthScore - 1] : "rgba(255,255,255,0.1)",
                        }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: "10px", fontWeight: 600, color: strengthColors[strengthScore - 1] || "var(--text-muted)" }}>
                    {strengthLabels[strengthScore - 1] || "Too short"}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px", display: "block" }}>
                Confirm New Password:
              </label>
              <input
                type={showNewPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password..."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px", display: "block" }}>
                Password Hint (Optional):
              </label>
              <input
                type="text"
                value={newPasswordHint}
                onChange={(e) => setNewPasswordHint(e.target.value)}
                placeholder="A reminder only you understand..."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
              <button
                type="button"
                onClick={() => setStage("verify")}
                className="clickable"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  padding: "10px",
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
                disabled={isSubmitting || newPassword.length < 8 || newPassword !== confirmPassword}
                className="clickable"
                style={{
                  flex: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  padding: "10px 18px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--accent-primary)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: isSubmitting || newPassword.length < 8 || newPassword !== confirmPassword ? "default" : "pointer",
                  opacity: isSubmitting || newPassword.length < 8 || newPassword !== confirmPassword ? 0.6 : 1,
                  boxShadow: "0 4px 14px var(--accent-glow)",
                }}
              >
                {isSubmitting ? (
                  <Loader2 size={14} className="spin-animation" />
                ) : (
                  <Check size={14} />
                )}
                <span>{isSubmitting ? "Resetting..." : "Save New Password"}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
