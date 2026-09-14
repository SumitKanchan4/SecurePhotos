import React, { useState } from "react";
import { 
  Lock, 
  Fingerprint, 
  KeyRound, 
  ShieldAlert, 
  X, 
  Eye, 
  EyeOff, 
  FileKey 
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";

interface VaultUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlockSuccess?: () => void;
}

export const VaultUnlockModal: React.FC<VaultUnlockModalProps> = ({
  isOpen,
  onClose,
  onUnlockSuccess,
}) => {
  const { setIsVaultUnlocked } = useAppStore();
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [useRecoveryKey, setUseRecoveryKey] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const payload: any = {};
      if (useRecoveryKey) {
        payload.recovery_phrase = recoveryPhrase;
      } else {
        payload.password = password;
      }
      if (totpCode) {
        payload.totp_code = totpCode;
      }

      const res = await fetch("http://127.0.0.1:8000/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setIsVaultUnlocked(true);
        onUnlockSuccess?.();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data.detail || "Invalid password or authentication code.");
      }
    } catch {
      setErrorMessage("Could not connect to vault authentication service.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2500,
      }}
    >
      <div 
        className="glass-panel"
        style={{
          width: "480px",
          backgroundColor: "var(--bg-surface)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lightbox)",
          border: "1px solid var(--accent-vault-glow)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Modal Header */}
        <div 
          style={{
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border-subtle)",
            backgroundColor: "rgba(139, 92, 246, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div 
              style={{
                width: "30px",
                height: "30px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--accent-vault)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
              }}
            >
              <Lock size={16} />
            </div>
            <div>
              <h2 style={{ fontSize: "14px", fontWeight: 700 }}>Unlock Private Vault</h2>
              <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                Zero-Trust AES-256-GCM Military Encryption
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="clickable"
            style={{ background: "transparent", border: "none", color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleUnlock} style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Biometric Touch Prompt */}
          <div 
            style={{
              padding: "12px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-sidebar)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <Fingerprint size={24} style={{ color: "var(--accent-vault)", flexShrink: 0 }} />
            <div>
              <p style={{ fontSize: "12px", fontWeight: 600 }}>Windows Hello / Biometric</p>
              <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                Touch fingerprint sensor or use Windows PIN to unlock in 1 second.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "2px 0" }}>
            <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-subtle)" }} />
            <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
              Or Enter Password
            </span>
            <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-subtle)" }} />
          </div>

          {errorMessage && (
            <div 
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid var(--accent-danger)",
                color: "var(--accent-danger)",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <ShieldAlert size={14} />
              <span>{errorMessage}</span>
            </div>
          )}

          {useRecoveryKey ? (
            /* Emergency 24-Word Recovery Mnemonic Input */
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                24-Word Emergency Recovery Phrase:
              </label>
              <textarea
                rows={3}
                placeholder="apple timber ocean canyon desert mountain river breeze..."
                value={recoveryPhrase}
                onChange={(e) => setRecoveryPhrase(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono)",
                  outline: "none",
                  resize: "none",
                }}
              />
            </div>
          ) : (
            /* Password / PIN Input */
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
                Master Vault Password or PIN:
              </label>
              <div 
                style={{
                  display: "flex",
                  alignItems: "center",
                  backgroundColor: "var(--bg-surface-elevated)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-subtle)",
                  padding: "0 10px",
                }}
              >
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter vault password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
                  style={{ background: "transparent", border: "none", color: "var(--text-muted)" }}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* Authenticator App 6-digit code */}
          <div>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px", display: "block" }}>
              Authenticator 2FA Code (Optional if not enabled):
            </label>
            <input
              type="text"
              placeholder="e.g. 482 910"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-surface-elevated)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
                fontSize: "13px",
                fontFamily: "var(--font-mono)",
                letterSpacing: "2px",
                outline: "none",
              }}
            />
          </div>

          {/* Toggle Recovery Mode */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
            <button
              type="button"
              onClick={() => setUseRecoveryKey(!useRecoveryKey)}
              className="clickable"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--accent-vault)",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 600,
              }}
            >
              <FileKey size={12} />
              {useRecoveryKey ? "Use Password Instead" : "Forgot Password? Use Recovery Key"}
            </button>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <button
              type="button"
              onClick={onClose}
              className="clickable"
              style={{
                padding: "7px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "transparent",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-secondary)",
                fontSize: "12px",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 18px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--accent-vault)",
                border: "none",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <KeyRound size={14} />
              Unlock Vault
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
