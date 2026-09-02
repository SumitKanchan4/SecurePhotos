import React, { useState, useEffect } from "react";
import { 
  Sparkles, 
  Lock, 
  Plus, 
  FolderSync, 
  LayoutGrid 
} from "lucide-react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { PhotoGrid, generateMockPhotos } from "./components/PhotoGrid";
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
import { useAppStore } from "./store/useAppStore";
import { PhotoItem } from "./types";

export const App: React.FC = () => {
  const { 
    activeTab, 
    toggleTheme, 
    selectedPhotoIds, 
    clearSelection,
    setActiveVolume,
    isVaultUnlocked,
    setIsVaultUnlocked,
  } = useAppStore();

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isVaultUnlockModalOpen, setIsVaultUnlockModalOpen] = useState(false);
  const [isCollageModalOpen, setIsCollageModalOpen] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Initialize and register global desktop keyboard shortcuts
  useEffect(() => {
    // Generate initial media dataset
    setPhotos(generateMockPhotos(1200));

    // Set active volume info
    setActiveVolume({
      drive_letter: "E:\\",
      volume_name: "Samsung_T7",
      volume_serial: "7F2A-91C4",
      file_system: "NTFS",
      is_ready: true,
      free_bytes: 420 * 1024 * 1024 * 1024,
      total_bytes: 1000 * 1024 * 1024 * 1024,
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
              <StoriesCarousel onPlayStory={(id) => setActiveStoryId(id)} />
            </div>
          ) : (
            /* Standard Photos & Media Grid View */
            <>
              {/* Stories Highlight Bar on Home View */}
              <StoriesCarousel onPlayStory={(id) => setActiveStoryId(id)} />

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
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                    12,482 media items • 4K Space-Saver Mode Active (-62% disk space saved)
                  </p>
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
                        4K Collage
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
                        Enhance to 4K
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

              {/* Timeline Year Filter Bar */}
              <div 
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 20px",
                  fontSize: "12px",
                  borderBottom: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-sidebar)",
                }}
              >
                <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Timeline:</span>
                {["2026", "2025", "2024", "2023", "2022", "All Years"].map((year, idx) => (
                  <button
                    key={year}
                    className="clickable"
                    style={{
                      background: idx === 0 ? "var(--accent-primary)" : "transparent",
                      color: idx === 0 ? "#ffffff" : "var(--text-secondary)",
                      border: "none",
                      padding: "3px 10px",
                      borderRadius: "var(--radius-full)",
                      fontSize: "11px",
                      fontWeight: idx === 0 ? 600 : 400,
                    }}
                  >
                    {year}
                  </button>
                ))}
              </div>

              {/* 60 FPS Virtualized Grid */}
              <PhotoGrid 
                photos={photos} 
                onPhotoClick={(idx) => setLightboxIndex(idx)} 
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
        onClose={() => setLightboxIndex(null)}
        onNavigate={(idx) => setLightboxIndex(idx)}
      />
    </div>
  );
};
