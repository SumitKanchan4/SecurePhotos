"""Renders the app icon files from the SVG sources in src/assets/brand (redesign Step 0).

Usage: python scripts/render_app_icons.py
Requires Playwright with Microsoft Edge (development only; not needed to build the app).

- app-icon.svg (full 3D-style icon) is used for 48 px and up.
- app-icon-small.svg (simplified) is used for 32 px and below, where fine detail blurs.
Writes src-tauri/icons/{32x32.png,128x128.png,128x128@2x.png,icon.png,icon.ico}.
"""

import io
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "src" / "assets" / "brand"
ICONS = ROOT / "src-tauri" / "icons"
SMALL_MAX = 32


def render(page, svg_text: str, size: int) -> Image.Image:
    page.set_content(
        f'<html><body style="margin:0;background:transparent">'
        f'<div id="i" style="width:{size}px;height:{size}px">{svg_text.replace("<svg ", f"<svg width={size!s} height={size!s} ", 1)}</div>'
        f"</body></html>"
    )
    png = page.locator("#i").screenshot(omit_background=True)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def main() -> None:
    full = (BRAND / "app-icon.svg").read_text(encoding="utf-8")
    small = (BRAND / "app-icon-small.svg").read_text(encoding="utf-8")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(device_scale_factor=1)
        art = {s: render(page, small if s <= SMALL_MAX else full, s) for s in (16, 24, 32, 48, 64, 128, 256, 512)}
        browser.close()

    art[32].save(ICONS / "32x32.png")
    art[128].save(ICONS / "128x128.png")
    art[256].save(ICONS / "128x128@2x.png")
    art[512].save(ICONS / "icon.png")
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    art[256].save(ICONS / "icon.ico", format="ICO", sizes=[(s, s) for s in ico_sizes],
                  append_images=[art[s] for s in ico_sizes if s != 256])
    for name in ("32x32.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.ico"):
        print(f"wrote src-tauri/icons/{name}")


if __name__ == "__main__":
    main()
