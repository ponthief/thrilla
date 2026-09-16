#!/usr/bin/env python3
"""Generate every WhiSPa icon the apps need, from the one master artwork.

    python3 brand/make-icons.py

Outputs
-------
  public/icon.png              512  web app in-page logo (transparent corners)
  public/favicon.png            64  browser tab
  public/apple-touch-icon.png  180  iOS home screen (full-bleed, see below)
  src/assets/icon.png          512  React Native in-app logo
  android .../ic_launcher.png         legacy launcher, 5 densities
  android .../ic_launcher_round.png   legacy round launcher, 5 densities
  android .../ic_launcher_foreground  adaptive foreground, 5 densities
  ios .../AppIcon.appiconset/*.png    every size Contents.json asks for

One artwork everywhere
----------------------
Every icon is the WhiSPa lockup as drawn — mascot, coin and wordmark. Nothing is
cropped out of it. What changes per target is only how much of the canvas it
fills, so that no launcher mask can cut through the wordmark.

Corners
-------
Cut by flood-filling the near-white that is CONNECTED TO A CORNER, never by
assuming a radius — so the white inside the wordmark and the mascot's hood
survives. Where a platform masks the icon itself (iOS, and Android's adaptive
icon) the art is delivered full-bleed instead, because those platforms render
transparency as white or as a hole.
"""

import json
import pathlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTER = ROOT / "brand" / "whispa_wallet.png"

# Android adaptive icons are a 108dp canvas of which only the middle 72dp is
# guaranteed visible; anything outside a 66dp circle can be masked away. These
# are the 108dp canvas in px at each density.
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
# How much of each canvas the lockup fills.
#   Adaptive foreground: 66/108 is the safe *circle*, so at this size no launcher
#   shape can clip the wordmark, whatever mask it applies.
#   Round legacy icon: 1/sqrt(2) would fit the whole square inside the circle;
#   0.72 is slightly larger, which only pushes the art's own black corners past
#   the edge and never the artwork.
ADAPTIVE_FILL = 66 / 108
ROUND_FILL = 0.72


def load_card():
    """The master with its white outer corners turned transparent, cropped
    square to the card, plus the card's own background colour."""
    src = Image.open(MASTER).convert("RGB")
    w, h = src.size
    sp = src.load()

    flags = Image.new("L", (w, h), 0)
    fp = flags.load()
    for y in range(h):
        for x in range(w):
            r, g, b = sp[x, y]
            if r > 232 and g > 232 and b > 232:
                fp[x, y] = 255
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if fp[corner] == 255:
            ImageDraw.floodfill(flags, corner, 128, thresh=0)

    alpha = Image.new("L", (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if fp[x, y] == 128:
                ap[x, y] = 0

    card = src.copy()
    card.putalpha(alpha)
    card = card.crop(alpha.getbbox())
    side = max(card.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(card, ((side - card.width) // 2, (side - card.height) // 2))
    # Background colour, sampled well inside the card and away from the art.
    bg = square.convert("RGB").getpixel((int(side * 0.04), int(side * 0.5)))
    return square, bg


def flat(img, bg):
    """Composite onto the card's own background — for platforms that mask."""
    out = Image.new("RGBA", img.size, bg + (255,))
    out.alpha_composite(img)
    return out.convert("RGB")


def circle(img):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, img.width - 1, img.height - 1), fill=255)
    out = img.convert("RGBA").copy()
    out.putalpha(mask)
    return out


def save(img, path, size, mode="RGBA"):
    path.parent.mkdir(parents=True, exist_ok=True)
    im = img.resize((size, size), Image.LANCZOS)
    im.convert(mode).save(path)


def main():
    card, bg = load_card()
    hexbg = f"#{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}"
    print(f"card {card.size}, background {hexbg}")

    # ── web app ──────────────────────────────────────────────────────────────
    save(card, ROOT / "public" / "icon.png", 512)
    save(card, ROOT / "public" / "favicon.png", 64)
    save(flat(card, bg), ROOT / "public" / "apple-touch-icon.png", 180, "RGB")

    # ── React Native in-app logo ─────────────────────────────────────────────
    save(card, ROOT / "src" / "assets" / "icon.png", 512)

    # ── Android ──────────────────────────────────────────────────────────────
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    card_flat = flat(card, bg)

    def inset(size, fraction, fill):
        """The lockup centred on a `size` canvas, filling `fraction` of it."""
        art = int(round(size * fraction))
        canvas = Image.new("RGBA", (size, size), fill)
        canvas.alpha_composite(
            card_flat.convert("RGBA").resize((art, art), Image.LANCZOS),
            dest=((size - art) // 2, (size - art) // 2),
        )
        return canvas

    for dens, size in LEGACY.items():
        # Full-bleed: the art's own corners are this same black, so a launcher
        # that masks it sees one solid square, not a square inside a square.
        save(card_flat, res / f"mipmap-{dens}" / "ic_launcher.png", size, "RGB")
        save(circle(inset(size * 4, ROUND_FILL, bg + (255,))),
             res / f"mipmap-{dens}" / "ic_launcher_round.png", size)
    for dens, size in ADAPTIVE.items():
        # Transparent background: the background layer supplies the black, and
        # it is set to this exact colour in colors.xml so the two never seam.
        p = res / f"mipmap-{dens}" / "ic_launcher_foreground.png"
        p.parent.mkdir(parents=True, exist_ok=True)
        inset(size, ADAPTIVE_FILL, (0, 0, 0, 0)).save(p)

    # Keep the adaptive background exactly equal to the artwork's own black.
    colors = res / "values" / "colors.xml"
    text = colors.read_text(encoding="utf-8")
    import re as _re
    text = _re.sub(r'(<color name="ic_launcher_background">)#[0-9A-Fa-f]{6,8}(</color>)',
                   rf'\g<1>{hexbg}\g<2>', text)
    colors.write_text(text, encoding="utf-8")
    print(f"android: {len(LEGACY)} densities x (launcher, round, adaptive fg); "
          f"ic_launcher_background set to {hexbg}")

    # ── iOS ──────────────────────────────────────────────────────────────────
    appicon = ROOT / "ios" / "Thrilla" / "Images.xcassets" / "AppIcon.appiconset"
    contents = json.loads((appicon / "Contents.json").read_text())
    for entry in contents["images"]:
        pt = float(entry["size"].split("x")[0])
        scale = int(entry["scale"].rstrip("x"))
        px = int(round(pt * scale))
        name = f"AppIcon-{px}.png"
        save(flat(card, bg), appicon / name, px, "RGB")  # iOS masks; alpha would show white
        entry["filename"] = name
    (appicon / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")
    print(f"ios: {len(contents['images'])} sizes written and wired into Contents.json")


if __name__ == "__main__":
    main()
