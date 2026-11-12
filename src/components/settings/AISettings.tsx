import React from "react";
import { BatteryMedium, Users, Sliders } from "lucide-react";
import { AppSettings } from "../../hooks/useAppSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";

interface AISettingsProps {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

/**
 * AISettings Component
 *
 * Configures photo quality for enhancement, the battery guard, and offline face recognition.
 * Every imported photo is always enhanced (owner decision, C1), so there is no on/off toggle.
 */
export const AISettings: React.FC<AISettingsProps> = ({
  settings,
  updateSetting,
}) => {
  // Slider 12 (best) .. 28 (smallest); the engine maps it to photo quality
  // (12 -> 92, 18 -> 80, 28 -> 60). Applies to photos imported from now on.
  const getQualityTier = (level: number) => {
    if (level <= 15) {
      return {
        label: "Best quality",
        color: "var(--accent-primary)",
        desc: "Keeps the most fine detail. Uses the most space.",
      };
    }
    if (level <= 20) {
      return {
        label: "Balanced (Recommended)",
        color: "var(--accent-success)",
        desc: "Looks the same as the original in normal viewing.",
      };
    }
    if (level <= 24) {
      return {
        label: "Smaller files",
        color: "var(--accent-warning)",
        desc: "Saves more space. Very fine detail may soften when zoomed in.",
      };
    }
    return {
      label: "Smallest files",
      color: "var(--text-muted)",
      desc: "Saves the most space. Fine detail softens noticeably when zoomed in.",
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
          {/* Quality slider (every imported photo is always enhanced) */}
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
                    backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
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
                    Photo quality
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                    Applies to photos you import from now on.
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
                  Pauses photo enhancement while your PC runs on battery, and resumes when it's plugged in.
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
