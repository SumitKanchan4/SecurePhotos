/**
 * "Print a new card" (redesign R6): replaces the Emergency Card from Settings → Private Vault.
 *
 * Asks for the master password (the card is the last-resort key), then shows the new card
 * once, with Save card image / Save text copy. The old card stops working immediately.
 */
import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileText, Loader2 } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch } from "../../services/api";
import { downloadGridCardImage, downloadGridCardText, GridCardData, renderGridCardCanvas } from "../../utils/gridCardRenderer";

export const EmergencyCardReplace: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const showToast = useAppStore((s) => s.showToast);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<GridCardData | null>(null);
  const [saved, setSaved] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (card && canvasRef.current) {
      try {
        renderGridCardCanvas(canvasRef.current, card);
      } catch {
        /* the card can still be saved as text */
      }
    }
  }, [card]);

  const replace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/vault/grid-card/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || "The card couldn't be replaced.");
        return;
      }
      setPassword("");
      setCard(data.grid_card);
    } catch {
      setError("The card couldn't be replaced.");
    } finally {
      setBusy(false);
    }
  };

  const saveImage = async () => {
    if (!card) return;
    try {
      await downloadGridCardImage(card);
      setSaved(true);
    } catch {
      showToast("The card image couldn't be saved.", "warning");
    }
  };

  return (
    <div className="danger-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !card && !busy && onClose()}>
      <div className="danger-dialog card-dialog" role="dialog" aria-modal="true" aria-labelledby="card-replace-title">
        <h3 id="card-replace-title" className="card-dialog-title">
          {card ? "Your new Emergency Card" : "Print a new Emergency Card"}
        </h3>
        {!card ? (
          <form onSubmit={replace} className="card-dialog-body">
            <p className="danger-dialog-text">
              Your current card will stop working as soon as the new one is made. Enter your master password to continue.
            </p>
            <label className="danger-dialog-label" htmlFor="card-replace-password">
              Master password
            </label>
            <input
              id="card-replace-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              className="danger-dialog-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <p className="vault-error" role="alert">
                <AlertTriangle size={14} />
                <span>{error}</span>
              </p>
            )}
            <div className="danger-dialog-actions">
              <button type="button" className="danger-cancel" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="settings-btn settings-btn-primary" disabled={!password || busy}>
                {busy && <Loader2 size={13} className="spin" />}
                Make new card
              </button>
            </div>
          </form>
        ) : (
          <div className="card-dialog-body">
            <p className="danger-dialog-text">
              Save or print it now and keep it somewhere safe. It won't be shown again. Your old card no longer works.
            </p>
            <canvas ref={canvasRef} className="card-dialog-canvas" aria-label={`Emergency Card ${card.card_id}`} />
            <div className="card-dialog-saves">
              <button type="button" className="settings-btn" onClick={saveImage}>
                <Download size={14} /> Save card image
              </button>
              <button
                type="button"
                className="settings-btn"
                onClick={() => {
                  downloadGridCardText(card);
                  setSaved(true);
                }}
              >
                <FileText size={14} /> Save text copy
              </button>
            </div>
            <div className="danger-dialog-actions">
              <button
                type="button"
                className="settings-btn settings-btn-primary"
                onClick={() => {
                  if (!saved && !window.confirm("You haven't saved the new card. Close anyway? It can't be shown again.")) return;
                  showToast("New Emergency Card is ready. Your old card no longer works.", "success");
                  onClose();
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
