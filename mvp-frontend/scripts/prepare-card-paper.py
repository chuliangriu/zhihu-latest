"""Tint actual paper fibres from the approved avatar sheet; no invented wash."""
from pathlib import Path
from PIL import Image, ImageOps, ImageStat, ImageFilter

root = Path(__file__).resolve().parents[1]
source = root.parent.parent / '前端reference' / '头像2.jpg'
target = root / 'public' / 'paper-assets' / 'mika-peach-paper.png'

with Image.open(source) as sheet:
    # Empty paper above the portraits. Keep native pixels so the grain stays fine.
    paper = sheet.crop((10, 8, 725, 63)).convert('L')
    mean = ImageStat.Stat(paper).mean[0]
    softened = paper.filter(ImageFilter.GaussianBlur(2))
    tinted = Image.new('RGB', paper.size)
    base = (237, 219, 207)
    pixels = []
    for value, local in zip(paper.getdata(), softened.getdata()):
        variation = max(-24, min(15, (value - local) * 2.0 + (local - mean) * .45))
        pixels.append(tuple(round(channel + variation) for channel in base))
    tinted.putdata(pixels)
    # Mirror the boundaries for seamless repetition instead of enlarging the grain.
    tile = Image.new('RGB', (tinted.width * 2, tinted.height * 2))
    tile.paste(tinted, (0, 0))
    tile.paste(ImageOps.mirror(tinted), (tinted.width, 0))
    tile.paste(ImageOps.flip(tile.crop((0, 0, tile.width, tinted.height))), (0, tinted.height))
    tile.save(target, optimize=True)
    print(f'Prepared {target.name}: {tile.width}x{tile.height}, opaque RGB')
