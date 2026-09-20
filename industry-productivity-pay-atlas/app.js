"use strict";
/* Industry Productivity & Pay Atlas — vanilla JS, no framework.
   Two planes kept separate: India RBI KLEMS (broad labour-income share) and
   OECD STAN (employee-compensation share). Decomposition recomputed in-browser. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const SVGNS = "http://www.w3.org/2000/svg";
const COL = { accent: "#0f5c6b", accent2: "#b5651d", series: ["#0f5c6b","#b5651d","#127a63","#6a4c93","#c1466b","#2a7fb8","#8a7d00","#496b6b"] };
const fmtPct = v => (v == null || isNaN(v)) ? "—" : (100 * v).toFixed(1) + "%";
const fmtPP = v => (v >= 0 ? "+" : "") + (100 * v).toFixed(2) + " pp";
const fmtNum = (v, d = 1) => (v == null || isNaN(v)) ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });

let KLEMS = null, OECD = null;
const state = { view: "finding", y0: "2011-12", y1: "2022-23", plane: "india", country: "DEU", industry: "AGG", metric: "share" };

/* ---------- data helpers (India) ---------- */
const mfg = () => KLEMS.industries.filter(z => z.is_mfg);
const yrIndex = y => KLEMS.years.indexOf(y);
function mfgShareAt(j) {              // VA-weighted labour-income share at year index j
  let sw = 0, sws = 0;
  for (const z of mfg()) { const w = z.va_nom[j]; sw += w; sws += w * z.lsh_va[j]; }
  return sws / sw;
}
function mfgShareSeries() { return KLEMS.years.map((_, j) => mfgShareAt(j)); }
function decomposition(y0, y1) {
  const j0 = yrIndex(y0), j1 = yrIndex(y1), M = mfg();
  const t0 = M.reduce((a, z) => a + z.va_nom[j0], 0), t1 = M.reduce((a, z) => a + z.va_nom[j1], 0);
  const rows = M.map(z => {
    const w0 = z.va_nom[j0] / t0, w1 = z.va_nom[j1] / t1, s0 = z.lsh_va[j0], s1 = z.lsh_va[j1];
    const within = ((w0 + w1) / 2) * (s1 - s0), between = ((s0 + s1) / 2) * (w1 - w0);
    return { code: z.code, name: z.name, w0, w1, s0, s1, within, between, contrib: within + between };
  });
  const within = rows.reduce((a, r) => a + r.within, 0), between = rows.reduce((a, r) => a + r.between, 0);
  const S0 = mfgShareAt(j0), S1 = mfgShareAt(j1);
  return { rows, within, between, dS: S1 - S0, S0, S1, residual: (within + between) - (S1 - S0) };
}

/* ---------- tiny SVG chart kit ---------- */
function el(tag, attrs, txt) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (txt != null) e.textContent = txt; return e; }
const tt = $("#tt");
function showTT(html, x, y) { tt.innerHTML = html; tt.style.left = (x + 12) + "px"; tt.style.top = (y + 12) + "px"; tt.style.opacity = 1; }
function hideTT() { tt.style.opacity = 0; }

