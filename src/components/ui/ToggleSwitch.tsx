import React from "react";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * ToggleSwitch Component
 *
 * Smooth, accessible iOS/macOS-style pill toggle switch with fluid transitions.
 */
export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}) => {
  const handleClick = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!disabled && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      tabIndex={disabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{
        width: "42px",
        height: "24px",
        borderRadius: "var(--radius-full)",
        backgroundColor: checked ? "var(--accent-fill)" : "var(--glass-badge-bg)",
        border: `1px solid ${checked ? "var(--accent-primary)" : "var(--glass-border)"}`,
        display: "inline-flex",
        alignItems: "center",
        padding: "2px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background-color 0.18s ease, border-color 0.18s ease",
        outline: "none",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <div
        style={{
          width: "18px",
          height: "18px",
          borderRadius: "var(--radius-full)",
          backgroundColor: "#ffffff",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.28)",
          transform: checked ? "translateX(18px)" : "translateX(0px)",
          transition: "transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />
    </div>
  );
};
