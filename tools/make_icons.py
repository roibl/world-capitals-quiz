"""Render the app icons (icon-180.png, icon-192.png, icon-512.png) with Pillow.

Usage: python tools/make_icons.py
The design matches icon.svg: a globe on a navy tile with a few capital dots.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
NAVY = (20, 40, 75)
OCEAN = (198, 230, 247)
LINE = (255, 255, 255)
BLUE = (36, 66, 212)
GREEN = (21, 161, 74)


def render(size):
    s = 4  # supersample for smooth edges
    n = size * s
    img = Image.new("RGB", (n, n), NAVY)
    d = ImageDraw.Draw(img)
    c = n / 2
    r = n * 0.36
    d.ellipse([c - r, c - r, c + r, c + r], fill=OCEAN)
    w = max(2, int(n * 0.018))
    # meridians and parallels
    for k in (0.45, 0.8):
        d.ellipse([c - r * k, c - r, c + r * k, c + r], outline=LINE, width=w)
    d.line([c, c - r, c, c + r], fill=LINE, width=w)
    for frac in (-0.5, 0, 0.5):
        y = c + r * frac
        half = (r * r - (r * frac) ** 2) ** 0.5
        d.line([c - half, y, c + half, y], fill=LINE, width=w)
    d.ellipse([c - r, c - r, c + r, c + r], outline=LINE, width=w)
    for (fx, fy, col) in ((-0.38, -0.3, BLUE), (0.25, -0.12, GREEN), (0.05, 0.36, BLUE), (0.42, 0.28, BLUE)):
        x, y = c + r * fx, c + r * fy
        dr = n * 0.045
        d.ellipse([x - dr - w, y - dr - w, x + dr + w, y + dr + w], fill=LINE)
        d.ellipse([x - dr, y - dr, x + dr, y + dr], fill=col)
    return img.resize((size, size), Image.LANCZOS)


for size in (180, 192, 512):
    render(size).save(ROOT / f"icon-{size}.png", optimize=True)
print("ok")
