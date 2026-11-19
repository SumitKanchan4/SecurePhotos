import { describe, expect, it } from "vitest";
import {
  allSelected,
  aspectRatio,
  buildLayout,
  fromPhotoItem,
  sortNewestFirst,
  groupByMonth,
  monthKey,
  monthLabel,
  parseTimeline,
  qualityTag,
  videoLength,
  scrubberEntries,
  sectionAt,
  viewerWindow,
  visibleRange,
} from "./photoTimeline";

const photo = (taken_at: string | null, width = 400, height = 300) => ({ taken_at, width, height });

describe("parseTimeline", () => {
  it("turns compact rows into photos with readable flags", () => {
    const parsed = parseTimeline({
      total: 3,
      items: [
        [7, "2026-05-14 10:00:00", 4000, 3000, "p", 1 | 4],
        [8, null, 0, 0, "v", 2, 95],
        [9, "2026-05-14 10:00:00", 4000, 3000, "p", 8 | 16 | 32 | 256],
      ],
    });
    expect(parsed[0]).toEqual({
      id: 7, taken_at: "2026-05-14 10:00:00", width: 4000, height: 3000,
      is_video: false, is_favorite: true, is_optimized: false, is_enhanced: true, is_ai: false, is_preparing: false,
      ai_kinds: [], duration: 0,
    });
    expect(parsed[2].is_preparing).toBe(true); // P4: still being prepared (quiet dot).
    expect(parsed[1]).toMatchObject({ id: 8, is_video: true, is_favorite: false, is_optimized: true, is_enhanced: false });
    expect(parsed[2]).toMatchObject({ id: 9, is_ai: true, is_favorite: false });  // H10: improved copy.
    // Owner feedback 2026-11-18: what the copy had done, and a video's length.
    expect(parsed[2].ai_kinds).toEqual(["colour", "scratches"]);
    expect(parsed[1].duration).toBe(95);
  });

  it("names the tile's quality tag and a video's length", () => {
    // The size the enhanced photo really has (Settings → Photo size, 2026-11-19).
    const base = { is_video: false, is_optimized: true, is_enhanced: true, width: 7680, height: 5760 };
    expect(qualityTag(base)).toBe("8K");
    expect(qualityTag({ ...base, width: 3840, height: 2880 })).toBe("4K");
    expect(qualityTag({ ...base, width: 1920, height: 2560 })).toBe("2K");
    expect(qualityTag({ ...base, width: 1600, height: 1200 })).toBeNull();
    expect(qualityTag({ ...base, is_optimized: false })).toBeNull(); // Not enhanced yet.
    expect(qualityTag({ ...base, is_video: true, width: 3840, height: 2160 })).toBe("4K");
    expect(qualityTag({ ...base, is_video: true, width: 1440, height: 2560 })).toBe("2K");
    expect(qualityTag({ ...base, is_video: true, width: 1080, height: 1920 })).toBe("HD");
    expect(qualityTag({ ...base, is_video: true, width: 720, height: 1280 })).toBe("HD"); // The test library's video.
    expect(qualityTag({ ...base, is_video: true, width: 640, height: 480 })).toBe("SD");
    expect(qualityTag({ ...base, is_video: true, width: 0, height: 0 })).toBeNull(); // Size unknown.
    expect([videoLength(42), videoLength(725), videoLength(3725), videoLength(0)]).toEqual(["0:42", "12:05", "1:02:05", null]);
  });
});

describe("months", () => {
  it("reads the month from engine and ISO dates, and treats the rest as undated", () => {
    expect(monthKey("2026-05-14 10:00:00")).toBe("2026-05");
    expect(monthKey("2024-12-01T08:00:00Z")).toBe("2024-12");
    expect(monthKey(null)).toBe("undated");
    expect(monthKey("2024-13-01")).toBe("undated");
    expect(monthKey("garbage")).toBe("undated");
    expect(monthLabel("2026-05")).toBe("May 2026");
    expect(monthLabel("undated")).toBe("No date");
  });

  it("groups consecutive photos by month in list order", () => {
    const sections = groupByMonth([
      photo("2026-05-14"), photo("2026-05-01"), photo("2026-03-09"), photo("2024-12-31"), photo(null), photo(null),
    ]);
    expect(sections.map((s) => [s.key, s.start, s.count])).toEqual([
      ["2026-05", 0, 2], ["2026-03", 2, 1], ["2024-12", 3, 1], ["undated", 4, 2],
    ]);
  });
});

