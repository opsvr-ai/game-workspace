"""生成两个客户端的托盘图标（老板 2026-10-15：右下角两个驴图标长得一模一样，分不清谁是谁）。

- 陪玩端（companion）= 绿色圆角方块 + 白驴 + 右下角「▶」
- 客服端（cs）      = 蓝色圆角方块 + 白驴 + 右下角「对话气泡」

白驴的轮廓取自现有 `apps/companion-electron/public/donkey.png` 的 alpha 通道（保住品牌形状）。
**为什么不做「白底 + 彩色驴」**：托盘里只显示 16×16，原来的照片式渲染缩下去就是一坨灰，
细细的腿和描边会直接糊掉；整块品牌色 + 白色剪影在 16×16 下依然分得清，
而「颜色」是这个尺寸下最大面积、最靠得住的线索。

用法（仓库根目录）：python scripts/_make_tray_icons.py
生成：apps/companion-electron/public/tray-companion.png、apps/cs-electron/public/tray-cs.png
"""

import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "apps", "companion-electron", "public", "donkey.png")

COMPANION_GREEN = (0x1F, 0xA0, 0x5A, 0xFF)
CS_BLUE = (0x1E, 0x6F, 0xD9, 0xFF)

CANVAS = 512
DONKEY_BOX = 330          # 白驴在方块里的边长（右下角要给小图形让位）
DONKEY_AT = (26, 58)      # 白驴的左上角
GLYPH_BOX = 130           # 右下角小白图形的边长
GLYPH_AT = (352, 352)
THICKEN = 15              # 先把剪影加粗一点：照片里那几条细腿缩到 16×16 会直接断掉


def donkey_mask() -> Image.Image:
    """驴的剪影：alpha > 中值就算实体，再轻微模糊一下保住 antialias 的边。"""
    src = Image.open(SOURCE).convert("RGBA")
    alpha = src.split()[3].resize((DONKEY_BOX, DONKEY_BOX), Image.LANCZOS)
    mask = alpha.point(lambda v: 255 if v >= 140 else 0)
    # 先粗后细：膨胀把腿加粗、再收回来一点保住圆角，最后轻微模糊留 antialias 的边。
    mask = mask.filter(ImageFilter.MaxFilter(THICKEN))
    mask = mask.filter(ImageFilter.MinFilter(THICKEN - 6))
    return mask.filter(ImageFilter.GaussianBlur(1.0))


def glyph_play(size: int) -> Image.Image:
    """▶ 播放三角：陪玩端的徽章（点开就能上机接单）。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = size * 0.26
    d.polygon(
        [(pad, pad * 0.72), (size - pad * 0.82, size / 2), (pad, size - pad * 0.72)],
        fill=(255, 255, 255, 255),
    )
    return img


def glyph_chat(size: int) -> Image.Image:
    """对话气泡：客服端的徽章（客服就是靠这个跟人说话）。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = size * 0.18
    box = [pad, pad * 1.15, size - pad, size - pad * 1.9]
    d.rounded_rectangle(box, radius=size * 0.2, fill=(255, 255, 255, 255))
    d.polygon(
        [
            (size * 0.32, box[3] - size * 0.03),
            (size * 0.30, size - pad * 0.65),
            (size * 0.50, box[3] - size * 0.03),
        ],
        fill=(255, 255, 255, 255),
    )
    return img


def build(color, glyph: str, out_path: str) -> str:
    """做一张「品牌色圆角方块 + 白色驴 + 右下角白色小图形」的托盘图。

    为什么不做「白底 + 彩色驴」：托盘里只显示 16×16，细腿、描边那种细节会糊成一坨。
    整块色 + 白色剪影在 16×16 下依然分得清，颜色又是最大面积的那个线索
    —— 老板要的就是「一眼能分出哪个是陪玩、哪个是客服」。
    """
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle([0, 0, CANVAS - 1, CANVAS - 1], radius=int(CANVAS * 0.22), fill=color)

    mask = donkey_mask()
    donkey = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    donkey.paste(Image.new("RGBA", mask.size, (255, 255, 255, 255)), DONKEY_AT, mask)
    canvas.alpha_composite(donkey)

    glyph_img = glyph_play(GLYPH_BOX) if glyph == "play" else glyph_chat(GLYPH_BOX)
    canvas.alpha_composite(glyph_img, (GLYPH_AT[0], GLYPH_AT[1]))

    canvas = canvas.resize((256, 256), Image.LANCZOS)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    canvas.save(out_path)
    return out_path


if __name__ == "__main__":
    targets = [
        (COMPANION_GREEN, "play", os.path.join(ROOT, "apps", "companion-electron", "public", "tray-companion.png")),
        (CS_BLUE, "chat", os.path.join(ROOT, "apps", "cs-electron", "public", "tray-cs.png")),
    ]
    for color, glyph, out in targets:
        print("写出:", build(color, glyph, out))
