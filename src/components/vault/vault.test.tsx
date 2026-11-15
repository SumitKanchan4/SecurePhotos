import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import type { PhotoItem } from "../../types";
import { VaultView } from "../VaultView";
import { VaultSettings } from "../settings/VaultSettings";
import { RESET_PHRASE, VaultFactoryReset } from "./VaultFactoryReset";

vi.mock("../../services/external", () => ({ openExternal: vi.fn() }));

const vaultPhoto = (id: number, taken_at: string | null): PhotoItem => ({
  id,
  filename: `secret_${id}.jpg`,
  filepath: `vault/${id}`,
  file_size: 1000,
  mime_type: "image/jpeg",
  width: 4000,
  height: 3000,
  taken_at: taken_at ?? undefined,
  is_favorite: false,
  is_encrypted: true,
  is_optimized: true,
  is_enhanced: true,
});

type Route = (url: string, init?: RequestInit) => unknown;

function mockEngine(routes: Record<string, Route | unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = url.replace("http://127.0.0.1:50123", "").split("?")[0];
    const route = routes[path];
    if (route === undefined) return new Response("{}", { status: 404 });
    const body = typeof route === "function" ? (route as Route)(url, init) : route;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  useAppStore.setState({
    apiBaseUrl: "http://127.0.0.1:50123",
    apiToken: "t",
    isVaultConfigured: true,
    isVaultUnlocked: false,
    hasVaultPin: true,
    isVaultPinLocked: false,
    vaultPasswordHint: null,
    selectedPhotoIds: new Set<number>(),
    checkVaultStatus: vi.fn(async () => {}),
    showToast: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Vault lock screen", () => {
  it("shows one calm card with the PIN, the password switch and the Emergency Card, and no factory reset", () => {
    mockEngine({});
    render(<VaultView />);
    expect(screen.getByRole("heading", { name: "Your vault is locked" })).toBeInTheDocument();
    expect(screen.getByText("Enter your 4-digit PIN")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/PIN digit/)).toHaveLength(4);
    expect(screen.getByRole("button", { name: /Forgot your password\? Use your Emergency Card/ })).toBeInTheDocument();
    expect(screen.queryByText(/Factory Reset/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Erase/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use master password instead" }));
    expect(screen.getByLabelText("Master password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use your PIN instead" })).toBeInTheDocument();
  });

  it("unlocks with the PIN, and a wrong PIN shows why and clears the boxes", async () => {
    let attempts = 0;
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/api/vault/unlock")) {
          attempts++;
          return attempts === 1
            ? new Response(JSON.stringify({ detail: "Incorrect PIN. 4 attempts left before your master password is needed." }), { status: 401 })
            : new Response(JSON.stringify({ status: "unlocked" }), { status: 200 });
        }
        return new Response("[]", { status: 200 });
      }),
    );
    render(<VaultView />);
    const type = async (digits: string) => {
      for (const [i, d] of [...digits].entries()) {
        await act(async () => {
          fireEvent.change(screen.getByLabelText(`PIN digit ${i + 1}`), { target: { value: d } });
        });
      }
    };
    await type("1111");
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect PIN. 4 attempts left");
    expect((screen.getByLabelText("PIN digit 1") as HTMLInputElement).value).toBe("");
    await type("2468");
    const unlocks = calls.filter((c) => c.url.endsWith("/api/vault/unlock")).map((c) => JSON.parse(String(c.init?.body)));
    expect(unlocks).toEqual([{ pin: "1111" }, { pin: "2468" }]);
    await waitFor(() => expect(useAppStore.getState().isVaultUnlocked).toBe(true));
  });

  it("unlocks with the master password", async () => {
    const calls = mockEngine({ "/api/vault/unlock": { status: "unlocked" } });
    useAppStore.setState({ hasVaultPin: false });
    render(<VaultView />);
    fireEvent.change(screen.getByLabelText("Master password"), { target: { value: "correct horse" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    });
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith("/api/vault/unlock"))?.init?.body))).toEqual({ password: "correct horse" });
    expect(useAppStore.getState().isVaultUnlocked).toBe(true);
  });

  it("asks for the password when the PIN can't be used yet", () => {
    mockEngine({});
    useAppStore.setState({ isVaultPinLocked: true });
    render(<VaultView />);
    expect(screen.getByText("Enter your master password")).toBeInTheDocument();
    expect(screen.getByText(/After that, your PIN reopens the vault/)).toBeInTheDocument();
    expect(screen.queryAllByLabelText(/PIN digit/)).toHaveLength(0);
  });
});

