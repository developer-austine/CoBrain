"""
Minimal PDF writer — enough for a text document, with no dependencies.

reportlab/fpdf/weasyprint are not installed and adding one to render a single
document would be a heavier change than the document is worth. PDF's base-14
fonts (Helvetica, Courier) need no embedding, so a text report is a matter of
emitting objects, a content stream and an xref table.

Supports: H1/H2/H3, body text with word wrap, bullets, two-column rows, code
lines, rules, page breaks, and page numbers.
"""

from __future__ import annotations

# Helvetica advance widths (AFM units/1000) for printable ASCII. Wrapping with a
# fixed average width instead leaves lines visibly ragged or overflowing.
_W = {
    " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191,
    "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
    ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
    "[": 278, "\\": 278, "]": 278, "^": 469, "_": 556, "`": 333,
    "{": 334, "|": 260, "}": 334, "~": 584,
    "A": 667, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778, "H": 722,
    "I": 278, "J": 500, "K": 667, "L": 556, "M": 833, "N": 722, "O": 778, "P": 667,
    "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722, "V": 667, "W": 944, "X": 667,
    "Y": 667, "Z": 611,
    "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556, "h": 556,
    "i": 222, "j": 222, "k": 500, "l": 222, "m": 833, "n": 556, "o": 556, "p": 556,
    "q": 556, "r": 333, "s": 500, "t": 278, "u": 556, "v": 500, "w": 722, "x": 500,
    "y": 500, "z": 500,
}
for _d in "0123456789":
    _W[_d] = 556

A4_W, A4_H = 595.28, 841.89
MARGIN = 56.0
BOLD_FACTOR = 1.06  # Helvetica-Bold runs slightly wider than the table above


def _width(text: str, size: float, bold: bool = False, mono: bool = False) -> float:
    if mono:
        return len(text) * 600 / 1000 * size
    total = sum(_W.get(ch, 556) for ch in text) / 1000 * size
    return total * (BOLD_FACTOR if bold else 1.0)


def _wrap(text: str, size: float, max_w: float, bold=False, mono=False) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if cur and _width(trial, size, bold, mono) > max_w:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines or [""]


def _esc(text: str) -> str:
    # Latin-1 keeps the base-14 encoding valid; anything outside it is
    # transliterated rather than emitted as a byte the viewer would misread.
    subs = {"—": "-", "–": "-", "‘": "'", "’": "'",
            "“": '"', "”": '"', "→": "->", "·": "-",
            "…": "...", "✓": "y", "❌": "x", "⚠": "!"}
    for k, v in subs.items():
        text = text.replace(k, v)
    text = text.encode("latin-1", "replace").decode("latin-1")
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


