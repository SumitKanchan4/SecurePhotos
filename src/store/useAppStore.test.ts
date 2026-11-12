import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./useAppStore";

const BASE = "http://127.0.0.1:50123";

beforeEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState({
    apiBaseUrl: BASE,
    apiToken: "token-abc",
    isVaultConfigured: false,
    isVaultUnlocked: false,
    hasVaultPin: false,
    isVaultPinLocked: false,
    vaultPasswordHint: null,
    selectedPhotoIds: new Set<number>(),
    toast: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkVaultStatus", () => {
  it("reads the vault status from the engine with the token and cookie", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          is_configured: true,
          is_unlocked: false,
          has_pin: true,
          is_pin_locked: false,
          password_hint: "first pet",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await useAppStore.getState().checkVaultStatus();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/vault/status`);
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["X-SecurePhotos-Token"]).toBe("token-abc");
    const s = useAppStore.getState();
    expect([s.isVaultConfigured, s.isVaultUnlocked, s.hasVaultPin, s.isVaultPinLocked]).toEqual([true, false, true, false]);
    expect(s.vaultPasswordHint).toBe("first pet");
  });

  it("keeps the current state when the engine cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    useAppStore.setState({ isVaultConfigured: true, isVaultUnlocked: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await useAppStore.getState().checkVaultStatus();

    expect(useAppStore.getState().isVaultUnlocked).toBe(true);
    expect(useAppStore.getState().isVaultConfigured).toBe(true);
  });
});

describe("photo selection", () => {
  it("toggles photos in and out, and clears", () => {
    const { togglePhotoSelection, clearSelection } = useAppStore.getState();
    togglePhotoSelection(1);
    togglePhotoSelection(2);
    togglePhotoSelection(1);
    expect([...useAppStore.getState().selectedPhotoIds]).toEqual([2]);
    clearSelection();
    expect(useAppStore.getState().selectedPhotoIds.size).toBe(0);
  });
});

describe("toasts", () => {
  it("hide themselves after 4 seconds, but never hide a newer toast", () => {
    vi.useFakeTimers();
    const { showToast } = useAppStore.getState();
    showToast("first");
    vi.advanceTimersByTime(3000);
    showToast("second", "success"); // Fake time moved on, so the new toast gets a new id.
    vi.advanceTimersByTime(1500); // The first toast's timer fires now.
    expect(useAppStore.getState().toast?.message).toBe("second");
    vi.advanceTimersByTime(3000);
    expect(useAppStore.getState().toast).toBeNull();
  });
});
