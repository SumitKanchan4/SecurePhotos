import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { 
  Lock, 
  Plus, 
  LayoutGrid,
  Loader2,
  Trash2,
  Calendar,
  FolderPlus,
  Download,
  Images,
  ChevronLeft,
  ChevronRight,
  X,
  CheckSquare,
  Search,
} from "lucide-react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { PhotoGrid } from "./components/PhotoGrid";
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
import { PhotoItem, SystemPrerequisites, OptimizationProgress, VideoOptimizationProgress, TimelineYearsData, SearchResponse, ImportProgressState } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { check, Update } from "@tauri-apps/plugin-updater";
import { apiFetch, getApiUrl, performHandshake } from "./services/api";

export const App: React.FC = () => {
  const { 
    activeTab, 
    setActiveTab,
    toggleTheme, 
    searchQuery,
    setSearchQuery,
    selectedPhotoIds, 
    clearSelection,
    setActiveVolume,
    isVaultUnlocked,
    setIsVaultUnlocked,
    isVaultConfigured,
    setPrerequisites,
    setTotalPhotosCount,
    showToast,
    checkVaultStatus,
    setEngineConfig,
    setIsEngineReady,
  } = useAppStore();

  useEffect(() => {
    async function initEngine() {
      try {
        const config = await invoke<{ port: number; token: string; base_url: string }>("get_engine_config");
        if (config && config.base_url) {
          setEngineConfig(config.base_url, config.token || null);
          if (config.token) {
            await performHandshake(config.base_url, config.token);
          }
        }
      } catch (err) {
        console.info("Tauri engine config not available, running in standard mode:", err);
      } finally {
        setIsEngineReady(true);
        checkVaultStatus();
      }
    }
    initEngine();
  }, [setEngineConfig, setIsEngineReady, checkVaultStatus]);


  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [activeYear, setActiveYear] = useState<string>("All Years");
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
  const [searchResults, setSearchResults] = useState<PhotoItem[] | null>(null);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState<OptimizationProgress | null>(null);
  const [videoProgress, setVideoProgress] = useState<VideoOptimizationProgress | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [timelineData, setTimelineData] = useState<TimelineYearsData>({ total_count: 0, years: [] });
  const hasRegeneratedThumbnailsRef = useRef(false);
  const timelineRibbonRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkTimelineScroll = useCallback(() => {
    const el = timelineRibbonRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth + 2;
    setCanScrollLeft(hasOverflow && el.scrollLeft > 4);
    setCanScrollRight(hasOverflow && el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  const scrollTimeline = (offset: number) => {
    const el = timelineRibbonRef.current;
    if (!el) return;
    el.scrollBy({ left: offset, behavior: "smooth" });
  };

  useEffect(() => {
    checkTimelineScroll();
    window.addEventListener("resize", checkTimelineScroll);
    return () => window.removeEventListener("resize", checkTimelineScroll);
  }, [timelineData, checkTimelineScroll]);

  const loadTimelineYears = async () => {
    try {
      const res = await apiFetch("/api/photos/timeline-years");
      if (res.ok) {
        const data: TimelineYearsData = await res.json();
        setTimelineData(data);
      }
    } catch {}
  };

  // Load photos from engine with optional Year or Undated filtering
  const loadPhotos = async (selectedYear: string = activeYear) => {
    try {
      let url = "/api/photos?limit=500";
      if (selectedYear === "Undated") {
        url += "&year=Undated";
      } else if (selectedYear && selectedYear !== "All Years") {
        url += `&year=${selectedYear}`;
      }
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        setPhotos(data);
        setTotalPhotosCount(data.length);

        // Auto-trigger background 512px Retina thumbnail regeneration once on load
        if (!hasRegeneratedThumbnailsRef.current && data.length > 0) {
          hasRegeneratedThumbnailsRef.current = true;
          apiFetch("/api/photos/regenerate-thumbnails", { method: "POST" }).catch(() => {});
        }

        // Auto-trigger background 8K optimization queue ONLY for photos (not videos)
        const hasUnoptimizedPhotos = data.some(
          (p: PhotoItem) => !p.is_optimized && (!p.mime_type || !p.mime_type.startsWith("video/"))
        );
        if (hasUnoptimizedPhotos) {
          apiFetch("/api/photos/start-optimization", { method: "POST" }).catch(() => {});
        }
      }
    } catch {
      // Backend may be starting or offline
    }
  };

  useEffect(() => {
    if (activeTab === "photos") {
      loadPhotos(activeYear);
      loadTimelineYears();
    }
  }, [activeTab, activeYear]);

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
          const mapped: PhotoItem[] = data.photos.map((p) => ({
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
            loadPhotos(activeYear);
            lastPhotoCompletedCount = 0;
          }
          wasPhotoActive = photoData.is_active;
        }

        if (videoRes && videoRes.ok) {
          const videoData: VideoOptimizationProgress = await videoRes.json();
          setVideoProgress(videoData);

          // When video batch completes, reload photos & timeline
          if (wasVideoActive && !videoData.is_active) {
            loadPhotos(activeYear);
          }
          wasVideoActive = videoData.is_active;
        }

        if (importRes && importRes.ok) {
          const importData: ImportProgressState = await importRes.json();
          setImportProgress(importData);

          // When media import batch completes, refresh library photos & timeline
          if (wasImportActive && !importData.is_active) {
            loadPhotos(activeYear);
            loadTimelineYears();
          }
          wasImportActive = importData.is_active;
        }
      } catch {}
    }, 1000);

    return () => clearInterval(interval);
  }, [activeYear]);

  // Updater and diagnostics state
  const [activeUpdate, setActiveUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  // Fetch prerequisites helper with silent background engine auto-start
  const fetchPrerequisites = async () => {
    try {
      const prereqs = await invoke<SystemPrerequisites>("check_system_prerequisites");
      setPrerequisites(prereqs);
      
      // If Python is available and engine not yet running, auto-trigger background start
      if (prereqs && prereqs.python.installed && !prereqs.backend.running) {
        invoke("start_backend_engine").catch(() => {});
      }
    } catch (err) {
      console.warn("System prerequisites check warning:", err);
    }
  };

  // Run diagnostics and check for updates on application mount
  useEffect(() => {
    fetchPrerequisites();

    // Check for updates in background with safe fallback
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
  }, [setPrerequisites]);

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
    loadTimelineYears();
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
        loadTimelineYears();
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
        loadTimelineYears();
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
        loadPhotos(activeYear);
        loadTimelineYears();
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
        const photo = photos.find((p) => p.id === id);
        const filename = photo?.filename || `photo_${id}.jpg`;
        const link = document.createElement("a");
        link.href = getApiUrl(`/api/photos/${id}/download`);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, idx * 250);
    });
  };

  const selectedCount = selectedPhotoIds.size;

  const selectedPhotosList = useMemo(
    () => photos.filter((p) => selectedPhotoIds.has(p.id)),
    [photos, selectedPhotoIds]
  );
  const hasVideoSelected = useMemo(
    () => selectedPhotosList.some((p) => p.mime_type?.startsWith("video/")),
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
      {/* Frameless Window Custom Title Bar */}
      <TitleBar 
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

      {/* Main Content Layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Navigation Sidebar */}
        <Sidebar />

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
              onTogglePin={handleTogglePin}
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

              {/* macOS Liquid Glass Floating Header Toolbar */}
              <div 
                className="liquid-glass-toolbar"
                style={{
                  margin: "14px 20px 8px 20px",
                  padding: "12px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "var(--glass-surface)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--glass-shadow)",
                  position: "sticky",
                  top: 0,
                  zIndex: 20,
                  flexShrink: 0,
                }}
              >
                {/* Left Column (flex: 1): Status / Live Optimization Badge */}
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px", minWidth: "120px" }}>
                  {searchQuery.trim() ? (
                    <span 
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 10px",
                        borderRadius: "var(--radius-full)",
                        fontSize: "11px",
                        fontWeight: 600,
                        backgroundColor: "rgba(59, 130, 246, 0.12)",
                        color: "var(--accent-primary)",
                        border: "1px solid rgba(59, 130, 246, 0.25)",
                      }}
                    >
                      <Search size={12} style={{ color: "var(--accent-primary)" }} />
                      Search Active
                    </span>
                  ) : importProgress?.is_active ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span 
                        title={importProgress.current_filename ? `Ingesting: ${importProgress.current_filename}` : undefined}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 10px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "rgba(59, 130, 246, 0.12)",
                          border: "1px solid rgba(59, 130, 246, 0.25)",
                          fontSize: "11px",
                          color: "var(--accent-primary)",
                          fontWeight: 600,
                        }}
                      >
                        <Loader2 size={12} className="spin" />
                        {importProgress.album_name
                          ? `Adding to "${importProgress.album_name}" (${importProgress.completed_count} of ${importProgress.total_count})`
                          : `Importing (${importProgress.completed_count} of ${importProgress.total_count})`}
                      </span>
                    </div>
                  ) : videoProgress?.is_active ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span 
                        title={videoProgress.active_filename ? `Processing: ${videoProgress.active_filename}` : undefined}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 10px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "var(--glass-badge-bg)",
                          border: "1px solid var(--glass-badge-border)",
                          fontSize: "11px",
                          color: "var(--accent-primary)",
                          fontWeight: 600,
                        }}
                      >
                        <Loader2 size={12} className="spin" />
                        {videoProgress.total_count > 1
                          ? `Optimizing video (${videoProgress.completed_count + 1} of ${videoProgress.total_count}): ${videoProgress.active_filename || "Transcoding"}`
                          : `Optimizing video: ${videoProgress.active_filename || "Transcoding"}`}
                      </span>
                    </div>
                  ) : optimizationProgress?.is_active ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span 
                        title={optimizationProgress.active_filename ? `Processing: ${optimizationProgress.active_filename}` : undefined}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 10px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "var(--glass-badge-bg)",
                          border: "1px solid var(--glass-badge-border)",
                          fontSize: "11px",
                          color: "var(--accent-primary)",
                          fontWeight: 600,
                        }}
                      >
                        <Loader2 size={12} className="spin" />
                        {optimizationProgress.completed_count >= optimizationProgress.total_count
                          ? `Finishing enhancements (${optimizationProgress.completed_count} of ${optimizationProgress.total_count})`
                          : `Optimizing photo quality (${optimizationProgress.completed_count + 1} of ${optimizationProgress.total_count})`}
                      </span>
                    </div>
                  ) : (
                    <span 
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 10px",
                        borderRadius: "var(--radius-full)",
                        fontSize: "11px",
                        fontWeight: 600,
                        backgroundColor: "rgba(59, 130, 246, 0.12)",
                        color: "var(--accent-primary)",
                        border: "1px solid rgba(59, 130, 246, 0.25)",
                      }}
                    >
                      <Images size={12} style={{ color: "var(--accent-primary)" }} />
                      Library Collection
                    </span>
                  )}
                </div>

                {/* Center Column (flex: 0 1 auto): 22px Plus Jakarta Sans Title + Baseline Capsule */}
                <div 
                  style={{ 
                    flex: "0 1 auto", 
                    display: "flex", 
                    alignItems: "baseline", 
                    justifyContent: "center", 
                    gap: "10px",
                    minWidth: 0,
                  }}
                >
                  <h1 
                    style={{ 
                      fontSize: "22px", 
                      fontWeight: 800, 
                      letterSpacing: "-0.03em", 
                      margin: 0,
                      color: "var(--text-primary)",
                      fontFamily: "Plus Jakarta Sans, sans-serif",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {searchQuery.trim() ? "Search Results" : "Photos"}
                  </h1>
                  <span 
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "2px 8px",
                      borderRadius: "var(--radius-full)",
                      fontSize: "11px",
                      fontWeight: 700,
                      backgroundColor: "var(--glass-badge-bg)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--glass-badge-border)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {isSearchLoading ? "Searching..." : `${displayedPhotos.length.toLocaleString()} ${displayedPhotos.length === 1 ? "photo" : "photos"}`}
                  </span>
                </div>

                {/* Right Column (flex: 1): Global Action Pills */}
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", minWidth: "120px" }}>
                  {searchQuery.trim() ? (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="clickable"
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
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <X size={14} />
                      Clear Search
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setIsImportModalOpen(true)}
                        className="clickable"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 16px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "var(--accent-primary)",
                          border: "none",
                          color: "#ffffff",
                          fontSize: "12px",
                          fontWeight: 600,
                          boxShadow: "0 2px 10px rgba(59, 130, 246, 0.25)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Plus size={15} />
                        Import Media
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Scalable Data-Driven Timeline Year Filter Ribbon with Chevrons & Edge Fade */}
              {!searchQuery.trim() && (
                <div 
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 20px",
                    fontSize: "12px",
                    borderBottom: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--glass-surface)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    position: "relative",
                  }}
                >
                  {/* Left Pinned Action Group (Timeline label + All Years pill) */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--text-muted)", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", marginRight: "2px" }}>
                      <Calendar size={13} style={{ color: "var(--accent-primary)" }} />
                      <span>Timeline:</span>
                    </div>

                    {/* All Years Pill */}
                    <button
                      className="clickable"
                      onClick={() => setActiveYear("All Years")}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        background: activeYear === "All Years" ? "var(--glass-pill-active)" : "var(--glass-pill-bg)",
                        color: activeYear === "All Years" ? "var(--text-primary)" : "var(--text-secondary)",
                        border: activeYear === "All Years" ? "1px solid var(--glass-border-highlight)" : "1px solid var(--glass-pill-border)",
                        padding: "4px 12px",
                        borderRadius: "var(--radius-full)",
                        fontSize: "11px",
                        fontWeight: activeYear === "All Years" ? 600 : 500,
                        flexShrink: 0,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span>All</span>
                    </button>
                  </div>

                  {/* Subtle Vertical Glass Divider */}
                  {timelineData.years.length > 0 && (
                    <div style={{ width: "1px", height: "18px", backgroundColor: "var(--glass-border-highlight)", flexShrink: 0 }} />
                  )}

                  {/* Scrollable Years Track with Chevrons and Edge Fade */}
                  {timelineData.years.length > 0 && (
                    <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
                      {/* Left Scroll Chevron */}
                      {canScrollLeft && (
                        <button
                          onClick={() => scrollTimeline(-240)}
                          className="clickable"
                          title="Scroll earlier years"
                          style={{
                            position: "absolute",
                            left: "2px",
                            zIndex: 10,
                            width: "28px",
                            height: "28px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "var(--glass-surface)",
                            backdropFilter: "blur(16px)",
                            WebkitBackdropFilter: "blur(16px)",
                            border: "1px solid var(--glass-border-highlight)",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--text-primary)",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <ChevronLeft size={15} />
                        </button>
                      )}

                      {/* Scrollable Track */}
                      <div 
                        ref={timelineRibbonRef}
                        onScroll={checkTimelineScroll}
                        onWheel={(e) => {
                          if (e.deltaY !== 0) {
                            e.currentTarget.scrollLeft += e.deltaY;
                            checkTimelineScroll();
                          }
                        }}
                        style={{ 
                          display: "flex", 
                          alignItems: "center", 
                          gap: "8px", 
                          overflowX: "auto", 
                          whiteSpace: "nowrap", 
                          scrollbarWidth: "none", 
                          padding: "4px 8px", 
                          width: "100%",
                          maskImage: canScrollLeft && canScrollRight
                            ? "linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)"
                            : canScrollRight
                            ? "linear-gradient(to right, black calc(100% - 32px), transparent)"
                            : canScrollLeft
                            ? "linear-gradient(to right, transparent, black 32px)"
                            : "none",
                          WebkitMaskImage: canScrollLeft && canScrollRight
                            ? "linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)"
                            : canScrollRight
                            ? "linear-gradient(to right, black calc(100% - 32px), transparent)"
                            : canScrollLeft
                            ? "linear-gradient(to right, transparent, black 32px)"
                            : "none",
                        }}
                      >
                        {timelineData.years.map((item) => {
                          const isActive = activeYear === item.year;
                          return (
                            <button
                              key={item.year}
                              className="clickable"
                              onClick={() => setActiveYear(item.year)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                background: isActive ? "var(--glass-pill-active)" : "var(--glass-pill-bg)",
                                color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                                border: isActive ? "1px solid var(--glass-border-highlight)" : "1px solid var(--glass-pill-border)",
                                padding: "4px 12px",
                                borderRadius: "var(--radius-full)",
                                fontSize: "11px",
                                fontWeight: isActive ? 600 : 500,
                                flexShrink: 0,
                                transition: "all 0.15s ease",
                              }}
                            >
                              <span>{item.year}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Right Scroll Chevron */}
                      {canScrollRight && (
                        <button
                          onClick={() => scrollTimeline(240)}
                          className="clickable"
                          title="Scroll later years"
                          style={{
                            position: "absolute",
                            right: "2px",
                            zIndex: 10,
                            width: "28px",
                            height: "28px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "var(--glass-surface)",
                            backdropFilter: "blur(16px)",
                            WebkitBackdropFilter: "blur(16px)",
                            border: "1px solid var(--glass-border-highlight)",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--text-primary)",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <ChevronRight size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Contextual In-Place Import Progress Banner (Photos Library) */}
              {importProgress?.is_active && !importProgress.album_id && (
                <div
                  style={{
                    margin: "0 24px 16px 24px",
                    padding: "12px 18px",
                    backgroundColor: "var(--glass-surface)",
                    backdropFilter: "blur(24px)",
                    WebkitBackdropFilter: "blur(24px)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "var(--radius-lg)",
                    boxShadow: "var(--glass-shadow)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <Loader2 size={16} className="spin" style={{ color: "var(--accent-primary)" }} />
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                        Ingesting media into Library ({importProgress.completed_count} of {importProgress.total_count})
                      </span>
                      {importProgress.current_filename && (
                        <span style={{ fontSize: "12px", color: "var(--text-muted)", maxWidth: "320px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          • {importProgress.current_filename}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--accent-primary)" }}>
                      {importProgress.total_count > 0 ? Math.round((importProgress.completed_count / importProgress.total_count) * 100) : 0}%
                    </span>
                  </div>
                  <div style={{ width: "100%", height: "4px", backgroundColor: "var(--border-subtle)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${importProgress.total_count > 0 ? Math.round((importProgress.completed_count / importProgress.total_count) * 100) : 0}%`,
                        height: "100%",
                        backgroundColor: "var(--accent-primary)",
                        borderRadius: "var(--radius-full)",
                        transition: "width 0.2s ease",
                      }}
                    />
                  </div>
                </div>
              )}

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
                <PhotoGrid 
                  photos={displayedPhotos} 
                  optimizationProgress={optimizationProgress}
                  videoProgress={videoProgress}
                  onPhotoClick={(idx) => {
                    setLightboxPhotos(displayedPhotos);
                    setLightboxIndex(idx);
                  }} 
                  onImportClick={() => setIsImportModalOpen(true)}
                  onToggleFavorite={handleToggleFavorite}
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
                    backgroundColor: "rgba(59, 130, 246, 0.15)",
                    color: "var(--accent-primary)",
                    border: "1px solid rgba(59, 130, 246, 0.3)",
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
                  title={selectedCount === displayedPhotos.length ? "Deselect all items" : "Select all items in current view"}
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
                  {selectedCount === photos.length ? "Deselect All" : "Select All"}
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
            loadPhotos(activeYear);
            loadTimelineYears();
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
          loadPhotos(activeYear);
          loadTimelineYears();
        }}
      />

      {/* Add Selected Photos to Album Modal */}
      <AddToAlbumModal
        isOpen={isAddToAlbumModalOpen}
        selectedPhotoIds={Array.from(selectedPhotoIds)}
        onClose={() => setIsAddToAlbumModalOpen(false)}
        onSuccess={() => {
          clearSelection();
          loadPhotos(activeYear);
          loadTimelineYears();
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
        photos={lightboxPhotos ?? displayedPhotos}
        currentIndex={lightboxIndex ?? 0}
        isOpen={lightboxIndex !== null}
        optimizationProgress={optimizationProgress}
        onClose={() => {
          setLightboxIndex(null);
          setLightboxPhotos(null);
        }}
        onNavigate={(idx) => setLightboxIndex(idx)}
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
            loadPhotos(activeYear);
            loadTimelineYears();
            if (lightboxPhotos) {
              setLightboxPhotos((prev) => (prev ? prev.filter((p) => p.id !== photoId) : null));
            }
          } else {
            setPhotos((prev) => prev.filter((p) => p.id !== photoId));
            loadTimelineYears();
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
