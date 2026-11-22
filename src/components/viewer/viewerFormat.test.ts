import { describe, expect, it } from "vitest";
import {
  cameraName,
  coordinatesLine,
  dimensionsLine,
  exposureLine,
  filmstripRange,
  formatBytes,
  formatTakenLine,
  parseTakenAt,
  printLine,
  qualityChip,
  storageLine,
  viewerTitle,
} from "./viewerFormat";

describe("dates", () => {
  it("reads engine and ISO dates as the local time they were taken", () => {
    const d = parseTakenAt("2026-11-08 18:12:00")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 8, 18, 12]);
    expect(parseTakenAt("2026-11-08T06:05:00Z")!.getHours()).toBe(6);
    expect(parseTakenAt("2026-02-30 10:00:00")).toBeNull();
    expect(parseTakenAt("soon")).toBeNull();
    expect(parseTakenAt(null)).toBeNull();
  });

  it("writes a short, friendly date line", () => {
    expect(formatTakenLine("2026-11-08 18:12:00")).toBe("Sun 8 Nov 2026 · 6:12 pm");
    expect(formatTakenLine("2026-11-08 00:05:00")).toBe("Sun 8 Nov 2026 · 12:05 am");
    expect(formatTakenLine("2026-11-08")).toBe("Sun 8 Nov 2026");
    expect(formatTakenLine(undefined)).toBe("Date unknown");
  });
});

describe("title and camera", () => {
  it("prefers a short caption and falls back to the file name", () => {
    expect(viewerTitle({ caption: "baga beach, sunset", filename: "IMG_1.jpg" })).toBe("Baga beach, sunset");
    expect(viewerTitle({ caption: "x".repeat(81), filename: "IMG_1.jpg" })).toBe("Photo");
    expect(viewerTitle({ caption: "  ", filename: "holiday.photo.HEIC" })).toBe("holiday.photo");
    expect(viewerTitle({ filename: "1792341321410-1c9bc690-7433-41b8-b05b-6742f8547d2f_fade,scratches,faces.avif", derived_from_id: 3 })).toBe("Improved photo");
  });

  it("names the camera once and lists only recorded settings", () => {
    expect(cameraName({ camera_make: "Google", camera_model: "Pixel 9 Pro" })).toBe("Google Pixel 9 Pro");
    expect(cameraName({ camera_make: "Canon", camera_model: "Canon EOS R6" })).toBe("Canon EOS R6");
    expect(cameraName({ camera_make: "", camera_model: "" })).toBeNull();
    expect(exposureLine({ aperture: 1.7, shutter_speed: "1/500", iso: 50, focal_length: 6.0 })).toBe("f/1.7 · 1/500 s · ISO 50 · 6 mm");
    expect(exposureLine({ aperture: 2, shutter_speed: undefined, iso: undefined, focal_length: undefined })).toBe("f/2");
    expect(exposureLine({})).toBeNull();
  });
});

describe("quality and size", () => {
  const photo = { mime_type: "image/jpeg", width: 7680, height: 5760, is_enhanced: true, is_optimized: true };

  it("shows 8K for enhanced photos and 4K / HD for videos", () => {
    expect(qualityChip(photo)?.label).toBe("8K");
    expect(qualityChip({ ...photo, is_enhanced: false, is_optimized: false })).toBeNull();
    expect(qualityChip({ ...photo, mime_type: "video/mp4", width: 3840, height: 2160 })?.label).toBe("4K");
    expect(qualityChip({ ...photo, mime_type: "video/mp4", width: 1280, height: 720 })?.label).toBe("HD");
    expect(qualityChip({ ...photo, mime_type: "video/mp4", width: 640, height: 360 })?.label).toBe("SD");
    // T22: the same rule as the grid's tag, so a portrait 480×854 phone video is SD in both.
    expect(qualityChip({ ...photo, mime_type: "video/mp4", width: 480, height: 854 })?.label).toBe("SD");
    expect(qualityChip({ ...photo, mime_type: "video/mp4", width: 1080, height: 1920 })?.label).toBe("HD");
    // An enhanced photo shows its real size (Auto keeps smaller photos at 4K).
    expect(qualityChip({ ...photo, width: 3840, height: 2560 })?.label).toBe("4K");
    expect(dimensionsLine(photo)).toBe("7680 × 5760 · 8K");
    expect(dimensionsLine({ ...photo, width: undefined })).toBeNull();
  });

  it("explains the stored size in plain words", () => {
    expect(formatBytes(6.2 * 1024 * 1024)).toBe("6.2 MB");
    expect(formatBytes(300)).toBe("1 KB");
    expect(formatBytes(0)).toBe("0 KB");
    expect(storageLine({ file_size: 6.2 * 1024 * 1024, original_file_size: 9.8 * 1024 * 1024, is_enhanced: true, is_optimized: true })).toBe("Enhanced · 6.2 MB (was 9.8 MB)");
    expect(storageLine({ file_size: 1024 * 1024, original_file_size: 1024 * 1024, is_enhanced: false, is_optimized: false })).toBe("Original · 1.0 MB");
    expect(printLine({ width: 7680, height: 5760 })).toBe("Print copy at 8K: sharp up to 65 × 49 cm");
    // A photo kept at 4K is printed from an 8K copy, so the size is the same (T28).
    expect(printLine({ width: 3840, height: 2880 })).toBe("Print copy at 8K: sharp up to 65 × 49 cm");
    expect(coordinatesLine(15.5553, -73.75)).toBe("15.5553° N, 73.7500° W");
  });
});

describe("filmstrip", () => {
  it("centres up to nine neighbours on the current photo", () => {
    expect(filmstripRange(50, 300)).toEqual([46, 54]);
    expect(filmstripRange(0, 300)).toEqual([0, 8]);
    expect(filmstripRange(299, 300)).toEqual([291, 299]);
    expect(filmstripRange(1, 3)).toEqual([0, 2]);
    expect(filmstripRange(0, 0)).toEqual([0, -1]);
  });
});

describe("improve video options (T29)", () => {
  it("offers only sizes above the video's own, by its shorter side", async () => {
    const { videoImproveOptions } = await import("./viewerFormat");
    expect(videoImproveOptions(480, 854).map((o) => o.name)).toEqual(["Full HD", "2K", "4K"]);
    expect(videoImproveOptions(1920, 1080).map((o) => o.name)).toEqual(["2K", "4K"]);
    expect(videoImproveOptions(2160, 3840)).toEqual([]);
    expect(videoImproveOptions(undefined, undefined)).toEqual([]);
  });
});

describe("Try again words (T14)", () => {
  it("labels the compare and the menu line", async () => {
    const { tryAgainLabels } = await import("./viewerFormat");
    const { tryAgainHint, tryAgainKind } = await import("./useOldPhoto");
    expect(tryAgainLabels("natural", "vivid")).toEqual({ before: "Current · Natural", after: "New · Vivid" });
    expect(tryAgainLabels(null, null)).toEqual({ before: "Current", after: "New" });
    expect(tryAgainHint(["fade", "faces"])).toBe(
      "Make it again (fix faded colours, sharpen faces) from the original, with other settings. You choose which one to keep.",
    );
    expect(tryAgainKind(["scratches", "faces"])).toBe("faces");
    expect(tryAgainKind(["fade", "colour"])).toBe("colour");
  });
});
