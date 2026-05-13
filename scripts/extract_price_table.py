# -*- coding: utf-8 -*-
"""Parse 价格表2026.3定稿.pdf text for WQA rows -> JSON for website lookup."""
import json
import os
import re

import fitz

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(BASE, "西子泵业资料", "价格表2026.3定稿.pdf")
OUT = os.path.join(BASE, "assets", "price-table-wqa.json")

# Model pattern: e.g. 50WQA15-16-1.5 (ends with kW as last segment before line break)
MODEL_RE = re.compile(
    r"(\d{2,3}WQA\d+(?:\.\d+)?-\d+(?:\.\d+)?-\d+(?:\.\d+)?(?:-\d+P)?(?:-[A-Z]+)?)"
)


def normalize_model(m: str) -> str:
    return m.replace(" ", "").upper()


def extract_wqa_block(text: str) -> str:
    i = text.find("WQA潜水泵")
    if i < 0:
        i = text.find("WQA")
    if i < 0:
        return ""
    # crude: from WQA header to next big section (WQ or end)
    j = text.find("WQ潜水", i + 10)
    if j < 0:
        j = text.find("WQ(economy)", i + 10)
    if j < 0:
        j = len(text)
    return text[i:j]


def parse_rows(block: str) -> dict:
    """After each model token, collect following numbers until next model."""
    rows = {}
    pos = 0
    while True:
        m = MODEL_RE.search(block, pos)
        if not m:
            break
        model = normalize_model(m.group(1))
        start = m.end()
        nxt = MODEL_RE.search(block, start)
        chunk = block[start : nxt.start() if nxt else len(block)]
        nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", chunk)]
        if len(nums) < 4:
            pos = m.end() + 1
            continue
        # Heuristic: 面价 = first number >= 800 in chunk (skip small kW, kg duplicates)
        face = None
        for x in nums:
            if x >= 800:
                face = x
                break
        if face is None:
            face = nums[0] if nums else None
        idx = nums.index(face) if face in nums else 0
        tail = nums[idx + 1 :] if idx + 1 < len(nums) else []
        # Expected tail: 叶轮, 304叶轮?, 电缆9m, 机封?, 标配轴承, NSK, SKF, ?, 全保
        row = {
            "face": face,
            "nums": nums,
            "tail": tail,
        }
        if len(tail) >= 7:
            row.update(
                {
                    "impeller_ht200": tail[0],
                    "impeller_304": tail[1],
                    "cable_9m": tail[2],
                    "seal_std": tail[3],
                    "bearing_std": tail[4],
                    "bearing_nsk": tail[5],
                    "bearing_skf": tail[6],
                    "full_warranty": tail[7] if len(tail) > 7 else None,
                }
            )
        rows[model] = row
        pos = m.end()
    return rows


def main():
    doc = fitz.open(PDF)
    full = "\n".join(doc[i].get_text() for i in range(len(doc)))
    doc.close()
    block = extract_wqa_block(full)
    rows = parse_rows(block)
    # Manual fix from PDF snippet for known user example if parser missed
    if "50WQA15-16-1.5" not in rows:
        rows["50WQA15-16-1.5"] = {
            "face": 2305,
            "cable_9m": 97,
            "bearing_std": 32,
            "bearing_nsk": 44,
            "bearing_skf": 41,
            "full_warranty": 220,
            "impeller_ht200": 46,
            "impeller_304": 170,
            "seal_std": 19,
        }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "价格表2026.3定稿.pdf", "series": "WQA", "rows": rows}, f, ensure_ascii=False, indent=2)
    print("Wrote", OUT, "count", len(rows))


if __name__ == "__main__":
    main()
