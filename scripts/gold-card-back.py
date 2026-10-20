"""Make the card back asset: gold outer frame, transparent rounded corners, 240px WebP.

Usage: python3 scripts/gold-card-back.py <source.png> src/assets/card-back.webp <preview.png>
Needs Pillow and numpy.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
src, out_webp, out_png = sys.argv[1:4]
im = Image.open(src).convert('RGB')
W, H = im.size
a = np.asarray(im).astype(np.float32)
R = 42
# Outer frame = light region connected to the image edge (inner ornaments are separated by red).
light = ((a.min(axis=2) > 150) * 255).astype(np.uint8)
corner = Image.new('L', (W, H), 255)
ImageDraw.Draw(corner).rounded_rectangle([0, 0, W - 1, H - 1], radius=R, fill=0)
light = np.maximum(light, np.asarray(corner)).copy()
fill = Image.new('L', (W, H))
fill.paste(Image.fromarray(light))
ImageDraw.floodfill(fill, (1, H // 2), 128)
frame = np.array(fill) == 128
frame = np.array(Image.fromarray((frame * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
# Metallic gold along the diagonal.
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
k = 0.5 + 0.5 * np.sin((xx / W * 0.6 + yy / H * 0.4) * np.pi * 4)
lg = np.array([250, 226, 150], np.float32)
dg = np.array([176, 126, 38], np.float32)
gold = dg + (lg - dg) * k[..., None]
w = np.clip((a[..., 1] - 3) / 247, 0, 1)[..., None]  # whiteness: red ≈ 3, white ≈ 250 in G
out = np.where(frame[..., None], gold * w + a * (1 - w), a)
img = Image.fromarray(out.clip(0, 255).astype(np.uint8)).convert('RGBA')
mask = Image.new('L', (W, H), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=R, fill=255)
img.putalpha(mask)
img.save(out_png)
img.resize((240, round(240 * H / W)), Image.LANCZOS).save(out_webp, 'WEBP', quality=88, method=6)
print('frame px', int(frame.sum()), 'of', W * H)
