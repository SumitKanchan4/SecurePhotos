import React from "react";
import { Sparkles, BatteryMedium, Users, Sliders } from "lucide-react";
import { AppSettings } from "../../hooks/useAppSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";

interface AISettingsProps {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

/**
 * AISettings Component
 *
 * Configures 8K ULTRA neural upscaling, compression profiles, battery awareness,
 * and offline face recognition.
 */
export const AISettings: React.FC<AISettingsProps> = ({
  settings,
  updateSetting,
}) => {
  const getQualityTier = (crf: number) => {
    if (crf <= 15) {
      return {
        label: "Studio Archival (~5.0 MB)",
        color: "var(--accent-primary)",
        desc: "Highest bit-depth fidelity. Visually identical to uncompressed camera originals.",
      };
    }
    if (crf <= 20) {
      return {
        label: "Ultra-Quality 8K (Recommended)",
        color: "var(--accent-success)",
        desc: "Human eye cannot discern quality differences at 100% zoom. Saves up to 60% disk space.",
      };
    }
    if (crf <= 24) {
      return {
        label: "High Efficiency (~1.5 MB)",
        color: "var(--accent-warning)",
        desc: "Compact storage profile tailored for very large collections exceeding 50,000 photos.",
      };
    }
    return {
      label: "Maximum Space Saver (~800 KB)",
      color: "var(--text-muted)",
      desc: "Aggressive lightweight compression when saving disk space is your top priority.",
    };
  };

  const activeTier = getQualityTier(settings.quality_crf);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* ── Section: 8K Neural Enhancement (Grouped Inset Card) ────────────── */}
      <div>
        <div style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Neural Enhancement & Compression
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            On-device super-resolution and next-generation storage optimization.
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
          {/* Row 1: 8K Space-Saver */}
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
                  backgroundColor: "rgba(245, 158, 11, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#f59e0b",
                  flexShrink: 0,
                }}
              >
                <Sparkles size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Enable 8K ULTRA Space-Saver
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Reconstructs photos to 8K Ultra HD while saving 50% to 70% storage with modern visual proxies.
                </p>
              </div>
            </div>

            <ToggleSwitch
              checked={settings.enable_space_saver}
              onChange={(checked) => updateSetting("enable_space_saver", checked)}
              ariaLabel="Enable 8K Space-Saver"
            />
          </div>

          {/* Row 2: Compression Quality Slider */}
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              borderBottom: "1px solid var(--glass-border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
                  <Sliders size={18} />
                </div>
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                    Visual Compression Profile
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                    Target quality tier: <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent-primary)" }}>CRF {settings.quality_crf}</span>
                  </p>
                </div>
              </div>

              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: activeTier.color,
                  padding: "3px 10px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-badge-bg)",
                  border: "1px solid var(--glass-badge-border)",
                }}
              >
                {activeTier.label}
              </span>
            </div>

            <div style={{ padding: "4px 8px 0 8px" }}>
              <input
                type="range"
                min={12}
                max={28}
                value={settings.quality_crf}
                onChange={(e) => updateSetting("quality_crf", Number(e.target.value))}
                style={{
                  width: "100%",
                  accentColor: "var(--accent-primary)",
                  cursor: "pointer",
                }}
              />
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "6px 0 0 0", lineHeight: 1.4 }}>
                {activeTier.desc}
              </p>
            </div>
          </div>

          {/* Row 3: Battery & Thermal Awareness */}
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
                  backgroundColor: "rgba(245, 158, 11, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-warning)",
                  flexShrink: 0,
                }}
              >
                <BatteryMedium size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Thermal & Battery Guard
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Automatically pauses heavy neural upscaling when running on battery to keep your PC cool.
                </p>
              </div>
            </div>

            <ToggleSwitch
              checked={settings.pause_on_battery}
              onChange={(checked) => updateSetting("pause_on_battery", checked)}
              ariaLabel="Thermal and battery guard"
            />
          </div>
        </div>
      </div>

      {/* ── Section: On-Device Vision & People ──────────────────────────────── */}
      <div>
        <div style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            On-Device Vision & People
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            Offline face clustering and family recognition without cloud scanning.
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
          {/* Row 1: Face Clustering */}
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
                <Users size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  People & Face Recognition
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Clusters similar faces locally so you can name a person once and identify them across thousands of photos.
                </p>
              </div>
            </div>

            <ToggleSwitch
              checked={settings.face_clustering}
              onChange={(checked) => updateSetting("face_clustering", checked)}
              ariaLabel="People and face recognition"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
