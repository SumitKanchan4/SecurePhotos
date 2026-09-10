import React, { useState } from "react";
import { 
  Lock, 
  Unlock, 
  ShieldCheck, 
  Clock, 
  EyeOff
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { PhotoGrid } from "./PhotoGrid";
import { PhotoItem } from "../types";

interface VaultViewProps {
  onUnlockRequest: () => void;
  onPhotoClick?: (index: number) => void;
}

export const VaultView: React.FC<VaultViewProps> = ({ onUnlockRequest, onPhotoClick }) => {
  const { isVaultUnlocked, setIsVaultUnlocked } = useAppStore();
  const [isPrivacyShieldActive, setIsPrivacyShieldActive] = useState(false);
  const [vaultPhotos] = useState<PhotoItem[]>([]);

  if (!isVaultUnlocked) {
    return (
      <div 
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px",
          textAlign: "center",
        }}
      >
        <div 
          style={{
            width: "72px",
            height: "72px",
            borderRadius: "var(--radius-lg)",
            backgroundColor: "rgba(139, 92, 246, 0.15)",
            border: "1px solid var(--accent-vault-glow)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent-vault)",
            marginBottom: "20px",
          }}
        >
          <Lock size={36} />
        </div>

        <h2 style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "-0.4px" }}>
          Private Vault is Locked
        </h2>
        <p style={{ fontSize: "13px", color: "var(--text-muted)", maxWidth: "440px", marginTop: "8px", lineHeight: "1.5" }}>
          All photos, documents, and thumbnails inside this vault are encrypted with chunked AES-256-GCM and mathematically isolated from background processes.
        </p>

        <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
          <button
            onClick={onUnlockRequest}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 24px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--accent-vault)",
              border: "none",
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: 600,
              boxShadow: "0 0 16px var(--accent-vault-glow)",
            }}
          >
            <Unlock size={16} />
            Unlock Vault
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", padding: "16px 24px 0", gap: "16px" }}>
      {/* Unified Compact Glassmorphic Header Bar */}
      <div 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          flexWrap: "wrap",
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
        {/* Left Column: Security Status Badge & Timer */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "10px", minWidth: "120px" }}>
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
              letterSpacing: "0.02em",
            }}
          >
            <ShieldCheck size={13} />
            <span>UNLOCKED</span>
          </div>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
            <Clock size={12} /> Auto-locks (30s)
          </span>
        </div>

        {/* Center Column: Centered Title & Inline Frosted Capsule Badge */}
        <div style={{ flex: "0 1 auto", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Lock size={18} style={{ color: "var(--accent-vault)" }} />
            <h2
              style={{
                fontSize: "22px",
                fontWeight: 800,
                fontFamily: "var(--font-display, var(--font-sans))",
                letterSpacing: "-0.03em",
                color: "var(--text-primary)",
                margin: 0,
                whiteSpace: "nowrap",
              }}
            >
              Encrypted Vault
            </h2>
          </div>

          {/* Inline Frosted Capsule Badge for Photo Count */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 10px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-badge-bg)",
              border: "1px solid var(--glass-badge-border)",
              backdropFilter: "blur(8px)",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
              letterSpacing: "0.01em",
            }}
          >
            <span>{vaultPhotos.length} {vaultPhotos.length === 1 ? "photo" : "photos"}</span>
          </div>
        </div>

        {/* Right Column: Vault Actions */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", minWidth: "120px" }}>
          <button
            onClick={() => setIsPrivacyShieldActive(!isPrivacyShieldActive)}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              backgroundColor: isPrivacyShieldActive ? "var(--accent-primary)" : "var(--glass-pill-bg)",
              border: isPrivacyShieldActive ? "1px solid var(--glass-border-highlight)" : "1px solid var(--glass-pill-border)",
              color: isPrivacyShieldActive ? "#ffffff" : "var(--text-primary)",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <EyeOff size={13} />
            <span>{isPrivacyShieldActive ? "Shield On" : "Privacy Shield"}</span>
          </button>

          <button
            onClick={() => {
              setIsVaultUnlocked(false);
              fetch("http://127.0.0.1:8000/api/vault/lock", { method: "POST" }).catch(() => {});
            }}
            className="clickable"
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
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <Lock size={13} />
            <span>Lock Vault (L)</span>
          </button>
        </div>
      </div>

      {/* Frosted Privacy Shield Overlay */}
      {isPrivacyShieldActive && (
        <div 
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(9, 10, 15, 0.85)",
            backdropFilter: "blur(24px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <Lock size={48} style={{ color: "var(--accent-vault)", marginBottom: "16px" }} />
          <h3 style={{ fontSize: "16px", fontWeight: 700 }}>Frosted Privacy Shield Active</h3>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
            Media is concealed while in-memory batch 8K ULTRA enhancement runs safely.
          </p>
          <button
            onClick={() => setIsPrivacyShieldActive(false)}
            className="clickable"
            style={{
              marginTop: "16px",
              padding: "6px 16px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--accent-vault)",
              border: "none",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            Reveal Vault
          </button>
        </div>
      )}

      {/* Decrypted Vault Content */}
      {vaultPhotos.length === 0 ? (
        <div 
          style={{
            marginTop: "80px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            textAlign: "center",
          }}
        >
          <Lock size={48} style={{ opacity: 0.3, marginBottom: "12px", color: "var(--accent-vault)" }} />
          <p style={{ fontSize: "14px", fontWeight: 600 }}>Your Vault is Empty</p>
          <p style={{ fontSize: "12px", marginTop: "4px", maxWidth: "380px" }}>
            Select any photo from your library and press <strong>"Move to Vault (L)"</strong> to encrypt it with AES-256-GCM.
          </p>
        </div>
      ) : (
        <PhotoGrid photos={vaultPhotos} onPhotoClick={onPhotoClick} />
      )}
    </div>
  );
};
