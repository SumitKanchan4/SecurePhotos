import { create } from "zustand";
import { VolumeInfo, SystemHealth } from "../types";

export type NavTab = 
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
}));
