import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import type { DuplicateGroupItem, PhotoItem } from "../../types";
import { DashboardView } from "../DashboardView";
import { DuplicatesView } from "../DuplicatesView";
import { VideoOptimizerView } from "../VideoOptimizerView";
import { formatDuration, oldOriginalsNote, reclaimableBytes, resolveLabel, storageRows } from "./dashFormat";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const photo = (id: number, size: number): PhotoItem => ({
  id,
  filename: `IMG_${id}.jpg`,
  filepath: `p/${id}.jpg`,
  file_size: size,
  mime_type: "image/jpeg",
  width: 4032,
  height: 3024,
  is_favorite: false,
  is_encrypted: false,
  is_optimized: true,
  is_enhanced: true,
});

const GROUP: DuplicateGroupItem = {
  group_id: "g1",
  match_type: "exact",
  distance: 0,
  suggested_best_photo_id: 1,
  best_reason: "largest",
  reclaimable_bytes: 16 * MB,
  photos: [photo(1, 8 * MB), photo(2, 8 * MB), photo(3, 8 * MB)],
};

const OVERVIEW = {
  media_counts: { images: 12480, videos: 342, documents: 214, favorites: 3, albums: 12, people: 24, total_media: 13036 },
  app_storage: { total_bytes: 447 * GB, media_bytes: 386 * GB, app_system_bytes: 61 * GB, originals_bytes: 0, thumbnails_bytes: 0, previews_bytes: 0, database_bytes: 0, models_bytes: 0, categories: [{ key: "photos", bytes: 380 * GB }, { key: "vault", bytes: 6 * GB }, { key: "app", bytes: 61 * GB }] },
  drive_storage: { drive_letter: "D:\\", volume_name: "Photos", drive_type: "external", is_internal: false, total_bytes: 1000 * GB, free_bytes: 412 * GB, app_consumed_bytes: 0, system_other_bytes: 0, other_files_bytes: 0, disclaimer: "" },
};

type Call = { url: string; init?: RequestInit };
let calls: Call[];

function mockEngine(routes: Record<string, unknown>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = `${init?.method ?? "GET"} ${url.replace("http://127.0.0.1:50123", "").split("?")[0]}`;
      return new Response(JSON.stringify(routes[key] ?? {}));
    }),
  );
}

beforeEach(() => {
  useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", showToast: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dashboard helpers", () => {
  it("lists what SecurePhotos uses, biggest first, without empty kinds", () => {
    const rows = storageRows({
      categories: [
        { key: "photos", bytes: 300 * GB },
        { key: "vault", bytes: 20 * GB },
        { key: "videos", bytes: 80 * GB },
        { key: "music", bytes: 0 },
        { key: "trash", bytes: 5 * GB },
        { key: "app", bytes: 42 * GB },
      ],
    } as never);
    expect(rows.map((r) => r.label)).toEqual(["Photos", "Videos", "App data", "Private Vault", "Trash"]);
    expect(rows.find((r) => r.key === "trash")?.note).toBe("deleted for good after 30 days");
    expect(Math.round(rows[0].percent)).toBe(67);
    expect(storageRows(undefined)).toEqual([]);
  });

  it("counts what duplicates would free and says what the button does", () => {
    expect(reclaimableBytes([GROUP], {})).toBe(16 * MB);
    expect(reclaimableBytes([GROUP], { g1: [1, 2] })).toBe(8 * MB);
    expect(resolveLabel(GROUP, [1])).toBe("Remove 2 copies");
    expect(resolveLabel(GROUP, [1, 2])).toBe("Remove 1 copy");
    expect(resolveLabel(GROUP, [1, 2, 3])).toBe("Keep all");
    expect(formatDuration(272)).toBe("4:32");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(0)).toBe("");
  });
});

describe("old video originals note", () => {
  it("says what the one-off cleanup did, once", () => {
    expect(oldOriginalsNote(null)).toBeNull();
    expect(oldOriginalsNote({ status: "not_run" })).toBeNull();
    expect(oldOriginalsNote({ removed: 0, moved_to_trash: 0, freed_bytes: 0, acknowledged: false })).toBeNull();
    expect(oldOriginalsNote({ removed: 3, moved_to_trash: 0, freed_bytes: 4.2 * GB, acknowledged: true })).toBeNull();
    expect(oldOriginalsNote({ removed: 3, moved_to_trash: 1, freed_bytes: 4.2 * GB, acknowledged: false })).toBe(
      "Removed 3 full-size video copies an earlier version had kept hidden after making videos smaller. 4.2 GB freed. " +
        "The originals of 1 enhanced video are now in Trash, where you can restore them for 30 days.",
    );
  });
});

