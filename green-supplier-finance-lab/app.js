import {
  MEASURES, decodeCaseBuffer, normalizeSelection, filterRank, sum,
  supplierEconomies, scenario, minimumBuyerShare, buildNarrative,
  attachUpstream, upstreamTotals, rankingsDiffer,
  formatMoney, formatMoneyPrecise, formatTonnes, formatTonnesPrecise, pct,
} from './core.js';

const REPO = 'https://github.com/rahulsh97/rahulsh97.github.io';
const LIVE = 'https://rahulsh97.github.io/green-supplier-finance-lab/';
const $ = id => document.getElementById(id);
const setText = (id, v) => { const e = $(id); if (e) e.textContent = v; };

let manifest = null;
let caseData = null;
let MULT = null;          // { code: [g, m] } per-sector 2022 multiplier table
let basis = 'direct';     // exposure lens: 'direct' | 'alltier' (never affects finance)
let loadingToken = 0;

// ---- URL state ---------------------------------------------------------------
function readUrl() {
  const p = new URLSearchParams(location.search);
  return { economy: p.get('economy'), industry: p.get('industry'),
           supplier: p.get('supplier') || '', sort: p.get('sort') || 'emissions' };
}
function writeUrl() {
  const p = new URLSearchParams();
  p.set('economy', $('economy').value);
  p.set('industry', $('industry').value);
  if ($('supplier').value) p.set('supplier', $('supplier').value);
  if ($('sort').value !== 'emissions') p.set('sort', $('sort').value);
  history.replaceState(null, '', '?' + p.toString());
}

// ---- selectors ---------------------------------------------------------------
function industryLabel(code) { return manifest.industries[code] || code; }
function economyLabel(code) { return manifest.countries[code] || code; }

function fillEconomySelect(selected) {
  const codes = Object.keys(manifest.cases).sort((a, b) => economyLabel(a).localeCompare(economyLabel(b)));
  $('economy').replaceChildren(...codes.map(c => new Option(`${economyLabel(c)} (${c})`, c)));
  $('economy').value = selected;
}
function fillIndustrySelect(economy, selected) {
  const inds = manifest.cases[economy] || [];
  $('industry').replaceChildren(...inds.map(i => new Option(`${industryLabel(i)} (${i})`, i)));
  $('industry').value = selected;
}
function fillSupplierSelect() {
  const economies = supplierEconomies(caseData);
  const opts = [new Option('All foreign supplier economies', '')];
  for (const c of economies.sort((a, b) => economyLabel(a).localeCompare(economyLabel(b)))) {
    opts.push(new Option(`${economyLabel(c)} (${c})`, c));
  }
  const cur = $('supplier').value;
  $('supplier').replaceChildren(...opts);
  $('supplier').value = economies.includes(cur) ? cur : '';
}

