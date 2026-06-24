"""Generate JobPulse brand assets: favicons, apple touch icon, and OG share card.

Run:  python assets/make_brand.py
No external rasterizer needed (Pillow only).
"""
from PIL import Image, ImageDraw, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# Brand palette (matches styles.css)
DARK = (32, 51, 53)        # #203335
TEAL = (20, 108, 95)       # #146c5f
GOLD = (240, 195, 106)     # #f0c36a
CREAM = (245, 251, 248)    # #f5fbf8
MUTED = (184, 202, 200)    # #b8cac8


def rounded(size, radius):
    """Return an L-mode rounded-rectangle mask of the given size."""
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return mask


def draw_mark(px):
    """Draw the square app icon at `px` resolution. Briefcase + pulse line."""
    scale = 4                      # supersample for crisp edges
    S = px * scale
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Rounded teal tile background
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=TEAL)

    # --- Briefcase (gold) ---
    bw, bh = int(S * 0.56), int(S * 0.40)
    bx = (S - bw) // 2
    by = int(S * 0.40)
    # handle
    hw, hh = int(bw * 0.34), int(S * 0.12)
    hx = (S - hw) // 2
    d.rounded_rectangle(
        [hx, by - hh + int(S * 0.03), hx + hw, by + int(S * 0.05)],
        radius=int(hh * 0.5), outline=GOLD, width=int(S * 0.035),
    )
    # body
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=int(S * 0.05), fill=GOLD)

    # --- Pulse line (dark) across the briefcase ---
    cy = by + bh // 2
    w = max(2, int(S * 0.028))
    x0, x1 = bx + int(bw * 0.06), bx + int(bw * 0.94)
    pts = [
        (x0, cy),
        (x0 + int(bw * 0.22), cy),
        (x0 + int(bw * 0.34), cy - int(bh * 0.30)),
        (x0 + int(bw * 0.48), cy + int(bh * 0.34)),
        (x0 + int(bw * 0.60), cy),
        (x1, cy),
    ]
    d.line(pts, fill=DARK, width=w, joint="curve")

    return img.resize((px, px), Image.LANCZOS)


def load_font(size, bold=True):
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def make_og():
    """1200x630 social share card."""
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), DARK)
    d = ImageDraw.Draw(img)

    # subtle vertical gradient
    for y in range(H):
        t = y / H
        r = int(DARK[0] + (24 - DARK[0]) * t)
        g = int(DARK[1] + (40 - DARK[1]) * t)
        b = int(DARK[2] + (42 - DARK[2]) * t)
        d.line([(0, y), (W, y)], fill=(r, g, b))

    # accent bar
    d.rectangle([0, 0, W, 10], fill=GOLD)

    # logo mark
    mark = draw_mark(190)
    img.paste(mark, (90, 150), mark)

    # wordmark + tagline
    fb = load_font(96, bold=True)
    fm = load_font(40, bold=False)
    fs = load_font(34, bold=True)
    d.text((320, 175), "JobPulse", font=fb, fill=CREAM)
    d.text((322, 300), "Fresh roles every morning,", font=fm, fill=MUTED)
    d.text((322, 352), "ATS-ready resumes & cover letters.", font=fm, fill=MUTED)

    # chip row
    chips = ["Daily matches", "ATS resume", "Cover letter"]
    x = 322
    for c in chips:
        tw = d.textlength(c, font=fs)
        d.rounded_rectangle([x, 440, x + tw + 44, 498], radius=29, fill=TEAL)
        d.text((x + 22, 452), c, font=fs, fill=CREAM)
        x += tw + 44 + 18

    img.save(os.path.join(HERE, "og-image.png"), "PNG")


def main():
    # PNG favicons + apple touch
    for px, name in [(16, "favicon-16.png"), (32, "favicon-32.png"),
                     (180, "apple-touch-icon.png"), (512, "icon-512.png")]:
        draw_mark(px).save(os.path.join(HERE, name), "PNG")

    # multi-size .ico
    ico = draw_mark(64)
    ico.save(os.path.join(HERE, "favicon.ico"),
             sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

    make_og()
    print("Brand assets written to", HERE)


if __name__ == "__main__":
    main()
