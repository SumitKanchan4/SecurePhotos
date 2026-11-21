/**
 * Settings → Storage → "Your computers" (T3; owner, 2026-11-21: "a bit more creative"). One tile
 * per computer the drive has been plugged into: a badge with a status light (lit: does the work,
 * ring: asks each time, grey: only views), when it was last used, what that means in one plain
 * line, and the same three choices the app asks on a new computer. The computer in use has a lime
 * outline; the others can be forgotten.
 */
import React, { useEffect, useState } from "react";
import { Eye, Laptop, MessageCircleQuestion, X, Zap } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import {
  fetchComputers,
  forgetComputer,
  setComputerChoice,
  type ComputerChoice,
  type ComputersResponse,
} from "../../services/computers";
import { CHOICE_OPTIONS, choiceMeaning, lastUsedLine } from "./computersFormat";

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
