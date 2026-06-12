"""Generate Snipboard Quick Upload extension icons.
Blue circle (#4285F4) with a white camera outline.
Requires Pillow: pip install Pillow
"""
import math
import os
from PIL import Image, ImageDraw

def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # ── Blue circle background ──
    margin = max(1, size // 16)
    draw.ellipse(
        [margin, margin, size - margin - 1, size - margin - 1],
        fill=(66, 133, 244, 255),
    )

    # ── White camera icon (scaled to ~65% of circle) ──
    cx, cy = size / 2, size / 2
    # Camera body rect
    bw = size * 0.60          # body width
    bh = size * 0.38          # body height
    bx1 = cx - bw / 2
    by1 = cy - bh / 2 + size * 0.04
    bx2 = cx + bw / 2
    by2 = cy + bh / 2 + size * 0.04
    lw = max(1, round(size / 22))

    # Rounded rect for camera body
    r = max(1, round(size / 14))
    draw.rounded_rectangle([bx1, by1, bx2, by2], radius=r,
                            outline=(255, 255, 255, 255), width=lw)

    # Lens (circle)
    lr = size * 0.135
    draw.ellipse(
        [cx - lr, cy + size * 0.04 - lr, cx + lr, cy + size * 0.04 + lr],
        outline=(255, 255, 255, 255), width=lw,
    )

    # Viewfinder bump on top-left of camera body
    bump_w = size * 0.16
    bump_h = size * 0.09
    bump_x1 = bx1 + size * 0.1
    bump_y1 = by1 - bump_h
    bump_x2 = bump_x1 + bump_w
    bump_y2 = by1 + lw * 0.5
    draw.rounded_rectangle([bump_x1, bump_y1, bump_x2, bump_y2],
                            radius=max(1, lw),
                            outline=(255, 255, 255, 255), width=lw)

    return img


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "icons")
    os.makedirs(out_dir, exist_ok=True)

    for size in (16, 48, 128):
        path = os.path.join(out_dir, f"icon{size}.png")
        img = draw_icon(size)
        img.save(path, "PNG", optimize=True)
        print(f"  Created {path}  ({size}×{size})")


if __name__ == "__main__":
    main()