describe("DashboardView", () => {
  const HIGHLIGHTS = {
    on_this_day: { year: 2023, years_ago: 3, count: 14, photo_ids: [5, 6, 7], story_id: 42 },
    just_added: { photos: 48, videos: 2, preparing: 12, photo_ids: [8, 9, 10] },
    brought_back: { before_id: 11, after_id: 12, kinds: ["fade", "colour"], total: 3 },
    people: { top: [{ id: 1, name: "Asha", close: true, photo_count: 412, face_id: 99 }, { id: 2, name: "Ravi", close: false, photo_count: 388, face_id: null }], to_name: 5 },
    year: 2026,
    months: [40, 55, 72, 61, 90, 120, 160, 212, 98, 76, 50, 0],
    trash: { count: 39, bytes: 39 * MB },
  };

  it("shows the library, the tiles and the jobs worth doing (T32)", async () => {
    mockEngine({
      "GET /api/system/dashboard": OVERVIEW,
      "GET /api/duplicates/summary": { total_groups: 34, total_duplicate_photos: 80, reclaimable_bytes: 1.2 * GB },
      "GET /api/videos/summary": { runtime_available: true, total_videos: 342, total_video_bytes: 1, compressible_count: 12, enhanceable_count: 0, already_optimized_count: 0, projected_reclaimable_bytes: 3.4 * GB },
      "GET /api/duplicates/groups": [GROUP],
      "GET /api/system/space-summary": { enhanced: 1204, before_bytes: 30 * GB, after_bytes: 12 * GB, saved_bytes: 18 * GB, kept_8k: 1000, enlarged_small: 204, waiting: 14 },
      "GET /api/system/highlights": HIGHLIGHTS,
      "GET /api/restore/choices": { items: [], total: 21, originals_bytes: 340 * MB, improved_bytes: 1 },
    });
    const onNavigate = vi.fn();
    const onPlayStory = vi.fn();
    render(<DashboardView onNavigate={onNavigate} onPlayStory={onPlayStory} />);

    // The library as one sentence, every number a way in (round 2, #4).
    const hero = await screen.findByRole("region", { name: "Your library" });
    expect(hero).toHaveTextContent("12,480 photos, 342 videos, 24 people, 12 albums and 214 documents.");
    fireEvent.click(within(hero).getByRole("button", { name: "12,480 photos" }));
    expect(onNavigate).toHaveBeenCalledWith("photos");
    // One storage line; the detail is in Settings.
    expect(within(hero).getByText("SecurePhotos uses 447.0 GB · 412.0 GB free on Photos (D:)")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "What SecurePhotos uses" })).not.toBeInTheDocument();
    fireEvent.click(within(hero).getByRole("button", { name: "Storage" }));
    expect(useAppStore.getState().settingsSection).toBe("storage");

    // T27: what enhancing did is one press away.
    fireEvent.click(screen.getByRole("button", { name: "18.0 GB saved by enhancing" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your 1,204 enhanced photos take 12.0 GB instead of 30.0 GB, and they are sharper. 1,000 full-size photos at 8K · 204 smaller photos enlarged to 4K. 14 photos still to enhance.",
    );

    const tiles = screen.getByRole("region", { name: "At a glance" });
    expect(within(tiles).getByRole("heading", { name: "This week, 3 years ago" })).toBeInTheDocument();
    fireEvent.click(within(tiles).getByRole("button", { name: "Play as a story" }));
    expect(onPlayStory).toHaveBeenCalledWith(42);
    expect(within(tiles).getByText("48 photos and 2 videos")).toBeInTheDocument();
    expect(within(tiles).getByText("12 still being prepared")).toBeInTheDocument();
    expect(within(tiles).getByText("Faded colours brought back · Colour added")).toBeInTheDocument();
    expect(within(tiles).getByRole("slider", { name: "Compare before and after" })).toBeInTheDocument();
    expect(within(tiles).getByText("5 new faces waiting for a name")).toBeInTheDocument();
    fireEvent.click(within(tiles).getByRole("button", { name: /Asha/ }));
    expect(useAppStore.getState().pendingOpen).toEqual({ kind: "person", id: 1 });
    fireEvent.click(within(tiles).getByRole("button", { name: "August: 212 photos" }));
    expect(useAppStore.getState().pendingMonth).toBe("2026-08");
    expect(within(tiles).getByRole("button", { name: "December: 0 photos" })).toBeDisabled();

    // Worth doing: the same four cards in the same order, each with what it frees.
    const worth = screen.getByRole("region", { name: "Worth doing" });
    expect(within(worth).getByText("About 5.0 GB to free")).toBeInTheDocument();
    const titles = Array.from(worth.querySelectorAll(".dash-job-title")).map((el) => el.textContent);
    expect(titles).toEqual(["Duplicates", "Big videos", "What to keep", "Empty Trash"]);
    fireEvent.click(within(worth).getByRole("button", { name: /Empty Trash/ }));
    expect(onNavigate).toHaveBeenCalledWith("trash");
    fireEvent.click(within(worth).getByRole("button", { name: /Duplicates/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Duplicates" })).toBeInTheDocument();
    expect(await screen.findByText("1 group")).toBeInTheDocument();
  });

  it("leaves out tiles with nothing to show and says when all is good", async () => {
    mockEngine({
      "GET /api/system/dashboard": OVERVIEW,
      "GET /api/duplicates/summary": { total_groups: 0, total_duplicate_photos: 0, reclaimable_bytes: 0 },
      "GET /api/videos/summary": { runtime_available: true, total_videos: 1, total_video_bytes: 1, compressible_count: 0, enhanceable_count: 0, already_optimized_count: 0, projected_reclaimable_bytes: 0 },
      "GET /api/system/highlights": { on_this_day: null, just_added: null, brought_back: null, people: { top: [], to_name: 0 }, year: 2026, months: Array(12).fill(0), trash: { count: 0, bytes: 0 } },
    });
    render(<DashboardView onNavigate={vi.fn()} />);
    expect(await screen.findByText("All good, nothing to free right now")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /On this day|Just added|Brought back|People|Your 2026/ })).not.toBeInTheDocument();
    // The four cards stay, saying all is good, and still open their page to look again.
    const worth = screen.getByRole("region", { name: "Worth doing" });
    expect(within(worth).getAllByText("All good")).toHaveLength(4);
    expect(within(worth).getByText("No copies found")).toBeInTheDocument();
    expect(within(worth).getByText("Trash is empty")).toBeInTheDocument();
    fireEvent.click(within(worth).getByRole("button", { name: /Duplicates/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Duplicates" })).toBeInTheDocument();
  });
});

describe("DuplicatesView with an unexpected reply", () => {
  it("shows nothing to review instead of crashing", async () => {
    mockEngine({ "GET /api/duplicates/groups": { detail: "busy" } });
    render(<DuplicatesView onBack={vi.fn()} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Duplicates" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep the best in all…" })).not.toBeInTheDocument();
  });
});

describe("DashboardView cleanup note", () => {
  it("shows the space freed by the one-off cleanup until OK is pressed", async () => {
    mockEngine({
      "GET /api/system/dashboard": OVERVIEW,
      "GET /api/videos/old-originals": { removed: 2, freed_bytes: 3 * GB, moved_to_trash: 0, kept: 1, acknowledged: false },
    });
    render(<DashboardView onNavigate={vi.fn()} />);
    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent("Removed 2 full-size video copies an earlier version had kept hidden after making videos smaller. 3.0 GB freed.");
    await act(async () => {
      fireEvent.click(within(note).getByRole("button", { name: "OK" }));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/api/videos/old-originals/acknowledge") && c.init?.method === "POST")).toBe(true);
  });
});

describe("DuplicatesView", () => {
  it("keeps the best pick by default, lets you keep more, and sends the right group", async () => {
    mockEngine({
      "GET /api/duplicates/groups": [GROUP],
      "POST /api/duplicates/resolve": { status: "resolved", trashed_count: 1, reclaimed_bytes: 8 * MB },
    });
    render(<DuplicatesView onBack={vi.fn()} />);
    expect(await screen.findByText("1 group")).toBeInTheDocument();
    // The space pill beside the title (owner, 2026-11-21).
    expect(screen.getByText("Frees about 16 MB")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Keep Photo 1" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Keep · best pick")).toBeInTheDocument();
    expect(screen.getAllByText("Goes to Trash")).toHaveLength(2);

    fireEvent.click(screen.getByRole("checkbox", { name: "Keep Photo 1" }));
    expect(screen.getByRole("checkbox", { name: "Keep Photo 1" })).toHaveAttribute("aria-checked", "true"); // at least one is kept
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep Photo 2" }));
    expect(screen.getByText("Frees about 8.0 MB")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove 1 copy" }));
    });
    const post = calls.find((c) => c.url.endsWith("/api/duplicates/resolve"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ group_id: "g1", keep_photo_ids: [1, 2] });
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith(
      "Moved 1 copy to Trash (8.0 MB). You can restore them for 30 days.",
      "success",
    );
  });

  it("asks before keeping the best in every group", async () => {
    mockEngine({ "GET /api/duplicates/groups": [GROUP], "POST /api/duplicates/resolve-all-best": { trashed_count: 2, reclaimed_bytes: 16 * MB } });
    render(<DuplicatesView onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep the best in all…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Keep the best in every group?" });
    expect(dialog).toHaveTextContent("2 copies (16 MB) will go to Trash");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.some((c) => c.url.includes("resolve-all-best"))).toBe(false);
  });
});

describe("VideoOptimizerView", () => {
  const video = {
    id: 9,
    filename: "goa_beach.mp4",
    filepath: "v/9.mp4",
    file_size: 1.8 * GB,
    duration: 272,
    mime_type: "video/mp4",
    optimization_plan: { status: "compressible", action: "compress", label: "", projected_savings_bytes: 1.2 * GB, projected_savings_pct: 66, reason: "" },
  };

  it("asks before making a video smaller, since the original is deleted", async () => {
    mockEngine({
      "GET /api/videos/summary": { runtime_available: true, compressible_count: 1, projected_reclaimable_bytes: 1.2 * GB },
      "GET /api/videos/candidates": [video],
      "POST /api/videos/9/compress": { success: true, saved_bytes: 1.2 * GB },
    });
    render(<VideoOptimizerView onBack={vi.fn()} />);
    expect(await screen.findByText("1.8 GB now · about 614 MB after")).toBeInTheDocument();
    expect(screen.getByText("4:32")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make smaller" }));
    const dialog = screen.getByRole("alertdialog", { name: "Make this video smaller?" });
    expect(dialog).toHaveTextContent("The original is deleted once the smaller copy has been checked");
    expect(calls.some((c) => c.url.endsWith("/compress"))).toBe(false);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Make smaller" }));
    });
    expect(calls.some((c) => c.url.endsWith("/api/videos/9/compress") && c.init?.method === "POST")).toBe(true);
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Made the video smaller. 1.2 GB freed.", "success");
  });

  it("reports the batch result from the engine's real fields", async () => {
    mockEngine({
      "GET /api/videos/summary": { runtime_available: true, compressible_count: 1, projected_reclaimable_bytes: 1.2 * GB },
      "GET /api/videos/candidates": [video],
      "POST /api/videos/compress-all": { candidate_count: 1, processed_count: 1, total_reclaimed_bytes: 1.2 * GB, errors: [] },
    });
    render(<VideoOptimizerView onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Make all smaller" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Make all smaller" }));
    });
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Made 1 video smaller. 1.2 GB freed.", "success");
  });

  it("says the enhanced clip's original is in Trash", async () => {
    const old = { ...video, id: 11, filename: "1998_birthday.avi", width: 640, height: 480, optimization_plan: { ...video.optimization_plan, action: "enhance" } };
    mockEngine({
      "GET /api/videos/summary": { runtime_available: true, compressible_count: 0, projected_reclaimable_bytes: 0 },
      "GET /api/videos/candidates": [old],
      "POST /api/videos/11/enhance": { success: true, height: 720 },
    });
    render(<VideoOptimizerView onBack={vi.fn()} />);
    expect(await screen.findByText(/The original goes to Trash, so you can restore it for 30 days/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enhance" }));
    });
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith(
      "Enhanced the video to HD. The original is in Trash for 30 days.",
      "success",
    );
  });
});