class Pdf:
    def __init__(self, title: str = ""):
        self.pages: list[list[str]] = []
        self.ops: list[str] = []
        self.y = A4_H - MARGIN
        self.title = title
        self.max_w = A4_W - 2 * MARGIN

    # ── page handling ───────────────────────────────────────────────────────
    def _need(self, height: float) -> None:
        if self.y - height < MARGIN + 24:
            self.page_break()

    def page_break(self) -> None:
        if self.ops:
            self.pages.append(self.ops)
        self.ops = []
        self.y = A4_H - MARGIN

    # ── primitives ──────────────────────────────────────────────────────────
    def _text(self, s: str, x: float, size: float, font: str, gray: float = 0.0):
        self.ops.append(
            f"BT /{font} {size} Tf {gray} g {x} {self.y:.2f} Td ({_esc(s)}) Tj ET"
        )

    def h1(self, s: str):
        self._need(40)
        self.y -= 12
        self._text(s, MARGIN, 21, "FB")
        self.y -= 8
        self.rule()
        self.y -= 12

    def h2(self, s: str):
        self._need(34)
        self.y -= 16
        self._text(s, MARGIN, 14, "FB")
        self.y -= 16

    def h3(self, s: str):
        self._need(26)
        self.y -= 10
        self._text(s, MARGIN, 11, "FB", 0.15)
        self.y -= 14

    def body(self, s: str, gray: float = 0.15):
        for line in _wrap(s, 9.5, self.max_w):
            self._need(14)
            self._text(line, MARGIN, 9.5, "FR", gray)
            self.y -= 13
        self.y -= 3

    def bullet(self, s: str, indent: float = 0.0):
        x = MARGIN + indent
        lines = _wrap(s, 9.5, self.max_w - 16 - indent)
        for i, line in enumerate(lines):
            self._need(14)
            if i == 0:
                self._text("-", x, 9.5, "FR", 0.45)
            self._text(line, x + 14, 9.5, "FR", 0.15)
            self.y -= 13
        self.y -= 2

    def row(self, left: str, right: str, split: float = 0.42, bold_left=False):
        """Two columns; the right column wraps within its own width."""
        lw = self.max_w * split
        rw = self.max_w - lw - 10
        lls = _wrap(left, 9.5, lw, bold=bold_left)
        rls = _wrap(right, 9.5, rw)
        self._need(14 * max(len(lls), len(rls)))
        top = self.y
        for i, l in enumerate(lls):
            self.y = top - i * 12
            self._text(l, MARGIN, 9.5, "FB" if bold_left else "FR", 0.1)
        for i, r in enumerate(rls):
            self.y = top - i * 12
            self._text(r, MARGIN + lw + 10, 9.5, "FR", 0.25)
        self.y = top - 12 * max(len(lls), len(rls)) - 3

    def code(self, s: str):
        self._need(13)
        self._text(s, MARGIN + 8, 8.5, "FM", 0.3)
        self.y -= 12

    def rule(self, gray: float = 0.8):
        self._need(6)
        self.ops.append(
            f"{gray} G 0.6 w {MARGIN} {self.y:.2f} m {A4_W - MARGIN} {self.y:.2f} l S"
        )
        self.y -= 6

    def space(self, h: float = 8):
        self.y -= h

    # ── output ──────────────────────────────────────────────────────────────
    def save(self, path: str) -> int:
        if self.ops:
            self.pages.append(self.ops)

        total = len(self.pages)
        objects: list[bytes] = []

        def add(body: bytes) -> int:
            objects.append(body)
            return len(objects)  # 1-based object number

        font_r = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
        font_b = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
        font_m = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")

        # 3 fonts are already added; each page contributes a content object and
        # a page object, and the page tree is the next number after those.
        pages_obj_num = len(objects) + 2 * total + 1
        kids, page_nums = [], []

        for i, ops in enumerate(self.pages):
            footer = (
                f"BT /FR 8 Tf 0.55 g {A4_W - MARGIN - 60} {MARGIN - 14} Td "
                f"({i + 1} / {total}) Tj ET"
            )
            stream = ("\n".join(ops) + "\n" + footer).encode("latin-1", "replace")
            content_num = add(
                b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"
            )
            page_num = add(
                f"<< /Type /Page /Parent {pages_obj_num} 0 R /MediaBox [0 0 {A4_W:.2f} {A4_H:.2f}] "
                f"/Resources << /Font << /FR {font_r} 0 R /FB {font_b} 0 R /FM {font_m} 0 R >> >> "
                f"/Contents {content_num} 0 R >>".encode()
            )
            page_nums.append(page_num)
            kids.append(f"{page_num} 0 R")

        pages_num = add(
            f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {total} >>".encode()
        )
        assert pages_num == pages_obj_num, "page tree object number drifted"
        catalog = add(f"<< /Type /Catalog /Pages {pages_num} 0 R >>".encode())
        info = add(f"<< /Title ({_esc(self.title)}) /Producer (CoBrain docs) >>".encode())

        out = bytearray(b"%PDF-1.4\n")
        offsets = [0]
        for num, body in enumerate(objects, start=1):
            offsets.append(len(out))
            out += f"{num} 0 obj\n".encode() + body + b"\nendobj\n"

        xref_at = len(out)
        out += f"xref\n0 {len(objects) + 1}\n".encode()
        out += b"0000000000 65535 f \n"
        for off in offsets[1:]:
            out += f"{off:010d} 00000 n \n".encode()
        out += (
            f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R /Info {info} 0 R >>\n"
            f"startxref\n{xref_at}\n%%EOF\n"
        ).encode()

        with open(path, "wb") as f:
            f.write(out)
        return len(out)
