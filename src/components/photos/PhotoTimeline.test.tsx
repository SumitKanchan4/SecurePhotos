import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import type { TimelinePhoto } from "../../types";
import { isVideoProcessing, PhotoTimeline } from "./PhotoTimeline";

// jsdom has no layout: give every element a fixed size so the timeline can lay out rows.
const sizeProps = ["clientWidth", "clientHeight"] as const;
const originals = sizeProps.map((prop) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
  HTMLElement.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 56, bottom: 800, width: 56, height: 800, x: 0, y: 0, toJSON: () => ({}) });
});

afterAll(() => {
  sizeProps.forEach((prop, i) => {
    if (originals[i]) Object.defineProperty(HTMLElement.prototype, prop, originals[i]!);
  });
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});

beforeEach(() => {
  useAppStore.setState({ selectedPhotoIds: new Set<number>(), gridDensity: "comfortable", apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t" });
});

function makeLibrary(count: number, perMonth = 50): TimelinePhoto[] {
  return Array.from({ length: count }, (_, i) => {
    const monthsBack = Math.floor(i / perMonth);
    const year = 2026 - Math.floor(monthsBack / 12);
    const month = 12 - (monthsBack % 12);
    return {
      id: i + 1,
      taken_at: `${year}-${String(month).padStart(2, "0")}-01 10:00:00`,
      width: 4000,
      height: 3000,
      is_video: false,
      is_favorite: false,
      is_optimized: true,
      is_enhanced: true,
    };
  });
}

describe("PhotoTimeline", () => {
  it("shows month sections and renders only the photos near the screen", () => {
    render(<PhotoTimeline photos={makeLibrary(3000)} onOpen={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "December 2026" })).toBeInTheDocument();
    const tiles = document.querySelectorAll("[data-photo-id]");
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(200);
  });

  it("opens a photo, but selects instead while a selection is active", () => {
    const onOpen = vi.fn();
    render(<PhotoTimeline photos={makeLibrary(20)} onOpen={onOpen} />);
    fireEvent.click(document.querySelector('[data-photo-id="3"]')!);
    expect(onOpen).toHaveBeenCalledWith(2);

    fireEvent.click(document.querySelector('[data-photo-id="4"]')!, { ctrlKey: true });
    expect(useAppStore.getState().selectedPhotoIds.has(4)).toBe(true);

    fireEvent.click(document.querySelector('[data-photo-id="5"]')!);
    expect(useAppStore.getState().selectedPhotoIds.has(5)).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("selects or unselects a whole month from its header", () => {
    render(<PhotoTimeline photos={makeLibrary(80, 50)} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all of December 2026" }));
    const selected = useAppStore.getState().selectedPhotoIds;
    expect(selected.size).toBe(50);
    expect(selected.has(1) && selected.has(50) && !selected.has(51)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Unselect December 2026" }));
    expect(useAppStore.getState().selectedPhotoIds.size).toBe(0);
  });

  it("favourites without opening, and explains a video that is not ready yet", () => {
    const onOpen = vi.fn();
    const onFav = vi.fn();
    const showToast = vi.fn();
    useAppStore.setState({ showToast });
    const photos = makeLibrary(3);
    photos[1] = { ...photos[1], is_video: true, is_optimized: false, is_enhanced: false };
    render(<PhotoTimeline photos={photos} onOpen={onOpen} onToggleFavorite={onFav} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Add to favourites" })[0]);
    expect(onFav).toHaveBeenCalledWith(1);

    fireEvent.click(document.querySelector('[data-photo-id="2"]')!);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("still being prepared"), "info");
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText("Preparing")).toBeInTheDocument();
  });

  it("jumps by month or year from the scrubber and marks where you are", async () => {
    render(<PhotoTimeline photos={makeLibrary(3000)} onOpen={vi.fn()} />);
    const scrubber = screen.getByRole("navigation", { name: "Jump to date" });
    // The newest year by month, older years once each (as on the approved board).
    expect(within(scrubber).getByRole("button", { name: "December 2026" })).toHaveTextContent("Dec");
    expect(within(scrubber).getByRole("button", { name: "December 2026" })).toHaveAttribute("aria-current", "true");
    const scroller = screen.getByTestId("photo-timeline");
    act(() => {
      fireEvent.click(within(scrubber).getByRole("button", { name: "2024" }));
    });
    expect(scroller.scrollTop).toBeGreaterThan(1000);
    // The grid follows the scroll position on the next animation frame.
    await act(async () => {
      fireEvent.scroll(scroller);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(within(scrubber).getByRole("button", { name: "2024" })).toHaveAttribute("aria-current", "true");
    expect(within(scrubber).getByRole("button", { name: "December 2026" })).not.toHaveAttribute("aria-current");

    // Further into 2024 (between its start and 2023's), the year entry stays current.
    const top2024 = scroller.scrollTop;
    act(() => {
      fireEvent.click(within(scrubber).getByRole("button", { name: "2023" }));
    });
    const top2023 = scroller.scrollTop;
    scroller.scrollTop = Math.round((top2024 + top2023) / 2);
    await act(async () => {
      fireEvent.scroll(scroller);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(within(scrubber).getByRole("button", { name: "2024" })).toHaveAttribute("aria-current", "true");
  });

  it("shows the scrubber only when there are enough months (the vault asks for four)", () => {
    // 3 months of 50 photos: tall enough to scroll, but only 3 sections.
    const { unmount } = render(<PhotoTimeline photos={makeLibrary(150, 50)} onOpen={vi.fn()} vault minScrubberSections={4} />);
    expect(screen.queryByRole("navigation", { name: "Jump to date" })).not.toBeInTheDocument();
    unmount();
    render(<PhotoTimeline photos={makeLibrary(200, 50)} onOpen={vi.fn()} vault minScrubberSections={4} />);
    expect(screen.getByRole("navigation", { name: "Jump to date" })).toBeInTheDocument();
  });

  it("shows the empty state for an empty library", () => {
    render(<PhotoTimeline photos={[]} onOpen={vi.fn()} empty={<p>Nothing here yet</p>} />);
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Jump to date" })).not.toBeInTheDocument();
  });
});

describe("isVideoProcessing", () => {
  const base = makeLibrary(1)[0];
  it("only flags videos that are not converted yet or are being converted now", () => {
    expect(isVideoProcessing(base)).toBe(false);
    expect(isVideoProcessing({ ...base, is_video: true })).toBe(false);
    expect(isVideoProcessing({ ...base, is_video: true, is_optimized: false, is_enhanced: false })).toBe(true);
    expect(isVideoProcessing({ ...base, is_video: true }, base.id)).toBe(true);
  });
});
