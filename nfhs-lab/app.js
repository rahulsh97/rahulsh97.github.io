"use strict";

const $ = id => document.getElementById(id);
const controls = { outcome: $("outcome"), exposure: $("exposure"), mode: $("mode"), state: $("state"), search: $("search") };
let DATA, selected = null, fixedEffects = false;
let observations = [];
const fmt = (n, decimals = 1) => Number.isFinite(n) ? n.toFixed(decimals) : "—";
const signed = n => `${n > 0 ? "+" : ""}${fmt(n)} pp`;
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

function series(row, key) {
  const [old, current] = row.v[key] || [];
  if (controls.mode.value === "change") return old == null || current == null ? null : current - old;
  return current == null ? null : current;
}

function fit(rows, stateEffects = false) {
  if (rows.length < 3) return null;
  let points = rows;
  if (stateEffects) {
    const groups = new Map();
    for (const p of rows) (groups.get(p.state) || (groups.set(p.state, []), groups.get(p.state))).push(p);
    points = rows.map(p => {
      const group = groups.get(p.state);
      return { x: p.x - mean(group.map(a => a.x)), y: p.y - mean(group.map(a => a.y)) };
    });
  }
  const xMean = mean(points.map(p => p.x)), yMean = mean(points.map(p => p.y));
  const xx = points.reduce((sum, p) => sum + (p.x - xMean) ** 2, 0);
  const yy = points.reduce((sum, p) => sum + (p.y - yMean) ** 2, 0);
  if (xx < 1e-10 || yy < 1e-10) return null;
  const slope = points.reduce((sum, p) => sum + (p.x - xMean) * (p.y - yMean), 0) / xx;
  const r2 = 1 - points.reduce((sum, p) => sum + (p.y - yMean - slope * (p.x - xMean)) ** 2, 0) / yy;
  return { slope, r2, intercept: mean(rows.map(p => p.y)) - slope * mean(rows.map(p => p.x)) };
}

function colour(value, values, mode) {
  if (value == null || !Number.isFinite(value)) return "#d7dfdb";
  if (mode === "level") {
    const low = Math.min(...values), high = Math.max(...values);
    const t = high === low ? .5 : (value - low) / (high - low);
    return `hsl(${174 + t * 13} 50% ${91 - t * 61}%)`;
  }
  const limit = Math.max(5, Math.max(...values.map(Math.abs)));
  const t = Math.min(1, Math.abs(value) / limit);
  return value < 0 ? `hsl(13 46% ${95 - t * 50}%)` : `hsl(176 48% ${95 - t * 54}%)`;
}

function drawScatter(rows, model) {
  const target = $("scatter");
  if (!rows.length) { target.innerHTML = "<p>No matched observations for these filters.</p>"; return; }
  const W = 650, H = 390, left = 63, right = 24, top = 24, bottom = 66;
  const xs = rows.map(r => r.x), ys = rows.map(r => r.y);
  const range = a => { let lo = Math.min(...a), hi = Math.max(...a); const pad = Math.max((hi - lo) * .11, 1.5); return [lo - pad, hi + pad]; };
  const [xmin, xmax] = range(xs), [ymin, ymax] = range(ys);
  const sx = x => left + (x - xmin) / (xmax - xmin) * (W - left - right);
  const sy = y => H - bottom - (y - ymin) / (ymax - ymin) * (H - top - bottom);
  let parts = [`<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">`];
  for (let i = 0; i <= 4; i++) {
    const x = left + i / 4 * (W - left - right), y = top + i / 4 * (H - top - bottom);
    parts.push(`<path class="grid-line" d="M${x},${top}V${H - bottom}M${left},${y}H${W - right}"/>`);
    parts.push(`<text class="axis-label" x="${x}" y="${H - bottom + 20}" text-anchor="middle">${fmt(xmin + i / 4 * (xmax - xmin), 0)}</text>`);
    parts.push(`<text class="axis-label" x="${left - 10}" y="${y + 4}" text-anchor="end">${fmt(ymax - i / 4 * (ymax - ymin), 0)}</text>`);
  }
  if (model) parts.push(`<path d="M${sx(xmin)} ${sy(model.intercept + model.slope * xmin)}L${sx(xmax)} ${sy(model.intercept + model.slope * xmax)}" fill="none" stroke="#aa603f" stroke-width="2.8"/>`);
  const ordered = [...rows].sort((a, b) => a.key === selected ? 1 : b.key === selected ? -1 : 0);
  for (const p of ordered) {
    const active = p.key === selected;
    parts.push(`<circle class="point" data-key="${escapeHtml(p.key)}" cx="${sx(p.x)}" cy="${sy(p.y)}" r="${active ? 7 : 4.2}" fill="${active ? "#a84b35" : "#116977"}" fill-opacity="${active ? 1 : .78}" stroke="white" stroke-width="${active ? 2 : 1}" tabindex="0"><title>${escapeHtml(p.district)}, ${escapeHtml(p.state)}: x ${fmt(p.x)}; y ${fmt(p.y)}</title></circle>`);
  }
  parts.push(`<text class="axis-label" x="${(left + W - right) / 2}" y="${H - 12}" text-anchor="middle">${escapeHtml(DATA.indicators[controls.exposure.value])} (${controls.mode.value === "change" ? "change, pp" : "NFHS-5, %"})</text>`);
  parts.push(`<text class="axis-label" transform="translate(16 ${(top + H - bottom) / 2}) rotate(-90)" text-anchor="middle">${escapeHtml(DATA.indicators[controls.outcome.value])} (${controls.mode.value === "change" ? "change, pp" : "NFHS-5, %"})</text></svg>`);
  target.innerHTML = parts.join("");
  for (const node of target.querySelectorAll(".point")) {
    node.addEventListener("click", () => select(node.dataset.key));
    node.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(node.dataset.key); } });
  }
}