describe("Vault when unlocked", () => {
  const photos = [
    vaultPhoto(1, "2024-03-01 10:00:00"),
    vaultPhoto(2, "2026-05-01 10:00:00"),
    vaultPhoto(3, null),
    vaultPhoto(4, "2025-12-24 10:00:00"),
  ];

  function renderUnlocked(onPhotoClick = vi.fn()) {
    mockEngine({
      "/api/vault/photos": photos,
      "/api/vault/albums": [],
      "/api/vault/enhancement-progress": { is_active: false, completed_count: 0, total_count: 0, paused_reason: null },
      "/api/system/settings": { settings: { auto_lock_duration: 300 } },
    });
    useAppStore.setState({ isVaultUnlocked: true });
    render(<VaultView onPhotoClick={onPhotoClick} />);
    return onPhotoClick;
  }

  it("shows a calm countdown, the privacy shield and Lock now, plus section tabs with counts", async () => {
    renderUnlocked();
    expect(screen.getByRole("heading", { level: 1, name: "Private Vault" })).toBeInTheDocument();
    expect(screen.getByText(/Unlocked · locks in 5:00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lock now/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Photos 4/ })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: /Albums 0/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Documents 0/ })).toBeInTheDocument();
  });

  it("reports activity to the engine (at most every 15 s) and shows the lock card if the engine has locked", async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    renderUnlocked();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Photos 4/ })).toBeInTheDocument());
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const pings = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/vault/activity"));

    now += 5_000;
    fireEvent.mouseMove(window);
    expect(pings()).toHaveLength(0); // Within 15 s of the last report.

    now += 11_000;
    fireEvent.mouseMove(window);
    fireEvent.mouseMove(window);
    expect(pings()).toHaveLength(1);
    expect((pings()[0][1] as RequestInit).method).toBe("POST");

    // The engine has locked already (for example after the PC slept): show the lock card.
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/api/vault/activity") ? new Response("{}", { status: 401 }) : new Response("{}", { status: 200 }),
    );
    now += 16_000;
    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowDown" });
    });
    await waitFor(() => expect(useAppStore.getState().isVaultUnlocked).toBe(false));
    clock.mockRestore();
  });

  it("blurs everything with the privacy shield, from the button or the P key", async () => {
    renderUnlocked();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Photos 4/ })).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "p" });
    expect(screen.getByRole("button", { name: "Privacy shield: show photos" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("tab", { name: /Photos/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Privacy shield: show photos" }));
    expect(screen.getByRole("tab", { name: /Photos 4/ })).toBeInTheDocument();
  });

  it("opens vault photos newest first, with vault thumbnails and no selection, even with a selection left over from Photos", async () => {
    // jsdom has no layout: give elements a size so the timeline renders tiles.
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
    try {
      useAppStore.setState({ selectedPhotoIds: new Set([999]) });
      const onPhotoClick = renderUnlocked();
      await waitFor(() => expect(document.querySelectorAll("[data-photo-id]").length).toBe(4));
      expect(screen.getByRole("heading", { name: "May 2026" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Select" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Add to favourites/ })).not.toBeInTheDocument();
      const firstTile = document.querySelector('[data-photo-id="2"]')!;
      expect(firstTile.querySelector("img")?.getAttribute("src")).toContain("/api/vault/thumbnail/2");

      fireEvent.click(firstTile);
      const [index, list] = onPhotoClick.mock.calls[0] as [number, PhotoItem[]];
      expect(index).toBe(0);
      expect(list.map((p) => p.id)).toEqual([2, 4, 1, 3]);
      expect(useAppStore.getState().selectedPhotoIds).toEqual(new Set([999]));
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
      if (height) Object.defineProperty(HTMLElement.prototype, "clientHeight", height);
    }
  });
});

describe("Factory reset in Settings", () => {
  it("lives in Settings → Private Vault → Danger zone", () => {
    mockEngine({});
    render(<VaultSettings settings={{ auto_lock_duration: 300 } as never} updateSetting={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Danger zone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erase the vault" })).toBeEnabled();
  });

  it("can't be started without a vault", () => {
    useAppStore.setState({ isVaultConfigured: false });
    render(<VaultFactoryReset />);
    expect(screen.getByRole("button", { name: "Erase the vault" })).toBeDisabled();
  });

  it("shows what will be erased and only erases after the exact phrase", async () => {
    const calls = mockEngine({
      "/api/vault/reset-preview": { photo_count: 12, album_count: 2 },
      "/api/vault/reset": { success: true },
    });
    render(<VaultFactoryReset />);
    fireEvent.click(screen.getByRole("button", { name: "Erase the vault" }));
    expect(await screen.findByText("12 photos and 2 albums")).toBeInTheDocument();

    const erase = screen.getByRole("button", { name: "Erase permanently" });
    expect(erase).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: "erase all data" } });
    expect(erase).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: RESET_PHRASE } });
    expect(erase).toBeEnabled();

    await act(async () => {
      fireEvent.click(erase);
    });
    const post = calls.find((c) => c.url.endsWith("/api/vault/reset"));
    expect(post?.init?.method).toBe("POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ confirm_phrase: RESET_PHRASE });
    expect(useAppStore.getState().isVaultConfigured).toBe(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
