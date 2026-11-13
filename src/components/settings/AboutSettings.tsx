/**
 * Settings → About (redesign R6): version and updates, licence, and the photo engine's health.
 * The library location moved to Storage.
 */
import React, { useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/useAppStore";
import { UpdateModal } from "../UpdateModal";
import { SystemPrerequisites } from "../../types";
import { SettingRow, SettingsGroup } from "./SettingsKit";

const APP_VERSION = "0.1.0";

export const AboutSettings: React.FC = () => {
  const { prerequisites, setPrerequisites, showToast } = useAppStore();
  const [isChecking, setIsChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isRechecking, setIsRechecking] = useState(false);

  const checkForUpdates = async () => {
    setIsChecking(true);
    setUpdateStatus(null);
    try {
      const found = await check();
      if (found?.available) {
        setUpdate(found);
        setUpdateStatus(`Version ${found.version} is available.`);
        setIsUpdateModalOpen(true);
      } else {
        setUpdateStatus("You have the latest version.");
      }
    } catch {
      setUpdateStatus("Couldn't check for updates right now. Try again later.");
    } finally {
      setIsChecking(false);
    }
  };

  const recheckEngine = async () => {
    setIsRechecking(true);
    try {
      setPrerequisites(await invoke<SystemPrerequisites>("check_system_prerequisites"));
      showToast("Checked the photo engine.", "success");
    } catch {
      showToast("The photo engine couldn't be checked.", "warning");
    } finally {
      setIsRechecking(false);
    }
  };

  const running = Boolean(prerequisites?.backend.running);
  return (
    <>
      <SettingsGroup>
        <SettingRow title={`SecurePhotos ${APP_VERSION}`} description={updateStatus ?? "Updates are checked when the app starts."}>
          <div className="settings-inline">
            {update && (
              <button type="button" className="settings-btn settings-btn-primary" onClick={() => setIsUpdateModalOpen(true)}>
                Review update
              </button>
            )}
            <button type="button" className="settings-btn" onClick={checkForUpdates} disabled={isChecking}>
              {isChecking ? "Checking…" : "Check for updates"}
            </button>
          </div>
        </SettingRow>
        <SettingRow title="Licence" description="Free and open-source software. Your photos never leave this computer.">
          <span className="settings-value">MIT</span>
        </SettingRow>
        <SettingRow
          title={
            <>
              Photo engine <span className={`settings-badge${running ? "" : " is-warning"}`}>{running ? "Running" : "Not running"}</span>
            </>
          }
          description="The part of the app that imports, enhances and searches your photos. It runs only on this computer."
        >
          <button type="button" className="settings-btn" onClick={recheckEngine} disabled={isRechecking}>
            {isRechecking ? "Checking…" : "Check again"}
          </button>
        </SettingRow>
      </SettingsGroup>
      {update && <UpdateModal update={update} isOpen={isUpdateModalOpen} onClose={() => setIsUpdateModalOpen(false)} />}
    </>
  );
};
