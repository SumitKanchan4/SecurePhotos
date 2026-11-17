import { describe, expect, it } from "vitest";
import { humanName, isMachineName, itemTitle } from "./displayName";

describe("file names people see", () => {
  it("hides names made by phones, cameras and apps", () => {
    for (const name of [
      "1792341321410-1c9bc690-7433-41b8-b05b-6742f8547d2f.avif",
      "1621140648084-cdb2ee1d-fb6a-4a8c-b0b2-bc7c53459b23_.jpg",
      "1792341321410-1c9bc690-7433-41b8-b05b-6742f8547d2f_fade,scratches,faces.avif",
      "IMG_1234.jpg",
      "IMG-20240501-WA0007.jpg",
      "PXL_20261115_181212345.jpg",
      "DSC01234.JPG",
      "Screenshot_20261101-101010.png",
      "WhatsApp Image 2024-05-01 at 10.10.10.jpeg",
      "20261115_181212.jpg",
      "0042.jpg",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4.jpg",
    ]) {
      expect(isMachineName(name), name).toBe(true);
    }
  });

  it("keeps names a person wrote", () => {
    expect(humanName("Grandma's wedding.jpg")).toBe("Grandma's wedding");
    expect(humanName("shimla_trip_1984.jpg")).toBe("shimla trip 1984");
    expect(humanName("Diwali 2019_fade.avif")).toBe("Diwali 2019");
    expect(isMachineName("Mum and Dad.png")).toBe(false);
  });

  it("titles an item by what it is when its name means nothing", () => {
    expect(itemTitle({ filename: "IMG_1234.jpg" })).toBe("Photo");
    expect(itemTitle({ filename: "VID_20240101.mp4", mime_type: "video/mp4" })).toBe("Video");
    expect(itemTitle({ filename: "1792341321410-1c9bc690-7433-41b8-b05b-6742f8547d2f_fade.avif", derived_from_id: 4 })).toBe("Improved photo");
    expect(itemTitle({ filename: "scan0001.pdf", mime_type: "application/pdf" })).toBe("Document");
    expect(itemTitle({ filename: "0001.pdf", is_document: true })).toBe("Document");
    expect(itemTitle({ filename: "Holiday in Goa.jpg", derived_from_id: 4 })).toBe("Holiday in Goa");
  });
});
