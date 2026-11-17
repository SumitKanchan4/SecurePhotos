import { fireEvent, render, screen } from "@testing-library/react";
import React, { useEffect, useState } from "react";
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
  useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", selectedPhotoIds: new Set<number>(), searchQuery: "", pendingOpen: null });
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

describe("Lightbox layout (redesign R3)", () => {
  const rich: PhotoItem = {
    ...photo(7),
    caption: "baga beach, sunset",
    taken_at: "2026-11-08 18:12:00",
    camera_make: "Google",
    camera_model: "Pixel 9 Pro",
    aperture: 1.7,
    iso: 50,
    width: 7680,
    height: 5760,
  };

  function renderViewer(props: Partial<React.ComponentProps<typeof Lightbox>> = {}) {
    const handlers = { onClose: vi.fn(), onNavigate: vi.fn(), onToggleFavorite: vi.fn(), onDelete: vi.fn() };
    render(<Lightbox photos={[photo(6), rich, photo(8)]} currentIndex={1} isOpen {...handlers} {...props} />);
    return handlers;
  }

  it("keeps the surround dark in both themes while the details panel follows the theme", () => {
    useAppStore.setState({ theme: "light" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ people: [], albums: [], imported_at: null, copied_into_library: true }))));
    renderViewer();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-theme", "dark");
    expect(screen.queryByRole("complementary", { name: "Details" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByRole("complementary", { name: "Details" })).toHaveAttribute("data-theme", "light");
    vi.unstubAllGlobals();
  });

  it("opens with details hidden every time, even if they were open last time", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ people: [], albums: [], imported_at: null, copied_into_library: true }))));
    const props = { photos: [rich], currentIndex: 0, onClose: vi.fn(), onNavigate: vi.fn() };
    const { rerender } = render(<Lightbox {...props} isOpen />);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByRole("complementary", { name: "Details" })).toBeInTheDocument();
    rerender(<Lightbox {...props} isOpen={false} />);
    rerender(<Lightbox {...props} isOpen />);
    expect(screen.queryByRole("complementary", { name: "Details" })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows a friendly title, the 8K chip beside it and the date", () => {
    renderViewer();
    expect(screen.getByRole("heading", { name: "Baga beach, sunset" })).toBeInTheDocument();
    expect(screen.getByTitle("Enhanced to 8K")).toHaveTextContent("8K");
    expect(screen.getByText("Sun 8 Nov 2026 · 6:12 pm")).toBeInTheDocument();
  });

  it("keeps Trash and Move to Vault apart from the everyday actions", () => {
    const { onToggleFavorite } = renderViewer();
    const bar = screen.getByRole("banner");
    const order = Array.from(bar.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
    expect(order).toEqual(["Back", "Add to favourites", "Download", "Show details", "Move to Trash", "Move to Vault"]);
    fireEvent.click(screen.getByRole("button", { name: "Add to favourites" }));
    expect(onToggleFavorite).toHaveBeenCalledWith(7);
    expect(screen.getByRole("button", { name: "Remove from favourites" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers the original or a print-ready copy, and Escape closes the menu before the viewer", () => {
    const { onClose } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(screen.getByRole("menuitem", { name: /Photo/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Print-ready copy/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("steps with the arrows and the filmstrip", () => {
    const { onNavigate } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(onNavigate).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(onNavigate).toHaveBeenLastCalledWith(0);
    const strip = screen.getByRole("navigation", { name: "Nearby photos" });
    expect(strip.querySelector("[aria-current=true]")?.getAttribute("aria-label")).toMatch(/^Open Baga beach, sunset, 2 of \d+$/);
    // Device-made names ("photo_8.jpg") are never shown: the button says what it is and where.
    fireEvent.click(screen.getByRole("button", { name: /^Open Photo, 3 of \d+$/ }));
    expect(onNavigate).toHaveBeenLastCalledWith(2);
  });

  it("loads people and albums into the details panel and opens a person's page", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          people: [{ id: 3, name: "Rohan", face_id: 41 }],
          albums: [{ id: 9, name: "Goa 2026" }],
          imported_at: "2026-11-09 10:00:00",
          copied_into_library: true,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onClose } = renderViewer();
    fireEvent.keyDown(window, { key: "i" });
    expect(await screen.findByRole("button", { name: /Rohan/ })).toBeInTheDocument();
    expect((fetchMock.mock.calls as unknown as [string][]).map((c) => c[0])).toContain("http://127.0.0.1:50123/api/photos/7/context");
    expect(screen.getByText("Google Pixel 9 Pro")).toBeInTheDocument();
    expect(screen.getByText("f/1.7 · ISO 50")).toBeInTheDocument();
    expect(screen.getByText("Copied into your library")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Goa 2026" })).toBeInTheDocument();

    // Opens Rohan's page directly (R9c), not a hidden name filter.
    fireEvent.click(screen.getByRole("button", { name: /Rohan/ }));
    expect(useAppStore.getState()).toMatchObject({ activeTab: "people", pendingOpen: { kind: "person", id: 3 }, searchQuery: "" });
    expect(onClose).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("offers Restore instead of Move to Vault for a vault photo and never asks for its people", () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    render(<Lightbox photos={[{ ...rich, is_encrypted: true }]} currentIndex={0} isOpen onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Restore to library" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to Vault" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(fetchMock.mock.calls.some((c) => String((c as unknown[])[0]).includes("/context"))).toBe(false);
    expect(screen.queryByRole("navigation", { name: "Nearby photos" })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe("clearSelection", () => {
  it("leaves the store untouched when nothing is selected", () => {
    const before = useAppStore.getState().selectedPhotoIds;
    useAppStore.getState().clearSelection();
    expect(useAppStore.getState().selectedPhotoIds).toBe(before);
  });
});
