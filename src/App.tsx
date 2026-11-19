import { watchMediaSession } from "./services/mediaSession";
import { workInProgress } from "./utils/photoTimeline";
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
  Sparkles,
  Copy,
} from "lucide-react";
import { SearchPage } from "./components/search/SearchPage";
import { useBackgroundProgress } from "./hooks/useBackgroundProgress";
import { useEngineConnection } from "./hooks/useEngineConnection";
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
import { DashboardView, type DashboardPage } from "./components/DashboardView";
import { StoriesView } from "./components/StoriesView";
import { PeopleView } from "./components/PeopleView";
import { AlbumsView } from "./components/AlbumsView";
import { DocumentsView } from "./components/DocumentsView";
import { TrashView } from "./components/TrashView";
import { ActivityView } from "./components/activity/ActivityView";
import { buildActivity, importSummaryLine } from "./components/activity/activityFormat";
import { SettingsView } from "./components/SettingsView";
import { CollageModal } from "./components/CollageModal";
import { AddToAlbumModal } from "./components/AddToAlbumModal";
import { UpdateModal } from "./components/UpdateModal";
import { ToastNotification } from "./components/ToastNotification";
import { useAppStore } from "./store/useAppStore";
import { PhotoItem, TimelinePhoto, TimelineResponse } from "./types";
import { parseTimeline, viewerWindow } from "./utils/photoTimeline";
import { invoke } from "@tauri-apps/api/core";
import { check, Update } from "@tauri-apps/plugin-updater";
import { apiFetch, getApiUrl } from "./services/api";

