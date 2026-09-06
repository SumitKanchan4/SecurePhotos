import React, { useState, useEffect } from "react";
import { 
  Sparkles, 
  Lock, 
  Plus, 
  FolderSync, 
  LayoutGrid,
  Loader2,
  Trash2,
  Calendar
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
import { PeopleView } from "./components/PeopleView";
import { AlbumsView } from "./components/AlbumsView";
import { DocumentsView } from "./components/DocumentsView";
import { TrashView } from "./components/TrashView";
import { SettingsView } from "./components/SettingsView";
import { CollageModal } from "./components/CollageModal";
import { UpdateModal } from "./components/UpdateModal";
import { useAppStore } from "./store/useAppStore";
import { PhotoItem, SystemPrerequisites, OptimizationProgress, TimelineYearsData } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { check, Update } from "@tauri-apps/plugin-updater";

export const App: React.FC = () => {
  const { 
    activeTab, 
    toggleTheme, 
    selectedPhotoIds, 
    clearSelection,
    setActiveVolume,
    isVaultUnlocked,
    setIsVaultUnlocked,
    setPrerequisites,
    setTotalPhotosCount,
  } = useAppStore();

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [activeYear, setActiveYear] = useState<string>("All Years");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isVaultUnlockModalOpen, setIsVaultUnlockModalOpen] = useState(false);
  const [isCollageModalOpen, setIsCollageModalOpen] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [optimizationProgress, setOptimizationProgress] = useState<OptimizationProgress | null>(null);
  const [timelineData, setTimelineData] = useState<TimelineYearsData>({ total_count: 0, years: [] });

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

        // Auto-trigger background 8K optimization queue if unoptimized items exist
        const hasUnoptimized = data.some((p: PhotoItem) => !p.is_optimized);
        if (hasUnoptimized) {
          fetch("http://127.0.0.1:8000/api/photos/start-optimization", { method: "POST" }).catch(() => {});
        }
      }
    } catch {
      // Backend may be starting or offline
    }
  };

  useEffect(() => {
    loadPhotos(activeYear);
    loadTimelineYears();
  }, [activeYear]);

  // Real-time polling for background 4K optimization progress
  useEffect(() => {
    let wasActive = false;
    let lastCompletedCount = 0;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("http://127.0.0.1:8000/api/photos/optimization-progress");
        if (res.ok) {
          const data: OptimizationProgress = await res.json();
          setOptimizationProgress(data);

          // If an individual photo just finished optimizing, immediately update its 4K badge & refresh
          if (data.completed_count > lastCompletedCount) {
            lastCompletedCount = data.completed_count;
            if (data.last_completed_photo_id) {
              setPhotos((prev) =>
                prev.map((p) =>
                  p.id === data.last_completed_photo_id
                    ? { ...p, is_optimized: true, is_enhanced: true }
                    : p
                )
              );
            }
            loadPhotos(activeYear);
          }

          // If the entire active batch completed, reload photos list
          if (wasActive && !data.is_active) {
            loadPhotos(activeYear);
            lastCompletedCount = 0;
          }
          wasActive = data.is_active;
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
        clearSelection();
        loadTimelineYears();
      }
    } catch (err) {
      console.error("Batch delete failed:", err);
    }
  };

  const selectedCount = selectedPhotoIds.size;

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
            overflow: "hidden" 
          }}
        >
          {activeTab === "vault" ? (
            /* Dedicated Zero-Trust Private Vault Gallery */
            <VaultView 
              onUnlockRequest={() => setIsVaultUnlockModalOpen(true)}
              onPhotoClick={(idx) => setLightboxIndex(idx)}
            />
          ) : activeTab === "albums" ? (
            /* Albums Grid & Management */
            <AlbumsView 
              onLockAlbumToVault={() => setIsVaultUnlockModalOpen(true)}
            />
          ) : activeTab === "people" ? (
            /* People Management & Representative Medoid Tagging View */
            <PeopleView />
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
            /* Stories Hub & Insights */
            <div style={{ flex: 1, overflowY: "auto", padding: "10px" }}>
              {photos.length > 0 ? (
                <StoriesCarousel onPlayStory={(id) => setActiveStoryId(id)} />
              ) : (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>
                  <p>Import photos into your library to generate AI-curated stories and milestone moments.</p>
                </div>
              )}
            </div>
          ) : (
            /* Standard Photos & Media Grid View */
            <>
              {/* Stories Highlight Bar on Home View */}
              {photos.length > 0 && <StoriesCarousel onPlayStory={(id) => setActiveStoryId(id)} />}

              {/* View Header Toolbar */}
              <div 
                style={{
                  padding: "12px 20px 8px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <div>
                  <h1 style={{ fontSize: "18px", fontWeight: 700, textTransform: "capitalize", letterSpacing: "-0.3px" }}>
                    All Photos & Videos
                  </h1>
                  {photos.length === 0 ? (
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                      No photos yet • Import a folder to begin
                    </p>
                  ) : optimizationProgress?.is_active ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        {photos.length.toLocaleString()} media items
                      </span>
                      <span 
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "3px 10px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "rgba(59, 130, 246, 0.12)",
                          border: "1px solid rgba(59, 130, 246, 0.35)",
                          fontSize: "11px",
                          color: "var(--accent-primary)",
                          fontWeight: 600,
                        }}
                      >
                        <Loader2 size={12} className="spin" />
                        8K ULTRA Optimization: Processing {optimizationProgress.active_filename || "media"} ({optimizationProgress.completed_count}/{optimizationProgress.total_count}) • {optimizationProgress.item_progress}%
                      </span>
                      <div style={{ width: "80px", height: "4px", backgroundColor: "var(--bg-surface-elevated)", borderRadius: "2px", overflow: "hidden" }}>
                        <div 
                          style={{ 
                            height: "100%", 
                            width: `${optimizationProgress.item_progress}%`, 
                            backgroundColor: "var(--accent-primary)", 
                            transition: "width 0.2s ease" 
                          }} 
                        />
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                      {`${photos.length.toLocaleString()} media items • 8K ULTRA Space-Saver Active`}
                    </p>
                  )}
                </div>

                {/* Selection & Batch Action Toolbar */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {selectedCount > 0 ? (
                    <>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent-primary)", marginRight: "6px" }}>
                        {selectedCount} selected
                      </span>
                      <button
                        onClick={() => setIsCollageModalOpen(true)}
                        className="clickable"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--bg-surface)",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          fontWeight: 500,
                        }}
                      >
                        <LayoutGrid size={14} />
                        8K Collage
                      </button>
                      <button
                        className="clickable"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--accent-primary)",
                          border: "none",
                          color: "#ffffff",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        <Sparkles size={14} />
                        Enhance to 8K ULTRA
                      </button>
                      <button
                        onClick={() => setIsVaultUnlockModalOpen(true)}
                        className="clickable"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--accent-vault)",
                          border: "none",
                          color: "#ffffff",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        <Lock size={14} />
                        Move to Vault (L)
                      </button>
                      <button
                        onClick={handleBatchDelete}
                        className="clickable"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--bg-surface)",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--accent-danger, #ef4444)",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                        title="Move selected photos to trash"
                      >
                        <Trash2 size={14} />
                        Move to Trash
                      </button>
                      <button
                        onClick={clearSelection}
                        className="clickable"
                        style={{
                          padding: "6px 10px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--bg-surface)",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--text-secondary)",
                          fontSize: "12px",
                        }}
                      >
                        Clear
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="clickable"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--bg-surface)",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          fontWeight: 500,
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
                          padding: "6px 14px",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--accent-primary)",
                          border: "none",
                          color: "#ffffff",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        <Plus size={15} />
                        Import Media
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Scalable Data-Driven Timeline Year Filter Ribbon */}
              <div 
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 20px",
                  fontSize: "12px",
                  borderBottom: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-sidebar)",
                  overflowX: "auto",
                  whiteSpace: "nowrap",
                  scrollbarWidth: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--text-muted)", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0, marginRight: "4px" }}>
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
                    background: activeYear === "All Years" ? "var(--accent-primary)" : "rgba(255, 255, 255, 0.04)",
                    color: activeYear === "All Years" ? "#ffffff" : "var(--text-secondary)",
                    border: activeYear === "All Years" ? "1px solid transparent" : "1px solid var(--border-subtle)",
                    padding: "3px 10px",
                    borderRadius: "var(--radius-full)",
                    fontSize: "11px",
                    fontWeight: activeYear === "All Years" ? 600 : 500,
                    flexShrink: 0,
                    transition: "all 0.15s ease",
                  }}
                >
                  <span>All</span>
                  {timelineData.total_count > 0 && (
                    <span 
                      style={{ 
                        fontSize: "10px", 
                        opacity: activeYear === "All Years" ? 0.9 : 0.6,
                        backgroundColor: activeYear === "All Years" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)",
                        padding: "1px 5px",
                        borderRadius: "10px",
                      }}
                    >
                      {timelineData.total_count.toLocaleString()}
                    </span>
                  )}
                </button>

                {/* Dynamic Active Years Pills (Only years with photos) */}
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
                        background: isActive ? "var(--accent-primary)" : "rgba(255, 255, 255, 0.04)",
                        color: isActive ? "#ffffff" : "var(--text-secondary)",
                        border: isActive ? "1px solid transparent" : "1px solid var(--border-subtle)",
                        padding: "3px 10px",
                        borderRadius: "var(--radius-full)",
                        fontSize: "11px",
                        fontWeight: isActive ? 600 : 500,
                        flexShrink: 0,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span>{item.year}</span>
                      <span 
                        style={{ 
                          fontSize: "10px", 
                          opacity: isActive ? 0.9 : 0.6,
                          backgroundColor: isActive ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)",
                          padding: "1px 5px",
                          borderRadius: "10px",
                        }}
                      >
                        {item.count.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 60 FPS Virtualized Grid / Empty State */}
              <PhotoGrid 
                photos={photos} 
                optimizationProgress={optimizationProgress}
                onPhotoClick={(idx) => setLightboxIndex(idx)} 
                onImportClick={() => setIsImportModalOpen(true)}
              />
            </>
          )}
        </main>
      </div>

      {/* Floating External Drive Status Banner */}
      <DriveStatusBanner />

      {/* Interactive Import Modal */}
      <ImportModal 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        onImportComplete={() => {
          loadPhotos(activeYear);
          loadTimelineYears();
        }}
      />

      {/* Vault Unlock Modal */}
      <VaultUnlockModal
        isOpen={isVaultUnlockModalOpen}
        onClose={() => setIsVaultUnlockModalOpen(false)}
      />

      {/* 4K Mosaic Collage Generator Modal */}
      <CollageModal
        isOpen={isCollageModalOpen}
        onClose={() => setIsCollageModalOpen(false)}
        selectedCount={selectedCount}
      />

      {/* Cinematic Story Player Modal */}
      <StoryPlayerModal
        storyId={activeStoryId}
        isOpen={activeStoryId !== null}
        onClose={() => setActiveStoryId(null)}
      />

      {/* Immersive Fluid Lightbox */}
      <Lightbox
        photos={photos}
        currentIndex={lightboxIndex ?? 0}
        isOpen={lightboxIndex !== null}
        optimizationProgress={optimizationProgress}
        onClose={() => setLightboxIndex(null)}
        onNavigate={(idx) => setLightboxIndex(idx)}
        onDelete={handleDeletePhoto}
      />

      {/* Confirmed Update Interactive Modal */}
      {activeUpdate && (
        <UpdateModal
          update={activeUpdate}
          isOpen={isUpdateModalOpen}
          onClose={() => setIsUpdateModalOpen(false)}
        />
      )}
    </div>
  );
};
