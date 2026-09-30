from pathlib import Path
import sys

from PIL import Image, ImageDraw


def radial_background(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (247, 244, 255, 255))
    pixels = image.load()
    center = (size - 1) / 2
    radius = size * 0.72
    for y in range(size):
        for x in range(size):
            distance = ((x - center) ** 2 + (y - center) ** 2) ** 0.5
            mix = max(0.0, 1.0 - distance / radius)
            pixels[x, y] = (
                int(247 - 8 * mix),
                int(244 - 10 * mix),
                255,
                255,
            )
    return image


def centered_art(source: Image.Image, size: int, scale: float) -> Image.Image:
    art_size = max(1, round(size * scale))
    art = source.resize((art_size, art_size), Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = ((size - art_size) // 2, (size - art_size) // 2)
    layer.alpha_composite(art, offset)
    return layer


def isolate_original_orb(source: Image.Image) -> Image.Image:
    side = min(source.size)
    crop_side = round(side * 0.62)
    left = (source.width - crop_side) // 2
    top = (source.height - crop_side) // 2
    orb = source.crop((left, top, left + crop_side, top + crop_side)).convert("RGBA")
    pixels = orb.load()
    for y in range(orb.height):
        for x in range(orb.width):
            red, green, blue, _ = pixels[x, y]
            maximum = max(red, green, blue)
            minimum = min(red, green, blue)
            saturation_alpha = (maximum - minimum) * 3.2
            highlight_alpha = (maximum - 150) * 2.5
            alpha = max(0, min(255, round(max(saturation_alpha, highlight_alpha))))
            if maximum < 90 and saturation_alpha < 180:
                alpha = 0
            if alpha < 220:
                red = max(red, 116)
                green = max(green, 58)
                blue = max(blue, 224)
            pixels[x, y] = (red, green, blue, alpha)
    return orb


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: build_light_icon.py SOURCE PROJECT_ROOT")
    source_path = Path(sys.argv[1])
    project = Path(sys.argv[2])
    source = isolate_original_orb(Image.open(source_path).convert("RGBA"))
    master = project / "mobile" / "icon-light-v2-original.png"
    source.save(master, optimize=True)

    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, size in densities.items():
        destination = project / "android" / "app" / "src" / "main" / "res" / f"mipmap-{density}"
        foreground = centered_art(source, size, 0.82)
        foreground.save(destination / "ic_launcher_foreground.png", optimize=True)

        legacy = radial_background(size)
        legacy.alpha_composite(centered_art(source, size, 0.90))
        legacy.convert("RGB").save(destination / "ic_launcher.png", optimize=True)

        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
        round_icon = legacy.copy()
        round_icon.putalpha(mask)
        round_icon.save(destination / "ic_launcher_round.png", optimize=True)


if __name__ == "__main__":
    main()
