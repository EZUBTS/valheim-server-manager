"""Generate the Valheim Server Manager application icon.

Run with the bundled Python (Pillow is required):

    python scripts/generate-icon.py

The result is written to ``assets/app-icon.png`` (1024x1024, rounded corners,
transparent outside the rounded square). Regenerate the platform icon set with::

    pnpm tauri icon assets/app-icon.png
"""

from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SIZE = 1024
CENTER = SIZE / 2
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "assets", "app-icon.png")

# Valheim-inspired palette: deep forest green, moss, gold.
BG_TOP = (38, 56, 44)
BG_BOTTOM = (9, 14, 11)
GOLD_LIGHT = (246, 214, 128)
GOLD_MID = (216, 168, 74)
GOLD_DARK = (150, 106, 36)


def radial_gradient(size: int, inner: tuple[int, int, int], outer: tuple[int, int, int]) -> Image.Image:
    """Simple radial gradient going from ``inner`` (center) to ``outer`` (corner)."""
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    max_dist = math.hypot(size / 2, size / 2)
    for y in range(size):
        for x in range(size):
            distance = math.hypot(x - size / 2, y - size / 2) / max_dist
            ratio = min(1.0, distance**1.15)
            pixels[x, y] = tuple(
                int(inner[channel] + (outer[channel] - inner[channel]) * ratio)
                for channel in range(3)
            )
    return image


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        ratio = y / (size - 1)
        color = tuple(
            int(top[channel] + (bottom[channel] - top[channel]) * ratio) for channel in range(3)
        )
        draw.line([(0, y), (size, y)], fill=color)
    return image


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, fill=255
    )
    return mask


def load_font(path: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def text_mask(text: str, font: ImageFont.FreeTypeFont | ImageFont.ImageFont, stroke: int = 0) -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(mask)
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    draw.text(
        (
            CENTER - width / 2 - bbox[0],
            CENTER - height / 2 - bbox[1] + SIZE * 0.03,
        ),
        text,
        font=font,
        fill=255,
        stroke_width=stroke,
        stroke_fill=255,
    )
    return mask


def main() -> None:
    canvas = radial_gradient(SIZE, BG_TOP, BG_BOTTOM)
    # Subtle vignette / light from the top.
    glow = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(glow).ellipse(
        (SIZE * 0.08, -SIZE * 0.25, SIZE * 0.92, SIZE * 0.65), fill=90
    )
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    canvas = Image.composite(Image.new("RGB", (SIZE, SIZE), (86, 110, 78)), canvas, glow)

    icon = canvas.convert("RGBA")

    # Outer gold ring with a darker inner outline.
    ring = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ring_draw = ImageDraw.Draw(ring)
    ring_draw.ellipse(
        (CENTER - 352, CENTER - 352, CENTER + 352, CENTER + 352),
        outline=GOLD_MID + (255,),
        width=14,
    )
    ring_draw.ellipse(
        (CENTER - 326, CENTER - 326, CENTER + 326, CENTER + 326),
        outline=GOLD_DARK + (160,),
        width=3,
    )
    icon = Image.alpha_composite(icon, ring)

    # Runic gold "V" — the mark of the manager.
    font = load_font(r"C:\Windows\Fonts\georgiab.ttf", 620)
    v_mask = text_mask("V", font, stroke=6)
    gold = vertical_gradient(SIZE, GOLD_LIGHT, GOLD_DARK).convert("RGBA")

    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow_mask = v_mask.filter(ImageFilter.GaussianBlur(18))
    shadow.putalpha(shadow_mask.point(lambda value: int(value * 0.65)))
    shadow = Image.composite(
        Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255)), shadow, shadow_mask
    )
    icon = Image.alpha_composite(icon, shadow)
    icon = Image.composite(gold, icon, v_mask)

    # Two small gold diamonds as a runic accent under the mark.
    accents = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    accent_draw = ImageDraw.Draw(accents)
    for offset in (-64, 0, 64):
        cx = CENTER + offset
        cy = CENTER + 408
        accent_draw.polygon(
            [(cx, cy - 16), (cx + 16, cy), (cx, cy + 16), (cx - 16, cy)],
            fill=GOLD_MID + (220,),
        )
    icon = Image.alpha_composite(icon, accents)

    # Rounded corners.
    icon.putalpha(Image.composite(icon.getchannel("A"), Image.new("L", (SIZE, SIZE), 0), rounded_mask(SIZE, 200)))

    out_path = os.path.abspath(OUT_PATH)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    icon.save(out_path, "PNG")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
