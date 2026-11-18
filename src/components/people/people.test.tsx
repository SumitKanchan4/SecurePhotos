import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import type { FaceScanStatus, PersonItem, UnlabeledClusterItem } from "../../types";
import { PeopleView } from "../PeopleView";
import { matchesSearch, PeopleOverview, photoCountLabel } from "./PeopleOverview";
import { PersonPage, personMeta } from "./PersonPage";

vi.mock("../../services/external", () => ({ openExternal: vi.fn() }));

const person = (id: number, name: string, count: number, close = false, relationship_type?: string): PersonItem => ({
  id,
  name,
  affinity_score: 50,
  is_close_one: close,
  confirmed_count: count,
  cover_face_id: id * 10,
  relationship_type,
});

const PEOPLE = [person(1, "Asha", 1204, true, "Family"), person(2, "Rohan", 412, true), person(3, "Kabir", 142)];
const CLUSTERS: UnlabeledClusterItem[] = [
  { cluster_id: "cluster_4", photo_count: 58, face_count: 60, medoid_face_id: 400, anchor_face_ids: [400] },
  { cluster_id: "cluster_5", photo_count: 1, face_count: 1, medoid_face_id: 500, anchor_face_ids: [500] },
];
const IDLE: FaceScanStatus = { is_scanning: false, total_photos: 0, scanned_photos: 0, faces_found: 0 };
const SUGGESTION = {
  person_id: 2, person_name: "Rohan", person_photo_count: 412, person_face_id: 20,
  cluster_id: "cluster_4", cluster_photo_count: 37, cluster_face_id: 400, similarity: 0.52,
};

type Call = { url: string; init?: RequestInit };

