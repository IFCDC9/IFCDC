#!/usr/bin/env python3
"""Compose reusable IFCDC PRODUCTIONS identity cards from existing logos + approved colors.
Still cards only — animated logo treatment is NOT yet rendered.
These are available when template/Founder asks; not auto-burned onto every frame.
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


def center_text(draw, box, text, fnt, fill=IVORY):
    x0, y0, x1, y1 = box
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = x0 + (x1 - x0 - tw) // 2
    y = y0 + (y1 - y0 - th) // 2
    draw.text((x, y), text, font=fnt, fill=fill)


def circle(size: int, fill=GOLD, ring=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((0, 0, size - 1, size - 1), fill=fill)
    if ring:
        inset = max(4, size // 18)
        draw.ellipse((inset, inset, size - 1 - inset, size - 1 - inset), outline=IVORY, width=max(2, size // 40))
    return img


def make_opening_card(out: Path, logo_path: str | None, w: int, h: int, company: str, presents: str):
    """Opening production card: IFCDC PRODUCTIONS / presents"""
    img = Image.new("RGBA", (w, h), BLACK)
    draw = ImageDraw.Draw(img)
    bar_h = max(6, h // 100)
    draw.rectangle((int(w * 0.18), int(h * 0.42), int(w * 0.82), int(h * 0.42) + bar_h), fill=GOLD)
    logo = load_logo(logo_path, int(w * 0.28), int(h * 0.14))
    if logo:
        img.alpha_composite(logo, ((w - logo.width) // 2, int(h * 0.22)))
    center_text(draw, (0, int(h * 0.48), w, int(h * 0.58)), company, font(max(28, w // 16)), IVORY)
    center_text(draw, (0, int(h * 0.58), w, int(h * 0.66)), presents, font(max(18, w // 28)), GOLD)
    img.convert("RGB").save(out, "PNG")


def make_closing_card(out: Path, logo_path: str | None, w: int, h: int, credit: str, company: str):
    """Closing production card: AN IFCDC PRODUCTION"""
    img = Image.new("RGBA", (w, h), BLACK)
    draw = ImageDraw.Draw(img)
    csize = min(w, h) // 4
    badge = circle(csize)
    logo = load_logo(logo_path, int(csize * 0.62), int(csize * 0.62))
    if logo:
        badge.alpha_composite(logo, ((csize - logo.width) // 2, (csize - logo.height) // 2))
    img.alpha_composite(badge, ((w - csize) // 2, int(h * 0.28)))
    center_text(draw, (0, int(h * 0.58), w, int(h * 0.68)), credit, font(max(26, w // 18)), IVORY)
    center_text(draw, (0, int(h * 0.70), w, int(h * 0.78)), company, font(max(18, w // 28)), GOLD)
    img.convert("RGB").save(out, "PNG")


def make_credits_treatment(out: Path, logo_path: str | None, w: int, h: int, company: str, credit: str):
    """Credits roll treatment — available, not auto-burned."""
    img = Image.new("RGBA", (w, h), BLACK)
    draw = ImageDraw.Draw(img)
    logo = load_logo(logo_path, int(w * 0.18), int(h * 0.1))
    if logo:
        img.alpha_composite(logo, ((w - logo.width) // 2, int(h * 0.18)))
    center_text(draw, (0, int(h * 0.36), w, int(h * 0.44)), "PRODUCTION", font(max(14, w // 36)), GOLD)
    center_text(draw, (0, int(h * 0.44), w, int(h * 0.54)), company, font(max(24, w // 20)), IVORY)
    center_text(draw, (0, int(h * 0.58), w, int(h * 0.66)), credit, font(max(18, w // 26)), GOLD_SOFT)
    img.convert("RGB").save(out, "PNG")


def make_lower_third(out: Path, logo_path: str | None, w: int, h: int, company: str, credit: str):
    """Lower-third available but not auto-burned onto every frame."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    bar_top = int(h * 0.80)
    draw.rectangle((int(w * 0.06), bar_top, int(w * 0.72), int(h * 0.94)), fill=(11, 11, 11, 210))
    draw.rectangle((int(w * 0.06), bar_top, int(w * 0.06) + max(6, w // 90), int(h * 0.94)), fill=GOLD)
    logo = load_logo(logo_path, int(w * 0.08), int(h * 0.06))
    text_x = int(w * 0.1)
    if logo:
        img.alpha_composite(logo, (int(w * 0.09), bar_top + (int(h * 0.14) - logo.height) // 2))
        text_x = int(w * 0.09) + logo.width + 14
    draw.text((text_x, bar_top + 8), company, font=font(max(18, w // 32)), fill=IVORY)
    draw.text((text_x, bar_top + max(34, h // 32)), credit, font=font(max(14, w // 40)), fill=GOLD)
    img.save(out, "PNG")


def main():
    cfg = json.loads(sys.stdin.read() or "{}")
    out_dir = Path(cfg["outDir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    logo = cfg.get("logoPath")
    company = cfg.get("company", "IFCDC PRODUCTIONS")
    credit = cfg.get("credit", "AN IFCDC PRODUCTION")
    presents = cfg.get("presents", "presents")
    formats = cfg.get("formats") or [{"width": 1080, "height": 1920, "label": "9:16"}]
    manifest = {
        "label": "IFCDC PRODUCTIONS identity card kit (still)",
        "company": company,
        "credit": credit,
        "animationStatus": "NOT_YET_RENDERED",
        "autoBurnFrames": False,
        "items": [],
    }

    for fmt in formats:
        w, h, label = int(fmt["width"]), int(fmt["height"]), fmt.get("label", f"{fmt['width']}x{fmt['height']}")
        suffix = label.replace(":", "x")
        opening = out_dir / f"opening-production-card-{suffix}.png"
        closing = out_dir / f"closing-production-card-{suffix}.png"
        credits = out_dir / f"credits-treatment-{suffix}.png"
        lower = out_dir / f"production-lower-third-{suffix}.png"
        make_opening_card(opening, logo, w, h, company, presents)
        make_closing_card(closing, logo, w, h, credit, company)
        make_credits_treatment(credits, logo, w, h, company, credit)
        make_lower_third(lower, logo, w, h, company, credit)
        for path, role in [
            (opening, "opening-production-card"),
            (closing, "closing-production-card"),
            (credits, "credits-treatment"),
            (lower, "production-lower-third"),
        ]:
            manifest["items"].append({"id": f"{role}-{suffix}", "role": role, "format": label, "path": str(path)})

    index = out_dir / "index.json"
    index.write_text(json.dumps(manifest, indent=2))
    print(json.dumps({"ok": True, "index": str(index), "manifest": manifest}))


if __name__ == "__main__":
    main()
