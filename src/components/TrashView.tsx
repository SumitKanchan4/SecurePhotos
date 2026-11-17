/**
 * Trash (redesign R7a, approved board): every item says how long it stays (amber in the
 * last few days). Click to select; one floating bar offers Restore (the strong action) and
 * Delete forever (asks first). Empty trash is a red outline, set apart, and asks first.
 * Vault items show as a lock tile without their name or picture.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Lock, Play, RotateCcw, Trash2, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../services/api";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { daysLeftLabel, groupByTrashMonth, isEndingSoon, itemsLabel, TrashedItem } from "./trash/trashFormat";
import { itemTitle } from "../utils/displayName";

type Pending = { kind: "selected"; ids: number[] } | { kind: "all" } | null;

export const TrashView: React.FC = () => {
  const showToast = useAppStore((state) => state.showToast);
  const [items, setItems] = useState<TrashedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/trash");
      if (res.ok) setItems(await res.json());
    } catch (err) {
      console.error("Failed to load trash:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Escape clears the selection (dialogs handle their own Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selected.size > 0 && !pending) setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, pending]);

  const groups = useMemo(() => groupByTrashMonth(items, new Date()), [items]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeLocally = (ids: number[]) => {
    const gone = new Set(ids);
    setItems((prev) => prev.filter((item) => !gone.has(item.id)));
    setSelected(new Set());
  };

  const restoreSelected = async () => {
    const ids = Array.from(selected);
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/trash/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      removeLocally(ids);
      showToast(`Restored ${itemsLabel(ids.length)}.`, "success");
      window.dispatchEvent(new CustomEvent("photos-changed", { detail: { action: "restored" } }));
    } catch {
      showToast("Those items couldn't be restored. Please try again.", "warning");
    } finally {
      setBusy(false);
    }
  };

  const deleteForever = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      if (pending.kind === "all") {
        const res = await apiFetch("/api/trash/empty", { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        removeLocally(items.map((item) => item.id));
        showToast("Trash emptied.", "info");
      } else {
        const res = await apiFetch("/api/trash/permanent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photo_ids: pending.ids }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        removeLocally(pending.ids);
        showToast(`Deleted ${itemsLabel(pending.ids.length)} for good.`, "info");
      }
      setPending(null);
    } catch {
      showToast("Those items couldn't be deleted. Please try again.", "warning");
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = pending?.kind === "all" ? items.length : pending?.ids.length ?? 0;

  return (
    <div className="trash-page">
      <div className="trash-header">
        <h1 className="trash-title">Trash</h1>
        <span className="trash-subtitle">{itemsLabel(items.length)} · deleted for good after 30 days</span>
        <div style={{ flex: 1 }} />
        {items.length > 0 && (
          <button type="button" className="danger-btn trash-empty-btn" disabled={busy} onClick={() => setPending({ kind: "all" })}>
            <Trash2 size={14} /> Empty trash…
          </button>
        )}
      </div>

      {isLoading ? null : items.length === 0 ? (
        <div className="trash-empty">
          <Trash2 size={34} />
          <h2>Trash is empty</h2>
          <p>Deleted photos and videos stay here for 30 days, so you can restore them. Then they're removed for good.</p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="trash-section" aria-label={group.label}>
            <h2 className="trash-section-title">{group.label}</h2>
            <div className="trash-grid">
              {group.items.map((item) => {
                const isSelected = selected.has(item.id);
                const soon = isEndingSoon(item.days_remaining);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`trash-tile${isSelected ? " is-selected" : ""}`}
                    aria-pressed={isSelected}
                    aria-label={`${itemTitle(item)}, ${daysLeftLabel(item.days_remaining)}`}
                    title={item.is_vault_item ? "Private Vault item" : `${itemTitle(item)} · ${item.formatted_size}`}
                    onClick={() => toggle(item.id)}
                  >
                    {item.is_vault_item ? (
                      <span className="trash-vault-tile">
                        <Lock size={22} />
                        <span>Private Vault item</span>
                      </span>
                    ) : (
                      <img src={getThumbnailUrl(item.id)} alt="" loading="lazy" draggable={false} />
                    )}
                    {item.mime_type?.startsWith("video/") && (
                      <span className="trash-video">
                        <Play size={10} fill="currentColor" />
                      </span>
                    )}
                    <span className={`trash-check${isSelected ? " is-on" : ""}`}>{isSelected && <Check size={13} strokeWidth={3} />}</span>
                    <span className={`trash-days${soon ? " is-soon" : ""}`}>{daysLeftLabel(item.days_remaining)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}

      {selected.size > 0 && (
        <div className="trash-dock" role="toolbar" aria-label="Selected items">
          <span className="trash-dock-count">{selected.size.toLocaleString()} selected</span>
          <button
            type="button"
            className="trash-dock-link"
            onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}
          >
            {selected.size === items.length ? "Select none" : "Select all"}
          </button>
          <button type="button" className="trash-restore" disabled={busy} onClick={restoreSelected}>
            <RotateCcw size={14} /> Restore
          </button>
          <button type="button" className="danger-btn" disabled={busy} onClick={() => setPending({ kind: "selected", ids: Array.from(selected) })}>
            Delete forever…
          </button>
          <button type="button" className="trash-dock-close" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <X size={16} />
          </button>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.kind === "all" ? "Empty the trash?" : `Delete ${itemsLabel(pendingCount)} forever?`}
          message={`${pending.kind === "all" ? `All ${itemsLabel(pendingCount)} in the trash` : "They"} will be removed from this computer for good. This can't be undone.`}
          confirmLabel={pending.kind === "all" ? "Empty trash" : `Delete ${itemsLabel(pendingCount)} forever`}
          busy={busy}
          onConfirm={deleteForever}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
};