describe("space card (T27)", () => {
  it("says what enhancing did, honestly", async () => {
    const { spaceCard } = await import("./dashFormat");
    const base = { enhanced: 64, before_bytes: 27.6e6, after_bytes: 4.5e6, saved_bytes: 23.1e6, kept_8k: 8, enlarged_small: 56, waiting: 0 };
    const saved = spaceCard(base)!;
    expect(saved.headline).toMatch(/saved$/);
    expect(saved.detail).toMatch(/^Your 64 enhanced photos take .* instead of .*, and they are sharper\.$/);
    expect(saved.sorted).toBe("8 full-size photos at 8K · 56 smaller photos enlarged to 4K");
    expect(saved.waiting).toBeNull();
    // Grown, not saved: no "saved" claim.
    const grown = spaceCard({ ...base, before_bytes: 79e6, after_bytes: 135e6, saved_bytes: 0, waiting: 3 })!;
    expect(grown.headline).toBe("Sharper photos");
    expect(grown.detail).toMatch(/Enlarging small photos adds detail, and some size\.$/);
    expect(grown.waiting).toBe("3 photos still to enhance");
    expect(spaceCard({ ...base, enhanced: 0, waiting: 0 })).toBeNull();
  });
});

describe("dashboard tile words (T32)", () => {
  it("greets by time of day and says the date", async () => {
    const { greeting } = await import("./dashFormat");
    expect(greeting(new Date(2026, 10, 22, 9, 0))).toBe("Good morning · Sunday 22 November");
    expect(greeting(new Date(2026, 10, 22, 14, 0))).toBe("Good afternoon · Sunday 22 November");
    expect(greeting(new Date(2026, 10, 22, 21, 0))).toBe("Good evening · Sunday 22 November");
  });

  it("keeps storage to one line and warns under 10% free", async () => {
    const { storageLine } = await import("./dashFormat");
    const drive = { ...OVERVIEW.drive_storage, drive_letter: "C:\\", volume_name: "Windows", total_bytes: 100 * GB, free_bytes: 8 * GB };
    const low = storageLine(3 * GB, drive)!;
    expect(low.low).toBe(true);
    expect(low.text).toBe("Running low: 8.0 GB free on Windows (C:) · SecurePhotos uses 3.0 GB");
    expect(Math.round(low.usedPercent)).toBe(92);
    expect(storageLine(1, { ...drive, total_bytes: 0 })).toBeNull();
    expect(storageLine(1, { ...drive, volume_name: "" })!.text).toBe("Running low: 8.0 GB free on C: · SecurePhotos uses 1 KB");
  });

  it("words the tiles", async () => {
    const { onThisDayText, justAddedText, broughtBackText, monthBars, worthDoing, savedPill } = await import("./dashFormat");
    expect(onThisDayText({ year: 2025, years_ago: 1, count: 1, photo_ids: [1], story_id: null }, new Date(2026, 10, 22))).toEqual({
      title: "This week, 1 year ago",
      line: "1 photo from November 2025",
    });
    expect(justAddedText({ photos: 0, videos: 1, preparing: 0, photo_ids: [] })).toEqual({ title: "1 video", preparing: null });
    expect(broughtBackText(["scratches", "unknown"])).toBe("Scratches removed");
    expect(broughtBackText([])).toBe("Brought back");
    const { bars, total, busiest } = monthBars(2026, [0, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0], new Date(2026, 1, 3));
    expect(total).toBe(15);
    expect(busiest).toBe("Busiest: February, 10 photos");
    expect(bars[1]).toMatchObject({ key: "2026-02", height: 100, current: true, busiest: true });
    expect(bars[2].height).toBe(50);
    expect(bars[0].height).toBe(0);
    expect(monthBars(2026, Array(12).fill(0), new Date()).busiest).toBeNull();
    const cards = worthDoing({ duplicates: { count: 3, bytes: 0 }, videos: "off", keep: null, trash: { count: 2, bytes: 5 } });
    expect(cards.map((j) => [j.key, j.state])).toEqual([["duplicates", "good"], ["videos", "off"], ["keep", "good"], ["trash", "free"]]);
    expect(worthDoing({}).every((j) => j.state === "checking")).toBe(true);
    expect(savedPill({ enhanced: 4, before_bytes: 10, after_bytes: 20, saved_bytes: 0, kept_8k: 0, enlarged_small: 4, waiting: 0 })).toBe("Sharper photos");
    expect(savedPill(null)).toBeNull();
  });
});
