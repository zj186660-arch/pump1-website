/**
 * WQA 选型：在缺少数字化曲线时，用铭牌 Qn、Hn 构造**保守** Q–H 折线包络，
 * 要求工况 (Qd,Hd) 落在包络「下方」（Hd ≤ 包络在 Qd 处的扬程），且 Qd 不得超过包络在横轴上的有效范围
 *（禁止把曲线外推超过合理延伸）。排序优先「刚好盖住、裕量适中」，其次才是明显大裕量机型。
 * 最终以《西子潜水排污泵系列 260302》P23–P27 原图与销售复核为准。
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

  /** 铭牌流量外，曲线在横轴上允许延伸的上限系数（小流量档延伸比例略大，大流量档更保守，避免 100WQA60 盖住 120） */
  function flowSpanFactor(Qn) {
    if (!isFinite(Qn) || Qn <= 0) return 1.2;
    return 1.35 + 30 / (Qn + 20);
  }

  function maxFlowOnCurve(Qn) {
    return Qn * flowSpanFactor(Qn);
  }

  /**
   * 保守折线：Q≤Qn 段关阀至铭牌；Q>Qn 至 Qmax 段用 **t^1.35** 凸曲线下降（刚过 Qn 时扬程下降更缓），
   * 避免把「流量略高于铭牌」的可用点误判为未盖住；末端仍收至 Hn×hEndRatio。
   */
  function headOnCurve(Qn, Hn, Qd, Qmax, hEndRatio) {
    if (!isFinite(Qn) || Qn <= 0 || !isFinite(Hn) || Hn <= 0) return 0;
    if (!isFinite(Qd) || Qd < 0) return Hn * 1.35;
    if (Qd > Qmax) return -1;
    var hShut = Hn * 1.32;
    if (Qd <= Qn) {
      var hLinear = hShut + (Hn - hShut) * (Qd / Qn);
      var hNear = Hn * (1 + 0.72 * Math.max(0, 1 - Qd / Qn));
      hNear = Math.min(Hn * 1.35, hNear);
      return Math.max(hLinear, hNear);
    }
    var hEnd = Hn * hEndRatio;
    var span = Qmax - Qn;
    if (span <= 1e-6) return Hn;
    var t = (Qd - Qn) / span;
    if (t < 0) t = 0;
    if (t > 1) return -1;
    /** 凸曲线：刚过 Qn 时扬程下降较缓，避免把「Q 略高于铭牌」的可用点误判为未盖住（如 200WQA550-32-75 与 600,30） */
    var curveT = Math.pow(t, 1.35);
    return Hn + (hEnd - Hn) * curveT;
  }

  function getWqaRows() {
    var d = window.__XIZI_PRICE_DATA__ || {};
    return d.wqa || {};
  }

  /** 价格表 wqa 对象引用不变时复用目录，避免每次筛选全表扫描 */
  var catalogCacheRef = null;
  var catalogCacheList = null;

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
    if (catalogCacheRef === rows && catalogCacheList) return catalogCacheList;
    var list = [];
    Object.keys(rows).forEach(function (k) {
      var p = parseWqaModel(k);
      if (p) list.push(p);
    });
    catalogCacheRef = rows;
    catalogCacheList = list;
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

  function dnMatchesFilter(pumpDn, filterDn) {
    if (filterDn == null) return true;
    if (pumpDn === filterDn) return true;
    if ((filterDn === 80 || filterDn === 100) && (pumpDn === 80 || pumpDn === 100)) return true;
    return false;
  }

  function evaluateCover(p, Qd, Hc, Pc, relax) {
    var hasQ = Qd != null && Qd > 0;
    var hasH = Hc != null && Hc > 0;
    var hasP = Pc != null && Pc > 0;

    if (hasP && p.P + 1e-6 < Pc * 0.97) {
      return { ok: false, reason: "铭牌功率低于需求" };
    }

    if (!hasQ && !hasH) {
      if (!hasP) return { ok: false, reason: "—" };
      return {
        ok: true,
        tier: 1,
        hAt: null,
        qMax: null,
        headMargin: null,
        flowMargin: null,
        tightScore: Math.abs(Math.log((p.P + 0.4) / (Pc + 0.4)))
      };
    }

    if (hasQ && !hasH) {
      var qMax0 = maxFlowOnCurve(p.Q);
      if (Qd > qMax0 + 1e-6) {
        return { ok: false, reason: "需求流量超出曲线合理延伸" };
      }
      return {
        ok: true,
        tier: 1,
        hAt: null,
        qMax: qMax0,
        headMargin: null,
        flowMargin: qMax0 - Qd,
        tightScore: (qMax0 - Qd) / Math.max(Qd, 1)
      };
    }

    if (!hasQ && hasH) {
      if (Hc > p.H * 1.28 + 1e-6) return { ok: false, reason: "需求扬程高于铭牌关阀近似上限" };
      return {
        ok: true,
        tier: 1,
        hAt: p.H * 1.28,
        qMax: maxFlowOnCurve(p.Q),
        headMargin: p.H * 1.28 - Hc,
        flowMargin: null,
        tightScore: (p.H * 1.28 - Hc) / Math.max(Hc, 0.5)
      };
    }

    var qMax = maxFlowOnCurve(p.Q);
    if (Qd > qMax + 1e-6) {
      return { ok: false, reason: "Qd 超出该型号曲线横轴合理范围" };
    }

    var hEnd = relax ? 0.6 : 0.54;
    var hAt = headOnCurve(p.Q, p.H, Qd, qMax, hEnd);
    if (hAt < 0 || !isFinite(hAt)) return { ok: false, reason: "包络计算异常" };

    var eps = relax ? 0.06 : 0.02;
    if (Hc > hAt + eps) {
      return { ok: false, reason: "工况点在保守包络之上（未盖住）" };
    }

    var headMargin = hAt - Hc;
    var flowMargin = qMax - Qd;
    var cap = p.Q * p.H;
    var need = Qd * Hc;
    var oversize = cap / Math.max(need, 1e-6);
    var marginNorm =
      (headMargin / Math.max(Hc, 0.5)) * 1.05 + (flowMargin / Math.max(Qd, 0.5)) * 0.38;
    var oversizeTerm = Math.max(0, Math.log(oversize / 1.22)) * 0.42;
    var tightScore = marginNorm + oversizeTerm;

    return {
      ok: true,
      tier: relax ? 2 : 1,
      hAt: hAt,
      qMax: qMax,
      headMargin: headMargin,
      flowMargin: flowMargin,
      tightScore: tightScore,
      oversize: oversize,
      powerKw: p.P
    };
  }

  function curvePageHint(dn) {
    if (dn === 65) return "对照《西子潜水排污泵系列 260302》约 <strong>P23</strong>（DN65，50Hz WQA）";
    if (dn === 80 || dn === 100) return "对照该样本约 <strong>P24–P25</strong>（DN80 / DN100）";
    if (dn === 50) return "对照该样本 <strong>DN50</strong> 页（2″）";
    if (dn === 150) return "对照该样本 <strong>DN150</strong> 章节";
    return "对照《西子潜水排污泵系列 260302》<strong>WQA 50Hz</strong> 曲线章节（P23–P27 一带）";
  }

  function runSelection() {
    var outEl = document.getElementById("wqaSelectResults");
    if (!outEl) return;

    var elOutlet = document.getElementById("selOutlet");
    var elQ = document.getElementById("selQ");
    var elQUnit = document.getElementById("selQUnit");
    var elH = document.getElementById("selH");
    var elP = document.getElementById("selP");
    var elPUnit = document.getElementById("selPUnit");

    var cat = buildCatalog();
    if (!cat.length) {
      outEl.innerHTML = "<p>未加载价格表数据，请确认已引入 <code>assets/price-data.js</code>。</p>";
      return;
    }

    var dnFilter = parseOutletToDn(elOutlet && elOutlet.value);
    var Qc = parseFlowToM3h(elQ && elQ.value, elQUnit && elQUnit.value);
    var Hc = Number(elH && elH.value);
    if (!isFinite(Hc) || Hc < 0) Hc = null;

    var Pc = parsePowerToKw(elP && elP.value, elPUnit && elPUnit.value);

    var hasQ = Qc != null && Qc > 0;
    var hasH = Hc != null && Hc > 0;
    var hasP = Pc != null && Pc > 0;
    if (!hasQ && !hasH && !hasP) {
      outEl.innerHTML =
        "<p>请至少填写<strong>流量</strong>、<strong>扬程</strong>或<strong>功率</strong>之一（可多填），再点击筛选。</p>";
      return;
    }

    function collect(relax) {
      var out = [];
      cat.forEach(function (p) {
        if (!dnMatchesFilter(p.dn, dnFilter)) return;
        var ev = evaluateCover(p, hasQ ? Qc : null, hasH ? Hc : null, hasP ? Pc : null, relax);
        if (!ev.ok) return;
        out.push({ p: p, ev: ev, relax: relax });
      });
      return out;
    }

    var tier1 = collect(false);
    var tier2 = tier1.length ? [] : collect(true);
    var candidates = tier1.length ? tier1 : tier2;
    var usedRelax = !tier1.length && tier2.length > 0;

    candidates.sort(function (a, b) {
      if (a.ev.tier !== b.ev.tier) return a.ev.tier - b.ev.tier;
      if (a.p.P !== b.p.P) return a.p.P - b.p.P;
      var sa = a.ev.tightScore != null ? a.ev.tightScore : 99;
      var sb = b.ev.tightScore != null ? b.ev.tightScore : 99;
      if (Math.abs(sa - sb) > 1e-5) return sa - sb;
      return a.p.Q * a.p.H - b.p.Q * b.p.H;
    });

    var maxShow = 48;
    var slice = candidates.slice(0, maxShow);

    var hint = "";
    if (dnFilter) hint += "<p><strong>口径提示：</strong>" + curvePageHint(dnFilter) + "</p>";
    hint +=
      "<p class=\"wqa-select-note\">在<strong>保守包络盖住</strong>工况的前提下，<strong>优先铭牌功率 kW 更低</strong>的型号（避免功率过剩），再以<strong>扬程/流量裕量与铭牌能力</strong>综合排序，贴近工况点。" +
      "无严格盖住时再尝试放宽末端。<strong>定标请以样本曲线为准。</strong></p>";
    if (usedRelax) {
      hint +=
        "<p class=\"wqa-select-warn\"><strong>提示：</strong>严格包络下无候选，已启用<strong>放宽末端</strong>档；请优先人工对照 P23–P27。</p>";
    }

    if (!slice.length) {
      outEl.innerHTML =
        hint +
        "<p><strong>无匹配候选</strong>：在不外推曲线的前提下，没有型号能盖住该工况。请增大口径系列、或核对流量/扬程单位。</p>";
      return;
    }

    function fmt(x) {
      if (x == null || !isFinite(x)) return "—";
      return (Math.round(x * 100) / 100).toFixed(2);
    }

    var rows = slice
      .map(function (c, i) {
        var p = c.p;
        var ev = c.ev;
        var tag =
          i === 0
            ? "<span class=\"wqa-tag wqa-tag--best\">优先参考</span>"
            : ev.tier === 2
            ? "<span class=\"wqa-tag wqa-tag--warn\">放宽末端</span>"
            : ev.oversize != null && ev.oversize <= 1.55
            ? "<span class=\"wqa-tag\">较贴切</span>"
            : ev.oversize != null && ev.oversize > 2.2
            ? "<span class=\"wqa-tag wqa-tag--muted\">裕量偏大</span>"
            : "<span class=\"wqa-tag\">可用</span>";
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
          fmt(ev.hAt) +
          "</td><td>" +
          fmt(ev.qMax) +
          "</td><td>" +
          fmt(ev.headMargin) +
          "</td><td>" +
          tag +
          "</td></tr>"
        );
      })
      .join("");

    outEl.innerHTML =
      hint +
      "<div class=\"wqa-table-wrap\"><table class=\"decode-table wqa-result-table\"><thead><tr>" +
      "<th>#</th><th>型号</th><th>口径</th><th>Qn</th><th>Hn</th><th>kW</th>" +
      "<th>H<sub>包络</sub>@Qd</th><th>Q<sub>max</sub>估</th><th>扬程裕量</th><th>说明</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      "<p class=\"wqa-footnote\">排序：<strong>先比铭牌 kW（低者优先）</strong>，再比贴合度。H<sub>包络</sub> 在 Q&gt;Qn 段为<strong>凸曲线</strong>下降（较线性更贴近真实曲线形态）。Q<sub>max</sub>估 ≈ Qn×(1.35+30/(Qn+20))。</p>";
  }

  function init() {
    var btn = document.getElementById("wqaSelectRun");
    if (btn) btn.addEventListener("click", runSelection);

    var wqaSection = document.getElementById("select-wqa");
    if (wqaSection) {
      wqaSection.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var link = t.closest(".link-model");
        if (!link || !wqaSection.contains(link)) return;
        var m = link.getAttribute("data-m");
        if (m && typeof window.XIZI_fillQuoteModel === "function") window.XIZI_fillQuoteModel(m);
      });
    }

    function bindEnterRun(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        runSelection();
      });
    }
    ["selOutlet", "selQ", "selH", "selP"].forEach(bindEnterRun);
    var elQUnit = document.getElementById("selQUnit");
    var elPUnit = document.getElementById("selPUnit");
    if (elQUnit) elQUnit.addEventListener("change", runSelection);
    if (elPUnit) elPUnit.addEventListener("change", runSelection);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
