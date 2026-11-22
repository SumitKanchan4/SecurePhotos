import { create } from "zustand";
import { VolumeInfo, SystemHealth, SystemPrerequisites } from "../types";

export type NavTab = 
  | "dashboard"
  | "photos" 
  | "albums" 
  | "people" 
  | "documents" 
  | "stories" 
  | "vault" 
  | "trash" 
  | "settings"
  | "search"
  | "activity";

/** A person or album to open directly when its section shows (search and viewer links, R9c). */
export type PendingOpen = { kind: "person" | "album"; id: number } | null;


interface AppState {
  theme: "dark" | "light";
  gridDensity: "compact" | "comfortable" | "spacious";
  activeTab: NavTab;
  /** What is typed on the Search page (R9c); kept while you look at other sections. */
  searchQuery: string;
  /** Bumped by openSearch so the Search page focuses its field again. */
  searchFocusKey: number;
  pendingOpen: PendingOpen;
  /** A month ("2026-08") Photos should scroll to once it shows (Dashboard › Your year, T32). */
  pendingMonth: string | null;
  /** A Settings section another screen asked to open (e.g. "music"). */
  settingsSection: string | null;
  selectedPhotoIds: Set<number>;
  activeVolume: VolumeInfo | null;
  isDriveConnected: boolean;
  /** H10 / A4: background work summary for the rail's status ring (null when idle). */
  activitySummary: { remaining: number; paused: boolean; headline: string | null } | null;
  systemHealth: SystemHealth | null;
  isVaultUnlocked: boolean;
  isVaultConfigured: boolean;
  vaultPasswordHint: string | null;
  hasVaultPin: boolean;
  isVaultPinLocked: boolean;
  prerequisites: SystemPrerequisites | null;
  totalPhotosCount: number;
  toast: { id: number; message: string; type: "info" | "success" | "warning" } | null;
  apiBaseUrl: string;
  apiToken: string | null;
  isEngineReady: boolean;
  
  // Actions
  setTheme: (theme: "dark" | "light") => void;
  toggleTheme: () => void;
  setGridDensity: (density: "compact" | "comfortable" | "spacious") => void;
  setActiveTab: (tab: NavTab) => void;
  setSearchQuery: (query: string) => void;
  /** Go to the Search page and focus its field (search icon, Ctrl+K, page search buttons). */
  openSearch: () => void;
  /** Open a person's page or an album directly. */
  openPerson: (id: number) => void;
  openAlbum: (id: number) => void;
  clearPendingOpen: () => void;
  openMonth: (key: string) => void;
  clearPendingMonth: () => void;
  openSettings: (section: string) => void;
  clearSettingsSection: () => void;
  togglePhotoSelection: (id: number) => void;
  clearSelection: () => void;
  setActiveVolume: (vol: VolumeInfo | null) => void;
  setIsDriveConnected: (connected: boolean) => void;
  setActivitySummary: (summary: { remaining: number; paused: boolean; headline: string | null } | null) => void;
  setSystemHealth: (health: SystemHealth | null) => void;
  setIsVaultUnlocked: (unlocked: boolean) => void;
  setIsVaultConfigured: (configured: boolean) => void;
  setVaultPasswordHint: (hint: string | null) => void;
  setHasVaultPin: (hasPin: boolean) => void;
  setIsVaultPinLocked: (isPinLocked: boolean) => void;
  checkVaultStatus: () => Promise<void>;
  setPrerequisites: (prerequisites: SystemPrerequisites | null) => void;
  setTotalPhotosCount: (count: number) => void;
  showToast: (message: string, type?: "info" | "success" | "warning") => void;
  hideToast: () => void;
  setEngineConfig: (baseUrl: string, token: string | null) => void;
  setIsEngineReady: (ready: boolean) => void;
}

// Read initial theme with localStorage bootstrap to prevent flash of wrong theme
const getInitialTheme = (): "dark" | "light" => {
  try {
    const saved = localStorage.getItem("securephotos_theme");
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // LocalStorage fallback
  }
  return "dark";
};

const initialTheme = getInitialTheme();
if (typeof document !== "undefined") {
  document.documentElement.setAttribute("data-theme", initialTheme);
}

// Background fire-and-forget sync to SQLite
const persistThemeToBackend = (theme: "dark" | "light") => {
  try {
    const { apiBaseUrl, apiToken } = useAppStore.getState();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiToken) {
      headers["X-SecurePhotos-Token"] = apiToken;
    }
    fetch(`${apiBaseUrl}/api/system/settings`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ settings: { theme } }),
      credentials: "include",
    }).catch(() => {});
  } catch {
    // Graceful silent fallback
  }
};

