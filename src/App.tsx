import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { 
  Lock, 
  Plus, 
  FolderSync, 
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
import { PhotoItem, SystemPrerequisites, OptimizationProgress, VideoOptimizationProgress, TimelineYearsData } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { check, Update } from "@tauri-apps/plugin-updater";

export const App: React.FC = () => {
  const { 
    activeTab, 
    setActiveTab,
    toggleTheme, 
    selectedPhotoIds, 
    clearSelection,
    setActiveVolume,
    isVaultUnlocked,
    setIsVaultUnlocked,
    setPrerequisites,
    setTotalPhotosCount,
    showToast,
  } = useAppStore();


  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [activeYear, setActiveYear] = useState<string>("All Years");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isVaultUnlockModalOpen, setIsVaultUnlockModalOpen] = useState(false);
  const [isCollageModalOpen, setIsCollageModalOpen] = useState(false);
  const [isAddToAlbumModalOpen, setIsAddToAlbumModalOpen] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxPhotos, setLightboxPhotos] = useState<PhotoItem[] | null>(null);
  const [optimizationProgress, setOptimizationProgress] = useState<OptimizationProgress | null>(null);
  const [videoProgress, setVideoProgress] = useState<VideoOptimizationProgress | null>(null);
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
      const res = await fetch("http://127.0.0.1:8000/api/photos/timeline-years");
      if (res.ok) {
        const data: TimelineYearsData = await res.json();
        setTimelineData(data);
      }
    } catch {}
  };

  // Load photos from engine with optional Year or Undated filtering
  const loadPhotos = async (selectedYear: string = activeYear) => {
    try {
      let url = "http://127.0.0.1:8000/api/photos?limit=500";
      if (selectedYear === "Undated") {
        url += "&year=Undated";
      } else if (selectedYear && selectedYear !== "All Years") {
        url += `&year=${selectedYear}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setPhotos(data);
        setTotalPhotosCount(data.length);

        // Auto-trigger background 512px Retina thumbnail regeneration once on load
        if (!hasRegeneratedThumbnailsRef.current && data.length > 0) {
          hasRegeneratedThumbnailsRef.current = true;
          fetch("http://127.0.0.1:8000/api/photos/regenerate-thumbnails", { method: "POST" }).catch(() => {});
        }

        // Auto-trigger background 8K optimization queue ONLY for photos (not videos)
        const hasUnoptimizedPhotos = data.some(
          (p: PhotoItem) => !p.is_optimized && (!p.mime_type || !p.mime_type.startsWith("video/"))
        );
        if (hasUnoptimizedPhotos) {
          fetch("http://127.0.0.1:8000/api/photos/start-optimization", { method: "POST" }).catch(() => {});
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

  // Real-time polling for background photo 8K & video optimization progress
  useEffect(() => {
    let wasPhotoActive = false;
    let wasVideoActive = false;
    let lastPhotoCompletedCount = 0;

    const interval = setInterval(async () => {
      try {
        const [photoRes, videoRes] = await Promise.all([
          fetch("http://127.0.0.1:8000/api/photos/optimization-progress").catch(() => null),
          fetch("http://127.0.0.1:8000/api/videos/optimization-progress").catch(() => null),
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
          fetch("http://127.0.0.1:8000/api/vault/lock", { method: "POST" }).catch(() => {});
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
    loadTimelineYears();
    if (lightboxIndex !== null) {
      if (photos.length <= 1) {
        setLightboxIndex(null);
      } else if (lightboxIndex >= photos.length - 1) {
        setLightboxIndex(Math.max(0, photos.length - 2));
      }
    }
  };

  const handleToggleFavorite = async (photoId: number) => {
    // Optimistically update photos in library
    setPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p))
    );
    // Optimistically update photos in active lightbox if present
    if (lightboxPhotos) {
      setLightboxPhotos((prev) =>
        prev ? prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p)) : null
      );
    }
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/photos/${photoId}/toggle-favorite`, {
        method: "POST",
      });
      if (!res.ok) {
        // Rollback on non-200
        setPhotos((prev) =>
          prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p))
        );
      }
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
      // Rollback on network failure
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p))
      );
    }
  };

  const handleBatchDelete = async () => {
    if (selectedPhotoIds.size === 0) return;
    const ids = Array.from(selectedPhotoIds);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/photos/batch-trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (res.ok) {
        setPhotos((prev) => prev.filter((p) => !selectedPhotoIds.has(p.id)));
        showToast(`Moved ${ids.length} photo(s) to Trash (held for 30 days)`, "info");
        clearSelection();
        loadTimelineYears();
      }
    } catch (err) {
      console.error("Batch delete failed:", err);
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
        link.href = `http://127.0.0.1:8000/api/photos/${id}/download`;
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
      <TitleBar />

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
              onPhotoClick={(idx) => setLightboxIndex(idx)}
            />
          ) : activeTab === "albums" ? (
            /* Albums Grid & Management */
            <AlbumsView 
              onLockAlbumToVault={() => setIsVaultUnlockModalOpen(true)}
              onPhotoClick={(idx, albumPhotos) => {
                setLightboxPhotos(albumPhotos);
                setLightboxIndex(idx);
              }}
              onToggleFavorite={handleToggleFavorite}
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
            <DocumentsView />
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
                  {videoProgress?.is_active ? (
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
                    Photos
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
                    {photos.length.toLocaleString()} {photos.length === 1 ? "photo" : "photos"}
                  </span>
                </div>

                {/* Right Column (flex: 1): Global Action Pills */}
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", minWidth: "120px" }}>
                  <button
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
                    <FolderSync size={14} />
                    Sync Folder
                  </button>
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
                </div>
              </div>

              {/* Scalable Data-Driven Timeline Year Filter Ribbon with Chevrons & Edge Fade */}
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

              {/* 60 FPS Virtualized Grid / Empty State */}
              <PhotoGrid 
                photos={photos} 
                optimizationProgress={optimizationProgress}
                videoProgress={videoProgress}
                onPhotoClick={(idx) => {
                  setLightboxPhotos(null);
                  setLightboxIndex(idx);
                }} 
                onImportClick={() => setIsImportModalOpen(true)}
                onToggleFavorite={handleToggleFavorite}
              />

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
                    if (selectedCount === photos.length) {
                      clearSelection();
                    } else {
                      const allIds = new Set(photos.map((p) => p.id));
                      useAppStore.setState({ selectedPhotoIds: allIds });
                    }
                  }}
                  className="clickable"
                  title={selectedCount === photos.length ? "Deselect all items" : "Select all items in current view"}
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
                  onClick={() => setIsVaultUnlockModalOpen(true)}
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
        onClose={() => setIsVaultUnlockModalOpen(false)}
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
      />

      {/* Immersive Fluid Lightbox */}
      <Lightbox
        photos={lightboxPhotos ?? photos}
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
