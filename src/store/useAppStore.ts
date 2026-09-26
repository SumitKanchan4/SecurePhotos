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
  | "settings";


interface AppState {
  theme: "dark" | "light";
  activeTab: NavTab;
  searchQuery: string;
  selectedPhotoIds: Set<number>;
  activeVolume: VolumeInfo | null;
  isDriveConnected: boolean;
  systemHealth: SystemHealth | null;
  isVaultUnlocked: boolean;
  isVaultConfigured: boolean;
  vaultPasswordHint: string | null;
  hasVaultTotp: boolean;
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
  setActiveTab: (tab: NavTab) => void;
  setSearchQuery: (query: string) => void;
  togglePhotoSelection: (id: number) => void;
  clearSelection: () => void;
  setActiveVolume: (vol: VolumeInfo | null) => void;
  setIsDriveConnected: (connected: boolean) => void;
  setSystemHealth: (health: SystemHealth | null) => void;
  setIsVaultUnlocked: (unlocked: boolean) => void;
  setIsVaultConfigured: (configured: boolean) => void;
  setVaultPasswordHint: (hint: string | null) => void;
  setHasVaultTotp: (hasTotp: boolean) => void;
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

export const useAppStore = create<AppState>((set) => ({
  theme: "dark",
  activeTab: "photos",
  searchQuery: "",
  selectedPhotoIds: new Set<number>(),
  activeVolume: null,
  isDriveConnected: true,
  systemHealth: null,
  isVaultUnlocked: false,
  isVaultConfigured: false,
  vaultPasswordHint: null,
  hasVaultTotp: false,
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
    document.documentElement.setAttribute("data-theme", theme);
    set({ theme });
  },

  toggleTheme: () =>
    set((state) => {
      const nextTheme = state.theme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", nextTheme);
      return { theme: nextTheme };
    }),

  setActiveTab: (activeTab) => set({ activeTab }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

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

  clearSelection: () => set({ selectedPhotoIds: new Set<number>() }),
  setActiveVolume: (activeVolume) => set({ activeVolume }),
  setIsDriveConnected: (isDriveConnected) => set({ isDriveConnected }),
  setSystemHealth: (systemHealth) => set({ systemHealth }),
  setIsVaultUnlocked: (isVaultUnlocked) => set({ isVaultUnlocked }),
  setIsVaultConfigured: (isVaultConfigured) => set({ isVaultConfigured }),
  setVaultPasswordHint: (vaultPasswordHint) => set({ vaultPasswordHint }),
  setHasVaultTotp: (hasVaultTotp) => set({ hasVaultTotp }),
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
          hasVaultTotp: Boolean(data.has_totp),
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
