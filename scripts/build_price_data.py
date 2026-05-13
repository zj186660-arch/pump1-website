# -*- coding: utf-8 -*-
"""Build assets/price-data.js from 价格表2026.3定稿.pdf (PyMuPDF tables)."""
import json
import os
import re

import fitz

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(BASE, "西子泵业资料", "价格表2026.3定稿.pdf")
OUT_JS = os.path.join(BASE, "assets", "price-data.js")


def norm_model(s: str) -> str:
    s = str(s).replace("\n", "").strip().upper()
    s = re.sub(r"\s+", "", s)
    return s


def to_float(x):
    if x is None or x == "/" or x == "":
        return None
    try:
        return float(str(x).replace(",", ""))
    except ValueError:
        return None


def parse_wqa_tables(doc) -> dict:
    out = {}
    for pi in range(len(doc)):
        tabs = doc[pi].find_tables()
        for tab in tabs.tables:
            rows = tab.extract()
            for row in rows:
                if not row or len(row) < 10:
                    continue
                m = row[1]
                if not m or not isinstance(m, str) or "WQA" not in m or "-" not in m:
                    continue
                model = norm_model(m)
                if not re.match(r"^\d{2,3}WQA", model):
                    continue
                cells = list(row)
                # Standard WQA economy sheet: face at index 7
                face = to_float(cells[7]) if len(cells) > 7 else None
                if face is None or face < 500:
                    # wider sheets: first large number after col 6
                    for i in range(7, min(len(cells), 22)):
                        v = to_float(cells[i])
                        if v and v >= 1000:
                            face = v
                            break
                if face is None or face < 500:
                    continue
                rec = {
                    "face": face,
                    "impeller_ht200": to_float(cells[8]) if len(cells) > 8 else None,
                    "impeller_304": to_float(cells[9]) if len(cells) > 9 else None,
                    "cable_9m": to_float(cells[10]) if len(cells) > 10 else None,
                    "seal_std": to_float(cells[11]) if len(cells) > 11 else None,
                    "bearing_std": to_float(cells[12]) if len(cells) > 12 else None,
                    "bearing_nsk": to_float(cells[13]) if len(cells) > 13 else None,
                    "bearing_skf": to_float(cells[14]) if len(cells) > 14 else None,
                    "full_warranty": to_float(cells[15]) if len(cells) > 15 else None,
                }
                out[model] = rec
    return out


def parse_coupling_oh(doc) -> dict:
    """OH (HT200) 轻型耦合面价 by 口径 mm — 与 PDF 第 25 页表格一致（解析失败时使用内置表）."""
    fallback = {
        "40": 530,
        "50": 750,
        "65": 980,
        "80": 1350,
        "100": 1820,
        "150": 3980,
        "200": 5160,
        "250": 7980,
        "300": 11260,
        "350": 15280,
        "400": 18950,
        "500": 28200,
        "600": 42380,
    }
    prices = {}
    # scan paired header row: DN row 40,50,65... then price row with 530,750...
    for pi in range(len(doc)):
        tabs = doc[pi].find_tables()
        for tab in tabs.tables:
            rows = tab.extract()
            for ri, row in enumerate(rows):
                if not row or len(row) < 8:
                    continue
                if row[2] == "40" and row[3] == "50" and row[4] == "65":
                    pr_row = None
                    for r2 in rows[ri + 1 : ri + 5]:
                        if not r2 or len(r2) < 8:
                            continue
                        if to_float(r2[2]) == 530 and to_float(r2[3]) == 750:
                            pr_row = r2
                            break
                    if pr_row:
                        for i in range(2, len(row)):
                            dn = row[i]
                            pv = to_float(pr_row[i]) if i < len(pr_row) else None
                            if dn and str(dn).isdigit() and pv:
                                prices[str(int(float(str(dn))))] = pv
                    break
    if len(prices) < 5:
        prices = dict(fallback)
    return {
        "OH_HT200_light_face": prices,
        "note": "OH(HT200) 轻型耦合表列面价；网页计价：耦合按表列面价×0.5加入总价。",
    }


def main():
    doc = fitz.open(PDF)
    wqa = parse_wqa_tables(doc)
    coup = parse_coupling_oh(doc)
    doc.close()
    payload = {
        "meta": {
            "source": "价格表2026.3定稿.pdf",
            "pumpDiscount": 0.55,
            "couplingHeavyHalf": 0.5,
            "couplingListHalf": 0.5,
            "couplingDiscount": 0.55,
            "fobFactor": 1.05,
            "hz60Factor": 1.1,
            "voltAdaptFactor": 1.1,
            "usdRateDefault": 6.8,
        },
        "wqa": wqa,
        "coupling": coup,
    }
    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("window.__XIZI_PRICE_DATA__ = ")
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write(";\n")
    print("Wrote", OUT_JS, "WQA models", len(wqa), "coupling DN keys", len(coup.get("OH_HT200_light_face", {})))


if __name__ == "__main__":
    main()
