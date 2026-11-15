/**
 * Search inside one page (R9c): a search icon in the page header that opens a small field
 * filtering only that page. Escape or × clears and closes it. Searching the whole library is
 * the Search page (Ctrl+K).
 */
import React, { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

interface InlineSearchProps {
  /** Accessible name of both the button and the field, e.g. "Search albums". */
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export const InlineSearch: React.FC<InlineSearchProps> = ({ label, placeholder, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = open || value !== "";

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    onChange("");
    setOpen(false);
  };

  if (!shown) {
    return (
      <button type="button" className="dash-icon-btn" aria-label={label} title={label} onClick={() => setOpen(true)}>
        <Search size={16} />
      </button>
    );
  }
  return (
    <span className="alb-search">
      <Search size={14} aria-hidden="true" />
      <input
        ref={inputRef}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      />
      <button type="button" aria-label="Close search" onClick={close}>
        <X size={14} />
      </button>
    </span>
  );
};
