/**
 * Settings → Storage (redesign R6): where the library lives (moved here from About) and how
 * much space it uses on its drive.
 */
import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch } from "../../services/api";
import type { DashboardOverview, LibraryLocation } from "../../types";
import { StorageBreakdown } from "../dashboard/StorageBreakdown";
import { formatSize } from "../import/importFormat";
import { SettingRow, SettingsGroup } from "./SettingsKit";


export const StorageSettings: React.FC = () => {
  const showToast = useAppStore((s) => s.showToast);
  const [location, setLocation] = useState<LibraryLocation | null>(null);
  const [usage, setUsage] = useState<DashboardOverview | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    // The engine knows which folder it really uses; the window program can only guess (in a
    // development build it looks next to its own .exe and finds nothing).
    apiFetch("/api/system/library")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: LibraryLocation) => setLocation(data))
      .catch(() => invoke<LibraryLocation>("get_library_location").then(setLocation).catch(() => setLocation(null)));
    apiFetch("/api/system/dashboard")
      .then((res) => (res.ok ? res.json() : null))
      .then(setUsage)
      .catch(() => {});
  }, []);

  const switchLibrary = async () => {
    setSwitching(true);
    try {
      const selected = await invoke<string | null>("select_import_folder");
      if (!selected) return;
      await invoke("reconnect_library", { newPath: selected });
      showToast("Library switched. Restarting…", "success");
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      const message = typeof err === "string" ? err : (err as Error)?.message;
      showToast(message || "The library couldn't be switched.", "warning");
    } finally {
      setSwitching(false);
    }
  };

  const app = usage?.app_storage;
  const drive = usage?.drive_storage;
  return (
    <SettingsGroup note="Everything (photos, the vault and the app's data) stays in this one folder, so the library can move with its drive.">
      <SettingRow
        title={
          <>
            Library folder{" "}
            <span className={`settings-badge${location && !location.has_database ? " is-warning" : ""}`}>
              {location ? (location.has_database ? "Connected" : "No library found here") : "Checking…"}
            </span>
          </>
        }
        description={<span className="settings-path">{location?.path ?? "Finding your library…"}</span>}
      >
      </SettingRow>
      {/* Owner feedback (round 1, #1; 2026-11-21): only for restoring a backup. A new computer
          needs nothing, since the app and its library travel together on the drive. One library is
          open at a time (it is locked against a second app), so this replaces the open one. */}
      <SettingRow
        title="Restoring a backup?"
        description="Open the library folder you restored. The library open now stays as it is; the app restarts with the one you choose."
      >
        <button type="button" className="settings-btn" onClick={switchLibrary} disabled={switching}>
          {switching ? "Choosing…" : "Open a library folder…"}
        </button>
      </SettingRow>
      <SettingRow title="Space used" description={app ? "What SecurePhotos keeps in this folder." : "Measuring…"}>
        {app && <span className="settings-value">{formatSize(app.total_bytes)}</span>}
      </SettingRow>
      {app && (
        <div className="settings-usage">
          <StorageBreakdown
            stats={app}
            openable={["photos", "videos", "documents", "vault", "trash", "music"]}
            onOpen={(key) => {
              const store = useAppStore.getState();
              if (key === "music") store.openSettings("music");
              else store.setActiveTab(key === "videos" ? "photos" : key === "documents" ? "documents" : key === "vault" ? "vault" : key === "trash" ? "trash" : "photos");
            }}
          />
        </div>
      )}
      {drive && drive.total_bytes > 0 && (
        <SettingRow title={`Free on ${drive.volume_name || drive.drive_letter}`} description={`of ${formatSize(drive.total_bytes)} on this drive`}>
          <span className="settings-value">{formatSize(drive.free_bytes)}</span>
        </SettingRow>
      )}
    </SettingsGroup>
  );
};
