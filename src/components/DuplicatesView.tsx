import React, { useState, useEffect, useCallback, useMemo } from "react";
import { 
  ArrowLeft, 
  Sparkles, 
  CheckCircle2, 
  ZoomIn, 
  Star, 
  RefreshCw, 
  ShieldCheck, 
  Camera,
  Check,
  HardDrive,
  Info
} from "lucide-react";
import { DuplicateGroupItem, DuplicateSummaryResponse, PhotoItem } from "../types";

const API_BASE = "http://127.0.0.1:8000/api";

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
  const [summary, setSummary] = useState<DuplicateSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [resolvingGroupId, setResolvingGroupId] = useState<string | null>(null);
  const [isResolvingAll, setIsResolvingAll] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Load duplicate groups and summary
  const fetchDuplicates = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sumRes, grpRes] = await Promise.all([
        fetch(`${API_BASE}/duplicates/summary`),
        fetch(`${API_BASE}/duplicates/groups`),
      ]);

      if (sumRes.ok) {
        const sumData = await sumRes.json();
        setSummary(sumData);
      }
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
      const res = await fetch(`${API_BASE}/duplicates/scan`, { method: "POST" });
      if (res.ok) {
        const updatedGroups = await res.json();
        setGroups(updatedGroups);
        const sumRes = await fetch(`${API_BASE}/duplicates/summary`);
        if (sumRes.ok) setSummary(await sumRes.json());
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

  // Resolve a single duplicate group
  const handleResolveGroup = async (groupId: string, keepPhotoId: number) => {
    setResolvingGroupId(groupId);
    try {
      const res = await fetch(`${API_BASE}/duplicates/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: groupId, keep_photo_id: keepPhotoId }),
      });

      if (res.ok) {
        const data = await res.json();
        // Remove group from UI state
        setGroups((prev) => prev.filter((g) => g.group_id !== groupId));
        // Update summary
        setSummary((prev) => {
          if (!prev) return null;
          return {
            total_groups: Math.max(0, prev.total_groups - 1),
            total_duplicate_photos: Math.max(0, prev.total_duplicate_photos - data.trashed_count),
            reclaimable_bytes: Math.max(0, prev.reclaimable_bytes - data.reclaimed_bytes),
          };
        });
        setNotification(
          `Moved ${data.trashed_count} redundant copy to Trash (${formatBytes(data.reclaimed_bytes)} reclaimed).`
        );
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

  // Resolve all duplicate groups keeping suggested best in each
  const handleResolveAll = async () => {
    if (groups.length === 0) return;
    const confirmed = window.confirm(
      `Resolve all ${groups.length} duplicate groups? In each group, the AI-suggested Best Pick will be kept and all redundant copies moved to the 30-Day Trash.`
    );
    if (!confirmed) return;

    setIsResolvingAll(true);
    try {
      const res = await fetch(`${API_BASE}/duplicates/resolve-all-best`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setGroups([]);
        setSummary({
          total_groups: 0,
          total_duplicate_photos: 0,
          reclaimable_bytes: 0,
        });
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

  const totalReclaimable = useMemo(() => {
    return groups.reduce((acc, g) => acc + g.reclaimable_bytes, 0);
  }, [groups]);

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
            Duplicates & Clutter
          </h1>

          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-border)",
              color: "var(--accent-primary)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            {groups.length} {groups.length === 1 ? "group" : "groups"} • {formatBytes(totalReclaimable)} reclaimable
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
            <span>{isResolvingAll ? "Resolving All..." : "Resolve All (Keep Best)"}</span>
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
            {/* Safety & Telemetry Banner */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 18px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                fontSize: "12px",
                color: "var(--text-secondary)",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <ShieldCheck size={16} style={{ color: "var(--accent-success)" }} />
                <span>
                  <strong>Zero Data Loss Policy:</strong> Cleaned photos are routed to the <strong>30-Day Trash</strong>. You can restore any item anytime before it expires.
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", fontFamily: "var(--font-mono)" }}>
                {summary && summary.total_duplicate_photos > 0 && (
                  <span>Redundant Photos: <strong style={{ color: "var(--text-primary)" }}>{summary.total_duplicate_photos}</strong></span>
                )}
                <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <HardDrive size={14} style={{ color: "var(--accent-primary)" }} />
                  Reclaimable: <strong style={{ color: "var(--text-primary)" }}>{formatBytes(totalReclaimable)}</strong>
                </span>
              </div>
            </div>

            {/* Render Each Duplicate Group */}
            {groups.map((group, groupIdx) => {
              const isResolving = resolvingGroupId === group.group_id;
              const isExact = group.match_type === "exact";

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
                      {/* Match Type Badge */}
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
                        {isExact ? "Exact Duplicate (100% Hash Match)" : `Burst / Near Duplicate (${Math.max(80, Math.round((64 - group.distance) / 64 * 100))}% Similarity)`}
                      </span>

                      <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        Group #{groupIdx + 1} ({group.photos.length} photos)
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontFamily: "var(--font-mono)",
                          color: "var(--accent-success)",
                          fontWeight: 700,
                          backgroundColor: "rgba(16, 185, 129, 0.1)",
                          padding: "3px 8px",
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        +{formatBytes(group.reclaimable_bytes)} Reclaimable
                      </span>

                      <button
                        onClick={() => handleResolveGroup(group.group_id, group.suggested_best_photo_id)}
                        disabled={isResolving}
                        className="clickable"
                        title="Keep the AI-recommended Best Pick and trash the rest"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "5px 12px",
                          borderRadius: "var(--radius-full)",
                          backgroundColor: "var(--glass-pill-bg)",
                          border: "1px solid var(--glass-border)",
                          color: "var(--accent-primary)",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: isResolving ? "not-allowed" : "pointer",
                        }}
                      >
                        <Sparkles size={11} />
                        <span>Keep Suggested Best</span>
                      </button>
                    </div>
                  </div>

                  {/* Side-by-Side Photo Comparison Grid */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`,
                      gap: "14px",
                      alignItems: "stretch",
                    }}
                  >
                    {group.photos.map((photo, pIdx) => {
                      const isBest = photo.id === group.suggested_best_photo_id;
                      const thumbUrl = `${API_BASE}/photos/${photo.id}/thumbnail?v=3`;

                      return (
                        <div
                          key={photo.id}
                          style={{
                            borderRadius: "var(--radius-sm)",
                            border: isBest ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                            backgroundColor: "var(--bg-surface-elevated)",
                            boxShadow: isBest ? "0 0 12px var(--accent-glow)" : "var(--shadow-sm)",
                            padding: "12px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: "10px",
                            position: "relative",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {/* Top Status Tag */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: "22px" }}>
                            {isBest ? (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  fontSize: "10px",
                                  fontWeight: 800,
                                  color: "#ffffff",
                                  backgroundColor: "var(--accent-primary)",
                                  padding: "2px 8px",
                                  borderRadius: "var(--radius-full)",
                                  letterSpacing: "0.02em",
                                }}
                              >
                                <Star size={10} fill="#ffffff" />
                                <span>RECOMMENDED BEST</span>
                              </div>
                            ) : (
                              <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                Copy #{pIdx + 1}
                              </span>
                            )}

                            {isBest && group.best_reason && (
                              <span 
                                title={group.best_reason}
                                style={{
                                  fontSize: "10px",
                                  color: "var(--text-secondary)",
                                  maxWidth: "140px",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {group.best_reason}
                              </span>
                            )}
                          </div>

                          {/* Image Box with Click-to-Lightbox zoom */}
                          <div
                            onClick={() => onPhotoClick?.(pIdx, group.photos)}
                            className="clickable"
                            title="Click to inspect this photo at full resolution in Lightbox"
                            style={{
                              position: "relative",
                              width: "100%",
                              aspectRatio: "1",
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
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                transition: "transform 0.2s ease",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
                              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                            />

                            {/* Floating Lightbox Hint Badge on Hover */}
                            <div
                              style={{
                                position: "absolute",
                                bottom: "8px",
                                right: "8px",
                                backgroundColor: "rgba(0, 0, 0, 0.65)",
                                backdropFilter: "blur(4px)",
                                color: "#ffffff",
                                padding: "4px 8px",
                                borderRadius: "var(--radius-full)",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "10px",
                                fontWeight: 600,
                              }}
                            >
                              <ZoomIn size={11} />
                              <span>Inspect</span>
                            </div>
                          </div>

                          {/* Metadata Comparison Chips */}
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "4px",
                              fontSize: "11px",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "var(--text-muted)" }}>Resolution:</span>
                              <strong style={{ fontFamily: "var(--font-mono)" }}>
                                {photo.width && photo.height ? `${photo.width} × ${photo.height}` : "Unknown"}
                              </strong>
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "var(--text-muted)" }}>File Size:</span>
                              <strong style={{ fontFamily: "var(--font-mono)" }}>
                                {formatBytes(photo.file_size)}
                              </strong>
                            </div>

                            {photo.taken_at && (
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-muted)" }}>Captured:</span>
                                <span style={{ color: "var(--text-secondary)", fontSize: "10px" }}>
                                  {new Date(photo.taken_at).toLocaleDateString()}
                                </span>
                              </div>
                            )}

                            {/* Attribute tags */}
                            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "2px" }}>
                              {photo.is_favorite && (
                                <span
                                  style={{
                                    fontSize: "9px",
                                    fontWeight: 700,
                                    padding: "2px 6px",
                                    borderRadius: "var(--radius-sm)",
                                    backgroundColor: "rgba(245, 158, 11, 0.15)",
                                    color: "#f59e0b",
                                  }}
                                >
                                  ★ Favorite
                                </span>
                              )}
                              {photo.is_enhanced && (
                                <span
                                  style={{
                                    fontSize: "9px",
                                    fontWeight: 700,
                                    padding: "2px 6px",
                                    borderRadius: "var(--radius-sm)",
                                    backgroundColor: "rgba(139, 92, 246, 0.15)",
                                    color: "var(--accent-vault)",
                                  }}
                                >
                                  AI Enhanced
                                </span>
                              )}
                              {photo.is_optimized && (
                                <span
                                  style={{
                                    fontSize: "9px",
                                    fontWeight: 700,
                                    padding: "2px 6px",
                                    borderRadius: "var(--radius-sm)",
                                    backgroundColor: "rgba(16, 185, 129, 0.15)",
                                    color: "var(--accent-success)",
                                  }}
                                >
                                  Optimized
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Action Button: Keep This Specific Photo */}
                          <button
                            onClick={() => handleResolveGroup(group.group_id, photo.id)}
                            disabled={isResolving}
                            className="clickable"
                            title={`Keep this copy (${photo.filename}) and move other redundant copies to Trash`}
                            style={{
                              marginTop: "4px",
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: "var(--radius-full)",
                              backgroundColor: isBest ? "var(--accent-primary)" : "var(--glass-pill-bg)",
                              border: isBest ? "none" : "1px solid var(--border-subtle)",
                              color: isBest ? "#ffffff" : "var(--text-primary)",
                              fontSize: "12px",
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                              cursor: isResolving ? "not-allowed" : "pointer",
                              transition: "all 0.15s ease",
                            }}
                          >
                            <Check size={13} />
                            <span>Keep This Photo</span>
                          </button>
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
