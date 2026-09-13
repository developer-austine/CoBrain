"""
Build the favicon set from public/CoBrain_Logo.ico.

Why this exists rather than a one-off image editor export: the source icon is a
single 256x256 uncompressed BMP (270 KB). A favicon is the first request a
browser makes and it is drawn at 16 or 32 px in the tab, so shipping it as-is
costs a quarter-megabyte to render a thumbnail the browser has to downscale
itself — which is what makes a logo look muddy in the tab specifically.

This produces one .ico carrying 16/32/48 as BMP (tiny, universally understood)
plus 256 as PNG (compressed), and a 180 px apple-icon.

Pure stdlib: struct for the container formats, zlib for PNG. Adding Pillow or
sharp to the dependency tree to resize four images would be the larger cost.

    python scripts/build-icons.py
"""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "CoBrain_Logo.ico"

# 16/32/48 cover the tab, the bookmark bar and Windows' larger list views;
# Google's search results want a square icon and pick the largest available.
ICO_SIZES = (16, 32, 48, 256)
APPLE_SIZE = 180


# ─── decode ──────────────────────────────────────────────────────────────────

def read_largest_entry(path: Path):
    """Return (width, height, RGBA bytes) for the biggest image in an .ico."""
    data = path.read_bytes()
    _, _, count = struct.unpack_from("<HHH", data, 0)

    best = None
    for i in range(count):
        w, h, _, _, _, _, size, offset = struct.unpack_from("<BBBBHHII", data, 6 + i * 16)
        w = w or 256
        h = h or 256
        if best is None or w * h > best[0] * best[1]:
            best = (w, h, offset, size)

    w, h, offset, size = best
    payload = data[offset : offset + size]

    if payload.startswith(b"\x89PNG"):
        raise SystemExit(
            "Source icon is PNG-compressed; this script decodes the BMP form only."
        )
    return w, h, decode_dib(payload, w, h)


def decode_dib(payload: bytes, width: int, height: int) -> bytearray:
    """32bpp BOTTOMUP BGRA DIB -> top-down RGBA."""
    header_size = struct.unpack_from("<I", payload, 0)[0]
    bpp = struct.unpack_from("<H", payload, 14)[0]
    if bpp != 32:
        raise SystemExit(f"Expected a 32bpp source, got {bpp}bpp.")

    pixels = payload[header_size:]
    out = bytearray(width * height * 4)
    stride = width * 4

    for y in range(height):
        # DIB rows run bottom-up; flip while copying.
        src = (height - 1 - y) * stride
        for x in range(width):
            b, g, r, a = pixels[src + x * 4 : src + x * 4 + 4]
            dst = (y * width + x) * 4
            out[dst : dst + 4] = bytes((r, g, b, a))
    return out


# ─── resize ──────────────────────────────────────────────────────────────────

def resize(src: bytearray, sw: int, sh: int, dw: int, dh: int) -> bytearray:
    """
    Area-average downscale.

    Nearest-neighbour would drop most of the source pixels, which on a mark with
    fine strokes reads as a broken shape at 16 px. Averaging every source pixel
    that falls inside the destination pixel keeps the strokes visible.

    Alpha is premultiplied during the average, otherwise transparent pixels
    contribute their (arbitrary) colour and the edges pick up a dark halo.
    """
    out = bytearray(dw * dh * 4)
    for dy in range(dh):
        y0, y1 = dy * sh // dh, max(dy * sh // dh + 1, (dy + 1) * sh // dh)
        for dx in range(dw):
            x0, x1 = dx * sw // dw, max(dx * sw // dw + 1, (dx + 1) * sw // dw)

            r = g = b = a = n = 0
            for y in range(y0, y1):
                row = y * sw
                for x in range(x0, x1):
                    i = (row + x) * 4
                    pa = src[i + 3]
                    r += src[i] * pa
                    g += src[i + 1] * pa
                    b += src[i + 2] * pa
                    a += pa
                    n += 1

            di = (dy * dw + dx) * 4
            if a:
                out[di] = min(255, r // a)
                out[di + 1] = min(255, g // a)
                out[di + 2] = min(255, b // a)
                out[di + 3] = a // n
            # else: fully transparent, leave the zeros
    return out


# ─── encode ──────────────────────────────────────────────────────────────────

def png_bytes(rgba: bytearray, w: int, h: int) -> bytes:
    """Minimal RGBA PNG, filter type 0 on every scanline."""
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgba[y * w * 4 : (y + 1) * w * 4]

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def dib_bytes(rgba: bytearray, w: int, h: int) -> bytes:
    """32bpp bottom-up DIB plus the AND mask an .ico entry requires."""
    header = struct.pack(
        "<IiiHHIIiiII",
        40, w, h * 2,  # doubled height: colour bitmap + mask, per the ICO spec
        1, 32, 0, w * h * 4, 0, 0, 0, 0,
    )

    body = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            i = (y * w + x) * 4
            r, g, b, a = rgba[i : i + 4]
            body += bytes((b, g, r, a))

    # Fully opaque AND mask; the alpha channel above does the real work. Rows
    # are padded to 4 bytes.
    mask_stride = ((w + 31) // 32) * 4
    body += bytes(mask_stride * h)

    return header + bytes(body)


def build_ico(images: list[tuple[int, bytes, bool]]) -> bytes:
    """images: (size, payload, is_png), smallest first."""
    out = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)

    for size, payload, _ in images:
        dim = 0 if size >= 256 else size
        out += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(payload), offset)
        offset += len(payload)

    return out + b"".join(p for _, p, _ in images)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source icon: {SOURCE}")

    sw, sh, src = read_largest_entry(SOURCE)
    print(f"source: {sw}x{sh} from {SOURCE.name}")

    entries = []
    for size in ICO_SIZES:
        scaled = src if size == sw else resize(src, sw, sh, size, size)
        # PNG only for 256: below that the container overhead outweighs the
        # compression, and some older Windows shells will not read a PNG entry.
        payload = png_bytes(scaled, size, size) if size >= 256 else dib_bytes(scaled, size, size)
        entries.append((size, payload, size >= 256))
        print(f"  {size:>3}x{size:<3} {'PNG' if size >= 256 else 'BMP'} {len(payload):>8,}B")

    ico = build_ico(entries)
    (ROOT / "app" / "favicon.ico").write_bytes(ico)
    print(f"\napp/favicon.ico  {len(ico):,}B  ({SOURCE.stat().st_size:,}B source)")

    apple = png_bytes(resize(src, sw, sh, APPLE_SIZE, APPLE_SIZE), APPLE_SIZE, APPLE_SIZE)
    (ROOT / "app" / "apple-icon.png").write_bytes(apple)
    print(f"app/apple-icon.png  {len(apple):,}B")


if __name__ == "__main__":
    main()
