/**
 * VaultFactoryReset: the "Erase the vault" row of Settings → Private Vault → Danger zone (redesign R4, R6).
 *
 * Moved off the vault lock screen, where a destructive action sat next to unlocking.
 * The guard is unchanged: the screen shows what will be erased (from /api/vault/reset-preview),
 * the person types ERASE ALL DATA, and the engine checks the phrase itself.
 */
import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch } from "../../services/api";

export const RESET_PHRASE = "ERASE ALL DATA";

export const VaultFactoryReset: React.FC = () => {
  const { isVaultConfigured, setIsVaultConfigured, setIsVaultUnlocked, checkVaultStatus, showToast } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [preview, setPreview] = useState<{ photo_count: number; album_count: number } | null>(null);

  // What a reset would erase; fetched only when the dialog opens.
  useEffect(() => {
    if (!isOpen) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    apiFetch("/api/vault/reset-preview")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setPreview(data);
      })
      .catch(() => {
        /* The count is informational; the generic warning still shows. */
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    setConfirmText("");
  };

  const handleReset = async () => {
    if (confirmText.trim() !== RESET_PHRASE) return;
    setIsResetting(true);
    try {
      const res = await apiFetch("/api/vault/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send exactly what was typed; the engine verifies the phrase itself.
        body: JSON.stringify({ confirm_phrase: confirmText.trim() }),
      });
      if (res.ok) {
        setIsVaultConfigured(false);
        setIsVaultUnlocked(false);
        close();
        await checkVaultStatus();
        showToast("Vault erased. You can set up a new vault from Private Vault.", "info");
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.detail || "The vault could not be erased.", "warning");
      }
    } catch (err) {
      console.error("Reset vault error:", err);
      showToast("The vault could not be erased.", "warning");
    } finally {
      setIsResetting(false);
    }
  };

  const ready = confirmText.trim() === RESET_PHRASE;

  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <p className="settings-row-title is-danger">Erase the vault</p>
        <p className="settings-row-desc">
          {isVaultConfigured
            ? "Permanently deletes every vault photo, album and document, with the password and PIN. This cannot be undone."
            : "You don't have a vault yet, so there is nothing to erase."}
        </p>
      </div>
      <div className="settings-row-control">
        <button type="button" className="danger-btn" disabled={!isVaultConfigured} onClick={() => setIsOpen(true)} aria-label="Erase the vault">
          <Trash2 size={14} /> Erase…
        </button>
      </div>

      {isOpen && (
        <div className="danger-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !isResetting && close()}>
          <div className="danger-dialog" role="alertdialog" aria-modal="true" aria-labelledby="vault-erase-title">
            <div className="danger-dialog-title">
              <AlertTriangle size={22} />
              <h3 id="vault-erase-title">Erase your Private Vault?</h3>
            </div>
            <p className="danger-dialog-text">
              {preview && (preview.photo_count > 0 || preview.album_count > 0) ? (
                <>
                  This permanently erases{" "}
                  <strong>
                    {preview.photo_count} {preview.photo_count === 1 ? "photo" : "photos"}
                    {preview.album_count > 0 && ` and ${preview.album_count} ${preview.album_count === 1 ? "album" : "albums"}`}
                  </strong>{" "}
                  from your vault, along with its password and PIN. This can't be undone.
                </>
              ) : (
                "This permanently erases everything in your vault, along with its password and PIN. This can't be undone."
              )}
            </p>
            <label className="danger-dialog-label" htmlFor="vault-erase-confirm">
              Type <strong>{RESET_PHRASE}</strong> to confirm
            </label>
            <input
              id="vault-erase-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={RESET_PHRASE}
              autoFocus
              autoComplete="off"
              className="danger-dialog-input"
            />
            <div className="danger-dialog-actions">
              <button type="button" className="danger-cancel" onClick={close} disabled={isResetting}>
                Cancel
              </button>
              <button type="button" className="danger-btn danger-btn-solid" onClick={handleReset} disabled={!ready || isResetting}>
                {isResetting && <Loader2 size={13} className="spin" />}
                Erase permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
