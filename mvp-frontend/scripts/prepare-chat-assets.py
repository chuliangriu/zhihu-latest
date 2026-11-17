"""Prepare an unchanged official mascot frame and a subtle local grain tile."""
from pathlib import Path
import random
from PIL import Image

root = Path(__file__).resolve().parents[1]
dest = root / 'public' / 'chat-assets'
dest.mkdir(exist_ok=True)
source = root.parent / '刘看山_IP' / '刘看山动态' / '待机_5秒_320x320_20fps_透明.gif'
with Image.open(source) as gif:
    frame = gif.convert('RGBA')
    bounds = frame.getbbox()
    if bounds:
        frame = frame.crop(bounds)
    frame.thumbnail((160, 160), Image.Resampling.LANCZOS)
    frame.save(dest / 'kanshan-official.png')
random.seed(18)
grain = Image.new('RGBA', (128, 128))
grain.putdata([(0, 0, 0, random.randrange(0, 22)) for _ in range(128 * 128)])
grain.save(dest / 'grain.png')
