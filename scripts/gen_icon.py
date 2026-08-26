import os, json
from PIL import Image, ImageDraw, ImageFont

OUT = "app-icon/AppIcon.appiconset"
os.makedirs(OUT, exist_ok=True)
S = 1024

# 对角渐变（深蓝 -> 品牌蓝）
base = Image.new("RGB", (S, S), (28, 43, 74))
top = Image.new("RGB", (S, S), (59, 91, 219))
mask = Image.new("L", (S, S))
md = mask.load()
for y in range(S):
    for x in range(S):
        md[x, y] = int(255 * (x + y) / (2 * S))
img = Image.composite(top, base, mask)

d = ImageDraw.Draw(img)
def rr(box, r, fill):
    d.rounded_rectangle(box, radius=r, fill=fill)

# 堆叠的白色知识卡片
rr([S*0.26, S*0.27, S*0.66, S*0.71], 46, (214, 224, 255))   # 后
rr([S*0.30, S*0.33, S*0.70, S*0.77], 46, (255, 255, 255))   # 中
rr([S*0.34, S*0.39, S*0.74, S*0.83], 46, (244, 248, 255))   # 前

# 中央「知」字
font = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", int(S * 0.33))
text = "知"
tb = d.textbbox((0, 0), text, font=font)
tw, th = tb[2] - tb[0], tb[3] - tb[1]
tx = (S - tw) / 2 - tb[0]
ty = (S - th) / 2 - tb[1]
d.text((tx, ty), text, font=font, fill=(28, 43, 74))

img.save(os.path.join(OUT, "AppIcon-512@2x.png"))  # 1024

sizes = {
    "AppIcon-20x20.png": 20, "AppIcon-20x20@2x.png": 40, "AppIcon-20x20@3x.png": 60,
    "AppIcon-29x29.png": 29, "AppIcon-29x29@2x.png": 58, "AppIcon-29x29@3x.png": 87,
    "AppIcon-40x40@2x.png": 80, "AppIcon-40x40@3x.png": 120,
    "AppIcon-57x57.png": 57, "AppIcon-57x57@2x.png": 114,
    "AppIcon-60x60@2x.png": 120, "AppIcon-60x60@3x.png": 180,
    "AppIcon-72x72.png": 72, "AppIcon-72x72@2x.png": 144,
    "AppIcon-76x76.png": 76, "AppIcon-76x76@2x.png": 152,
    "AppIcon-83.5x83.5@2x.png": 167,
}
for name, sz in sizes.items():
    img.resize((sz, sz), Image.LANCZOS).save(os.path.join(OUT, name))

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
images = [{"size": s, "scale": sc, "idiom": idm, "filename": fn} for fn, s, sc, idm in spec]
with open(os.path.join(OUT, "Contents.json"), "w", encoding="utf-8") as f:
    json.dump({"images": images, "info": {"version": 1, "author": "xcode"}}, f, ensure_ascii=False, indent=2)
print("icons generated:", len(images), "+ Contents.json")
