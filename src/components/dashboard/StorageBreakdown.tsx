/**
 * "What SecurePhotos uses" (R9a; owner feedback round 1 #19: "more interactive"). One bar shows
 * every kind of content in the accent at different strengths (the one-accent palette holds), with
 * one row per kind under it. Pointing at a row or a part of the bar lights up the other; a row
 * whose content has a place in the app opens it. Used on the Dashboard and in Settings → Storage.
 */
import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AppStorageStats, StorageCategoryKey } from "../../types";
import { formatSize, storageRows } from "./dashFormat";

/** Accent strength per position (biggest first), so neighbouring parts stay apart. */
const STRENGTHS = [1, 0.62, 0.38, 0.82, 0.5, 0.28, 0.7, 0.44, 0.22];

export const StorageBreakdown: React.FC<{
  stats?: AppStorageStats | null;
  /** Opens the place in the app for a kind of content (rows without one aren't clickable). */
  onOpen?: (key: StorageCategoryKey) => void;
  openable?: StorageCategoryKey[];
}> = ({ stats, onOpen, openable = [] }) => {
  const rows = storageRows(stats);
  const [active, setActive] = useState<StorageCategoryKey | null>(null);
  if (!rows.length) return null;
  const strength = (i: number) => STRENGTHS[i % STRENGTHS.length];
  return (
    <div className={`dash-map${active ? " has-active" : ""}`} onMouseLeave={() => setActive(null)}>
      <div className="dash-map-bar" aria-hidden="true">
        {rows.map((row, i) => (
          <span
            key={row.key}
            className={`dash-map-part${active === row.key ? " is-active" : ""}`}
            style={{ width: `${Math.max(row.percent, 0.8)}%`, opacity: strength(i) }}
            title={`${row.label}: ${formatSize(row.bytes)}`}
            onMouseEnter={() => setActive(row.key)}
          />
        ))}
      </div>
      <ul className="dash-usage" aria-label="What SecurePhotos uses">
        {rows.map((row, i) => {
          const canOpen = Boolean(onOpen && openable.includes(row.key));
          const content = (
            <>
              <span className="dash-usage-swatch" style={{ opacity: strength(i) }} aria-hidden="true" />
              <span className="dash-usage-label">
                {row.label}
                {row.note && <span className="dash-usage-note"> · {row.note}</span>}
              </span>
              <span className="dash-usage-share">{row.percent >= 1 ? `${Math.round(row.percent)}%` : "<1%"}</span>
              <span className="dash-usage-size">{formatSize(row.bytes)}</span>
              {canOpen && <ChevronRight size={14} className="dash-usage-go" aria-hidden="true" />}
            </>
          );
          return (
            <li
              key={row.key}
              className={`dash-usage-row${active === row.key ? " is-active" : ""}`}
              onMouseEnter={() => setActive(row.key)}
            >
              {canOpen ? (
                <button
                  type="button"
                  className="dash-usage-open"
                  aria-label={`${row.label}, ${formatSize(row.bytes)}: open`}
                  onFocus={() => setActive(row.key)}
                  onBlur={() => setActive(null)}
                  onClick={() => onOpen?.(row.key)}
                >
                  {content}
                </button>
              ) : (
                <div className="dash-usage-open is-static">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
