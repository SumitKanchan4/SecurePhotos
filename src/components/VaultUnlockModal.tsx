import React, { useState, useEffect, useRef } from "react";
import { 
  Lock, 
  KeyRound, 
  ShieldAlert, 
  X, 
  Eye, 
  EyeOff, 
  Loader2,
  Sparkles,
  Unlock,
  CreditCard
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { VaultPasswordResetModal } from "./VaultPasswordResetModal";
import { apiFetch } from "../services/api";

interface VaultUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlockSuccess?: () => void;
}

/**
 * VaultUnlockModal Component
 *
 * Modern liquid-glass unlock modal complying with the 3-tier lifecycle:
 * 4-digit quick PIN (default) > Master Password > 24-word Recovery Phrase.
 * Purged of all legacy Windows Hello, 2FA, and purple artifacts.
 */
export const VaultUnlockModal: React.FC<VaultUnlockModalProps> = ({
  isOpen,
  onClose,
  onUnlockSuccess,
}) => {
  const { 
    isVaultConfigured, 
    hasVaultPin, 
    isVaultPinLocked, 
    setIsVaultUnlocked, 
    checkVaultStatus,
    setActiveTab,
    showToast 
  } = useAppStore();

  const [authMode, setAuthMode] = useState<"pin" | "password" | "recovery">("pin");
  const [pin, setPin] = useState(["", "", "", ""]);
  const [password, setPassword] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Sync mode whenever modal opens or lock status changes
  useEffect(() => {
    if (isOpen) {
      checkVaultStatus();
      setErrorMessage("");
      setPassword("");
      setPin(["", "", "", ""]);
      setRecoveryPhrase("");

      if (hasVaultPin && !isVaultPinLocked) {
        setAuthMode("pin");
      } else {
        setAuthMode("password");
      }
    }
  }, [isOpen, hasVaultPin, isVaultPinLocked, checkVaultStatus]);

  if (!isOpen) return null;

  // Generic unlock submission
  const performUnlock = async (payload: { password?: string; pin?: string; recovery_phrase?: string }) => {
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const res = await apiFetch("/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setIsVaultUnlocked(true);
        await checkVaultStatus();
        showToast("Private Vault unlocked.", "success");
        onUnlockSuccess?.();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data.detail || "Authentication failed. Please try again.");
        await checkVaultStatus();
        if (payload.pin) {
          setPin(["", "", "", ""]);
          pinInputRefs.current[0]?.focus();
        }
      }
    } catch {
      setErrorMessage("Could not connect to vault authentication service.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    performUnlock({ password });
  };

  const handleRecoverySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryPhrase.trim()) return;
    performUnlock({ recovery_phrase: recoveryPhrase.trim() });
  };

  // PIN auto-advance and auto-submit on 4th digit
  const handlePinDigitChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const nextPin = [...pin];
    nextPin[index] = digit;
    setPin(nextPin);

    if (digit && index < 3) {
      pinInputRefs.current[index + 1]?.focus();
    }

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

  const handleNavigateToSetup = () => {
    onClose();
    setActiveTab("vault");
  };

  return (
    <div 
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2500,
        padding: "20px",
      }}
    >
      <div 
        className="liquid-glass-toolbar"
        style={{
          width: "100%",
          maxWidth: "460px",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--glass-shadow)",
          border: "1px solid var(--glass-border)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Modal Header */}
        <div 
          style={{
            padding: "18px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--glass-border)",
            backgroundColor: "rgba(59, 130, 246, 0.05)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div 
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "rgba(59, 130, 246, 0.15)",
                border: "1px solid rgba(59, 130, 246, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-primary)",
              }}
            >
              <Lock size={16} />
            </div>
            <div>
              <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
                {isVaultConfigured ? "Unlock Private Vault" : "Setup Required"}
              </h2>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>
                {isVaultConfigured ? "Protected by on-device encryption" : "Encrypted Vault is not configured"}
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="clickable"
            style={{ 
              background: "transparent", 
              border: "none", 
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          
          {/* Case 1: Vault Not Configured */}
          {!isVaultConfigured ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "14px", padding: "12px 0" }}>
              <div 
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(59, 130, 246, 0.1)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-primary)",
                }}
              >
                <Sparkles size={24} />
              </div>
              <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
                Initialize Your Private Vault
              </h3>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0, lineHeight: "1.5", maxWidth: "360px" }}>
                You haven&apos;t set up an encrypted vault yet. Create your Master Password, 4-digit quick PIN, and recovery phrase to lock items.
              </p>

              <div style={{ display: "flex", gap: "10px", width: "100%", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="clickable"
                  style={{
                    flex: 1,
                    padding: "10px",
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
                  onClick={handleNavigateToSetup}
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
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 4px 16px var(--accent-glow)",
                  }}
                >
                  <Sparkles size={14} />
                  <span>Set Up Vault Now</span>
                </button>
              </div>
            </div>
          ) : (
            /* Case 2: Configured Vault with 3-Tier Unlock */
            <>
              {/* PIN Lockout Warning */}
              {isVaultPinLocked && (
                <div 
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "rgba(249, 115, 22, 0.12)",
                    border: "1px solid rgba(249, 115, 22, 0.3)",
                    color: "#fb923c",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    lineHeight: "1.4",
                  }}
                >
                  <ShieldAlert size={14} style={{ flexShrink: 0 }} />
                  <span>PIN is locked after 5 incorrect attempts. Please unlock using your Master Password.</span>
                </div>
              )}

              {/* Error Alert */}
              {errorMessage && (
                <div 
                  style={{
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "var(--accent-danger, #ef4444)",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <ShieldAlert size={14} style={{ flexShrink: 0 }} />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* ── Mode 1: 4-Digit Quick PIN Input ── */}
              {authMode === "pin" && !isVaultPinLocked && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "10px 0" }}>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                    Enter your 4-digit quick PIN to unlock:
                  </p>
                  <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
                    {[0, 1, 2, 3].map((idx) => (
                      <input
                        key={`modal-pin-${idx}`}
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
                          width: "48px",
                          height: "54px",
                          borderRadius: "var(--radius-md)",
                          backgroundColor: "var(--bg-surface)",
                          border: `1.5px solid ${pin[idx] ? "var(--accent-primary)" : "var(--glass-border)"}`,
                          color: "var(--text-primary)",
                          fontSize: "22px",
                          fontWeight: 700,
                          textAlign: "center",
                          outline: "none",
                          boxShadow: pin[idx] ? "0 0 12px rgba(59, 130, 246, 0.25)" : "none",
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

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginTop: "4px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("password");
                        setErrorMessage("");
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

                    <button
                      type="button"
                      onClick={() => setIsResetModalOpen(true)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        fontSize: "11px",
                        cursor: "pointer",
                        textDecoration: "underline",
                        padding: "4px",
                      }}
                    >
                      Forgot PIN?
                    </button>
                  </div>
                </div>
              )}

              {/* ── Mode 2: Master Password Input ── */}
              {authMode === "password" && (
                <form onSubmit={handlePasswordSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                      Master Password:
                    </label>
                    <div 
                      style={{
                        display: "flex",
                        alignItems: "center",
                        backgroundColor: "var(--glass-pill-bg)",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--glass-border)",
                        padding: "2px 10px",
                      }}
                    >
                      <Lock size={14} style={{ color: "var(--text-muted)", marginRight: "8px" }} />
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter master password..."
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoFocus
                        disabled={isSubmitting}
                        style={{
                          flex: 1,
                          padding: "8px 0",
                          background: "transparent",
                          border: "none",
                          color: "var(--text-primary)",
                          fontSize: "13px",
                          outline: "none",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="clickable"
                        style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px" }}
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    {hasVaultPin && !isVaultPinLocked ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode("pin");
                          setErrorMessage("");
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--accent-primary)",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        Unlock with 4-Digit PIN instead
                      </button>
                    ) : <span />}

                    <button
                      type="button"
                      onClick={() => setIsResetModalOpen(true)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--accent-primary)",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        padding: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <CreditCard size={12} />
                      <span>Forgot Password? Reset with Grid Card</span>
                    </button>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
                    <button
                      type="button"
                      onClick={onClose}
                      className="clickable"
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
                      type="submit"
                      disabled={isSubmitting || !password}
                      className="clickable"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 20px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--accent-primary)",
                        border: "none",
                        color: "#ffffff",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: isSubmitting || !password ? "default" : "pointer",
                        boxShadow: "0 4px 14px var(--accent-glow)",
                        opacity: isSubmitting || !password ? 0.6 : 1,
                      }}
                    >
                      {isSubmitting ? (
                        <Loader2 size={13} className="spin-animation" />
                      ) : (
                        <Unlock size={13} />
                      )}
                      <span>{isSubmitting ? "Decrypting..." : "Unlock Vault"}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* ── Mode 3: 24-Word Recovery Phrase ── */}
              {authMode === "recovery" && (
                <form onSubmit={handleRecoverySubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                      24-Word Emergency Recovery Phrase:
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Enter words separated by spaces..."
                      value={recoveryPhrase}
                      onChange={(e) => setRecoveryPhrase(e.target.value)}
                      autoFocus
                      disabled={isSubmitting}
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
                        resize: "none",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode(hasVaultPin && !isVaultPinLocked ? "pin" : "password");
                        setErrorMessage("");
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--accent-primary)",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Back to {hasVaultPin && !isVaultPinLocked ? "PIN" : "Password"}
                    </button>

                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={onClose}
                        className="clickable"
                        style={{
                          padding: "8px 14px",
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
                        type="submit"
                        disabled={isSubmitting || !recoveryPhrase.trim()}
                        className="clickable"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "8px 18px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "var(--accent-primary)",
                          border: "none",
                          color: "#ffffff",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: isSubmitting || !recoveryPhrase.trim() ? "default" : "pointer",
                          boxShadow: "0 4px 14px var(--accent-glow)",
                          opacity: isSubmitting || !recoveryPhrase.trim() ? 0.6 : 1,
                        }}
                      >
                        {isSubmitting ? (
                          <Loader2 size={13} className="spin-animation" />
                        ) : (
                          <KeyRound size={13} />
                        )}
                        <span>{isSubmitting ? "Restoring..." : "Restore Access"}</span>
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </>
          )}

        </div>
      </div>

      <VaultPasswordResetModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        onSuccess={() => {
          setIsResetModalOpen(false);
          showToast("Password updated. Please log in with your new password.", "success");
          setAuthMode("password");
        }}
      />
    </div>
  );
};
