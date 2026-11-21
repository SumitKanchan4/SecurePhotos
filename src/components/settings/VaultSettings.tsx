/**
 * Settings → Private Vault (redesign R6, approved board): auto-lock as pill choices, password,
 * quick PIN, the Emergency Card ("Print a new card") and, set apart, Erase the vault.
 */
import React, { useState } from "react";
import { AppSettings } from "../../hooks/useAppSettings";
import { VaultPasswordResetModal } from "../VaultPasswordResetModal";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch } from "../../services/api";
import { VaultFactoryReset } from "../vault/VaultFactoryReset";
import { EmergencyCardReplace } from "../vault/EmergencyCardReplace";
import { ChoicePills, SettingRow, SettingsGroup } from "./SettingsKit";
import { ToggleSwitch } from "../ui/ToggleSwitch";

interface VaultSettingsProps {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export const AUTO_LOCK_OPTIONS = [
  { value: 60, label: "1 min" },
  { value: 300, label: "5 min" },
  { value: 900, label: "15 min" },
  { value: 1800, label: "30 min" },
];

export const VaultSettings: React.FC<VaultSettingsProps> = ({ settings, updateSetting }) => {
  const { showToast, isVaultUnlocked, isVaultConfigured, hasVaultPin, checkVaultStatus } = useAppStore();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showCardDialog, setShowCardDialog] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [isSavingPin, setIsSavingPin] = useState(false);

  /** Sets/changes the quick PIN, or removes it when `pin` is null. Needs an unlocked vault. */
  const savePin = async (pin: string | null) => {
    setIsSavingPin(true);
    try {
      const res = await apiFetch("/api/vault/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.detail || "Your PIN couldn't be updated.", "warning");
        return;
      }
      setPinDraft("");
      await checkVaultStatus();
      showToast(pin ? "Quick PIN saved." : "Quick PIN removed.", "success");
    } finally {
      setIsSavingPin(false);
    }
  };

  const lockedNote = isVaultConfigured ? "Unlock your vault first." : "Set up your vault first.";

  return (
    <>
      <SettingsGroup note="Vault photos are decrypted only in memory while you look at them. Nothing unencrypted is written to disk.">
        <SettingRow title="Lock automatically after" description="When nothing happens in the vault for this long. Your PIN can reopen it until you close the app.">
          <ChoicePills
            label="Lock automatically after"
            value={settings.auto_lock_duration}
            onChange={(value) => updateSetting("auto_lock_duration", value)}
            options={AUTO_LOCK_OPTIONS}
          />
        </SettingRow>

        <SettingRow
          title="Remove the originals when adding to the vault"
          description={
            settings.vault_import_remove_originals
              ? "Photos you add to the vault are removed from where they were, once their locked copy has been checked, so no unprotected copy stays behind. You can change this for each import."
              : "Photos you add to the vault also stay where they were, where anyone using the computer can see them. You can change this for each import."
          }
        >
          <ToggleSwitch
            checked={settings.vault_import_remove_originals ?? true}
            onChange={(checked) => updateSetting("vault_import_remove_originals", checked)}
            ariaLabel="Remove the originals when adding to the vault"
          />
        </SettingRow>

        <SettingRow title="Password" description="Change it with your current password or your Emergency Card.">
          <button type="button" className="settings-btn" disabled={!isVaultConfigured} onClick={() => setShowPasswordModal(true)}>
            Change password
          </button>
        </SettingRow>

        <SettingRow
          title="Quick PIN"
          description={
            !isVaultUnlocked
              ? `Reopens the vault after a lock, until you close the app. ${lockedNote}`
              : hasVaultPin
              ? "Reopens the vault after a lock, until you close the app."
              : "Set a 4-digit PIN to reopen the vault quickly after it locks."
          }
        >
          {isVaultUnlocked && (
            <div className="settings-inline">
              <input
                type="password"
                inputMode="numeric"
                aria-label="New quick PIN"
                placeholder="4 digits"
                maxLength={4}
                className="settings-input settings-input-pin"
                value={pinDraft}
                onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
              <button type="button" className="settings-btn" disabled={pinDraft.length !== 4 || isSavingPin} onClick={() => savePin(pinDraft)}>
                {hasVaultPin ? "Change PIN" : "Set PIN"}
              </button>
              {hasVaultPin && (
                <button type="button" className="settings-btn settings-btn-quiet" disabled={isSavingPin} onClick={() => savePin(null)}>
                  Remove
                </button>
              )}
            </div>
          )}
        </SettingRow>

        <SettingRow
          title="Emergency Card"
          description={`Resets a forgotten password. Keep the printed card somewhere safe.${isVaultUnlocked ? "" : ` ${lockedNote}`}`}
        >
          <button type="button" className="settings-btn" disabled={!isVaultUnlocked} onClick={() => setShowCardDialog(true)}>
            Print a new card
          </button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Danger zone" danger>
        <VaultFactoryReset />
      </SettingsGroup>

      <VaultPasswordResetModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={() => {
          setShowPasswordModal(false);
          showToast("Password changed.", "success");
        }}
        initialMode="current"
      />
      {showCardDialog && <EmergencyCardReplace onClose={() => setShowCardDialog(false)} />}
    </>
  );
};