function lineChart(svg, series, opts = {}) {
  // series: [{name,color,points:[{x:<num>,y:<num|null>}], dashed}], x numeric
  svg.innerHTML = "";
  const W = 900, H = +(/(\d+)$/.exec(svg.getAttribute("viewBox").split(" ")[3]) || [0, 340])[1] || 340;
  const m = { l: 54, r: 16, t: 14, b: 34 };
  const xs = series.flatMap(s => s.points.map(p => p.x));
  const ys = series.flatMap(s => s.points.filter(p => p.y != null).map(p => p.y));
  if (!ys.length) { svg.appendChild(el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis-txt" }, "No observations for this selection.")); return; }
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  let ymin = opts.ymin != null ? opts.ymin : Math.min(...ys), ymax = opts.ymax != null ? opts.ymax : Math.max(...ys);
  if (ymin === ymax) { ymin -= 1; ymax += 1; } const pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad;
  if (opts.zero && ymin > 0) ymin = 0;
  const X = v => m.l + (v - xmin) / (xmax - xmin || 1) * (W - m.l - m.r);
  const Y = v => H - m.b - (v - ymin) / (ymax - ymin || 1) * (H - m.t - m.b);
  // y grid + ticks
  const nt = 5;
  for (let i = 0; i <= nt; i++) { const v = ymin + (ymax - ymin) * i / nt; const y = Y(v);
    svg.appendChild(el("line", { x1: m.l, y1: y, x2: W - m.r, y2: y, class: "grid" }));
    svg.appendChild(el("text", { x: m.l - 6, y: y + 3, "text-anchor": "end", class: "axis-txt" }, opts.yfmt ? opts.yfmt(v) : v.toFixed(0))); }
  // x ticks (~6)
  const xt = Math.max(1, Math.round((xmax - xmin) / 6));
  for (let v = Math.ceil(xmin); v <= xmax; v += xt) { const x = X(v);
    svg.appendChild(el("line", { x1: x, y1: H - m.b, x2: x, y2: m.t, class: "grid" }));
    svg.appendChild(el("text", { x: x, y: H - m.b + 16, "text-anchor": "middle", class: "axis-txt" }, opts.xfmt ? opts.xfmt(v) : v)); }
  svg.appendChild(el("line", { x1: m.l, y1: H - m.b, x2: W - m.r, y2: H - m.b, class: "axis" }));
  // series
  series.forEach(s => {
    let d = "", started = false;
    s.points.forEach(p => { if (p.y == null) { started = false; return; } d += (started ? "L" : "M") + X(p.x) + " " + Y(p.y) + " "; started = true; });
    svg.appendChild(el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2.4, "stroke-dasharray": s.dashed ? "6 4" : "" }));
    s.points.forEach(p => { if (p.y == null) return; const c = el("circle", { cx: X(p.x), cy: Y(p.y), r: 3.2, fill: s.color, class: "dot" });
      c.addEventListener("mousemove", ev => showTT(`<strong>${s.name}</strong><br>${opts.xlab ? opts.xlab(p.x) : p.x}: ${opts.tipfmt ? opts.tipfmt(p.y) : p.y}`, ev.clientX, ev.clientY));
      c.addEventListener("mouseleave", hideTT); svg.appendChild(c); });
  });
  (opts.markers || []).forEach(mk => { const x = X(mk.x); svg.appendChild(el("line", { x1: x, y1: m.t, x2: x, y2: H - m.b, stroke: COL.accent2, "stroke-width": 1, "stroke-dasharray": "3 3" }));
    svg.appendChild(el("text", { x: x, y: m.t + 10, "text-anchor": "middle", class: "axis-txt", fill: COL.accent2 }, mk.label)); });
}

function barChart(svg, items, opts = {}) { // items:[{label,value}], signed horizontal bars
  svg.innerHTML = ""; const W = 900; const rowH = 26, m = { l: 250, r: 60, t: 8, b: 8 };
  const H = m.t + m.b + items.length * rowH; svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const maxv = Math.max(...items.map(i => Math.abs(i.value)), 1e-9);
  const x0 = m.l + (W - m.l - m.r) / 2; const scale = ((W - m.l - m.r) / 2) / maxv;
  svg.appendChild(el("line", { x1: x0, y1: m.t, x2: x0, y2: H - m.b, class: "axis" }));
  items.forEach((it, i) => { const y = m.t + i * rowH + 3; const w = it.value * scale;
    svg.appendChild(el("rect", { x: w >= 0 ? x0 : x0 + w, y, width: Math.abs(w), height: rowH - 8, rx: 2, class: it.value >= 0 ? "bar-pos" : "bar-neg" }));
    svg.appendChild(el("text", { x: m.l - 8, y: y + 12, "text-anchor": "end", class: "axis-txt", fill: "#14242c" }, it.label.length > 40 ? it.label.slice(0, 39) + "…" : it.label));
    svg.appendChild(el("text", { x: w >= 0 ? x0 + w + 5 : x0 + w - 5, y: y + 12, "text-anchor": w >= 0 ? "start" : "end", class: "axis-txt" }, opts.vfmt ? opts.vfmt(it.value) : it.value.toFixed(2))); });
}

