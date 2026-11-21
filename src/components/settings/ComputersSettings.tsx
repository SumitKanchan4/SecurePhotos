/**
 * Settings → Storage → "Your computers" (T3): every computer the drive has been plugged into,
 * with the same three choices the app asks on a new computer, and Forget.
 */
import React, { useEffect, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import {
  fetchComputers,
  forgetComputer,
  setComputerChoice,
  type ComputerChoice,
  type ComputersResponse,
} from "../../services/computers";
import { ChoicePills, SettingRow, SettingsGroup } from "./SettingsKit";
import { CHOICE_OPTIONS, computerDescription } from "./computersFormat";

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
    <SettingsGroup
      title="Your computers"
      note="Every computer your drive has been plugged into. Improving photos (8K, old prints, videos) only runs on computers set to do the work; you can still view and import everywhere."
    >
      {!data && (
        <SettingRow
          title={failed ? "Your computers couldn't be loaded" : "Loading your computers…"}
          description={failed ? "Try again in a moment." : undefined}
        />
      )}
      {data?.computers.map((computer) => (
        <SettingRow
          key={computer.id}
          stacked
          title={
            <>
              {computer.name}
              {computer.is_this && <span className="settings-badge">This computer</span>}
            </>
          }
          description={computerDescription(computer.choice, computer.last_seen, computer.is_this)}
        >
          <div className="settings-computer-controls">
            <ChoicePills<ComputerChoice>
              label={`What ${computer.name} does`}
              options={CHOICE_OPTIONS}
              value={computer.choice}
              onChange={(choice) => run(setComputerChoice(computer.id, choice))}
            />
            {!computer.is_this && (
              <button
                type="button"
                className="settings-btn"
                onClick={() => run(forgetComputer(computer.id))}
                aria-label={`Forget ${computer.name}`}
              >
                Forget
              </button>
            )}
          </div>
        </SettingRow>
      ))}
    </SettingsGroup>
  );
};