export const useAppStore = create<AppState>((set) => ({
  theme: initialTheme,
  gridDensity: "comfortable",
  activeTab: "photos",
  searchQuery: "",
  searchFocusKey: 0,
  pendingOpen: null,
  pendingMonth: null,
  settingsSection: null,
  selectedPhotoIds: new Set<number>(),
  activeVolume: null,
  isDriveConnected: true,
  activitySummary: null,
  systemHealth: null,
  isVaultUnlocked: false,
  isVaultConfigured: false,
  vaultPasswordHint: null,
  hasVaultPin: false,
  isVaultPinLocked: false,
  prerequisites: null,
  totalPhotosCount: 0,
  toast: null,
  apiBaseUrl: "http://127.0.0.1:8000",
  apiToken: null,
  isEngineReady: false,

  setEngineConfig: (apiBaseUrl, apiToken) => set({ apiBaseUrl, apiToken }),
  setIsEngineReady: (isEngineReady) => set({ isEngineReady }),

  setTheme: (theme) => {
    try {
      localStorage.setItem("securephotos_theme", theme);
    } catch {}
    document.documentElement.setAttribute("data-theme", theme);
    set({ theme });
    persistThemeToBackend(theme);
  },

  toggleTheme: () =>
    set((state) => {
      const nextTheme = state.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("securephotos_theme", nextTheme);
      } catch {}
      document.documentElement.setAttribute("data-theme", nextTheme);
      persistThemeToBackend(nextTheme);
      return { theme: nextTheme };
    }),

  setGridDensity: (gridDensity) => set({ gridDensity }),

  setActiveTab: (activeTab) => set({ activeTab }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  openSearch: () => set((state) => ({ activeTab: "search", searchFocusKey: state.searchFocusKey + 1 })),
  openPerson: (id) => set({ activeTab: "people", pendingOpen: { kind: "person", id } }),
  openAlbum: (id) => set({ activeTab: "albums", pendingOpen: { kind: "album", id } }),
  clearPendingOpen: () => set({ pendingOpen: null }),
  openMonth: (key) => set({ activeTab: "photos", pendingMonth: key }),
  clearPendingMonth: () => set({ pendingMonth: null }),
  openSettings: (section) => set({ activeTab: "settings", settingsSection: section }),
  clearSettingsSection: () => set({ settingsSection: null }),

  togglePhotoSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedPhotoIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedPhotoIds: next };
    }),

  // No-op when nothing is selected, so Escape doesn't re-render the whole app for nothing.
  clearSelection: () => set((state) => (state.selectedPhotoIds.size === 0 ? state : { selectedPhotoIds: new Set<number>() })),
  setActiveVolume: (activeVolume) => set({ activeVolume }),
  setIsDriveConnected: (isDriveConnected) => set({ isDriveConnected }),
  setActivitySummary: (activitySummary) => set({ activitySummary }),
  setSystemHealth: (systemHealth) => set({ systemHealth }),
  setIsVaultUnlocked: (isVaultUnlocked) => set({ isVaultUnlocked }),
  setIsVaultConfigured: (isVaultConfigured) => set({ isVaultConfigured }),
  setVaultPasswordHint: (vaultPasswordHint) => set({ vaultPasswordHint }),
  setHasVaultPin: (hasVaultPin) => set({ hasVaultPin }),
  setIsVaultPinLocked: (isVaultPinLocked) => set({ isVaultPinLocked }),
  checkVaultStatus: async () => {
    try {
      const { apiBaseUrl, apiToken } = useAppStore.getState();
      const headers: Record<string, string> = {};
      if (apiToken) {
        headers["X-SecurePhotos-Token"] = apiToken;
      }
      const res = await fetch(`${apiBaseUrl}/api/vault/status`, {
        headers,
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        set({
          isVaultConfigured: Boolean(data.is_configured),
          isVaultUnlocked: Boolean(data.is_unlocked),
          vaultPasswordHint: data.password_hint || null,
          hasVaultPin: Boolean(data.has_pin),
          isVaultPinLocked: Boolean(data.is_pin_locked),
        });
      }
    } catch (err) {
      console.error("Failed to check vault status:", err);
    }
  },
  setPrerequisites: (prerequisites) => set({ prerequisites }),
  setTotalPhotosCount: (totalPhotosCount) => set({ totalPhotosCount }),
  showToast: (message, type = "info") => {
    const toastId = Date.now();
    set({ toast: { id: toastId, message, type } });
    setTimeout(() => {
      set((state) => (state.toast?.id === toastId ? { toast: null } : state));
    }, 4000);
  },
  hideToast: () => set({ toast: null }),
}));
