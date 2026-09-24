import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  FolderHeart, 
  Plus, 
  Lock, 
  Unlock, 
  Heart, 
  HeartOff,
  Image as ImageIcon,
  ArrowLeft,
  Trash2,
  X,
  Check,
  CheckSquare,
  Loader2,
  Play,
  LayoutGrid,
  Download,
  FolderPlus,
  Sparkles,
  Film
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { AlbumItem, PhotoItem, StoryModel } from "../types";
import { AlbumSlideshowModal } from "./AlbumSlideshowModal";
import { RemoveFromAlbumModal } from "./RemoveFromAlbumModal";
import { AddToAlbumModal } from "./AddToAlbumModal";
import { CollageModal } from "./CollageModal";
import { useAppStore } from "../store/useAppStore";
import collagesDefaultCover from "../assets/covers/collages_default.jpg";

// Deterministic vibrant dual-tone gradients for empty custom albums based on name hash
const ALBUM_PALETTES = [
  { bg: "linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #065f46 100%)", glow: "#06b6d4", iconBg: "rgba(6, 182, 212, 0.25)" },
  { bg: "linear-gradient(135deg, #2e1065 0%, #581c87 40%, #831843 100%)", glow: "#ec4899", iconBg: "rgba(236, 72, 153, 0.25)" },
  { bg: "linear-gradient(135deg, #064e3b 0%, #065f46 40%, #164e63 100%)", glow: "#10b981", iconBg: "rgba(16, 185, 129, 0.25)" },
  { bg: "linear-gradient(135deg, #451a03 0%, #78350f 40%, #7f1d1d 100%)", glow: "#f59e0b", iconBg: "rgba(245, 158, 11, 0.25)" },
  { bg: "linear-gradient(135deg, #172554 0%, #1e3a8a 40%, #312e81 100%)", glow: "#60a5fa", iconBg: "rgba(96, 165, 250, 0.25)" },
  { bg: "linear-gradient(135deg, #4c0519 0%, #881337 40%, #4a044e 100%)", glow: "#f43f5e", iconBg: "rgba(244, 63, 94, 0.25)" },
];

const getAlbumPalette = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ALBUM_PALETTES[Math.abs(hash) % ALBUM_PALETTES.length];
};

interface AlbumsViewProps {
  onLockAlbumToVault?: (albumId: number, isVault?: boolean) => void;
  onPhotoClick?: (idx: number, albumPhotos: PhotoItem[]) => void;
  onToggleFavorite?: (photoId: number) => void;
  onPlayStory?: (storyId: number) => void;
}

