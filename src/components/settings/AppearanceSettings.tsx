/**
 * Settings → Appearance (redesign R6): theme, photo size in the grid, and motion.
 */
import React from "react";
import { AppSettings } from "../../hooks/useAppSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { ChoicePills, SettingRow, SettingsGroup } from "./SettingsKit";

interface AppearanceSettingsProps {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({ settings, updateSetting }) => (
  <SettingsGroup>
    <SettingRow
      title="Theme"
      description={
        <>
          Press <kbd className="settings-kbd">T</kbd> anywhere to switch.
        </>
      }
    >
      <ChoicePills
        label="Theme"
        value={settings.theme}
        onChange={(value) => updateSetting("theme", value)}
        options={[
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
        ]}
      />
    </SettingRow>
    <SettingRow title="Photo size" description="How big photos are in Photos, the Vault and albums.">
      <ChoicePills
        label="Photo size"
        value={settings.grid_density}
        onChange={(value) => updateSetting("grid_density", value)}
        options={[
          { value: "compact", label: "Small" },
          { value: "comfortable", label: "Medium" },
          { value: "spacious", label: "Large" },
        ]}
      />
    </SettingRow>
    <SettingRow title="Reduce motion" description="Fewer animations and transitions.">
      <ToggleSwitch
        checked={settings.reduce_motion}
        onChange={(checked) => updateSetting("reduce_motion", checked)}
        ariaLabel="Reduce interface motion"
      />
    </SettingRow>
  </SettingsGroup>
);
