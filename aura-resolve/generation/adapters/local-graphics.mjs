/**
 * Local NON-PERSON graphics adapter — title cards / branded plates from
 * existing brand colors + staged logos. Does NOT invent official logos.
 * Does NOT synthesize faces or voices.
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { stageBrandKit, pickAssets, BRAND_COLORS } from "../../brand/kit.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "compose_graphic.py");

function ensureComposeScript() {
  if (existsSync(SCRIPT)) return;
  const py = `#!/usr/bin/env python3
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
`;
  writeFileSync(SCRIPT, py);
}

export const localGraphicsAdapter = {
  id: "local-graphics",
  configured: true,
  capabilities: ["graphics_title_graphics"],
  describe() {
    return {
      id: "local-graphics",
      configured: true,
      kind: "local-pillow",
      personSynthesis: false,
      inventsLogos: false,
      note: "Non-person title cards / branded plates from existing colors + staged logos only.",
    };
  },
  async generate(capability, request = {}) {
    if (capability !== "graphics_title_graphics") {
      return { ok: false, status: "NOT_CONFIGURED", reason: `local-graphics does not support ${capability}` };
    }
    ensureComposeScript();
    const brand = stageBrandKit({ intoMedia: true });
    const logos = pickAssets(brand, ["logo"]);
    const logoPath = logos[0]?.mediaPath || logos[0]?.source || null;
    const outDir = request.outDir;
    if (!outDir) {
      return { ok: false, status: "FAILED", reason: "outDir required" };
    }
    mkdirSync(outDir, { recursive: true });
    const name = request.fileName || `generated-title-${Date.now().toString(36)}.png`;
    const outPath = join(outDir, name);
    const payload = {
      outPath,
      logoPath,
      width: request.width || 1080,
      height: request.height || 1920,
      title: request.title || "IFCDC",
      subtitle: request.subtitle || "",
      credit: request.credit || "IFCDC PRODUCTIONS",
      colors: BRAND_COLORS,
    };
    const result = spawnSync("python3", [SCRIPT], {
      encoding: "utf8",
      input: JSON.stringify(payload),
    });
    if (result.status !== 0) {
      return {
        ok: false,
        status: "FAILED",
        reason: (result.stderr || result.stdout || "compose failed").slice(-400),
      };
    }
    if (!existsSync(outPath)) {
      return { ok: false, status: "FAILED", reason: "compose did not write file" };
    }
    return {
      ok: true,
      status: "GENERATED",
      file: name,
      path: outPath,
      kind: "non_person_title_graphic",
      usedExistingLogo: Boolean(logoPath),
      inventsOfficialLogo: false,
      personSynthesis: false,
    };
  },
};

export const localMusicStageAdapter = {
  id: "local-music-stage",
  configured: true,
  capabilities: ["music_sound_integration"],
  describe() {
    return {
      id: "local-music-stage",
      configured: true,
      kind: "stage-existing",
      note: "Stages already-approved IFCDC music / test tone. Does not generate new music.",
    };
  },
  async generate(_capability, request = {}) {
    const brand = stageBrandKit({ intoMedia: true });
    const music =
      (brand.staged || []).find((item) => item.role === "music") ||
      (brand.staged || []).find((item) => item.role === "music-fallback");
    if (!music?.mediaPath && !music?.source) {
      return {
        ok: false,
        status: "NOT_CONFIGURED",
        reason: "No approved IFCDC music bed or test tone found on disk",
        blocker: "MISSING_FOUNDER_SOURCE:approved_music_bed",
      };
    }
    return {
      ok: true,
      status: "REUSED_APPROVED",
      file: music.mediaName || null,
      path: music.mediaPath || music.source,
      kind: "approved_music_stage",
      generated: false,
    };
  },
};
