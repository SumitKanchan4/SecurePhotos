import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { ImportModal, selectionFromPaths } from "../ImportModal";
import {
  contentsLine,
  duplicatesLine,
  formatSize,
  importButtonLabel,
  ImportPreview,
  resultMessage,
  timeLeft,
} from "./importFormat";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));

const PREVIEW: ImportPreview = {
  name: "Goa trip",
  is_folder: true,
  photos: 48,
  videos: 3,
  documents: 0,
  total_bytes: 2.1 * 1024 ** 3,
  already_in_library: 4,
  to_import: 47,
  unsupported: 1,
};

describe("import wording", () => {
  it("describes what is selected and what will happen", () => {
    expect(formatSize(2.1 * 1024 ** 3)).toBe("2.1 GB");
    expect(formatSize(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatSize(300)).toBe("1 KB");
    expect(contentsLine(PREVIEW)).toBe("48 photos, 3 videos (2.1 GB)");
    expect(contentsLine({ ...PREVIEW, photos: 1, videos: 0, documents: 2 })).toBe("1 photo, 2 PDFs (2.1 GB)");
    expect(contentsLine({ ...PREVIEW, photos: 0, videos: 0 })).toBe("No photos or videos here");
    expect(duplicatesLine(PREVIEW)).toBe("4 are already in your library and will be skipped");
    expect(duplicatesLine({ ...PREVIEW, already_in_library: 1 })).toBe("1 is already in your library and will be skipped");
    expect(duplicatesLine({ ...PREVIEW, already_in_library: 0 })).toBeNull();
    expect(duplicatesLine({ ...PREVIEW, already_in_library: 51, to_import: 0 })).toBe("Everything here is already in your library");
    expect(importButtonLabel(PREVIEW)).toBe("Import 47 items");
    expect(importButtonLabel({ ...PREVIEW, to_import: 1 })).toBe("Import 1 item");
    expect(importButtonLabel({ ...PREVIEW, to_import: 0 })).toBe("Nothing new to import");
  });

  it("estimates the time left from the pace so far", () => {
    expect(timeLeft(1, 47, 1000, 1010)).toBeNull(); // too early to tell
    expect(timeLeft(29, 47, 1000, 1058)).toBe("less than a minute left"); // 36 s left
    expect(timeLeft(10, 47, 1000, 1030)).toBe("about 2 min left"); // 111 s left
    expect(timeLeft(10, 1000, 1000, 1100)).toBe("about 2 h 45 min left");
    expect(timeLeft(47, 47, 1000, 1100)).toBeNull();
    expect(timeLeft(10, 47, null, 1100)).toBeNull();
  });

  it("reports the result in plain words, including a stopped import", () => {
    expect(resultMessage({ total_found: 51, imported: 47, skipped: 4, failed: 0 })).toEqual({
      text: "Added 47 items to your library (4 already in your library).",
      tone: "success",
    });
    expect(resultMessage({ total_found: 47, imported: 29, skipped: 0, failed: 0, cancelled: true }).text).toBe(
      "Import stopped. Added 29 items; nothing else was changed.",
    );
    expect(resultMessage({ total_found: 3, imported: 0, skipped: 3, failed: 0 }).text).toBe("Everything was already in your library.");
    expect(resultMessage({ total_found: 2, imported: 0, skipped: 0, failed: 2 }).tone).toBe("warning");
  });

  it("treats one dropped item without an extension as a folder", () => {
    expect(selectionFromPaths(["D:/Pictures/Goa trip"])).toEqual({ folder: "D:/Pictures/Goa trip", files: [] });
    expect(selectionFromPaths(["D:/a.jpg", "D:/b.jpg"])).toEqual({ folder: null, files: ["D:/a.jpg", "D:/b.jpg"] });
  });
});

type Call = { url: string; init?: RequestInit };

describe("ImportModal", () => {
  let calls: Call[];
  let progress: Record<string, unknown>;
  let finishImport: (body: unknown) => void;

  beforeEach(() => {
    calls = [];
    progress = { is_active: false, total_count: 0, completed_count: 0, started_at: null };
    useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", showToast: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const path = url.replace("http://127.0.0.1:50123", "");
        if (path === "/api/photos/import-progress") return new Response(JSON.stringify(progress));
        if (path === "/api/photos/import-preview") return new Response(JSON.stringify(PREVIEW));
        if (path === "/api/photos/import/cancel") return new Response(JSON.stringify({ status: "stopping" }));
        if (path === "/api/photos/import") {
          return new Promise<Response>((resolve) => {
            finishImport = (body) => resolve(new Response(JSON.stringify(body), { status: 201 }));
          });
        }
        return new Response("{}");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function dropFolder() {
    const drop = screen.getByText("Drop photos, videos or folders here").parentElement!;
    fireEvent.drop(drop, { dataTransfer: { files: [{ path: "D:/Pictures/Goa trip" }] } });
  }

  it("shows the selected folder, what is new, and copies by default", async () => {
    render(<ImportModal isOpen onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Bring photos in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    dropFolder();
    expect(await screen.findByText("Goa trip · 48 photos, 3 videos (2.1 GB)")).toBeInTheDocument();
    expect(screen.getByText("Selected folder")).toBeInTheDocument();
    expect(screen.getByText("4 are already in your library and will be skipped")).toBeInTheDocument();
    const preview = calls.find((c) => c.url.endsWith("/import-preview"));
    expect(JSON.parse(String(preview?.init?.body))).toEqual({ source_directory: "D:/Pictures/Goa trip" });
    expect(screen.getByRole("switch", { name: "Move instead of copy" })).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import 47 items" }));
    });
    const start = calls.find((c) => c.url.endsWith("/api/photos/import"));
    expect(JSON.parse(String(start?.init?.body))).toEqual({ source_directory: "D:/Pictures/Goa trip", mode: "managed", delete_source: false });
  });

  it("moves only when asked, shows progress, can stop, and still reports the result after Hide", async () => {
    const onClose = vi.fn();
    const onImportComplete = vi.fn();
    render(<ImportModal isOpen onClose={onClose} onImportComplete={onImportComplete} />);
    dropFolder();
    await screen.findByText("Goa trip · 48 photos, 3 videos (2.1 GB)");
    fireEvent.click(screen.getByRole("switch", { name: "Move instead of copy" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import 47 items" }));
    });
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith("/api/photos/import"))?.init?.body)).delete_source).toBe(true);
    expect(screen.getByText("Moving 0 of 51")).toBeInTheDocument();
    expect(screen.getByText("You can close this window and keep using the app.")).toBeInTheDocument();

    // An early poll that doesn't see the import yet must not flip the dialog back.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(screen.getByRole("button", { name: "Stop import" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop import" }));
    });
    expect(calls.some((c) => c.url.endsWith("/api/photos/import/cancel") && c.init?.method === "POST")).toBe(true);
    expect(screen.getByText("Stopping after this file…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishImport({ total_found: 51, imported: 29, skipped: 0, failed: 0, cancelled: true });
    });
    await waitFor(() =>
      expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Import stopped. Added 29 items; nothing else was changed.", "info"),
    );
    expect(onImportComplete).toHaveBeenCalled();
  });

  it("reconnects to an import that is already running, and closes when it ends", async () => {
    progress = { is_active: true, total_count: 47, completed_count: 12, started_at: Date.now() / 1000 - 30 };
    const onClose = vi.fn();
    render(<ImportModal isOpen onClose={onClose} />);
    expect(await screen.findByText("Copying 12 of 47")).toBeInTheDocument();
    progress = { is_active: false, total_count: 47, completed_count: 47, started_at: null };
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 });
  });
});
