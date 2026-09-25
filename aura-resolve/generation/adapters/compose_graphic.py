#!/usr/bin/env python3
"""Compose a non-person IFCDC branded plate from brand colors + optional existing logo."""
import json, os, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

GOLD = (201, 162, 39, 255)
BLACK = (11, 11, 11, 255)
IVORY = (245, 240, 230, 255)

def font(size):
    for path in (
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()

def load_logo(path, max_w, max_h):
    if not path or not os.path.exists(path):
        return None
    img = Image.open(path).convert("RGBA")
    img.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
    return img

def center_text(draw, box, text, fnt, fill=IVORY):
    x0, y0, x1, y1 = box
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((x0 + (x1 - x0 - tw) // 2, y0 + (y1 - y0 - th) // 2), text, font=fnt, fill=fill)

def main():
    req = json.load(sys.stdin)
    out = Path(req["outPath"])
    out.parent.mkdir(parents=True, exist_ok=True)
    w, h = int(req.get("width", 1080)), int(req.get("height", 1920))
    title = str(req.get("title") or "IFCDC")
    subtitle = str(req.get("subtitle") or "")
    credit = str(req.get("credit") or "IFCDC PRODUCTIONS")
    img = Image.new("RGBA", (w, h), BLACK)
    draw = ImageDraw.Draw(img)
    bar_h = max(8, h // 80)
    draw.rectangle((int(w * 0.12), int(h * 0.18), int(w * 0.88), int(h * 0.18) + bar_h), fill=GOLD)
    logo = load_logo(req.get("logoPath"), int(w * 0.42), int(h * 0.22))
    if logo:
        img.alpha_composite(logo, ((w - logo.width) // 2, int(h * 0.26)))
    center_text(draw, (0, int(h * 0.54), w, int(h * 0.64)), title, font(max(26, w // 18)), IVORY)
    if subtitle:
        center_text(draw, (0, int(h * 0.64), w, int(h * 0.72)), subtitle, font(max(18, w // 28)), GOLD)
    center_text(draw, (0, int(h * 0.84), w, int(h * 0.92)), credit, font(max(14, w // 34)), GOLD)
    img.convert("RGB").save(out, "PNG")
    print(json.dumps({"ok": True, "path": str(out), "bytes": out.stat().st_size}))

if __name__ == "__main__":
    main()