function mockEngine(routes: Record<string, unknown | ((call: Call) => unknown)>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      const key = `${init?.method ?? "GET"} ${url.replace("http://127.0.0.1:50123", "").split("?")[0]}`;
      const route = routes[key];
      if (route === undefined) return new Response("{}", { status: 200 });
      const body = typeof route === "function" ? (route as (c: Call) => unknown)(call) : route;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

function renderOverview(overrides: Partial<React.ComponentProps<typeof PeopleOverview>> = {}) {
  const props = {
    people: PEOPLE,
    clusters: CLUSTERS,
    scanStatus: IDLE,
    isLoading: false,
    isResetting: false,
    onOpenPerson: vi.fn(),
    onInspectFace: vi.fn(),
    onRefresh: vi.fn(async () => {}),
    onScan: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<PeopleOverview {...props} />);
  return props;
}

beforeEach(() => {
  useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", searchQuery: "", showToast: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("helpers", () => {
  it("counts photos in plain words and searches names and relationships", () => {
    expect(photoCountLabel(1)).toBe("1 photo");
    expect(photoCountLabel(1204)).toBe("1,204 photos");
    expect(matchesSearch(PEOPLE[0], "fam")).toBe(true);
    expect(matchesSearch(PEOPLE[1], "ROH")).toBe(true);
    expect(matchesSearch(PEOPLE[2], "asha")).toBe(false);
    expect(matchesSearch(PEOPLE[2], "  ")).toBe(true);
  });
});

describe("PeopleOverview", () => {
  it("pins close ones on top, lists everyone else, and opens a person", () => {
    mockEngine({ "GET /api/people/merge-suggestions": [] });
    const { onOpenPerson } = renderOverview();
    expect(screen.getByText("3 named · 2 to name")).toBeInTheDocument();
    const close = screen.getByRole("heading", { name: "Close ones" }).parentElement!;
    expect(close).toHaveTextContent("Asha");
    expect(close).toHaveTextContent("1,204 photos");
    expect(close).not.toHaveTextContent("Kabir");
    const everyone = screen.getByRole("heading", { name: "Everyone" }).parentElement!;
    expect(everyone).toHaveTextContent("Kabir");
    fireEvent.click(screen.getByRole("button", { name: /Kabir/ }));
    expect(onOpenPerson).toHaveBeenCalledWith(PEOPLE[2]);
  });

  it("asks 'Same person?' and merges on yes", async () => {
    let suggestions = [SUGGESTION];
    const calls = mockEngine({
      "GET /api/people/merge-suggestions": () => suggestions,
      "POST /api/people/2/merge-cluster": () => {
        suggestions = [];
        return { status: "merged" };
      },
    });
    const { onRefresh } = renderOverview();
    expect(await screen.findByText("Same person?")).toBeInTheDocument();
    // Side by side, big faces, several per side (round 1, #24).
    const card = screen.getByRole("region", { name: "Same person?" });
    expect(within(card).getByText("Do these faces belong to Rohan?")).toBeInTheDocument();
    expect(within(card).getByText("412 photos")).toBeInTheDocument();
    expect(within(card).getByText("Not named yet")).toBeInTheDocument();
    expect(within(card).getByText("37 photos")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, same person" }));
    });
    const post = calls.find((c) => c.url.endsWith("/api/people/2/merge-cluster"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ cluster_id: "cluster_4" });
    expect(onRefresh).toHaveBeenCalled();
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Added 37 photos to Rohan.", "success");
    await waitFor(() => expect(screen.queryByText("Same person?")).not.toBeInTheDocument());
  });

  it("remembers 'Not the same' without merging", async () => {
    let suggestions = [SUGGESTION];
    const calls = mockEngine({
      "GET /api/people/merge-suggestions": () => suggestions,
      "POST /api/people/merge-suggestions/reject": () => {
        suggestions = [];
        return { status: "rejected" };
      },
    });
    const { onRefresh } = renderOverview();
    await screen.findByText("Same person?");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Not the same" }));
    });
    const post = calls.find((c) => c.url.endsWith("/merge-suggestions/reject"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ person_id: 2, cluster_id: "cluster_4" });
    expect(calls.some((c) => c.url.includes("merge-cluster"))).toBe(false);
    expect(onRefresh).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Same person?")).not.toBeInTheDocument());
  });

  it("names a group once, says when it adds to someone, and never changes their relationship", async () => {
    const calls = mockEngine({ "GET /api/people/merge-suggestions": [], "POST /api/people/tag-cluster": { photos_tagged: 470 } });
    const { onRefresh } = renderOverview();
    const input = screen.getByLabelText("Name for this face (58 photos)");
    fireEvent.change(input, { target: { value: "rohan" } });
    expect(screen.getByText("58 photos · adds to Rohan")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const post = calls.find((c) => c.url.endsWith("/api/people/tag-cluster"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ cluster_id: "cluster_4", name: "rohan", relationship_type: null });
    expect(onRefresh).toHaveBeenCalled();
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Tagged rohan in 470 photos.", "success");
  });

  it("asks a new person's relationship while naming them (round 1, #23)", async () => {
    const calls = mockEngine({ "GET /api/people/merge-suggestions": [], "POST /api/people/tag-cluster": { photos_tagged: 58 } });
    renderOverview();
    const input = screen.getByLabelText("Name for this face (58 photos)");
    expect(screen.queryByLabelText(/Relationship to/)).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "rohan" } }); // An existing person: no question.
    expect(screen.queryByLabelText(/Relationship to/)).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Meera" } });
    fireEvent.change(screen.getByLabelText("Relationship to Meera"), { target: { value: "Family" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const post = calls.find((c) => c.url.endsWith("/api/people/tag-cluster"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ cluster_id: "cluster_4", name: "Meera", relationship_type: "Family" });
  });

  it("hides a group that isn't a person, and opens a face in its photo", async () => {
    const calls = mockEngine({ "GET /api/people/merge-suggestions": [] });
    const { onInspectFace, onRefresh } = renderOverview();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Not a person" })[1]);
    });
    expect(calls.some((c) => c.url.endsWith("/api/people/clusters/cluster_5/dismiss") && c.init?.method === "POST")).toBe(true);
    expect(onRefresh).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "See this face in its photo" })[0]);
    expect(onInspectFace).toHaveBeenCalledWith(400);
  });

  it("filters by its own search field and hides naming while searching", async () => {
    mockEngine({ "GET /api/people/merge-suggestions": [SUGGESTION] });
    // Text typed on the Search page never filters this page (no hidden filters, R9c).
    useAppStore.setState({ searchQuery: "zzz" });
    renderOverview();
    await waitFor(() => expect(screen.getByRole("button", { name: /Asha/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Search people" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search people" }), { target: { value: "kab" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /Kabir/ })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Asha/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Same person?")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Who is this?" })).not.toBeInTheDocument();
  });

  it("explains an empty library and keeps Start over behind the menu", () => {
    mockEngine({ "GET /api/people/merge-suggestions": [] });
    const { onScan, onReset } = renderOverview({ people: [], clusters: [] });
    expect(screen.getByRole("heading", { name: "No faces yet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Look for faces" }));
    expect(onScan).toHaveBeenCalledOnce();
    expect(screen.queryByText("Start over…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Start over/ }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});

describe("Person page rename", () => {
  it("renames a person by clicking the name, but not to a name someone else already has", async () => {
    const calls = mockEngine({
      "GET /api/people": PEOPLE,
      "GET /api/people/clusters": [],
      "GET /api/people/scan-progress": IDLE,
      "GET /api/people/merge-suggestions": [],
      "GET /api/people/2/photos": [],
      "PATCH /api/people/2": ({ init }: Call) => ({ ...PEOPLE[1], name: JSON.parse(String(init?.body)).name }),
    });
    render(<PeopleView />);
    fireEvent.click(await screen.findByRole("button", { name: /Rohan/ }));
    fireEvent.click(await screen.findByTitle("Click to rename"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "asha" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Someone else is already called Asha. Pick a different name.", "warning");
    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(false);

    fireEvent.click(screen.getByTitle("Click to rename"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rohan K" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ name: "Rohan K" });
    expect(await screen.findByRole("heading", { level: 1, name: "Rohan K" })).toBeInTheDocument();
  });
});

describe("Person page (R10)", () => {
  // jsdom has no layout: give elements a size so the photo grid lays out its rows.
  const sizeProps = ["clientWidth", "clientHeight"] as const;
  const originals = sizeProps.map((prop) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
  });
  afterAll(() => {
    sizeProps.forEach((prop, i) => {
      if (originals[i]) Object.defineProperty(HTMLElement.prototype, prop, originals[i]!);
    });
  });
  const ROHAN = person(2, "Rohan", 3, false, "Friends");
  const photosOf = [
    { id: 71, filename: "a.jpg", filepath: "a.jpg", file_size: 1, mime_type: "image/jpeg", width: 4000, height: 3000, taken_at: "2026-11-02 10:00:00", is_favorite: false, is_encrypted: false, is_optimized: true, is_enhanced: false },
    { id: 72, filename: "b.jpg", filepath: "b.jpg", file_size: 1, mime_type: "image/jpeg", width: 4000, height: 3000, taken_at: "2024-05-02 10:00:00", is_favorite: false, is_encrypted: false, is_optimized: true, is_enhanced: false },
    { id: 73, filename: "c.jpg", filepath: "c.jpg", file_size: 1, mime_type: "image/jpeg", width: 4000, height: 3000, taken_at: "2019-01-02 10:00:00", is_favorite: false, is_encrypted: false, is_optimized: true, is_enhanced: false },
  ];

  function renderPage(overrides: Partial<React.ComponentProps<typeof PersonPage>> = {}) {
    const props = {
      person: ROHAN,
      takenNames: ["Asha", "Rohan", "Kabir"],
      onBack: vi.fn(),
      onChanged: vi.fn(),
      onDeleted: vi.fn(),
      onOpenPhotos: vi.fn(),
      ...overrides,
    };
    render(<PersonPage {...props} />);
    return props;
  }

  it("says how many photos and over which years, and offers relationship and Close one", async () => {
    expect(personMeta(photosOf)).toBe("3 photos · 2019 – 2026");
    const calls = mockEngine({
      "GET /api/people/2/photos": photosOf,
      "PATCH /api/people/2": ({ init }: Call) => ({ ...ROHAN, ...JSON.parse(String(init?.body)) }),
    });
    const { onChanged } = renderPage();
    expect(await screen.findByText("3 photos · 2019 – 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Relationship: Friends" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Family" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Close one/ }));
    });
    const bodies = calls.filter((c) => c.init?.method === "PATCH").map((c) => JSON.parse(String(c.init?.body)));
    expect(bodies).toEqual([{ relationship_type: "Family" }, { is_close_one: true }]);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("takes selected photos off the person with \"Not Rohan\"; they stay in the library", async () => {
    const calls = mockEngine({ "GET /api/people/2/photos": photosOf });
    useAppStore.setState({ selectedPhotoIds: new Set<number>() });
    const { onChanged } = renderPage();
    await screen.findByText("3 photos · 2019 – 2026");
    act(() => useAppStore.setState({ selectedPhotoIds: new Set([71, 73]) }));
    const bar = await screen.findByRole("toolbar", { name: "Selected photos" });
    await act(async () => {
      fireEvent.click(within(bar).getByRole("button", { name: /Not Rohan/ }));
    });
    expect(calls.filter((c) => c.url.includes("/unlink-photo/")).map((c) => c.url.split("/").pop())).toEqual(["71", "73"]);
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Took 2 photos off Rohan. They stay in your library.", "success");
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ confirmed_count: 1 }));
    expect(screen.getByText("1 photo · 2 May 2024")).toBeInTheDocument();
  });

  it("chooses a profile photo by clicking it, and asks before deleting the person", async () => {
    const calls = mockEngine({
      "GET /api/people/2/photos": photosOf,
      "POST /api/people/2/cover": { status: "ok", cover_face_id: 999 },
      "DELETE /api/people/2": { status: "deleted" },
    });
    const { onChanged, onDeleted, onOpenPhotos } = renderPage();
    await screen.findByText("3 photos · 2019 – 2026");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Choose profile photo" }));
    expect(screen.getByText("Click the photo you want as Rohan's profile photo.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-photo-id="72"]') as HTMLElement);
    });
    expect(onOpenPhotos).not.toHaveBeenCalled();
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith("/cover"))?.init?.body))).toEqual({ photo_id: 72 });
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ cover_face_id: 999 }));

    // Outside "choose" mode a click opens the photo in the viewer.
    fireEvent.click(document.querySelector('[data-photo-id="71"]') as HTMLElement);
    expect(onOpenPhotos).toHaveBeenCalledWith(expect.any(Array), 0);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Rohan…" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("every photo stays in your library");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Rohan…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Rohan" }));
    });
    expect(onDeleted).toHaveBeenCalledWith(2);
  });
});
