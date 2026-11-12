import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import type { PhotoItem } from "../types";
import { Lightbox } from "./Lightbox";

vi.mock("../services/external", () => ({ openExternal: vi.fn() }));

const photo = (id: number): PhotoItem => ({
  id,
  filename: `photo_${id}.jpg`,
  filepath: `originals/photo_${id}.jpg`,
  file_size: 1000,
  mime_type: "image/jpeg",
  width: 4000,
  height: 3000,
  is_favorite: false,
  is_encrypted: false,
  is_optimized: true,
  is_enhanced: true,
});

/** Like App: a global Escape handler that clears the selection, next to the viewer. */
function Harness({ onClose }: { onClose: () => void }) {
  // Opens after mount, so (as in App) the global Escape listener is registered before the viewer's.
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  const [index, setIndex] = useState(0);
  const clearSelection = useAppStore((s) => s.clearSelection);
  useAppStore((s) => s.selectedPhotoIds); // re-render when the selection changes, as App does
  useEffect(() => {
    // flushSync: in a real browser React re-renders between two window listeners of one key
    // press (microtasks run in between); jsdom's dispatchEvent doesn't, so force it here.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && flushSync(() => clearSelection());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection]);
  return (
    <Lightbox
      photos={[photo(1), photo(2), photo(3)]}
      currentIndex={index}
      isOpen={open}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
      onNavigate={setIndex}
      indexOffset={40}
      totalCount={1218}
    />
  );
}

beforeEach(() => {
  useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", selectedPhotoIds: new Set<number>() });
});

describe("Lightbox keyboard", () => {
  it("closes on Escape even when Escape also clears a selection", () => {
    useAppStore.setState({ selectedPhotoIds: new Set([5, 6]) });
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(useAppStore.getState().selectedPhotoIds.size).toBe(0);
  });

  it("counts position in the whole library and steps with the arrow keys", () => {
    render(<Harness onClose={vi.fn()} />);
    expect(screen.getByText("41 of 1,218")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("42 of 1,218")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("41 of 1,218")).toBeInTheDocument();
  });
});

describe("clearSelection", () => {
  it("leaves the store untouched when nothing is selected", () => {
    const before = useAppStore.getState().selectedPhotoIds;
    useAppStore.getState().clearSelection();
    expect(useAppStore.getState().selectedPhotoIds).toBe(before);
  });
});
