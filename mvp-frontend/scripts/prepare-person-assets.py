"""Crop additional Demo personas from the user's approved paper-avatar sheet."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
source = root.parent / "前端reference" / "头像2.jpg"
dest = root / "qiaomen" / "public" / "avatars"
dest.mkdir(parents=True, exist_ok=True)

# These are fixed cells in the supplied 735×1096 avatar sheet.
crops = {
    "paper-iris.png": (610, 18, 735, 183),
    "paper-theo.png": (495, 510, 620, 675),
    "paper-june.png": (140, 830, 265, 995),
}

with Image.open(source) as sheet:
    for filename, box in crops.items():
        portrait = sheet.crop(box).convert("RGB")
        portrait.save(dest / filename, optimize=True)
        print(f"Prepared {filename}: {portrait.size[0]}x{portrait.size[1]}")
