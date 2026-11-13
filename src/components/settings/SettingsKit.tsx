/**
 * Building blocks for Settings (redesign R6): a titled group of rows, a row (title, plain
 * description, control on the right), and a pill choice (one of a few values, the chosen one
 * filled lime). Every section uses these, so Settings reads as one calm list.
 */
import React from "react";

export const SettingsGroup: React.FC<{ title?: string; note?: React.ReactNode; danger?: boolean; children: React.ReactNode }> = ({
  title,
  note,
  danger,
  children,
}) => (
  <section className="settings-group">
    {title && <h3 className={`settings-group-title${danger ? " is-danger" : ""}`}>{title}</h3>}
    <div className={`settings-card${danger ? " is-danger" : ""}`}>{children}</div>
    {note && <p className="settings-note">{note}</p>}
  </section>
);

export const SettingRow: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Put the control under the text instead of beside it (sliders, long values). */
  stacked?: boolean;
  danger?: boolean;
  children?: React.ReactNode;
}> = ({ title, description, stacked, danger, children }) => (
  <div className={`settings-row${stacked ? " is-stacked" : ""}`}>
    <div className="settings-row-text">
      <p className={`settings-row-title${danger ? " is-danger" : ""}`}>{title}</p>
      {description && <p className="settings-row-desc">{description}</p>}
    </div>
    {children !== undefined && <div className="settings-row-control">{children}</div>}
  </div>
);

export interface PillOption<T extends string | number> {
  value: T;
  label: string;
}

export function ChoicePills<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-pills" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`settings-pill${option.value === value ? " is-on" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
