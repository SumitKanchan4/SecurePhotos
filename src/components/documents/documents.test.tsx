import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import type { DocumentItem } from "../../types";
import { DocumentsView } from "../DocumentsView";
import { categoryChips, categoryLabel, inCategory, shortDate, sortByDate } from "./docsFormat";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

const doc = (id: number, title: string, category: string, date: string, is_pinned = false): DocumentItem => ({
  id,
  title,
  filename: `${title}.jpg`,
  filepath: `docs/${id}.jpg`,
  category,
  date,
  file_size: "1 MB",
  file_size_bytes: 1,
  mime_type: "image/jpeg",
  extracted_text: "",
  is_encrypted: false,
  is_pinned,
});

const DOCS = [
  doc(1, "Croma receipt", "receipt", "2026-11-09"),
  doc(2, "Passport Rohan", "identity", "2024-03-12", true),
  doc(3, "Blood test", "medical", "2026-10-28"),
  doc(4, "Odd scan", "weird", "2026-01-02"),
];

describe("document helpers", () => {
  it("counts categories, puts unknown ones under Other, and orders by date", () => {
    expect(categoryChips(DOCS).map((c) => `${c.label} ${c.count}`)).toEqual([
      "All 4", "Receipts & bills 1", "IDs 1", "Tax 0", "Medical 1", "Legal 0", "Warranties 0", "Other 1",
    ]);
    expect(categoryChips(DOCS.slice(0, 3)).some((c) => c.id === "other")).toBe(false);
    expect(inCategory(DOCS[3], "other")).toBe(true);
    expect(inCategory(DOCS[0], "other")).toBe(false);
    expect(categoryLabel("identity")).toBe("IDs");
    expect(sortByDate(DOCS).map((d) => d.id)).toEqual([1, 3, 4, 2]);
    expect(shortDate("2026-11-09")).toBe("9 Nov 2026");
    expect(shortDate("")).toBe("No date");
  });
});

describe("DocumentsView", () => {
  let calls: { url: string; init?: RequestInit }[];

  beforeEach(() => {
    calls = [];
    useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", searchQuery: "", showToast: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("/api/documents?")) return new Response(JSON.stringify(DOCS));
        if (url.endsWith("/pin")) return new Response(JSON.stringify({ is_pinned: true }));
        if (url.endsWith("/api/documents/scan")) return new Response(JSON.stringify({ total_scanned: 40, newly_detected: 3 }));
        return new Response(JSON.stringify({ status: "ok" }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows pinned papers first and filters by category chip", async () => {
    render(<DocumentsView />);
    expect(await screen.findByText("4 documents")).toBeInTheDocument();
    const pinned = screen.getByRole("heading", { name: "Pinned" }).parentElement!;
    expect(within(pinned).getByText("Passport Rohan")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "All documents" })).toBeInTheDocument();
    expect(screen.getByText("Receipts & bills · 9 Nov 2026")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Medical/ }));
    expect(screen.getByRole("radio", { name: /Medical/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Blood test")).toBeInTheDocument();
    expect(screen.queryByText("Croma receipt")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Medical" })).toBeInTheDocument();
  });

  it("pins with exactly one request", async () => {
    render(<DocumentsView />);
    await screen.findByText("Croma receipt");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin Croma receipt" }));
    });
    expect(calls.filter((c) => c.url.endsWith("/api/documents/1/pin"))).toHaveLength(1);
    const pinned = screen.getByRole("heading", { name: "Pinned" }).parentElement!;
    expect(within(pinned).getByText("Croma receipt")).toBeInTheDocument();
  });

  it("changes a category and moves a document to Trash from its menu", async () => {
    render(<DocumentsView />);
    await screen.findByText("Croma receipt");
    fireEvent.click(screen.getByRole("button", { name: "More for Croma receipt" }));
    const menu = screen.getByRole("menu", { name: "Actions for Croma receipt" });
    expect(within(menu).getByRole("menuitemradio", { name: "Receipts & bills" })).toHaveAttribute("aria-checked", "true");
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Tax" }));
    });
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ category: "tax" });
    expect(screen.getByText(/^Tax · 9 Nov 2026$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More for Croma receipt" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    });
    expect(calls.some((c) => c.url.endsWith("/api/photos/1") && c.init?.method === "DELETE")).toBe(true);
    expect(screen.queryByText("Croma receipt")).not.toBeInTheDocument();
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Moved to Trash. You can restore it for 30 days.", "info");
  });

  it("finds documents already in the photos", async () => {
    render(<DocumentsView />);
    await screen.findByText("Croma receipt");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Find in photos/ }));
    });
    await waitFor(() => expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Found 3 documents in your photos.", "success"));
  });

  it("opens the viewer in the order shown", async () => {
    const onDocumentClick = vi.fn();
    render(<DocumentsView onDocumentClick={onDocumentClick} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Croma receipt" }));
    const [index, list] = onDocumentClick.mock.calls[0] as [number, DocumentItem[]];
    expect(list.map((d) => d.id)).toEqual([2, 1, 3, 4]);
    expect(index).toBe(1);
  });
});
