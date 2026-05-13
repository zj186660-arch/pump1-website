/**
 * WQA 选型（启发式）：基于《价格表》中全部 WQA 型号的铭牌 Q-H-P，
 * 结合《西子潜水排污泵系列 260302》P23–P27 曲线图的工程含义（工况点在曲线下方为可用）
 * 用简化「能力包络 + 贴合度」排序；**最终以样本曲线与销售复核为准**。
 */
(function () {
  "use strict";

  var INCH_TO_DN = {
    "1": 25,
    "1.25": 32,
    "1.5": 40,
    "2": 50,
    "2.5": 65,
    "3": 80,
    "4": 100,
    "5": 125,
    "6": 150,
    "8": 200,
    "10": 250,
    "12": 300
  };

  function getWqaRows() {
    var d = window.__XIZI_PRICE_DATA__ || {};
    return d.wqa || {};
  }

  function parseWqaModel(model) {
    var s = String(model || "")
      .replace(/\s+/g, "")
      .toUpperCase();
    var m = s.match(/^(\d{2,3})WQA(\d+)-(\d+)-(\d+(?:\.\d+)?)(?:-(\d+P))?(?:-(.+))?$/);
    if (!m) return null;
    return {
      key: m[1] + "WQA" + m[2] + "-" + m[3] + "-" + m[4],
      dn: Number(m[1]),
      Q: Number(m[2]),
      H: Number(m[3]),
      P: Number(m[4])
    };
  }

  function buildCatalog() {
    var rows = getWqaRows();
    var list = [];
    Object.keys(rows).forEach(function (k) {
      var p = parseWqaModel(k);
      if (p) list.push(p);
    });
    return list;
  }

  function parseOutletToDn(str) {
    if (!str || !String(str).trim()) return null;
    var s = String(str).trim().toUpperCase().replace(/\s+/g, "");
    var m = s.match(/^DN(\d{2,3})$/);
    if (m) return Number(m[1]);
    m = s.match(/^(\d{2,3})$/);
    if (m) return Number(m[1]);
    m = s.match(/^(\d+(?:\.\d+)?)\s*(INCH|"|寸|IN)?$/);
    if (m) {
      var inch = m[1];
      var dn = INCH_TO_DN[inch];
      if (dn) return dn;
    }
    m = s.match(/^(\d+(?:\.\d+)?)\s*英寸$/);
    if (m && INCH_TO_DN[m[1]]) return INCH_TO_DN[m[1]];
    return null;
  }

  function parseFlowToM3h(val, unit) {
    var v = Number(val);
    if (!isFinite(v) || v < 0) return null;
    var u = (unit || "m3h").toLowerCase();
    if (u === "m3h" || u === "m³/h") return v;
    if (u === "ls" || u === "l/s") return v * 3.6;
    if (u === "lmin" || u === "l/min") return v * 0.06;
    if (u === "m3min" || u === "m³/min") return v * 60;
    if (u === "m3s" || u === "m³/s") return v * 3600;
    if (u === "gpm") return v * 0.227124;
    return v;
  }

  function hpToKw(hp) {
    return hp * 0.746;
  }

  function parsePowerToKw(val, unit) {
    if (val === "" || val == null) return null;
    var v = Number(val);
    if (!isFinite(v) || v < 0) return null;
    var u = (unit || "kw").toLowerCase();
    if (u === "hp") return hpToKw(v);
    return v;
  }

  /** 口径过滤：DN80/100 联合图时 80 与 100 互通 */
  function dnMatchesFilter(pumpDn, filterDn) {
    if (filterDn == null) return true;
    if (pumpDn === filterDn) return true;
    if ((filterDn === 80 || filterDn === 100) && (pumpDn === 80 || pumpDn === 100)) return true;
    return false;
  }

  /**
   * 贴合度：铭牌能力 (Qn*Hn) 与需求 (Qc*Hc) 的比值接近 1.05~1.35 为佳；
   * 同时允许略低于 1 的边界候选（靠近曲线尾端），由销售筛除。
   */
  function scoreCandidate(p, Qc, Hc, Pc) {
    var needQ = Qc != null && Qc > 0;
    var needH = Hc != null && Hc > 0;
    var cap = p.Q * p.H;
    var need = (needQ ? Qc : p.Q) * (needH ? Hc : p.H);
    if (needQ && needH) {
      if (cap < need * 0.55) return { ok: false, reason: "能力包络偏低" };
    } else if (needQ && p.Q < Qc * 0.88) return { ok: false, reason: "流量裕量不足" };
    else if (needH && p.H < Hc * 0.88) return { ok: false, reason: "扬程裕量不足" };

    if (Pc != null && Pc > 0 && p.P < Pc * 0.82) return { ok: false, reason: "电机功率偏小" };

    var ratio = need > 0 ? cap / need : 1;
    var fit = Math.abs(Math.log(Math.max(ratio, 0.35)));
    var tailPenalty = 0;
    if (needQ && needH && ratio < 0.92) tailPenalty += 0.35;
    if (needQ && needH && ratio > 2.2) tailPenalty += 0.25;
    if (needQ && p.Q < Qc * 1.02) tailPenalty += 0.08;
    if (needH && p.H < Hc * 1.02) tailPenalty += 0.08;

    return { ok: true, score: fit + tailPenalty, ratio: ratio };
  }

  function curvePageHint(dn) {
    if (dn === 65) return "对照《西子潜水排污泵系列 260302》约 **P23**（DN65，50Hz WQA 曲线）";
    if (dn === 80 || dn === 100) return "对照该样本约 **P24–P25**（DN80 / DN100 同页多曲线，请结合图例区分）";
    if (dn === 50) return "对照该样本 **DN50** 附近页（与 2″ 口径一致）";
    if (dn === 150) return "对照该样本 **DN150** 章节页";
    return "对照《西子潜水排污泵系列 260302》**WQA 50Hz 性能曲线**章节（P23–P27 一带，以当期印刷版为准）";
  }

  function runSelection() {
    var outEl = document.getElementById("wqaSelectResults");
    if (!outEl) return;

    var cat = buildCatalog();
    if (!cat.length) {
      outEl.innerHTML = "<p>未加载价格表数据，请确认已引入 <code>assets/price-data.js</code>。</p>";
      return;
    }

    var dnFilter = parseOutletToDn(document.getElementById("selOutlet") && document.getElementById("selOutlet").value);
    var Qc = parseFlowToM3h(
      document.getElementById("selQ") && document.getElementById("selQ").value,
      document.getElementById("selQUnit") && document.getElementById("selQUnit").value
    );
    var Hc = Number(document.getElementById("selH") && document.getElementById("selH").value);
    if (!isFinite(Hc) || Hc < 0) Hc = null;

    var Pc = parsePowerToKw(
      document.getElementById("selP") && document.getElementById("selP").value,
      document.getElementById("selPUnit") && document.getElementById("selPUnit").value
    );

    var hasQ = Qc != null && Qc > 0;
    var hasH = Hc != null && Hc > 0;
    var hasP = Pc != null && Pc > 0;
    if (!hasQ && !hasH && !hasP) {
      outEl.innerHTML =
        "<p>请至少填写<strong>流量</strong>、<strong>扬程</strong>或<strong>功率</strong>之一（可多填），再点击筛选。</p>";
      return;
    }

    var candidates = [];
    cat.forEach(function (p) {
      if (!dnMatchesFilter(p.dn, dnFilter)) return;
      var sc = scoreCandidate(p, Qc, Hc, Pc);
      if (!sc.ok) return;
      candidates.push({ p: p, score: sc.score, ratio: sc.ratio });
    });

    candidates.sort(function (a, b) {
      return a.score - b.score;
    });

    var maxShow = 28;
    var slice = candidates.slice(0, maxShow);

    var hint = "";
    if (dnFilter) hint += "<p><strong>口径提示：</strong>" + curvePageHint(dnFilter) + "</p>";
    hint +=
      "<p class=\"hint\" style=\"margin-top:8px;\">以下为<strong>启发式排序</strong>：优先列出「能力裕量适中」的型号；" +
      "若工况点须严格落在某条曲线之下，请以《西子潜水排污泵系列 260302》<strong>P23–P27</strong> 原图复核，并在销售指导下定案。" +
      "后续 WQE 等系列可用同一套思路扩展。</p>";

    if (!slice.length) {
      outEl.innerHTML = hint + "<p><strong>无匹配候选</strong>，请放宽口径或检查流量/扬程单位。</p>";
      return;
    }

    var rows = slice
      .map(function (c, i) {
        var p = c.p;
        var tag =
          i === 0
            ? "<span style=\"color:#0d7df2;font-weight:700;\">优先参考</span>"
            : c.ratio >= 0.92 && c.ratio <= 1.45
            ? "较贴合"
            : c.ratio < 0.92
            ? "裕量偏紧（复核曲线尾端）"
            : "裕量偏大（注意是否过剩）";
        return (
          "<tr><td>" +
          (i + 1) +
          "</td><td><button type=\"button\" class=\"link-model\" data-m=\"" +
          p.key +
          "\">" +
          p.key +
          "</button></td><td>DN" +
          p.dn +
          "</td><td>" +
          p.Q +
          "</td><td>" +
          p.H +
          "</td><td>" +
          p.P +
          "</td><td>" +
          (c.ratio ? c.ratio.toFixed(2) : "—") +
          "</td><td>" +
          tag +
          "</td></tr>"
        );
      })
      .join("");

    outEl.innerHTML =
      hint +
      "<div style=\"overflow-x:auto;margin-top:12px;\"><table class=\"decode-table\"><thead><tr>" +
      "<th>#</th><th>型号</th><th>口径</th><th>Qn m³/h</th><th>Hn m</th><th>kW</th><th>能力比*</th><th>说明</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      "<p style=\"font-size:12px;color:#5b6678;margin-top:8px;\">*能力比 ≈ (Qn×Hn)/(Qc×Hc)，无 Q 或 H 输入时该列仅供参考。</p>";

    outEl.querySelectorAll(".link-model").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var m = btn.getAttribute("data-m");
        if (typeof window.XIZI_fillQuoteModel === "function") window.XIZI_fillQuoteModel(m);
      });
    });
  }

  function init() {
    var btn = document.getElementById("wqaSelectRun");
    if (btn) btn.addEventListener("click", runSelection);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
