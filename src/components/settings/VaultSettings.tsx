import React, { useState } from "react";
import { Shield, Clock, KeyRound, EyeOff } from "lucide-react";
import { AppSettings } from "../../hooks/useAppSettings";
import { VaultPasswordResetModal } from "../VaultPasswordResetModal";
import { useAppStore } from "../../store/useAppStore";

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
  const { showToast } = useAppStore();
  const [showResetModal, setShowResetModal] = useState(false);

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
                  Automatically locks your vault and wipes encryption keys from volatile memory when idle.
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
              <option value={0}>Never Auto-Lock</option>
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
                  Update your vault password, set a 4-digit PIN, or generate an emergency recovery card.
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
        initialMode="pin"
      />
    </div>
  );
};
