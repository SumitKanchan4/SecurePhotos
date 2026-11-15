import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { SearchPage } from "./SearchPage";
import { quickSearches, resultsLabel, toTimeline } from "./searchFormat";

// jsdom has no layout: give every element a fixed size so the photo grid can lay out rows.
const sizeProps = ["clientWidth", "clientHeight"] as const;
const originals = sizeProps.map((prop) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
});
afterAll(() => {
  sizeProps.forEach((prop, i) => {
    if (originals[i]) Object.defineProperty(HTMLElement.prototype, prop, originals[i]!);
  });
});

let calls: string[] = [];
function mockEngine(handler: (path: string) => unknown) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.replace("http://127.0.0.1:50123", "");
      calls.push(path);
      return new Response(JSON.stringify(handler(path) ?? []), { status: 200 });
    }),
  );
}

const photo = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  filename: `p${id}.jpg`,
  filepath: `originals/p${id}.jpg`,
  mime_type: "image/jpeg",
  taken_at: "2025-05-10 10:00:00",
  is_favorite: false,
  is_document: false,
  ...extra,
});

const START = (path: string) => {
  if (path === "/api/people") return [{ id: 7, name: "Rohan", confirmed_count: 412, cover_face_id: 70, is_close_one: true, affinity_score: 0 }];
  if (path === "/api/albums") return [{ id: 3, name: "Goa 2026", cover_photo_id: 11, photo_count: 16, is_vault: false, is_favorite: false }];
  return null;
};

beforeEach(() => {
  useAppStore.setState({
    apiBaseUrl: "http://127.0.0.1:50123",
    apiToken: "t",
    activeTab: "search",
    searchQuery: "",
    searchFocusKey: 0,
    pendingOpen: null,
    selectedPhotoIds: new Set<number>(),
    gridDensity: "comfortable",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("search helpers", () => {
  it("offers quick searches and words the results", () => {
    expect(quickSearches(new Date(2026, 10, 15)).map((q) => q.label)).toEqual(["Videos", "Favourites", "Documents", "2026", "2025"]);
    expect(resultsLabel(1)).toBe("1 photo or video");
    expect(resultsLabel(1204)).toBe("1,204 photos and videos");
    expect(toTimeline([photo(1, { mime_type: "video/mp4", is_favorite: true, width: 1920, height: 1080, is_optimized: false })] as never)[0]).toMatchObject({
      id: 1,
      is_video: true,
      is_favorite: true,
      width: 1920,
      height: 1080,
      is_optimized: false,
    });
  });
});

describe("SearchPage", () => {
  it("starts with quick searches, people and albums to open directly", async () => {
    mockEngine(START);
    render(<SearchPage onOpenPhoto={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
    const people = await screen.findByRole("region", { name: "People" });
    fireEvent.click(within(people).getByRole("button", { name: /Rohan/ }));
    expect(useAppStore.getState()).toMatchObject({ activeTab: "people", pendingOpen: { kind: "person", id: 7 } });

    act(() => useAppStore.setState({ activeTab: "search" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Albums" })).getByRole("button", { name: /Goa 2026/ }));
    expect(useAppStore.getState()).toMatchObject({ activeTab: "albums", pendingOpen: { kind: "album", id: 3 } });

    fireEvent.click(within(screen.getByRole("region", { name: "Try" })).getByRole("button", { name: "Videos" }));
    expect(useAppStore.getState().searchQuery).toBe("videos");
  });

  it("never scrolls sideways: one row of people, then See all", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}`, confirmed_count: 30 - i, is_close_one: false, affinity_score: 0 }));
    mockEngine((path) => (path === "/api/people" ? many : START(path)));
    render(<SearchPage onOpenPhoto={vi.fn()} />);
    const people = await screen.findByRole("region", { name: "People" });
    await screen.findByText("Person 1");
    // 1,100 px wide fits 11 tiles: 10 people and See all.
    expect(within(people).getAllByRole("button")).toHaveLength(11);
    expect(within(people).queryByText("Person 11")).not.toBeInTheDocument();
    fireEvent.click(within(people).getByRole("button", { name: /See all\s*30 people/ }));
    expect(useAppStore.getState().activeTab).toBe("people");
  });

  it("searches as you type, loads every match and opens a photo instead of selecting it", async () => {
    vi.useFakeTimers();
    const all = Array.from({ length: 250 }, (_, i) => photo(i + 1));
    mockEngine((path) => {
      if (path.startsWith("/api/search")) {
        const offset = Number(new URLSearchParams(path.split("?")[1]).get("offset"));
        return {
          query: "goa",
          total_photos: 250,
          photos: all.slice(offset, offset + 200),
          albums: [{ id: 3, name: "Goa 2026", cover_photo_id: 11, photo_count: 16 }],
          people: [],
          suggestions: [],
        };
      }
      return START(path);
    });
    // A selection left over from Photos must not turn clicks into selecting here.
    useAppStore.setState({ selectedPhotoIds: new Set([999]) });
    const onOpenPhoto = vi.fn();
    render(<SearchPage onOpenPhoto={onOpenPhoto} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search your library" }), { target: { value: "goa" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(calls.filter((c) => c.startsWith("/api/search"))).toEqual([
      "/api/search?q=goa&limit=200&offset=0",
      "/api/search?q=goa&limit=200&offset=200",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("250 photos and videos");
    expect(within(screen.getByRole("region", { name: "Albums" })).getByRole("button", { name: /Goa 2026/ })).toBeInTheDocument();

    const tile = document.querySelector('[data-photo-id="1"]') as HTMLElement;
    fireEvent.click(tile);
    expect(onOpenPhoto).toHaveBeenCalledTimes(1);
    const [list, index] = onOpenPhoto.mock.calls[0];
    expect(list).toHaveLength(250);
    expect(list[index].id).toBe(1);
    expect(useAppStore.getState().selectedPhotoIds.size).toBe(1);
  });

  it("says plainly when nothing matches, and Escape clears the field", async () => {
    vi.useFakeTimers();
    mockEngine((path) =>
      path.startsWith("/api/search") ? { query: "zebra", total_photos: 0, photos: [], albums: [], people: [], suggestions: [] } : START(path),
    );
    render(<SearchPage onOpenPhoto={vi.fn()} />);
    const field = screen.getByRole("searchbox", { name: "Search your library" });
    fireEvent.change(field, { target: { value: "zebra" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByRole("status")).toHaveTextContent('Nothing matches "zebra"');
    fireEvent.keyDown(field, { key: "Escape" });
    expect(useAppStore.getState().searchQuery).toBe("");
  });
});
