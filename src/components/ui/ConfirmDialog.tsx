/**
 * ConfirmDialog: an in-app "are you sure?" for actions that can't be undone (redesign R7a).
 * Replaces the browser's plain confirm() box. Escape or Cancel closes it; the confirm button
 * names the action ("Delete 3 items forever").
 */
import React, { useEffect } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

export interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, message, confirmLabel, busy, onConfirm, onCancel }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="danger-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="danger-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <div className="danger-dialog-title">
          <AlertTriangle size={22} />
          <h3 id="confirm-title">{title}</h3>
        </div>
        <p id="confirm-message" className="danger-dialog-text">
          {message}
        </p>
        <div className="danger-dialog-actions">
          <button type="button" className="danger-cancel" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button type="button" className="danger-btn danger-btn-solid" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 size={13} className="spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
