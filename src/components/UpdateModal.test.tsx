import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";
import { UpdateModal } from "./UpdateModal";

describe("Update window (owner, 2026-11-24)", () => {
  it("shows the app's logo, the version once, and the notes formatted", () => {
    const update = { version: "v0.3.2", body: "### Stories\n- Songs come with **SecurePhotos**." } as unknown as Update;
    const { container } = render(<UpdateModal update={update} isOpen onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "A new version of SecurePhotos" })).toBeInTheDocument();
    expect(screen.getByText("SecurePhotos 0.3.2 is ready to install")).toBeInTheDocument();
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/app-icon|^data:image\/svg/); // inlined by the build
    expect(screen.getByRole("heading", { name: "Stories" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("Songs come with SecurePhotos.");
    expect(container.textContent).not.toMatch(/###|\*\*/);
  });
});
