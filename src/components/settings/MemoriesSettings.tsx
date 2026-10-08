import React from "react";
import { Music, Compass, Sparkles } from "lucide-react";
import { AppSettings } from "../../hooks/useAppSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";

interface MemoriesSettingsProps {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

/**
 * MemoriesSettings Component
 *
 * Configures automatic story generation, ambient music, and Ken-Burns playback.
 */
export const MemoriesSettings: React.FC<MemoriesSettingsProps> = ({
  settings,
  updateSetting,
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* ── Section: Creative Stories & Playback (Grouped Inset Card) ─────── */}
      <div>
        <div style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Memories & Story Playback
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            Customize automatic nostalgia stories and cinematic slideshow playback.
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
          {/* Row 1: Ambient Music */}
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
                  backgroundColor: "rgba(236, 72, 153, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ec4899",
                  flexShrink: 0,
                }}
              >
                <Music size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Ambient Story Soundtracks
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Plays mood-matched background music synchronized to cuts during story playback.
                </p>
              </div>
            </div>

            <ToggleSwitch
              checked={settings.ambient_music}
              onChange={(checked) => updateSetting("ambient_music", checked)}
              ariaLabel="Ambient story soundtracks"
            />
          </div>

          {/* Row 2: Ken-Burns Camera Motion */}
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
                <Compass size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Cinematic Camera Motion (Ken-Burns)
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Applies gentle slow panning and zoom transitions to bring still photos to life in stories.
                </p>
              </div>
            </div>

            <ToggleSwitch
              checked={settings.ken_burns_motion}
              onChange={(checked) => updateSetting("ken_burns_motion", checked)}
              ariaLabel="Cinematic camera motion"
            />
          </div>

          {/* Row 3: Curated Milestones & Highlights */}
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
                  color: "#f59e0b",
                  flexShrink: 0,
                }}
              >
                <Sparkles size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Automatic Highlight Stories
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Surfaces "On This Day" and "Through the Years" albums when notable anniversaries occur.
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
              Enabled
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