// ---- case loading ------------------------------------------------------------
async function loadCase(code) {
  const token = ++loadingToken;
  setText('activeCase', `Loading ${code}…`);
  try {
    const res = await fetch(`./data/cases/${code}.json.gz`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await decodeCaseBuffer(await res.arrayBuffer());
    if (token !== loadingToken) return;            // a newer selection superseded this one
    caseData = data;
    $('results').hidden = false;
    ['supplier', 'sort'].forEach(id => { $(id).disabled = false; });
    fillSupplierSelect();
    updateActiveCase();
    render();
  } catch (err) {
    if (token !== loadingToken) return;
    setText('activeCase', `Could not load ${code}: ${err.message}`);
    $('results').hidden = true; caseData = null;
  }
}

function updateActiveCase() {
  const c = caseData;
  $('activeCase').innerHTML = `<span class="ac-label">Buyer:</span> `
    + `${economyLabel(c.country)} · ${industryLabel(c.industry)} · ${c.year} `
    + `<span class="ac-code">${c.buyer}</span>`;
}

// ---- render ------------------------------------------------------------------
function currentSliders() {
  return { reduction: +$('reduction').value, cost: +$('cost').value,
           buyerShare: +$('buyerShare').value, threshold: +$('threshold').value };
}

function render() {
  if (!caseData) return;
  const supplier = $('supplier').value;
  const measure = $('sort').value;
  const links = filterRank(caseData, supplier, measure);
  attachUpstream(links, MULT);
  const { reduction, cost, buyerShare, threshold } = currentSliders();
  setText('reductionOut', reduction + '%'); setText('costOut', '$' + cost);
  setText('buyerShareOut', buyerShare + '%'); setText('thresholdOut', threshold + '%');

  // headline cards (active supplier filter)
  const inInput = sum(links, 'input'), inEmit = sum(links, 'ghg'), inVa = sum(links, 'va');
  setText('mInput', formatMoney(inInput)); $('mInput').title = formatMoneyPrecise(inInput);
  setText('mEmit', formatTonnes(inEmit)); $('mEmit').title = formatTonnesPrecise(inEmit);
  setText('mVa', formatMoney(inVa)); $('mVa').title = formatMoneyPrecise(inVa);

  // coverage = FULL buyer case (does not change with supplier filter)
  const t = caseData.totals;
  setText('mCov', pct(t.input_value_share));
  setText('covNote', `Full buyer-case coverage · ${t.matched_link_count.toLocaleString('en')} matched and `
    + `${t.excluded_link_count.toLocaleString('en')} excluded foreign links; `
    + `${pct(t.input_value_share)} of foreign input value has usable GHG and VA. `
    + `This is the whole buyer case and does not change when one supplier economy is shown.`);

  // scenario
  const scen = links.map(l => scenario(l, reduction, cost, buyerShare));
  const investment = scen.reduce((a, s) => a + s.investment, 0);
  setText('investment', formatMoney(investment)); $('investment').title = formatMoneyPrecise(investment);
  setText('buyerCost', formatMoney(investment * buyerShare / 100));
  setText('supplierCost', formatMoney(investment * (1 - buyerShare / 100)));
  $('buyerBar').style.width = buyerShare + '%'; $('supplierBar').style.width = (100 - buyerShare) + '%';

  // exposure bars — top 9, lens set by the basis toggle (direct or all-tier)
  const allTierBasis = basis === 'alltier';
  const emitVal = l => (allTierBasis && l.hasMult ? l.allTier : l.ghg);
  const byEmit = [...links].sort((a, b) => emitVal(b) - emitVal(a));
  const top = byEmit.slice(0, 9);
  const max = Math.max(...top.map(emitVal), 1);
  $('bars').replaceChildren(...top.map(l => {
    const row = document.createElement('div'); row.className = 'bar-row';
    const name = document.createElement('span'); name.className = 'name';
    name.textContent = `${economyLabel(l.country)} · ${industryLabel(l.industry)}`;
    name.title = `${l.code} — ${economyLabel(l.country)} · ${industryLabel(l.industry)}`;
    const track = document.createElement('div'); track.className = 'track';
    if (allTierBasis && l.hasMult) {
      const vis = document.createElement('div'); vis.className = 'fill';
      vis.style.width = (100 * l.ghg / max) + '%';
      const dp = document.createElement('div'); dp.className = 'fill deep';
      dp.style.width = (100 * l.deeper / max) + '%';
      track.append(vis, dp);
    } else {
      const fill = document.createElement('div'); fill.className = 'fill';
      fill.style.width = (100 * l.ghg / max) + '%'; track.append(fill);
    }
    const n = document.createElement('b'); n.textContent = formatTonnes(emitVal(l));
    row.append(name, track, n); return row;
  }));

  const up = renderUpstream(links);

  // diagnostic
  const need = scen.map((s, i) => minimumBuyerShare(links[i], s.investment, threshold));
  renderPolicy(links, byEmit, scen, need, { reduction, cost, buyerShare, threshold, investment, supplier }, up);
  renderTable(links, scen, need, { threshold });
  updateEvidenceSummary(links.length, supplier);
  writeUrl();
}

function renderUpstream(links) {
  const t = upstreamTotals(links);
  const has = t.all > 0 && t.covered > 0;
  setText('upDirect', has ? formatTonnes(t.direct) : '—');
  setText('upDeeper', has ? formatTonnes(t.deeper) : '—');
  setText('upAll', has ? formatTonnes(t.all) : '—');
  setText('upVis', has && t.visibility !== null ? pct(t.visibility) : '—');
  if (has) {
    $('upDirect').title = formatTonnesPrecise(t.direct);
    $('upDeeper').title = formatTonnesPrecise(t.deeper);
    $('upAll').title = formatTonnesPrecise(t.all);
  }
  // stacked bars: leading first-tier channels by all-tier, split visible/deeper
  const withM = links.filter(l => l.hasMult);
  const topAll = [...withM].sort((a, b) => b.allTier - a.allTier).slice(0, 8);
  const max = Math.max(...topAll.map(l => l.allTier), 1);
  $('upBars').replaceChildren(...topAll.map(l => {
    const row = document.createElement('div'); row.className = 'bar-row';
    const name = document.createElement('span'); name.className = 'name';
    name.textContent = `${economyLabel(l.country)} · ${industryLabel(l.industry)}`;
    name.title = `${l.code} — ${economyLabel(l.country)} · ${industryLabel(l.industry)}`;
    const track = document.createElement('div'); track.className = 'track';
    const vis = document.createElement('div'); vis.className = 'fill';
    vis.style.width = (100 * l.ghg / max) + '%';
    const dp = document.createElement('div'); dp.className = 'fill deep';
    dp.style.width = (100 * l.deeper / max) + '%';
    track.append(vis, dp);
    const n = document.createElement('b'); n.textContent = formatTonnes(l.allTier);
    row.append(name, track, n); return row;
  }));
  const diff = rankingsDiffer(links);
  setText('upNote', !has ? 'No multiplier available for the current selection.'
    : `${t.covered.toLocaleString('en')} of ${t.total.toLocaleString('en')} links carry an all-tier multiplier`
      + `${t.missing ? ` (${t.missing} without one, shown as “no data”, never zero)` : ''}. `
      + `Ranking by direct and by all-tier emissions ${diff ? 'differ' : 'agree'} for the leading link. `
      + `All-tier levels are modelled estimates; see methods for the 2020 validation and its tolerance.`);
  if (!has) return null;
  const top = topAll[0];
  return {
    visibility: t.visibility, rankingsDiffer: diff,
    topAllTier: { name: `${economyLabel(top.country)} · ${industryLabel(top.industry)}`, code: top.code, allTier: top.allTier },
  };
}

function renderPolicy(links, byEmit, scen, need, s, up) {
  const supplierScope = s.supplier ? economyLabel(s.supplier) : 'All foreign supplier economies';
  const named = l => ({ name: `${economyLabel(l.country)} · ${industryLabel(l.industry)}`, code: l.code,
                        ghg: l.ghg, input: l.input, va: l.va });
  const byInput = [...links].sort((a, b) => b.input - a.input);
  const byVa = [...links].sort((a, b) => b.va - a.va);
  const totalEmit = sum(links, 'ghg');
  const top5 = byEmit.slice(0, 5).reduce((a, l) => a + l.ghg, 0);
  // most exposed = link that most needs buyer support (highest required buyer
  // share), tie-broken by absolute supplier burden. Robust to near-zero VA.
  let mostExposed = null, minShare = null, exposedIdx = -1;
  let bestNeed = -Infinity, bestBurden = -Infinity, countAbove = 0;
  links.forEach((l, i) => {
    if (need[i] !== null && need[i] > s.buyerShare + 1e-9) countAbove++;
    if (scen[i].investment > 0) {
      const ndScore = need[i] === null ? -1 : need[i];
      if (ndScore > bestNeed || (ndScore === bestNeed && scen[i].supplier > bestBurden)) {
        bestNeed = ndScore; bestBurden = scen[i].supplier; exposedIdx = i;
      }
    }
  });
  if (exposedIdx >= 0) {
    const l = links[exposedIdx];
    mostExposed = { name: `${economyLabel(l.country)} · ${industryLabel(l.industry)}`, code: l.code,
                    burdenOverVa: l.va > 0 ? scen[exposedIdx].supplier / l.va : NaN };
    minShare = minimumBuyerShare(l, scen[exposedIdx].investment, s.threshold);
  }
  const ctx = {
    countryName: economyLabel(caseData.country), industryName: industryLabel(caseData.industry),
    buyerCode: caseData.buyer, supplierScope,
    matchedInput: sum(links, 'input'), usableLinks: links.length,
    topEmit: links.length ? named(byEmit[0]) : null,
    topInput: links.length ? named(byInput[0]) : null,
    topVa: links.length ? named(byVa[0]) : null,
    top5EmitShare: totalEmit > 0 ? top5 / totalEmit : NaN,
    reduction: s.reduction, cost: s.cost, investment: s.investment,
    buyerAmount: s.investment * s.buyerShare / 100, supplierAmount: s.investment * (1 - s.buyerShare / 100),
    buyerShare: s.buyerShare, ceiling: s.threshold, countAbove,
    shareAbove: links.length ? countAbove / links.length : 0,
    mostExposed, minShareMostExposed: minShare,
    upstream: up,
  };
  const paras = buildNarrative(ctx);
  $('policy').replaceChildren(...paras.map(p => {
    const d = document.createElement('div'); d.className = 'policy-para';
    const h = document.createElement('h3'); h.textContent = p.heading;
    const t = document.createElement('p'); t.textContent = p.text;
    d.append(h, t); return d;
  }));
}

const MAX_ROWS = 400;
function renderTable(links, scen, need, s) {
  const shown = links.slice(0, MAX_ROWS);
  $('rows').replaceChildren(...shown.map((l, i) => {
    const tr = document.createElement('tr');
    const burden = scen[i].supplier;
    const cells = [
      `${economyLabel(l.country)} · ${industryLabel(l.industry)}`,
      formatMoney(l.input), formatTonnes(l.ghg),
      l.hasMult ? formatTonnes(l.deeper) : '—',
      l.hasMult ? formatTonnes(l.allTier) : '—',
      l.hasMult && l.visibility !== null ? pct(l.visibility) : '—',
      l.hasMult ? 'in-network' : 'no multiplier',
      formatMoney(l.va),
      formatMoney(burden),
      l.va > 0 ? pct(burden / l.va) : (burden > 0 ? '∞' : '—'),
      need[i] === null ? '—' : need[i].toFixed(0) + '%',
    ];
    cells.forEach((v, ci) => {
      const td = document.createElement('td'); td.textContent = v;
      if (ci === 0) { td.title = l.code; td.className = 'supplier-cell'; }
      tr.append(td);
    });
    return tr;
  }));
  const extra = links.length > MAX_ROWS ? ` Showing the top ${MAX_ROWS}; the download includes all ${links.length.toLocaleString('en')}.` : '';
  setText('tableNote', `${links.length.toLocaleString('en')} matched link${links.length === 1 ? '' : 's'} in this view.${extra} `
    + `${caseData.totals.excluded_link_count.toLocaleString('en')} foreign links are excluded from the full case (missing GHG or negative VA) and never counted as zero.`);
}

function updateEvidenceSummary(n, supplier) {
  const where = supplier ? `from ${economyLabel(supplier)}` : 'from all foreign economies';
  setText('evidenceSummary', `View ${n.toLocaleString('en')} matched supplier-industry link${n === 1 ? '' : 's'} ${where}`);
}

// ---- download (complete active selection) -----------------------------------
function downloadCsv() {
  if (!caseData) return;
  const supplier = $('supplier').value, measure = $('sort').value;
  const links = filterRank(caseData, supplier, measure);
  attachUpstream(links, MULT);
  const { reduction, cost, buyerShare, threshold } = currentSliders();
  const meta = [
    ['# tool', 'Green Supplier Finance Lab'],
    ['# creator', 'Rahul Shukla'],
    ['# engineering_assistance', 'OpenAI Codex and Anthropic Claude Code'],
    ['# repository', REPO],
    ['# live_url', LIVE],
    ['# oecd_sources', `${manifest.sources.icio.name}; ${manifest.sources.ghg.name}`],
    ['# year', String(caseData.year)],
    ['# buyer', `${economyLabel(caseData.country)} · ${industryLabel(caseData.industry)} (${caseData.buyer})`],
    ['# supplier_filter', supplier ? `${economyLabel(supplier)} (${supplier})` : 'All foreign supplier economies'],
    ['# value_status', 'input_usd_m=PUBLISHED; alloc_*/all_tier/deeper=MODELLED; scenario_*=ASSUMED (hypothetical)'],
    ['# upstream', 'all_tier = supplier all-tier multiplier x input; deeper = all_tier - direct; financing uses direct first-tier only'],
    ['# scenario', `reduction=${reduction}%; cost_per_tonne=$${cost}; buyer_share=${buyerShare}%; ceiling=${threshold}% of allocated VA`],
    ['# generated', new Date().toISOString()],
    ['# rows', String(links.length)],
  ].map(r => r.join(',')).join('\n');
  const header = ['supplier_code', 'supplier_economy', 'supplier_sector',
    'input_usd_m', 'alloc_direct_ghg_t', 'deeper_upstream_ghg_t', 'all_tier_ghg_t',
    'direct_visibility_share', 'multiplier_status', 'alloc_va_usd_m',
    'scenario_investment_usd_m', 'scenario_buyer_usd_m', 'scenario_supplier_usd_m',
    'burden_over_alloc_va', 'min_buyer_share_pct_at_ceiling'].join(',');
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = links.map(l => {
    const sc = scenario(l, reduction, cost, buyerShare);
    const need = minimumBuyerShare(l, sc.investment, threshold);
    return [l.code, q(economyLabel(l.country)), q(industryLabel(l.industry)),
      l.input, l.ghg,
      l.hasMult ? l.deeper : '', l.hasMult ? l.allTier : '',
      l.hasMult && l.visibility !== null ? l.visibility : '', l.hasMult ? 'in-network' : 'no_multiplier',
      l.va, sc.investment, sc.buyer, sc.supplier,
      l.va > 0 ? sc.supplier / l.va : '', need === null ? '' : need].join(',');
  });
  const csv = meta + '\n' + header + '\n' + lines.join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `gsfl-${caseData.buyer}-${supplier || 'all'}-${caseData.year}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- codebook modal ----------------------------------------------------------
function openCodebook() {
  $('codebookModal').hidden = false;
  renderCodebook('industries', '');
  $('codebookSearch').value = '';
  $('codebookSearch').focus();
  document.addEventListener('keydown', escClose);
}
function closeCodebook() {
  $('codebookModal').hidden = true;
  document.removeEventListener('keydown', escClose);
  $('codebook').focus();
}
function escClose(e) { if (e.key === 'Escape') closeCodebook(); }
function activeTab() { return document.querySelector('.cbtab.active').dataset.tab; }
function renderCodebook(tab, query) {
  const rowsEl = $('codebookRows');
  const q = (query || '').toLowerCase();
  let entries;
  if (tab === 'countries') {
    entries = Object.entries(manifest.countries).map(([c, n]) => [c, n, 'Economy (OECD ICIO area)']);
  } else {
    entries = Object.entries(manifest.industries).map(([c, n]) => [c, n, manifest.isic[c] ? 'ISIC Rev.4 ' + manifest.isic[c] : '—']);
  }
  entries = entries.filter(([c, n, k]) => !q || c.toLowerCase().includes(q) || n.toLowerCase().includes(q) || k.toLowerCase().includes(q));
  rowsEl.replaceChildren(...entries.map(([c, n, k]) => {
    const tr = document.createElement('tr');
    [c, n, k].forEach((v, i) => { const td = document.createElement('td'); td.textContent = v; if (i === 0) td.className = 'mono'; tr.append(td); });
    return tr;
  }));
}

// ---- events ------------------------------------------------------------------
function onEconomyChange() {
  const economy = $('economy').value;
  const inds = manifest.cases[economy] || [];
  const keep = inds.includes($('industry').value) ? $('industry').value : inds[0];
  fillIndustrySelect(economy, keep);
  loadCase(`${economy}_${keep}`);
}
function onIndustryChange() { loadCase(`${$('economy').value}_${$('industry').value}`); }

function wire() {
  $('economy').addEventListener('change', onEconomyChange);
  $('industry').addEventListener('change', onIndustryChange);
  ['supplier', 'sort', 'reduction', 'cost', 'buyerShare', 'threshold']
    .forEach(id => $(id).addEventListener('input', render));
  $('download').addEventListener('click', downloadCsv);
  $('codebook').addEventListener('click', openCodebook);
  $('codebookClose').addEventListener('click', closeCodebook);
  $('codebookModal').addEventListener('click', e => { if (e.target === $('codebookModal')) closeCodebook(); });
  $('codebookSearch').addEventListener('input', () => renderCodebook(activeTab(), $('codebookSearch').value));
  document.querySelectorAll('.cbtab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.cbtab').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); renderCodebook(b.dataset.tab, $('codebookSearch').value);
  }));
  const setBasis = b => {
    basis = b;
    $('basisDirect').classList.toggle('active', b === 'direct');
    $('basisAll').classList.toggle('active', b === 'alltier');
    $('basisDirect').setAttribute('aria-pressed', String(b === 'direct'));
    $('basisAll').setAttribute('aria-pressed', String(b === 'alltier'));
    render();   // changes the exposure chart + narrative; never the financing figures
  };
  $('basisDirect').addEventListener('click', () => setBasis('direct'));
  $('basisAll').addEventListener('click', () => setBasis('alltier'));
}

async function boot() {
  try {
    manifest = await (await fetch('./data/manifest.json')).json();
  } catch (err) {
    setText('activeCase', 'Could not load the buyer manifest: ' + err.message);
    return;
  }
  setText('caseCountBadge', manifest.buyer_count.toLocaleString('en'));
  try {
    const r = await fetch('./data/multipliers_2022.json.gz');
    if (r.ok) MULT = (await decodeCaseBuffer(await r.arrayBuffer())).sectors;
  } catch { MULT = null; }   // the upstream module degrades gracefully if absent
  const src = $('sources');
  src.replaceChildren(document.createTextNode('Sources: '));
  for (const [label, url] of [[manifest.sources.icio.name, manifest.sources.icio.url],
                              [manifest.sources.ghg.name, manifest.sources.ghg.url]]) {
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = label; src.append(a, document.createTextNode(' · '));
  }
  src.append(document.createTextNode('OECD remains the source of the underlying accounts. See the manifest for file SHA-256 hashes and the excluded-link counts per case.'));

  const u = readUrl();
  const norm = normalizeSelection(manifest, u.economy, u.industry);
  fillEconomySelect(norm.economy);
  fillIndustrySelect(norm.economy, norm.industry);
  $('economy').disabled = false; $('industry').disabled = false;
  $('sort').value = ['emissions', 'flow', 'va'].includes(u.sort) ? u.sort : 'emissions';
  wire();
  await loadCase(norm.code);
  if (u.supplier && supplierEconomies(caseData).includes(u.supplier)) {
    $('supplier').value = u.supplier; render();
  }
}

boot();
