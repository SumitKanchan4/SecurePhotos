/**
 * "What SecurePhotos uses" (R9a): one row per kind of content with its size and a thin bar
 * showing its share. Rows instead of a many-coloured chart, so the one-accent palette holds.
 * Used on the Dashboard and in Settings → Storage.
 */
import React from "react";
import type { AppStorageStats } from "../../types";
import { formatSize, storageRows } from "./dashFormat";

export const StorageBreakdown: React.FC<{ stats?: AppStorageStats | null }> = ({ stats }) => {
  const rows = storageRows(stats);
  if (!rows.length) return null;
  return (
    <ul className="dash-usage" aria-label="What SecurePhotos uses">
      {rows.map((row) => (
        <li key={row.key} className="dash-usage-row">
          <span className="dash-usage-label">
            {row.label}
            {row.note && <span className="dash-usage-note"> · {row.note}</span>}
          </span>
          <span className="dash-usage-size">{formatSize(row.bytes)}</span>
          <span className="dash-usage-track" aria-hidden="true">
            <span className="dash-usage-fill" style={{ width: `${Math.max(row.percent, 0.8)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
};
