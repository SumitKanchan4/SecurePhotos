import { describe, expect, it } from "vitest";
import { updateErrorText } from "./updateText";

describe("updateErrorText (T18)", () => {
  it("explains a signature the app can't check (people on 0.2.0, new key)", () => {
    expect(updateErrorText(new Error("signature verification failed: invalid encoding in minisign data"))).toMatch(
      /^This update couldn't be checked, so it wasn't installed\. Download the installer and run it once/,
    );
  });

  it("says when the download itself failed", () => {
    expect(updateErrorText({ message: "error sending request for url" })).toBe(
      "The update couldn't be downloaded. Check your internet connection and try again.",
    );
  });

  it("falls back to calm words for anything else", () => {
    expect(updateErrorText("Access is denied. (os error 5)")).toBe(
      "The update didn't install. Your photos are fine. Try again, or download the installer and run it.",
    );
    expect(updateErrorText(undefined)).toMatch(/^The update didn't install/);
  });
});
