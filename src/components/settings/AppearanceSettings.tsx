import React from "react";
import { Moon, Sun, Sparkles, LayoutGrid } from "lucide-react";
import { AppSettings } from "../../hooks/useAppSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SegmentedPill } from "../ui/SegmentedPill";

interface AppearanceSettingsProps {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

/**
 * AppearanceSettings Component
 *
 * Configures theme palette, grid density, and interface animations.
 */
export const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({
  settings,
  updateSetting,
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* ── Section: Theme Palette ────────────────────────────────────────── */}
      <div>
        <div style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Theme Palette
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            Choose your preferred desktop visual mood. Press <kbd style={{ padding: "1px 5px", borderRadius: "4px", backgroundColor: "var(--glass-badge-bg)", border: "1px solid var(--glass-badge-border)", fontSize: "10px", fontFamily: "var(--font-mono)" }}>T</kbd> anywhere to switch instantly.
          </p>
        </div>

        {/* Visual Theme Cards */}
        <div 
          style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", 
            gap: "14px" 
          }}
        >
          {/* Card A: Dark Obsidian */}
          <div
            onClick={() => updateSetting("theme", "dark")}
            className="clickable"
            style={{
              padding: "16px 18px",
              borderRadius: "var(--radius-xl)",
              backgroundColor: settings.theme === "dark" ? "color-mix(in srgb, var(--accent-ink) 12%, transparent)" : "var(--glass-surface)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: settings.theme === "dark" ? "2px solid var(--accent-primary)" : "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px",
              transition: "all 0.18s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div 
                style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "#0f172a",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fbbf24",
                  flexShrink: 0,
                }}
              >
                <Moon size={18} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                    Dark Obsidian
                  </span>
                  {settings.theme === "dark" && (
                    <span 
                      style={{ 
                        fontSize: "10px", 
                        fontWeight: 700, 
                        color: "var(--accent-primary)", 
                        backgroundColor: "color-mix(in srgb, var(--accent-ink) 15%, transparent)", 
                        padding: "1px 6px", 
                        borderRadius: "var(--radius-full)" 
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
                  Deep obsidian black with frosted liquid-glass accents
                </p>
              </div>
            </div>
            <div 
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "var(--radius-full)",
                border: settings.theme === "dark" ? "5px solid var(--accent-primary)" : "2px solid var(--glass-border)",
                backgroundColor: settings.theme === "dark" ? "#ffffff" : "transparent",
                transition: "all 0.15s ease",
                flexShrink: 0,
              }}
            />
          </div>

          {/* Card B: Light Titanium */}
          <div
            onClick={() => updateSetting("theme", "light")}
            className="clickable"
            style={{
              padding: "16px 18px",
              borderRadius: "var(--radius-xl)",
              backgroundColor: settings.theme === "light" ? "color-mix(in srgb, var(--accent-ink) 12%, transparent)" : "var(--glass-surface)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: settings.theme === "light" ? "2px solid var(--accent-primary)" : "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px",
              transition: "all 0.18s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div 
                style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "#f8fafc",
                  border: "1px solid rgba(0, 0, 0, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-ink)",
                  flexShrink: 0,
                }}
              >
                <Sun size={18} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                    Light Titanium
                  </span>
                  {settings.theme === "light" && (
                    <span 
                      style={{ 
                        fontSize: "10px", 
                        fontWeight: 700, 
                        color: "var(--accent-primary)", 
                        backgroundColor: "color-mix(in srgb, var(--accent-ink) 15%, transparent)", 
                        padding: "1px 6px", 
                        borderRadius: "var(--radius-full)" 
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
                  Clean daylight slate with soft frosted translucent surfaces
                </p>
              </div>
            </div>
            <div 
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "var(--radius-full)",
                border: settings.theme === "light" ? "5px solid var(--accent-primary)" : "2px solid var(--glass-border)",
                backgroundColor: settings.theme === "light" ? "#ffffff" : "transparent",
                transition: "all 0.15s ease",
                flexShrink: 0,
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Section: Display & Layout (Grouped Inset Card) ────────────────── */}
      <div>
        <div style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
            Display & Layout
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "2px 0 0 0" }}>
            Customize photo grid density and interface motion.
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
          {/* Row 1: Grid Density */}
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
                <LayoutGrid size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Photo Grid Density
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Adjust thumbnail size and item spacing across your photo library.
                </p>
              </div>
            </div>

            <SegmentedPill<AppSettings["grid_density"]>
              value={settings.grid_density}
              onChange={(val) => updateSetting("grid_density", val)}
              options={[
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
                { value: "spacious", label: "Spacious" },
              ]}
            />
          </div>

          {/* Row 2: Reduce Motion */}
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
                  backgroundColor: "rgba(168, 85, 247, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#a855f7",
                  flexShrink: 0,
                }}
              >
                <Sparkles size={18} />
              </div>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--text-primary)" }}>
                  Reduce Interface Motion
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  Minimizes transitions and micro-animations for high responsiveness on battery or older devices.
                </p>
              </div>
            </div>

            <ToggleSwitch
              checked={settings.reduce_motion}
              onChange={(checked) => updateSetting("reduce_motion", checked)}
              ariaLabel="Reduce interface motion"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
