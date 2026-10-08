import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../services/api";
import { useAppStore } from "../store/useAppStore";

export interface AppSettings {
  theme: "dark" | "light";
  grid_density: "compact" | "comfortable" | "spacious";
  reduce_motion: boolean;
  auto_lock_duration: number;
  enable_space_saver: boolean;
  quality_crf: number;
  pause_on_battery: boolean;
  face_clustering: boolean;
  ambient_music: boolean;
  ken_burns_motion: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  grid_density: "comfortable",
  reduce_motion: false,
  auto_lock_duration: 300,
  enable_space_saver: true,
  quality_crf: 18,
  pause_on_battery: true,
  face_clustering: true,
  ambient_music: true,
  ken_burns_motion: true,
};

/**
 * Custom hook to synchronize user settings with the SQLite database via FastAPI.
 * Storing settings in SQLite ensures they persist across external drives and different machines.
 */
export function useAppSettings() {
  const { theme, setTheme, setGridDensity, showToast } = useAppStore();
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    theme: theme || "dark",
  }));
  const [isLoading, setIsLoading] = useState(true);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await apiFetch("/api/system/settings");
      if (res.ok) {
        const data = await res.json();
        if (data?.settings) {
          const merged: AppSettings = {
            ...DEFAULT_SETTINGS,
            ...data.settings,
          };
          setSettings(merged);
          if (merged.theme) {
            setTheme(merged.theme);
          }
          if (merged.grid_density) {
            setGridDensity(merged.grid_density);
          }
          if (merged.reduce_motion !== undefined) {
            document.documentElement.setAttribute("data-reduce-motion", String(merged.reduce_motion));
          }
        }
      }
    } catch (err) {
      console.warn("Could not load settings from database:", err);
    } finally {
      setIsLoading(false);
    }
  }, [setTheme, setGridDensity]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Keep local settings in sync if store theme toggles externally (e.g. shortcut 'T', TitleBar)
  useEffect(() => {
    if (theme && theme !== settings.theme) {
      setSettings((prev) => ({ ...prev, theme }));
    }
  }, [theme, settings.theme]);

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      // 1. Optimistic UI update
      setSettings((prev) => ({ ...prev, [key]: value }));

      // Special handling for theme, grid density, and motion
      if (key === "theme") {
        setTheme(value as "dark" | "light");
      }
      if (key === "grid_density") {
        setGridDensity(value as "compact" | "comfortable" | "spacious");
      }
      if (key === "reduce_motion") {
        document.documentElement.setAttribute("data-reduce-motion", String(value));
      }

      // 2. Persist to SQLite in background (debounced only for continuous sliders)
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      const savePayload = async () => {
        try {
          const res = await apiFetch("/api/system/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settings: { [key]: value } }),
          });
          if (!res.ok) {
            throw new Error(`Failed to save setting: ${res.statusText}`);
          }
        } catch (err) {
          console.error(`Error saving setting ${String(key)}:`, err);
          showToast?.(`Could not save setting to drive`, "warning");
        }
      };

      if (key === "quality_crf") {
        debounceTimerRef.current = setTimeout(savePayload, 300);
      } else {
        // Immediate persistence for discrete clicks (theme, toggles, pills)
        savePayload();
      }
    },
    [setTheme, setGridDensity, showToast]
  );

  return {
    settings,
    updateSetting,
    isLoading,
    reloadSettings: fetchSettings,
  };
}