describe("buildLayout", () => {
  it("fills full rows to the exact width and keeps photo shapes", () => {
    const photos = Array.from({ length: 7 }, () => photo("2026-05-01", 400, 300)); // 4:3
    const layout = buildLayout(photos, groupByMonth(photos), { width: 1000, targetRowHeight: 200, gap: 4, headerHeight: 40 });
    const rows = layout.entries.filter((e) => e.kind === "row");
    const first = rows[0];
    if (first.kind !== "row") throw new Error("expected a row");
    // 4:3 at 200 px is 266.7 px wide, so four photos make the first full row.
    expect(first.tiles).toHaveLength(4);
    const last = first.tiles[first.tiles.length - 1];
    expect(last.left + last.width).toBeCloseTo(1000, 5);
    expect(first.height).toBeLessThanOrEqual(200);
    expect(first.tiles[0].width / first.height).toBeCloseTo(4 / 3, 5);
    // The leftover three photos stay at the target height instead of stretching.
    const tail = rows[1];
    if (tail.kind !== "row") throw new Error("expected a row");
    expect(tail.tiles).toHaveLength(3);
    expect(tail.height).toBe(200);
  });

  it("starts every month with a header and never mixes months in one row", () => {
    const photos = [photo("2026-05-01"), photo("2026-04-01"), photo("2026-04-02")];
    const sections = groupByMonth(photos);
    const layout = buildLayout(photos, sections, { width: 2000, targetRowHeight: 200, gap: 4, headerHeight: 40, sectionGap: 16 });
    expect(layout.entries.map((e) => e.kind)).toEqual(["header", "row", "header", "row"]);
    expect(layout.sectionTops.get("2026-05")).toBe(0);
    // header 40 + row 200 + section gap 16
    expect(layout.sectionTops.get("2026-04")).toBe(256);
    expect(layout.totalHeight).toBe(256 + 40 + 200);
  });

  it("treats missing sizes as square and limits extreme shapes", () => {
    expect(aspectRatio({ width: 0, height: 0 })).toBe(1);
    expect(aspectRatio({ width: 9000, height: 1000 })).toBe(3);
    expect(aspectRatio({ width: 100, height: 1000 })).toBe(0.5);
  });

  it("returns nothing before the container has a width", () => {
    const photos = [photo("2026-05-01")];
    expect(buildLayout(photos, groupByMonth(photos), { width: 0, targetRowHeight: 200 }).entries).toEqual([]);
  });
});

describe("windowing and scrubber", () => {
  const photos = Array.from({ length: 400 }, (_, i) => photo(`2026-${String(12 - Math.floor(i / 40)).padStart(2, "0")}-01`));
  const sections = groupByMonth(photos);
  const layout = buildLayout(photos, sections, { width: 800, targetRowHeight: 200, gap: 4 });

  it("renders only the entries near the viewport", () => {
    const [start, end] = visibleRange(layout.entries, 5000, 800, 0);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeLessThan(layout.entries.length - 1);
    for (let i = start; i <= end; i++) {
      const e = layout.entries[i];
      expect(e.top + e.height).toBeGreaterThanOrEqual(5000);
      expect(e.top).toBeLessThanOrEqual(5800);
    }
    expect(visibleRange([], 0, 800)).toEqual([0, -1]);
  });

  it("knows which month is on screen", () => {
    const top = layout.sectionTops.get("2026-10") ?? 0;
    expect(sectionAt(sections, layout.sectionTops, top + 10)?.key).toBe("2026-10");
    expect(sectionAt(sections, layout.sectionTops, 0)?.key).toBe("2026-12");
  });

  it("lists every year with the open year's months under it, then No date (round 1, #13)", () => {
    const mixed = [photo("2026-11-01"), photo("2026-10-01"), photo("2026-08-01"), photo("2025-12-01"), photo("2025-03-01"), photo("2023-01-01"), photo(null)];
    const sections = groupByMonth(mixed);
    const entries = scrubberEntries(sections);
    expect(entries.map((e) => e.label)).toEqual(["2026", "Nov", "Oct", "Aug", "2025", "2023", "No date"]);
    expect(entries[1]).toMatchObject({ name: "November 2026", kind: "month" });
    expect(entries[4]).toMatchObject({ key: "2025-12", keys: ["2025-12", "2025-03"], kind: "year" });
    // Looking at 2025: its months open under it instead.
    expect(scrubberEntries(sections, Infinity, "2025").map((e) => e.label)).toEqual(["2026", "2025", "Dec", "Mar", "2023", "No date"]);
    // Not enough room: years only.
    expect(scrubberEntries(sections, 5).map((e) => e.label)).toEqual(["2026", "2025", "2023", "No date"]);
    expect(scrubberEntries([])).toEqual([]);
  });
});

describe("vault helpers", () => {
  it("orders newest first with undated items last", () => {
    const items = [
      { id: 1, taken_at: "2024-03-01 10:00:00" },
      { id: 2, taken_at: "2026-05-01 10:00:00" },
      { id: 3, taken_at: null },
      { id: 4, taken_at: "2026-05-01 10:00:00" },
      { id: 5, taken_at: undefined },
    ];
    expect(sortNewestFirst(items).map((i) => i.id)).toEqual([4, 2, 1, 5, 3]);
    expect(items[0].id).toBe(1); // the input list is not changed
  });

  it("turns a full record into a timeline row", () => {
    expect(
      fromPhotoItem({
        id: 9, filename: "a.mp4", filepath: "x", file_size: 1, mime_type: "video/mp4",
        is_favorite: true, is_encrypted: true, is_optimized: false, is_enhanced: true,
      }),
    ).toEqual({ id: 9, taken_at: null, width: 0, height: 0, is_video: true, is_favorite: true, is_optimized: false, is_enhanced: true });
  });
});

describe("viewer window and selection", () => {
  const list = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 }));

  it("loads details around the opened photo and keeps its position", () => {
    expect(viewerWindow(list, 500, 300)).toMatchObject({ offset: 150 });
    expect(viewerWindow(list, 500, 300).ids[150]).toBe(501);
    expect(viewerWindow(list, 3, 300)).toMatchObject({ offset: 3 });
    const nearEnd = viewerWindow(list, 995, 300);
    expect(nearEnd.ids).toHaveLength(300);
    expect(nearEnd.ids[nearEnd.offset]).toBe(996);
    expect(viewerWindow(list.slice(0, 10), 4, 300)).toEqual({ ids: list.slice(0, 10).map((p) => p.id), offset: 4 });
  });

  it("checks whether a whole list is selected", () => {
    expect(allSelected([1, 2], new Set([1, 2, 3]))).toBe(true);
    expect(allSelected([1, 2], new Set([1]))).toBe(false);
    expect(allSelected([], new Set([1]))).toBe(false);
  });
});
