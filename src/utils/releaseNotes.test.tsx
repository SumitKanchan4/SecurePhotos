import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseNotes, ReleaseNotes } from "./releaseNotes";

const NOTES = `### Stories
- Three songs now come with **SecurePhotos**, so every story has music.

### Installing and updating
- Removing SecurePhotos explains on its one screen what stays.
- See [the changelog](https://example.com) for \`more\`.

The full history is online.`;

describe("release notes in the update window", () => {
  it("reads headings, bullets and paragraphs", () => {
    expect(parseNotes(NOTES)).toEqual([
      { kind: "heading", text: "Stories" },
      { kind: "list", items: ["Three songs now come with **SecurePhotos**, so every story has music."] },
      { kind: "heading", text: "Installing and updating" },
      { kind: "list", items: ["Removing SecurePhotos explains on its one screen what stays.", "See the changelog for more."] },
      { kind: "text", text: "The full history is online." },
    ]);
  });

  it("shows them formatted, bold as bold, and never as HTML", () => {
    const { container } = render(<ReleaseNotes markdown={`${NOTES}\n- <img src=x onerror=alert(1)> stays text`} />);
    expect(screen.getByRole("heading", { name: "Stories" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(container.querySelector("strong")).toHaveTextContent("SecurePhotos");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)> stays text")).toBeInTheDocument();
    expect(container.textContent).not.toContain("###");
    expect(container.textContent).not.toContain("**");
  });
});