function drawMatrix() {
  const container = $("matrix");
  const rows = DATA.districts.filter(d => controls.state.value === "all" || d.state === controls.state.value);
  const groups = new Map();
  for (const row of rows) (groups.get(row.state) || (groups.set(row.state, []), groups.get(row.state))).push(row);
  const values = rows.map(row => series(row, controls.outcome.value)).filter(v => v != null);
  container.replaceChildren();
  for (const [state, group] of groups) {
    const line = document.createElement("div"); line.className = "matrix-row";
    const label = document.createElement("span"); label.textContent = state; label.title = state; line.append(label);
    const tiles = document.createElement("div"); tiles.className = "tiles";
    for (const district of group) {
      const value = series(district, controls.outcome.value);
      const tile = document.createElement("button"); tile.type = "button";
      tile.className = `tile ${selected === `${district.state}|${district.district}` ? "selected" : ""}`;
      tile.style.background = colour(value, values, controls.mode.value);
      tile.title = `${district.district}, ${state}: ${value == null ? "no comparable observation" : fmt(value) + (controls.mode.value === "change" ? " pp" : "%")}`;
      tile.setAttribute("aria-label", tile.title); tile.addEventListener("click", () => select(`${district.state}|${district.district}`));
      tiles.append(tile);
    }
    line.append(tiles); container.append(line);
  }
}

function drawRanking(rows) {
  const target = $("ranking"); target.replaceChildren();
  const term = controls.search.value.trim().toLowerCase();
  const visible = rows.filter(r => `${r.district} ${r.state}`.toLowerCase().includes(term))
    .sort((a, b) => Math.abs(b.y) - Math.abs(a.y)).slice(0, 65);
  if (!visible.length) { target.textContent = "No matching district with both selected indicators."; return; }
  const bound = Math.max(...visible.map(r => Math.abs(r.y)), 1);
  for (const row of visible) {
    const button = document.createElement("button"); button.type = "button";
    button.className = `rank ${selected === row.key ? "selected" : ""}`;
    const value = controls.mode.value === "change" ? signed(row.y) : `${fmt(row.y)}%`;
    button.innerHTML = `<span>${escapeHtml(row.district)}<small>${escapeHtml(row.state)}</small></span><b class="${row.y < 0 ? "negative" : ""}">${value}</b><span class="mini-bar"><i style="width:${Math.abs(row.y) / bound * 100}%"></i></span>`;
    button.addEventListener("click", () => select(row.key)); target.append(button);
  }
}

function select(key) { selected = key; drawDetail(); drawMatrix(); drawRanking(observations); drawScatter(observations, fit(observations, fixedEffects)); }

function drawDetail() {
  const row = DATA.districts.find(d => `${d.state}|${d.district}` === selected);
  if (!row) { $("selection-title").textContent = "Choose a dot or tile"; $("detail").textContent = "See both rounds and the source behind the plotted point."; return; }
  $("selection-title").textContent = `${row.district}, ${row.state}`;
  const keys = [controls.outcome.value, controls.exposure.value];
  $("detail").innerHTML = `<p>Published district fact-sheet estimates. Missing values stay missing.</p><table><thead><tr><th>Indicator</th><th>NFHS-4</th><th>NFHS-5</th><th>Change</th></tr></thead><tbody>${keys.map(k => { const [a,b] = row.v[k]; return `<tr><th>${escapeHtml(DATA.indicators[k])}</th><td>${a == null ? "—" : fmt(a) + "%"}</td><td>${b == null ? "—" : fmt(b) + "%"}</td><td>${a == null || b == null ? "—" : signed(b-a)}</td></tr>`; }).join("")}</tbody></table><p class="caption">Source: MoHFW/IIPS district fact sheets, transcribed by Bhanu K Pratap Vardhan. Individual district PDF values await spot-checking.</p>`;
}

