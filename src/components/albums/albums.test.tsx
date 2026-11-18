import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import type { AlbumItem, PhotoItem } from "../../types";
import { AlbumsView } from "../AlbumsView";
import { AlbumPage } from "./AlbumPage";
import { albumMeta, albumPageMeta, daySpan, filterAlbums, isCollagesAlbum, monthSpan } from "./albumsFormat";

// jsdom has no layout: give elements a size so the photo grid lays out its tiles.
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

const photo = (id: number, taken: string, extra: Partial<PhotoItem> = {}): PhotoItem => ({
  id,
  filename: `IMG_${id}.jpg`,
  filepath: `p/${id}.jpg`,
  file_size: 1000,
  mime_type: "image/jpeg",
  width: 4000,
  height: 3000,
  taken_at: taken,
  is_favorite: false,
  is_encrypted: false,
  is_optimized: true,
  is_enhanced: true,
  ...extra,
});

const GOA: AlbumItem = { id: 7, name: "Goa 2026", is_vault: false, is_favorite: false, photo_count: 3, cover_photo_id: 1, first_taken_at: "2026-11-08 09:00:00", last_taken_at: "2026-11-12 18:00:00" };
const DIWALI: AlbumItem = { id: 8, name: "Diwali 2025", is_vault: false, is_favorite: false, photo_count: 0 };
const COLLAGES: AlbumItem = { id: 9, name: "Collages", is_vault: false, is_favorite: false, photo_count: 4, cover_photo_id: 40 };
const GOA_PHOTOS = [photo(1, "2026-11-08 09:00:00"), photo(2, "2026-11-10 12:00:00"), photo(3, "2026-11-12 18:00:00")];

type Call = { url: string; init?: RequestInit };
let calls: Call[];

function mockEngine(routes: Record<string, unknown>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const path = url.replace("http://127.0.0.1:50123", "");
      const key = `${init?.method ?? "GET"} ${path}`;
      const body = key in routes ? routes[key] : routes[`${init?.method ?? "GET"} ${path.split("?")[0]}`];
      return new Response(JSON.stringify(body ?? {}), { status: 200 });
    }),
  );
}

const posted = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix) && c.init?.method && c.init.method !== "GET");

beforeEach(() => {
  useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", showToast: vi.fn(), selectedPhotoIds: new Set<number>(), gridDensity: "comfortable", pendingOpen: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("albums helpers", () => {
  it("says when an album's photos were taken", () => {
    expect(monthSpan("2026-11-08 09:00:00", "2026-11-12 18:00:00")).toBe("Nov 2026");
    expect(monthSpan("2025-10-01", "2025-12-30")).toBe("Oct – Dec 2025");
    expect(monthSpan("2024-12-28", "2025-01-03")).toBe("Dec 2024 – Jan 2025");
    expect(daySpan("2026-11-12", "2026-11-12")).toBe("12 Nov 2026");
    expect(daySpan("2026-11-08", "2026-11-12")).toBe("8–12 Nov 2026");
    expect(daySpan("2026-10-28", "2026-11-03")).toBe("28 Oct – 3 Nov 2026");
    expect(daySpan("2024-12-28", "2025-01-03")).toBe("28 Dec 2024 – 3 Jan 2025");
    expect(monthSpan(null, null)).toBe("");
    expect(albumMeta(GOA)).toBe("3 photos · Nov 2026");
    expect(albumMeta(DIWALI)).toBe("Empty");
    expect(albumMeta({ photo_count: 1 })).toBe("1 photo");
    expect(albumPageMeta(GOA_PHOTOS)).toBe("3 photos · 8–12 Nov 2026");
    expect(albumPageMeta([])).toBe("Empty");
    expect(isCollagesAlbum(COLLAGES)).toBe(true);
    expect(filterAlbums([GOA, DIWALI], "goa")).toEqual([GOA]);
    expect(filterAlbums([GOA, DIWALI], "  ")).toEqual([GOA, DIWALI]);
  });
});

