import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import type { DuplicateGroupItem, PhotoItem } from "../../types";
import { DashboardView } from "../DashboardView";
import { DuplicatesView } from "../DuplicatesView";
import { VideoOptimizerView } from "../VideoOptimizerView";
import { formatDuration, reclaimableBytes, resolveLabel, storageSegments } from "./dashFormat";

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
  app_storage: { total_bytes: 447 * GB, media_bytes: 386 * GB, app_system_bytes: 61 * GB, originals_bytes: 0, thumbnails_bytes: 0, previews_bytes: 0, database_bytes: 0, models_bytes: 0 },
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
  it("splits the drive into photos, app data and other files", () => {
    const segs = storageSegments(OVERVIEW as never);
    expect(segs.map((s) => [s.key, Math.round(s.percent)])).toEqual([["media", 39], ["app", 6], ["other", 14]]);
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

describe("DashboardView", () => {
  it("shows the library, storage and the two jobs worth doing", async () => {
    mockEngine({
      "GET /api/system/dashboard": OVERVIEW,
      "GET /api/duplicates/summary": { total_groups: 34, total_duplicate_photos: 80, reclaimable_bytes: 1.2 * GB },
      "GET /api/videos/summary": { runtime_available: true, total_videos: 342, total_video_bytes: 1, compressible_count: 12, enhanceable_count: 0, already_optimized_count: 0, projected_reclaimable_bytes: 3.4 * GB },
      "GET /api/system/optimization-status": { service_status: "processing", images_total: 1218, images_optimized: 1204, images_pending: 14, videos_total: 0, videos_optimized: 0, videos_pending: 0, overall_progress_percent: 98, active_item_progress: 0, reclaimed_bytes: 18 * GB },
    });
    const onNavigate = vi.fn();
    render(<DashboardView onNavigate={onNavigate} />);
    expect(await screen.findByText("Library on Photos (D:)")).toBeInTheDocument();
    expect(screen.getByText("412.0 GB free of 1000.0 GB")).toBeInTheDocument();
    expect(screen.getByText("34 groups of copies and bursts. About 1.2 GB can be freed.")).toBeInTheDocument();
    expect(screen.getByText("12 videos can be made smaller without visible change. About 3.4 GB to save.")).toBeInTheDocument();
    expect(screen.getByText("1,204 of 1,218 photos enhanced · 18.0 GB saved so far")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /12,480\s*Photos/ }));
    expect(onNavigate).toHaveBeenCalledWith("photos");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });
    expect(calls.some((c) => c.url.endsWith("/api/system/optimization/pause") && c.init?.method === "POST")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Review duplicates" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Duplicates" })).toBeInTheDocument();
  });
});

describe("DuplicatesView", () => {
  it("keeps the best pick by default, lets you keep more, and sends the right group", async () => {
    mockEngine({
      "GET /api/duplicates/groups": [GROUP],
      "POST /api/duplicates/resolve": { status: "resolved", trashed_count: 1, reclaimed_bytes: 8 * MB },
    });
    render(<DuplicatesView onBack={vi.fn()} />);
    expect(await screen.findByText("1 group · about 16 MB can be freed")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Keep IMG_1.jpg" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Keep · best pick")).toBeInTheDocument();
    expect(screen.getAllByText("Goes to Trash")).toHaveLength(2);

    fireEvent.click(screen.getByRole("checkbox", { name: "Keep IMG_1.jpg" }));
    expect(screen.getByRole("checkbox", { name: "Keep IMG_1.jpg" })).toHaveAttribute("aria-checked", "true"); // at least one is kept
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep IMG_2.jpg" }));
    expect(screen.getByText("1 group · about 8.0 MB can be freed")).toBeInTheDocument();

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
    const dialog = screen.getByRole("alertdialog", { name: "Make goa_beach.mp4 smaller?" });
    expect(dialog).toHaveTextContent("The original is deleted once the smaller copy has been checked");
    expect(calls.some((c) => c.url.endsWith("/compress"))).toBe(false);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Make smaller" }));
    });
    expect(calls.some((c) => c.url.endsWith("/api/videos/9/compress") && c.init?.method === "POST")).toBe(true);
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Made goa_beach.mp4 smaller. 1.2 GB freed.", "success");
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
});
