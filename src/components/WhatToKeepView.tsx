/**
 * What to keep (A8, owner: "a page like Duplicates", not Activity). Photos the app improved
 * automatically stay as a pair (one tile in the library, the original behind it) until the
 * owner chooses: keep the improved one, both, or the original. Whatever isn't kept goes to
 * Trash for 30 days. Reached from the Photos header pill and the Dashboard.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../services/api";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { improvedLabel } from "./activity/activityFormat";
import { plural } from "./dashboard/dashFormat";

export type KeepChoice = "keep_improved" | "keep_both" | "keep_original";

export interface PendingPair {
  photo_id: number;
  original_id: number;
  ai_kind: string | null;
}

interface WhatToKeepViewProps {
  onBack: () => void;
  backLabel?: string;
  onOpenPhoto: (photoId: number) => void;
  /** After any choice: the library and the header pill count change. */
  onChanged?: () => void;
}

const DONE_MESSAGE: Record<KeepChoice, (n: number) => string> = {
  keep_improved: (n) => `Kept ${n === 1 ? "the improved photo" : `${n} improved photos`}. ${n === 1 ? "The original is" : "The originals are"} in Trash for 30 days.`,
  keep_both: (n) => `Kept both for ${plural(n, "photo")}. Your library shows the improved one with the original behind it.`,
  keep_original: (n) => `Kept ${n === 1 ? "the original" : `${n} originals`}. The improved ${n === 1 ? "photo is" : "photos are"} in Trash for 30 days.`,
};

export const WhatToKeepView: React.FC<WhatToKeepViewProps> = ({ onBack, backLabel = "Dashboard", onOpenPhoto, onChanged }) => {
  const showToast = useAppStore((s) => s.showToast);
  const [pairs, setPairs] = useState<PendingPair[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/restore/choices");
      if (res.ok) {
        const data = await res.json();
        setPairs(Array.isArray(data?.items) ? data.items : []);
        setTotal(Number(data?.total) || 0);
      }
    } catch {
      /* Shown as empty; the pill tries again. */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (ids: number[], choice: KeepChoice, which: number | "all") => {
    setBusy(which);
    try {
      const res = await apiFetch("/api/restore/choices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids, choice }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPairs((prev) => prev.filter((p) => !ids.includes(p.photo_id)));
      setTotal((t) => Math.max(0, t - ids.length));
      showToast(DONE_MESSAGE[choice](ids.length), "success");
      onChanged?.();
      if (which === "all") void load(); // More than one page waiting: show the next ones.
    } catch {
      showToast("Your choice couldn't be saved. Please try again.", "warning");
    } finally {
      setBusy(null);
      setConfirmAll(false);
    }
  };

  return (
    <div className="dash-page">
      <div>
        <button type="button" className="dash-back" onClick={onBack}>
          <ArrowLeft size={15} /> {backLabel}
        </button>
      </div>
      <div className="dash-header">
        <h1 className="dash-title">What to keep</h1>
        <span className="dash-subtitle">{total ? plural(total, "improved photo") : "Nothing to choose"}</span>
        <div style={{ flex: 1 }} />
        {pairs.length > 0 && (
          <>
            <button type="button" className="dash-btn" disabled={busy !== null} onClick={() => void choose(pairs.map((p) => p.photo_id), "keep_both", "all")}>
              Keep both for all
            </button>
            <button type="button" className="dash-btn dash-btn-primary" disabled={busy !== null} onClick={() => setConfirmAll(true)}>
              Keep improved for all…
            </button>
          </>
        )}
      </div>
      {pairs.length > 0 && (
        <p className="dash-muted">
          These photos were improved automatically. Until you choose, your library shows the improved photo with the original behind it.
          Whatever you don't keep goes to Trash, so you can change your mind for 30 days.
        </p>
      )}

      {isLoading ? null : pairs.length === 0 ? (
        <div className="dash-empty">
          <h2>Nothing to choose</h2>
          <p>Photos improved automatically show here, so you can keep the improved one, the original, or both.</p>
        </div>
      ) : (
        <ul className="keep-grid">
          {pairs.map((pair) => (
            <li key={pair.photo_id} className="dash-card keep-card" aria-label={improvedLabel(pair.ai_kind)}>
              <div className="keep-pair">
                <button type="button" className="keep-side" aria-label="Open the original" onClick={() => onOpenPhoto(pair.original_id)}>
                  <img src={getThumbnailUrl(pair.original_id)} alt="" loading="lazy" draggable={false} />
                  <span className="keep-tag">Original</span>
                </button>
                <button type="button" className="keep-side is-improved" aria-label="Open the improved photo" onClick={() => onOpenPhoto(pair.photo_id)}>
                  <img src={getThumbnailUrl(pair.photo_id)} alt="" loading="lazy" draggable={false} />
                  <span className="keep-tag">Improved</span>
                </button>
              </div>
              <p className="keep-what">{improvedLabel(pair.ai_kind)}</p>
              <div className="keep-actions" role="group" aria-label="Keep">
                <button type="button" className="dash-btn dash-btn-small dash-btn-primary" disabled={busy !== null} onClick={() => void choose([pair.photo_id], "keep_improved", pair.photo_id)}>
                  {busy === pair.photo_id && <Loader2 size={13} className="spin" />}
                  Keep improved
                </button>
                <button type="button" className="dash-btn dash-btn-small" disabled={busy !== null} onClick={() => void choose([pair.photo_id], "keep_both", pair.photo_id)}>
                  Both
                </button>
                <button type="button" className="dash-btn dash-btn-small" disabled={busy !== null} onClick={() => void choose([pair.photo_id], "keep_original", pair.photo_id)}>
                  Original
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmAll && (
        <ConfirmDialog
          title={`Keep the improved ${pairs.length === 1 ? "photo" : `${pairs.length} photos`}?`}
          message={`The ${pairs.length === 1 ? "original goes" : "originals go"} to Trash, where you can restore ${pairs.length === 1 ? "it" : "them"} for 30 days.`}
          confirmLabel="Keep improved"
          busy={busy === "all"}
          onConfirm={() => void choose(pairs.map((p) => p.photo_id), "keep_improved", "all")}
          onCancel={() => setConfirmAll(false)}
        />
      )}
    </div>
  );
};
