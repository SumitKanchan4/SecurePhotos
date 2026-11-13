/**
 * Settings → Photos & AI (redesign R6): photo quality, the battery guard, face recognition,
 * and story playback (formerly the separate "AI & 8K" and "Memories" sections).
 * Every imported photo is always enhanced (owner decision, C1), so there is no on/off switch.
 */
import React from "react";
import { AppSettings } from "../../hooks/useAppSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SettingRow, SettingsGroup } from "./SettingsKit";

interface PhotosAISettingsProps {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

/** Slider 12 (best) .. 28 (smallest); the engine maps it to photo quality (12 -> 92, 18 -> 80, 28 -> 60). */
export function qualityTier(level: number): { label: string; description: string } {
  if (level <= 15) return { label: "Best quality", description: "Keeps the most fine detail. Uses the most space." };
  if (level <= 20) return { label: "Balanced (Recommended)", description: "Looks the same as the original in normal viewing." };
  if (level <= 24) return { label: "Smaller files", description: "Saves more space. Very fine detail may soften when zoomed in." };
  return { label: "Smallest files", description: "Saves the most space. Fine detail softens noticeably when zoomed in." };
}

export const PhotosAISettings: React.FC<PhotosAISettingsProps> = ({ settings, updateSetting }) => {
  const tier = qualityTier(settings.quality_crf);
  return (
    <>
      <SettingsGroup title="Photos">
        <SettingRow
          title={
            <>
              Photo quality <span className="settings-badge">{tier.label}</span>
            </>
          }
          description={`${tier.description} Applies to photos you import from now on.`}
          stacked
        >
          <input
            type="range"
            min={12}
            max={28}
            value={settings.quality_crf}
            aria-label="Photo quality"
            className="settings-range"
            onChange={(e) => updateSetting("quality_crf", Number(e.target.value))}
          />
          <div className="settings-range-ends" aria-hidden="true">
            <span>Best quality</span>
            <span>Smallest files</span>
          </div>
        </SettingRow>
        <SettingRow title="Pause enhancing on battery" description="Resumes when your computer is plugged in.">
          <ToggleSwitch
            checked={settings.pause_on_battery}
            onChange={(checked) => updateSetting("pause_on_battery", checked)}
            ariaLabel="Thermal and battery guard"
          />
        </SettingRow>
        <SettingRow title="Recognise faces" description="Groups faces on this computer so you can name a person once.">
          <ToggleSwitch
            checked={settings.face_clustering}
            onChange={(checked) => updateSetting("face_clustering", checked)}
            ariaLabel="People and face recognition"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Stories">
        <SettingRow title="Background music" description="Plays music during story slideshows.">
          <ToggleSwitch
            checked={settings.ambient_music}
            onChange={(checked) => updateSetting("ambient_music", checked)}
            ariaLabel="Ambient story soundtracks"
          />
        </SettingRow>
        <SettingRow title="Slow pan and zoom" description="Gently moves still photos during stories.">
          <ToggleSwitch
            checked={settings.ken_burns_motion}
            onChange={(checked) => updateSetting("ken_burns_motion", checked)}
            ariaLabel="Cinematic camera motion"
          />
        </SettingRow>
        <SettingRow title="Highlight stories" description='"On this day" and "Through the years" stories appear on their own.'>
          <span className="settings-value">Always on</span>
        </SettingRow>
      </SettingsGroup>
    </>
  );
};
