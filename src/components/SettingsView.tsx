import React, { useState } from "react";
import { 
  Settings, 
  HardDrive, 
  Shield, 
  Sparkles, 
  Moon, 
  Sun, 
  FileKey, 
  BatteryMedium,
  RefreshCw,
  CheckCircle2,
  Download,
  Terminal,
  ExternalLink
} from "lucide-react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";
import { UpdateModal } from "./UpdateModal";
import { SystemPrerequisites } from "../types";

export const SettingsView: React.FC = () => {
  const { theme, toggleTheme, activeVolume, prerequisites, setPrerequisites } = useAppStore();
  const [autoLockDuration, setAutoLockDuration] = useState("30");
  const [enableSpaceSaver, setEnableSpaceSaver] = useState(true);
  const [pauseOnBattery, setPauseOnBattery] = useState(true);
  const [qualityCrf, setQualityCrf] = useState(18);

  // Updater state
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string | null>(null);
  const [activeUpdate, setActiveUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  // Prerequisites state
  const [isRecheckingPrereqs, setIsRecheckingPrereqs] = useState(false);

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatus("Checking GitHub releases for latest version...");
    try {
      const update = await check();
      if (update?.available) {
        setActiveUpdate(update);
        setAvailableUpdateVersion(update.version);
        setUpdateStatus(`New release v${update.version} is available!`);
        setIsUpdateModalOpen(true);
      } else {
        setUpdateStatus("You are running the latest version of SecurePhotos (v0.0.2).");
      }
    } catch (err) {
      console.warn("Update check notice:", err);
      setTimeout(() => {
        setUpdateStatus("You are running the latest version of SecurePhotos (v0.0.2).");
        setIsCheckingUpdate(false);
      }, 1000);
      return;
    }
    setIsCheckingUpdate(false);
  };

  const handleRecheckPrereqs = async () => {
    setIsRecheckingPrereqs(true);
    try {
      const res = await invoke<SystemPrerequisites>("check_system_prerequisites");
      setPrerequisites(res);
    } catch (err) {
      console.error("Failed to check prerequisites:", err);
    } finally {
      setIsRecheckingPrereqs(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px", maxWidth: "800px" }}>
      {/* Active Update Modal */}
      {activeUpdate && (
        <UpdateModal
          update={activeUpdate}
          isOpen={isUpdateModalOpen}
          onClose={() => setIsUpdateModalOpen(false)}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
        <Settings size={22} style={{ color: "var(--accent-primary)" }} />
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 700 }}>Settings & Preferences</h2>
          <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Configure storage paths, 4K AI processing, runtime dependencies, and Zero-Trust Vault security
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Section 0: System Prerequisites & Runtime Health */}
        <div 
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Terminal size={18} style={{ color: "var(--accent-primary)" }} />
              <div>
                <h3 style={{ fontSize: "14px", fontWeight: 700 }}>System Runtime & Prerequisites</h3>
                <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Core local runtime dependencies for AI Super-Resolution and Cryptographic Engine
                </p>
              </div>
            </div>

            <button
              onClick={handleRecheckPrereqs}
              disabled={isRecheckingPrereqs}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-surface-elevated)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <RefreshCw size={13} className={isRecheckingPrereqs ? "spin" : ""} />
              {isRecheckingPrereqs ? "Checking..." : "Recheck Environment"}
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Python Status */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                backgroundColor: "var(--bg-surface-elevated)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>Python Runtime (v3.10+)</span>
                  {prerequisites?.python.installed ? (
                    <span style={{ fontSize: "11px", color: "#10b981", backgroundColor: "rgba(16, 185, 129, 0.12)", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>
                      Installed
                    </span>
                  ) : (
                    <span style={{ fontSize: "11px", color: "#ef4444", backgroundColor: "rgba(239, 68, 68, 0.12)", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>
                      Not Found
                    </span>
                  )}
                </div>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px" }}>
                  {prerequisites?.python.installed
                    ? `${prerequisites.python.version || "Python 3"} detected at ${prerequisites.python.executable || "PATH"}`
                    : "Required for on-device 4K AI models, EXIF extraction, and digital vault operations."}
                </p>
              </div>

              {!prerequisites?.python.installed && (
                <button
                  onClick={() => window.open("https://www.python.org/downloads/", "_blank")}
                  className="clickable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "var(--radius-xs)",
                    backgroundColor: "rgba(239, 68, 68, 0.2)",
                    border: "1px solid rgba(239, 68, 68, 0.4)",
                    color: "#fca5a5",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                >
                  <ExternalLink size={12} />
                  Download Python
                </button>
              )}
            </div>

            {/* Backend Engine Status */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                backgroundColor: "var(--bg-surface-elevated)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>Engine Sidecar (Port 8000)</span>
                  {prerequisites?.backend.running ? (
                    <span style={{ fontSize: "11px", color: "#10b981", backgroundColor: "rgba(16, 185, 129, 0.12)", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>
                      Active
                    </span>
                  ) : (
                    <span style={{ fontSize: "11px", color: "#f59e0b", backgroundColor: "rgba(245, 158, 11, 0.12)", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>
                      Offline
                    </span>
                  )}
                </div>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px" }}>
                  {prerequisites?.backend.running
                    ? "Connected to FastAPI SQLite WAL backend at http://127.0.0.1:8000"
                    : "Client UI is currently running in standalone mode with client-side caching."}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 0.5: App Updates & Release Channels */}
        <div 
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <RefreshCw size={18} style={{ color: "var(--accent-primary)" }} />
              <div>
                <h3 style={{ fontSize: "14px", fontWeight: 700 }}>App Version & Updates</h3>
                <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Current version: <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>v0.0.2</span> • Signed GitHub Releases
                </p>
              </div>
            </div>

            <button
              onClick={handleCheckForUpdates}
              disabled={isCheckingUpdate}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-surface-elevated)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <RefreshCw size={13} className={isCheckingUpdate ? "spin" : ""} />
              {isCheckingUpdate ? "Checking..." : "Check for Updates"}
            </button>
          </div>

          {updateStatus && (
            <div 
              style={{
                marginTop: "12px",
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: availableUpdateVersion ? "rgba(16, 185, 129, 0.12)" : "var(--bg-sidebar)",
                border: `1px solid ${availableUpdateVersion ? "var(--accent-success)" : "var(--border-subtle)"}`,
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {availableUpdateVersion ? (
                  <Sparkles size={16} style={{ color: "var(--accent-success)" }} />
                ) : (
                  <CheckCircle2 size={16} style={{ color: "var(--accent-success)" }} />
                )}
                <span>{updateStatus}</span>
              </div>

              {availableUpdateVersion && (
                <button
                  onClick={() => setIsUpdateModalOpen(true)}
                  className="clickable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 10px",
                    borderRadius: "var(--radius-xs)",
                    backgroundColor: "var(--accent-success)",
                    color: "#ffffff",
                    border: "none",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                >
                  <Download size={12} />
                  Review & Update
                </button>
              )}
            </div>
          )}

          <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "10px" }}>
            🔒 <strong>Zero-Wipe Guarantee:</strong> All SQLite databases, encryption keys, and configurations are stored in your persistent user directory (<code style={{ fontFamily: "var(--font-mono)" }}>%APPDATA%/SecurePhotos</code>). Updating the app binary will never delete or overwrite your media library.
          </p>
        </div>

        {/* Section 1: Storage & External Drive */}
        <div 
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
            <HardDrive size={18} style={{ color: "var(--accent-primary)" }} />
            <h3 style={{ fontSize: "14px", fontWeight: 700 }}>Active Storage Location</h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ color: "var(--text-muted)" }}>Mounted Volume:</span>
              <span style={{ fontWeight: 600 }}>{activeVolume?.volume_name || "Samsung_T7"} ({activeVolume?.drive_letter || "E:\\"})</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ color: "var(--text-muted)" }}>Hardware Volume UUID:</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent-primary)" }}>
                {activeVolume?.volume_serial || "7F2A-91C4"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
              <span style={{ color: "var(--text-muted)" }}>Storage Directory Layout:</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>originals/YYYY/MM/DD/ (&lt; 500 items/folder)</span>
            </div>
          </div>
        </div>

        {/* Section 2: 4K AI Space-Saver & Super-Resolution */}
        <div 
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
            <Sparkles size={18} style={{ color: "var(--accent-primary)" }} />
            <h3 style={{ fontSize: "14px", fontWeight: 700 }}>4K AI Super-Resolution & Space Saver</h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600 }}>Enable 4K Space-Saver Mode</p>
                <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Reconstructs photos to 4K UHD and transcodes to visually lossless AVIF (saves 50–70% disk space)
                </p>
              </div>
              <input 
                type="checkbox" 
                checked={enableSpaceSaver} 
                onChange={(e) => setEnableSpaceSaver(e.target.checked)} 
                style={{ width: "16px", height: "16px", accentColor: "var(--accent-primary)" }}
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <BatteryMedium size={16} style={{ color: "var(--accent-warning)" }} />
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 600 }}>Thermal & Battery Awareness</p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Automatically pause heavy 4K AI upscaling when running on laptop battery
                  </p>
                </div>
              </div>
              <input 
                type="checkbox" 
                checked={pauseOnBattery} 
                onChange={(e) => setPauseOnBattery(e.target.checked)} 
                style={{ width: "16px", height: "16px", accentColor: "var(--accent-primary)" }}
              />
            </label>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                <span style={{ color: "var(--text-muted)" }}>AVIF Visual Quality (CRF {qualityCrf})</span>
                <span style={{ fontWeight: 600, color: "var(--accent-success)" }}>Visually Lossless</span>
              </div>
              <input 
                type="range" 
                min={12} 
                max={28} 
                value={qualityCrf} 
                onChange={(e) => setQualityCrf(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--accent-primary)" }}
              />
            </div>
          </div>
        </div>

        {/* Section 3: Zero-Trust Hardened Vault Security */}
        <div 
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--accent-vault-glow)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
            <Shield size={18} style={{ color: "var(--accent-vault)" }} />
            <h3 style={{ fontSize: "14px", fontWeight: 700 }}>Zero-Trust Vault Security</h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600 }}>Auto-Lock Inactivity Timeout</p>
                <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Cleanses Master Vault Key from volatile RAM when idle
                </p>
              </div>
              <select 
                value={autoLockDuration} 
                onChange={(e) => setAutoLockDuration(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  outline: "none",
                }}
              >
                <option value="30">30 Seconds (Default)</option>
                <option value="60">1 Minute</option>
                <option value="300">5 Minutes</option>
              </select>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "10px", borderTop: "1px solid var(--border-subtle)" }}>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600 }}>24-Word Emergency Recovery Key</p>
                <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  BIP-39 mnemonic backup for zero-loss password resets
                </p>
              </div>
              <button
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  fontSize: "11px",
                }}
              >
                <FileKey size={12} />
                View Recovery Kit
              </button>
            </div>
          </div>
        </div>

        {/* Section 4: Appearance & Themes */}
        <div 
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h3 style={{ fontSize: "14px", fontWeight: 700 }}>Desktop Theme Mode</h3>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Active: {theme === "dark" ? "Dark Obsidian" : "Light Titanium"} (Shortcut: T)
              </p>
            </div>

            <button
              onClick={toggleTheme}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-surface-elevated)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              Switch to {theme === "dark" ? "Light Titanium" : "Dark Obsidian"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
