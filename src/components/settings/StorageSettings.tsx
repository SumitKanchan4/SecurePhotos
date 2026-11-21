/**
 * Settings → Storage (redesign R6; owner, 2026-11-21): where the library is, then two cards side
 * by side: the drive it's on (SecurePhotos, other files, free) and what SecurePhotos keeps.
 *
 * There is no "open another library" here any more: the app and its library live together on the
 * drive, so moving to another computer needs nothing, and a backup is restored by copying its
 * `data` folder back next to the app.
 */
import React, { useEffect, useState } from "react";
import { HardDrive, Images } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch } from "../../services/api";
import type { DashboardOverview, LibraryLocation } from "../../types";
import { StorageBreakdown } from "../dashboard/StorageBreakdown";
import { formatSize } from "../import/importFormat";
import { SettingRow, SettingsGroup } from "./SettingsKit";
import { driveKind, driveName, driveParts, percentLabel } from "./storageFormat";

export const StorageSettings: React.FC = () => {
  const [location, setLocation] = useState<LibraryLocation | null>(null);
  const [usage, setUsage] = useState<DashboardOverview | null>(null);

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

  const app = usage?.app_storage;
  const drive = usage?.drive_storage;
  const parts = driveParts(drive);
  return (
    <>
      <SettingsGroup
        note={
          <>
            Your photos, the vault and the app's own data are all kept in this folder, next to SecurePhotos. To restore a
            backup, copy its <code>data</code> folder into the SecurePhotos folder on your drive.
          </>
        }
      >
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
        />
      </SettingsGroup>

      <div className="storage-duo">
        <section className="storage-card" aria-labelledby="storage-drive-title">
          <header className="storage-card-head">
            <span className="storage-card-icon" aria-hidden="true">
              <HardDrive size={18} />
            </span>
            <div>
              <h3 id="storage-drive-title">{drive ? driveName(drive) : "Your drive"}</h3>
              <p>{drive ? driveKind(drive) : "Measuring…"}</p>
            </div>
          </header>
          {drive && parts.length > 0 && (
            <>
              <p className="storage-card-figure">
                {formatSize(drive.free_bytes)} <span>free of {formatSize(drive.total_bytes)}</span>
              </p>
              <div className="storage-drive-bar" aria-hidden="true">
                {parts.map((part) => (
                  <span key={part.key} className={`storage-drive-part is-${part.key}`} style={{ width: `${Math.max(part.percent, 0.8)}%` }} />
                ))}
              </div>
              <ul className="storage-drive-legend" aria-label="How the drive is used">
                {parts.map((part) => (
                  <li key={part.key}>
                    <span className={`storage-drive-swatch is-${part.key}`} aria-hidden="true" />
                    <span className="storage-drive-label">{part.label}</span>
                    <span className="storage-drive-share">{percentLabel(part.percent)}</span>
                    <span className="storage-drive-size">{formatSize(part.bytes)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="storage-card" aria-labelledby="storage-app-title">
          <header className="storage-card-head">
            <span className="storage-card-icon" aria-hidden="true">
              <Images size={18} />
            </span>
            <div>
              <h3 id="storage-app-title">SecurePhotos</h3>
              <p>{app ? "What it keeps on this drive" : "Measuring…"}</p>
            </div>
          </header>
          {app && (
            <>
              <p className="storage-card-figure">{formatSize(app.total_bytes)}</p>
              <StorageBreakdown
                stats={app}
                openable={["photos", "videos", "documents", "vault", "trash", "music"]}
                onOpen={(key) => {
                  const store = useAppStore.getState();
                  if (key === "music") store.openSettings("music");
                  else store.setActiveTab(key === "videos" ? "photos" : key === "documents" ? "documents" : key === "vault" ? "vault" : key === "trash" ? "trash" : "photos");
                }}
              />
            </>
          )}
        </section>
      </div>
    </>
  );
};
