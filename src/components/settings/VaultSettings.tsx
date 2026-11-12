import React, { useState } from "react";
import { Shield, Clock, KeyRound, EyeOff, Hash } from "lucide-react";
import { AppSettings } from "../../hooks/useAppSettings";
import { VaultPasswordResetModal } from "../VaultPasswordResetModal";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch } from "../../services/api";

interface VaultSettingsProps {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

/**
 * VaultSettings Component
 *
 * Configures zero-trust Private Vault security, inactivity auto-lock,
 * and master credentials.
 */
export const VaultSettings: React.FC<VaultSettingsProps> = ({
  settings,
  updateSetting,
}) => {
  const { showToast, isVaultUnlocked, hasVaultPin, checkVaultStatus } = useAppStore();
  const [showResetModal, setShowResetModal] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [isSavingPin, setIsSavingPin] = useState(false);

  /** Sets/changes the quick PIN, or removes it when `pin` is null. Needs an unlocked vault. */
  const savePin = async (pin: string | null) => {
    setIsSavingPin(true);
    try {
      const res = await apiFetch("/api/vault/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast?.(data.detail || "Could not update your PIN.", "warning");
        return;
      }
      setPinDraft("");
      await checkVaultStatus();
      showToast?.(pin ? "Quick PIN saved." : "Quick PIN removed.", "success");
    } finally {
      setIsSavingPin(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* ── Section: Security & Access (Grouped Inset Card) ─────────────────── */}
      <div>
        <div style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Security & Access Controls
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            Hardware-backed AES-256-GCM encryption with complete zero-disk decryption safety.
          </p>
        </div>

        <div
          style={{
            backgroundColor: "var(--glass-surface)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid var(--glass-border)",
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--glass-shadow)",
            overflow: "hidden",
          }}
        >
          {/* Row 1: Auto-Lock Timeout */}
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--glass-border)",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(59, 130, 246, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-primary)",
                  flexShrink: 0,
                }}
              >
                <Clock size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Auto-Lock Inactivity Timeout
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Locks your vault when idle. Your PIN can reopen it until you close the app.
                </p>
              </div>
            </div>

            <select
              value={settings.auto_lock_duration}
              onChange={(e) => updateSetting("auto_lock_duration", Number(e.target.value))}
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--glass-pill-bg)",
                border: "1px solid var(--glass-border)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value={60}>1 Minute</option>
              <option value={300}>5 Minutes (Recommended)</option>
              <option value={900}>15 Minutes</option>
              <option value={1800}>30 Minutes</option>
            </select>
          </div>

          {/* Row 2: Master Password & PIN */}
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(139, 92, 246, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#8b5cf6",
                  flexShrink: 0,
                }}
              >
                <KeyRound size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Master Credentials & Recovery Key
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Change your vault password using your current password or your Emergency Card.
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowResetModal(true)}
              className="clickable"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "rgba(59, 130, 246, 0.12)",
                border: "1px solid rgba(59, 130, 246, 0.25)",
                color: "var(--accent-primary)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <KeyRound size={13} />
              <span>Change Password</span>
            </button>
          </div>

          {/* Row 3: Quick PIN (re-opens the vault after it locks, until the app closes) */}
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderTop: "1px solid var(--glass-border)",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-success)",
                  flexShrink: 0,
                }}
              >
                <Hash size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Quick PIN
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  {!isVaultUnlocked
                    ? "Unlock your vault to set or change your PIN."
                    : hasVaultPin
                    ? "Reopens your vault after it locks, until you close the app."
                    : "Set a 4-digit PIN to reopen your vault quickly after it locks."}
                </p>
              </div>
            </div>

            {isVaultUnlocked && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="password"
                  inputMode="numeric"
                  aria-label="New quick PIN"
                  placeholder="4 digits"
                  maxLength={4}
                  value={pinDraft}
                  onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  style={{
                    width: "84px",
                    padding: "6px 10px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    fontFamily: "var(--font-mono)",
                    textAlign: "center",
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => savePin(pinDraft)}
                  disabled={pinDraft.length !== 4 || isSavingPin}
                  className="clickable"
                  style={{
                    padding: "6px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "rgba(59, 130, 246, 0.12)",
                    border: "1px solid rgba(59, 130, 246, 0.25)",
                    color: "var(--accent-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: pinDraft.length === 4 ? "pointer" : "default",
                    opacity: pinDraft.length === 4 ? 1 : 0.6,
                    whiteSpace: "nowrap",
                  }}
                >
                  {hasVaultPin ? "Change PIN" : "Set PIN"}
                </button>
                {hasVaultPin && (
                  <button
                    onClick={() => savePin(null)}
                    disabled={isSavingPin}
                    className="clickable"
                    style={{
                      padding: "6px 14px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-border)",
                      color: "var(--text-secondary)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Section: Privacy Safeguards (Informational Inset Card) ──────────── */}
      <div>
        <div style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Privacy Safeguards
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            Protection against unauthorized screenshots and memory inspection.
          </p>
        </div>

        <div
          style={{
            backgroundColor: "var(--glass-surface)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid var(--glass-border)",
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--glass-shadow)",
            overflow: "hidden",
          }}
        >
          {/* Row 1: Memory-Only Decryption */}
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--glass-border)",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-success)",
                  flexShrink: 0,
                }}
              >
                <Shield size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Zero-Disk Decryption
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Vault photos are decrypted strictly in volatile RAM while viewing and never written unencrypted to disk.
                </p>
              </div>
            </div>

            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--accent-success)",
                backgroundColor: "rgba(16, 185, 129, 0.12)",
                padding: "3px 10px",
                borderRadius: "var(--radius-full)",
                border: "1px solid rgba(16, 185, 129, 0.25)",
              }}
            >
              Enforced
            </span>
          </div>

          {/* Row 2: Frosted Privacy Shield */}
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(59, 130, 246, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-primary)",
                  flexShrink: 0,
                }}
              >
                <EyeOff size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Frosted Privacy Shields
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Shields sensitive vault media with frosted liquid-glass blur when switching away or running background tasks.
                </p>
              </div>
            </div>

            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--accent-primary)",
                backgroundColor: "rgba(59, 130, 246, 0.12)",
                padding: "3px 10px",
                borderRadius: "var(--radius-full)",
                border: "1px solid rgba(59, 130, 246, 0.25)",
              }}
            >
              Active
            </span>
          </div>
        </div>
      </div>

      <VaultPasswordResetModal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        onSuccess={() => {
          setShowResetModal(false);
          showToast?.("Master credentials updated successfully!", "success");
        }}
        initialMode="current"
      />
    </div>
  );
};
