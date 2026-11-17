import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { TrashView } from "../TrashView";
import { daysLeftLabel, groupByTrashMonth, isEndingSoon, itemsLabel, TrashedItem, trashMonthLabel } from "./trashFormat";

const item = (id: number, trashed_at: string, days: number, extra: Partial<TrashedItem> = {}): TrashedItem => ({
  id,
  filename: `Trip day ${id}.jpg`,
  filepath: `originals/photo_${id}.jpg`,
  file_size: 1000,
  formatted_size: "1 KB",
  trashed_at,
  days_remaining: days,
  is_vault_item: false,
  mime_type: "image/jpeg",
  ...extra,
});

describe("trash wording", () => {
  const now = new Date(2026, 10, 13);
  it("says how long items stay and groups them by month", () => {
    expect(daysLeftLabel(12)).toBe("12 days left");
    expect(daysLeftLabel(1)).toBe("1 day left");
    expect(daysLeftLabel(0)).toBe("Deleted today");
    expect(isEndingSoon(3)).toBe(true);
    expect(isEndingSoon(4)).toBe(false);
    expect(itemsLabel(1)).toBe("1 item");
    expect(trashMonthLabel("2026-11-02 10:00:00", now)).toBe("Deleted this month");
    expect(trashMonthLabel("2026-10-20 10:00:00", now)).toBe("Deleted in October 2026");
    const groups = groupByTrashMonth([item(1, "2026-11-10", 27), item(2, "2026-11-01", 18), item(3, "2026-10-20", 7)], now);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([["Deleted this month", 2], ["Deleted in October 2026", 1]]);
  });
});

describe("TrashView", () => {
  let calls: { url: string; init?: RequestInit }[];
  const ITEMS = [
    item(1, "2026-11-10 10:00:00", 27),
    item(2, "2026-11-01 10:00:00", 2),
    item(3, "2026-10-20 10:00:00", 1, { is_vault_item: true, filename: "Private Vault item", filepath: "", mime_type: null }),
  ];

  beforeEach(() => {
    calls = [];
    useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", showToast: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/api/trash")) return new Response(JSON.stringify(ITEMS));
        return new Response(JSON.stringify({ status: "ok" }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows days left (amber near the end) and vault items without their name", async () => {
    render(<TrashView />);
    expect(await screen.findByText("3 items · deleted for good after 30 days")).toBeInTheDocument();
    expect(screen.getByText("27 days left")).not.toHaveClass("is-soon");
    expect(screen.getByText("2 days left")).toHaveClass("is-soon");
    const vault = screen.getByRole("button", { name: "Private Vault item, 1 day left" });
    expect(within(vault).queryByRole("img")).toBeNull();
    expect(vault.querySelector("img")).toBeNull();
  });

  it("restores the selected items with one click", async () => {
    render(<TrashView />);
    fireEvent.click(await screen.findByRole("button", { name: "Trip day 1, 27 days left" }));
    fireEvent.click(screen.getByRole("button", { name: "Trip day 2, 2 days left" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
    });
    const post = calls.find((c) => c.url.endsWith("/api/trash/restore"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ photo_ids: [1, 2] });
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Restored 2 items.", "success");
    expect(screen.queryByRole("button", { name: "Trip day 1, 27 days left" })).not.toBeInTheDocument();
  });

  it("asks before deleting forever, and Cancel deletes nothing", async () => {
    render(<TrashView />);
    fireEvent.click(await screen.findByRole("button", { name: "Trip day 2, 2 days left" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete forever…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete 1 item forever?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.some((c) => c.url.includes("/permanent"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete forever…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete 1 item forever" }));
    });
    const post = calls.find((c) => c.url.endsWith("/api/trash/permanent"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ photo_ids: [2] });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("empties the trash only after confirming", async () => {
    render(<TrashView />);
    fireEvent.click(await screen.findByRole("button", { name: "Empty trash…" }));
    expect(screen.getByRole("alertdialog", { name: "Empty the trash?" })).toHaveTextContent("All 3 items in the trash will be removed");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    });
    expect(calls.some((c) => c.url.endsWith("/api/trash/empty") && c.init?.method === "DELETE")).toBe(true);
    expect(await screen.findByRole("heading", { name: "Trash is empty" })).toBeInTheDocument();
  });
});
