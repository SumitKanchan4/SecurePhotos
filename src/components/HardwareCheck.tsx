/**
 * "Getting to know this computer" (T31, owner-approved mock-up 2026-11-24). Checks memory, the
 * processor and the graphics card, times each kind of AI work on the card and on the processor
 * (about half a minute, skippable), then says what runs where. Used as step 2 of the new-computer
 * question and for "Test again" in Settings.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cancelHardwareTest, fetchHardware, startHardwareTest, type Hardware } from "../services/computers";
import { graphicsLine, jobRow, memoryLine, processorLine, readyText, testingLine } from "./settings/hardwareFormat";

const POLL_MS = 500;

export const HardwareCheck: React.FC<{
  /** Measure even when this computer was measured before (Settings' Test again). */
  force?: boolean;
  /** Done or Skip; ``tested`` is false when skipped or nothing was measured. */
  onClose: (tested: boolean) => void;
  /** "Step 2 of 2" in the new-computer dialog. */
  step?: string;
}> = ({ force = false, onClose, step }) => {
  const [hw, setHw] = useState<Hardware | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const follow = useCallback(() => {
    stop();
    timer.current = setInterval(async () => {
      try {
        const now = await fetchHardware();
        if (!now?.test) return;
        setHw(now);
        if (now.test.state !== "running") stop();
      } catch {
        /* The engine is busy; try again next tick. */
      }
    }, POLL_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const first = await fetchHardware();
        if (cancelled) return;
        if (!first?.test) throw new Error("An engine without the graphics card check");
        if (first.gpu && (force || first.needs_test)) {
          setHw(await startHardwareTest());
          follow();
        } else {
          setHw(first);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [force, follow]);

  const running = hw?.test.state === "running";
  const finished = hw && !running;

  const skip = async () => {
    stop();
    await cancelHardwareTest().catch(() => undefined);
    onClose(false);
  };

  if (failed) {
    return (
      <div className="hw-check">
        <h2 className="hw-title">Getting to know this computer</h2>
        <p className="hw-text">This computer couldn't be checked just now. Photos are improved on the processor; you can test again in Settings, under Computers.</p>
        <div className="hw-foot">
          <span className="hw-spacer" />
          <button type="button" className="dash-btn dash-btn-primary" onClick={() => onClose(false)}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!hw) {
    return (
      <div className="hw-check" aria-busy="true">
        <h2 className="hw-title">Getting to know this computer</h2>
        <p className="hw-text">
          <Loader2 size={14} className="spin" aria-hidden="true" /> Looking at this computer…
        </p>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="hw-check">
        <span className="hw-done-icon" aria-hidden="true">
          <Check size={22} strokeWidth={3} />
        </span>
        <h2 className="hw-title" id="hw-title">
          This computer is ready
        </h2>
        <p className="hw-text">{readyText(hw)}</p>
        <ul className="hw-table" aria-label={hw.jobs.length ? "What runs where" : "This computer"}>
          {hw.jobs.length ? (
            hw.jobs.map((job) => {
              const row = jobRow(job);
              return (
                <li key={job.job}>
                  <span className="hw-job">{row.label}</span>
                  <span className="hw-where">{row.where}</span>
                  <span className={`hw-note${row.fast ? " is-fast" : ""}`}>{row.note}</span>
                </li>
              );
            })
          ) : (
            <>
              <li>
                <span className="hw-job">Memory</span>
                <span className="hw-where">{memoryLine(hw)}</span>
              </li>
              <li>
                <span className="hw-job">Processor</span>
                <span className="hw-where">{processorLine(hw)}</span>
              </li>
              <li>
                <span className="hw-job">Graphics card</span>
                <span className="hw-where">{graphicsLine(hw)}</span>
              </li>
            </>
          )}
        </ul>
        <div className="hw-foot">
          <span className="hw-hint">
            {hw.gpu ? "You can turn the graphics card off or test again in Settings, under Computers." : "If this computer gets a new graphics driver, SecurePhotos tests again by itself."}
          </span>
          <button type="button" className="dash-btn dash-btn-primary" onClick={() => onClose(hw.test.state === "done")} autoFocus>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hw-check">
      {step && <span className="hw-step">{step}</span>}
      <h2 className="hw-title" id="hw-title">
        Getting to know this computer
      </h2>
      <p className="hw-text">SecurePhotos checks what this computer can do, so it improves your photos the fastest way here. It takes about half a minute.</p>
      <ul className="hw-checks" aria-label="Checks">
        {[
          { label: "Memory", value: memoryLine(hw) },
          { label: "Processor", value: processorLine(hw) },
          { label: "Graphics card", value: graphicsLine(hw) },
        ].map((item) => (
          <li key={item.label}>
            <span className="hw-tick" aria-hidden="true">
              <Check size={14} strokeWidth={3} />
            </span>
            <span className="hw-item">
              <strong>{item.label}</strong>
              <span>{item.value}</span>
            </span>
          </li>
        ))}
        <li>
          <span className="hw-spinner" aria-hidden="true" />
          <span className="hw-item">
            <strong>Which is faster for each job</strong>
            <span>{testingLine(hw)}</span>
            <span className="hw-bar" role="progressbar" aria-label="Testing" aria-valuenow={hw.test.progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${Math.max(4, hw.test.progress)}%` }} />
            </span>
          </span>
        </li>
      </ul>
      <div className="hw-foot">
        <span className="hw-hint">Skipping is fine: photos are improved on the processor, and you can test later in Settings, under Computers.</span>
        <button type="button" className="dash-btn" onClick={() => void skip()}>
          Skip for now
        </button>
      </div>
    </div>
  );
};