/* ---------- THE FINDING ---------- */
function renderFinding() {
  const S = mfgShareSeries(), yrs = KLEMS.years;
  const last = S.length - 1;
  $("#finding-lead").innerHTML =
    `Across ${mfg().length} manufacturing industries, labour's broad share of value added was <strong>${fmtPct(S[0])}</strong> in ${yrs[0]} and <strong>${fmtPct(S[last])}</strong> in ${yrs[last]}. It fell through the 2000s to a trough and has <strong>recovered since ~2011-12</strong>. Below, decompose any change into within-industry and composition parts.`;
  const trough = S.indexOf(Math.min(...S));
  $("#finding-stats").innerHTML =
    stat(fmtPct(S[0]), yrs[0]) + stat(fmtPct(Math.min(...S)), "trough (" + yrs[trough] + ")") + stat(fmtPct(S[last]), yrs[last]);
  // trajectory
  lineChart($("#finding-traj"), [{ name: "Manufacturing labour-income share", color: COL.accent, points: S.map((v, j) => ({ x: j, y: 100 * v })) }],
    { yfmt: v => v.toFixed(0) + "%", xfmt: j => yrs[j] ? yrs[j].slice(0, 4) : "", xlab: j => yrs[j], tipfmt: v => v.toFixed(1) + "%",
      markers: [{ x: yrIndex(state.y0), label: state.y0 }, { x: yrIndex(state.y1), label: state.y1 }] });
  $("#finding-traj-cap").textContent = `Source: ${KLEMS.meta.source}. VA-weighted broad labour-income share (incl. imputed self-employed labour), constant ${KLEMS.meta.base_year}. Not the ASI formal wage share.`;
  renderDecomp();
}
const stat = (n, l, cls = "") => `<div class="stat ${cls}"><div class="n">${n}</div><div class="l">${l}</div></div>`;

function renderDecomp() {
  const d = decomposition(state.y0, state.y1);
  $("#decomp-stats").innerHTML =
    stat(fmtPP(d.dS), `Δ share, ${state.y0}→${state.y1}`, d.dS >= 0 ? "pos" : "neg") +
    stat(fmtPP(d.within), "within-industry", d.within >= 0 ? "pos" : "neg") +
    stat(fmtPP(d.between), "composition", d.between >= 0 ? "pos" : "neg");
  $("#decomp-identity").textContent = `Identity check: within + composition = ${fmtPP(d.within + d.between)} = ΔS (residual ${(d.residual * 100).toExponential(1)} pp).`;
  // contributions sorted by |contrib|
  const rows = d.rows.slice().sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
  $("#contrib-cap").textContent = `Each industry's total contribution to ΔS (within + composition), ${state.y0}→${state.y1}. Sums to ${fmtPP(d.dS)}.`;
  barChart($("#finding-contrib"), rows.map(r => ({ label: r.name, value: 100 * r.contrib })), { vfmt: v => (v >= 0 ? "+" : "") + v.toFixed(2) });
  // table
  let h = `<table class="data"><caption>Signed contributions (percentage points)</caption><thead><tr><th>Industry</th><th>within</th><th>composition</th><th>total</th></tr></thead><tbody>`;
  rows.forEach(r => h += `<tr><td>${r.name}</td><td class="num">${(100*r.within).toFixed(2)}</td><td class="num">${(100*r.between).toFixed(2)}</td><td class="num">${(100*r.contrib>=0?"+":"")+(100*r.contrib).toFixed(2)}</td></tr>`);
  h += `</tbody></table>`; $("#contrib-table").innerHTML = h;
  // narrative
  const up = rows.filter(r => r.contrib > 0).sort((a,b)=>b.contrib-a.contrib);
  const dn = rows.filter(r => r.contrib < 0).sort((a,b)=>a.contrib-b.contrib);
  const dir = d.dS >= 0 ? "rose" : "fell";
  $("#finding-narrative").innerHTML =
    `Between <strong>${state.y0}</strong> and <strong>${state.y1}</strong>, the manufacturing labour-income share ${dir} by <strong>${fmtPP(d.dS)}</strong>. ` +
    `The move is <strong>${Math.abs(d.within) >= Math.abs(d.between) ? "overwhelmingly within-industry" : "mainly compositional"}</strong> ` +
    `(within ${fmtPP(d.within)}, composition ${fmtPP(d.between)}). ` +
    (up.length ? `Largest positive contributors: ${up.slice(0,3).map(r=>`${r.name} (${fmtPP(r.contrib)})`).join(", ")}. ` : "") +
    (dn.length ? `Counterexamples that pulled the other way: ${dn.slice(0,3).map(r=>`${r.name} (${fmtPP(r.contrib)})`).join(", ")}.` : "");
  $("#finding-caveats").innerHTML =
    `<strong>Read as accounting, not cause.</strong> This splits an aggregate change; it does not explain why any industry's share moved. RBI labour income is <em>broad</em> (includes imputed self-employed labour), so it is <strong>not</strong> the ASI formal wages-to-workers share; do not compare their levels.`;
}

