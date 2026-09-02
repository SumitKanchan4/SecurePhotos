"""Utility script to generate application icon assets."""

from pathlib import Path
from PIL import Image, ImageDraw

def generate_icons():
    icons_dir = Path("src-tauri/icons")
    icons_dir.mkdir(parents=True, exist_ok=True)

    # Base image 512x512 with sleek gradient-like aesthetic
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw rounded shield background
    draw.rounded_rectangle(
        [(32, 32), (480, 480)],
        radius=96,
        fill=(59, 130, 246, 255),
        outline=(255, 255, 255, 60),
        width=8,
    )

    # Inner camera aperture/lens accent
    draw.ellipse([(176, 176), (336, 336)], fill=(14, 16, 23, 255), outline=(255, 255, 255, 180), width=12)
    draw.ellipse([(224, 224), (288, 288)], fill=(139, 92, 246, 255))

    # Save sizes
    img.save(icons_dir / "icon.png", format="PNG")
    img.resize((32, 32), Image.Resampling.LANCZOS).save(icons_dir / "32x32.png")
    img.resize((128, 128), Image.Resampling.LANCZOS).save(icons_dir / "128x128.png")
    img.resize((256, 256), Image.Resampling.LANCZOS).save(icons_dir / "128x128@2x.png")
    img.resize((256, 256), Image.Resampling.LANCZOS).save(icons_dir / "icon.ico", format="ICO")
    print("All Tauri icons generated successfully.")

if __name__ == "__main__":
    generate_icons()
