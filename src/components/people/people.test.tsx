import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import type { FaceScanStatus, PersonItem, UnlabeledClusterItem } from "../../types";
import { PeopleView } from "../PeopleView";
import { matchesSearch, PeopleOverview, photoCountLabel } from "./PeopleOverview";

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
    expect(screen.getByText("Rohan (412 photos) and an unnamed group (37 photos) look alike.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, merge" }));
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
  it("renames a person, but not to a name someone else already has", async () => {
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
    fireEvent.click(await screen.findByRole("button", { name: "Rename Rohan" }));

    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "asha" } });
    fireEvent.blur(input);
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Someone else is already called Asha. Pick a different name.", "warning");
    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Rename Rohan" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rohan K" } });
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
      fireEvent.blur(screen.getByLabelText("Name"));
    });
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ name: "Rohan K" });
    expect(await screen.findByRole("button", { name: "Rename Rohan K" })).toBeInTheDocument();
  });
});
