import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  Lock, 
  Plus, 
  LayoutGrid,
  Loader2,
  Trash2,
  FolderPlus,
  Download,
  X,
  CheckSquare,
  Search,
} from "lucide-react";
import { SearchPalette } from "./components/shell/SearchPalette";
import { WindowStrip } from "./components/shell/WindowStrip";
import { IconRail } from "./components/shell/IconRail";
import { PrerequisitesBanner } from "./components/PrerequisitesBanner";
import { PhotoTimeline } from "./components/photos/PhotoTimeline";
import { EmptyLibraryState } from "./components/EmptyLibraryState";
import { DriveStatusBanner } from "./components/DriveStatusBanner";
import { ImportModal } from "./components/ImportModal";
import { Lightbox } from "./components/Lightbox";
import { VaultUnlockModal } from "./components/VaultUnlockModal";
import { VaultView } from "./components/VaultView";
import { StoriesCarousel } from "./components/StoriesCarousel";
import { StoryPlayerModal } from "./components/StoryPlayerModal";
import { DashboardView } from "./components/DashboardView";
import { StoriesView } from "./components/StoriesView";
import { PeopleView } from "./components/PeopleView";
import { AlbumsView } from "./components/AlbumsView";
import { DocumentsView } from "./components/DocumentsView";
import { TrashView } from "./components/TrashView";
import { SettingsView } from "./components/SettingsView";
import { CollageModal } from "./components/CollageModal";
import { AddToAlbumModal } from "./components/AddToAlbumModal";
import { UpdateModal } from "./components/UpdateModal";
import { ToastNotification } from "./components/ToastNotification";
import { useAppStore } from "./store/useAppStore";
import { PhotoItem, SystemPrerequisites, OptimizationProgress, VideoOptimizationProgress, SearchResponse, ImportProgressState, TimelinePhoto, TimelineResponse } from "./types";
import { parseTimeline, viewerWindow } from "./utils/photoTimeline";
import { invoke } from "@tauri-apps/api/core";
import { check, Update } from "@tauri-apps/plugin-updater";
import { apiFetch, getApiUrl, performHandshake } from "./services/api";

