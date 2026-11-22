/** A8: What to keep — its own page (like Duplicates), reached from the Photos header pill. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { WhatToKeepView } from "./WhatToKeepView";

const ITEMS = [
  { photo_id: 70, original_id: 7, ai_kind: "colour,faces", original_size: 3_000_000, improved_size: 1_200_000 },
  { photo_id: 80, original_id: 8, ai_kind: "fade", original_size: 2_000_000, improved_size: 900_000 },
];

function mockEngine() {
  const posts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        return new Response(JSON.stringify({ applied: body.photo_ids.length }), { status: 200 });
      }
      const left = ITEMS.filter((i) => !posts.some((p) => (p as { photo_ids: number[] }).photo_ids.includes(i.photo_id)));
      const originals = left.reduce((n, i) => n + i.original_size, 0);
      return new Response(JSON.stringify({ items: left, total: left.length, originals_bytes: originals, improved_bytes: 0 }), { status: 200 });
    }),
  );
  return posts;
}

beforeEach(() => useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", showToast: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

describe("What to keep", () => {
  it("says how much space keeping the improved photos frees, and each pair's sizes (owner, 2026-11-21)", async () => {
    mockEngine();
    render(<WhatToKeepView onBack={vi.fn()} onOpenPhoto={vi.fn()} />);
    expect(await screen.findByText("Frees about 4.8 MB")).toBeInTheDocument();
    expect(screen.getByText("after emptying Trash", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Original 2.9 MB · Improved 1.1 MB")).toBeInTheDocument();
  });

  it("shows each pair side by side with three plain choices", async () => {
    const posts = mockEngine();
    const onChanged = vi.fn();
    const onOpenPhoto = vi.fn();
    render(<WhatToKeepView onBack={vi.fn()} backLabel="Photos" onOpenPhoto={onOpenPhoto} onChanged={onChanged} />);
    const card = await screen.findByRole("listitem", { name: "Colour added · faces sharpened" });
    expect(screen.getByText("2 improved photos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Photos" })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Open the original" }));
    expect(onOpenPhoto).toHaveBeenCalledWith(7);
    fireEvent.click(within(card).getByRole("button", { name: "Keep improved" }));
    await waitFor(() => expect(posts).toEqual([{ photo_ids: [70], choice: "keep_improved" }]));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Colour added · faces sharpened" })).not.toBeInTheDocument());
    expect(onChanged).toHaveBeenCalled();
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Kept the improved photo. The original is in Trash for 30 days.", "success");
    const other = screen.getByRole("listitem", { name: "Colours fixed" });
    fireEvent.click(within(other).getByRole("button", { name: "Original" }));
    await waitFor(() => expect(posts[1]).toEqual({ photo_ids: [80], choice: "keep_original" }));
    expect(await screen.findByRole("heading", { name: "Nothing to choose" })).toBeInTheDocument();
  });

  it("keeps the improved photos for all only after asking; Keep both for all needs no question", async () => {
    const posts = mockEngine();
    render(<WhatToKeepView onBack={vi.fn()} onOpenPhoto={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep improved for all…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Keep the improved 2 photos?" });
    expect(dialog).toHaveTextContent("originals go to Trash");
    expect(posts).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep improved" }));
    await waitFor(() => expect(posts).toEqual([{ photo_ids: [70, 80], choice: "keep_improved" }]));
  });

  it("Keep both for all", async () => {
    const posts = mockEngine();
    render(<WhatToKeepView onBack={vi.fn()} onOpenPhoto={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep both for all" }));
    await waitFor(() => expect(posts).toEqual([{ photo_ids: [70, 80], choice: "keep_both" }]));
  });
});
