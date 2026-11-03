'use strict';
// Pure analysis functions for Policy Diagnostics Studio (no DOM). Loaded by the browser app and by node tests.
// The allocation arithmetic is a verbatim port of the v0.1 funding diagnostic (allocation.html, state()):
//   poor_i = N_i * p_i / 100; population weight = N_i / ΣN; poor-population weight = poor_i / Σpoor;
//   blend = (1 - α) * population weight + α * poor weight; allocation_i = budget * weight_i.
(function (root) {
  const LINES = {
    poverty_rate: {key: 'poverty_rate', spid: 'wb_spid:spid_poor300', label: '$3.00 a day', long: 'international poverty line of $3.00 a day (2021 purchasing-power prices)'},
    poor420: {key: 'poor420', spid: 'wb_spid:spid_poor420', label: '$4.20 a day', long: 'lower-middle-income line of $4.20 a day (2021 purchasing-power prices)'},
    poor830: {key: 'poor830', spid: 'wb_spid:spid_poor830', label: '$8.30 a day', long: 'upper-middle-income line of $8.30 a day (2021 purchasing-power prices)'},
  };
  const LEVEL = {ADM1: 'first-level administrative areas', ADM2: 'second-level administrative areas', SURVEY_REGION: 'survey regions',
    SURVEY_REGION_L2: 'survey sub-regions', NUTS1: 'NUTS 1 regions', NUTS2: 'NUTS 2 regions', NUTS3: 'NUTS 3 regions', ADM0: 'national'};
  const SPENDING_CATEGORIES = {
    total: {id: 'br_siconfi:exp_liq_total_ex_intra', label: 'All state spending'},
    f10: {id: 'br_siconfi:exp_liq_f10', label: 'Health'},
    f12: {id: 'br_siconfi:exp_liq_f12', label: 'Education'},
    f08: {id: 'br_siconfi:exp_liq_f08', label: 'Social assistance'},
  };

  function allocation(rows, budget, mode, mix) {
    const pop = rows.reduce((s, r) => s + r.population, 0);
    const poor = rows.reduce((s, r) => s + r.population * r.poverty_rate / 100, 0);
    const out = rows.map(r => {
      const n = r.population * r.poverty_rate / 100, ps = r.population / pop, ns = poor > 0 ? n / poor : ps;
      const share = mode === 'population' ? ps : mode === 'poor' ? ns : (1 - mix) * ps + mix * ns;
      return {...r, poor: n, popShare: ps, poorShare: ns, spendPer: r.spending == null ? null : r.spending / r.population,
        share, allocation: budget * share, allocationPer: budget * share / r.population};
    });
    return {pop, poor, rows: out, budget, mode, mix};
  }

  function weightedRate(rows, key = 'poverty_rate') {
    const pop = rows.reduce((s, r) => s + r.population, 0);
    return pop > 0 ? rows.reduce((s, r) => s + r.population * r[key], 0) / pop : null;
  }

  // Runnable diagnostic sets (compatibility engine outcome DIRECT/TRANSFORM, with prepared rows)
  function runnable(doc, id) {
    return doc.diagnostics.filter(d => (!id || d.id === id) && d.rows && (d.class === 'DIRECT' || d.class === 'TRANSFORM'));
  }

  function setLabel(d) {
    return `${d.year} · ${d.survey} survey · ${d.n_units} ${LEVEL[d.level] || d.level}`;
  }

  // Subnational periods of an indicator, excluding duplicates by breakdown; newest last
  function periods(doc, id) { return (doc.subnational[id] || []).slice().sort((a, b) => a.y - b.y); }

  // Poverty survey sets available without population (descriptive). One per (year, breakdown, level).
  function povertySets(doc) {
    return periods(doc, 'wb_spid:spid_poor300').map((p, k) => ({k, year: p.y, survey: (p.b.match(/survey=([^;]+)/) || [])[1] || '',
      welfare: (p.b.match(/welfare=([^;]+)/) || [])[1] || '', level: p.lv, n: p.u.length, bv: p.bv, period: p}));
  }

  function valuesFor(doc, id, year, codes, breakdownSurvey) {
    const ps = periods(doc, id).filter(p => p.y === year && (!breakdownSurvey || p.b.includes('survey=' + breakdownSurvey)));
    const m = new Map();
    for (const p of ps) for (const u of p.u) if (!codes || codes.has(u[0])) if (!m.has(u[0])) m.set(u[0], {name: u[1], v: u[2], lo: u[3], hi: u[4]});
    return m;
  }

  function rankSummary(rows, key) {
    const xs = rows.filter(r => r[key] != null && isFinite(r[key])).slice().sort((a, b) => b[key] - a[key]);
    if (!xs.length) return null;
    const hi = xs[0], lo = xs[xs.length - 1];
    return {highest: hi, lowest: lo, ratio: lo[key] > 0 ? hi[key] / lo[key] : null, gap: hi[key] - lo[key], n: xs.length};
  }

  function concentration(rows, topN = 5) {
    const a = allocation(rows, 0, 'population', 0);
    const byPoor = a.rows.slice().sort((x, y) => y.poor - x.poor);
    const top = byPoor.slice(0, Math.min(topN, byPoor.length));
    return {poor: a.poor, pop: a.pop, top, topShare: a.poor > 0 ? top.reduce((s, r) => s + r.poor, 0) / a.poor : null,
      topPopShare: top.reduce((s, r) => s + r.population, 0) / a.pop};
  }

  // Observed spending vs need (Brazil): shares of spending and of poor people by state
  function spendingAlignment(rows) {
    const totS = rows.reduce((s, r) => s + r.spending, 0);
    const a = allocation(rows, 0, 'population', 0);
    return a.rows.map(r => ({...r, spendShare: r.spending / totS, spendPer: r.spending / r.population, gapShare: r.spending / totS - r.poorShare}));
  }

  // Build a spending layer for a SICONFI category, mapped to SPID units through the documented crosswalk.
  function siconfiLayer(doc, catKey, year, setCodes) {
    const cat = SPENDING_CATEGORIES[catKey];
    const per = periods(doc, cat.id).find(p => p.y === year);
    if (!per) return null;
    const xw = new Map();
    for (const [spid, iso] of doc.crosswalk_iso3166_2) if (setCodes.has(spid)) xw.set(iso, spid);
    return {rows: per.u.map(u => ({code: u[0], spending: u[2]})), crosswalk: xw, indicator: cat.id, label: cat.label};
  }

  function nationalSeries(doc, id, prefer) {
    const s = doc.national.filter(x => x.i === id);
    if (!s.length) return null;
    return (prefer && s.find(x => prefer(x.b))) || s.find(x => x.b === 'total') || s[0];
  }

  function latest(series) {
    if (!series) return null;
    const d = series.d.filter(p => p[1] != null && p[4] !== 'p');
    return d.length ? {year: d[d.length - 1][0], value: d[d.length - 1][1]} : null;
  }

  // What each question area can do for this country (only what the data support).
  function capabilities(doc, info) {
    const d1 = runnable(doc, 'D1'), d2 = runnable(doc, 'D2');
    const spid = povertySets(doc);
    const dhs = Object.keys(doc.subnational).filter(k => k.startsWith('dhs_api:'));
    const mpm = Object.keys(doc.subnational).filter(k => k.startsWith('wb_spid:mpm_'));
    const chirps = periods(doc, 'chirps:precip_anomaly_pct');
    const pip = nationalSeries(doc, 'wb_pip:headcount_300', b => b.startsWith('area=national'));
    const spendNat = nationalSeries(doc, 'wb_wdi:GC.XPN.TOTL.GD.ZS');
    return {
      poverty: spid.length ? {level: 'full', badge: 'Regional analysis', detail: `${spid.length} survey rounds of regional poverty estimates (${spid[0].year}–${spid[spid.length - 1].year})${d1.length ? '; population-weighted counts of poor people available for ' + [...new Set(d1.map(x => x.year))].join(', ') : ''}.`}
        : pip ? {level: 'national', badge: 'National only', detail: 'Only national poverty estimates exist; no verified regional estimates.'}
        : {level: 'none', badge: 'Not available', detail: 'No poverty estimates in the warehouse for this country.'},
      spending: d2.length ? {level: 'full', badge: 'Observed spending vs need', detail: `State-government spending compared with poverty for ${d2.map(x => x.year).join(', ')}; hypothetical allocation rules also available.`}
        : d1.length ? {level: 'partial', badge: 'Hypothetical allocation only', detail: 'Need-based allocation rules can be compared. Observed spending by region is not available, so no spending comparison is made.'}
        : spendNat ? {level: 'national', badge: 'National context only', detail: 'National public-spending indicators only; no regional analysis possible.'}
        : {level: 'none', badge: 'Not available', detail: 'No public-spending data for this country.'},
      human: (dhs.length || mpm.length) ? {level: 'full', badge: 'Regional analysis', detail: `${dhs.length ? dhs.length + ' health and demographic survey indicators by region' : ''}${dhs.length && mpm.length ? '; ' : ''}${mpm.length ? 'regional deprivation in education, water, sanitation and electricity' : ''}.`}
        : {level: 'national', badge: 'National only', detail: 'National indicators only.'},
      climate: chirps.length && spid.length ? {level: 'full', badge: 'Descriptive context', detail: `Annual rainfall and rainfall anomalies by area (${chirps[0].y}–${chirps[chirps.length - 1].y}).`}
        : {level: 'none', badge: 'Not available', detail: chirps.length ? 'Rainfall data exist but no regional poverty estimates to set them against.' : 'No regional rainfall summaries (outside 50°S–50°N or no matched boundaries).'},
      d1, d2, spid, dhs, mpm, chirps,
    };
  }

  // DHS publishes two nested levels in one table; sub-region labels start with '..'. Never mix them in one chart.
  function splitLevels(units) {
    const top = units.filter(u => !String(u[1]).startsWith('..')), sub = units.filter(u => String(u[1]).startsWith('..'));
    return {top, sub, mixed: top.length > 0 && sub.length > 0};
  }

  function csv(rows, cols, header) {
    const q = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return (header || []).map(h => '# ' + h).concat([cols.map(c => c[1]).join(','), ...rows.map(r => cols.map(c => q(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))]).join('\r\n');
  }

  const api = {LINES, LEVEL, SPENDING_CATEGORIES, allocation, weightedRate, runnable, setLabel, periods, povertySets, valuesFor,
    rankSummary, concentration, spendingAlignment, splitLevels, siconfiLayer, nationalSeries, latest, capabilities, csv};
  if (typeof module !== 'undefined') module.exports = api; else root.PDS = api;
})(typeof window !== 'undefined' ? window : globalThis);