describe("AlbumsView", () => {
  const routes = {
    "GET /api/albums": [GOA, DIWALI, COLLAGES],
    "GET /api/photos?favorite_only=true": [photo(5, "2026-01-01"), photo(6, "2026-01-02")],
    "GET /api/stories?saved_only=true": [{ id: 1, title: "Goa trip", cover_photo_id: 2, slides: [] }],
    "GET /api/albums/7": { ...GOA, photos: GOA_PHOTOS },
  };

  it("shows albums made for you on top and your own albums as covers", async () => {
    mockEngine(routes);
    render(<AlbumsView />);
    expect(await screen.findByText("3 photos · Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("2 albums")).toBeInTheDocument(); // Collages is not one of yours
    const forYou = screen.getByRole("region", { name: "Made for you" });
    expect(within(forYou).getByRole("button", { name: /Favourites\s*2 photos/ })).toBeInTheDocument();
    expect(within(forYou).getByRole("button", { name: /Saved stories\s*1 story/ })).toBeInTheDocument();
    expect(within(forYou).getByRole("button", { name: /Collages\s*4 collages/ })).toBeInTheDocument();
    // Fixed, designed covers (round 1, #17): the same picture whatever is inside; each has its badge.
    const favCard = within(forYou).getByRole("button", { name: /Favourites\s*2 photos/ });
    expect(favCard.querySelector(".alb-made-cover")?.className).toContain("is-favourites");
    expect(forYou.querySelectorAll(".alb-made-cover img")).toHaveLength(0);
    expect(Array.from(forYou.querySelectorAll(".alb-made-badge")).map((b) => b.textContent)).toEqual(["Favourites", "Stories", "Collages"]);
    const yours = screen.getByRole("region", { name: "Your albums" });
    expect(within(yours).queryByText("Collages")).not.toBeInTheDocument();
    expect(within(yours).getByText("Empty")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search albums" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search albums" }), { target: { value: "diw" } });
    expect(within(yours).queryByText("Goa 2026")).not.toBeInTheDocument();
    expect(within(yours).getByText("Diwali 2025")).toBeInTheDocument();
  });

  it("opens an album asked for from Search or the viewer", async () => {
    mockEngine(routes);
    useAppStore.setState({ pendingOpen: { kind: "album", id: 7 } });
    render(<AlbumsView />);
    expect(await screen.findByRole("heading", { level: 1, name: "Goa 2026" })).toBeInTheDocument();
    expect(useAppStore.getState().pendingOpen).toBeNull();
  });

  it("creates an album and opens it", async () => {
    mockEngine({ ...routes, "POST /api/albums": { ...DIWALI, id: 12, name: "Kerala" }, "GET /api/albums/12": { ...DIWALI, id: 12, name: "Kerala", photos: [] } });
    render(<AlbumsView />);
    fireEvent.click(await screen.findByRole("button", { name: "+ New album" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New album name" }), { target: { value: "  Kerala " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });
    expect(JSON.parse(String(posted("/api/albums")[0].init?.body))).toEqual({ name: "Kerala" });
    expect(await screen.findByRole("heading", { level: 1, name: "Kerala" })).toBeInTheDocument();
    expect(await screen.findByText("This album is empty")).toBeInTheDocument();
  });
});

describe("AlbumPage", () => {
  const routes = { "GET /api/albums/7": { ...GOA, photos: GOA_PHOTOS } };
  const open = (props: Partial<React.ComponentProps<typeof AlbumPage>> = {}) =>
    render(<AlbumPage target={{ kind: "album", album: GOA }} savedStories={[]} onBack={vi.fn()} onChanged={vi.fn()} {...props} />);

  it("keeps rare actions in one menu and asks before deleting the album", async () => {
    mockEngine({ ...routes, "DELETE /api/albums/7": { status: "deleted" } });
    const onBack = vi.fn();
    open({ onBack });
    expect(await screen.findByText("3 photos · 8–12 Nov 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
      "Rename",
      "Choose cover photo",
      "Delete album (photos stay)",
    ]); // no Vault entry without a Vault handler
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete album (photos stay)" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete the album Goa 2026?" });
    expect(dialog).toHaveTextContent("Its photos stay in your library.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(posted("/api/albums/7")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete album (photos stay)" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete album" }));
    });
    expect(posted("/api/albums/7")[0].init?.method).toBe("DELETE");
    expect(onBack).toHaveBeenCalled();
  });

  it("renames, chooses a cover by clicking a photo, and moves the album to the Vault after asking", async () => {
    mockEngine({ ...routes, "PATCH /api/albums/7": { ...GOA, name: "Goa Nov 2026" }, "POST /api/albums/7/cover": { cover_photo_id: 2 } });
    const onLock = vi.fn(async () => {});
    const onPhotoClick = vi.fn();
    open({ onLockAlbumToVault: onLock, onPhotoClick });
    await screen.findByText("3 photos · 8–12 Nov 2026");

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Album name" }), { target: { value: "Goa Nov 2026" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(JSON.parse(String(posted("/api/albums/7")[0].init?.body))).toEqual({ name: "Goa Nov 2026" });
    expect(screen.getByRole("heading", { level: 1, name: "Goa Nov 2026" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Choose cover photo" }));
    expect(screen.getByRole("status")).toHaveTextContent("Click the photo you want as the cover.");
    await act(async () => {
      fireEvent.click(document.querySelector('[data-photo-id="2"]')!);
    });
    expect(JSON.parse(String(posted("/api/albums/7/cover")[0].init?.body))).toEqual({ photo_id: 2 });
    expect(onPhotoClick).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-photo-id="2"]')!);
    expect(onPhotoClick).toHaveBeenCalledWith(1, expect.any(Array)); // newest first: 3, 2, 1

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move album to Vault" }));
    expect(onLock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog", { name: "Move Goa Nov 2026 to the Private Vault?" })).getByRole("button", { name: "Move to Vault" }));
    });
    expect(onLock).toHaveBeenCalledWith(7, false);
  });

  it("acts on selected photos: remove from the album or move to Trash", async () => {
    mockEngine({ ...routes, "POST /api/albums/7/photos/batch-remove": { status: "ok" }, "POST /api/photos/batch-trash": { status: "ok" } });
    open();
    await screen.findByText("3 photos · 8–12 Nov 2026");
    act(() => useAppStore.setState({ selectedPhotoIds: new Set([1, 2]) }));
    const bar = screen.getByRole("toolbar", { name: "Selected photos" });
    expect(bar).toHaveTextContent("2 selected");
    await act(async () => {
      fireEvent.click(within(bar).getByRole("button", { name: "Remove from album" }));
    });
    expect(JSON.parse(String(posted("/batch-remove")[0].init?.body))).toEqual({ photo_ids: [2, 1] });
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Removed 2 photos from Goa 2026. They're still in your library.", "success");
    expect(screen.getByText("1 photo · 12 Nov 2026")).toBeInTheDocument();

    act(() => useAppStore.setState({ selectedPhotoIds: new Set([3]) }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Move to Trash" }));
    });
    expect(JSON.parse(String(posted("/batch-trash")[0].init?.body))).toEqual({ photo_ids: [3] });
    expect(useAppStore.getState().selectedPhotoIds.size).toBe(0);
  });

  it("Favourites: no album menu, and selected photos can leave Favourites", async () => {
    mockEngine({ "GET /api/photos?favorite_only=true": [photo(5, "2026-01-01", { is_favorite: true })], "POST /api/photos/5/toggle-favorite": {} });
    render(<AlbumPage target={{ kind: "favourites" }} savedStories={[]} onBack={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByText("1 photo · 1 Jan 2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
    act(() => useAppStore.setState({ selectedPhotoIds: new Set([5]) }));
    expect(within(screen.getByRole("toolbar")).queryByRole("button", { name: "Remove from album" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Remove from Favourites" }));
    });
    expect(posted("/api/photos/5/toggle-favorite")).toHaveLength(1);
    expect(await screen.findByText("No favourites yet")).toBeInTheDocument();
  });

  it("clears a selection left over from another screen", async () => {
    useAppStore.setState({ selectedPhotoIds: new Set([99]) });
    mockEngine(routes);
    open();
    await screen.findByText("3 photos · 8–12 Nov 2026");
    expect(useAppStore.getState().selectedPhotoIds.size).toBe(0);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });
});
