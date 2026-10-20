"""Make the title logo asset: outer black background -> transparency, trim, 640px-wide WebP.

Only black connected to the image edge is removed, so black inside the logo
(card faces, chip centre, outlines) stays opaque. Glows keep a soft edge.
Usage: python3 scripts/logo.py <source.png> src/assets/logo.webp
Needs Pillow and numpy.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, out = sys.argv[1:3]
im = Image.open(src).convert('RGB')
W, H = im.size
a = np.asarray(im).astype(np.float32) / 255
peak = a.max(axis=2)
dark = Image.fromarray(((peak < 0.10) * 255).astype(np.uint8)).copy()
fill = Image.new('L', (W, H))
fill.paste(dark)
for seed in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]:
    if fill.getpixel(seed) == 255:
        ImageDraw.floodfill(fill, seed, 128)
bg = np.array(fill) == 128
# Background pixels fade by brightness (keeps faint glow); everything else is opaque.
soft = np.clip((peak - 0.02) / 0.10, 0, 1)
alpha = np.where(bg, soft, 1.0)
alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))) / 255
img = Image.fromarray((np.dstack([a, alpha]) * 255).clip(0, 255).astype(np.uint8), 'RGBA')
img = img.crop(img.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox())
w = 640
img = img.resize((w, round(w * img.height / img.width)), Image.LANCZOS)
img.save(out, 'WEBP', quality=82, method=6)
print(img.size)
