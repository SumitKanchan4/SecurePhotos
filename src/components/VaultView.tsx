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

const generateVaultMockPhotos = (count: number): PhotoItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: 10000 + i + 1,
    filename: `PRIVATE_VAULT_${(i + 1).toString().padStart(4, "0")}.enc`,
    filepath: `vault/private/PRIVATE_VAULT_${(i + 1).toString().padStart(4, "0")}.enc`,
    file_size: 1024 * 1024 * 2.4,
    mime_type: "image/jpeg",
    width: 3840,
    height: 2160,
    taken_at: new Date(Date.now() - i * 3600 * 1000 * 24).toISOString(),
    is_favorite: i % 3 === 0,
    is_encrypted: true,
    vault_type: "private",
    is_optimized: true,
    is_enhanced: true,
    caption: `Zero-Trust Encrypted Intimate Asset #${i + 1}`,
  }));
};

export const VaultView: React.FC<VaultViewProps> = ({ onUnlockRequest, onPhotoClick }) => {
  const { isVaultUnlocked, setIsVaultUnlocked } = useAppStore();
  const [isPrivacyShieldActive, setIsPrivacyShieldActive] = useState(false);
  const [vaultPhotos] = useState<PhotoItem[]>(generateVaultMockPhotos(48));

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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      {/* Vault Active Header */}
      <div 
        style={{
          padding: "12px 20px",
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
              padding: "4px 8px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-vault)",
              color: "#ffffff",
              fontSize: "11px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <ShieldCheck size={12} />
            UNLOCKED (IN-MEMORY)
          </div>
          <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
            <Clock size={12} /> Auto-locks after 30s idle
          </span>
        </div>

        {/* Vault Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => setIsPrivacyShieldActive(!isPrivacyShieldActive)}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: isPrivacyShieldActive ? "var(--accent-primary)" : "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: isPrivacyShieldActive ? "#ffffff" : "var(--text-secondary)",
              fontSize: "12px",
            }}
          >
            <EyeOff size={14} />
            {isPrivacyShieldActive ? "Disable Privacy Shield" : "Privacy Shield"}
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
              padding: "6px 14px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--accent-danger)",
              border: "none",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <Lock size={14} />
            Lock Vault Now (L)
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
            Media is concealed while in-memory batch 4K enhancement runs safely.
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

      {/* Decrypted Vault Photos Grid */}
      <PhotoGrid photos={vaultPhotos} onPhotoClick={onPhotoClick} />
    </div>
  );
};
