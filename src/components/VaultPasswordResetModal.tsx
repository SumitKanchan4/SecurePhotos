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
  Hash, 
  ArrowLeft, 
  X,
  FileCheck
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { extractGridCardFromPng } from "../utils/gridCardRenderer";
import { VaultRecoveryChallenge } from "../types";
import { apiFetch } from "../services/api";

interface VaultPasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: "upload" | "challenge" | "pin";
}

export const VaultPasswordResetModal: React.FC<VaultPasswordResetModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = "upload",
}) => {
  const { showToast } = useAppStore();

  const [activeTab, setActiveTab] = useState<"upload" | "challenge" | "pin">(initialMode);
  const [stage, setStage] = useState<"verify" | "new-password">("verify");

  // Verification state
  const [cardToken, setCardToken] = useState("");
  const [verifiedCardId, setVerifiedCardId] = useState<string | null>(null);
  const [challengeData, setChallengeData] = useState<VaultRecoveryChallenge | null>(null);
  const [isLoadingChallenge, setIsLoadingChallenge] = useState(false);
  const [challengeInputs, setChallengeInputs] = useState<Record<string, string>>({});
  const [pin, setPin] = useState(["", "", "", ""]);
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // New Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordHint, setNewPasswordHint] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch ICICI Challenge on open or tab switch
  useEffect(() => {
    if (isOpen && activeTab === "challenge") {
      fetchChallenge();
    }
  }, [isOpen, activeTab]);

  const fetchChallenge = async () => {
    setIsLoadingChallenge(true);
    setErrorMessage("");
    try {
      const res = await apiFetch("/api/vault/recovery/challenge");
      if (res.ok) {
        const data = await res.json();
        setChallengeData(data);
        const initialInputs: Record<string, string> = {};
        data.required_cells.forEach((letter: string) => {
          initialInputs[letter] = "";
        });
        setChallengeInputs(initialInputs);
      }
    } catch {
      setErrorMessage("Could not load grid card challenge.");
    } finally {
      setIsLoadingChallenge(false);
    }
  };

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

  // PIN Input handlers
  const handlePinChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const newPin = [...pin];
    newPin[index] = digit;
    setPin(newPin);
    if (digit && index < 3) {
      pinInputRefs.current[index + 1]?.focus();
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus();
    }
  };

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
    } else if (activeTab === "challenge") {
      const pinStr = pin.join("");
      if (pinStr.length !== 4) {
        setErrorMessage("Please enter your complete 4-digit PIN.");
        return;
      }
      const missingCell = Object.values(challengeInputs).some((v) => !v.trim());
      if (missingCell) {
        setErrorMessage("Please enter all 3 requested box numbers.");
        return;
      }
      setStage("new-password");
    } else if (activeTab === "pin") {
      const pinStr = pin.join("");
      if (pinStr.length !== 4) {
        setErrorMessage("Please enter your 4-digit PIN.");
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
    const pinStr = pin.join("");

    const payload: Record<string, any> = {
      new_password: newPassword,
      new_password_hint: newPasswordHint.trim() || undefined,
    };

    if (activeTab === "upload") {
      payload.card_token = cardToken.trim();
    } else if (activeTab === "challenge") {
      payload.challenge_cells = challengeInputs;
      payload.pin = pinStr;
    } else if (activeTab === "pin") {
      payload.pin = pinStr;
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
                  ? "Verify identity with your Emergency Grid Card or PIN" 
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
                <span>Upload Card</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("challenge"); setErrorMessage(""); }}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: "var(--radius-full)",
                  border: "none",
                  backgroundColor: activeTab === "challenge" ? "var(--glass-pill-bg)" : "transparent",
                  color: activeTab === "challenge" ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: "11px",
                  fontWeight: activeTab === "challenge" ? 700 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <CreditCard size={12} />
                <span>Box Challenge</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("pin"); setErrorMessage(""); }}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: "var(--radius-full)",
                  border: "none",
                  backgroundColor: activeTab === "pin" ? "var(--glass-pill-bg)" : "transparent",
                  color: activeTab === "pin" ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: "11px",
                  fontWeight: activeTab === "pin" ? 700 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                <Hash size={12} />
                <span>Quick PIN</span>
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

            {/* TAB 2: ICICI BOX CHALLENGE */}
            {activeTab === "challenge" && (
              <form onSubmit={handleProceedFromVerification} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {isLoadingChallenge ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "120px" }}>
                    <Loader2 size={24} className="spin-animation" style={{ color: "var(--accent-primary)" }} />
                  </div>
                ) : challengeData ? (
                  <>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                      Check your Emergency Grid Card {challengeData.card_id && `(Card ID: ${challengeData.card_id})`} on your phone or in your wallet, and enter the numbers for these 3 boxes:
                    </p>

                    {/* 3 Box Inputs */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                      {challengeData.required_cells.map((letter) => (
                        <div
                          key={letter}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            backgroundColor: "rgba(15, 23, 42, 0.7)",
                            padding: "10px",
                            borderRadius: "var(--radius-md)",
                            border: "1px solid rgba(56, 189, 248, 0.3)",
                            alignItems: "center",
                          }}
                        >
                          <span style={{ fontSize: "12px", fontWeight: 800, color: "#38bdf8" }}>
                            Box [{letter}]
                          </span>
                          <input
                            type="text"
                            maxLength={2}
                            placeholder="00"
                            value={challengeInputs[letter] || ""}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                              setChallengeInputs({ ...challengeInputs, [letter]: val });
                            }}
                            style={{
                              width: "60px",
                              textAlign: "center",
                              fontSize: "20px",
                              fontWeight: 800,
                              fontFamily: "var(--font-mono)",
                              backgroundColor: "var(--glass-pill-bg)",
                              border: "1px solid var(--glass-border)",
                              borderRadius: "var(--radius-sm)",
                              color: "#f8fafc",
                              padding: "4px",
                              outline: "none",
                            }}
                          />
                        </div>
                      ))}
                    </div>

                    {/* 4-Digit PIN */}
                    <div>
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                        Enter your 4-Digit Quick PIN:
                      </label>
                      <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                        {[0, 1, 2, 3].map((idx) => (
                          <input
                            key={idx}
                            ref={(el) => { pinInputRefs.current[idx] = el; }}
                            type="password"
                            maxLength={1}
                            value={pin[idx]}
                            onChange={(e) => handlePinChange(idx, e.target.value)}
                            onKeyDown={(e) => handlePinKeyDown(idx, e)}
                            style={{
                              width: "44px",
                              height: "44px",
                              textAlign: "center",
                              fontSize: "20px",
                              fontWeight: 700,
                              fontFamily: "var(--font-mono)",
                              borderRadius: "var(--radius-md)",
                              backgroundColor: "var(--glass-pill-bg)",
                              border: "1px solid var(--glass-border)",
                              color: "var(--text-primary)",
                              outline: "none",
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    <button
                      type="submit"
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
                        cursor: "pointer",
                        boxShadow: "0 4px 14px var(--accent-glow)",
                      }}
                    >
                      <span>Verify & Continue</span>
                    </button>
                  </>
                ) : null}
              </form>
            )}

            {/* TAB 3: 4-DIGIT PIN */}
            {activeTab === "pin" && (
              <form onSubmit={handleProceedFromVerification} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                  If you remember your daily 4-digit PIN, you can reset your Master Password directly without needing your Grid Card:
                </p>

                <div style={{ display: "flex", gap: "8px", justifyContent: "center", margin: "10px 0" }}>
                  {[0, 1, 2, 3].map((idx) => (
                    <input
                      key={idx}
                      ref={(el) => { pinInputRefs.current[idx] = el; }}
                      type="password"
                      maxLength={1}
                      value={pin[idx]}
                      onChange={(e) => handlePinChange(idx, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(idx, e)}
                      autoFocus={idx === 0}
                      style={{
                        width: "48px",
                        height: "48px",
                        textAlign: "center",
                        fontSize: "22px",
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                        borderRadius: "var(--radius-md)",
                        backgroundColor: "var(--glass-pill-bg)",
                        border: "1px solid var(--glass-border)",
                        color: "var(--text-primary)",
                        outline: "none",
                      }}
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={pin.join("").length !== 4}
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
                    cursor: pin.join("").length === 4 ? "pointer" : "default",
                    opacity: pin.join("").length === 4 ? 1 : 0.6,
                    boxShadow: "0 4px 14px var(--accent-glow)",
                  }}
                >
                  <span>Authorize & Continue</span>
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
