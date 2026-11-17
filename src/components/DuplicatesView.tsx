/**
 * Duplicates (redesign R7c, approved board): one card per group. The best copy is ticked and
 * ringed in lime; unticked copies are dimmed and labelled "Goes to Trash" (30 days to undo).
 * The button says what will happen ("Remove 2 copies"). "Keep the best in all" asks first.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, RefreshCw } from "lucide-react";
import type { DuplicateGroupItem, PhotoItem } from "../types";
import { useAppStore } from "../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../services/api";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { formatSize, groupTitle, plural, reclaimableBytes, resolveLabel } from "./dashboard/dashFormat";
import { itemTitle } from "../utils/displayName";

interface DuplicatesViewProps {
  onBack: () => void;
  onPhotoClick?: (index: number, photos: PhotoItem[]) => void;
  onRefreshTelemetry?: () => void;
}

export const DuplicatesView: React.FC<DuplicatesViewProps> = ({ onBack, onPhotoClick, onRefreshTelemetry }) => {
  const showToast = useAppStore((s) => s.showToast);
  const [groups, setGroups] = useState<DuplicateGroupItem[]>([]);
  const [keep, setKeep] = useState<Record<string, number[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busyAll, setBusyAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/duplicates/groups");
      if (res.ok) {
        const data = await res.json();
        setGroups(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load duplicates:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const kept = useCallback((g: DuplicateGroupItem) => keep[g.group_id] ?? [g.suggested_best_photo_id], [keep]);
  const freeable = useMemo(() => reclaimableBytes(groups, keep), [groups, keep]);

  const toggle = (g: DuplicateGroupItem, id: number) =>
    setKeep((prev) => {
      const current = prev[g.group_id] ?? [g.suggested_best_photo_id];
      if (current.includes(id)) {
        if (current.length === 1) return prev; // always keep at least one
        return { ...prev, [g.group_id]: current.filter((x) => x !== id) };
      }
      return { ...prev, [g.group_id]: [...current, id] };
    });

  const lookAgain = async () => {
    setIsScanning(true);
    try {
      const res = await apiFetch("/api/duplicates/scan", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const found: DuplicateGroupItem[] = Array.isArray(data) ? data : [];
      setGroups(found);
      setKeep({});
      showToast(found.length ? `Found ${plural(found.length, "group")} of duplicates.` : "No duplicates found.", "info");
      onRefreshTelemetry?.();
    } catch {
      showToast("Your library couldn't be checked right now.", "warning");
    } finally {
      setIsScanning(false);
    }
  };

  const resolve = async (g: DuplicateGroupItem) => {
    const keepIds = kept(g);
    setBusyGroup(g.group_id);
    try {
      const res = await apiFetch("/api/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: g.group_id, keep_photo_ids: keepIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGroups((prev) => prev.filter((x) => x.group_id !== g.group_id));
      showToast(
        data.trashed_count > 0
          ? `Moved ${plural(data.trashed_count, "copy", "copies")} to Trash (${formatSize(data.reclaimed_bytes || 0)}). You can restore them for 30 days.`
          : "Kept them all. They won't be suggested again.",
        "success",
      );
      onRefreshTelemetry?.();
    } catch {
      showToast("That group couldn't be cleaned up. Please try again.", "warning");
    } finally {
      setBusyGroup(null);
    }
  };

  const keepBestInAll = async () => {
    setBusyAll(true);
    try {
      const res = await apiFetch("/api/duplicates/resolve-all-best", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGroups([]);
      setConfirmAll(false);
      showToast(
        `Moved ${plural(data.trashed_count || 0, "copy", "copies")} to Trash (${formatSize(data.reclaimed_bytes || 0)}). You can restore them for 30 days.`,
        "success",
      );
      onRefreshTelemetry?.();
    } catch {
      showToast("The duplicates couldn't be cleaned up. Please try again.", "warning");
    } finally {
      setBusyAll(false);
    }
  };

  const bestTotal = useMemo(() => reclaimableBytes(groups, {}), [groups]);
  const bestCount = groups.reduce((n, g) => n + g.photos.length - 1, 0);

  return (
    <div className="dash-page">
      <div>
        <button type="button" className="dash-back" onClick={onBack}>
          <ArrowLeft size={15} /> Dashboard
        </button>
      </div>
      <div className="dash-header">
        <h1 className="dash-title">Duplicates</h1>
        <span className="dash-subtitle">
          {plural(groups.length, "group")}
          {groups.length ? ` · about ${formatSize(freeable)} can be freed` : ""}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="dash-icon-btn" aria-label="Look again" title="Look for duplicates again" onClick={lookAgain} disabled={isScanning}>
          <RefreshCw size={16} className={isScanning ? "spin" : ""} />
        </button>
        {groups.length > 0 && (
          <button type="button" className="dash-btn" onClick={() => setConfirmAll(true)}>
            Keep the best in all…
          </button>
        )}
      </div>
      {groups.length > 0 && (
        <p className="dash-muted">
          The sharpest, largest copy is picked for you. Unticked copies go to Trash, so you can still change your mind for 30 days.
        </p>
      )}

      {isLoading ? null : groups.length === 0 ? (
        <div className="dash-empty">
          <h2>No duplicates</h2>
          <p>{isScanning ? "Looking through your library…" : "Your library has no copies or near-identical shots right now."}</p>
        </div>
      ) : (
        groups.map((g) => {
          const keepIds = kept(g);
          return (
            <section key={g.group_id} className="dash-card dup-group" aria-label={`${groupTitle(g)}, ${plural(g.photos.length, "photo")}`}>
              <div className="dash-card-head">
                <h2>{groupTitle(g)}</h2>
                <span className="dash-muted">
                  {plural(g.photos.length, "photo")} · {formatSize(g.photos.reduce((n, p) => n + (p.file_size || 0), 0))}
                </span>
                <div style={{ flex: 1 }} />
                <button type="button" className="dash-btn dash-btn-small" onClick={() => setGroups((prev) => prev.filter((x) => x.group_id !== g.group_id))}>
                  Skip
                </button>
                <button type="button" className="dash-btn dash-btn-small dash-btn-primary" disabled={busyGroup === g.group_id} onClick={() => resolve(g)}>
                  {busyGroup === g.group_id && <Loader2 size={13} className="spin" />}
                  {resolveLabel(g, keepIds)}
                </button>
              </div>
              <div className="dup-row">
                {g.photos.map((p, i) => {
                  const keeping = keepIds.includes(p.id);
                  const best = p.id === g.suggested_best_photo_id;
                  return (
                    <div key={p.id} className={`dup-item${keeping ? " is-kept" : ""}`}>
                      <button
                        type="button"
                        className={`dup-photo${best && keeping ? " is-best" : ""}`}
                        aria-label={`Open ${itemTitle(p)} ${i + 1}`}
                        onClick={() => onPhotoClick?.(i, g.photos)}
                      >
                        <img src={getThumbnailUrl(p.id)} alt="" loading="lazy" draggable={false} />
                      </button>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={keeping}
                        aria-label={`Keep ${itemTitle(p)} ${i + 1}`}
                        className={`dup-check${keeping ? " is-on" : ""}`}
                        onClick={() => toggle(g, p.id)}
                      >
                        {keeping && <Check size={13} strokeWidth={3} />}
                      </button>
                      <span className={`dup-label${keeping ? " is-kept" : ""}`}>{keeping ? (best ? "Keep · best pick" : "Keep") : "Goes to Trash"}</span>
                      <span className="dash-muted dup-meta">
                        {p.width && p.height ? `${p.width} × ${p.height} · ` : ""}
                        {formatSize(p.file_size || 0)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {confirmAll && (
        <ConfirmDialog
          title="Keep the best in every group?"
          message={`${plural(bestCount, "copy", "copies")} (${formatSize(bestTotal)}) will go to Trash. The best copy in each of the ${plural(groups.length, "group")} stays. You can restore them from Trash for 30 days.`}
          confirmLabel={`Move ${plural(bestCount, "copy", "copies")} to Trash`}
          busy={busyAll}
          onConfirm={keepBestInAll}
          onCancel={() => setConfirmAll(false)}
        />
      )}
    </div>
  );
};