export const App: React.FC = () => {
  const { 
    activeTab, 
    setActiveTab,
    toggleTheme, 
    setTheme,
    setGridDensity,
    searchQuery,
    setSearchQuery,
    setSearchOpen,
    selectedPhotoIds, 
    clearSelection,
    setActiveVolume,
    isVaultUnlocked,
    setIsVaultUnlocked,
    isVaultConfigured,
    prerequisites,
    setPrerequisites,
    setTotalPhotosCount,
    showToast,
    checkVaultStatus,
    setEngineConfig,
    setIsEngineReady,
  } = useAppStore();

  // Whole library as compact rows (redesign R2); full details load when a photo is opened.
  const [photos, setPhotos] = useState<TimelinePhoto[]>([]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isVaultUnlockModalOpen, setIsVaultUnlockModalOpen] = useState(false);
  const [pendingVaultAction, setPendingVaultAction] = useState<{
    type: "batch_photos" | "album" | "custom";
    albumId?: number;
    isVaultAlbum?: boolean;
    callback?: () => void;
  } | null>(null);
  const [isCollageModalOpen, setIsCollageModalOpen] = useState(false);
  const [isAddToAlbumModalOpen, setIsAddToAlbumModalOpen] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxPhotos, setLightboxPhotos] = useState<PhotoItem[] | null>(null);
  // Set while the viewer shows a window of the Photos timeline: index of the window's first photo.
  const [viewerWindowStart, setViewerWindowStart] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<TimelinePhoto[] | null>(null);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState<OptimizationProgress | null>(null);
  const [videoProgress, setVideoProgress] = useState<VideoOptimizationProgress | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const hasRegeneratedThumbnailsRef = useRef(false);
  // Load the whole library (not vault, not trash) as compact timeline rows.
  const loadPhotos = async () => {
    try {
      const res = await apiFetch("/api/photos/timeline");
      if (res.ok) {
        const data: TimelineResponse = await res.json();
        const items = parseTimeline(data);
        setPhotos(items);
        setTotalPhotosCount(items.length);

        // Auto-trigger background 512px Retina thumbnail regeneration once on load
        if (!hasRegeneratedThumbnailsRef.current && items.length > 0) {
          hasRegeneratedThumbnailsRef.current = true;
          apiFetch("/api/photos/regenerate-thumbnails", { method: "POST" }).catch(() => {});
        }

        // Auto-trigger background 8K optimization queue ONLY for photos (not videos)
        if (items.some((p) => !p.is_optimized && !p.is_video)) {
          apiFetch("/api/photos/start-optimization", { method: "POST" }).catch(() => {});
        }
      }
    } catch {
      // Backend may be starting or offline
    }
  };

  useEffect(() => {
    if (activeTab === "photos") {
      loadPhotos();
    }
  }, [activeTab]);

  // Debounced full-text & smart categorical search synchronization
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults(null);
      setIsSearchLoading(false);
      return;
    }

    let isMounted = true;
    setIsSearchLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok && isMounted) {
          const data: SearchResponse = await res.json();
          const mapped: TimelinePhoto[] = data.photos.map((p) => ({
            id: p.id,
            taken_at: p.taken_at || null,
            width: 0,
            height: 0,
            is_video: Boolean(p.mime_type?.startsWith("video/")),
            is_favorite: p.is_favorite,
            // Search doesn't report these; they only decide whether a video can play yet.
            is_optimized: true,
            is_enhanced: true,
          }));
          setSearchResults(mapped);
        }
      } catch (err) {
        console.warn("Search query failed:", err);
      } finally {
        if (isMounted) setIsSearchLoading(false);
      }
    }, 200);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const displayedPhotos = useMemo(() => {
    return searchResults !== null ? searchResults : photos;
  }, [searchResults, photos]);

  // Real-time polling for background photo 8K & video optimization progress
  useEffect(() => {
    let wasPhotoActive = false;
    let wasVideoActive = false;
    let wasImportActive = false;
    let lastPhotoCompletedCount = 0;

    const interval = setInterval(async () => {
      try {
        const [photoRes, videoRes, importRes] = await Promise.all([
          apiFetch("/api/photos/optimization-progress").catch(() => null),
          apiFetch("/api/videos/optimization-progress").catch(() => null),
          apiFetch("/api/photos/import-progress").catch(() => null),
        ]);

        if (photoRes && photoRes.ok) {
          const photoData: OptimizationProgress = await photoRes.json();
          setOptimizationProgress(photoData);

          // If an individual photo just finished optimizing, immediately update its badge locally
          if (photoData.completed_count > lastPhotoCompletedCount) {
            lastPhotoCompletedCount = photoData.completed_count;
            if (photoData.last_completed_photo_id) {
              setPhotos((prev) =>
                prev.map((p) =>
                  p.id === photoData.last_completed_photo_id
                    ? { ...p, is_optimized: true, is_enhanced: true }
                    : p
                )
              );
            }
          }

          // If the entire active photo batch completed, do a single clean reload
          if (wasPhotoActive && !photoData.is_active) {
            loadPhotos();
            lastPhotoCompletedCount = 0;
          }
          wasPhotoActive = photoData.is_active;
        }

        if (videoRes && videoRes.ok) {
          const videoData: VideoOptimizationProgress = await videoRes.json();
          setVideoProgress(videoData);

          // When video batch completes, reload photos & timeline
          if (wasVideoActive && !videoData.is_active) {
            loadPhotos();
          }
          wasVideoActive = videoData.is_active;
        }

        if (importRes && importRes.ok) {
          const importData: ImportProgressState = await importRes.json();
          setImportProgress(importData);

          // When media import batch completes, refresh library photos & timeline
          if (wasImportActive && !importData.is_active) {
            loadPhotos();
          }
          wasImportActive = importData.is_active;
        }
      } catch {}
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Updater and diagnostics state
  const [activeUpdate, setActiveUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isRecheckingPrereqs, setIsRecheckingPrereqs] = useState(false);

  // Manual engine launch helper
  const handleStartEngine = async () => {
    try {
      const result = await invoke<{ status?: string; message?: string }>("start_backend_engine");
      if (result?.status === "error") {
        // M5: e.g. no secure access key could be made; the banner shows the same reason.
        showToast?.(result.message || "The engine couldn't start. Please try again.", "warning");
        await handleRecheckPrerequisites();
        return;
      }
      showToast?.("Starting the engine…", "info");
      // The engine needs a few seconds to boot; keep checking so one click is enough.
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await handleRecheckPrerequisites()) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error("Failed to start engine:", err);
      showToast?.("Failed to launch background engine", "warning");
    }
  };

  // Manual / button-triggered prerequisites re-check
  const handleRecheckPrerequisites = async (): Promise<boolean> => {
    setIsRecheckingPrereqs(true);
    try {
      const prereqs = await invoke<SystemPrerequisites>("check_system_prerequisites");
      setPrerequisites(prereqs);
      if (prereqs.backend.running) {
        const config = await invoke<{ port: number; token: string; base_url: string }>("get_engine_config");
        if (config && config.port > 0) {
          setEngineConfig(config.base_url, config.token || null);
          if (config.token && !(await performHandshake(config.base_url, config.token))) {
            return false; // Port is open but the engine is still starting.
          }
          setIsEngineReady(true);
          checkVaultStatus();
          loadPhotos();
          return true;
        }
      }
      return false;
    } catch (err) {
      console.warn("Prerequisites check warning:", err);
      return false;
    } finally {
      setIsRecheckingPrereqs(false);
    }
  };

  // Resilient engine startup orchestration with polling, handshake retry, and passive heartbeat
  useEffect(() => {
    let isCancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;
    const MAX_BOOT_ATTEMPTS = 20; // 20 attempts * 1500ms = 30 seconds

    const pollEngineLifecycle = async () => {
      try {
        const prereqs = await invoke<SystemPrerequisites>("check_system_prerequisites");
        if (isCancelled) return;
        setPrerequisites(prereqs);

        // 1. If backend is running, retrieve engine config and perform handshake
        if (prereqs.backend.running) {
          const config = await invoke<{ port: number; token: string; base_url: string }>("get_engine_config");
          if (isCancelled) return;

          if (config && config.port > 0) {
            setEngineConfig(config.base_url, config.token || null);
            let handshakeOk = true;
            if (config.token) {
              handshakeOk = await performHandshake(config.base_url, config.token);
            }

            if (!handshakeOk && attempts < MAX_BOOT_ATTEMPTS) {
              // Engine bound port but Uvicorn handshake endpoint is still initializing
              attempts++;
              return;
            }

            // Connection established successfully!
            if (pollInterval) clearInterval(pollInterval);
            setIsEngineReady(true);

            // Hydrate persistent settings and initial photos
            checkVaultStatus();
            loadPhotos();

            apiFetch("/api/system/settings")
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (data?.settings) {
                  if (data.settings.theme) setTheme(data.settings.theme);
                  if (data.settings.grid_density) setGridDensity(data.settings.grid_density);
                  if (data.settings.reduce_motion !== undefined) {
                    document.documentElement.setAttribute("data-reduce-motion", String(data.settings.reduce_motion));
                  }
                }
              })
              .catch(() => {});

            // Switch to lightweight passive heartbeat (every 15s)
            pollInterval = setInterval(async () => {
              try {
                const health = await invoke<SystemPrerequisites>("check_system_prerequisites");
                if (!isCancelled) setPrerequisites(health);
              } catch {}
            }, 15000);

            return;
          }
        }

        // 2. If engine not yet running on first check, ensure background auto-start was kicked off
        if (prereqs.python.installed && !prereqs.backend.running && attempts === 0) {
          invoke("start_backend_engine").catch(() => {});
        }

        // 3. Early halt on fatal blocker (missing VC++ runtime or premature child exit)
        if (!prereqs.vcredist.installed || prereqs.error_message) {
          if (pollInterval) clearInterval(pollInterval);
          return;
        }

        attempts++;
        if (attempts >= MAX_BOOT_ATTEMPTS) {
          if (pollInterval) clearInterval(pollInterval);
          console.warn("Engine connection polling timed out after 30 seconds.");
        }
      } catch (err) {
        // Fallback for standard non-Tauri / browser dev environments
        console.info("Running in standard non-Tauri mode:", err);
        setIsEngineReady(true);
        if (pollInterval) clearInterval(pollInterval);
        loadPhotos();
      }
    };

    pollEngineLifecycle();
    pollInterval = setInterval(pollEngineLifecycle, 1500);

    return () => {
      isCancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  // Check for desktop updates in background on mount
  useEffect(() => {
    const checkUpdates = async () => {
      try {
        const update = await check();
        if (update?.available) {
          setActiveUpdate(update);
          setIsUpdateModalOpen(true);
        }
      } catch (err) {
        console.info("Update check notice (running offline or latest version):", err);
      }
    };

    checkUpdates();
  }, []);

  // Initialize and register global desktop keyboard shortcuts
  useEffect(() => {
    // 1. Initial photos is empty for fresh install (0 dummy items)
    setPhotos([]);
    setTotalPhotosCount(0);

    // 2. Query real system storage volume
    invoke<any[]>("get_system_drives")
      .then((drives) => {
        if (drives && drives.length > 0) {
          setActiveVolume({
            drive_letter: drives[0].drive_letter,
            volume_name: drives[0].volume_name,
            volume_serial: "SYS-DRV",
            file_system: "NTFS",
            is_ready: drives[0].is_ready,
            free_bytes: drives[0].free_bytes,
            total_bytes: drives[0].total_bytes,
          });
        }
      })
      .catch(() => {
        setActiveVolume({
          drive_letter: "C:\\",
          volume_name: "Local Storage",
          volume_serial: "SYS-DRV",
          file_system: "NTFS",
          is_ready: true,
          free_bytes: 120 * 1024 * 1024 * 1024,
          total_bytes: 512 * 1024 * 1024 * 1024,
        });
      });

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        toggleTheme();
      } else if (e.key === "l" || e.key === "L") {
        if (isVaultUnlocked) {
          setIsVaultUnlocked(false);
          apiFetch("/api/vault/lock", { method: "POST" }).catch(() => {});
        }
      } else if (e.key === "Escape") {
        clearSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTheme, clearSelection, setActiveVolume, isVaultUnlocked, setIsVaultUnlocked]);

  const handleDeletePhoto = (photoId: number) => {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setSearchResults((prev) => (prev ? prev.filter((p) => p.id !== photoId) : null));
    if (lightboxPhotos) {
      setLightboxPhotos((prev) => (prev ? prev.filter((p) => p.id !== photoId) : null));
    }
    if (lightboxIndex !== null) {
      const activeList = lightboxPhotos || photos;
      if (activeList.length <= 1) {
        setLightboxIndex(null);
      } else if (lightboxIndex >= activeList.length - 1) {
        setLightboxIndex(Math.max(0, activeList.length - 2));
      }
    }
    // Global deletion broadcast for synchronized views (Documents, Albums, People, etc.)
    window.dispatchEvent(new CustomEvent("photos-changed", { detail: { action: "deleted", photoId } }));
  };

  const handleTogglePin = async (photoId: number) => {
    if (lightboxPhotos) {
      setLightboxPhotos((prev) =>
        prev ? prev.map((p) => (p.id === photoId ? { ...p, is_pinned: !p.is_pinned } : p)) : null
      );
    }
    try {
      const res = await apiFetch(`/api/documents/${photoId}/pin`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(
          new CustomEvent("photos-changed", {
            detail: { action: "pinned", photoId, is_pinned: data.is_pinned },
          })
        );
      }
    } catch (err) {
      console.error("Failed to toggle document pin:", err);
    }
  };

  const handleToggleFavorite = async (photoId: number) => {
    // Optimistically update photos in library
    setPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p))
    );
    setSearchResults((prev) =>
      prev ? prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p)) : null
    );
    // Optimistically update photos in active lightbox if present
    if (lightboxPhotos) {
      setLightboxPhotos((prev) =>
        prev ? prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p)) : null
      );
    }
    try {
      const res = await apiFetch(`/api/photos/${photoId}/toggle-favorite`, {
        method: "POST",
      });
      if (!res.ok) {
        // Rollback on non-200
        setPhotos((prev) =>
          prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p))
        );
        setSearchResults((prev) =>
          prev ? prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p)) : null
        );
      }
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
      // Rollback on network failure
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p))
      );
      setSearchResults((prev) =>
        prev ? prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p)) : null
      );
    }
  };

  const handleBatchDelete = async () => {
    if (selectedPhotoIds.size === 0) return;
    const ids = Array.from(selectedPhotoIds);
    try {
      const res = await apiFetch("/api/photos/batch-trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (res.ok) {
        setPhotos((prev) => prev.filter((p) => !selectedPhotoIds.has(p.id)));
        setSearchResults((prev) => (prev ? prev.filter((p) => !selectedPhotoIds.has(p.id)) : null));
        showToast(`Moved ${ids.length} photo(s) to Trash (held for 30 days)`, "info");
        clearSelection();
      }
    } catch (err) {
      console.error("Batch delete failed:", err);
    }
  };

  const handleBatchMoveToVault = async () => {
    if (selectedPhotoIds.size === 0) return;
    const ids = Array.from(selectedPhotoIds);

    if (!isVaultConfigured) {
      showToast("Please set up your Private Vault first.", "info");
      setActiveTab("vault");
      return;
    }

    if (!isVaultUnlocked) {
      setPendingVaultAction({ type: "batch_photos" });
      setIsVaultUnlockModalOpen(true);
      return;
    }

    try {
      const res = await apiFetch("/api/vault/photos/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (res.ok) {
        setPhotos((prev) => prev.filter((p) => !selectedPhotoIds.has(p.id)));
        setSearchResults((prev) => (prev ? prev.filter((p) => !selectedPhotoIds.has(p.id)) : null));
        showToast(`${ids.length} ${ids.length === 1 ? "item" : "items"} encrypted and moved into Private Vault.`, "success");
        clearSelection();
      } else if (res.status === 401) {
        setIsVaultUnlocked(false);
        setPendingVaultAction({ type: "batch_photos" });
        setIsVaultUnlockModalOpen(true);
      }
    } catch (err) {
      console.error("Batch vault lock failed:", err);
      showToast("Failed to move photos to vault.", "warning");
    }
  };

  const handleLockAlbumToVault = async (albumId: number, isVaultAlbum: boolean = false) => {
    if (!isVaultConfigured) {
      showToast("Please set up your Private Vault first.", "info");
      setActiveTab("vault");
      return;
    }

    if (!isVaultUnlocked) {
      setPendingVaultAction({ type: "album", albumId, isVaultAlbum });
      setIsVaultUnlockModalOpen(true);
      return;
    }

    await executeAlbumVaultAction(albumId, isVaultAlbum);
  };

  const executeAlbumVaultAction = async (albumId: number, isVaultAlbum: boolean) => {
    try {
      const endpoint = isVaultAlbum
        ? `/api/vault/albums/${albumId}/unlock`
        : `/api/vault/albums/${albumId}/lock`;

      const res = await apiFetch(endpoint, { method: "POST" });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (!isVaultAlbum && data.photo_ids && Array.isArray(data.photo_ids) && data.photo_ids.length > 0) {
          const lockedSet = new Set<number>(data.photo_ids);
          setPhotos((prev) => prev.filter((p) => !lockedSet.has(p.id)));
        }
        showToast(
          isVaultAlbum 
            ? "Album decrypted and restored to public library." 
            : "Album and its photos encrypted and moved to Private Vault.", 
          "success"
        );
        loadPhotos();
      } else if (res.status === 401) {
        setIsVaultUnlocked(false);
        setPendingVaultAction({ type: "album", albumId, isVaultAlbum });
        setIsVaultUnlockModalOpen(true);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.detail || "Failed to update album vault status.", "warning");
      }
    } catch (err) {
      console.error("Album vault action error:", err);
      showToast("Error updating album vault status.", "warning");
    }
  };


  const handleBatchDownload = () => {
    if (selectedPhotoIds.size === 0) return;
    const ids = Array.from(selectedPhotoIds);
    showToast(`📥 Downloading ${ids.length} photo(s) to your computer's Downloads folder...`, "info");
    ids.forEach((id, idx) => {
      setTimeout(() => {
        // The engine names the file (Content-Disposition), so no filename is needed here.
        const link = document.createElement("a");
        link.href = getApiUrl(`/api/photos/${id}/download`);
        link.setAttribute("download", "");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, idx * 250);
    });
  };

  const selectedCount = selectedPhotoIds.size;

  // Opens the viewer on a timeline photo: full details load for the photos around it.
  const openPhotoViewer = async (list: TimelinePhoto[], index: number) => {
    const targetId = list[index]?.id;
    if (targetId === undefined) return;
    const { ids } = viewerWindow(list, index);
    try {
      const res = await apiFetch(`/api/photos/details?ids=${ids.join(",")}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const details: PhotoItem[] = await res.json();
      const at = details.findIndex((p) => p.id === targetId);
      if (at < 0) {
        showToast("This photo is no longer in your library.", "info");
        loadPhotos();
        return;
      }
      setLightboxPhotos(details);
      setLightboxIndex(at);
      setViewerWindowStart(index - at);
    } catch (err) {
      console.error("Could not load photo details:", err);
      showToast("Couldn't open this photo. Please try again.", "warning");
    }
  };

  // One plain-language line for background work, shown next to the Photos title.
  const libraryActivity: { text: string; title?: string } | null = importProgress?.is_active
    ? {
        text: importProgress.album_name
          ? `Adding to "${importProgress.album_name}" (${importProgress.completed_count} of ${importProgress.total_count})`
          : `Importing (${importProgress.completed_count} of ${importProgress.total_count})`,
        title: importProgress.current_filename ? `Importing: ${importProgress.current_filename}` : undefined,
      }
    : videoProgress?.is_active
    ? {
        text: videoProgress.total_count > 1
          ? `Preparing videos (${videoProgress.completed_count + 1} of ${videoProgress.total_count})`
          : "Preparing a video",
        title: videoProgress.active_filename ? `Processing: ${videoProgress.active_filename}` : undefined,
      }
    : optimizationProgress?.is_active
    ? {
        text: optimizationProgress.paused_reason === "on_battery"
          ? `Enhancing paused on battery (${optimizationProgress.completed_count} of ${optimizationProgress.total_count} done)`
          : optimizationProgress.completed_count >= optimizationProgress.total_count
          ? `Finishing enhancements (${optimizationProgress.completed_count} of ${optimizationProgress.total_count})`
          : `Enhancing photos (${optimizationProgress.completed_count + 1} of ${optimizationProgress.total_count})`,
        title: optimizationProgress.active_filename ? `Processing: ${optimizationProgress.active_filename}` : undefined,
      }
    : null;

  const selectedPhotosList = useMemo(
    () => photos.filter((p) => selectedPhotoIds.has(p.id)),
    [photos, selectedPhotoIds]
  );
  const hasVideoSelected = useMemo(
    () => selectedPhotosList.some((p) => p.is_video),
    [selectedPhotosList]
  );
  const canCreateCollage = selectedCount >= 2 && selectedCount <= 9 && !hasVideoSelected;

  return (
    <div 
      style={{ 
        display: "flex", 
        flexDirection: "column", 
        height: "100vh", 
        width: "100vw",
        backgroundColor: "var(--bg-app)",
      }}
    >
      {/* Frameless window: slim drag strip + global search palette (redesign R1) */}
      <WindowStrip />
      <SearchPalette
        onSelectPhoto={(photo, allPhotos) => {
          const mapped: PhotoItem[] = allPhotos.map((p) => ({
            id: p.id,
            filename: p.filename,
            filepath: p.filepath,
            file_size: 0,
            mime_type: p.mime_type,
            taken_at: p.taken_at || undefined,
            is_favorite: p.is_favorite,
            is_encrypted: false,
            thumbnail_path: p.thumbnail_path || undefined,
            caption: p.caption || undefined,
            ocr_text: p.ocr_text || undefined,
            is_document: p.is_document,
            is_optimized: false,
            is_enhanced: false,
          }));
          setLightboxPhotos(mapped);
          const targetIdx = allPhotos.findIndex((p) => p.id === photo.id);
          setLightboxIndex(targetIdx >= 0 ? targetIdx : 0);
        }}
      />

      {/* System Prerequisites Diagnostics Banner (visible when prerequisites missing or engine offline) */}
      <PrerequisitesBanner
        prerequisites={prerequisites}
        isLoading={isRecheckingPrereqs}
        onRecheck={handleRecheckPrerequisites}
        onStartEngine={handleStartEngine}
      />

      {/* Main Content Layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Navigation: 64 px icon rail (redesign R1) */}
        <IconRail />

        {/* Dynamic Main Workspace View */}
        <main 
          style={{ 
            flex: 1, 
            display: "flex", 
            flexDirection: "column", 
            backgroundColor: "var(--bg-app)",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {activeTab === "dashboard" ? (
            /* System & Storage Telemetry Dashboard */
            <DashboardView 
              onNavigate={(tab) => setActiveTab(tab)}
              onPhotoClick={(idx, customPhotos) => {
                setLightboxPhotos(customPhotos);
                setLightboxIndex(idx);
              }}
            />
          ) : activeTab === "vault" ? (
            /* Dedicated Zero-Trust Private Vault Gallery */
            <VaultView 
              onUnlockRequest={() => setIsVaultUnlockModalOpen(true)}
              onPhotoClick={(idx, vaultList) => {
                if (vaultList) setLightboxPhotos(vaultList);
                setLightboxIndex(idx);
              }}
            />
          ) : activeTab === "albums" ? (
            /* Albums Grid & Management */
            <AlbumsView 
              importProgress={importProgress}
              onLockAlbumToVault={(albumId, isVaultAlbum) => handleLockAlbumToVault(albumId, isVaultAlbum)}
              onPhotoClick={(idx, albumPhotos) => {
                setLightboxPhotos(albumPhotos);
                setLightboxIndex(idx);
              }}
              onToggleFavorite={handleToggleFavorite}
              onPlayStory={(id) => setActiveStoryId(id)}
            />
          ) : activeTab === "people" ? (
            /* People Management & Representative Medoid Tagging View */
            <PeopleView 
              onPhotoClick={(idx, personPhotos) => {
                setLightboxPhotos(personPhotos);
                setLightboxIndex(idx);
              }}
              onToggleFavorite={handleToggleFavorite}
            />
          ) : activeTab === "documents" ? (
            /* OCR Scanned Documents & Invoices */
            <DocumentsView 
              onDocumentClick={(idx, docList) => {
                const photoItems: PhotoItem[] = docList.map((d) => ({
                  id: d.id,
                  filename: d.filename,
                  filepath: d.filepath,
                  file_size: d.file_size_bytes,
                  mime_type: d.mime_type,
                  taken_at: d.date,
                  is_favorite: false,
                  is_pinned: Boolean(d.is_pinned),
                  is_encrypted: d.is_encrypted,
                  is_optimized: false,
                  is_enhanced: false,
                  thumbnail_path: d.thumbnail_path ?? undefined,
                  preview_path: d.preview_path ?? undefined,
                  caption: d.title,
                }));
                setLightboxPhotos(photoItems);
                setLightboxIndex(idx);
              }}
            />
          ) : activeTab === "trash" ? (
            /* 30-Day Trash & Soft-Delete Safe */
            <TrashView />
          ) : activeTab === "settings" ? (
            /* Settings & Preferences */
            <SettingsView />
          ) : activeTab === "stories" ? (
            /* Dedicated Stories & Photographic Intelligence Hub */
            <StoriesView 
              onPlayStory={(id) => setActiveStoryId(id)}
              onNavigate={(tab) => setActiveTab(tab)}
              onPhotoClick={(idx, photoList) => {
                setLightboxPhotos(photoList);
                setLightboxIndex(idx);
              }}
            />
          ) : (

            /* Standard Photos & Media Grid View */
            <>
              {/* Stories Highlight Bar on Home View */}
              {photos.length > 0 && <StoriesCarousel onPlayStory={(id) => setActiveStoryId(id)} />}

              {/* Photos header (redesign R2): title, count, background work, search, import */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  padding: "14px 76px 6px 24px",
                  flexShrink: 0,
                  minWidth: 0,
                }}
              >
                <h1
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-display)",
                    fontSize: "30px",
                    fontWeight: 900,
                    letterSpacing: "-0.035em",
                    color: "var(--text-primary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {searchQuery.trim() ? "Search results" : "Photos"}
                </h1>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {isSearchLoading
                    ? "Searching…"
                    : `${displayedPhotos.length.toLocaleString()} ${displayedPhotos.length === 1 ? "photo" : "photos"}`}
                </span>
                {libraryActivity && (
                  <span
                    title={libraryActivity.title}
                    role="status"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 10px",
                      borderRadius: "var(--radius-full)",
                      fontSize: "11px",
                      fontWeight: 600,
                      backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                      color: "var(--accent-ink)",
                      border: "1px solid color-mix(in srgb, var(--accent-ink) 25%, transparent)",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Loader2 size={12} className="spin" style={{ flexShrink: 0 }} />
                    {libraryActivity.text}
                  </span>
                )}

                <div style={{ flex: 1 }} />

                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="clickable"
                  aria-label="Search"
                  title="Search (Ctrl+K)"
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-pill-border)",
                    color: "var(--text-primary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Search size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(true)}
                  className="clickable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    height: "34px",
                    padding: "0 16px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-fill)",
                    border: "none",
                    color: "var(--on-accent)",
                    fontSize: "13px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  <Plus size={16} strokeWidth={2.5} />
                  Import
                </button>
              </div>

              {/* 60 FPS Virtualized Grid / Empty State */}
              {searchQuery.trim() !== "" && !isSearchLoading && displayedPhotos.length === 0 ? (
                <div 
                  style={{ 
                    flex: 1,
                    display: "flex", 
                    flexDirection: "column", 
                    alignItems: "center", 
                    justifyContent: "center", 
                    padding: "60px 20px",
                    gap: "14px",
                    color: "var(--text-secondary)"
                  }}
                >
                  <div 
                    style={{
                      width: "56px",
                      height: "56px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-muted)",
                      boxShadow: "var(--glass-shadow)",
                    }}
                  >
                    <Search size={26} />
                  </div>
                  <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
                    No photos found for "{searchQuery}"
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)", maxWidth: "420px", textAlign: "center", lineHeight: "1.5" }}>
                    Try searching by year (e.g. 2024), person name, or category tags. Vault photos and deleted items are protected and excluded from search.
                  </div>
                  <button
                    onClick={() => setSearchQuery("")}
                    className="clickable"
                    style={{
                      marginTop: "10px",
                      padding: "8px 20px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-pill-border)",
                      color: "var(--accent-primary)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <X size={14} />
                    <span>Clear Search Filter</span>
                  </button>
                </div>
              ) : (
                <PhotoTimeline
                  photos={displayedPhotos}
                  onOpen={(idx) => openPhotoViewer(displayedPhotos, idx)}
                  onToggleFavorite={handleToggleFavorite}
                  activeVideoId={videoProgress?.is_active ? videoProgress.active_video_id : null}
                  empty={
                    <EmptyLibraryState
                      onSelectFolder={() => setIsImportModalOpen(true)}
                      onImportMedia={() => setIsImportModalOpen(true)}
                    />
                  }
                />
              )}

              {/* ── Jira/Linear-Style Floating Bottom Batch Action Dock ──────────── */}
              <div
                style={{
                  position: "absolute",
                  bottom: "24px",
                  left: "50%",
                  transform: `translateX(-50%) ${selectedCount > 0 ? "translateY(0)" : "translateY(80px)"}`,
                  opacity: selectedCount > 0 ? 1 : 0,
                  pointerEvents: selectedCount > 0 ? "auto" : "none",
                  transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease",
                  zIndex: 40,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 16px",
                  backgroundColor: "var(--glass-surface)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: "var(--radius-full)",
                  boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45), 0 0 1px rgba(255, 255, 255, 0.2)",
                  maxWidth: "calc(100% - 48px)",
                  overflowX: "auto",
                }}
              >
                {/* Selection Count Capsule */}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px 12px",
                    borderRadius: "var(--radius-full)",
                    fontSize: "12px",
                    fontWeight: 700,
                    backgroundColor: "color-mix(in srgb, var(--accent-ink) 15%, transparent)",
                    color: "var(--accent-primary)",
                    border: "1px solid color-mix(in srgb, var(--accent-ink) 30%, transparent)",
                    fontFamily: "var(--font-mono)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  <CheckSquare size={13} />
                  {selectedCount} selected
                </span>

                {/* Select All / Deselect All Toggle */}
                <button
                  onClick={() => {
                    if (selectedCount === displayedPhotos.length) {
                      clearSelection();
                    } else {
                      const allIds = new Set(displayedPhotos.map((p) => p.id));
                      useAppStore.setState({ selectedPhotoIds: allIds });
                    }
                  }}
                  className="clickable"
                  title={selectedCount === displayedPhotos.length ? "Unselect everything" : searchQuery.trim() ? "Select all search results" : "Select every photo in your library"}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-pill-border)",
                    color: "var(--text-secondary)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {selectedCount === displayedPhotos.length ? "Deselect All" : "Select All"}
                </button>

                {/* Subtle Vertical Glass Divider */}
                <div style={{ width: "1px", height: "20px", backgroundColor: "var(--glass-border)", margin: "0 2px", flexShrink: 0 }} />

                {/* Create Collage (Photos only, 2 to 9 items) */}
                {canCreateCollage && (
                  <button
                    onClick={() => setIsCollageModalOpen(true)}
                    className="clickable"
                    title="Create 4K Collage (2-9 photos)"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 14px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-pill-border)",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      cursor: "pointer",
                    }}
                  >
                    <LayoutGrid size={14} />
                    <span>Create Collage ({selectedCount})</span>
                  </button>
                )}

                {/* Download Selected */}
                <button
                  onClick={handleBatchDownload}
                  className="clickable"
                  title="Download selected items to Downloads folder"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-pill-border)",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    cursor: "pointer",
                  }}
                >
                  <Download size={14} />
                  <span>Download</span>
                </button>

                {/* Add to Album */}
                <button
                  onClick={() => setIsAddToAlbumModalOpen(true)}
                  className="clickable"
                  title="Add selected items to an album"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-pill-border)",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    cursor: "pointer",
                  }}
                >
                  <FolderPlus size={14} />
                  <span>Add to Album</span>
                </button>

                {/* Move to Vault (L) */}
                <button
                  onClick={handleBatchMoveToVault}
                  className="clickable"
                  title="Encrypt and move selected items into Private Zero-Trust Vault"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "rgba(139, 92, 246, 0.15)",
                    border: "1px solid rgba(139, 92, 246, 0.35)",
                    color: "var(--accent-vault)",
                    fontSize: "12px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    cursor: "pointer",
                  }}
                >
                  <Lock size={14} />
                  <span>Move to Vault</span>
                </button>

                {/* Move to Trash */}
                <button
                  onClick={handleBatchDelete}
                  className="clickable"
                  title="Move selected items to 30-Day Trash"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "var(--accent-danger, #ef4444)",
                    fontSize: "12px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    cursor: "pointer",
                  }}
                >
                  <Trash2 size={14} />
                  <span>Move to Trash ({selectedCount})</span>
                </button>

                {/* Subtle Vertical Glass Divider */}
                <div style={{ width: "1px", height: "20px", backgroundColor: "var(--glass-border)", margin: "0 2px", flexShrink: 0 }} />

                {/* Close / Deselect Button */}
                <button
                  onClick={clearSelection}
                  className="clickable"
                  title="Clear selection (Esc)"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "28px",
                    height: "28px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-pill-border)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "all 0.15s ease",
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Floating External Drive Status Banner */}
      <DriveStatusBanner />

      {/* Interactive Import Modal */}
      {isImportModalOpen && (
        <ImportModal 
          isOpen={isImportModalOpen} 
          onClose={() => setIsImportModalOpen(false)} 
          onImportComplete={() => {
            loadPhotos();
          }}
        />
      )}

      {/* Vault Unlock Modal */}
      <VaultUnlockModal
        isOpen={isVaultUnlockModalOpen}
        onClose={() => {
          setIsVaultUnlockModalOpen(false);
          setPendingVaultAction(null);
        }}
        onUnlockSuccess={() => {
          if (pendingVaultAction?.type === "album" && pendingVaultAction.albumId) {
            executeAlbumVaultAction(pendingVaultAction.albumId, !!pendingVaultAction.isVaultAlbum);
          } else if (pendingVaultAction?.type === "batch_photos" || selectedPhotoIds.size > 0) {
            handleBatchMoveToVault();
          } else if (pendingVaultAction?.type === "custom" && pendingVaultAction.callback) {
            pendingVaultAction.callback();
          }
          setPendingVaultAction(null);
        }}
      />

      {/* Mosaic Collage Generator Modal */}
      <CollageModal
        isOpen={isCollageModalOpen}
        onClose={() => setIsCollageModalOpen(false)}
        selectedPhotoIds={Array.from(selectedPhotoIds)}
        onSuccess={() => {
          clearSelection();
          loadPhotos();
        }}
      />

      {/* Add Selected Photos to Album Modal */}
      <AddToAlbumModal
        isOpen={isAddToAlbumModalOpen}
        selectedPhotoIds={Array.from(selectedPhotoIds)}
        onClose={() => setIsAddToAlbumModalOpen(false)}
        onSuccess={() => {
          clearSelection();
          loadPhotos();
        }}
      />

      {/* Cinematic Story Player Modal */}
      <StoryPlayerModal
        storyId={activeStoryId}
        isOpen={activeStoryId !== null}
        onClose={() => setActiveStoryId(null)}
        onStoryDeleted={(id) => {
          window.dispatchEvent(new CustomEvent("stories-changed", { detail: { storyId: id, action: "deleted" } }));
        }}
        onStorySaveToggled={(id, isSaved) => {
          window.dispatchEvent(new CustomEvent("stories-changed", { detail: { storyId: id, action: "saved", isSaved } }));
        }}
      />

      {/* Immersive Fluid Lightbox */}
      <Lightbox
        photos={lightboxPhotos ?? []}
        currentIndex={lightboxIndex ?? 0}
        isOpen={lightboxIndex !== null}
        optimizationProgress={optimizationProgress}
        onClose={() => {
          setLightboxIndex(null);
          setLightboxPhotos(null);
          setViewerWindowStart(null);
        }}
        onNavigate={(idx) => {
          setLightboxIndex(idx);
          // Near either end of the loaded window: load a new window around this photo.
          if (viewerWindowStart !== null && lightboxPhotos) {
            const absolute = viewerWindowStart + idx;
            const nearStart = idx < 20 && viewerWindowStart > 0;
            const nearEnd = idx >= lightboxPhotos.length - 20 && viewerWindowStart + lightboxPhotos.length < displayedPhotos.length;
            if ((nearStart || nearEnd) && displayedPhotos[absolute]?.id === lightboxPhotos[idx]?.id) {
              openPhotoViewer(displayedPhotos, absolute);
            }
          }
        }}
        indexOffset={viewerWindowStart ?? 0}
        totalCount={viewerWindowStart !== null ? displayedPhotos.length : undefined}
        onDelete={(id) => {
          handleDeletePhoto(id);
          if (lightboxPhotos) {
            setLightboxPhotos((prev) => (prev ? prev.filter((p) => p.id !== id) : null));
          }
        }}
        onToggleFavorite={handleToggleFavorite}
        isDocumentView={activeTab === "documents"}
        onTogglePin={handleTogglePin}
        onUnlockRequest={(action) => {
          if (action) {
            setPendingVaultAction({ type: "custom", callback: action });
          }
          setIsVaultUnlockModalOpen(true);
        }}
        onVaultStatusChange={(photoId, isEncrypted) => {
          if (!isEncrypted) {
            loadPhotos();
            if (lightboxPhotos) {
              setLightboxPhotos((prev) => (prev ? prev.filter((p) => p.id !== photoId) : null));
            }
          } else {
            setPhotos((prev) => prev.filter((p) => p.id !== photoId));
          }
        }}
      />

      {/* Confirmed Update Interactive Modal */}
      {activeUpdate && (
        <UpdateModal
          update={activeUpdate}
          isOpen={isUpdateModalOpen}
          onClose={() => setIsUpdateModalOpen(false)}
        />
      )}

      {/* Floating System Toast Notification */}
      <ToastNotification />
    </div>
  );
};
