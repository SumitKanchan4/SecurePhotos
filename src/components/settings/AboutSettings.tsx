/**
 * Settings → About (redesign R6): version and updates, licence, and the photo engine's health.
 * The library location moved to Storage.
 */
import React, { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { fetchHardware, type Hardware } from "../../services/computers";
import { useAppStore } from "../../store/useAppStore";
import { UpdateModal } from "../UpdateModal";
import { SystemPrerequisites } from "../../types";
import { SettingRow, SettingsGroup } from "./SettingsKit";

/** The version shown when the app can't tell (a browser preview). It was always this, by mistake. */
const UNKNOWN_VERSION = "";

/** T31: the graphics card line, in plain words. */
export function graphicsAbout(hw: Hardware | null): string {
  if (!hw) return "Checking…";
  if (!hw.gpu) return "None SecurePhotos can use here; photos are improved on the processor.";
  const driver = hw.gpu.driver ? ` · driver ${hw.gpu.driver}` : "";
  const used = hw.jobs.filter((j) => j.device !== "cpu").length;
  const state = !hw.use_graphics ? "turned off" : hw.needs_test ? "not tested yet" : used ? `used for ${used} kind${used === 1 ? "" : "s"} of work` : "not faster than the processor here";
  return `${hw.gpu.name}${driver} · ${state}`;
}

export const AboutSettings: React.FC = () => {
  const { prerequisites, setPrerequisites, showToast } = useAppStore();
  const [isChecking, setIsChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isRechecking, setIsRechecking] = useState(false);
  // The real version (it showed a fixed "0.1.0" before 0.3.2), and this computer's graphics card.
  const [version, setVersion] = useState(UNKNOWN_VERSION);
  const [hw, setHw] = useState<Hardware | null>(null);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => undefined);
    fetchHardware()
      .then((got) => got?.test && setHw(got))
      .catch(() => undefined);
  }, []);

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
        <SettingRow title={version ? `SecurePhotos ${version}` : "SecurePhotos"} description={updateStatus ?? "Updates are checked when the app starts."}>
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
        <SettingRow title="Graphics card" description={graphicsAbout(hw)}>
          <span className="settings-value">{hw?.gpu && hw.use_graphics && !hw.needs_test ? "In use" : ""}</span>
        </SettingRow>
      </SettingsGroup>
      {update && <UpdateModal update={update} isOpen={isUpdateModalOpen} onClose={() => setIsUpdateModalOpen(false)} />}
    </>
  );
};