export const AlbumsView: React.FC<AlbumsViewProps> = ({
  onLockAlbumToVault,
  onPhotoClick,
  onToggleFavorite,
  onPlayStory,
}) => {
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingAlbum, setIsCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [failedCoverIds, setFailedCoverIds] = useState<Set<number>>(new Set());

  // Favorites Smart Album State
  const [favoriteCount, setFavoriteCount] = useState<number>(0);
  const [favoriteCoverId, setFavoriteCoverId] = useState<number | null>(null);

  // Saved Stories Smart Album State
  const [savedStories, setSavedStories] = useState<StoryModel[]>([]);
  const albumFileInputRef = useRef<HTMLInputElement>(null);

  // Album Detail View State
  const [activeAlbumId, setActiveAlbumId] = useState<number | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<PhotoItem[]>([]);
  const [activeAlbumMeta, setActiveAlbumMeta] = useState<AlbumItem | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  // Multi-Selection in Album Detail
  const showToast = useAppStore((state) => state.showToast);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [selectedAlbumPhotoIds, setSelectedAlbumPhotoIds] = useState<Set<number>>(new Set());
  const [hoveredPhotoId, setHoveredPhotoId] = useState<number | null>(null);
  const [removalModalTarget, setRemovalModalTarget] = useState<{ photoIds: number[] } | null>(null);
  const [isRemovalProcessing, setIsRemovalProcessing] = useState(false);

  // Full-Screen Slideshow State
  const [isSlideshowOpen, setIsSlideshowOpen] = useState(false);

  // Modals for Album Selection Dock
  const [isCollageModalOpen, setIsCollageModalOpen] = useState(false);
  const [isAddToAlbumModalOpen, setIsAddToAlbumModalOpen] = useState(false);

  // Photo Picker to Add Photos to Current Album
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false);
  const [libraryPhotos, setLibraryPhotos] = useState<PhotoItem[]>([]);
  const [pickerSelectedIds, setPickerSelectedIds] = useState<Set<number>>(new Set());
  const [isAddingPhotos, setIsAddingPhotos] = useState(false);
  const [directImportCount, setDirectImportCount] = useState<number | null>(null);

  // Memoized selectors for selection dock
  const selectedPhotosList = useMemo(() => {
    return albumPhotos.filter((p) => selectedAlbumPhotoIds.has(p.id));
  }, [albumPhotos, selectedAlbumPhotoIds]);

  const hasVideoSelected = useMemo(() => {
    return selectedPhotosList.some((p) => p.mime_type && p.mime_type.startsWith("video/"));
  }, [selectedPhotosList]);

  const canCreateCollage = useMemo(() => {
    return selectedAlbumPhotoIds.size >= 2 && selectedAlbumPhotoIds.size <= 9 && !hasVideoSelected;
  }, [selectedAlbumPhotoIds.size, hasVideoSelected]);

  // Global Escape key listener to clear selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        selectedAlbumPhotoIds.size > 0 &&
        !isCollageModalOpen &&
        !isAddToAlbumModalOpen &&
        !removalModalTarget &&
        !isPhotoPickerOpen &&
        !isSlideshowOpen
      ) {
        setSelectedAlbumPhotoIds(new Set());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedAlbumPhotoIds, isCollageModalOpen, isAddToAlbumModalOpen, removalModalTarget, isPhotoPickerOpen, isSlideshowOpen]);

  // Batch download selected photos
  const handleBatchDownload = () => {
    if (selectedAlbumPhotoIds.size === 0) return;
    const ids = Array.from(selectedAlbumPhotoIds);
    showToast(`📥 Downloading ${ids.length} photo(s) to your computer's Downloads folder...`, "info");
    ids.forEach((id, idx) => {
      setTimeout(() => {
        const photo = albumPhotos.find((p) => p.id === id);
        const filename = photo?.filename || `photo_${id}.jpg`;
        const link = document.createElement("a");
        link.href = `http://127.0.0.1:8000/api/photos/${id}/download`;
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, idx * 150);
    });
  };

  // Batch remove from Favorites smart album (unstar)
  const handleBatchRemoveFromFavorites = async () => {
    if (selectedAlbumPhotoIds.size === 0) return;
    const ids = Array.from(selectedAlbumPhotoIds);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`http://127.0.0.1:8000/api/photos/${id}/toggle-favorite`, { method: "POST" })
        )
      );
      const unstarredSet = new Set(ids);
      setAlbumPhotos((prev) => prev.filter((p) => !unstarredSet.has(p.id)));
      setFavoriteCount((prev) => Math.max(0, prev - ids.length));
      setSelectedAlbumPhotoIds(new Set());
      showToast(`Removed ${ids.length} photo(s) from Favorites`, "info");
    } catch (err) {
      console.error("Failed to unfavorite photos:", err);
      showToast("Failed to remove some photos from Favorites", "warning");
    }
  };

  // Direct batch move to trash
  const handleBatchMoveToTrash = async () => {
    if (selectedAlbumPhotoIds.size === 0 || isRemovalProcessing) return;
    const ids = Array.from(selectedAlbumPhotoIds);
    setIsRemovalProcessing(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/photos/batch-trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (res.ok) {
        const removedSet = new Set(ids);
        setAlbumPhotos((prev) => prev.filter((p) => !removedSet.has(p.id)));
        setSelectedAlbumPhotoIds(new Set());
        if (activeAlbumId !== -1) {
          setActiveAlbumMeta((prev) =>
            prev ? { ...prev, photo_count: Math.max(0, (prev.photo_count || ids.length) - ids.length) } : null
          );
          setAlbums((prev) =>
            prev.map((a) =>
              a.id === activeAlbumId
                ? { ...a, photo_count: Math.max(0, (a.photo_count || ids.length) - ids.length) }
                : a
            )
          );
        } else {
          setFavoriteCount((prev) => Math.max(0, prev - ids.length));
        }
        showToast(`Moved ${ids.length} photo(s) to Trash (held for 30 days)`, "info");
      }
    } catch (err) {
      console.error("Failed to move photo(s) to trash:", err);
    } finally {
      setIsRemovalProcessing(false);
    }
  };

  useEffect(() => {
    loadAlbums();
  }, []);

  // Listen for real-time stories save / delete / mutate events across the app
  useEffect(() => {
    const handleStoriesChanged = () => {
      fetch("http://127.0.0.1:8000/api/stories?saved_only=true")
        .then((res) => (res.ok ? res.json() : []))
        .then((data: StoryModel[]) => setSavedStories(data))
        .catch(() => {});
    };
    window.addEventListener("stories-changed", handleStoriesChanged);
    return () => window.removeEventListener("stories-changed", handleStoriesChanged);
  }, []);

  const loadAlbums = async () => {
    setIsLoading(true);
    try {
      const [albumsRes, favsRes, storiesRes] = await Promise.all([
        fetch("http://127.0.0.1:8000/api/albums"),
        fetch("http://127.0.0.1:8000/api/photos?favorite_only=true"),
        fetch("http://127.0.0.1:8000/api/stories?saved_only=true"),
      ]);
      if (albumsRes.ok) {
        const data: AlbumItem[] = await albumsRes.json();
        setAlbums(data);
      }
      if (favsRes.ok) {
        const favs: PhotoItem[] = await favsRes.json();
        setFavoriteCount(favs.length);
        setFavoriteCoverId(favs.length > 0 ? favs[0].id : null);
      }
      if (storiesRes.ok) {
        const stData: StoryModel[] = await storiesRes.json();
        setSavedStories(stData);
      }
    } catch (err) {
      console.error("Failed to fetch albums, favorites, or stories:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAlbum = async () => {
    const trimmed = newAlbumName.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("http://127.0.0.1:8000/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const created: AlbumItem = await res.json();
        setAlbums((prev) => [created, ...prev]);
        setNewAlbumName("");
        setIsCreatingAlbum(false);
        // Automatically open the newly created album detail view
        openAlbumDetail(created.id, created);
      }
    } catch (err) {
      console.error("Failed to create album:", err);
    }
  };

  const openAlbumDetail = async (albumId: number, initialMeta?: AlbumItem) => {
    setActiveAlbumId(albumId);
    if (initialMeta) setActiveAlbumMeta(initialMeta);
    setIsDetailLoading(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${albumId}`);
      if (res.ok) {
        const data = await res.json();
        setActiveAlbumMeta(data);
        setAlbumPhotos(data.photos || []);
      }
    } catch (err) {
      console.error("Failed to load album details:", err);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleDeleteAlbum = async (albumId: number) => {
    const targetAlbum = albums.find((a) => a.id === albumId) || (activeAlbumMeta?.id === albumId ? activeAlbumMeta : null);
    if (targetAlbum?.name.toLowerCase() === "collages" || albumId === -1 || albumId === -2) {
      showToast("System smart albums cannot be deleted", "warning");
      return;
    }
    if (!window.confirm("Are you sure you want to delete this album? Photos inside will remain safe in your library.")) {
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${albumId}`, { method: "DELETE" });
      if (res.ok) {
        setAlbums((prev) => prev.filter((a) => a.id !== albumId));
        if (activeAlbumId === albumId) {
          setActiveAlbumId(null);
          setActiveAlbumMeta(null);
          setAlbumPhotos([]);
        }
      }
    } catch (err) {
      console.error("Failed to delete album:", err);
    }
  };

  const handleToggleFavorite = async (albumId: number) => {
    const targetAlbum = albums.find((a) => a.id === albumId) || (activeAlbumMeta?.id === albumId ? activeAlbumMeta : null);
    if (targetAlbum?.name.toLowerCase() === "collages" || albumId === -1 || albumId === -2) {
      showToast("System smart albums cannot be favorited", "warning");
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${albumId}/toggle-favorite`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAlbums((prev) =>
          prev.map((a) => (a.id === albumId ? { ...a, is_favorite: data.is_favorite } : a))
        );
        if (activeAlbumMeta?.id === albumId) {
          setActiveAlbumMeta((prev) => (prev ? { ...prev, is_favorite: data.is_favorite } : null));
        }
      }
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
    }
  };


  const openFavoritesAlbum = async () => {
    setActiveAlbumId(-1);
    setActiveAlbumMeta({
      id: -1,
      name: "Favorites",
      description: "All your starred and favorite photos",
      cover_photo_id: favoriteCoverId ?? undefined,
      is_vault: false,
      is_favorite: true,
      photo_count: favoriteCount,
      created_at: new Date().toISOString(),
    });
    setIsDetailLoading(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/photos?favorite_only=true");
      if (res.ok) {
        const data: PhotoItem[] = await res.json();
        setAlbumPhotos(data);
        setFavoriteCount(data.length);
        setFavoriteCoverId(data.length > 0 ? data[0].id : null);
      }
    } catch (err) {
      console.error("Failed to load favorite photos:", err);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const openSavedStoriesAlbum = () => {
    setActiveAlbumId(-2);
    setActiveAlbumMeta({
      id: -2,
      name: "Saved Stories",
      description: "Permanent cinematic story montages you've preserved",
      cover_photo_id: savedStories.length > 0 ? (savedStories[0].cover_photo_id ?? undefined) : undefined,
      is_vault: false,
      is_favorite: false,
      photo_count: savedStories.length,
      created_at: new Date().toISOString(),
    });
    setAlbumPhotos([]);
  };

  const handleSetAlbumCover = async (photoId: number) => {
    if (!activeAlbumId || activeAlbumId === -1) return;
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${activeAlbumId}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_id: photoId }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveAlbumMeta((prev) => (prev ? { ...prev, cover_photo_id: data.cover_photo_id } : null));
        setAlbums((prev) =>
          prev.map((a) => (a.id === activeAlbumId ? { ...a, cover_photo_id: data.cover_photo_id } : a))
        );
      }
    } catch (err) {
      console.error("Failed to set album cover:", err);
    }
  };

  const handleTogglePhotoFavorite = async (photoId: number) => {
    onToggleFavorite?.(photoId);

    setAlbumPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p))
    );

    if (activeAlbumId === -1) {
      setFavoriteCount((prev) => Math.max(0, prev - 1));
    }
  };

  const toggleAlbumPhotoSelection = (photoId: number) => {
    setSelectedAlbumPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const handleConfirmRemoveFromAlbumOnly = async () => {
    if (!activeAlbumId || !removalModalTarget || isRemovalProcessing) return;
    setIsRemovalProcessing(true);
    const ids = removalModalTarget.photoIds;
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${activeAlbumId}/photos/batch-remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (res.ok) {
        const removedSet = new Set(ids);
        setAlbumPhotos((prev) => prev.filter((p) => !removedSet.has(p.id)));
        setSelectedAlbumPhotoIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        setActiveAlbumMeta((prev) =>
          prev ? { ...prev, photo_count: Math.max(0, (prev.photo_count || ids.length) - ids.length) } : null
        );
        setAlbums((prev) =>
          prev.map((a) =>
            a.id === activeAlbumId
              ? { ...a, photo_count: Math.max(0, (a.photo_count || ids.length) - ids.length) }
              : a
          )
        );
        showToast(`Removed ${ids.length} photo(s) from album. They remain safe in your library.`, "info");
        setRemovalModalTarget(null);
      }
    } catch (err) {
      console.error("Failed to remove photo(s) from album:", err);
    } finally {
      setIsRemovalProcessing(false);
    }
  };

  const handleConfirmMoveToTrash = async () => {
    if (!activeAlbumId || !removalModalTarget || isRemovalProcessing) return;
    setIsRemovalProcessing(true);
    const ids = removalModalTarget.photoIds;
    try {
      const res = await fetch("http://127.0.0.1:8000/api/photos/batch-trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (res.ok) {
        const removedSet = new Set(ids);
        setAlbumPhotos((prev) => prev.filter((p) => !removedSet.has(p.id)));
        setSelectedAlbumPhotoIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        setActiveAlbumMeta((prev) =>
          prev ? { ...prev, photo_count: Math.max(0, (prev.photo_count || ids.length) - ids.length) } : null
        );
        setAlbums((prev) =>
          prev.map((a) =>
            a.id === activeAlbumId
              ? { ...a, photo_count: Math.max(0, (a.photo_count || ids.length) - ids.length) }
              : a
          )
        );
        showToast(`Moved ${ids.length} photo(s) to Trash (held for 30 days)`, "info");
        setRemovalModalTarget(null);
      }
    } catch (err) {
      console.error("Failed to move photo(s) to trash:", err);
    } finally {
      setIsRemovalProcessing(false);
    }
  };

  const openPhotoPicker = async () => {
    setPickerSelectedIds(new Set());
    setIsPhotoPickerOpen(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/photos?limit=500");
      if (res.ok) {
        const all: PhotoItem[] = await res.json();
        // Filter out photos that are already in this album
        const existingIds = new Set(albumPhotos.map((p) => p.id));
        setLibraryPhotos(all.filter((p) => !existingIds.has(p.id)));
      }
    } catch (err) {
      console.error("Failed to load library photos for picker:", err);
    }
  };

  const togglePickerSelection = (photoId: number) => {
    setPickerSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const handleAddSelectedToAlbum = async () => {
    if (!activeAlbumId || pickerSelectedIds.size === 0 || isAddingPhotos) return;
    setIsAddingPhotos(true);
    try {
      const ids = Array.from(pickerSelectedIds);
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${activeAlbumId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (res.ok) {
        setIsPhotoPickerOpen(false);
        setPickerSelectedIds(new Set());
        // Refresh detail view
        openAlbumDetail(activeAlbumId, activeAlbumMeta || undefined);
        loadAlbums();
      }
    } catch (err) {
      console.error("Failed to add photos to album:", err);
    } finally {
      setIsAddingPhotos(false);
    }
  };

  const handleDirectImportFiles = async (filePaths: string[]) => {
    if (!activeAlbumId || filePaths.length === 0 || isAddingPhotos) return;
    setIsAddingPhotos(true);
    setDirectImportCount(filePaths.length);
    showToast(`Importing ${filePaths.length} photo(s) directly into "${activeAlbumMeta?.name}"...`, "info");
    try {
      const res = await fetch("http://127.0.0.1:8000/api/photos/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_paths: filePaths,
          album_id: activeAlbumId,
          mode: "managed",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const count = data.imported ?? filePaths.length;
        showToast(`Imported ${count} photo(s) directly into "${activeAlbumMeta?.name}"!`, "success");
        window.dispatchEvent(new CustomEvent("photos-changed", { detail: { action: "imported", albumId: activeAlbumId } }));
        setIsPhotoPickerOpen(false);
        if (activeAlbumMeta) {
          openAlbumDetail(activeAlbumId, activeAlbumMeta);
        }
        loadAlbums();
      } else {
        showToast("Failed to import photos to album", "warning");
      }
    } catch (err) {
      console.error("Direct album import failed:", err);
      showToast("Error importing photos to album", "warning");
    } finally {
      setIsAddingPhotos(false);
      setDirectImportCount(null);
    }
  };

  const handleImportDirectToAlbum = async () => {
    if (!activeAlbumId || isAddingPhotos) return;
    try {
      let selectedPaths: string[] | null = null;
      try {
        selectedPaths = await invoke<string[] | null>("select_import_files");
      } catch {
        albumFileInputRef.current?.click();
        return;
      }
      if (!selectedPaths || selectedPaths.length === 0) return;
      await handleDirectImportFiles(selectedPaths);
    } catch (err) {
      console.error("Direct album import dialog failed:", err);
      albumFileInputRef.current?.click();
    }
  };

  const handleAlbumFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const p = (files[i] as any).path;
      if (p) paths.push(p);
    }
    if (paths.length > 0) {
      handleDirectImportFiles(paths);
    }
    if (albumFileInputRef.current) albumFileInputRef.current.value = "";
  };

  // ──────────────────────────────────────────────────────────────────────────
  // VIEW: Album Detail View (Inside a selected album)
  // ──────────────────────────────────────────────────────────────────────────
  if (activeAlbumId !== null && activeAlbumMeta) {
    const isCollages = activeAlbumMeta.name.toLowerCase() === "collages";
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: "16px 24px 0", gap: "16px", position: "relative" }}>
        {/* Unified Compact Glassmorphic Header Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            padding: "10px 20px",
            minHeight: "56px",
            backgroundColor: "var(--glass-surface)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--glass-border)",
            boxShadow: "var(--glass-shadow)",
            position: "sticky",
            top: 0,
            zIndex: 20,
            flexShrink: 0,
          }}
        >
          {/* Left Column: All Albums Navigation */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-start", minWidth: "120px" }}>
            <button
              onClick={() => {
                setActiveAlbumId(null);
                setActiveAlbumMeta(null);
                setAlbumPhotos([]);
                setSelectedAlbumPhotoIds(new Set());
                setHoveredPhotoId(null);
                loadAlbums();
              }}
              className="clickable"
              title="Back to All Albums"
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
                cursor: "pointer",
                transition: "all 0.15s ease",
                flexShrink: 0,
              }}
            >
              <ArrowLeft size={14} />
              <span>All Albums</span>
            </button>
          </div>

          {/* Center Column: Centered Album Title & Inline Frosted Photo Count Badge */}
          <div
            style={{
              flex: "0 1 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              minWidth: 0,
              maxWidth: "min(400px, 45vw)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, overflow: "hidden" }}>
              <h2
                style={{
                  fontSize: "22px",
                  fontWeight: 800,
                  fontFamily: "var(--font-display, var(--font-sans))",
                  letterSpacing: "-0.03em",
                  color: "var(--text-primary)",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                {activeAlbumId === -1 && (
                  <Heart
                    size={20}
                    fill="#ef4444"
                    stroke="#ef4444"
                    style={{ filter: "drop-shadow(0 0 8px rgba(239, 68, 68, 0.5))", flexShrink: 0 }}
                  />
                )}
                {isCollages && (
                  <Sparkles
                    size={20}
                    color="var(--accent-primary, #38bdf8)"
                    style={{ filter: "drop-shadow(0 0 8px rgba(56, 189, 248, 0.5))", flexShrink: 0 }}
                  />
                )}
                {activeAlbumId === -2 && (
                  <Film
                    size={20}
                    color="#a855f7"
                    style={{ filter: "drop-shadow(0 0 8px rgba(168, 85, 247, 0.5))", flexShrink: 0 }}
                  />
                )}
                <span
                  title={activeAlbumMeta.name}
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {activeAlbumMeta.name}
                </span>
              </h2>
              {activeAlbumId !== -1 && activeAlbumId !== -2 && !isCollages && (
                <button
                  onClick={() => handleToggleFavorite(activeAlbumMeta.id)}
                  title={activeAlbumMeta.is_favorite ? "Favorited Album" : "Mark as Favorite"}
                  className="clickable"
                  style={{
                    background: activeAlbumMeta.is_favorite ? "rgba(239, 68, 68, 0.18)" : "var(--glass-pill-bg)",
                    border: activeAlbumMeta.is_favorite ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid var(--glass-pill-border)",
                    borderRadius: "var(--radius-full)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "5px",
                    color: activeAlbumMeta.is_favorite ? "var(--accent-danger, #ef4444)" : "var(--text-muted)",
                    transition: "all 0.15s ease",
                    flexShrink: 0,
                  }}
                >
                  <Heart size={15} fill={activeAlbumMeta.is_favorite ? "currentColor" : "none"} />
                </button>
              )}
            </div>

            {/* Inline Frosted Capsule Badge for Photo / Story Count */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 10px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--glass-badge-bg)",
                border: "1px solid var(--glass-badge-border)",
                backdropFilter: "blur(8px)",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
                letterSpacing: "0.01em",
                flexShrink: 0,
              }}
            >
              <span>
                {activeAlbumId === -2
                  ? `${savedStories.length} ${savedStories.length === 1 ? "story" : "stories"}`
                  : `${albumPhotos.length} ${albumPhotos.length === 1 ? "photo" : "photos"}`}
              </span>
            </div>
          </div>

          {/* Right Column: Actions (Slideshow, Add Photos, Delete Album) */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", minWidth: "120px" }}>
            {albumPhotos.length > 0 && (
              <button
                onClick={() => setIsSlideshowOpen(true)}
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 16px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-action-bg)",
                  border: "1px solid var(--glass-action-border)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "var(--glass-shadow)",
                  transition: "all 0.2s ease",
                }}
                title="Play full-screen cinematic slideshow with ambient music"
              >
                <Play size={13} fill="currentColor" />
                <span>Slideshow</span>
              </button>
            )}

            {activeAlbumId === -2 ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(168, 85, 247, 0.12)",
                  border: "1px solid rgba(168, 85, 247, 0.25)",
                  color: "#c084fc",
                  fontSize: "12px",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                <Film size={13} />
                <span>Smart Collection</span>
              </span>
            ) : isCollages ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(56, 189, 248, 0.12)",
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                  color: "var(--accent-primary, #38bdf8)",
                  fontSize: "12px",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                <Sparkles size={13} />
                <span>Smart Album</span>
              </span>
            ) : activeAlbumId !== -1 ? (
              <>
                <button
                  onClick={openPhotoPicker}
                  className="clickable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 16px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-primary)",
                    border: "none",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(99, 102, 241, 0.25)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Plus size={14} />
                  <span>Add Photos</span>
                </button>
                <button
                  onClick={() => handleDeleteAlbum(activeAlbumMeta.id)}
                  className="clickable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.25)",
                    color: "var(--accent-danger, #ef4444)",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                  title="Delete this album (Photos will remain safe in your library)"
                >
                  <Trash2 size={14} />
                  <span>Delete Album</span>
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* Photos Grid or Empty State */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 0 20px 0" }}>
          {isDetailLoading ? (
            <div style={{ padding: "60px", textAlign: "center", color: "var(--text-muted)" }}>
              <Loader2 size={28} className="spin" style={{ margin: "0 auto 12px" }} />
              Loading album photos...
            </div>
          ) : activeAlbumId === -2 ? (
            savedStories.length === 0 ? (
              <div
                style={{
                  marginTop: "60px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                  textAlign: "center",
                  padding: "32px 24px",
                  maxWidth: "520px",
                  margin: "60px auto 0",
                }}
              >
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(168, 85, 247, 0.12)",
                    border: "1px solid rgba(168, 85, 247, 0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "16px",
                  }}
                >
                  <Film size={32} style={{ color: "#c084fc" }} />
                </div>
                <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0" }}>
                  No Saved Stories Yet
                </h3>
                <p style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--text-secondary)", margin: 0, maxWidth: "440px" }}>
                  Stories are dynamic cinematic montages generated from your library. Tap the bookmark icon on any story in your Stories shelf to preserve it permanently here.
                </p>
                <button
                  onClick={() => {
                    setActiveAlbumId(null);
                    setActiveAlbumMeta(null);
                    setActiveTab("stories");
                  }}
                  className="clickable"
                  style={{
                    marginTop: "20px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "9px 20px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-primary)",
                    border: "none",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 2px 10px rgba(168, 85, 247, 0.3)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Film size={15} />
                  <span>Browse Stories Shelf</span>
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: "16px",
                  paddingBottom: "88px",
                }}
              >
                {savedStories.map((story) => {
                  const coverUrl = story.cover_photo_id
                    ? `http://127.0.0.1:8000/api/photos/${story.cover_photo_id}/thumbnail`
                    : undefined;
                  return (
                    <div
                      key={story.id}
                      className="clickable glass-panel"
                      style={{
                        position: "relative",
                        borderRadius: "var(--radius-lg)",
                        overflow: "hidden",
                        border: "1px solid var(--glass-border)",
                        backgroundColor: "var(--glass-surface)",
                        cursor: "pointer",
                        transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                        display: "flex",
                        flexDirection: "column",
                      }}
                      onClick={() => onPlayStory?.(story.id)}
                    >
                      <div
                        style={{
                          position: "relative",
                          width: "100%",
                          aspectRatio: "16 / 9",
                          backgroundColor: "rgba(0, 0, 0, 0.2)",
                          overflow: "hidden",
                        }}
                      >
                        {coverUrl ? (
                          <img
                            src={coverUrl}
                            alt={story.title}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                              transition: "transform 0.4s ease",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(59, 130, 246, 0.2))",
                            }}
                          >
                            <Film size={36} color="var(--text-muted)" />
                          </div>
                        )}
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: "linear-gradient(to top, rgba(0, 0, 0, 0.75) 0%, rgba(0, 0, 0, 0) 60%)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <div
                            style={{
                              width: "48px",
                              height: "48px",
                              borderRadius: "50%",
                              backgroundColor: "rgba(255, 255, 255, 0.25)",
                              backdropFilter: "blur(12px)",
                              WebkitBackdropFilter: "blur(12px)",
                              border: "1px solid rgba(255, 255, 255, 0.4)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#ffffff",
                              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
                            }}
                          >
                            <Play size={22} style={{ marginLeft: "3px" }} fill="currentColor" />
                          </div>
                        </div>
                        <div
                          style={{
                            position: "absolute",
                            top: "10px",
                            right: "10px",
                            padding: "3px 8px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: "rgba(0, 0, 0, 0.55)",
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                            color: "#ffffff",
                            fontSize: "11px",
                            fontWeight: 600,
                            border: "1px solid rgba(255, 255, 255, 0.15)",
                          }}
                        >
                          {story.slides_count ?? story.slides?.length ?? 0} moments
                        </div>
                      </div>

                      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                        <h4
                          style={{
                            margin: 0,
                            fontSize: "15px",
                            fontWeight: 700,
                            color: "var(--text-primary)",
                            lineHeight: 1.3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={story.title}
                        >
                          {story.title}
                        </h4>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              color: "#c084fc",
                              backgroundColor: "rgba(168, 85, 247, 0.12)",
                              padding: "2px 8px",
                              borderRadius: "var(--radius-full)",
                              border: "1px solid rgba(168, 85, 247, 0.25)",
                            }}
                          >
                            {story.vibe_mood} Montage
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : albumPhotos.length === 0 ? (
            <div
              style={{
                marginTop: "60px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                textAlign: "center",
                padding: "32px 24px",
                maxWidth: "520px",
                margin: "60px auto 0",
              }}
            >
              {activeAlbumId === -1 ? (
                <>
                  <div
                    style={{
                      width: "64px",
                      height: "64px",
                      borderRadius: "50%",
                      backgroundColor: "rgba(239, 68, 68, 0.12)",
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: "16px",
                    }}
                  >
                    <Heart size={32} style={{ color: "var(--accent-danger, #ef4444)" }} fill="rgba(239, 68, 68, 0.3)" />
                  </div>
                  <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0" }}>
                    No Favorite Photos or Videos Yet
                  </h3>
                  <p style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--text-secondary)", margin: 0, maxWidth: "440px" }}>
                    This is your personal Favorites smart album. Tap the heart icon on any photo or video across your library to collect your most cherished memories here for instant access.
                  </p>
                  <button
                    onClick={() => {
                      setActiveAlbumId(null);
                      setActiveAlbumMeta(null);
                      setActiveTab("photos");
                    }}
                    className="clickable"
                    style={{
                      marginTop: "20px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "9px 20px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-action-bg)",
                      border: "1px solid var(--glass-action-border)",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: "var(--glass-shadow)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    Browse Photos & Videos
                  </button>
                </>
              ) : isCollages ? (
                <>
                  <div
                    style={{
                      width: "64px",
                      height: "64px",
                      borderRadius: "50%",
                      backgroundColor: "rgba(56, 189, 248, 0.12)",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: "16px",
                    }}
                  >
                    <Sparkles size={32} style={{ color: "var(--accent-primary, #38bdf8)" }} />
                  </div>
                  <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0" }}>
                    No Collages Created Yet
                  </h3>
                  <p style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--text-secondary)", margin: 0, maxWidth: "440px" }}>
                    Collages combine 2 to 9 photos from your library into a seamless 4K UHD composite with customizable layouts, borders, and spacing.
                  </p>
                  <p style={{ fontSize: "12px", lineHeight: "1.5", color: "var(--text-muted)", marginTop: "8px", maxWidth: "420px" }}>
                    To create a collage, head to your Photos library, select 2 to 9 photos, and click &ldquo;Create Collage&rdquo; in the bottom action dock.
                  </p>
                  <button
                    onClick={() => {
                      setActiveAlbumId(null);
                      setActiveAlbumMeta(null);
                      setActiveTab("photos");
                    }}
                    className="clickable"
                    style={{
                      marginTop: "20px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "9px 20px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--accent-primary)",
                      border: "none",
                      color: "#ffffff",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: "0 2px 10px rgba(56, 189, 248, 0.3)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    Browse Photos to Make a Collage
                  </button>
                </>
              ) : (
                <>
                  <div
                    style={{
                      width: "64px",
                      height: "64px",
                      borderRadius: "50%",
                      backgroundColor: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid var(--border-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: "16px",
                    }}
                  >
                    <FolderPlus size={32} style={{ color: "var(--text-secondary)", opacity: 0.8 }} />
                  </div>
                  <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px 0" }}>
                    This Album is Empty
                  </h3>
                  <p style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--text-secondary)", margin: 0, maxWidth: "440px" }}>
                    Organize your memories into custom collections. Add photos and videos to this album to keep related moments grouped together.
                  </p>
                  <button
                    onClick={openPhotoPicker}
                    className="clickable"
                    style={{
                      marginTop: "20px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "9px 20px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--accent-primary)",
                      border: "none",
                      color: "#ffffff",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: "0 2px 10px rgba(99, 102, 241, 0.3)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <Plus size={15} />
                    <span>Add Photos & Videos</span>
                  </button>
                </>
              )}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))",
                gap: "10px",
                paddingBottom: "88px",
              }}
            >
              {albumPhotos.map((photo, idx) => {
                const isCover = activeAlbumMeta.cover_photo_id === photo.id;
                const isSelected = selectedAlbumPhotoIds.has(photo.id);
                const isHovered = hoveredPhotoId === photo.id;

                return (
                  <div
                    key={photo.id}
                    className="clickable glass-panel"
                    style={{
                      position: "relative",
                      aspectRatio: "1",
                      borderRadius: "var(--radius-sm)",
                      overflow: "hidden",
                      backgroundColor: "var(--bg-surface-elevated)",
                      border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                      cursor: "pointer",
                    }}
                    onMouseEnter={() => setHoveredPhotoId(photo.id)}
                    onMouseLeave={() => setHoveredPhotoId(null)}
                    onClick={() => onPhotoClick?.(idx, albumPhotos)}
                  >
                    <img
                      src={`http://127.0.0.1:8000/api/photos/${photo.id}/thumbnail?v=3`}
                      alt={photo.filename}
                      style={{ width: "100%", height: "100%", objectFit: "cover", imageRendering: "-webkit-optimize-contrast" }}
                      loading="lazy"
                    />

                    {/* Top Left: Checkbox (Multi-Selection) */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleAlbumPhotoSelection(photo.id);
                      }}
                      style={{
                        position: "absolute",
                        top: "6px",
                        left: "6px",
                        width: "18px",
                        height: "18px",
                        borderRadius: "var(--radius-xs, 4px)",
                        backgroundColor: isSelected ? "var(--accent-primary)" : "rgba(0, 0, 0, 0.45)",
                        border: isSelected ? "none" : "1px solid rgba(255, 255, 255, 0.5)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#ffffff",
                        zIndex: 3,
                        opacity: isSelected || isHovered ? 1 : 0.35,
                        transition: "opacity 0.15s ease, background-color 0.15s ease",
                        cursor: "pointer",
                      }}
                    >
                      {isSelected && <Check size={12} strokeWidth={3} />}
                    </div>

                    {/* Hover-Only "Set Cover" Button: Only on non-cover photos in user albums */}
                    {activeAlbumId !== -1 && !isCover && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetAlbumCover(photo.id);
                        }}
                        title="Set as Album Cover"
                        style={{
                          position: "absolute",
                          top: "6px",
                          left: "28px",
                          backgroundColor: "rgba(0, 0, 0, 0.7)",
                          border: "1px solid rgba(255, 255, 255, 0.3)",
                          borderRadius: "var(--radius-xs, 4px)",
                          color: "#ffffff",
                          padding: "2px 7px",
                          fontSize: "10px",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "3px",
                          backdropFilter: "blur(6px)",
                          opacity: isHovered ? 1 : 0,
                          transform: isHovered ? "scale(1)" : "scale(0.95)",
                          transition: "opacity 0.15s ease, transform 0.15s ease",
                          zIndex: 3,
                          boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
                          pointerEvents: isHovered ? "auto" : "none",
                        }}
                      >
                        <ImageIcon size={11} /> Set Cover
                      </button>
                    )}

                    {/* Top Right: Like Heart & Remove Buttons */}
                    <div style={{ position: "absolute", top: "6px", right: "6px", display: "flex", gap: "4px", zIndex: 3 }}>
                      {/* Heart Like Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePhotoFavorite(photo.id);
                        }}
                        title={photo.is_favorite ? "Remove from Favorites" : "Add to Favorites"}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          width: "24px",
                          height: "24px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 0,
                          filter: "drop-shadow(0 1px 3px rgba(0, 0, 0, 0.75))",
                          transition: "transform 0.15s ease",
                        }}
                      >
                        <Heart 
                          size={18} 
                          fill={photo.is_favorite ? "#ef4444" : "none"} 
                          stroke={photo.is_favorite ? "#ef4444" : "#ffffff"} 
                          strokeWidth={2}
                        />
                      </button>

                      {/* Remove from Album Button (Only for user albums) */}
                      {activeAlbumId !== -1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRemovalModalTarget({ photoIds: [photo.id] });
                          }}
                          title="Remove from album or move to trash"
                          style={{
                            background: "rgba(0, 0, 0, 0.65)",
                            border: "1px solid rgba(255, 255, 255, 0.3)",
                            borderRadius: "var(--radius-xs)",
                            color: "#ffffff",
                            width: "24px",
                            height: "24px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            backdropFilter: "blur(4px)",
                          }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    {/* Bottom Filename */}
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        padding: "6px 8px",
                        background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
                        fontSize: "10px",
                        color: "#ffffff",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {photo.filename}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Photo Picker Modal */}
        {isPhotoPickerOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0, 0, 0, 0.75)",
              backdropFilter: "blur(6px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "24px",
            }}
            onClick={() => setIsPhotoPickerOpen(false)}
          >
            <div
              className="glass-panel"
              style={{
                width: "100%",
                maxWidth: "720px",
                maxHeight: "85vh",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-lg, 12px)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                boxShadow: "0 24px 48px rgba(0, 0, 0, 0.6)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="file"
                ref={albumFileInputRef}
                multiple
                accept="image/*,video/*"
                style={{ display: "none" }}
                onChange={handleAlbumFileInputChange}
              />
              {/* Modal Header */}
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>
                    {isAddingPhotos && directImportCount !== null
                      ? `Importing to ${activeAlbumMeta.name}...`
                      : `Add Photos to ${activeAlbumMeta.name}`}
                  </h3>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "2px 0 0" }}>
                    {isAddingPhotos && directImportCount !== null
                      ? `Processing ${directImportCount} item(s) into album`
                      : `Select photos from your library (${pickerSelectedIds.size} selected)`}
                  </p>
                </div>
                {!isAddingPhotos && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button
                      onClick={handleImportDirectToAlbum}
                      disabled={isAddingPhotos}
                      className="clickable"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 14px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--glass-action-bg, rgba(255, 255, 255, 0.08))",
                        border: "1px solid var(--glass-action-border, rgba(255, 255, 255, 0.15))",
                        color: "var(--text-primary)",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: isAddingPhotos ? "not-allowed" : "pointer",
                        transition: "all 0.15s ease",
                      }}
                      title="Select photos from your device to import directly into this album"
                    >
                      <Download size={13} style={{ transform: "rotate(180deg)" }} />
                      <span>Import New Photos</span>
                    </button>
                    <button
                      onClick={() => setIsPhotoPickerOpen(false)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        padding: "4px",
                      }}
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
              </div>

              {/* Photos Grid or Active Import Progress */}
              <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column" }}>
                {isAddingPhotos && directImportCount !== null ? (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "48px 24px",
                      textAlign: "center",
                      gap: "20px",
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        width: "60px",
                        height: "60px",
                        borderRadius: "50%",
                        backgroundColor: "var(--glass-action-bg, rgba(255, 255, 255, 0.06))",
                        border: "1px solid var(--glass-action-border, rgba(255, 255, 255, 0.15))",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 0 24px rgba(59, 130, 246, 0.25)",
                      }}
                    >
                      <Loader2
                        size={28}
                        className="animate-spin"
                        style={{ color: "var(--accent-primary, #3b82f6)" }}
                      />
                    </div>

                    <div style={{ maxWidth: "420px" }}>
                      <h4
                        style={{
                          fontSize: "16px",
                          fontWeight: 700,
                          color: "var(--text-primary)",
                          margin: "0 0 8px",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        Importing {directImportCount} item{directImportCount === 1 ? "" : "s"} into "{activeAlbumMeta.name}"...
                      </h4>
                      <p
                        style={{
                          fontSize: "12px",
                          color: "var(--text-secondary)",
                          lineHeight: "1.6",
                          margin: 0,
                        }}
                      >
                        Copying files to your private library, extracting camera details, and generating high-resolution thumbnails. Please keep this open.
                      </p>
                    </div>

                    {/* Animated indeterminate liquid glass progress bar */}
                    <div
                      style={{
                        width: "280px",
                        height: "6px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--bg-surface-elevated, rgba(255, 255, 255, 0.08))",
                        overflow: "hidden",
                        position: "relative",
                      }}
                    >
                      <div
                        className="progress-bar-animated"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "50%",
                          background: "linear-gradient(90deg, transparent, var(--accent-primary, #3b82f6), transparent)",
                          borderRadius: "var(--radius-full)",
                        }}
                      />
                    </div>
                  </div>
                ) : libraryPhotos.length === 0 ? (
                  <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", margin: "auto" }}>
                    All photos in your library are already in this album.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                      gap: "8px",
                    }}
                  >
                    {libraryPhotos.map((p) => {
                      const isSelected = pickerSelectedIds.has(p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => togglePickerSelection(p.id)}
                          style={{
                            position: "relative",
                            aspectRatio: "1",
                            borderRadius: "var(--radius-xs, 6px)",
                            overflow: "hidden",
                            border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                            cursor: "pointer",
                          }}
                        >
                          <img
                            src={`http://127.0.0.1:8000/api/photos/${p.id}/thumbnail?v=3`}
                            alt={p.filename}
                            style={{ width: "100%", height: "100%", objectFit: "cover", imageRendering: "-webkit-optimize-contrast" }}
                            loading="lazy"
                          />
                          <div
                            style={{
                              position: "absolute",
                              top: "4px",
                              right: "4px",
                              width: "20px",
                              height: "20px",
                              borderRadius: "50%",
                              backgroundColor: isSelected ? "var(--accent-primary)" : "rgba(0, 0, 0, 0.5)",
                              border: "1px solid #ffffff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {isSelected && <Check size={12} color="#ffffff" strokeWidth={3} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  padding: "14px 20px",
                  borderTop: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: isAddingPhotos && directImportCount !== null ? "center" : "flex-end",
                  gap: "10px",
                  backgroundColor: "var(--bg-sidebar)",
                }}
              >
                {isAddingPhotos && directImportCount !== null ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-muted)" }}>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Processing media import batch...</span>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setIsPhotoPickerOpen(false)}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "transparent",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--text-secondary)",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddSelectedToAlbum}
                      disabled={pickerSelectedIds.size === 0 || isAddingPhotos}
                      className="clickable"
                      style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 20px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--accent-primary)",
                    border: "none",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 600,
                    opacity: pickerSelectedIds.size === 0 || isAddingPhotos ? 0.5 : 1,
                    cursor: pickerSelectedIds.size === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  {isAddingPhotos ? <Loader2 size={13} className="spin" /> : <Plus size={14} />}
                  Add {pickerSelectedIds.size} {pickerSelectedIds.size === 1 ? "Photo" : "Photos"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )}

        {/* Floating Jira-Style Bottom Batch Action Dock for Album */}
        <div
          style={{
            position: "absolute",
            bottom: "24px",
            left: "50%",
            transform: `translateX(-50%) ${selectedAlbumPhotoIds.size > 0 ? "translateY(0)" : "translateY(80px)"}`,
            opacity: selectedAlbumPhotoIds.size > 0 ? 1 : 0,
            pointerEvents: selectedAlbumPhotoIds.size > 0 ? "auto" : "none",
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
            {selectedAlbumPhotoIds.size} selected
          </span>

          {/* Select All / Deselect All Toggle */}
          <button
            onClick={() => {
              if (selectedAlbumPhotoIds.size === albumPhotos.length) {
                setSelectedAlbumPhotoIds(new Set());
              } else {
                setSelectedAlbumPhotoIds(new Set(albumPhotos.map((p) => p.id)));
              }
            }}
            className="clickable"
            title={selectedAlbumPhotoIds.size === albumPhotos.length ? "Deselect all items" : "Select all items in current album"}
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
            {selectedAlbumPhotoIds.size === albumPhotos.length ? "Deselect All" : "Select All"}
          </button>

          {/* Subtle Vertical Glass Divider */}
          <div style={{ width: "1px", height: "20px", backgroundColor: "var(--glass-border)", margin: "0 2px", flexShrink: 0 }} />

          {/* Remove from Album / Remove from Favorites */}
          {activeAlbumId !== -1 ? (
            <button
              onClick={() => {
                if (selectedAlbumPhotoIds.size === 0) return;
                setRemovalModalTarget({ photoIds: Array.from(selectedAlbumPhotoIds) });
              }}
              className="clickable"
              title="Remove selected items from this album"
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
              <Trash2 size={13} />
              <span>Remove from Album</span>
            </button>
          ) : (
            <button
              onClick={handleBatchRemoveFromFavorites}
              className="clickable"
              title="Remove selected items from Favorites"
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
              <HeartOff size={13} />
              <span>Remove from Favorites</span>
            </button>
          )}

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
              <span>Create Collage ({selectedAlbumPhotoIds.size})</span>
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
            title="Add selected items to another album"
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

          {/* Move to Vault */}
          {onLockAlbumToVault && (
            <button
              onClick={() => {
                const idToLock = activeAlbumId ?? 0;
                onLockAlbumToVault(idToLock, false);
                setAlbums((prev) => prev.filter((a) => a.id !== idToLock));
                setActiveAlbumId(null);
                showToast("Album and its photos encrypted and moved to Private Vault.", "info");
              }}
              className="clickable"
              title="Encrypt and move selected items into Private Vault"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "rgba(59, 130, 246, 0.15)",
                border: "1px solid rgba(59, 130, 246, 0.35)",
                color: "var(--accent-primary)",
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
          )}

          {/* Move to Trash */}
          <button
            onClick={handleBatchMoveToTrash}
            className="clickable"
            title="Move selected items to 30-Day Trash"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              color: "var(--accent-danger, #ef4444)",
              fontSize: "12px",
              fontWeight: 600,
              whiteSpace: "nowrap",
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <Trash2 size={14} />
            <span>Move to Trash ({selectedAlbumPhotoIds.size})</span>
          </button>

          {/* Subtle Vertical Glass Divider */}
          <div style={{ width: "1px", height: "20px", backgroundColor: "var(--glass-border)", margin: "0 2px", flexShrink: 0 }} />

          {/* Dismiss Selection */}
          <button
            onClick={() => setSelectedAlbumPhotoIds(new Set())}
            className="clickable"
            title="Deselect all (Esc)"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "28px",
              height: "28px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-pill-border)",
              color: "var(--text-secondary)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Full-Screen Cinematic Slideshow Modal */}
        <AlbumSlideshowModal
          isOpen={isSlideshowOpen}
          albumName={activeAlbumMeta.name}
          photos={albumPhotos}
          onClose={() => setIsSlideshowOpen(false)}
        />

        {/* In-Album Photo Removal Choice Modal */}
        <RemoveFromAlbumModal
          isOpen={removalModalTarget !== null}
          photoCount={removalModalTarget?.photoIds.length || 0}
          onClose={() => setRemovalModalTarget(null)}
          onRemoveFromAlbumOnly={handleConfirmRemoveFromAlbumOnly}
          onMoveToTrash={handleConfirmMoveToTrash}
          isProcessing={isRemovalProcessing}
        />

        {/* Add Selected Photos to Album Modal */}
        <AddToAlbumModal
          isOpen={isAddToAlbumModalOpen}
          selectedPhotoIds={Array.from(selectedAlbumPhotoIds)}
          onClose={() => setIsAddToAlbumModalOpen(false)}
          onSuccess={(targetAlbumName) => {
            setIsAddToAlbumModalOpen(false);
            setSelectedAlbumPhotoIds(new Set());
            showToast(`Added photos to album "${targetAlbumName}"`, "success");
            loadAlbums();
          }}
        />

        {/* Mosaic Collage Generator Modal */}
        <CollageModal
          isOpen={isCollageModalOpen}
          selectedPhotoIds={Array.from(selectedAlbumPhotoIds)}
          onClose={() => setIsCollageModalOpen(false)}
          onSuccess={() => {
            setIsCollageModalOpen(false);
            setSelectedAlbumPhotoIds(new Set());
            if (activeAlbumId !== null && activeAlbumMeta) {
              openAlbumDetail(activeAlbumId, activeAlbumMeta);
            }
          }}
        />
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VIEW: Albums Gallery Grid (Top Level)
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
      {/* Header & Actions (macOS Liquid Glass Floating Toolbar) */}
      <div 
        className="liquid-glass-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          marginBottom: "20px",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid var(--glass-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--glass-shadow)",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        {/* Left Column (flex: 1) */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px" }}>
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
            <FolderHeart size={12} style={{ color: "var(--accent-primary)" }} />
            Album Collections
          </span>
        </div>

        {/* Center Column (flex: 0 1 auto): 22px Plus Jakarta Sans Title + Baseline Capsule */}
        <div 
          style={{ 
            flex: "0 1 auto", 
            display: "flex", 
            alignItems: "baseline", 
            justifyContent: "center", 
            gap: "10px" 
          }}
        >
          <h1 
            style={{ 
              fontSize: "22px", 
              fontWeight: 800, 
              letterSpacing: "-0.03em", 
              margin: 0,
              color: "var(--text-primary)",
              fontFamily: "Plus Jakarta Sans, sans-serif"
            }}
          >
            Albums
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
            {albums.length} {albums.length === 1 ? "Album" : "Albums"}
          </span>
        </div>

        {/* Right Column (flex: 1): Action Pill Buttons */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
          <button
            onClick={() => setIsCreatingAlbum(true)}
            className="clickable"
            title="Create a new album"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 16px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-primary)",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 700,
              border: "none",
              cursor: "pointer",
              boxShadow: "0 2px 10px rgba(59, 130, 246, 0.3)",
              transition: "all 0.15s ease",
            }}
          >
            <Plus size={14} />
            <span>New Album</span>
          </button>
        </div>
      </div>

      {/* New Album Creation Banner */}
      {isCreatingAlbum && (
        <div 
          className="glass-panel"
          style={{
            padding: "16px",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--accent-primary)",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <input
            type="text"
            autoFocus
            placeholder="Enter new album title..."
            value={newAlbumName}
            onChange={(e) => setNewAlbumName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateAlbum();
              if (e.key === "Escape") setIsCreatingAlbum(false);
            }}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--bg-sidebar)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
              fontSize: "13px",
              outline: "none",
            }}
          />
          <button
            onClick={() => setIsCreatingAlbum(false)}
            className="clickable"
            style={{
              padding: "8px 14px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "transparent",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreateAlbum}
            disabled={!newAlbumName.trim()}
            className="clickable"
            style={{
              padding: "8px 16px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--accent-primary)",
              border: "none",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
              opacity: !newAlbumName.trim() ? 0.6 : 1,
              cursor: !newAlbumName.trim() ? "not-allowed" : "pointer",
            }}
          >
            Create
          </button>
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: "60px", textAlign: "center", color: "var(--text-muted)" }}>
          <Loader2 size={28} className="spin" style={{ margin: "0 auto 12px" }} />
          Loading albums...
        </div>
      ) : (
        /* Album Grid Sections: Pinned System Collections & My Albums */
        (() => {
          const collagesAlbum = albums.find((a) => a.name.toLowerCase() === "collages");
          const userAlbums = albums.filter((a) => a.name.toLowerCase() !== "collages");

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "28px", paddingBottom: "40px" }}>
              {/* System Collections Section (Pinned Top) */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                  <h3
                    style={{
                      fontSize: "12px",
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      margin: 0,
                    }}
                  >
                    System Collections
                  </h3>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-subtle)", opacity: 0.6 }} />
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: "18px",
                  }}
                >
                  {/* 1. Favorites Card */}
                  <div
                    onClick={openFavoritesAlbum}
                    className="clickable glass-panel"
                    style={{
                      borderRadius: "var(--radius-md)",
                      backgroundColor: "var(--bg-surface)",
                      border: "1px solid rgba(239, 68, 68, 0.35)",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      cursor: "pointer",
                      transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.borderColor = "#ef4444";
                      e.currentTarget.style.boxShadow = "0 8px 24px rgba(239, 68, 68, 0.25)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.35)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    {/* Cover Art */}
                    <div
                      style={{
                        height: "160px",
                        background:
                          favoriteCoverId && !failedCoverIds.has(favoriteCoverId)
                            ? "var(--bg-surface-elevated)"
                            : "linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(168, 85, 247, 0.2) 100%)",
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}
                    >
                      {favoriteCoverId && !failedCoverIds.has(favoriteCoverId) ? (
                        <img
                          src={`http://127.0.0.1:8000/api/photos/${favoriteCoverId}/thumbnail?v=3`}
                          alt="Favorites"
                          onError={() => setFailedCoverIds((prev) => new Set(prev).add(favoriteCoverId))}
                          style={{ width: "100%", height: "100%", objectFit: "cover", imageRendering: "-webkit-optimize-contrast" }}
                          loading="lazy"
                        />
                      ) : (
                        <Heart size={44} fill="rgba(239, 68, 68, 0.4)" stroke="rgba(239, 68, 68, 0.7)" />
                      )}

                      <div style={{ position: "absolute", top: "10px", right: "10px" }}>
                        <span
                          style={{
                            backgroundColor: "rgba(239, 68, 68, 0.95)",
                            color: "#ffffff",
                            padding: "3px 8px",
                            borderRadius: "var(--radius-xs)",
                            fontSize: "10px",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            boxShadow: "0 2px 8px rgba(239, 68, 68, 0.4)",
                          }}
                        >
                          <Heart size={10} fill="#ffffff" /> FAVORITES
                        </span>
                      </div>
                    </div>

                    <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <h3 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                          <Heart size={14} fill="#ef4444" stroke="#ef4444" /> Favorites
                        </h3>
                      </div>
                      <div
                        style={{
                          marginTop: "6px",
                          paddingTop: "8px",
                          borderTop: "1px solid var(--border-subtle)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                          {favoriteCount} {favoriteCount === 1 ? "photo" : "photos"}
                        </span>
                        <span style={{ fontSize: "10px", color: "var(--accent-danger, #ef4444)", fontWeight: 600 }}>
                          Smart Collection
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 2. Collages & Wallpapers Card */}
                  <div
                    onClick={() => {
                      if (collagesAlbum) {
                        openAlbumDetail(collagesAlbum.id, collagesAlbum);
                      } else {
                        showToast("Create a collage from the Photos tab to start this collection!", "info");
                      }
                    }}
                    className="clickable glass-panel"
                    style={{
                      borderRadius: "var(--radius-md)",
                      backgroundColor: "var(--bg-surface)",
                      border: "1px solid rgba(56, 189, 248, 0.35)",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      cursor: "pointer",
                      transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.borderColor = "var(--accent-primary, #38bdf8)";
                      e.currentTarget.style.boxShadow = "0 8px 24px rgba(56, 189, 248, 0.25)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.35)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div
                      style={{
                        height: "160px",
                        backgroundColor: "var(--bg-surface-elevated)",
                        position: "relative",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {collagesAlbum && collagesAlbum.cover_photo_id && !failedCoverIds.has(collagesAlbum.cover_photo_id) ? (
                        <img
                          src={`http://127.0.0.1:8000/api/photos/${collagesAlbum.cover_photo_id}/thumbnail?v=3`}
                          alt="Collages"
                          onError={() => setFailedCoverIds((prev) => new Set(prev).add(collagesAlbum.cover_photo_id!))}
                          style={{ width: "100%", height: "100%", objectFit: "cover", imageRendering: "-webkit-optimize-contrast" }}
                          loading="lazy"
                        />
                      ) : (
                        <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
                          <img
                            src={collagesDefaultCover}
                            alt="Collages Default Cover"
                            style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.02)" }}
                          />
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              background: "linear-gradient(180deg, rgba(0, 0, 0, 0.05) 0%, rgba(0, 0, 0, 0.55) 100%)",
                            }}
                          />
                        </div>
                      )}
                      <div style={{ position: "absolute", top: "10px", right: "10px" }}>
                        <span
                          style={{
                            backgroundColor: "rgba(56, 189, 248, 0.95)",
                            color: "#0f172a",
                            padding: "3px 8px",
                            borderRadius: "var(--radius-xs)",
                            fontSize: "10px",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            boxShadow: "0 2px 8px rgba(56, 189, 248, 0.35)",
                          }}
                        >
                          <Sparkles size={10} /> COLLAGES
                        </span>
                      </div>
                    </div>

                    <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <h3 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                          <Sparkles size={14} color="#38bdf8" /> Collages & Wallpapers
                        </h3>
                      </div>
                      <div
                        style={{
                          marginTop: "6px",
                          paddingTop: "8px",
                          borderTop: "1px solid var(--border-subtle)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                          {collagesAlbum?.photo_count || 0} {(collagesAlbum?.photo_count || 0) === 1 ? "collage" : "collages"}
                        </span>
                        <span style={{ fontSize: "10px", color: "var(--accent-primary, #38bdf8)", fontWeight: 600 }}>
                          Smart Collection
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 3. Saved Stories Card */}
                  <div
                    onClick={openSavedStoriesAlbum}
                    className="clickable glass-panel"
                    style={{
                      borderRadius: "var(--radius-md)",
                      backgroundColor: "var(--bg-surface)",
                      border: "1px solid rgba(168, 85, 247, 0.35)",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      cursor: "pointer",
                      transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.borderColor = "#c084fc";
                      e.currentTarget.style.boxShadow = "0 8px 24px rgba(168, 85, 247, 0.25)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.borderColor = "rgba(168, 85, 247, 0.35)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div
                      style={{
                        height: "160px",
                        backgroundColor: "var(--bg-surface-elevated)",
                        position: "relative",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background:
                          savedStories.length > 0 &&
                          savedStories[0]?.cover_photo_id &&
                          !failedCoverIds.has(savedStories[0].cover_photo_id)
                            ? "var(--bg-surface-elevated)"
                            : "linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(59, 130, 246, 0.2) 100%)",
                      }}
                    >
                      {savedStories.length > 0 &&
                      savedStories[0]?.cover_photo_id &&
                      !failedCoverIds.has(savedStories[0].cover_photo_id) ? (
                        <img
                          src={`http://127.0.0.1:8000/api/photos/${savedStories[0].cover_photo_id}/thumbnail?v=3`}
                          alt="Saved Stories"
                          onError={() => setFailedCoverIds((prev) => new Set(prev).add(savedStories[0].cover_photo_id!))}
                          style={{ width: "100%", height: "100%", objectFit: "cover", imageRendering: "-webkit-optimize-contrast" }}
                          loading="lazy"
                        />
                      ) : (
                        <Film size={44} style={{ color: "rgba(168, 85, 247, 0.7)" }} />
                      )}
                      <div style={{ position: "absolute", top: "10px", right: "10px" }}>
                        <span
                          style={{
                            backgroundColor: "rgba(168, 85, 247, 0.95)",
                            color: "#ffffff",
                            padding: "3px 8px",
                            borderRadius: "var(--radius-xs)",
                            fontSize: "10px",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            boxShadow: "0 2px 8px rgba(168, 85, 247, 0.35)",
                          }}
                        >
                          <Film size={10} /> STORIES
                        </span>
                      </div>
                    </div>

                    <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <h3 style={{ fontSize: "14px", fontWeight: 700, margin: 0, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                          <Film size={14} color="#c084fc" /> Saved Stories
                        </h3>
                      </div>
                      <div
                        style={{
                          marginTop: "6px",
                          paddingTop: "8px",
                          borderTop: "1px solid var(--border-subtle)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                          {savedStories.length} {savedStories.length === 1 ? "story" : "stories"}
                        </span>
                        <span style={{ fontSize: "10px", color: "#c084fc", fontWeight: 600 }}>
                          Smart Collection
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* My Albums Section */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                  <h3
                    style={{
                      fontSize: "12px",
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      margin: 0,
                    }}
                  >
                    My Albums
                  </h3>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--text-secondary)",
                      backgroundColor: "var(--glass-action-bg, rgba(255, 255, 255, 0.06))",
                      padding: "1px 8px",
                      borderRadius: "var(--radius-full)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {userAlbums.length}
                  </span>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-subtle)", opacity: 0.6 }} />
                </div>

                {userAlbums.length === 0 ? (
                  <div
                    style={{
                      padding: "48px 24px",
                      textAlign: "center",
                      color: "var(--text-muted)",
                      borderRadius: "var(--radius-md)",
                      backgroundColor: "var(--bg-surface)",
                      border: "1px dashed var(--border-subtle)",
                    }}
                  >
                    <FolderPlus size={32} style={{ margin: "0 auto 12px", opacity: 0.6 }} />
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
                      No Custom Albums Yet
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", maxWidth: "360px", margin: "0 auto" }}>
                      Click &ldquo;New Album&rdquo; above to organize your photos and videos into custom collections.
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                      gap: "18px",
                    }}
                  >
                    {userAlbums.map((album) => {
                      const count = album.photo_count || 0;
                      const hasValidCover = count > 0 && album.cover_photo_id && !failedCoverIds.has(album.cover_photo_id);
                      const palette = getAlbumPalette(album.name);
                      const initial = album.name.trim().charAt(0).toUpperCase() || "A";

                      return (
                        <div
                          key={album.id}
                          onClick={() => openAlbumDetail(album.id, album)}
                          className="clickable glass-panel"
                          style={{
                            borderRadius: "var(--radius-md)",
                            backgroundColor: "var(--bg-surface)",
                            border: "1px solid var(--border-subtle)",
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            cursor: "pointer",
                            transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = "translateY(-2px)";
                            e.currentTarget.style.borderColor = "var(--accent-primary)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.borderColor = "var(--border-subtle)";
                          }}
                        >
                          {/* Album Cover Art */}
                          <div
                            style={{
                              height: "160px",
                              backgroundColor: "var(--bg-surface-elevated)",
                              position: "relative",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--text-muted)",
                              overflow: "hidden",
                            }}
                          >
                            {hasValidCover ? (
                              <img
                                src={`http://127.0.0.1:8000/api/photos/${album.cover_photo_id}/thumbnail?v=3`}
                                alt={album.name}
                                onError={() => setFailedCoverIds((prev) => new Set(prev).add(album.cover_photo_id!))}
                                style={{ width: "100%", height: "100%", objectFit: "cover", imageRendering: "-webkit-optimize-contrast" }}
                                loading="lazy"
                              />
                            ) : (
                              <div
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  background: palette.bg,
                                  position: "relative",
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  overflow: "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    position: "absolute",
                                    width: "90px",
                                    height: "90px",
                                    borderRadius: "50%",
                                    backgroundColor: palette.glow,
                                    filter: "blur(32px)",
                                    opacity: 0.35,
                                  }}
                                />
                                <div
                                  style={{
                                    width: "50px",
                                    height: "50px",
                                    borderRadius: "var(--radius-full)",
                                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                                    backdropFilter: "blur(12px)",
                                    WebkitBackdropFilter: "blur(12px)",
                                    border: "1px solid rgba(255, 255, 255, 0.2)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    boxShadow: `0 8px 24px rgba(0, 0, 0, 0.4), 0 0 14px ${palette.iconBg}`,
                                    zIndex: 1,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: "20px",
                                      fontWeight: 800,
                                      fontFamily: "var(--font-display, Plus Jakarta Sans, sans-serif)",
                                      color: "#ffffff",
                                      textShadow: "0 2px 8px rgba(0, 0, 0, 0.5)",
                                    }}
                                  >
                                    {initial}
                                  </span>
                                </div>
                                <span
                                  style={{
                                    marginTop: "8px",
                                    fontSize: "10px",
                                    fontWeight: 600,
                                    color: "rgba(255, 255, 255, 0.65)",
                                    letterSpacing: "0.05em",
                                    textTransform: "uppercase",
                                    zIndex: 1,
                                  }}
                                >
                                  Empty Album
                                </span>
                              </div>
                            )}

                            {/* Vault / Favorite Badges */}
                            <div style={{ position: "absolute", top: "10px", right: "10px", display: "flex", gap: "6px" }}>
                              {album.is_vault && (
                                <span
                                  title="Encrypted Vault Album"
                                  style={{
                                    backgroundColor: "rgba(59, 130, 246, 0.9)",
                                    color: "#ffffff",
                                    padding: "3px 6px",
                                    borderRadius: "var(--radius-xs)",
                                    fontSize: "10px",
                                    fontWeight: 700,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "3px",
                                  }}
                                >
                                  <Lock size={10} /> VAULT
                                </span>
                              )}
                              {album.is_favorite && (
                                <span
                                  style={{
                                    backgroundColor: "rgba(239, 68, 68, 0.9)",
                                    color: "#ffffff",
                                    padding: "4px 6px",
                                    borderRadius: "var(--radius-xs)",
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                >
                                  <Heart size={11} fill="#ffffff" />
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Card Meta Content */}
                          <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <h3 style={{ fontSize: "14px", fontWeight: 700, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {album.name}
                              </h3>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleFavorite(album.id);
                                }}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: album.is_favorite ? "var(--accent-danger, #ef4444)" : "var(--text-muted)",
                                  cursor: "pointer",
                                  padding: "2px",
                                }}
                              >
                                <Heart size={14} fill={album.is_favorite ? "currentColor" : "none"} />
                              </button>
                            </div>

                            <div
                              style={{
                                marginTop: "6px",
                                paddingTop: "8px",
                                borderTop: "1px solid var(--border-subtle)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                                {album.photo_count} {album.photo_count === 1 ? "photo" : "photos"}
                              </span>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onLockAlbumToVault?.(album.id, album.is_vault);
                                  if (!album.is_vault) {
                                    setAlbums((prev) => prev.filter((a) => a.id !== album.id));
                                  }
                                }}
                                className="clickable"
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: album.is_vault ? "var(--accent-success)" : "var(--accent-primary)",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                {album.is_vault ? <Unlock size={12} /> : <Lock size={12} />}
                                {album.is_vault ? "Decrypt" : "Lock"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
};