/* ---------- EXPLORE ---------- */
function setupExplore() {
  const plane = $("#e-plane"); plane.value = state.plane;
  plane.addEventListener("change", () => { state.plane = plane.value; buildExploreControls(); renderExplore(); sync(); });
  ["e-country","e-industry","e-metric"].forEach(id => $("#"+id).addEventListener("change", () => {
    state.country = $("#e-country").value || state.country;
    state.industry = $("#e-industry").value; state.metric = $("#e-metric").value;
    renderExplore(); sync();
  }));
  $("#e-download").addEventListener("click", downloadCSV);
  buildExploreControls();
}
function opt(v, t, sel) { return `<option value="${v}"${v===sel?" selected":""}>${t}</option>`; }
function buildExploreControls() {
  const isI = state.plane === "india";
  $("#wrap-country").hidden = isI;
  $("#lab-industry").textContent = isI ? "Industry" : "Industry (ISIC)";
  if (isI) {
    $("#e-industry").innerHTML = opt("AGG","All manufacturing (aggregate)",state.industry) +
      mfg().map(z => opt(z.code, z.name, state.industry)).join("");
    $("#e-metric").innerHTML = [["share","Labour-income share of VA"],["lp","Real labour productivity (VA/worker)"],["inc","Labour income per worker (share × productivity)"]]
      .map(m => opt(m[0], m[1], state.metric)).join("");
    if (![...$("#e-industry").options].some(o=>o.value===state.industry)) state.industry="AGG";
  } else {
    $("#e-country").innerHTML = OECD.countries.map(c => opt(c.code, c.name, state.country)).join("");
    $("#e-industry").innerHTML = OECD.activities.map(a => opt(a.code, a.name, state.industry)).join("");
    $("#e-metric").innerHTML = [["comp","Employee compensation ÷ VA"],["wage","Wages & salaries ÷ VA"]].map(m=>opt(m[0],m[1],state.metric)).join("");
    if (!OECD.activities.some(a=>a.code===state.industry)) state.industry = "C";
    if (!["comp","wage"].includes(state.metric)) state.metric = "comp";
    $("#e-metric").value = state.metric; $("#e-industry").value = state.industry;
  }
}
function indiaSeries() {
  const yrs = KLEMS.years; const mlist = mfg();
  const pick = state.industry;
  const val = j => {
    if (pick === "AGG") {
      if (state.metric === "share") return mfgShareAt(j);
      const vr = mlist.reduce((a,z)=>a+z.va_real[j],0), em = mlist.reduce((a,z)=>a+z.emp[j],0);
      if (state.metric === "lp") return vr/em; // real VA per worker ('000 Rs)
      // labour income per worker (aggregate, VA-real weighted) = Σ(s_i·va_real_i)/Σemp
      const li = mlist.reduce((a,z)=>a+z.lsh_va[j]*z.va_real[j],0); return li/em;
    }
    const z = mlist.find(z=>z.code===pick); if (!z) return null;
    if (state.metric==="share") return z.lsh_va[j];
    if (state.metric==="lp") return z.lp[j];
    return z.lsh_va[j]*z.lp[j];
  };
  return { yrs, points: yrs.map((y,j)=>({x:parseInt(y),y:val(j)})) };
}
function renderExplore() {
  const isI = state.plane === "india";
  if (isI) {
    const s = indiaSeries();
    const isShare = state.metric==="share";
    const name = $("#e-industry").selectedOptions[0].textContent;
    $("#e-chart-title").textContent = name;
    const disp = s.points.map(p => ({ x: p.x, y: (p.y==null?null:(isShare?100*p.y:p.y)) }));
    lineChart($("#e-series"), [{ name, color: COL.accent, points: disp }],
      { yfmt: v => isShare ? v.toFixed(0)+"%" : fmtNum(v,0), tipfmt: v => isShare ? v.toFixed(1)+"%" : fmtNum(v,1),
        xfmt: v => v, xlab: v => v });
    $("#e-legend").innerHTML = `<span><i style="background:${COL.accent}"></i>${name}</span>`;
    const unit = isShare ? "ratio (labour income / value added), broad labour income" :
      state.metric==="lp" ? "'000 ₹ per worker, constant 2011-12 prices (real VA per worker)" :
      "'000 ₹ per worker, constant 2011-12 value-added prices (share × productivity; NOT a consumption-deflated wage)";
    $("#e-units").textContent = `Unit: ${unit}. Source: ${KLEMS.meta.source}.`;
    $("#e-defs").innerHTML = defBlock([
      ["Coverage","RBI KLEMS registered + unorganised industry (whole economy by industry), constant 2011-12 prices."],
      ["Worker universe","All persons employed (employees + self-employed)."],
      ["Labour income","Compensation of employees + imputed labour part of self-employed mixed income (Mincer). Broad; not ASI formal wages."],
      ["Prices","Real series at constant 2011-12; the share is a within-year ratio."]
    ]);
    tableFrom(s.yrs.map((y,j)=>[y, s.points[j].y]), ["Year", name], isShare);
    $("#plane-note").className="note small"; $("#plane-note").innerHTML = `<strong>India plane (RBI KLEMS).</strong> Broad labour-income share. Kept separate from the OECD plane — the two use different labour concepts and are not pooled or subtracted.`;
  } else {
    const rec = OECD.series.find(s=>s.country===state.country && s.activity===state.industry);
    const cname = OECD.countries.find(c=>c.code===state.country).name;
    const aname = OECD.activities.find(a=>a.code===state.industry).name;
    $("#e-chart-title").textContent = `${cname} — ${aname}`;
    if (!rec || !rec.year.length) {
      $("#e-series").innerHTML=""; $("#e-series").appendChild(el("text",{x:450,y:180,"text-anchor":"middle",class:"axis-txt"},"No observations for this country × industry."));
      $("#e-legend").innerHTML=""; $("#e-table")?.replaceChildren(); $("#e-table").innerHTML="<p class='empty'>No observations for this selection.</p>";
    } else {
      const key = state.metric==="comp" ? "comp_share" : "wage_share";
      const pts = rec.year.map((y,i)=>({x:y,y:rec[key][i]==null?null:100*rec[key][i]}));
      lineChart($("#e-series"), [{name:aname,color:COL.accent2,points:pts}], {yfmt:v=>v.toFixed(0)+"%",tipfmt:v=>v.toFixed(1)+"%",xfmt:v=>v,xlab:v=>v});
      $("#e-legend").innerHTML = `<span><i style="background:${COL.accent2}"></i>${state.metric==="comp"?"Compensation":"Wages & salaries"} ÷ VA</span>`;
      tableFrom(rec.year.map((y,i)=>[y, rec[key][i]]), ["Year", state.metric==="comp"?"Comp/VA":"Wages/VA"], true);
    }
    $("#e-units").textContent = `Unit: share of current-price value added. Source: ${OECD.meta.source}.`;
    $("#e-defs").innerHTML = defBlock([
      ["Coverage","OECD countries only (no India). ISIC Rev.4 industries."],
      ["Worker universe","Employees only — compensation of employees EXCLUDES the self-employed."],
      ["Prices","Share of current-price value added (national currency); unitless ratio."],
      ["Separateness","Different measurement plane from RBI's broad labour income; do not subtract or pool the levels."]
    ]);
    $("#plane-note").className="note small warn"; $("#plane-note").innerHTML = `<strong>Global plane (OECD STAN).</strong> Employee-compensation share — a <em>different</em> labour concept from the India plane. Compare patterns within this source; do not compare levels across planes. India is not in STAN.`;
  }
}
function defBlock(pairs){ return pairs.map(p=>`<p class="def"><strong>${p[0]}:</strong> ${p[1]}</p>`).join(""); }
function tableFrom(rows, head, isShare){
  let h=`<table class="data"><caption>Plotted data</caption><thead><tr>${head.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>`;
  rows.forEach(r=>{ const v=r[1]; h+=`<tr><td>${r[0]}</td><td class="num">${v==null?"—":(isShare?(100*v).toFixed(2)+"%":fmtNum(v,1))}</td></tr>`; });
  h+=`</tbody></table>`; $("#e-table").innerHTML=h;
}
function downloadCSV(){
  let rows, name;
  if (state.plane==="india"){ const s=indiaSeries(); name=`atlas_india_${state.industry}_${state.metric}.csv`;
    rows=[["year","value","metric","industry","source"]].concat(s.yrs.map((y,j)=>[y, s.points[j].y??"", state.metric, state.industry, "RBI India KLEMS 2024"]));
  } else { const rec=OECD.series.find(s=>s.country===state.country&&s.activity===state.industry); const key=state.metric==="comp"?"comp_share":"wage_share";
    name=`atlas_oecd_${state.country}_${state.industry}_${state.metric}.csv`;
    rows=[["year","value","metric","country","activity","source"]].concat(rec?rec.year.map((y,i)=>[y, rec[key][i]??"", state.metric, state.country, state.industry, "OECD STAN 2025"]):[]);
  }
  const csv=rows.map(r=>r.join(",")).join("\n"); const blob=new Blob([csv],{type:"text/csv"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- tabs, url state, methods ---------- */
function switchView(v){ state.view=v;
  const f=v==="finding"; $("#tab-finding").setAttribute("aria-selected",f); $("#tab-explore").setAttribute("aria-selected",!f);
  $("#view-finding").hidden=!f; $("#view-explore").hidden=f; sync();
}
function sync(){ const p=new URLSearchParams();
  p.set("view",state.view);
  if(state.view==="finding"){ p.set("y0",state.y0); p.set("y1",state.y1); }
  else { p.set("plane",state.plane); if(state.plane==="oecd")p.set("country",state.country); p.set("industry",state.industry); p.set("metric",state.metric); }
  history.replaceState(null,"","?"+p.toString());
}
function loadState(){ const p=new URLSearchParams(location.search);
  if(p.get("view"))state.view=p.get("view");
  if(p.get("y0"))state.y0=p.get("y0"); if(p.get("y1"))state.y1=p.get("y1");
  if(p.get("plane"))state.plane=p.get("plane"); if(p.get("country"))state.country=p.get("country");
  if(p.get("industry"))state.industry=p.get("industry"); if(p.get("metric"))state.metric=p.get("metric");
}
function buildMethods(){
  $("#methods-body").innerHTML =
    `<h3>India core — RBI India KLEMS</h3>
     <p class="def">${KLEMS.meta.source} · file <span class="mono">${KLEMS.meta.source_file}</span> · sha256 <span class="mono small">${KLEMS.meta.source_sha256.slice(0,24)}…</span></p>
     <p class="def">${KLEMS.meta.coverage} Base: ${KLEMS.meta.base_year}. ${KLEMS.meta.vintage_note}</p>
     <p class="def">${KLEMS.meta.definitions.labour_income}</p>
     <p class="def">${KLEMS.meta.definitions.lsh_times_lp}</p>
     <p class="def"><strong>Licence:</strong> ${KLEMS.meta.licence}</p>
     <h3>Global plane — OECD STAN</h3>
     <p class="def">${OECD.meta.source}. ${OECD.meta.coverage_note}</p>
     <p class="def">Measures: compensation of employees ÷ VA, and wages &amp; salaries ÷ VA, current prices. ${OECD.meta.separateness}</p>
     <p class="def"><strong>Licence:</strong> ${OECD.meta.licence}</p>
     <h3>UNIDO INDSTAT — attempted, not shipped</h3>
     <p class="def">UNIDO INDSTAT (industrial wages-and-salaries share) was the intended first global route, but stat.unido.org returned HTTP 403 to scripted access and its bulk download requires registration; access controls were not bypassed. It can be added later from a user-supplied CC BY 4.0 extract as a third, separate plane.</p>
     <h3>Reproducibility &amp; limitations</h3>
     <p class="def">Offline builds: <span class="mono">build/build_atlas.R</span> (India), <span class="mono">build/build_oecd.py</span> (OECD). Tests: <span class="mono">build/test_atlas.R</span>. The within/composition split is a descriptive accounting identity, not causal. The three planes use different labour concepts and are never subtracted or pooled.</p>`;
  $("#foot-src").innerHTML = `Sources: RBI India KLEMS (2024); OECD STAN (2025). Derived aggregates shown with attribution; raw workbooks not redistributed.`;
}

/* ---------- boot ---------- */
Promise.all([
  fetch("data/atlas_klems.json").then(r=>r.json()),
  fetch("data/atlas_oecd.json").then(r=>r.json())
]).then(([k,o])=>{
  KLEMS=k; OECD=o; loadState();
  // year selectors
  const ysel = KLEMS.years.map(y=>`<option value="${y}">${y}</option>`).join("");
  $("#f-y0").innerHTML=ysel; $("#f-y1").innerHTML=ysel;
  if(!KLEMS.years.includes(state.y0)) state.y0="2011-12"; if(!KLEMS.years.includes(state.y1)) state.y1="2022-23";
  $("#f-y0").value=state.y0; $("#f-y1").value=state.y1;
  $("#f-y0").addEventListener("change",()=>{state.y0=$("#f-y0").value; renderFinding(); sync();});
  $("#f-y1").addEventListener("change",()=>{state.y1=$("#f-y1").value; renderFinding(); sync();});
  $("#tab-finding").addEventListener("click",()=>switchView("finding"));
  $("#tab-explore").addEventListener("click",()=>switchView("explore"));
  $("#share-btn").addEventListener("click",()=>{navigator.clipboard?.writeText(location.href); $("#share-btn").textContent="Link copied ✓"; setTimeout(()=>$("#share-btn").textContent="Copy link to this view",1500);});
  buildMethods(); setupExplore(); renderFinding(); renderExplore();
  switchView(state.view);
}).catch(e=>{ $("#main").innerHTML=`<div class="card"><h2>Could not load data</h2><p class="mono small">${e}</p></div>`; });
