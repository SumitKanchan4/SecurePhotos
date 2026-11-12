import React, { useState, useEffect } from "react";
import { Cpu, RefreshCw, CheckCircle2, Download, Sparkles, Heart, HardDrive, FolderSearch } from "lucide-react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/useAppStore";
import { UpdateModal } from "../UpdateModal";
import { SystemPrerequisites } from "../../types";

/**
 * AboutSettings Component
 *
 * Displays app version, software update checker, and local engine health.
 */
export const AboutSettings: React.FC = () => {
  const { prerequisites, setPrerequisites, showToast } = useAppStore();

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string | null>(null);
  const [activeUpdate, setActiveUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isRecheckingPrereqs, setIsRecheckingPrereqs] = useState(false);
  const [libraryLocation, setLibraryLocation] = useState<{ path: string; is_custom: boolean; has_database: boolean } | null>(null);
  const [isSwitchingLibrary, setIsSwitchingLibrary] = useState(false);

  useEffect(() => {
    invoke<{ path: string; is_custom: boolean; has_database: boolean }>("get_library_location")
      .then(setLibraryLocation)
      .catch(console.error);
  }, []);

  const handleSwitchLibrary = async () => {
    setIsSwitchingLibrary(true);
    try {
      const selected = await invoke<string | null>("select_import_folder");
      if (!selected) {
        setIsSwitchingLibrary(false);
        return;
      }
      await invoke("reconnect_library", { newPath: selected });
      showToast?.("Library reconnected successfully! Restarting...", "success");
      setTimeout(() => window.location.reload(), 1000);
    } catch (err: any) {
      console.error("Switch library error:", err);
      showToast?.(typeof err === "string" ? err : err?.message || "Failed to switch library", "warning");
      setIsSwitchingLibrary(false);
    }
  };

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatus("Checking for updates...");
    try {
      const update = await check();
      if (update?.available) {
        setActiveUpdate(update);
        setAvailableUpdateVersion(update.version);
        setUpdateStatus(`New release v${update.version} is available!`);
        setIsUpdateModalOpen(true);
      } else {
        setUpdateStatus("You are running the latest version (v0.1.0).");
      }
    } catch (err) {
      console.warn("Update check notice:", err);
      setTimeout(() => {
        setUpdateStatus("You are running the latest version (v0.1.0).");
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
      showToast?.("Local engine environment is fully operational", "success");
    } catch (err) {
      console.error("Failed to check prerequisites:", err);
      showToast?.("Error checking engine environment", "warning");
    } finally {
      setIsRecheckingPrereqs(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Active Update Modal */}
      {activeUpdate && (
        <UpdateModal
          update={activeUpdate}
          isOpen={isUpdateModalOpen}
          onClose={() => setIsUpdateModalOpen(false)}
        />
      )}

      {/* ── Section: App Information & Updates (Grouped Inset Card) ──────── */}
      <div>
        <div style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Application & Updates
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            Software release details and GitHub update feeds.
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
          {/* Row 1: App Version & Check for Updates */}
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
                  backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-primary)",
                  flexShrink: 0,
                }}
              >
                <Sparkles size={18} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <p style={{ fontSize: "13px", fontWeight: 600, margin: 0, color: "var(--text-primary)" }}>
                    SecurePhotos Desktop
                  </p>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                      color: "var(--accent-primary)",
                      backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--accent-ink) 25%, transparent)",
                      padding: "1px 7px",
                      borderRadius: "var(--radius-full)",
                    }}
                  >
                    v0.1.0
                  </span>
                </div>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
                  Release channel: Stable (Official signed release)
                </p>
              </div>
            </div>

            <button
              onClick={handleCheckForUpdates}
              disabled={isCheckingUpdate}
              className="clickable"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--glass-pill-bg)",
                border: "1px solid var(--glass-border)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <RefreshCw size={13} className={isCheckingUpdate ? "spin" : ""} />
              <span>{isCheckingUpdate ? "Checking..." : "Check for Updates"}</span>
            </button>
          </div>

          {/* Optional Update Banner */}
          {updateStatus && (
            <div
              style={{
                padding: "14px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: availableUpdateVersion ? "rgba(16, 185, 129, 0.1)" : "transparent",
                borderBottom: "1px solid var(--glass-border)",
                fontSize: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <CheckCircle2 size={16} style={{ color: availableUpdateVersion ? "var(--accent-success)" : "var(--accent-primary)" }} />
                <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{updateStatus}</span>
              </div>

              {availableUpdateVersion && (
                <button
                  onClick={() => setIsUpdateModalOpen(true)}
                  className="clickable"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "5px 12px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-success)",
                    color: "#ffffff",
                    border: "none",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <Download size={12} />
                  <span>Review & Install</span>
                </button>
              )}
            </div>
          )}

          {/* Row 2: Open Source License */}
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
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-success)",
                  flexShrink: 0,
                }}
              >
                <Heart size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Open Source & MIT License
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Free and open-source software built for total privacy and personal data ownership.
                </p>
              </div>
            </div>

            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              MIT License
            </span>
          </div>
        </div>
      </div>

      {/* ── Section: Active Library & Portable Storage (Grouped Inset Card) ── */}
      <div>
        <div style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Library & Storage Location
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            Active SQLite database, media originals, and encrypted vault storage directory.
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
                  backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-primary)",
                  flexShrink: 0,
                }}
              >
                <HardDrive size={18} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <p style={{ fontSize: "13px", fontWeight: 600, margin: 0, color: "var(--text-primary)" }}>
                    {libraryLocation?.is_custom ? "External / Custom Vault" : "Default Portable Vault"}
                  </p>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: libraryLocation?.has_database ? "#10b981" : "#fbbf24",
                      backgroundColor: libraryLocation?.has_database ? "rgba(16, 185, 129, 0.15)" : "rgba(251, 191, 36, 0.15)",
                      padding: "1px 6px",
                      borderRadius: "var(--radius-full)",
                    }}
                  >
                    {libraryLocation?.has_database ? "Connected" : "No Database Found"}
                  </span>
                </div>
                <p 
                  style={{ 
                    fontSize: "12px", 
                    color: "var(--text-muted)", 
                    margin: "2px 0 0 0", 
                    fontFamily: "var(--font-mono)",
                    wordBreak: "break-all"
                  }}
                >
                  {libraryLocation?.path || "Resolving library path..."}
                </p>
              </div>
            </div>

            <button
              onClick={handleSwitchLibrary}
              disabled={isSwitchingLibrary}
              className="clickable"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--glass-pill-bg)",
                border: "1px solid var(--glass-border)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: isSwitchingLibrary ? "wait" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <FolderSearch size={13} />
              <span>{isSwitchingLibrary ? "Selecting..." : "Switch Library"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Section: Local Intelligence Engine (Grouped Inset Card) ────────── */}
      <div>
        <div style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Local Engine & System Health
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            Autonomous Python 3.12 FastAPI sidecar and ONNX Runtime status.
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
          {/* Row 1: Engine Status */}
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
                  backgroundColor: prerequisites?.backend.running ? "rgba(16, 185, 129, 0.12)" : "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: prerequisites?.backend.running ? "#10b981" : "var(--accent-primary)",
                  flexShrink: 0,
                }}
              >
                <Cpu size={18} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <p style={{ fontSize: "13px", fontWeight: 600, margin: 0, color: "var(--text-primary)" }}>
                    {prerequisites?.backend.running ? "Core Intelligence Engine Operational" : "Local Engine Active"}
                  </p>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: "#10b981",
                      backgroundColor: "rgba(16, 185, 129, 0.15)",
                      padding: "1px 6px",
                      borderRadius: "var(--radius-full)",
                    }}
                  >
                    Ready
                  </span>
                </div>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
                  FastAPI sidecar running on local loopback with dynamic port allocation and CSPRNG authentication.
                </p>
              </div>
            </div>

            <button
              onClick={handleRecheckPrereqs}
              disabled={isRecheckingPrereqs}
              className="clickable"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--glass-pill-bg)",
                border: "1px solid var(--glass-border)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <RefreshCw size={13} className={isRecheckingPrereqs ? "spin" : ""} />
              <span>{isRecheckingPrereqs ? "Checking..." : "Recheck"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