function update() {
  if (!DATA) return;
  if (controls.outcome.value === controls.exposure.value) controls.exposure.value = controls.outcome.value === "fuel" ? "sanitation" : "fuel";
  const v = controls;
  observations = DATA.districts.map(row => ({ ...row, key: `${row.state}|${row.district}`, x: series(row, v.exposure.value), y: series(row, v.outcome.value) }))
    .filter(row => row.x != null && row.y != null && (v.state.value === "all" || row.state === v.state.value));
  const model = fit(observations, fixedEffects);
  const stateCount = new Set(observations.map(r => r.state)).size;
  const difference = v.mode.value === "change";
  $("question").textContent = `Do districts with ${difference ? "larger changes in" : "higher"} ${DATA.indicators[v.exposure.value].toLowerCase()} also have ${difference ? "larger changes in" : "higher"} ${DATA.indicators[v.outcome.value].toLowerCase()}?`;
  $("count").textContent = observations.length;
  $("coverage").textContent = `${stateCount} states/UTs · ${difference ? "both rounds observed" : "NFHS-5 observed"}`;
  const medianValue = median(observations.map(r => difference ? r.v[v.outcome.value][1] - r.v[v.outcome.value][0] : r.y));
  $("median").textContent = difference ? signed(medianValue) : `${fmt(medianValue)}%`;
  $("median-title").textContent = difference ? "Median outcome change" : "Median outcome level";
  $("median-caption").textContent = difference ? "NFHS-5 − NFHS-4, matched districts" : "NFHS-5 level in matched districts";
  $("slope").textContent = model ? signed(model.slope * 10) : "—";
  $("slope-caption").textContent = model ? `Outcome per +10 ${difference ? "pp change in" : "pp of"} comparison · R² ${fmt(model.r2,2)}` : "Insufficient variation to fit a line";
  const influences = [...new Set(observations.map(o => o.state))].map(state => ({state, alt: fit(observations.filter(o => o.state !== state), fixedEffects)}))
    .filter(o => o.alt && model).sort((a,b) => Math.abs(b.alt.slope-model.slope)-Math.abs(a.alt.slope-model.slope));
  $("influence").textContent = influences.length ? `${fmt(influences[0].alt.slope * 10)} pp` : "—";
  $("influence-caption").textContent = influences.length ? `Slope without ${influences[0].state}; full: ${fmt(model.slope * 10)} pp` : "Leave-one-state-out unavailable";
  $("model-label").textContent = fixedEffects ? "Within-state association" : "Across-district association";
  $("scatter-foot").textContent = `${observations.length} districts · ${stateCount} states/UTs · ${fixedEffects ? "state-centred fitted slope" : "pooled fitted line"} · no causal claim`;
  $("matrix-caption").textContent = difference ? "NFHS-4 → 5, pp" : "NFHS-5 level, %";
  $("legend-left").textContent = difference ? "Fell" : "Lower"; $("legend-right").textContent = difference ? "Rose" : "Higher";
  $("matrix").parentElement.querySelector(".gradient").style.background = difference ? "linear-gradient(90deg,#b74d3d,#ebd7c8,#edf0ed,#b3d3ca,#176f77)" : "linear-gradient(90deg,#e3f3f0,#168083)";
  drawScatter(observations, model); drawMatrix(); drawRanking(observations); drawDetail();
  const params = new URLSearchParams({ y:v.outcome.value, x:v.exposure.value, mode:v.mode.value, state:v.state.value, fe:fixedEffects ? "1" : "0" });
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

$("fe").addEventListener("click", () => { fixedEffects = !fixedEffects; $("fe").setAttribute("aria-pressed", String(fixedEffects)); update(); });
for (const [key, input] of Object.entries(controls)) input.addEventListener(key === "search" ? "input" : "change", key === "search" ? () => drawRanking(observations) : update);
$("export").addEventListener("click", () => {
  const lines = [["state","district","outcome","comparison","round","outcome_value","comparison_value"]];
  for (const row of observations) lines.push([row.state,row.district,DATA.indicators[controls.outcome.value],DATA.indicators[controls.exposure.value],controls.mode.value,row.y,row.x]);
  const csv = lines.map(line => line.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"}), url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = "nfhs-district-observations.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
});

fetch("data.json").then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(data => {
  DATA = data;
  for (const state of [...new Set(data.districts.map(r => r.state))].sort()) controls.state.add(new Option(state,state));
  const query = new URLSearchParams(location.search);
  for (const [name,param] of [["outcome","y"],["exposure","x"],["mode","mode"],["state","state"]]) {
    if ([...controls[name].options].some(o => o.value === query.get(param))) controls[name].value = query.get(param);
  }
  fixedEffects = query.get("fe") === "1"; $("fe").setAttribute("aria-pressed", String(fixedEffects)); update();
}).catch(error => { $("question").textContent = `Data could not load: ${error.message}. Serve this directory with a local static server, for example python -m http.server 8000.`; });
