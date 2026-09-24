#!/usr/bin/env python3
"""Compose IFCDC Productions templates from existing logos + approved brand colors.
Not a newly invented official logo — template package built from assets already on disk.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

GOLD = (201, 162, 39, 255)
BLACK = (11, 11, 11, 255)
IVORY = (245, 240, 230, 255)
GOLD_SOFT = (201, 162, 39, 220)


def font(size: int):
    candidates = [
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def load_logo(path: str | None, max_w: int, max_h: int):
    if not path or not os.path.exists(path):
        return None
    img = Image.open(path).convert("RGBA")
    img.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
    return img


def circle(size: int, fill=GOLD, ring=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((0, 0, size - 1, size - 1), fill=fill)
    if ring:
        inset = max(4, size // 18)
        draw.ellipse((inset, inset, size - 1 - inset, size - 1 - inset), outline=IVORY, width=max(2, size // 40))
    return img


def center_text(draw, box, text, fnt, fill=IVORY):
    x0, y0, x1, y1 = box
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = x0 + (x1 - x0 - tw) // 2
    y = y0 + (y1 - y0 - th) // 2
    draw.text((x, y), text, font=fnt, fill=fill)


def make_title_card(out: Path, logo_path: str | None, w: int, h: int, title: str, subtitle: str):
    img = Image.new("RGBA", (w, h), BLACK)
    draw = ImageDraw.Draw(img)
    # gold accent bar
    bar_h = max(8, h // 80)
    draw.rectangle((int(w * 0.12), int(h * 0.18), int(w * 0.88), int(h * 0.18) + bar_h), fill=GOLD)
    logo = load_logo(logo_path, int(w * 0.42), int(h * 0.22))
    if logo:
        img.alpha_composite(logo, ((w - logo.width) // 2, int(h * 0.28)))
    center_text(draw, (0, int(h * 0.55), w, int(h * 0.65)), title, font(max(28, w // 18)), IVORY)
    center_text(draw, (0, int(h * 0.66), w, int(h * 0.74)), subtitle, font(max(20, w // 28)), GOLD)
    center_text(draw, (0, int(h * 0.84), w, int(h * 0.92)), "IFCDC PRODUCTIONS", font(max(16, w // 32)), GOLD_SOFT)
    img.convert("RGB").save(out, "PNG")


def make_lower_third(out: Path, logo_path: str | None, w: int, h: int, line1: str, line2: str):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    bar_top = int(h * 0.78)
    draw.rectangle((int(w * 0.06), bar_top, int(w * 0.94), int(h * 0.92)), fill=(11, 11, 11, 210))
    draw.rectangle((int(w * 0.06), bar_top, int(w * 0.06) + max(6, w // 90), int(h * 0.92)), fill=GOLD)
    logo = load_logo(logo_path, int(w * 0.1), int(h * 0.08))
    text_x = int(w * 0.1)
    if logo:
        img.alpha_composite(logo, (int(w * 0.09), bar_top + (int(h * 0.14) - logo.height) // 2))
        text_x = int(w * 0.09) + logo.width + 16
    draw.text((text_x, bar_top + 10), line1, font=font(max(22, w // 28)), fill=IVORY)
    draw.text((text_x, bar_top + max(40, h // 28)), line2, font=font(max(16, w // 36)), fill=GOLD)
    img.save(out, "PNG")


def make_end_card(out: Path, logo_path: str | None, w: int, h: int):
    img = Image.new("RGBA", (w, h), BLACK)
    draw = ImageDraw.Draw(img)
    csize = min(w, h) // 3
    badge = circle(csize)
    logo = load_logo(logo_path, int(csize * 0.62), int(csize * 0.62))
    if logo:
        badge.alpha_composite(logo, ((csize - logo.width) // 2, (csize - logo.height) // 2))
    img.alpha_composite(badge, ((w - csize) // 2, int(h * 0.22)))
    center_text(draw, (0, int(h * 0.58), w, int(h * 0.68)), "AN IFCDC PRODUCTION", font(max(26, w // 20)), IVORY)
    center_text(draw, (0, int(h * 0.70), w, int(h * 0.78)), "IFCDC PRODUCTIONS", font(max(20, w // 26)), GOLD)
    center_text(draw, (0, int(h * 0.82), w, int(h * 0.90)), "@IFCDC", font(max(16, w // 32)), IVORY)
    img.convert("RGB").save(out, "PNG")


def make_cta_card(out: Path, logo_path: str | None, w: int, h: int, cta: str):
    img = Image.new("RGBA", (w, h), BLACK)
    draw = ImageDraw.Draw(img)
    draw.rectangle((int(w * 0.1), int(h * 0.42), int(w * 0.9), int(h * 0.58)), outline=GOLD, width=max(3, w // 200))
    logo = load_logo(logo_path, int(w * 0.28), int(h * 0.14))
    if logo:
        img.alpha_composite(logo, ((w - logo.width) // 2, int(h * 0.22)))
    center_text(draw, (0, int(h * 0.44), w, int(h * 0.56)), cta, font(max(22, w // 22)), IVORY)
    center_text(draw, (0, int(h * 0.72), w, int(h * 0.82)), "IFCDC PRODUCTIONS", font(max(16, w // 32)), GOLD)
    img.convert("RGB").save(out, "PNG")


def make_caption_plate(out: Path, w: int, h: int, lines: list[str]):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    y = int(h * 0.72)
    for line in lines[:3]:
        fnt = font(max(22, w // 24))
        bbox = draw.textbbox((0, 0), line, font=fnt)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pad_x, pad_y = 18, 10
        x = (w - tw) // 2
        draw.rectangle((x - pad_x, y - pad_y, x + tw + pad_x, y + th + pad_y), fill=(11, 11, 11, 180))
        draw.text((x, y), line, font=fnt, fill=IVORY)
        y += th + 28
    img.save(out, "PNG")


def make_gold_circle(out: Path, logo_path: str | None, size: int = 512):
    badge = circle(size)
    logo = load_logo(logo_path, int(size * 0.58), int(size * 0.58))
    if logo:
        badge.alpha_composite(logo, ((size - logo.width) // 2, (size - logo.height) // 2))
    badge.save(out, "PNG")


def main():
    cfg = json.loads(sys.stdin.read() or "{}")
    out_dir = Path(cfg["outDir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    logo = cfg.get("logoPath")
    formats = cfg.get("formats") or [{"width": 1080, "height": 1920, "label": "9x16"}]
    manifest = {"label": "IFCDC Productions template kit built from existing assets", "company": "IFCDC PRODUCTIONS", "items": []}

    gold = out_dir / "gold-circle-from-brand-colors.png"
    make_gold_circle(gold, logo)
    manifest["items"].append({"id": "gold-circle", "path": str(gold), "note": "Composed from brand gold/ivory + existing logo; not a new official mark"})

    for fmt in formats:
        w, h, label = int(fmt["width"]), int(fmt["height"]), fmt.get("label", f"{fmt['width']}x{fmt['height']}")
        suffix = label.replace(":", "x")
        title = out_dir / f"title-card-{suffix}.png"
        lower = out_dir / f"lower-third-{suffix}.png"
        end = out_dir / f"end-card-{suffix}.png"
        cta = out_dir / f"social-cta-{suffix}.png"
        caps = out_dir / f"caption-plate-{suffix}.png"
        make_title_card(title, logo, w, h, cfg.get("title", "IFCDC Barbers App"), cfg.get("subtitle", "Book your look"))
        make_lower_third(lower, logo, w, h, cfg.get("title", "IFCDC Barbers App"), "IFCDC PRODUCTIONS")
        make_end_card(end, logo, w, h)
        make_cta_card(cta, logo, w, h, cfg.get("cta", "Book in the IFCDC Barbers App"))
        make_caption_plate(caps, w, h, cfg.get("captions", ["IFCDC Barbers App", "Book today", "IFCDC PRODUCTIONS"]))
        for path, role in [
            (title, "title-card"),
            (lower, "lower-third"),
            (end, "end-card"),
            (cta, "social-cta"),
            (caps, "caption-plate"),
        ]:
            manifest["items"].append({"id": f"{role}-{suffix}", "role": role, "format": label, "path": str(path)})

    index = out_dir / "index.json"
    index.write_text(json.dumps(manifest, indent=2))
    print(json.dumps({"ok": True, "index": str(index), "manifest": manifest}))


if __name__ == "__main__":
    main()
