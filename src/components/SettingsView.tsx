/**
 * Settings (redesign R6): sections on the left (Appearance, Photos & AI, Music, Private Vault,
 * Storage, About), plain rows on the right. Settings are stored in the library's database,
 * so they travel with the drive.
 */
import React, { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useAppSettings } from "../hooks/useAppSettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { PhotosAISettings } from "./settings/PhotosAISettings";
import { VaultSettings } from "./settings/VaultSettings";
import { StorageSettings } from "./settings/StorageSettings";
import { ComputersSettings } from "./settings/ComputersSettings";
import { AboutSettings } from "./settings/AboutSettings";
import { MusicSettings } from "./settings/MusicSettings";

export type SettingsSection = "appearance" | "photos" | "music" | "vault" | "storage" | "about";

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "photos", label: "Photos & AI" },
  { id: "music", label: "Music" },
  { id: "vault", label: "Private Vault" },
  { id: "storage", label: "Storage" },
  { id: "about", label: "About" },
];

export const SettingsView: React.FC<{ initialSection?: SettingsSection }> = ({ initialSection = "appearance" }) => {
  const { settings, updateSetting } = useAppSettings();
  // Another screen can open a section directly (Stories' music button opens Music).
  const requested = useAppStore((s) => s.settingsSection) as SettingsSection | null;
  const [section, setSection] = useState<SettingsSection>(requested ?? initialSection);
  useEffect(() => {
    if (!requested) return;
    setSection(requested);
    useAppStore.getState().clearSettingsSection();
  }, [requested]);
  const current = SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Settings sections">
        <h1 className="settings-title">Settings</h1>
        {SETTINGS_SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-nav-btn${item.id === section ? " is-active" : ""}`}
            aria-current={item.id === section ? "page" : undefined}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        <div className="settings-inner">
          <h2 className="settings-section-title">{current.label}</h2>
          {section === "appearance" && <AppearanceSettings settings={settings} updateSetting={updateSetting} />}
          {section === "photos" && <PhotosAISettings settings={settings} updateSetting={updateSetting} />}
          {section === "music" && <MusicSettings settings={settings} updateSetting={updateSetting} />}
          {section === "vault" && <VaultSettings settings={settings} updateSetting={updateSetting} />}
          {section === "storage" && (
            <>
              <StorageSettings />
              <ComputersSettings />
            </>
          )}
          {section === "about" && <AboutSettings />}
        </div>
      </div>
    </div>
  );
};
