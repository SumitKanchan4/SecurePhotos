/**
 * Settings → Photos & AI (redesign R6): photo quality, the battery guard (pause below a charge level, A8), face recognition,
 * and story playback (formerly the separate "AI & 8K" and "Memories" sections).
 * Every imported photo is always enhanced (owner decision, C1), so there is no on/off switch.
 */
import React from "react";
import { AppSettings, OldPhotoRule } from "../../hooks/useAppSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { ChoicePills, SettingRow, SettingsGroup } from "./SettingsKit";

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

/** 0 = never pause; otherwise pause on battery below this charge (100 = whenever on battery). */
export const BATTERY_OPTIONS: { value: number; label: string }[] = [
  { value: 20, label: "Below 20%" },
  { value: 50, label: "Below 50%" },
  { value: 100, label: "Always" },
  { value: 0, label: "Never" },
];

/** The pill that matches the stored settings (an unusual stored level shows as the nearest choice). */
export function batteryChoice(settings: Pick<AppSettings, "pause_on_battery" | "battery_pause_below">): number {
  if (!settings.pause_on_battery) return 0;
  const below = settings.battery_pause_below ?? 20;
  if (below >= 100) return 100;
  return below > 35 ? 50 : 20;
}

type OldPhotoKey = "old_photos_colour" | "old_photos_fade" | "old_photos_faces" | "old_photos_scratches";

/** Settings → Old photos (H10, A1 board): plain words, a small before → after picture each. */
const OLD_PHOTO_ROWS: { key: OldPhotoKey; title: string; description: string; look: string }[] = [
  { key: "old_photos_colour", title: "Add colour to old grey photos", description: "Black-and-white and brownish old prints get natural colours.", look: "colour" },
  { key: "old_photos_fade", title: "Fix faded or yellowed colours", description: "Old colour prints get their colours back.", look: "fade" },
  { key: "old_photos_faces", title: "Sharpen blurry faces", description: "Faces look clearer, and still like the same person.", look: "faces" },
  { key: "old_photos_scratches", title: "Remove scratches and spots", description: "Creases, scratches and dust on old prints disappear.", look: "scratches" },
];

const RULE_OPTIONS: { value: OldPhotoRule; label: string }[] = [
  { value: "ask", label: "When I ask" },
  { value: "auto", label: "Automatically" },
];

/** A tiny before → after picture (pure CSS, no photo). */
const BeforeAfterChip: React.FC<{ look: string }> = ({ look }) => (
  <span className={`oldset-chip is-${look}`} aria-hidden="true">
    <span className="oldset-before" />
    <span className="oldset-arrow">→</span>
    <span className="oldset-after" />
  </span>
);

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
        <SettingRow
          title="Pause background work on battery"
          description="Enhancing and automatic fixes wait when the battery runs low, and carry on once it's charged or plugged in. Photos you improve yourself always run."
        >
          <ChoicePills
            label="Pause background work on battery"
            value={batteryChoice(settings)}
            onChange={(value) => {
              updateSetting("pause_on_battery", value !== 0);
              if (value !== 0) updateSetting("battery_pause_below", value);
            }}
            options={BATTERY_OPTIONS}
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

      <SettingsGroup
        title="Old photos"
        note='"Automatically" works on new scans of prints after import (not on photos taken with a phone or camera), in the background, and follows the battery choice above. Progress shows in Activity.'
      >
        <p className="settings-row-desc oldset-intro">Make old photos look better.</p>
        {OLD_PHOTO_ROWS.map((row) => (
          <SettingRow
            key={row.key}
            title={
              <span className="oldset-title">
                <BeforeAfterChip look={row.look} />
                {row.title}
              </span>
            }
            description={row.description}
          >
            <ChoicePills label={row.title} options={RULE_OPTIONS} value={settings[row.key]} onChange={(value) => updateSetting(row.key, value)} />
          </SettingRow>
        ))}
        <SettingRow
          title="Keep original"
          description="On: both are kept and linked; open either one and switch to the other. Off: the original goes to Trash once the improved photo is ready, and you can restore it for 30 days."
        >
          <ToggleSwitch
            checked={settings.old_photos_keep_original}
            onChange={(checked) => updateSetting("old_photos_keep_original", checked)}
            ariaLabel="Keep original"
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
