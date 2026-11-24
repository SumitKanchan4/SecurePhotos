/**
 * Settings → Storage → "Your computers" (T3; owner, 2026-11-21: "a bit more creative"). One tile
 * per computer the drive has been plugged into: a badge with a status light (lit: does the work,
 * ring: asks each time, grey: only views), when it was last used, what that means in one plain
 * line, and the same three choices the app asks on a new computer. The computer in use has a lime
 * outline; the others can be forgotten.
 */
import React, { useEffect, useState } from "react";
import { Cpu, Eye, Laptop, MessageCircleQuestion, X, Zap } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import {
  fetchComputers,
  fetchHardware,
  forgetComputer,
  setComputerChoice,
  setUseGraphics,
  type ComputerChoice,
  type ComputersResponse,
  type Hardware,
} from "../../services/computers";
import { CHOICE_OPTIONS, choiceMeaning, lastUsedLine } from "./computersFormat";
import { jobRow, otherComputerGraphics } from "./hardwareFormat";
import { HardwareCheck } from "../HardwareCheck";
import { ToggleSwitch } from "../ui/ToggleSwitch";

/** T31: this computer's graphics card: what runs where, the switch, and Test again. */
const GraphicsCard: React.FC = () => {
  const showToast = useAppStore((s) => s.showToast);
  const [hw, setHw] = useState<Hardware | null>(null);
  const [testing, setTesting] = useState(false);
  const load = () =>
    fetchHardware()
      .then((got) => got?.test && setHw(got))
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  if (!hw) return null;
  if (testing) {
    return (
      <div className="pc-gpu is-testing">
        <HardwareCheck
          force
          onClose={() => {
            setTesting(false);
            void load();
          }}
        />
      </div>
    );
  }
  const toggle = () =>
    setUseGraphics(!hw.use_graphics)
      .then(setHw)
      .catch(() => showToast("That didn't work. Please try again.", "warning"));
  return (
    <div className="pc-gpu">
      <div className="pc-gpu-head">
        <Cpu size={16} aria-hidden="true" />
        <span className="pc-gpu-name">{hw.gpu ? `Graphics card: ${hw.gpu.name}` : "No graphics card SecurePhotos can use"}</span>
        {hw.gpu && (
          <ToggleSwitch checked={hw.use_graphics} onChange={() => toggle()} ariaLabel="Use the graphics card on this computer" />
        )}
      </div>
      {hw.gpu && hw.jobs.length > 0 && (
        <ul className="pc-gpu-jobs" aria-label="What runs where">
          {hw.jobs.map((job) => {
            const row = jobRow(job);
            return (
              <li key={job.job}>
                <span>{row.label}</span>
                <span className="pc-meta">{row.note ? `${row.where} · ${row.note}` : row.where}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="pc-meta">
        {!hw.gpu
          ? "Photos are improved on the processor. That works well; old-photo fixes just take a little longer."
          : hw.needs_test
          ? "Not tested yet. It is tested before the next old-photo fix, or now."
          : "Tested on this computer. A new graphics driver is tested again by itself."}
      </p>
      {hw.gpu && (
        <button type="button" className="dash-btn dash-btn-small" onClick={() => setTesting(true)}>
          {hw.needs_test ? "Test now" : "Test again"}
        </button>
      )}
    </div>
  );
};

const CHOICE_ICONS: Record<ComputerChoice, React.ReactNode> = {
  always: <Zap size={14} aria-hidden="true" />,
  ask: <MessageCircleQuestion size={14} aria-hidden="true" />,
  view: <Eye size={14} aria-hidden="true" />,
};

export const ComputersSettings: React.FC = () => {
  const showToast = useAppStore((s) => s.showToast);
  const [data, setData] = useState<ComputersResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchComputers().then(setData).catch(() => setFailed(true));
  }, []);

  const run = (action: Promise<ComputersResponse>) =>
    action.then(setData).catch(() => showToast("That didn't work. Please try again.", "warning"));

  return (
    <section className="settings-group" aria-labelledby="pc-title">
      <h3 id="pc-title" className="settings-group-title">
        Your computers
      </h3>
      {!data && <p className="pc-empty">{failed ? "Your computers couldn't be loaded. Try again in a moment." : "Loading your computers…"}</p>}
      {data && (
        <ul className="pc-list" aria-label="Your computers">
          {data.computers.map((computer) => (
            <li key={computer.id} className={`pc-tile is-${computer.choice}${computer.is_this ? " is-this" : ""}`}>
              <div className="pc-head">
                <span className="pc-badge" aria-hidden="true">
                  <Laptop size={20} />
                  <span className="pc-light" />
                </span>
                <div className="pc-text">
                  <p className="pc-name">
                    {computer.name}
                    {computer.is_this && <span className="settings-badge">This computer</span>}
                  </p>
                  <p className="pc-meta">{lastUsedLine(computer.last_seen, computer.is_this)}</p>
                  <p className="pc-meaning">{choiceMeaning(computer.choice)}</p>
                  {!computer.is_this && computer.graphics && <p className="pc-meta">Graphics card: {otherComputerGraphics(computer.graphics)}</p>}
                </div>
                {!computer.is_this && (
                  <button
                    type="button"
                    className="pc-forget"
                    onClick={() => run(forgetComputer(computer.id))}
                    aria-label={`Forget ${computer.name}`}
                    title="Forget this computer. It will be asked again the next time your drive is plugged into it."
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <div className="pc-choices" role="radiogroup" aria-label={`What ${computer.name} does`}>
                {CHOICE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={computer.choice === option.value}
                    className={`pc-choice${computer.choice === option.value ? " is-on" : ""}`}
                    onClick={() => computer.choice !== option.value && run(setComputerChoice(computer.id, option.value))}
                  >
                    {CHOICE_ICONS[option.value]}
                    {option.label}
                  </button>
                ))}
              </div>
              {computer.is_this && <GraphicsCard />}
            </li>
          ))}
        </ul>
      )}
      <p className="settings-note">
        Every computer your drive has been plugged into. Improving photos (8K, old prints, videos) only runs on computers
        set to do the work; you can view and add photos on all of them.
      </p>
    </section>
  );
};
