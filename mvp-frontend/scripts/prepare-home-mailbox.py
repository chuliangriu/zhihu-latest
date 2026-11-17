"""Crop the approved mailbox and remove only its surrounding paper background."""
from collections import deque
from pathlib import Path
from statistics import median
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parents[1]
source = root.parent / "前端设计" / "看山新icon" / "看——信箱.png"
target = root / "public" / "paper-assets" / "home-mailbox.png"

with Image.open(source) as sheet:
    if sheet.size != (1536, 1024):
        raise ValueError("Reference dimensions changed; recheck the approved crop bounds.")
    # Include the paper scraps and mailbox label; exclude adjacent text and footer.
    cropped = sheet.crop((62, 716, 344, 907)).convert("RGB")
    width, height = cropped.size
    pixels = cropped.load()
    border = [(x, y) for y in range(height) for x in range(width)
              if x in (0, width - 1) or y in (0, height - 1)]
    paper = tuple(median(pixels[x, y][channel] for x, y in border)
                  for channel in range(3))
    # Only clear similar pixels connected to the outside. Pale areas inside
    # the envelope and label stay opaque, as do the attached paper scraps.
    background = set()
    pending = deque(border)
    visited = set(border)
    while pending:
        x, y = pending.popleft()
        if sum((value - base) ** 2 for value, base in zip(pixels[x, y], paper)) > 18 ** 2:
            continue
        background.add((x, y))
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in visited:
                visited.add((nx, ny))
                pending.append((nx, ny))
    alpha = Image.new("L", cropped.size, 255)
    for point in background:
        alpha.putpixel(point, 0)
    # Subpixel softening retains the illustration's natural paper edges.
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.45))
    cropped = cropped.convert("RGBA")
    cropped.putalpha(alpha)
    cropped.save(target, optimize=True)
    print(f"Prepared {target.name}: {width}x{height}, RGBA, {len(background)} background pixels removed")