export const App: React.FC = () => {
  const { 
    activeTab, 
    setActiveTab,
    toggleTheme, 
    openSearch,
    selectedPhotoIds, 
    clearSelection,
    setActiveVolume,
    isVaultUnlocked,
    setIsVaultUnlocked,
    isVaultConfigured,
    prerequisites,
    setTotalPhotosCount,
    showToast,
    checkVaultStatus,
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
  // The list the open viewer steps through (Photos timeline or Search results), for paging.
  const [viewerSource, setViewerSource] = useState<TimelinePhoto[] | null>(null);
  const hasRegeneratedThumbnailsRef = useRef(false);
  // A8: a Photos header pill opens its Dashboard page directly ("12 improved", "3 duplicates").
  const [dashboardPage, setDashboardPage] = useState<DashboardPage | null>(null);
  const [duplicateGroups, setDuplicateGroups] = useState(0);
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

        // A8: the "N duplicates" pill (reads the last check; cheap).
        apiFetch("/api/duplicates/summary")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => setDuplicateGroups(Number(d?.total_groups) || 0))
          .catch(() => {});
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

  const displayedPhotos = photos;

  // Background work for the Photos header (enhancing, preparing videos, importing).
  const { optimizationProgress, videoProgress, importProgress, restoreJobs, preparing } = useBackgroundProgress({
    onPhotoEnhanced: (id) => setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, is_optimized: true, is_enhanced: true } : p))),
    onBatchFinished: () => loadPhotos(),
  });
  // The photos being worked on right now, shown on their tiles as an icon (2026-11-19).
  const photoWork = useMemo(
    () => workInProgress({ preparing, enhance: optimizationProgress, restoreWorking: restoreJobs?.working }),
    [preparing, optimizationProgress, restoreJobs],
  );

  // Updater and diagnostics state
  const [activeUpdate, setActiveUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  // Find, start and connect to the photo engine; reload what depends on it once reached.
  // Photos keep showing if the engine restarts and forgets the image login (2026-11-19).
  useEffect(() => watchMediaSession(), []);

  const { isRecheckingPrereqs, startEngine: handleStartEngine, recheckPrerequisites: handleRecheckPrerequisites } = useEngineConnection(() => {
    checkVaultStatus();
    loadPhotos();
  });

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
    setViewerSource((prev) => (prev ? prev.filter((p) => p.id !== photoId) : null));
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
    setViewerSource((prev) =>
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
        setViewerSource((prev) =>
          prev ? prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p)) : null
        );
      }
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
      // Rollback on network failure
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p))
      );
      setViewerSource((prev) =>
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
        setViewerSource((prev) => (prev ? prev.filter((p) => !selectedPhotoIds.has(p.id)) : null));
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
        setViewerSource((prev) => (prev ? prev.filter((p) => !selectedPhotoIds.has(p.id)) : null));
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
        const failed = (Array.isArray(data.failed_ids) ? data.failed_ids.length : 0) + (Array.isArray(data.skipped_ids) ? data.skipped_ids.length : 0);
        if (!isVaultAlbum && failed > 0) {
          // R11: the album only moves when every photo could be locked.
          showToast(
            `${failed} ${failed === 1 ? "photo" : "photos"} couldn't be moved to the vault (the file may be missing), so the album stays in your library.`,
            "warning",
          );
        } else {
          showToast(isVaultAlbum ? "Moved the album back to your library." : "Moved the album to the Private Vault.", "success");
        }
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
      setViewerSource(list);
    } catch (err) {
      console.error("Could not load photo details:", err);
      showToast("Couldn't open this photo. Please try again.", "warning");
    }
  };

  // H10 / A4: everything working in the background, for the Activity page, the header pill
  // and the rail's status ring.
  const activity = useMemo(
    () => buildActivity({ restore: restoreJobs, enhance: optimizationProgress, video: videoProgress, importing: importProgress, preparing }),
    [restoreJobs, optimizationProgress, videoProgress, importProgress, preparing],
  );
  // P4: once the last import's photos are ready, say what it brought (once per import).
  const shownImportBatch = useRef<number | null>(null);
  useEffect(() => {
    const summary = preparing?.import_summary;
    if (!summary || shownImportBatch.current === summary.batch) return;
    let seen: string | null = null;
    try {
      seen = sessionStorage.getItem("securephotos:import-summary-shown");
    } catch {
      /* Private mode or blocked storage: show it once for this window. */
    }
    shownImportBatch.current = summary.batch;
    if (seen === String(summary.batch)) return;
    try {
      sessionStorage.setItem("securephotos:import-summary-shown", String(summary.batch));
    } catch {
      /* As above. */
    }
    showToast(`Your new photos are ready: ${importSummaryLine(summary)}.`, "success");
  }, [preparing?.import_summary, showToast]);

  const setActivitySummary = useAppStore((s) => s.setActivitySummary);
  useEffect(() => {
    const { remaining, paused, headline } = activity;
    setActivitySummary(remaining > 0 || paused || headline ? { remaining, paused, headline } : null);
  }, [activity, setActivitySummary]);

  const openDashboardPage = (page: DashboardPage) => {
    setDashboardPage(page);
    setActiveTab("dashboard");
  };
  // Any other way to the Dashboard (the rail) starts on its overview.
  useEffect(() => {
    if (activeTab !== "dashboard") setDashboardPage(null);
  }, [activeTab]);

  // A8: the library shows one tile per improved pair. The viewer's Original / Improved switch
  // swaps the other member of the stack into the current photo's place.
  const showVersionInViewer = async (photoId: number) => {
    const at = lightboxIndex;
    if (at === null) return;
    try {
      const res = await apiFetch(`/api/photos/details?ids=${photoId}`);
      const details: PhotoItem[] = res.ok ? await res.json() : [];
      if (!details.length) return;
      setLightboxPhotos((prev) => (prev ? prev.map((p, i) => (i === at ? details[0] : p)) : prev));
    } catch {
      showToast("Couldn't open the other version. Please try again.", "warning");
    }
  };

  // Opens one photo from Activity. Vault photos open in the Private Vault (they need it unlocked).
  const openPhotoById = async (photoId: number, isPrivate?: boolean) => {
    if (isPrivate) {
      setActiveTab("vault");
      return;
    }
    try {
      const res = await apiFetch(`/api/photos/details?ids=${photoId}`);
      const details: PhotoItem[] = res.ok ? await res.json() : [];
      if (!details.length) {
        showToast("This photo is no longer in your library.", "info");
        return;
      }
      setLightboxPhotos(details);
      setLightboxIndex(0);
      setViewerWindowStart(null);
      setViewerSource(null);
    } catch {
      showToast("Couldn't open this photo. Please try again.", "warning");
    }
  };
  const postQuietly = (path: string) => apiFetch(path, { method: "POST" }).catch(() => null);

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
      {/* Frameless window: slim drag strip (redesign R1) */}
      <WindowStrip />

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
              initialPage={dashboardPage ?? "overview"}
              backTo={dashboardPage ? { label: "Photos", onBack: () => { setDashboardPage(null); setActiveTab("photos"); } } : undefined}
              onOpenPhoto={(id) => void openPhotoById(id)}
              onLibraryChanged={() => {
                loadPhotos();
              }}
              choicesTotal={activity.choicesTotal}
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
              onOpenPhotos={openPhotoViewer}
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
          ) : activeTab === "activity" ? (
            <ActivityView
              model={activity}
              onOpenPhoto={(id) => {
                const item = [...activity.ready, ...activity.attention].find((i) => i.photoId === id);
                void openPhotoById(id, item?.private);
              }}
              onCancelJob={(id) => void postQuietly(`/api/restore/jobs/${id}/cancel`)}
              onStopImport={() => void postQuietly("/api/photos/import/cancel")}
              onPauseAll={() => {
                void postQuietly("/api/restore/pause");
                void postQuietly("/api/system/optimization/pause");
              }}
              onResumeAll={() => {
                void postQuietly("/api/restore/resume");
                void postQuietly("/api/system/optimization/resume");
              }}
            />
          ) : activeTab === "trash" ? (
            /* 30-Day Trash & Soft-Delete Safe */
            <TrashView />
          ) : activeTab === "settings" ? (
            /* Settings & Preferences */
            <SettingsView />
          ) : activeTab === "search" ? (
            <SearchPage onOpenPhoto={openPhotoViewer} onToggleFavorite={handleToggleFavorite} />
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
                  Photos
                </h1>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {`${displayedPhotos.length.toLocaleString()} ${displayedPhotos.length === 1 ? "photo" : "photos"}`}
                </span>
                {activity.headline && (
                  <button
                    type="button"
                    className="clickable"
                    title="Open Activity"
                    aria-label={`${activity.headline}. Open Activity`}
                    onClick={() => setActiveTab("activity")}
                    style={{
                      cursor: "pointer",
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
                    {activity.remaining > 0 && !activity.paused && <Loader2 size={12} className="spin" style={{ flexShrink: 0 }} />}
                    {activity.headline} ›
                  </button>
                )}
                {activity.choicesTotal > 0 && (
                  <button
                    type="button"
                    className="photos-pill"
                    title="Photos improved automatically: choose what to keep"
                    aria-label={`${activity.choicesTotal} improved photos: choose what to keep`}
                    onClick={() => openDashboardPage("keep")}
                  >
                    <Sparkles size={12} /> {activity.choicesTotal.toLocaleString()} improved
                  </button>
                )}
                {duplicateGroups > 0 && (
                  <button
                    type="button"
                    className="photos-pill"
                    title="Copies and near-identical shots: review duplicates"
                    aria-label={`${duplicateGroups} groups of duplicates: review them`}
                    onClick={() => openDashboardPage("duplicates")}
                  >
                    <Copy size={12} /> {duplicateGroups.toLocaleString()} {duplicateGroups === 1 ? "duplicate" : "duplicates"}
                  </button>
                )}

                <div style={{ flex: 1 }} />

                <button
                  type="button"
                  onClick={openSearch}
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
              {(
                <PhotoTimeline
                  photos={displayedPhotos}
                  onOpen={(idx) => openPhotoViewer(displayedPhotos, idx)}
                  onToggleFavorite={handleToggleFavorite}
                  activeVideoId={videoProgress?.is_active ? videoProgress.active_video_id : null}
                  work={photoWork}
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
                  title={selectedCount === displayedPhotos.length ? "Unselect everything" : "Select every photo in your library"}
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
          setViewerSource(null);
        }}
        onNavigate={(idx) => {
          setLightboxIndex(idx);
          // Near either end of the loaded window: load a new window around this photo.
          if (viewerWindowStart !== null && lightboxPhotos) {
            const absolute = viewerWindowStart + idx;
            const nearStart = idx < 20 && viewerWindowStart > 0;
            const source = viewerSource ?? [];
            const nearEnd = idx >= lightboxPhotos.length - 20 && viewerWindowStart + lightboxPhotos.length < source.length;
            if ((nearStart || nearEnd) && source[absolute]?.id === lightboxPhotos[idx]?.id) {
              openPhotoViewer(source, absolute);
            }
          }
        }}
        indexOffset={viewerWindowStart ?? 0}
        totalCount={viewerWindowStart !== null && viewerSource ? viewerSource.length : undefined}
        onDelete={(id) => {
          handleDeletePhoto(id);
          if (lightboxPhotos) {
            setLightboxPhotos((prev) => (prev ? prev.filter((p) => p.id !== id) : null));
          }
        }}
        onToggleFavorite={handleToggleFavorite}
        isDocumentView={activeTab === "documents"}
        onLibraryChanged={() => loadPhotos()}
        onShowVersion={(photoId) => void showVersionInViewer(photoId)}
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
