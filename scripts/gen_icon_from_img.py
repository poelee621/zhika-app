import os, json, glob, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 取最新的生图原图
raws = sorted(glob.glob(os.path.join(ROOT, "assets", "logo_raw", "*.png")),
              key=lambda p: os.path.getmtime(p))
if not raws:
    sys.exit("找不到 assets/logo_raw/*.png")
src = raws[-1]
print("SRC:", src)

img = Image.open(src).convert("RGB")
w, h = img.size
m = min(w, h)
if w != h:
    img = img.crop(((w - m) // 2, (h - m) // 2, (w + m) // 2, (h + m) // 2))
img = img.resize((1024, 1024), Image.LANCZOS)

OUT1 = os.path.join(ROOT, "app-icon", "AppIcon.appiconset")
OUT2 = os.path.join(ROOT, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset")
os.makedirs(OUT1, exist_ok=True)
os.makedirs(OUT2, exist_ok=True)

sizes = {
    "AppIcon-20x20.png": 20, "AppIcon-20x20@2x.png": 40, "AppIcon-20x20@3x.png": 60,
    "AppIcon-29x29.png": 29, "AppIcon-29x29@2x.png": 58, "AppIcon-29x29@3x.png": 87,
    "AppIcon-40x40@2x.png": 80, "AppIcon-40x40@3x.png": 120,
    "AppIcon-57x57.png": 57, "AppIcon-57x57@2x.png": 114,
    "AppIcon-60x60@2x.png": 120, "AppIcon-60x60@3x.png": 180,
    "AppIcon-72x72.png": 72, "AppIcon-72x72@2x.png": 144,
    "AppIcon-76x76.png": 76, "AppIcon-76x76@2x.png": 152,
    "AppIcon-83.5x83.5@2x.png": 167,
    "AppIcon-512@2x.png": 1024,
}

for name, sz in sizes.items():
    img.resize((sz, sz), Image.LANCZOS).save(os.path.join(OUT1, name))
    img.resize((sz, sz), Image.LANCZOS).save(os.path.join(OUT2, name))
print("全套尺寸已写入 app-icon 与 ios/Assets 两套")

spec = [
    ("AppIcon-20x20.png", "20x20", "1x", "iphone"),
    ("AppIcon-20x20@2x.png", "20x20", "2x", "iphone"),
    ("AppIcon-20x20@3x.png", "20x20", "3x", "iphone"),
    ("AppIcon-29x29.png", "29x29", "1x", "iphone"),
    ("AppIcon-29x29@2x.png", "29x29", "2x", "iphone"),
    ("AppIcon-29x29@3x.png", "29x29", "3x", "iphone"),
    ("AppIcon-40x40@2x.png", "40x40", "2x", "iphone"),
    ("AppIcon-40x40@3x.png", "40x40", "3x", "iphone"),
    ("AppIcon-57x57.png", "57x57", "1x", "iphone"),
    ("AppIcon-57x57@2x.png", "57x57", "2x", "iphone"),
    ("AppIcon-60x60@2x.png", "60x60", "2x", "iphone"),
    ("AppIcon-60x60@3x.png", "60x60", "3x", "iphone"),
    ("AppIcon-72x72.png", "72x72", "1x", "ipad"),
    ("AppIcon-72x72@2x.png", "72x72", "2x", "ipad"),
    ("AppIcon-76x76.png", "76x76", "1x", "ipad"),
    ("AppIcon-76x76@2x.png", "76x76", "2x", "ipad"),
    ("AppIcon-83.5x83.5@2x.png", "83.5x83.5", "2x", "ipad"),
    ("AppIcon-512@2x.png", "512x512", "2x", "ios-marketing"),
]
images = [{"size": s, "scale": sc, "idiom": idm, "filename": fn}
          for fn, s, sc, idm in spec]
cj = {"images": images, "info": {"version": 1, "author": "xcode"}}
for d in (OUT1, OUT2):
    with open(os.path.join(d, "Contents.json"), "w", encoding="utf-8") as f:
        json.dump(cj, f, ensure_ascii=False, indent=2)

# fastlane deliver 用 app_icon.png（1024 主图）
for d in ("fastlane/metadata/zh-Hans", "fastlane/metadata"):
    os.makedirs(os.path.join(ROOT, d), exist_ok=True)
    img.save(os.path.join(ROOT, d, "app_icon.png"))
print("app_icon.png 已写入 fastlane metadata")
print("DONE")
