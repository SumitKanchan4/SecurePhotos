import React, { useState, useEffect, useCallback, useMemo } from "react";
import { 
  ArrowLeft, 
  Sparkles,
  CheckCircle2, 
  ZoomIn, 
  Star, 
  Heart,
  RefreshCw, 
  Camera,
  Check,
  CheckCheck,
  Info
} from "lucide-react";
import { DuplicateGroupItem, PhotoItem } from "../types";
import { apiFetch, getThumbnailUrl } from "../services/api";

interface DuplicatesViewProps {
  onBack: () => void;
  onPhotoClick?: (index: number, photos: PhotoItem[]) => void;
  onRefreshTelemetry?: () => void;
}

/**
 * Formats byte values into human-readable strings (B, KB, MB, GB).
 */
function formatBytes(bytes: number, decimals: number = 1): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

/**
 * DuplicatesView Component
 *
 * Full-width visual workspace allowing users to compare duplicate and burst shots
 * side-by-side, inspect photos at full resolution in the Lightbox, review AI "Best Pick"
 * recommendations, and safely reclaim disk space via 30-day soft-delete trash.
 */
export const DuplicatesView: React.FC<DuplicatesViewProps> = ({
  onBack,
  onPhotoClick,
  onRefreshTelemetry,
}) => {
  const [groups, setGroups] = useState<DuplicateGroupItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [resolvingGroupId, setResolvingGroupId] = useState<string | null>(null);
  const [isResolvingAll, setIsResolvingAll] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [selectedPhotosByGroup, setSelectedPhotosByGroup] = useState<Record<string, number[]>>({});

  // Synchronize selection state whenever groups change (defaults to AI suggested best)
  useEffect(() => {
    setSelectedPhotosByGroup((prev) => {
      const next: Record<string, number[]> = { ...prev };
      groups.forEach((g) => {
        if (!next[g.group_id] || next[g.group_id].length === 0) {
          next[g.group_id] = [g.suggested_best_photo_id];
        }
      });
      return next;
    });
  }, [groups]);

  // Toggle selection of a photo within a group
  const togglePhotoSelection = (groupId: string, photoId: number) => {
    setSelectedPhotosByGroup((prev) => {
      const current = prev[groupId] || [];
      const exists = current.includes(photoId);
      if (exists) {
        // Retain at least 1 selected photo to keep
        if (current.length === 1) return prev;
        return { ...prev, [groupId]: current.filter((id) => id !== photoId) };
      } else {
        return { ...prev, [groupId]: [...current, photoId] };
      }
    });
  };

  // Load duplicate groups
  const fetchDuplicates = useCallback(async () => {
    setIsLoading(true);
    try {
      const grpRes = await apiFetch("/api/duplicates/groups");
      if (grpRes.ok) {
        const grpData = await grpRes.json();
        setGroups(grpData);
      }
    } catch (err) {
      console.error("Failed to fetch duplicate items:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDuplicates();
  }, [fetchDuplicates]);

  // Trigger library rescan
  const handleRescan = async () => {
    setIsScanning(true);
    setNotification("Scanning library for identical hashes and burst clusters...");
    try {
      const res = await apiFetch("/api/duplicates/scan", { method: "POST" });
      if (res.ok) {
        const updatedGroups = await res.json();
        setGroups(updatedGroups);
        setNotification(`Scan complete. Found ${updatedGroups.length} duplicate groups.`);
      }
    } catch (err) {
      console.error("Failed to rescan duplicates:", err);
      setNotification("Failed to scan library for duplicates.");
    } finally {
      setIsScanning(false);
      setTimeout(() => setNotification(null), 4000);
    }
  };

  // Resolve a single duplicate group with designated photo(s) to keep
  const handleResolveGroup = async (groupId: string, keepPhotoIds: number | number[]) => {
    setResolvingGroupId(groupId);
    const targetIds = Array.isArray(keepPhotoIds) ? keepPhotoIds : [keepPhotoIds];
    try {
      const res = await apiFetch("/api/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: groupId, keep_photo_ids: targetIds }),
      });

      if (res.ok) {
        const data = await res.json();
        // Remove group from UI state
        setGroups((prev) => prev.filter((g) => g.group_id !== groupId));

        if (targetIds.length > 1 && data.trashed_count === 0) {
          setNotification(`Kept all ${targetIds.length} photos. Registered as non-duplicate permanently.`);
        } else if (targetIds.length > 1) {
          setNotification(
            `Kept ${targetIds.length} selected photos, moved ${data.trashed_count} to Trash (${formatBytes(data.reclaimed_bytes)} reclaimed).`
          );
        } else {
          setNotification(
            `Kept photo and moved ${data.trashed_count} redundant to Trash (${formatBytes(data.reclaimed_bytes)} reclaimed).`
          );
        }
        onRefreshTelemetry?.();
      }
    } catch (err) {
      console.error("Failed to resolve duplicate group:", err);
      setNotification("Failed to resolve duplicate group.");
    } finally {
      setResolvingGroupId(null);
      setTimeout(() => setNotification(null), 4000);
    }
  };

  // Skip a duplicate group for the current session (deferral without trashing or permanent dismissal)
  const handleSkipGroup = (groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.group_id !== groupId));
    setNotification("Group deferred for this session. You can review it again on your next scan.");
    setTimeout(() => setNotification(null), 4000);
  };

  // Resolve all duplicate groups keeping suggested best in each
  const handleResolveAll = async () => {
    if (groups.length === 0) return;
    const confirmed = window.confirm(
      `Resolve all ${groups.length} duplicate groups? In each group, the AI-suggested Best Pick will be kept and all redundant copies moved to the 30-Day Trash.`
    );
    if (!confirmed) return;

    setIsResolvingAll(true);
    try {
      const res = await apiFetch("/api/duplicates/resolve-all-best", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setGroups([]);
        setNotification(
          `Resolved all ${data.resolved_groups} groups! Moved ${data.trashed_count} items to Trash (${formatBytes(data.reclaimed_bytes)} reclaimed).`
        );
        onRefreshTelemetry?.();
      }
    } catch (err) {
      console.error("Failed to resolve all duplicate groups:", err);
      setNotification("Failed to bulk resolve duplicates.");
    } finally {
      setIsResolvingAll(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Real-time calculation of total reclaimable across all groups based on current unselected photos
  const totalReclaimable = useMemo(() => {
    return groups.reduce((total, group) => {
      const selectedIds = selectedPhotosByGroup[group.group_id] || [group.suggested_best_photo_id];
      const unselectedBytes = group.photos
        .filter((p) => !selectedIds.includes(p.id))
        .reduce((sum, p) => sum + (p.file_size || 0), 0);
      return total + unselectedBytes;
    }, 0);
  }, [groups, selectedPhotosByGroup]);

  return (
    <div 
      style={{ 
        flex: 1, 
        display: "flex", 
        flexDirection: "column", 
        height: "100%", 
        overflow: "hidden", 
        backgroundColor: "var(--bg-app)" 
      }}
    >
      {/* ── Section 4 Modern-Web-UI Floating Liquid Glass Header ───────────── */}
      <div
        style={{
          margin: "12px 16px 8px 16px",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid var(--glass-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--glass-shadow)",
          color: "var(--text-primary)",
          zIndex: 10,
        }}
      >
        {/* Left Column (flex: 1): Navigation and Secondary Pills */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={onBack}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-border)",
              color: "var(--text-secondary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <ArrowLeft size={13} />
            <span>Dashboard</span>
          </button>

          <button
            onClick={handleRescan}
            disabled={isScanning}
            className="clickable"
            title="Scan library for hash collisions and burst shots"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-border)",
              color: isScanning ? "var(--accent-primary)" : "var(--text-secondary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: isScanning ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <RefreshCw size={12} className={isScanning ? "spin-animation" : ""} />
            <span>{isScanning ? "Scanning..." : "Rescan"}</span>
          </button>
        </div>

        {/* Center Column (flex: 0 1 auto): Centered Title & Inline Capsule Badge */}
        <div
          style={{
            flex: "0 1 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "22px",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              fontFamily: "Plus Jakarta Sans, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            Duplicate & Burst Photos
          </h1>

          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "4px 12px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-border)",
              color: "var(--accent-primary)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            {groups.length} {groups.length === 1 ? "group" : "groups"} • {formatBytes(totalReclaimable)} Reclaimable
          </span>
        </div>

        {/* Right Column (flex: 1): Primary Bulk Action Pill */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
          <button
            onClick={handleResolveAll}
            disabled={groups.length === 0 || isResolvingAll}
            className="clickable"
            title="Automatically resolve all duplicate groups by keeping the AI-recommended Best Pick"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 16px",
              borderRadius: "var(--radius-full)",
              backgroundColor: groups.length > 0 ? "var(--accent-primary)" : "var(--glass-pill-bg)",
              border: `1px solid ${groups.length > 0 ? "transparent" : "var(--glass-border)"}`,
              color: groups.length > 0 ? "#ffffff" : "var(--text-muted)",
              fontSize: "12px",
              fontWeight: 700,
              cursor: groups.length === 0 || isResolvingAll ? "not-allowed" : "pointer",
              boxShadow: groups.length > 0 ? "0 2px 10px var(--accent-glow)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            <Sparkles size={13} className={isResolvingAll ? "spin-animation" : ""} />
            <span>{isResolvingAll ? "Resolving All..." : "Clean All (Keep Best)"}</span>
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div
          style={{
            margin: "0 16px 8px 16px",
            padding: "8px 14px",
            borderRadius: "var(--radius-md)",
            backgroundColor: "rgba(59, 130, 246, 0.12)",
            border: "1px solid rgba(59, 130, 246, 0.25)",
            color: "var(--accent-primary)",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Info size={14} />
          <span>{notification}</span>
        </div>
      )}

      {/* ── Main Workspace Scrollable Container ───────────────────────────── */}
      <div 
        style={{ 
          flex: 1, 
          overflowY: "auto", 
          padding: "8px 16px 24px 16px", 
          display: "flex", 
          flexDirection: "column", 
          gap: "16px" 
        }}
      >
        {isLoading ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: "12px",
              color: "var(--text-secondary)",
              minHeight: "300px",
            }}
          >
            <RefreshCw size={24} className="spin-animation" style={{ color: "var(--accent-primary)" }} />
            <span style={{ fontSize: "13px" }}>Analyzing library for duplicate & burst photos...</span>
          </div>
        ) : groups.length === 0 ? (
          /* Empty State: Clean Library */
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "60px 20px",
              textAlign: "center",
              gap: "14px",
              minHeight: "360px",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "rgba(16, 185, 129, 0.12)",
                border: "1px solid rgba(16, 185, 129, 0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-success)",
              }}
            >
              <CheckCircle2 size={28} />
            </div>
            <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>
              Library is Squeaky Clean!
            </h2>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "420px", margin: 0 }}>
              Zero duplicate copies or redundant burst clutter detected. Every active photo in your library is unique.
            </p>
            <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
              <button
                onClick={handleRescan}
                disabled={isScanning}
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 18px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <RefreshCw size={13} className={isScanning ? "spin-animation" : ""} />
                <span>Run Deep Rescan</span>
              </button>
              <button
                onClick={onBack}
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 18px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--accent-primary)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <span>Return to Dashboard</span>
              </button>
            </div>
          </div>
        ) : (
          /* Duplicate Groups List */
          <>
            {groups.map((group, groupIdx) => {
              const isResolving = resolvingGroupId === group.group_id;
              const isExact = group.match_type === "exact";
              const selectedIds = selectedPhotosByGroup[group.group_id] || [group.suggested_best_photo_id];
              const unselectedPhotos = group.photos.filter((p) => !selectedIds.includes(p.id));
              const groupReclaimable = unselectedPhotos.reduce((sum, p) => sum + (p.file_size || 0), 0);
              const isAllSelected = selectedIds.length === group.photos.length;

              return (
                <div
                  key={group.group_id}
                  className="glass-panel"
                  style={{
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-surface)",
                    padding: "16px 18px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                    opacity: isResolving ? 0.6 : 1,
                    transition: "all 0.2s ease",
                  }}
                >
                  {/* Group Header Bar */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "8px",
                      borderBottom: "1px solid var(--border-subtle)",
                      paddingBottom: "10px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {/* Concise Match Type Badge */}
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: isExact ? "rgba(16, 185, 129, 0.12)" : "rgba(139, 92, 246, 0.12)",
                          color: isExact ? "var(--accent-success)" : "var(--accent-vault)",
                          border: `1px solid ${isExact ? "rgba(16, 185, 129, 0.25)" : "rgba(139, 92, 246, 0.25)"}`,
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        {isExact ? <Check size={11} /> : <Camera size={11} />}
                        {isExact ? "Exact Match" : `Similar (${Math.max(80, Math.round(((64 - group.distance) / 64) * 100))}%)`}
                      </span>

                      <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        Group #{groupIdx + 1} ({group.photos.length} photos)
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {/* Dynamic Reclaimable Space Badge */}
                      <span
                        style={{
                          fontSize: "11px",
                          fontFamily: "var(--font-mono)",
                          color: groupReclaimable > 0 ? "var(--accent-success)" : "var(--text-muted)",
                          fontWeight: 700,
                          backgroundColor: groupReclaimable > 0 ? "rgba(16, 185, 129, 0.1)" : "var(--glass-pill-bg)",
                          border: `1px solid ${groupReclaimable > 0 ? "rgba(16, 185, 129, 0.25)" : "var(--glass-border)"}`,
                          padding: "4px 10px",
                          borderRadius: "var(--radius-full)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {groupReclaimable > 0 ? `+${formatBytes(groupReclaimable)} Reclaimable` : "0 B (Keeping All)"}
                      </span>

                      {/* Skip/Defer Button */}
                      <button
                        onClick={() => handleSkipGroup(group.group_id)}
                        disabled={isResolving}
                        className="clickable"
                        title="Skip this group for now and review other duplicates."
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "6px 14px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "var(--glass-pill-bg)",
                          border: "1px solid var(--glass-border)",
                          color: "var(--text-secondary)",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: isResolving ? "not-allowed" : "pointer",
                          transition: "all 0.15s ease",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span>Skip</span>
                      </button>

                      {/* Single Action Button: Keep Selected */}
                      <button
                        onClick={() => handleResolveGroup(group.group_id, selectedIds)}
                        disabled={isResolving}
                        className="clickable"
                        title={
                          isAllSelected
                            ? "Keep all photos in library and permanently dismiss this duplicate group."
                            : `Keep ${selectedIds.length} selected photos and move ${unselectedPhotos.length} to Trash.`
                        }
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
                          fontWeight: 700,
                          cursor: isResolving ? "not-allowed" : "pointer",
                          boxShadow: "0 2px 8px var(--accent-glow)",
                          transition: "all 0.15s ease",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <CheckCheck size={13} />
                        <span>Keep Selected</span>
                      </button>
                    </div>
                  </div>

                  {/* Side-by-Side Photo Comparison Layout (50/50 Grid for Pairs) */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: group.photos.length === 2 ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(260px, 1fr))",
                      gap: "16px",
                      alignItems: "start",
                    }}
                  >
                    {group.photos.map((photo, pIdx) => {
                      const isBest = photo.id === group.suggested_best_photo_id;
                      const isSelected = selectedIds.includes(photo.id);
                      const thumbUrl = getThumbnailUrl(photo.id);

                      return (
                        <div
                          key={photo.id}
                          style={{
                            width: "100%",
                            borderRadius: "var(--radius-md)",
                            border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                            backgroundColor: "var(--bg-surface-elevated)",
                            boxShadow: isSelected ? "0 0 14px var(--accent-glow)" : "var(--shadow-sm)",
                            padding: "12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "10px",
                            position: "relative",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {/* Image Box with Floating Checkbox and Floating Recommended Badge */}
                          <div
                            onClick={() => onPhotoClick?.(pIdx, group.photos)}
                            className="clickable"
                            title="Click to inspect photo in Lightbox"
                            style={{
                              position: "relative",
                              width: "100%",
                              aspectRatio: group.photos.length === 2 ? "16/10" : "1",
                              maxHeight: "380px",
                              borderRadius: "var(--radius-sm)",
                              overflow: "hidden",
                              backgroundColor: "var(--bg-app)",
                              cursor: "zoom-in",
                            }}
                          >
                            <img
                              src={thumbUrl}
                              alt={photo.filename}
                              loading="lazy"
                              onLoad={(e) => {
                                const img = e.currentTarget;
                                if (img.naturalHeight > img.naturalWidth) {
                                  img.style.objectPosition = "center 18%";
                                }
                              }}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                objectPosition: (photo.height && photo.width && photo.height > photo.width) ? "center 18%" : "center center",
                                transition: "transform 0.2s ease",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
                              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                            />

                            {/* Floating Interactive Checkbox (Top-Left of Image) */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePhotoSelection(group.group_id, photo.id);
                              }}
                              className="clickable"
                              title={isSelected ? "Uncheck to mark for removal" : "Check to keep this photo"}
                              style={{
                                position: "absolute",
                                top: "8px",
                                left: "8px",
                                width: "26px",
                                height: "26px",
                                borderRadius: "6px",
                                backgroundColor: isSelected ? "var(--accent-primary)" : "rgba(0, 0, 0, 0.45)",
                                backdropFilter: "blur(8px)",
                                WebkitBackdropFilter: "blur(8px)",
                                border: `1.5px solid ${isSelected ? "var(--accent-primary)" : "rgba(255, 255, 255, 0.6)"}`,
                                color: "#ffffff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                zIndex: 3,
                                padding: 0,
                                boxShadow: isSelected ? "0 2px 8px rgba(0, 0, 0, 0.4)" : "none",
                                transition: "all 0.15s ease",
                              }}
                            >
                              {isSelected && <Check size={15} strokeWidth={3} />}
                            </button>

                            {/* Floating Status Icons (Top-Right: Yellow Star for Recommended, Red Heart for Favorite) */}
                            {(isBest || photo.is_favorite) && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: "8px",
                                  right: "8px",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  backgroundColor: "rgba(0, 0, 0, 0.6)",
                                  backdropFilter: "blur(8px)",
                                  WebkitBackdropFilter: "blur(8px)",
                                  padding: "4px 7px",
                                  borderRadius: "var(--radius-full)",
                                  border: "1px solid rgba(255, 255, 255, 0.2)",
                                  zIndex: 3,
                                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.35)",
                                }}
                              >
                                {isBest && (
                                  <span title="Recommended Best Pick" style={{ display: "flex", alignItems: "center" }}>
                                    <Star size={13} fill="#eab308" color="#eab308" />
                                  </span>
                                )}
                                {photo.is_favorite && (
                                  <span title="Favorite Photo" style={{ display: "flex", alignItems: "center" }}>
                                    <Heart size={13} fill="#ef4444" color="#ef4444" />
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Floating Inspect Hint Badge (Bottom-Right of Image) */}
                            <div
                              style={{
                                position: "absolute",
                                bottom: "6px",
                                right: "6px",
                                backgroundColor: "rgba(0, 0, 0, 0.6)",
                                backdropFilter: "blur(4px)",
                                color: "#ffffff",
                                padding: "3px 7px",
                                borderRadius: "var(--radius-full)",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "9px",
                                fontWeight: 600,
                                pointerEvents: "none",
                              }}
                            >
                              <ZoomIn size={10} />
                              <span>Inspect</span>
                            </div>
                          </div>

                          {/* Concise Metadata Row */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px", gap: "8px" }}>
                            <span 
                              style={{ 
                                fontFamily: "var(--font-mono)", 
                                fontWeight: 600, 
                                color: "var(--text-primary)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={photo.filename}
                            >
                              {photo.filename}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                                {photo.width && photo.height ? `${photo.width} × ${photo.height}` : "Original"}
                              </span>
                              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-primary)" }}>
                                {formatBytes(photo.file_size)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};
