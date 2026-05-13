"""One-off: render first page of series PDFs to assets/series/*.png"""
import os
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Install: pip install pymupdf", file=sys.stderr)
    sys.exit(1)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(BASE, "西子泵业资料")
OUT = os.path.join(BASE, "assets", "series")
os.makedirs(OUT, exist_ok=True)

JOBS = [
    ("西子污水提升器系列251203.pdf", "lift-series"),
    ("西子潜水轴混流泵系列260301.pdf", "axial-mixed-series"),
    ("Xizi Submersible Sewage Pump Series 251203.pdf", "wqa-series"),
]

def main():
    for fname, slug in JOBS:
        path = os.path.join(DOCS, fname)
        if not os.path.isfile(path):
            print("MISSING", path)
            continue
        doc = fitz.open(path)
        page = doc[0]
        # ~1200px wide for web cards (faster than 2x full render)
        zoom = min(1.35, 1200 / max(page.rect.width, 1))
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        outp = os.path.join(OUT, f"{slug}.png")
        pix.save(outp)
        doc.close()
        print("OK", outp, pix.width, "x", pix.height)

if __name__ == "__main__":
    main()
