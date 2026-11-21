/**
 * The one-time question on a computer the library doesn't know yet (T3): should SecurePhotos
 * improve photos here too? The answer is saved with the library and can be changed in
 * Settings → Storage → Your computers. Computers set to "Asks each time" see it at every start.
 */
import React, { useEffect, useState } from "react";
import { Laptop, Loader2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { answerForThisComputer, fetchComputers, type ComputerAnswer } from "../services/computers";

export const NewComputerDialog: React.FC = () => {
  const isEngineReady = useAppStore((s) => s.isEngineReady);
  const showToast = useAppStore((s) => s.showToast);
  const [name, setName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ComputerAnswer | null>(null);

  useEffect(() => {
    if (!isEngineReady) return;
    fetchComputers()
      .then((data) => {
        if (data.this_computer.needs_answer) {
          setName(data.this_computer.name);
          setOpen(true);
        }
      })
      .catch(() => {});
  }, [isEngineReady]);

  if (!open) return null;

  const choose = async (answer: ComputerAnswer) => {
    setBusy(answer);
    try {
      await answerForThisComputer(answer);
      setOpen(false);
      if (answer === "view") showToast("Only viewing on this computer. You can change this in Settings → Storage.", "info");
    } catch {
      showToast("Your answer couldn't be saved. Please try again.", "warning");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="alb-dialog-backdrop">
      <div
        className="alb-dialog newpc-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="newpc-title"
        aria-describedby="newpc-text"
      >
        <div className="newpc-body">
          <span className="newpc-icon" aria-hidden="true">
            <Laptop size={22} />
          </span>
          <h2 id="newpc-title">Improve your photos on this computer too?</h2>
          <p id="newpc-text">
            Your library is open on {name ? <strong>{name}</strong> : "this computer"} for the first time. SecurePhotos can
            keep improving your photos here: enhancing them to 8K, fixing old prints and preparing videos. It may keep
            the computer busy for a while.
          </p>
          <p className="newpc-hint">You can view, search and add photos either way, and change this later in Settings.</p>
        </div>
        <div className="newpc-actions">
          <button type="button" className="dash-btn dash-btn-primary" onClick={() => choose("remember")} disabled={!!busy} autoFocus>
            {busy === "remember" && <Loader2 size={13} className="spin" />}
            Yes, and remember this computer
          </button>
          <button type="button" className="dash-btn" onClick={() => choose("this_time")} disabled={!!busy}>
            {busy === "this_time" && <Loader2 size={13} className="spin" />}
            Just this time
          </button>
          <button type="button" className="dash-btn" onClick={() => choose("view")} disabled={!!busy}>
            {busy === "view" && <Loader2 size={13} className="spin" />}
            No, only view here
          </button>
        </div>
      </div>
    </div>
  );
};
