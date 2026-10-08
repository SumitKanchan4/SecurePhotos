import React from "react";

export interface SegmentedPillOption<T extends string = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedPillProps<T extends string = string> {
  options: SegmentedPillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}

/**
 * SegmentedPill Component
 *
 * Liquid-glass segmented pill group for selecting among mutual options.
 */
export const SegmentedPill = <T extends string = string>({
  options,
  value,
  onChange,
  size = "md",
}: SegmentedPillProps<T>): React.ReactElement => {
  const isSm = size === "sm";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px",
        borderRadius: "var(--radius-full)",
        backgroundColor: "var(--glass-pill-bg)",
        border: "1px solid var(--glass-border)",
        gap: "3px",
      }}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="clickable"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: isSm ? "4px 10px" : "6px 14px",
              borderRadius: "var(--radius-full)",
              fontSize: isSm ? "11px" : "12px",
              fontWeight: isSelected ? 700 : 500,
              backgroundColor: isSelected ? "var(--glass-surface)" : "transparent",
              color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
              border: isSelected ? "1px solid var(--glass-border)" : "1px solid transparent",
              boxShadow: isSelected ? "var(--glass-shadow)" : "none",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {opt.icon && <span style={{ display: "inline-flex" }}>{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
};
