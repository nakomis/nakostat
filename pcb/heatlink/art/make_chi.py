# Chi's silkscreen portrait: art/chi.png (1-bit, white = silk on the black board).
#
# Source: Martin's photo of Chi curled up on the cat tree (IMG_0174.jpeg, 4032 x 3024, sent
# 30 Oct 2026). His outline comes from macOS Vision's subject lift, so nothing is hand-drawn:
#
#   swift art/liftsubject.swift <photo.jpeg> /tmp/chi_mask.png
#   python3 art/make_chi.py <photo.jpeg> /tmp/chi_mask.png art/chi.png
#
# Cropped to his head and shoulders (the lift leaves out the cat bed and the scratching post). Inside the
# outline, local contrast keeps what's darker than its surroundings (eye, nose, tabby stripes,
# fur streaks) as bare black board, as tinycrypt's Mu.
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageOps

photo_path, mask_path, out_path = sys.argv[1:4]
WIDTH = int(sys.argv[4]) if len(sys.argv) > 4 else 150   # pixels; build.py places them at 0.16 mm
K = int(sys.argv[5]) if len(sys.argv) > 5 else 16        # how much darker than the local average counts
CROP = (0, 500, 2200, 2300)    # head and shoulders (Martin chose this over the whole cat)
BLUR = 8                       # local-average radius, at 3x the final size

photo = ImageOps.autocontrast(Image.open(photo_path).convert("L").crop(CROP), cutoff=1)
mask = Image.open(mask_path).convert("L").crop(CROP)
height = round(photo.height * WIDTH / photo.width)

big = photo.resize((WIDTH * 3, height * 3), Image.LANCZOS)
lum = np.asarray(big).astype(float)
local = np.asarray(big.filter(ImageFilter.GaussianBlur(BLUR))).astype(float)
inside = np.asarray(mask.resize((WIDTH * 3, height * 3), Image.LANCZOS)) > 127
# An oval vignette, so the crop doesn't cut his fur off in straight lines at the sides.
yy, xx = np.mgrid[0:height * 3, 0:WIDTH * 3]
cx, cy, rx, ry = WIDTH * 1.5, height * 3 * 0.5, WIDTH * 1.5 * 0.97, height * 3 * 0.56
inside &= ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1

art = inside & ~(lum < local - K)
img = Image.fromarray((art * 255).astype(np.uint8)).resize((WIDTH, height), Image.LANCZOS)
img = img.point(lambda v: 255 if v > 127 else 0).filter(ImageFilter.MedianFilter(3))
img.point(lambda v: 255 if v > 127 else 0).convert("1").save(out_path)
print(f"{out_path}: {WIDTH} x {height} px")
