'use strict';
// Policy Diagnostics Studio — warehouse-first single entry point.
// Routes: #/  ·  #/c/ISO3  ·  #/c/ISO3/<poverty|spending|human|climate|data>  ·  #/sources
// evidence_engine.js (loaded first) provides the browser compatibility engine `assess` and globals `$`/`esc`.
(function () {
  const P = window.PDS, Ch = window.Charts, E = Ch.esc, F = Ch.fmt;
  const main = document.getElementById('main');
  const S = {countries: null, catalog: null, ind: new Map(), src: new Map(), docs: new Map(), geo: new Map(), opt: {}};
  const AREAS = {
    poverty: {title: 'Regional poverty and inequality', q: 'Where is poverty highest, and where do most poor people live?'},
    spending: {title: 'Public expenditure and geographic need', q: 'How does public money line up with where poor people live?'},
    human: {title: 'Health, education and human development', q: 'How do health, nutrition and basic services differ across regions?'},
    climate: {title: 'Climate exposure and regional vulnerability', q: 'Which areas had unusual rainfall, and how poor are they?'},
  };
  const FEATURED = [['BRA', 'Brazil', 'spending vs need'], ['KEN', 'Kenya', '47 counties'], ['MWI', 'Malawi', 'districts'], ['IND', 'India', 'states'], ['PER', 'Peru', 'regions'], ['NGA', 'Nigeria', 'states']];
  const KIND = {
    descriptive: ['Descriptive evidence', 'Published survey estimates, shown as they are. No model is applied.', ''],
    hypothetical: ['Hypothetical allocation', 'A funding formula applied to need indicators. It shows how money would be divided — not what it would achieve.', 'hyp'],
    observed: ['Observed expenditure comparison', 'Actual government spending recorded in public accounts, compared with need.', 'obs'],
    context: ['Descriptive context', 'Context indicators shown side by side. No causal relationship is implied.', ''],
  };

  // ---------------------------------------------------------------- data loading
  async function getJSON(u) { const r = await fetch(u, {cache: 'no-cache'}); if (!r.ok) throw Error(`${u}: HTTP ${r.status}`); return r.json(); }
  async function countries() { if (!S.countries) S.countries = (await getJSON('data/countries.json')).countries; return S.countries; }
  function catalog() {
    if (!S.catPromise) S.catPromise = getJSON('data/catalog.json').then(c => { S.catalog = c; c.indicators.forEach(i => S.ind.set(i.id, i)); c.sources.forEach(s => S.src.set(s.source_id, s)); return c; });
    return S.catPromise;
  }
  async function doc(iso) { if (!S.docs.has(iso)) S.docs.set(iso, await getJSON(`data/country/${iso}.json`)); return S.docs.get(iso); }
  async function geo(iso) { if (!S.geo.has(iso)) { try { S.geo.set(iso, await getJSON(`data/geo/${iso}.json`)); } catch (e) { S.geo.set(iso, null); } } return S.geo.get(iso); }
  // Default poverty line follows World Bank practice for the country's income group (user can change it).
  const defaultLine = info => /upper middle|high/i.test(info.income || '') ? 'poor830' : /lower middle/i.test(info.income || '') ? 'poor420' : 'poverty_rate';
  const title = id => (S.ind.get(id)?.t || id).replace(/ \((SPID, )?subnational\)$/, '');

  // ---------------------------------------------------------------- router
  function parse() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, query] = h.split('?');
    const seg = path.split('/').filter(Boolean);
    return {seg, q: Object.fromEntries(new URLSearchParams(query || ''))};
  }
  function setQuery(obj) {
    const {seg} = parse();
    const q = new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    history.replaceState(null, '', '#/' + seg.join('/') + (q.toString() ? '?' + q : ''));
  }
  async function route() {
    const {seg, q} = parse();
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', (a.dataset.nav === 'sources') === (seg[0] === 'sources') && a.dataset.nav !== 'own' && a.dataset.nav !== 'ai' && a.dataset.nav !== 'research' && a.dataset.nav !== 'assistant'));
    try {
      if (seg[0] === 'sources') return await viewSources(q);
      if (seg[0] === 'c' && seg[1]) {
        const iso = seg[1].toUpperCase();
        const list = await countries();
        const info = list.find(c => c.iso3 === iso);
        if (!info) return notFound(iso);
        main.innerHTML = '<div class="loading">Loading verified data for ' + E(info.name) + '…</div>';
        const d = await doc(iso);
        catalog();
        const area = seg[2];
        if (!area) return viewCountry(info, d);
        if (area === 'data') return await viewData(info, d, q);
        if (AREAS[area]) return await viewArea(area, info, d, q);
        return viewCountry(info, d);
      }
      return await viewHome();
    } catch (e) {
      main.innerHTML = `<div class="card"><h2>Something went wrong loading the data</h2><p>${E(e.message)}</p>
        <p class="muted">If you opened this file directly from disk, serve the <span class="mono">app</span> folder over http (for example <span class="mono">python -m http.server -d app 8000</span>) — browsers block local data files.</p></div>`;
    }
  }
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
  function notFound(iso) { main.innerHTML = `<div class="card"><h2>No data for “${E(iso)}”</h2><p><a href="#/">Choose another country</a>.</p></div>`; }

  // ---------------------------------------------------------------- home
  async function viewHome() {
    const list = await countries();
    const nSub = list.filter(c => c.subnational).length, nD1 = list.filter(c => c.D1.length).length;
    main.innerHTML = `
      <section class="hero">
        <h1>Evidence for subnational policy decisions, country by country</h1>
        <span class="badge-noupload">No upload needed — every analysis uses built-in, documented public data</span>
        <p>Choose a country to see which public datasets exist for it, which economic questions they can answer, and run the supported analyses.</p>
        <div class="search" role="combobox" aria-expanded="false" aria-owns="sugg">
          <label class="f" for="cq">Country</label>
          <input id="cq" type="search" placeholder="Type a country, e.g. Kenya" autocomplete="off" aria-autocomplete="list" aria-controls="sugg">
          <div class="sugg" id="sugg" role="listbox" hidden></div>
        </div>
        <div class="chips">${FEATURED.map(([iso, n, t]) => `<button class="chip" data-go="${iso}">${n} <span class="muted">· ${t}</span></button>`).join('')}</div>
        <div class="stats"><div><b>${list.length}</b><span>economies with verified data</span></div><div><b>${nSub}</b><span>with regional (subnational) data</span></div><div><b>${nD1}</b><span>with a ready-to-run regional need analysis</span></div><div><b>14</b><span>official and academic data sources</span></div></div>
      </section>
      <div class="steps" aria-label="How it works">
        ${['Select a country', 'See verified data and what it supports', 'Pick an economic question', 'Explore the evidence', 'Run the supported analysis', 'Download results, methods and a policy note']
          .map((t, i) => `<div class="step"><b>Step ${i + 1}</b>${t}</div>`).join('')}
      </div>
      <div class="grid2">
        ${Object.entries(AREAS).map(([k, a]) => `<div class="card"><h3>${a.title}</h3><p class="muted">${a.q}</p></div>`).join('')}
      </div>
      <div class="note info">Before datasets are combined, the Studio checks that they refer to the same areas, the same year and comparable units. Each analysis then reports separately how far its inputs agree with published statistics, what is known about statistical uncertainty, and what cannot be concluded. Where data do not support a comparison, the Studio says so instead of drawing a chart. <a href="own-data.html">Have your own data? (optional)</a></div>`;
    const inp = document.getElementById('cq'), box = document.getElementById('sugg');
    let act = -1, items = [];
    const show = () => {
      const v = inp.value.trim().toLowerCase();
      items = !v ? [] : list.filter(c => c.name.toLowerCase().includes(v) || c.iso3.toLowerCase() === v).sort((a, b) => (b.name.toLowerCase().startsWith(v)) - (a.name.toLowerCase().startsWith(v)) || a.name.localeCompare(b.name)).slice(0, 12);
      act = items.length ? 0 : -1;
      box.hidden = !items.length && !v;
      box.innerHTML = items.length ? items.map((c, i) => `<button role="option" data-go="${c.iso3}" class="${i === act ? 'act' : ''}"><span>${E(c.name)}</span><span class="muted small">${c.D2.length ? 'spending vs need' : c.D1.length ? 'regional analysis' : c.subnational ? 'some regional data' : 'national data'}</span></button>`).join('')
        : (v ? `<div class="empty">No country matches “${E(inp.value)}”.</div>` : '');
      bindGo(box);
    };
    inp.addEventListener('input', show);
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(0, Math.min(items.length - 1, act + (e.key === 'ArrowDown' ? 1 : -1))); [...box.querySelectorAll('button')].forEach((b, i) => b.classList.toggle('act', i === act)); }
      if (e.key === 'Enter' && items[act]) location.hash = '#/c/' + items[act].iso3;
    });
    bindGo(main);
    inp.focus();
  }
  function bindGo(el) { el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { location.hash = '#/c/' + b.dataset.go; }); }

  // ---------------------------------------------------------------- country overview
  function viewCountry(info, d) {
    const cap = P.capabilities(d, info);
    const srcNames = {wb_wdi: 'World Development Indicators', wb_pip: 'Poverty and Inequality Platform', wb_spid: 'Subnational poverty database', un_wpp: 'UN population estimates', who_gho: 'WHO health statistics', unesco_uis: 'UNESCO education statistics', ilo_ilostat: 'ILO labour statistics', unicef_sdmx: 'UNICEF child indicators', fao_faostat: 'FAO food security', dhs_api: 'Demographic and Health Surveys', worldpop: 'WorldPop population grids', chirps: 'CHIRPS rainfall', br_siconfi: 'Brazil Treasury state accounts'};
    const bySrc = {};
    for (const [s, y, n, , sub] of d.coverage) { const o = bySrc[s] ||= {y0: y, y1: y, n: 0, sub: 0}; o.y0 = Math.min(o.y0, y); o.y1 = Math.max(o.y1, Math.min(y, 2025)); o.n += n; o.sub |= sub; }
    const card = (k, c) => {
      const a = AREAS[k], off = c.level === 'none';
      const pill = {full: '', partial: 'amber', national: 'gray', none: 'gray'}[c.level];
      return `<article class="qcard ${off ? 'off' : ''}"><div><span class="pill ${pill}">${E(c.badge)}</span></div><h3>${a.title}</h3><div class="q">${a.q}</div><p class="small muted" style="margin:0">${E(c.detail)}</p>
        <div class="foot">${off ? '<span class="small muted">Not supported by the available data</span>' : `<a class="btn primary" href="#/c/${info.iso3}/${k}">Open analysis →</a>`}</div></article>`;
    };
    main.innerHTML = `
      <div class="crumb"><a href="#/">All countries</a> › ${E(info.name)}</div>
      <div class="chead"><div><h1>${E(info.name)}</h1><div class="muted">${E(info.region || '')}${info.income ? ' · ' + E(info.income) : ''}</div></div>
        <a class="btn ghost" href="#/c/${info.iso3}/data">Browse all ${F(info.obs, 0)} data points →</a></div>
      ${cap.d2.length ? `<div class="note ok"><strong>Full spending-versus-need workflow available.</strong> ${E(info.name)} has public accounts that attribute government spending to regions, so observed spending can be compared with poverty.<div style="margin-top:8px"><a class="btn primary" href="#/c/${info.iso3}/spending">Compare spending with need →</a></div></div>` :
        cap.d1.length ? `<div class="note info">Regional poverty and population line up for ${E(info.name)}, so need-based funding rules can be compared. <strong>Observed regional spending is not available</strong>, so no spending comparison is offered.</div>` :
        info.subnational ? `<div class="note warn">Some regional data exist for ${E(info.name)}, but poverty and population cannot be matched for the same areas and year, so funding-rule comparisons are not offered.</div>` :
        `<div class="note warn">Only national indicators are available for ${E(info.name)}. National averages cannot show differences between regions.</div>`}
      <h2 style="margin:18px 0 10px">What can you analyse?</h2>
      <div class="grid2">${Object.keys(AREAS).map(k => card(k, cap[k])).join('')}</div>
      <section class="card"><h3>Verified datasets for ${E(info.name)}</h3>
        <p class="small muted">Years with at least one published value. “Regional” marks sources with subnational detail.</p>
        <div class="tablewrap" style="max-height:none"><table><thead><tr><th>Source</th><th>Years</th><th class="num">Data points</th><th>Detail</th></tr></thead><tbody>
        ${Object.entries(bySrc).sort((a, b) => b[1].sub - a[1].sub || b[1].n - a[1].n).map(([s, o]) => `<tr><td>${E(srcNames[s] || s)}</td><td>${o.y0}–${o.y1}</td><td class="num">${F(o.n, 0)}</td><td>${o.sub ? '<span class="pill">Regional</span>' : '<span class="pill gray">National</span>'}</td></tr>`).join('')}
        </tbody></table></div></section>`;
  }

  // ---------------------------------------------------------------- shared analysis layout
  function shell(info, area, kindKey, controls, extra = '') {
    const k = KIND[kindKey], others = Object.entries(AREAS).filter(([x]) => x !== area);
    return `<div class="crumb"><a href="#/">All countries</a> › <a href="#/c/${info.iso3}">${E(info.name)}</a> › ${AREAS[area].title}</div>
      <div class="chead"><h1>${AREAS[area].title} <span class="muted" style="font-size:.6em">· ${E(info.name)}</span></h1></div>
      <div class="alayout"><aside class="controls card" aria-label="Analysis settings">${controls}
        <div class="small muted" style="border-top:1px solid var(--line);padding-top:10px">Other questions for ${E(info.name)}:<br>${others.map(([x, a]) => `<a href="#/c/${info.iso3}/${x}">${a.title}</a>`).join('<br>')}</div></aside>
      <div>${extra}<div class="qbox"><div class="kind ${k[2]}" id="a-kind">${k[0]}</div><div id="a-question" style="font-size:16px;font-weight:600"></div><div class="small muted" id="a-kinddesc">${k[1]}</div></div>
        <div id="a-check"></div><div class="kpis" id="a-kpis"></div>
        <section class="card" id="a-main"></section><section class="card" id="a-second" hidden></section>
        <section class="card interp" id="a-interp"></section>
        <section class="card"><h3>Download</h3><p class="small muted">Results come with sources, years and method notes. The policy note is a short printable summary.</p><div class="dl" id="a-dl"></div></section>
      </div></div>`;
  }
  const sel = (id, label, opts, val) => `<div><label class="f" for="${id}">${label}</label><select id="${id}">${opts.map(([v, t]) => `<option value="${E(v)}" ${String(v) === String(val) ? 'selected' : ''}>${E(t)}</option>`).join('')}</select></div>`;
  const kpi = (v, t) => `<div class="kpi"><b>${v}</b><span>${t}</span></div>`;
  const qs = id => document.getElementById(id);
  function setKind(kindKey) { const k = KIND[kindKey]; qs('a-kind').textContent = k[0]; qs('a-kind').className = 'kind ' + k[2]; qs('a-kinddesc').textContent = k[1]; }

  function interp(o) {
    return `<h3>How to read this</h3>
      <div class="tabs" role="tablist">${['Meaning', 'Limits', 'Data used', 'Method'].map((t, i) => `<button role="tab" data-tab="${i}" class="${i ? '' : 'on'}">${t}</button>`).join('')}</div>
      <div data-pane="0"><h4>What the results mean</h4><ul>${o.meaning.map(x => `<li>${x}</li>`).join('')}</ul></div>
      <div data-pane="1" hidden><h4>What cannot be concluded</h4><ul>${o.cannot.map(x => `<li>${x}</li>`).join('')}</ul></div>
      <div data-pane="2" hidden><h4>Datasets, years and boundaries</h4><ul>${o.data.map(x => `<li>${x}</li>`).join('')}</ul></div>
      <div data-pane="3" hidden><h4>Methodological assumptions</h4><ul>${o.method.map(x => `<li>${x}</li>`).join('')}</ul>${o.checks ? checksHTML(o.checks) : ''}</div>`;
  }
  function bindTabs(root) {
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      root.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
      root.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
    });
  }
  function checksHTML(c) {
    return `<details><summary>Automatic compatibility check: ${E(c.label)} (${c.checks.length} checks)</summary><table><tbody>${c.checks.map(x => `<tr><td>${E(x.check)}</td><td><span class="pill ${x.outcome === 'DO_NOT_MERGE' ? 'red' : x.outcome === 'DESCRIPTIVE' ? 'amber' : ''}">${E(({DIRECT: 'compatible', TRANSFORM: 'compatible after documented step', DESCRIPTIVE: 'descriptive only', DO_NOT_MERGE: 'not mergeable'})[x.outcome] || x.outcome)}</span></td><td class="small">${E(x.detail)}</td></tr>`).join('')}</tbody></table>
      ${c.transformations?.length ? `<p class="small"><strong>Documented steps:</strong></p><ul class="small">${c.transformations.map(t => `<li>${E(t)}</li>`).join('')}</ul>` : ''}</details>`;
  }
  function wireCheckLink() {
    document.querySelectorAll('[data-showchecks]').forEach(a => a.onclick = e => { e.preventDefault(); const b = document.querySelector('#a-interp [data-tab="3"]'); b?.click(); document.querySelector('#a-interp details')?.setAttribute('open', ''); qs('a-interp').scrollIntoView({behavior: 'smooth'}); });
  }

  // ---------------------------------------------------------------- evidence status (four separate questions)
  // Technical compatibility ≠ validation against published statistics ≠ statistical uncertainty ≠ interpretation.
  const UNC = {
    spid: 'No standard errors are published for these regional survey estimates. Differences of a few percentage points between areas may not be statistically meaningful — treat close rankings as ties.',
    worldpop: 'Population figures are modelled (WorldPop) with no published uncertainty; counts of poor people inherit it.',
    mpm: 'No standard errors are published for these deprivation estimates; small differences between areas may not be meaningful.',
  };
  const WELFARE = {CONS: 'consumption', INC: 'income'};
  const SURVEY_BASED = ['wb_wdi:SI.POV', 'wb_wdi:SI.DST', 'wb_wdi:SH.STA.STNT', 'wb_wdi:SE.LPV', 'dhs_api:', 'unicef_sdmx:', 'unesco_uis:CR.', 'unesco_uis:LR.', 'unesco_uis:MATH', 'unesco_uis:READ', 'ilo_ilostat:EMP_NIFL', 'ilo_ilostat:SDG_0111'];
  function evidencePanel(o) {
    const c = o.compat, ok = c && (c.classification === 'DIRECT' || c.classification === 'TRANSFORM');
    const steps = c?.transformations?.length || 0;
    const row = (t, pill, cls, txt) => `<div class="ev"><div class="evt">${t}</div><div><span class="pill ${cls}">${pill}</span> <span class="small">${txt}</span></div></div>`;
    const compat = o.compatText ? row('1. Technical compatibility', o.compatText[0], o.compatText[1], o.compatText[2]) :
      c ? row('1. Technical compatibility', ok ? 'Datasets align' : 'Cannot be combined', ok ? '' : 'red', (ok ? `Same areas, same year and comparable units${steps ? ` (${steps} documented step${steps > 1 ? 's' : ''})` : ''}. This checks that the data can be combined; it does not validate the findings.` : 'The analysis is not shown.') + ' <a href="#" data-showchecks>Details</a>')
        : row('1. Technical compatibility', 'Single dataset', 'gray', 'Values come from one published dataset; nothing is combined.');
    return `<section class="evidence" aria-label="Evidence status">${compat}
      ${row('2. Validation against published statistics', o.validation[0], o.validation[1], o.validation[2])}
      ${row('3. Statistical uncertainty', o.uncertainty[0], o.uncertainty[1], o.uncertainty[2])}
      ${row('4. Economic interpretation', o.interpretation[0], 'amber', o.interpretation[1] + ' <a href="#" data-showlimits>What cannot be concluded</a>')}</section>`;
  }
  const evidenceText = o => [o.compatText ? `Technical compatibility: ${o.compatText[0]} — ${o.compatText[2]}` : o.compat ? `Technical compatibility: ${o.compat.label} (a data-alignment check, not a validation of findings)` : 'Technical compatibility: single published dataset',
    `Validation against published statistics: ${o.validation[0]} — ${strip(o.validation[2])}`, `Statistical uncertainty: ${o.uncertainty[0]} — ${strip(o.uncertainty[2])}`,
    `Economic interpretation: ${o.interpretation[0]} — ${strip(o.interpretation[1])}`];
  const PIP_ID = line => 'wb_pip:headcount_' + {poverty_rate: '300', poor420: '420', poor830: '830'}[line];
  function pipSeries(d, line, welfare) {
    const w = WELFARE[welfare] || welfare;
    return d.national.find(x => x.i === PIP_ID(line) && x.b === `area=national;welfare=${w}`) || null;
  }
  // Compare population-weighted regional estimates with the official national figure for the same survey year, line and welfare measure.
  function pipValidation(d, line, year, welfare, wrate) {
    const s = pipSeries(d, line, welfare), pt = s?.d.find(p => p[0] === year);
    if (!pt) return {pt: null, v: ['Not available', 'gray', `No official national estimate for ${year} with the same welfare measure to compare against.`]};
    const off = pt[1] * 100;
    if (wrate == null) return {pt, off, v: ['Not tested', 'gray', `Official national figure for ${year}: ${F(off, 1)}%. No population estimate for this year, so the regional values cannot be re-weighted and compared.`]};
    const diff = Math.abs(wrate - off);
    return {pt, off, diff, v: [diff <= 2 ? 'Consistent' : 'Differs', diff <= 2 ? '' : 'amber',
      `Population-weighted regional estimates give ${F(wrate, 1)}%; the official national figure (Poverty and Inequality Platform, ${year}, same line and welfare measure) is ${F(off, 1)}% — a difference of ${F(diff, 1)} percentage points.${diff > 2 ? ' The gap may reflect different population weights or survey coverage; interpret regional totals with care.' : ''}`]};
  }
  // National poverty trend: one series per welfare measure; lines join only surveys in the same comparability spell.
  function trendBlock(d, line, label) {
    const series = d.national.filter(x => x.i === PIP_ID(line) && x.b.startsWith('area=national'));
    if (!series.length) return '';
    const sers = series.map(x => ({name: (x.b.includes('income') ? 'Income-based' : 'Consumption-based') + ` share below ${label} (%)`, groupBy: true,
      points: x.d.map(p => [p[0], p[1] * 100, null, null, p[4], p[6] != null ? (x.b + '|' + p[6]) : null, `${p[7] || ''} ${p[0]}`.trim()])}));
    const spells = series.flatMap(x => { const g = {}; x.d.forEach(p => { const k = p[6] ?? 'n/a'; (g[k] ||= []).push(`${p[0]}${p[7] ? ' (' + p[7] + ')' : ''}`); }); return Object.values(g).map(v => (series.length > 1 ? (x.b.includes('income') ? 'income: ' : 'consumption: ') : '') + v.join(', ')); });
    return `<h3>National trend for context</h3><p class="small muted">Official national estimates from the Poverty and Inequality Platform, survey years only. <strong>Lines join only surveys that the platform classifies as comparable</strong>; separate points or segments mark a change in survey design or welfare measure, so changes across them should not be read as trends. Nothing is interpolated.</p>` +
      Ch.line(sers, {title: 'National poverty, survey years'}) + `<p class="small muted">Comparable groups of surveys: ${spells.map(x => '[' + E(x) + ']').join(' · ')}.</p>`;
  }
  // Rankings: long lists start with the 10 highest and 10 lowest; the full list is one click away.
  S.rank = {}; S.tables = {};
  function ranking(id, items, o = {}) { S.rank[id] = {items, o, all: false}; return `<div id="${id}">${rankingInner(id)}</div>`; }
  function rankingInner(id) {
    const {items, o, all} = S.rank[id];
    const key = o.paired ? 'a' : 'value';
    const xs = items.filter(i => i[key] != null && isFinite(i[key])).sort((a, b) => b[key] - a[key]);
    const long = xs.length > 20;
    const nice = v => { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p * 2) / 2 * p; };
    const max = nice(Math.max(...xs.flatMap(i => o.paired ? [i.a, i.b] : [i.value, i.hi ?? -Infinity])));
    // one shared scale for the highest and lowest groups, so bar lengths are comparable
    const pmax = o.paired ? max : null;
    const draw = arr => o.paired ? Ch.paired(arr, {...o, max: pmax}) : Ch.bars(arr, {...o, max, sort: false});
    if (!long || all) return draw(xs) + (long ? `<button class="btn ghost sm" data-rankall="${id}">Show only the 10 highest and 10 lowest</button>` : '');
    return `<p class="small muted" style="margin:0 0 4px">${E(o.topLabel || '10 highest')}</p>${draw(xs.slice(0, 10))}<p class="small muted" style="margin:10px 0 4px">${E(o.bottomLabel || '10 lowest')}</p>${draw(xs.slice(-10))}
      <button class="btn ghost sm" data-rankall="${id}">Show all ${xs.length} areas</button>`;
  }
  function table(id, rows, cols, title) {
    S.tables[id] = {rows, cols, sort: cols.find(c => c.sortDefault) || cols[1], dir: -1, q: ''};
    return `<details class="tbl"><summary>${E(title || `All ${rows.length} areas — searchable and sortable table`)}</summary>
      <input type="search" data-tsearch="${id}" placeholder="Find an area" aria-label="Find an area" style="margin:8px 0;max-width:280px">
      <div class="tablewrap"><table><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}"><button class="thsort" data-tsort="${id}" data-key="${c.key}">${E(c.label)}</button></th>`).join('')}</tr></thead><tbody id="${id}-body">${tableBody(id)}</tbody></table></div></details>`;
  }
  function tableBody(id) {
    const t = S.tables[id], k = t.sort.key;
    const rows = t.rows.filter(r => !t.q || String(r[t.cols[0].key]).toLowerCase().includes(t.q)).slice()
      .sort((a, b) => { const x = a[k], y = b[k]; return typeof x === 'string' || typeof y === 'string' ? t.dir * String(x ?? '').localeCompare(String(y ?? '')) : t.dir * ((x ?? -Infinity) - (y ?? -Infinity)); });
    return rows.map(r => `<tr>${t.cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.num ? F(r[c.key], c.d ?? 1) : E(r[c.key])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${t.cols.length}" class="muted">No area matches.</td></tr>`;
  }
  main.addEventListener('click', e => {
    const r = e.target.closest('[data-rankall]');
    if (r) { const st = S.rank[r.dataset.rankall]; st.all = !st.all; qs(r.dataset.rankall).innerHTML = rankingInner(r.dataset.rankall); return; }
    const t = e.target.closest('[data-tsort]');
    if (t) { const st = S.tables[t.dataset.tsort]; const c = st.cols.find(x => x.key === t.dataset.key); st.dir = st.sort === c ? -st.dir : (c.num ? -1 : 1); st.sort = c; qs(t.dataset.tsort + '-body').innerHTML = tableBody(t.dataset.tsort); return; }
    const l = e.target.closest('[data-showlimits]');
    if (l) { e.preventDefault(); document.querySelector('#a-interp [data-tab="1"]')?.click(); qs('a-interp').scrollIntoView({behavior: 'smooth'}); }
  });
  main.addEventListener('input', e => {
    const t = e.target.closest('[data-tsearch]');
    if (t) { const st = S.tables[t.dataset.tsearch]; st.q = t.value.trim().toLowerCase(); qs(t.dataset.tsearch + '-body').innerHTML = tableBody(t.dataset.tsearch); }
  });

  function downloads(info, ctx) {
    const box = qs('a-dl');
    box.innerHTML = `<button class="btn primary" id="dl-note">Policy note (HTML, printable)</button><button class="btn" id="dl-csv">Results (CSV)</button><button class="btn" id="dl-meth">Methods and checks (JSON)</button>`;
    qs('dl-csv').onclick = () => save(`${info.iso3}_${ctx.slug}.csv`, ctx.csv(), 'text/csv');
    qs('dl-meth').onclick = () => save(`${info.iso3}_${ctx.slug}_methods.json`, JSON.stringify({country: info.name, iso3: info.iso3, question: ctx.question, type: KIND[ctx.kind][0], data: ctx.interp.data.map(strip), assumptions: ctx.interp.method.map(strip), limits: ctx.interp.cannot.map(strip), evidence_status: ctx.evidence ? evidenceText(ctx.evidence) : null, technical_compatibility_checks: ctx.checks || null, generated: new Date().toISOString(), studio: 'Policy Diagnostics Studio v0.5'}, null, 2), 'application/json');
    qs('dl-note').onclick = () => save(`${info.iso3}_${ctx.slug}_policy_note.html`, policyNote(info, ctx), 'text/html');
  }
  const strip = s => String(s).replace(/<[^>]+>/g, '');
  function save(name, text, type) { const u = URL.createObjectURL(new Blob([text], {type})), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
  function policyNote(info, ctx) {
    const li = xs => '<ul>' + xs.map(x => `<li>${x}</li>`).join('') + '</ul>';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${E(info.name)} — ${E(ctx.title)}</title><style>body{font:15px/1.6 Georgia,serif;color:#16263a;max-width:760px;margin:30px auto;padding:0 20px}h1{font-size:24px}h2{font-size:17px;margin-top:22px;border-bottom:1px solid #dfe6ea;padding-bottom:3px}.k{display:inline-block;background:#e4f2f1;color:#085257;padding:2px 8px;border-radius:6px;font:700 12px system-ui}.small{font-size:12.5px;color:#5d6f7c}svg{width:100%;height:auto}svg text{font:11px system-ui}</style></head><body>
      <p class="small">Policy Diagnostics Studio v0.5 · policy note · generated ${new Date().toISOString().slice(0, 10)}</p>
      <h1>${E(info.name)}: ${E(ctx.title)}</h1><p><span class="k">${E(KIND[ctx.kind][0])}</span> ${E(KIND[ctx.kind][1])}</p>
      <h2>Question</h2><p>${E(ctx.question)}</p>
      <h2>Key findings</h2>${li(ctx.findings)}
      ${ctx.figure ? `<h2>Figure</h2>${ctx.figure}<p class="small">${E(ctx.figureCaption || '')}</p>` : ''}
      <h2>What this means</h2>${li(ctx.interp.meaning)}
      <h2>What cannot be concluded</h2>${li(ctx.interp.cannot)}
      <h2>Data and method</h2>${li(ctx.interp.data)}${li(ctx.interp.method)}
      ${ctx.evidence ? `<h2>Evidence status</h2>${li(evidenceText(ctx.evidence).map(E))}<p class="small">A technical compatibility check confirms that datasets refer to the same areas, year and units; it does not validate the findings.</p>` : ''}
      <p class="small">Sources remain under their own licences; cite them as listed. This note is descriptive and does not constitute a policy recommendation.</p></body></html>`;
  }

  // ---------------------------------------------------------------- 1. Regional poverty and inequality
  async function viewArea(area, info, d, q) {
    await catalog().catch(() => null);
    if (area === 'poverty') return poverty(info, d, q);
    if (area === 'spending') return spending(info, d, q);
    if (area === 'human') return human(info, d, q);
    return climate(info, d, q);
  }

  function matchD1(d, set) {
    return P.runnable(d, 'D1').find(x => x.year === set.year && x.survey === set.survey && x.n_units === set.n && set.period.u.every(u => x.rows.some(r => r.geo_code === u[0])));
  }

  async function poverty(info, d, q) {
    const cap = P.capabilities(d, info);
    const sets = cap.spid.slice().reverse();
    if (!sets.length) return nationalOnlyPoverty(info, d);
    const si = q.set != null ? +q.set : 0, line = q.line || defaultLine(info);
    const set = sets[Math.min(si, sets.length - 1)];
    const d1 = matchD1(d, set);
    const metrics = [['rate', 'Share of people in poverty'], ...(d1 ? [['poor', 'Number of people in poverty']] : []), ['gini', 'Inequality (Gini index)'], ['mean', 'Average daily consumption or income']];
    const metric = metrics.some(m => m[0] === q.m) ? q.m : 'rate';
    main.innerHTML = shell(info, 'poverty', 'descriptive',
      sel('c-set', 'Survey round', sets.map((s, i) => [i, `${s.year} · ${s.survey} · ${s.n} areas`]), si) +
      sel('c-line', 'Poverty line', Object.values(P.LINES).map(l => [l.key, l.label + ' per person']), line) +
      sel('c-m', 'Show', metrics, metric) +
      `<p class="small muted">Default line follows the World Bank convention for ${E(info.income || 'this income group')}. ${d1 ? 'Population estimates exist for this survey year, so numbers of poor people can be shown.' : 'No population estimate for this survey year: shares only.'}</p>`);
    ['c-set', 'c-line', 'c-m'].forEach(id => qs(id).onchange = () => { setQuery({set: qs('c-set').value, line: qs('c-line').value, m: qs('c-m').value}); route(); });
    const codes = new Set(set.period.u.map(u => u[0]));
    const L = P.LINES[line];
    const rate = P.valuesFor(d, L.spid, set.year, codes, set.survey);
    const gini = P.valuesFor(d, 'wb_spid:spid_gini', set.year, codes, set.survey);
    const mean = P.valuesFor(d, 'wb_spid:spid_mean2021', set.year, codes, set.survey);
    const pop = d1 ? new Map(d1.rows.map(r => [r.geo_code, r.population])) : new Map();
    const rows = set.period.u.map(u => ({code: u[0], name: u[1], rate: rate.get(u[0])?.v != null ? rate.get(u[0]).v * 100 : null,
      gini: gini.get(u[0])?.v != null ? gini.get(u[0]).v * 100 : null, mean: mean.get(u[0])?.v ?? null, population: pop.get(u[0]) ?? null}));
    rows.forEach(r => r.poor = r.population != null && r.rate != null ? r.population * r.rate / 100 : null);
    const val = {rate: r => r.rate, poor: r => r.poor, gini: r => r.gini, mean: r => r.mean}[metric];
    const unit = {rate: '% of people', poor: 'people', gini: 'Gini (0–100)', mean: '$ per person per day (2021 prices)'}[metric];
    qs('a-question').textContent = metric === 'poor' ? `Where do most people living below ${L.label} live in ${info.name}?` : metric === 'gini' ? `How unequal is consumption or income within each area of ${info.name}?` : metric === 'mean' ? `How does average consumption or income differ across ${info.name}'s areas?` : `Where is the share of people living below ${L.label} highest in ${info.name}?`;
    const rs = P.rankSummary(rows, 'rate');
    const wrate = d1 ? P.weightedRate(rows.filter(r => r.rate != null && r.population != null).map(r => ({population: r.population, poverty_rate: r.rate}))) : null;
    const pv = pipValidation(d, line, set.year, set.welfare, wrate);
    const conc = d1 ? P.concentration(rows.filter(r => r.rate != null).map(r => ({population: r.population, poverty_rate: r.rate, name: r.name}))) : null;
    const gv = d1?.checks ? {label: d1.label, checks: d1.checks, transformations: d1.transformations, classification: d1.class} : null;
    const EV = {compat: gv, validation: pv.v,
      uncertainty: ['Not published', 'amber', UNC.spid + (d1 && metric === 'poor' ? ' ' + UNC.worldpop : '')],
      interpretation: ['Descriptive', 'Shows where poverty is high or where most poor people live; it does not explain why.']};
    qs('a-check').innerHTML = evidencePanel(EV); wireCheckLink();
    qs('a-kpis').innerHTML = (rs ? kpi(`${F(rs.highest.rate, 0)}%`, `highest share below ${L.label}: ${E(rs.highest.name)}`) + kpi(`${F(rs.lowest.rate, 0)}%`, `lowest share: ${E(rs.lowest.name)}`) : '') +
      (conc ? kpi(`${F(conc.poor / 1e6, 2)} m`, `people below ${L.label} (modelled population); ${F(conc.topShare * 100, 0)}% live in the ${conc.top.length} areas with most poor people`) : '') +
      (pv.off != null ? kpi(`${F(pv.off, 1)}%`, `official national rate, ${set.year} (same line and welfare measure)`) : '');
    const g = await geo(info.iso3);
    const vals = new Map(rows.map(r => [r.code, val(r)]));
    qs('a-main').innerHTML = `<div class="${set.n > 20 ? '' : 'grid2'}"><div><h3>Map</h3>${Ch.map(g, vals, {unit, title: 'Map of ' + unit, emptyMsg: 'No boundary file for these areas — see the ranking.'})}</div>
      <div><h3 style="margin-top:14px">Ranking of ${set.n} areas</h3>${ranking('rk-pov', rows.map(r => ({label: r.name, value: val(r)})), {unit, digits: metric === 'poor' ? 0 : 1, title: 'Ranking'})}</div></div>
      <p class="unc">Uncertainty: ${E(UNC.spid)}${metric === 'poor' ? ' ' + E(UNC.worldpop) : ''}</p>` +
      table('tb-pov', rows.map(r => ({name: r.name, rate: r.rate, population: r.population, poor: r.poor, gini: r.gini, mean: r.mean})),
        [{key: 'name', label: 'Area'}, {key: 'rate', label: `Share below ${L.label} (%)`, num: true, sortDefault: true}, ...(d1 ? [{key: 'population', label: 'Population (modelled)', num: true, d: 0}, {key: 'poor', label: 'People in poverty', num: true, d: 0}] : []), {key: 'gini', label: 'Gini', num: true}, {key: 'mean', label: 'Average $/day', num: true, d: 2}]);
    const tb = trendBlock(d, line, L.label), sec = qs('a-second');
    sec.hidden = !tb; sec.innerHTML = tb;
    const I = {
      meaning: [
        `Each value is the share of people in an area whose daily consumption or income is below the ${L.long}, estimated from the ${set.survey} household survey (${set.year}).`,
        rs ? `Poverty ranges from ${F(rs.lowest.rate, 0)}% in ${E(rs.lowest.name)} to ${F(rs.highest.rate, 0)}% in ${E(rs.highest.name)}.` : 'Values shown where published.',
        conc ? 'The areas with the highest poverty rates are not necessarily where most poor people live: population size matters. Switch “Show” to “Number of people in poverty” to see where the largest numbers are.' : 'Without a matching population estimate, the Studio does not compute numbers of poor people.',
      ],
      cannot: ['Why poverty differs between areas — these are descriptive estimates, not causal explanations.',
        'Whether small differences are real: the source publishes no sampling errors, so areas a few points apart may be statistically indistinguishable.',
        'Trends across surveys in different comparability groups, welfare measures or boundaries.',
        'Poverty depth: the headcount says how many are poor, not how far below the line they are.'],
      data: [`World Bank Subnational Poverty and Inequality Database (SPID), ${set.survey} ${set.year}; welfare measure: ${WELFARE[set.welfare] || set.welfare}.`,
        `Boundaries: ${E(set.bv || 'as matched by the World Bank')} (${set.n} ${P.LEVEL[set.level] || set.level}).`,
        d1 ? `Population: WorldPop 1 km gridded estimates for ${set.year}, summed within each area (modelled).` : 'Population: not available for this survey year.',
        'National trend: World Bank Poverty and Inequality Platform, survey years only, grouped by comparability.'],
      method: ['Poverty lines are in 2021 purchasing-power-parity dollars per person per day; no further regional price adjustment beyond the survey’s own.',
        'Values are shown exactly as published (stored as shares, displayed as percentages).',
        d1 ? 'People in poverty = area population × poverty share.' : 'No population weighting is applied.'],
      checks: gv,
    };
    qs('a-interp').innerHTML = interp(I); bindTabs(qs('a-interp'));
    const findings = [rs ? `The share of people below ${L.label} ranges from ${F(rs.lowest.rate, 1)}% (${E(rs.lowest.name)}) to ${F(rs.highest.rate, 1)}% (${E(rs.highest.name)}) across ${rs.n} areas (${set.survey}, ${set.year}). Close values may not be statistically different.` : '',
      conc ? `About ${F(conc.poor / 1e6, 2)} million people live below the line (using modelled population); ${F(conc.topShare * 100, 0)}% of them live in ${conc.top.map(r => E(r.name)).join(', ')}.` : ''].filter(Boolean);
    downloads(info, {slug: `poverty_${set.year}_${line}`, kind: 'descriptive', title: AREAS.poverty.title, question: qs('a-question').textContent, interp: I, checks: gv, evidence: EV, findings,
      figure: Ch.bars(rows.map(r => ({label: r.name, value: val(r)})), {unit, digits: 1}), figureCaption: `${unit} by area, ${set.survey} ${set.year}. No standard errors are published.`,
      csv: () => P.csv(rows, [['code', 'geo_code'], ['name', 'area'], ['rate', 'poverty_share_pct_' + line], ['population', 'population_worldpop_modelled'], ['poor', 'people_in_poverty'], ['gini', 'gini_0_100'], ['mean', 'mean_usd_ppp_day']],
        [`${info.name} — regional poverty, ${set.survey} ${set.year}, welfare measure: ${WELFARE[set.welfare] || set.welfare}`, 'Source: World Bank SPID (CC BY 4.0); population WorldPop (CC BY 4.0)', `Poverty line: ${L.long}`, 'Uncertainty: no standard errors published; population is modelled'])});
  }

  function nationalOnlyPoverty(info, d) {
    const line = defaultLine(info), L = P.LINES[line];
    const has = d.national.some(x => x.i === PIP_ID(line) && x.b.startsWith('area=national'));
    main.innerHTML = shell(info, 'poverty', 'descriptive', '<p class="small muted">No settings: only national estimates exist.</p>');
    qs('a-question').textContent = has ? `How has national poverty changed in ${info.name}?` : `Are poverty estimates available for ${info.name}?`;
    qs('a-check').innerHTML = `<div class="note warn"><strong>No verified regional poverty estimates for ${E(info.name)}.</strong> Regional maps and rankings cannot be produced.${has ? ' National figures are shown for context.' : ''}</div>`;
    qs('a-main').innerHTML = has ? trendBlock(d, line, L.label) : Ch.empty('No national poverty estimates are available either.');
    const I = {meaning: ['National estimates show overall levels; changes are meaningful only within a comparability group.'], cannot: ['Anything about differences between regions.'], data: ['World Bank Poverty and Inequality Platform, survey years.'], method: ['Survey years only; no interpolation; lines join only comparable surveys.']};
    qs('a-interp').innerHTML = interp(I); bindTabs(qs('a-interp'));
    if (!has) { qs('a-dl').innerHTML = '<span class="small muted">Nothing to download: no poverty estimates exist for this country in the warehouse.</span>'; return; }
    const pts = d.national.filter(x => x.i === PIP_ID(line) && x.b.startsWith('area=national')).flatMap(x => x.d.map(p => ({year: p[0], v: p[1] * 100, welfare: x.b.split('welfare=')[1], survey: p[7], group: p[6]})));
    downloads(info, {slug: 'poverty_national', kind: 'descriptive', title: AREAS.poverty.title, question: qs('a-question').textContent, interp: I, findings: [`Latest national estimate: ${F(pts.at(-1).v, 1)}% below ${L.label} (${pts.at(-1).year}, ${pts.at(-1).survey || ''}).`],
      csv: () => P.csv(pts, [['year', 'year'], ['v', 'poverty_share_pct_' + line], ['welfare', 'welfare_measure'], ['survey', 'survey'], ['group', 'comparability_group']], ['Source: World Bank PIP (CC BY 4.0); compare only within a comparability group'])});
  }

  // ---------------------------------------------------------------- 2. Public expenditure and geographic need
  async function spending(info, d, q) {
    const cap = P.capabilities(d, info);
    const mode = cap.d2.length && q.mode !== 'rules' ? 'observed' : (cap.d1.length ? 'rules' : 'national');
    const tabs = cap.d2.length ? `<div class="tabs" role="tablist" style="margin-top:0"><button class="${mode === 'observed' ? 'on' : ''}" data-mode="observed">Observed spending vs need</button><button class="${mode === 'rules' ? 'on' : ''}" data-mode="rules">Compare funding rules (hypothetical)</button></div>` :
      cap.d1.length ? `<div class="note warn"><strong>Observed regional spending is not available for ${E(info.name)}.</strong> No verified dataset attributes government spending to its regions, so actual spending cannot be compared with need. Below, you can see how hypothetical funding rules would divide a budget.</div>` : '';
    if (mode === 'observed') return observedSpending(info, d, q, cap, tabs);
    if (mode === 'rules') return fundingRules(info, d, q, cap, tabs);
    main.innerHTML = shell(info, 'spending', 'context', '<p class="small muted">Regional analysis is not possible for this country.</p>');
    qs('a-question').textContent = `How large is public spending in ${info.name}, nationally?`;
    qs('a-check').innerHTML = `<div class="note warn"><strong>Regional need and spending cannot be analysed for ${E(info.name)}.</strong> Poverty and population are not available for matching areas and years, and no regional spending data exist. National indicators are shown for context only.</div>`;
    const hasNat = nationalSpendingContext(info, d, qs('a-main'));
    const I = {meaning: ['National spending shares describe the size and composition of government spending.'], cannot: ['How spending is distributed between regions or households.'], data: ['World Development Indicators (World Bank).'], method: ['As published; no adjustment.']};
    qs('a-interp').innerHTML = interp(I); bindTabs(qs('a-interp'));
    if (!hasNat) { qs('a-dl').innerHTML = '<span class="small muted">Nothing to download: no public-spending indicators exist for this country in the warehouse.</span>'; return; }
    downloads(info, {slug: 'spending_national', kind: 'context', title: AREAS.spending.title, question: qs('a-question').textContent, interp: I, findings: [], csv: () => nationalCSV(d)});
  }

  function nationalSpendingContext(info, d, el) {
    const ids = [['wb_wdi:GC.XPN.TOTL.GD.ZS', 'Government expense'], ['wb_wdi:SE.XPD.TOTL.GD.ZS', 'Education spending'], ['wb_wdi:SH.XPD.GHED.GD.ZS', 'Government health spending']];
    const series = ids.map(([id, n]) => ({name: n + ' (% of GDP)', s: P.nationalSeries(d, id)})).filter(x => x.s);
    el.innerHTML = `<h3>National public spending (% of GDP)</h3>` + (series.length ? Ch.line(series.map(x => ({name: x.name, points: x.s.d.map(p => [p[0], p[1]])})), {title: 'National spending', zero: true}) +
      `<p class="small muted">World Development Indicators. National totals only; they say nothing about how spending is distributed across regions.</p>` : Ch.empty('No national spending indicators available.'));
    return series.length > 0;
  }
  function nationalCSV(d) {
    const ids = ['wb_wdi:GC.XPN.TOTL.GD.ZS', 'wb_wdi:SE.XPD.TOTL.GD.ZS', 'wb_wdi:SH.XPD.GHED.GD.ZS'];
    const rows = ids.flatMap(id => (P.nationalSeries(d, id)?.d || []).map(p => ({id, year: p[0], v: p[1]})));
    return P.csv(rows, [['id', 'indicator'], ['year', 'year'], ['v', 'value_pct_gdp']], ['Source: World Bank WDI (CC BY 4.0)']);
  }

  function bindModeTabs(info) {
    document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { location.hash = `#/c/${info.iso3}/spending?mode=${b.dataset.mode === 'rules' ? 'rules' : 'observed'}`; });
  }

  async function observedSpending(info, d, q, cap, tabs) {
    const sets = cap.d2.slice().sort((a, b) => b.year - a.year);
    const year = +(q.year || sets[0].year), cat = P.SPENDING_CATEGORIES[q.cat] ? q.cat : 'total', line = q.line || defaultLine(info);
    const set = sets.find(s => s.year === year) || sets[0];
    main.innerHTML = shell(info, 'spending', 'observed',
      sel('c-year', 'Year', sets.map(s => [s.year, String(s.year)]), set.year) +
      sel('c-cat', 'Spending category', Object.entries(P.SPENDING_CATEGORIES).map(([k, c]) => [k, c.label]), cat) +
      sel('c-line', 'Poverty line', Object.values(P.LINES).map(l => [l.key, l.label + ' per person']), line) +
      `<p class="small muted">Spending: executed budgets of the 27 state governments (current reais). Population: official IBGE state estimates.</p>`, tabs);
    bindModeTabs(info);
    ['c-year', 'c-cat', 'c-line'].forEach(id => qs(id).onchange = () => { setQuery({mode: 'observed', year: qs('c-year').value, cat: qs('c-cat').value, line: qs('c-line').value}); route(); });
    const C = P.SPENDING_CATEGORIES[cat], L = P.LINES[line];
    qs('a-question').textContent = `Do states with higher poverty receive more ${cat === 'total' ? 'state-government spending' : C.label.toLowerCase() + ' spending'} per resident? (${set.year})`;
    // Technical compatibility of the warehouse layers, evaluated in the browser with the same rules as the pipeline.
    const codes = new Set(set.rows.map(r => r.geo_code));
    const layer = P.siconfiLayer(d, cat, set.year, codes);
    const A = {head: ['geo_code', 'population', 'poverty_rate'], rows: set.rows.map(r => ({geo_code: r.geo_code, population: String(r.population), poverty_rate: String(r[line]), region: r.name}))};
    const B = layer ? {head: ['code', 'spending'], rows: layer.rows.map(r => ({code: r.code, spending: String(r.spending)}))} : null;
    let chk = null;
    if (B) {
      const r = assess(A, B, {ay: set.year, by: set.year, ag: 'ADM1', bg: 'ADM1', attr: 'subnational_accounts', povertyDef: 'SPID', spendDef: C.label, ar: 'geo_code', ap: 'population', av: 'poverty_rate', br: 'code', bs: 'spending', aScale: 'percent', crosswalk: layer.crosswalk, currency: 'BRL current'});
      chk = {classification: r.compatibility, label: r.compatibility_label, checks: r.checks, transformations: [...set.transformations.filter(t => /population/i.test(t)), ...r.transformations], matched: r.matched};
    }
    if (!chk || !(chk.classification === 'DIRECT' || chk.classification === 'TRANSFORM')) {
      qs('a-check').innerHTML = chk ? evidencePanel({compat: chk, validation: ['Not run', 'gray', '—'], uncertainty: ['—', 'gray', '—'], interpretation: ['Not shown', 'The datasets cannot be combined for this selection.']}) : `<div class="note bad">No ${E(C.label)} spending published for ${set.year}.</div>`;
      qs('a-main').innerHTML = Ch.empty('The datasets cannot be combined for this selection, so no comparison is shown.'); qs('a-interp').innerHTML = ''; qs('a-dl').innerHTML = ''; wireCheckLink(); return;
    }
    const rows = P.spendingAlignment(chk.matched.map(m => ({name: m.region, population: m.population, poverty_rate: m.poverty_rate, spending: m.spending})));
    const wrate = P.weightedRate(rows), pv = pipValidation(d, line, set.year, 'INC', wrate);
    const EV = {compat: chk,
      validation: [pv.v[0], pv.v[1], `Poverty input: ${pv.v[2]} Spending: function-level spending adds up to each state’s published total in the Treasury accounts (automated test on 270 state-years); the comparison itself is not independently validated.`],
      uncertainty: ['Partly unknown', 'amber', 'Spending comes from administrative accounts (no sampling error, but subject to reporting and classification differences). Poverty estimates have unpublished sampling error, so small differences between states may not be meaningful.'],
      interpretation: ['Observed spending, not benefit incidence', 'Describes where state-government money is recorded relative to poverty; not who benefits, and not total public spending.']};
    qs('a-check').innerHTML = evidencePanel(EV); wireCheckLink();
    const avg = rows.reduce((s, r) => s + r.spending, 0) / rows.reduce((s, r) => s + r.population, 0);
    const byPov = rows.slice().sort((a, b) => b.poverty_rate - a.poverty_rate), poorest5 = byPov.slice(0, 5);
    const p5pop = poorest5.reduce((s, r) => s + r.population, 0), p5spend = poorest5.reduce((s, r) => s + r.spending, 0);
    const p5poor = poorest5.reduce((s, r) => s + r.poorShare, 0), p5share = poorest5.reduce((s, r) => s + r.spendShare, 0);
    const sp = P.rankSummary(rows, 'spendPer');
    qs('a-kpis').innerHTML = kpi(`R$ ${F(avg, 0)}`, `average spending per resident (${C.label.toLowerCase()})`) +
      kpi(`R$ ${F(p5spend / p5pop, 0)}`, `per resident in the 5 states with the highest poverty rates`) +
      kpi(`${F(sp.ratio, 1)}×`, `highest vs lowest per resident (${E(sp.highest.name)} vs ${E(sp.lowest.name)})`) +
      kpi(`${F(p5poor * 100, 0)}% / ${F(p5share * 100, 0)}%`, 'share of poor people / share of this spending in those 5 states');
    qs('a-main').innerHTML = `<h3>Spending per resident against poverty</h3><p class="small muted">Each circle is a state; circle size reflects population. Poverty: share below ${E(L.label)}.</p>
      ${Ch.scatter(rows.map(r => ({x: r.poverty_rate, y: r.spendPer, label: r.name, short: r.name.split(' ').slice(0, 2).join(' '), size: r.population})), {xLabel: `Share of people below ${L.label} (%)`, yLabel: 'Spending per resident (R$)', title: 'Spending vs poverty'})}
      <p class="unc">Uncertainty: state spending is administrative (no sampling error); poverty estimates carry unpublished sampling error, so states with similar poverty rates should not be ranked against each other.</p>` +
      table('tb-br', byPov.map(r => ({name: r.name, pov: r.poverty_rate, pop: r.population, sp: r.spending / 1e6, per: r.spendPer, ps: r.poorShare * 100, ss: r.spendShare * 100})),
        [{key: 'name', label: 'State'}, {key: 'pov', label: 'Poverty (%)', num: true, sortDefault: true}, {key: 'pop', label: 'Population', num: true, d: 0}, {key: 'sp', label: 'Spending (R$ m)', num: true, d: 0}, {key: 'per', label: 'R$ per resident', num: true, d: 0}, {key: 'ps', label: 'Share of poor (%)', num: true}, {key: 'ss', label: 'Share of spending (%)', num: true}], 'All 27 states — searchable and sortable table');
    const sec = qs('a-second'); sec.hidden = false;
    sec.innerHTML = `<h3>Where poor people live vs where state spending goes</h3><p class="small muted">Ordered by each state's share of the country's poor population. A spending share above the poverty share does not mean a state is over-funded: costs, revenues and responsibilities differ.</p>` +
      ranking('rk-br', rows.map(r => ({label: r.name, a: r.poorShare, b: r.spendShare})), {paired: true, aLabel: 'Share of poor people', bLabel: 'Share of state spending', topLabel: '10 states with the largest share of poor people', bottomLabel: '10 states with the smallest share'});
    const I = {
      meaning: [`States' own executed budgets (${C.label.toLowerCase()}) are set against how many residents are poor, describing how state-government money is distributed relative to need in ${set.year}.`,
        `The five states with the highest poverty rates hold ${F(p5poor * 100, 0)}% of poor people and account for ${F(p5share * 100, 0)}% of this spending, with R$ ${F(p5spend / p5pop, 0)} per resident against a national average of R$ ${F(avg, 0)}.`,
        'Differences in spending per resident reflect revenue capacity, constitutional transfers, service responsibilities and costs, not only choices about need.'],
      cannot: ['Who benefits: spending recorded in a state is not the same as benefits received by poor households (this is not a benefit-incidence analysis).',
        'Total public spending: federal programmes (for example cash transfers paid directly by the federal government) and municipal spending are excluded.',
        'Whether spending is effective or reduces poverty — no outcome or impact is estimated.',
        'Whether any state receives the “right” amount — no optimal allocation is defined.',
        'Real changes over time: amounts are nominal reais; comparing years would need an explicit price deflator, which is not applied.'],
      data: [`Brazil National Treasury, SICONFI annual accounts (DCA Annex I-E), executed (liquidated) expenditure of the 27 state governments, ${set.year}.`,
        `Poverty: World Bank SPID, ${set.survey} survey, ${set.year}, income-based, line ${L.label}.`, `Population: official IBGE state estimates for ${set.year} as published with the accounts.`,
        'Geography: Treasury state codes (ISO 3166-2) linked to the poverty-map areas through a documented one-to-one spatial overlay.'],
      method: ['Spending per resident = state spending ÷ state population. Shares = state value ÷ national total.',
        'Spending is restricted to each state government\'s own accounts and labelled as such.', 'Single-year comparison, so no inflation adjustment is needed.'],
      checks: chk,
    };
    qs('a-interp').innerHTML = interp(I); bindTabs(qs('a-interp'));
    downloads(info, {slug: `spending_vs_need_${set.year}_${cat}_${line}`, kind: 'observed', title: 'State-government spending and poverty', question: qs('a-question').textContent, interp: I, checks: chk, evidence: EV,
      findings: [I.meaning[1], `Spending per resident ranges from R$ ${F(sp.lowest.spendPer, 0)} (${E(sp.lowest.name)}) to R$ ${F(sp.highest.spendPer, 0)} (${E(sp.highest.name)}).`, 'These figures describe state-government accounts only and are not a measure of benefits received by households.'],
      figure: Ch.paired(rows.slice().sort((a, b) => b.poorShare - a.poorShare).map(r => ({label: r.name, a: r.poorShare, b: r.spendShare})), {aLabel: 'Share of poor people', bLabel: 'Share of state spending'}), figureCaption: `Brazil ${set.year}: share of poor people (below ${L.label}) and of ${C.label.toLowerCase()} spending by state.`,
      csv: () => P.csv(byPov, [['name', 'state'], ['poverty_rate', `poverty_share_pct_${line}`], ['population', 'population_ibge'], ['spending', 'spending_brl_current'], ['spendPer', 'spending_per_resident_brl'], ['poorShare', 'share_of_poor'], ['spendShare', 'share_of_spending']],
        [`Brazil ${set.year} — ${C.label} by state governments vs poverty (${L.label}, 2021 PPP, income-based)`, 'Spending: Secretaria do Tesouro Nacional SICONFI (state governments only, nominal BRL, executed)', 'Poverty: World Bank SPID (CC BY 4.0); population: IBGE via SICONFI', 'Not benefit incidence; excludes federal and municipal spending'])});
  }

  async function fundingRules(info, d, q, cap, tabs) {
    const sets = cap.d1.slice().sort((a, b) => b.year - a.year || b.n_units - a.n_units);
    const si = Math.min(+(q.set || 0), sets.length - 1), set = sets[si];
    const line = q.line || defaultLine(info), rule = ['population', 'poor', 'blend'].includes(q.rule) ? q.rule : 'poor';
    const budget = Math.max(1, +(q.budget || 100)), mix = q.mix != null ? +q.mix : 70;
    main.innerHTML = shell(info, 'spending', 'hypothetical',
      sel('c-set', 'Survey round', sets.map((s, i) => [i, `${s.year} · ${s.survey} · ${s.n_units} areas`]), si) +
      sel('c-line', 'Need measured as people below', Object.values(P.LINES).map(l => [l.key, l.label]), line) +
      `<div><label class="f" for="c-budget">Illustrative budget (millions, any currency)</label><input id="c-budget" type="number" min="1" step="10" value="${budget}"></div>` +
      sel('c-rule', 'Funding rule', [['population', 'Per resident'], ['poor', 'Per poor person'], ['blend', 'Blend of both']], rule) +
      `<div id="mixwrap" ${rule === 'blend' ? '' : 'hidden'}><label class="f" for="c-mix">Weight on poor people: <span id="mixv">${mix}</span>%</label><input id="c-mix" type="range" min="0" max="100" step="5" value="${mix}"></div>`, tabs);
    bindModeTabs(info);
    const upd = () => { setQuery({mode: 'rules', set: qs('c-set').value, line: qs('c-line').value, budget: qs('c-budget').value, rule: qs('c-rule').value, mix: qs('c-mix').value}); route(); };
    ['c-set', 'c-line', 'c-rule'].forEach(id => qs(id).onchange = upd); qs('c-budget').onchange = upd;
    qs('c-mix').oninput = () => { qs('mixv').textContent = qs('c-mix').value; }; qs('c-mix').onchange = upd;
    const L = P.LINES[line];
    const rows = set.rows.map(r => ({name: r.name, geo_code: r.geo_code, population: r.population, poverty_rate: r[line], spending: r.spending ?? null}));
    const a = P.allocation(rows, budget * 1e6, rule, mix / 100), pop = P.allocation(rows, budget * 1e6, 'population', 0), poor = P.allocation(rows, budget * 1e6, 'poor', 0);
    const ruleName = {population: 'same amount per resident', poor: 'same amount per poor person', blend: `blend of the two (${mix}% weight on poor people)`}[rule];
    const ruleArticle = rule === 'blend' ? 'a ' + ruleName : 'the ' + ruleName;
    qs('a-question').textContent = `How would an illustrative budget of ${F(budget, 0)} million be divided across ${info.name}'s areas under ${ruleArticle}?`;
    const top = a.rows.slice().sort((x, y) => y.share - x.share)[0];
    const gainers = poor.rows.map((r, i) => ({name: r.name, d: r.share - pop.rows[i].share, pop: pop.rows[i].share, poor: r.share, rate: r.poverty_rate})).sort((x, y) => y.d - x.d);
    const moved = gainers.filter(g => g.d > 0).reduce((s, g) => s + g.d, 0);
    const natRate = 100 * a.poor / a.pop, ex = gainers[0], loser = gainers[gainers.length - 1];
    const wrate = P.weightedRate(rows), pv = pipValidation(d, line, set.year, set.survey && P.povertySets(d).find(s => s.year === set.year && s.survey === set.survey)?.welfare, wrate);
    const EV = {compat: {label: set.label, checks: set.checks, transformations: set.transformations, classification: set.class},
      validation: [pv.v[0], pv.v[1], `Need input: ${pv.v[2]} Allocation arithmetic is tested against the Studio’s original formula, and shares sum to 100% under every rule. The allocations themselves are a formula illustration and cannot be validated against outcomes.`],
      uncertainty: ['Not computed', 'amber', 'Allocations inherit the unpublished sampling error of the poverty estimates and the modelling error of the population estimates; no uncertainty range is computed, so small differences between areas should not be over-interpreted.'],
      interpretation: ['Hypothetical', 'A formula illustration — not a forecast of poverty reduction, programme effectiveness or optimal government spending.']};
    qs('a-check').innerHTML = evidencePanel(EV); wireCheckLink();
    qs('a-kpis').innerHTML = kpi(E(top.name), `largest share under the selected rule: ${F(top.share * 100, 1)}% (${F(top.allocation / 1e6, 1)} m)`) +
      kpi(`${F(moved * 100, 0)}%`, 'of the budget changes area when moving from “per resident” to “per poor person”') +
      kpi(E(ex.name), `gains most from targeting poor people (+${F(ex.d * 100, 1)} percentage points of the budget)`);
    qs('a-main').innerHTML = `<div class="explain"><h3>How the funding rules work</h3>
      <ul><li><strong>The budget</strong> is an illustrative amount (here ${F(budget, 0)} million in any currency). Changing it rescales every area’s amount but never changes the shares.</li>
      <li><strong>Same amount per resident:</strong> each area’s share equals its share of the population. An area with 10% of residents gets 10% of the budget.</li>
      <li><strong>Same amount per poor person:</strong> each area’s share equals its share of people below ${E(L.label)} (population × poverty rate). Areas where poverty is above the national average (${F(natRate, 1)}%) receive more than their population share.</li>
      <li><strong>Blend:</strong> a weighted average of the two shares (set the weight with the slider).</li></ul>
      <p style="margin:6px 0 0"><strong>Example:</strong> ${E(ex.name)} has ${F(ex.pop * 100, 1)}% of residents and a poverty rate of ${F(ex.rate, 1)}%, so it holds ${F(ex.poor * 100, 1)}% of poor people — it receives ${F(ex.pop * 100, 1)}% of the budget per resident, but ${F(ex.poor * 100, 1)}% per poor person. ${E(loser.name)} (poverty ${F(loser.rate, 1)}%) moves the other way, from ${F(loser.pop * 100, 1)}% to ${F(loser.poor * 100, 1)}%.</p>
      <p style="margin:6px 0 0" class="small"><strong>Not a prediction:</strong> these figures show how a rule would divide money. They do not predict poverty reduction, programme effectiveness, or what governments should spend.</p></div>
      <h3>Amount per resident under the selected rule</h3><p class="small muted">In units of the budget currency. Under “same amount per resident” every area receives the same amount per person.</p>` +
      ranking('rk-alloc', a.rows.map(r => ({label: r.name, value: r.allocationPer})), {digits: 2, title: 'Allocation per resident', topLabel: '10 areas receiving most per resident', bottomLabel: '10 areas receiving least per resident'}) +
      `<p class="unc">Uncertainty: ${E(EV.uncertainty[2])}</p>` +
      table('tb-alloc', a.rows.map((r, i) => ({name: r.name, rate: r.poverty_rate, population: r.population, s1: pop.rows[i].share * 100, s2: poor.rows[i].share * 100, s3: r.share * 100, amt: r.allocation / 1e6, per: r.allocationPer})),
        [{key: 'name', label: 'Area'}, {key: 'rate', label: 'Poverty (%)', num: true, sortDefault: true}, {key: 'population', label: 'Population (modelled)', num: true, d: 0}, {key: 's1', label: 'Share: per resident (%)', num: true, d: 2}, {key: 's2', label: 'Share: per poor person (%)', num: true, d: 2}, {key: 's3', label: 'Share: selected rule (%)', num: true, d: 2}, {key: 'amt', label: 'Amount, selected (m)', num: true, d: 2}, {key: 'per', label: 'Per resident, selected', num: true, d: 2}],
        `All ${a.rows.length} areas, all three rules — searchable and sortable table (shares sum to 100% under every rule)`);
    const sec = qs('a-second'); sec.hidden = false;
    sec.innerHTML = `<h3>Share of the budget: per resident vs per poor person</h3><p class="small muted">The gap between the two bars is the effect of targeting poor people for each area.</p>` +
      ranking('rk-pair', pop.rows.map((r, i) => ({label: r.name, a: r.share, b: poor.rows[i].share})), {paired: true, aLabel: 'Same amount per resident', bLabel: 'Same amount per poor person', topLabel: '10 largest areas by population share', bottomLabel: '10 smallest'}) +
      `<details style="margin-top:12px"><summary>National public spending, for context</summary><div id="natctx"></div></details>`;
    nationalSpendingContext(info, d, qs('natctx'));
    const I = {
      meaning: [`This is a <strong>simulation of a funding formula</strong>: it shows how ${F(budget, 0)} million would be divided if each area received money in proportion to its ${rule === 'population' ? 'population' : rule === 'poor' ? 'number of people below ' + E(L.label) : 'population and number of poor people (blended)'}.`,
        `Moving from a per-resident to a per-poor-person rule shifts ${F(moved * 100, 0)}% of the budget towards areas with more poor people; ${E(ex.name)} gains the most.`,
        'Rules based on poor people direct more per resident to high-poverty areas; rules based on population treat every resident equally. The difference between them is driven entirely by differences in poverty rates.'],
      cannot: ['How much poverty would fall: the formula divides money; it does not predict outcomes. Impact depends on programme design, delivery costs and how effectively money reaches poor households.',
        'Whether a programme would be effective, or what governments should spend — no optimal allocation is defined.',
        'How money is actually spent today: ' + (cap.d2.length ? 'see “Observed spending vs need” for recorded spending.' : 'observed regional spending is not available for this country.'),
        'Poverty depth or severity: the headcount treats someone just below the line the same as someone far below it.',
        'Legal, administrative or political constraints on allocation.'],
      data: [`Poverty: World Bank SPID, ${set.survey} survey, ${set.year}, ${set.n_units} ${P.LEVEL[set.level] || set.level}, line ${L.label} (2021 prices).`,
        `Population: ${set.transformations.find(t => /Population =/.test(t)) ? E(set.transformations.find(t => /Population =/.test(t))) : 'WorldPop gridded estimates for ' + set.year}.`],
      method: ['Poor people in area i = population × poverty share. Weight = area population ÷ total (per resident), area poor ÷ total poor (per poor person), or (1 − w) × first + w × second (blend).',
        'Allocation = budget × weight; the budget amount only scales results.',
        'Same arithmetic as the Studio\'s original funding tool (unchanged and tested).'],
      checks: EV.compat,
    };
    qs('a-interp').innerHTML = interp(I); bindTabs(qs('a-interp'));
    downloads(info, {slug: `allocation_${set.year}_${rule}_${line}`, kind: 'hypothetical', title: 'Comparing hypothetical funding rules', question: qs('a-question').textContent, interp: I, checks: EV.compat, evidence: EV,
      findings: [`Under ${ruleArticle}, ${E(top.name)} receives the largest share (${F(top.share * 100, 1)}%).`, strip(I.meaning[1]), 'These are hypothetical allocations: not predictions of poverty reduction, programme effectiveness or optimal spending.'],
      figure: Ch.paired(pop.rows.map((r, i) => ({label: r.name, a: r.share, b: poor.rows[i].share})).sort((x, y) => y.a - x.a), {aLabel: 'Same amount per resident', bLabel: 'Same amount per poor person'}), figureCaption: `Share of an illustrative budget under two hypothetical rules (need = people below ${L.label}).`,
      csv: () => P.csv(a.rows.map((r, i) => ({...r, popRule: pop.rows[i].share, poorRule: poor.rows[i].share})), [['geo_code', 'geo_code'], ['name', 'area'], ['population', 'population_modelled'], ['poverty_rate', `poverty_share_pct_${line}`], ['poor', 'people_in_poverty'], ['popRule', 'share_per_resident_rule'], ['poorRule', 'share_per_poor_person_rule'], ['share', 'share_selected_rule'], ['allocation', 'allocation_selected_rule'], ['allocationPer', 'allocation_per_resident']],
        [`${info.name} — HYPOTHETICAL allocation of an illustrative ${budget} million (${ruleName})`, `Poverty: World Bank SPID ${set.survey} ${set.year}, line ${L.label}; population as stated in methods`, 'Not a prediction of poverty reduction, programme effectiveness or optimal spending'])});
  }

  // ---------------------------------------------------------------- 3. Health, education and human development
  async function human(info, d, q) {
    const cap = P.capabilities(d, info);
    const views = [...(cap.dhs.length ? [['dhs', 'Health and demographic surveys by region']] : []), ...(cap.mpm.length ? [['mpm', 'Deprivation in basic services by area']] : []), ['nat', 'National indicators']];
    const view = views.some(v => v[0] === q.view) ? q.view : views[0][0];
    const ids = view === 'dhs' ? cap.dhs : view === 'mpm' ? cap.mpm : [];
    const ind = ids.includes(q.ind) ? q.ind : (ids.includes('dhs_api:CN_NUTS_C_HA2') ? 'dhs_api:CN_NUTS_C_HA2' : ids[0]);
    const pers = ind ? P.periods(d, ind) : [];
    const latestY = pers.length ? Math.max(...pers.map(p => p.y)) : 0;
    const defP = pers.reduce((best, p, i) => p.y === latestY && (best < 0 || p.u.length > pers[best].u.length) ? i : best, -1);
    const pi = pers.length ? Math.min(q.p != null && q.p !== '' ? +q.p : defP, pers.length - 1) : 0;
    main.innerHTML = shell(info, 'human', 'descriptive',
      sel('c-view', 'Evidence', views, view) +
      (ids.length ? sel('c-ind', 'Indicator', ids.map(i => [i, title(i)]).sort((a, b) => a[1].localeCompare(b[1])), ind) : '') +
      (pers.length > 1 ? sel('c-p', 'Survey and geographic level', pers.map((p, i) => [i, `${p.y} · ${P.LEVEL[p.lv] || p.lv} (${p.u.length})`]), pi) : ''));
    const upd = reset => { setQuery({view: qs('c-view').value, ind: reset ? '' : qs('c-ind')?.value, p: reset ? '' : qs('c-p')?.value}); route(); };
    qs('c-view').onchange = () => upd(true); if (qs('c-ind')) qs('c-ind').onchange = () => { setQuery({view, ind: qs('c-ind').value}); route(); }; if (qs('c-p')) qs('c-p').onchange = () => upd(false);
    if (view === 'nat') return humanNational(info, d);
    const p = pers[pi], meta = S.ind.get(ind) || {};
    const share = /0-1/.test(meta.unit || '') || ind.startsWith('wb_spid:mpm_');
    const k = share ? 100 : 1;
    const items = p.u.map(u => ({label: String(u[1]).replace(/^\.+/, ''), value: u[2] != null ? u[2] * k : null, lo: u[3] != null ? u[3] * k : null, hi: u[4] != null ? u[4] * k : null, code: u[0]}));
    const unit = share ? '% of people' : (meta.unit === 'Percent' ? '%' : meta.unit || '');
    const lvl = P.LEVEL[p.lv] || 'areas';
    qs('a-question').textContent = `How does “${title(ind)}” vary across ${lvl} of ${info.name}? (${p.y})`;
    const rs = P.rankSummary(items, 'value');
    const withCI = items.filter(i => i.lo != null).length;
    const uncTxt = view === 'dhs' ? (withCI ? `Black lines show the 95% confidence intervals published by DHS for ${withCI} of ${items.length} ${lvl}. Where intervals overlap, the difference may not be statistically meaningful.` : 'DHS did not publish confidence intervals for this indicator and survey in the source data; differences of a few points between regions may not be statistically meaningful.') : UNC.mpm;
    const EV = {compat: null, validation: ['Not re-validated', 'gray', view === 'dhs' ? 'Shown exactly as published by The DHS Program; the Studio does not re-estimate these values.' : 'Shown exactly as published by the World Bank; the Studio does not re-estimate these values.'],
      uncertainty: withCI ? ['95% intervals shown', '', uncTxt] : ['Not published', 'amber', uncTxt], interpretation: ['Descriptive', 'Shows where outcomes or deprivations are worse; it does not explain why.']};
    qs('a-check').innerHTML = evidencePanel(EV);
    qs('a-kpis').innerHTML = rs ? kpi(`${F(rs.highest.value, 1)}`, `highest: ${E(rs.highest.label)}`) + kpi(`${F(rs.lowest.value, 1)}`, `lowest: ${E(rs.lowest.label)}`) + kpi(String(items.length), lvl) : '';
    const g = view === 'mpm' ? await geo(info.iso3) : null;
    qs('a-main').innerHTML = (view === 'mpm' ? `<div class="${items.length > 20 ? '' : 'grid2'}"><div><h3>Map</h3>${Ch.map(g, new Map(items.map(i => [i.code, i.value])), {unit})}</div><div><h3 style="margin-top:14px">Ranking</h3>${ranking('rk-h', items, {unit})}</div></div>`
      : `<h3>${E(title(ind))}</h3><p class="small muted">${E(unit)}</p>${ranking('rk-h', items, {unit, labelWidth: 190})}`) +
      `<p class="unc">Uncertainty: ${E(uncTxt)}</p>` +
      table('tb-h', items.map(i => ({name: i.label, v: i.value, lo: i.lo, hi: i.hi})), [{key: 'name', label: 'Area'}, {key: 'v', label: E(unit) || 'Value', num: true, sortDefault: true}, {key: 'lo', label: '95% CI low', num: true}, {key: 'hi', label: '95% CI high', num: true}]);
    const I = {
      meaning: [`${E(title(ind))}: ${E(meta.def || '')}`, rs ? `Values range from ${F(rs.lowest.value, 1)} in ${E(rs.lowest.label)} to ${F(rs.highest.value, 1)} in ${E(rs.highest.label)}.` : ''].filter(Boolean),
      cannot: ['Causes of the differences between regions.', view === 'dhs' ? 'Trends for a region across surveys: survey regions are defined separately in each survey and are not assumed to be the same area.' : 'Changes over time unless the same survey and boundaries are used.',
        'Differences smaller than the published confidence intervals, or any differences where intervals are not published.'],
      data: [view === 'dhs' ? `The DHS Program (ICF), ${E(p.b.replace('survey=', ''))} survey, published regional estimates.` : `World Bank multidimensional poverty measure by area (harmonised household surveys), ${p.y}.`, `Geographic level: ${lvl}${p.bv ? ' · ' + E(p.bv) : ''}.`],
      method: [E(meta.method || 'As published.'), share ? 'Shares are displayed as percentages.' : 'Values as published.'],
    };
    qs('a-interp').innerHTML = interp(I); bindTabs(qs('a-interp'));
    downloads(info, {slug: `human_${ind.replace(/[^A-Za-z0-9]/g, '_')}_${p.y}`, kind: 'descriptive', title: title(ind), question: qs('a-question').textContent, interp: I, evidence: EV, findings: [I.meaning[1] || '', uncTxt].filter(Boolean),
      figure: Ch.bars(items, {unit}), csv: () => P.csv(items, [['code', 'geo_code'], ['label', 'area'], ['value', 'value'], ['lo', 'ci95_low'], ['hi', 'ci95_high']], [`${info.name} — ${title(ind)} (${p.y}, ${lvl})`, `Source: ${meta.cite || ''}`, `Licence: ${meta.lic || ''}`, withCI ? 'Confidence intervals as published' : 'No confidence intervals published'])});
  }
  function humanNational(info, d) {
    const ids = [['wb_wdi:SP.DYN.LE00.IN', 'Life expectancy at birth (years)', true], ['wb_wdi:SH.DYN.MORT', 'Under-five deaths per 1,000 live births', true], ['wb_wdi:SE.PRM.CMPT.ZS', 'Primary completion (% of age group)', true], ['wb_wdi:SH.STA.STNT.ZS', 'Children stunted (%) — survey years, not joined', false]];
    qs('a-question').textContent = `How have health and education outcomes changed in ${info.name}, nationally?`;
    qs('a-check').innerHTML = evidencePanel({compat: null, validation: ['Not re-validated', 'gray', 'Shown as published in the World Development Indicators.'], uncertainty: ['Not shown', 'amber', 'Most of these series are modelled or survey-based estimates whose uncertainty is not published here.'], interpretation: ['Descriptive', 'National averages; they hide differences between regions.']});
    qs('a-main').innerHTML = `<div class="grid2">${ids.map(([id, n, connect]) => { const s = P.nationalSeries(d, id); return `<div><h3 style="font-size:15px">${n}</h3>${s ? Ch.line([{name: n, connect, points: s.d.map(p => [p[0], p[1]])}], {zero: false}) : Ch.empty('Not available.')}</div>`; }).join('')}</div><p class="small muted">World Development Indicators (World Bank). Survey-based series (stunting) are shown as separate points because surveys are not necessarily comparable.</p>`;
    const I = {meaning: ['Broad national trends in health and education outcomes.'], cannot: ['Differences between regions.', 'Changes between survey-based points that come from different survey types.'], data: ['World Development Indicators (World Bank), compiled from UN agencies and national sources.'], method: ['As published.']};
    qs('a-interp').innerHTML = interp(I); bindTabs(qs('a-interp'));
    if (!ids.some(([id]) => P.nationalSeries(d, id))) { qs('a-dl').innerHTML = '<span class="small muted">Nothing to download: no national health or education indicators for this country.</span>'; return; }
    downloads(info, {slug: 'human_national', kind: 'descriptive', title: AREAS.human.title, question: qs('a-question').textContent, interp: I, findings: [],
      csv: () => P.csv(ids.flatMap(([id]) => (P.nationalSeries(d, id)?.d || []).map(p => ({id, y: p[0], v: p[1]}))), [['id', 'indicator'], ['y', 'year'], ['v', 'value']], ['Source: World Bank WDI (CC BY 4.0)'])});
  }

  // ---------------------------------------------------------------- 4. Climate exposure and regional vulnerability
  async function climate(info, d, q) {
    const cap = P.capabilities(d, info);
    if (cap.climate.level === 'none') {
      main.innerHTML = shell(info, 'climate', 'context', '<p class="small muted">No settings available.</p>');
      qs('a-question').textContent = `Which areas of ${info.name} had unusual rainfall?`;
      qs('a-check').innerHTML = `<div class="note warn"><strong>Not available for ${E(info.name)}.</strong> ${E(cap.climate.detail)}</div>`;
      qs('a-main').innerHTML = Ch.empty('Regional rainfall summaries are only built for areas covered by the regional poverty map, between latitudes 50°S and 50°N.');
      qs('a-interp').innerHTML = ''; qs('a-dl').innerHTML = '<span class="muted small">Nothing to download.</span>'; return;
    }
    const sets = cap.spid.slice().reverse();
    const si = Math.min(+(q.set || 0), sets.length - 1), set = sets[si];
    const codes = new Set(set.period.u.map(u => u[0]));
    const years = [...new Set(cap.chirps.map(p => p.y))].sort((a, b) => b - a);
    const year = years.includes(+q.year) ? +q.year : years[0], measure = q.m === 'mm' ? 'mm' : 'anom';
    const anom = P.valuesFor(d, 'chirps:precip_anomaly_pct', year, codes), mm = P.valuesFor(d, 'chirps:precip_annual_mm', year, codes);
    main.innerHTML = shell(info, 'climate', 'context',
      sel('c-year', 'Rainfall year', years.map(y => [y, String(y)]), year) +
      sel('c-m', 'Show', [['anom', 'Rainfall compared with normal (%)'], ['mm', 'Total annual rainfall (mm)']], measure) +
      sel('c-set', 'Areas (poverty survey boundaries)', sets.map((s, i) => [i, `${s.year} · ${s.survey} · ${s.n} areas`]), si));
    ['c-year', 'c-m', 'c-set'].forEach(id => qs(id).onchange = () => { setQuery({year: qs('c-year').value, m: qs('c-m').value, set: qs('c-set').value}); route(); });
    const CL = P.LINES[defaultLine(info)];
    const rate = P.valuesFor(d, CL.spid, set.year, codes, set.survey);
    const rows = set.period.u.map(u => ({code: u[0], name: u[1], anom: anom.get(u[0])?.v ?? null, mm: mm.get(u[0])?.v ?? null, pov: rate.get(u[0])?.v != null ? rate.get(u[0]).v * 100 : null}));
    const have = rows.filter(r => r.anom != null || r.mm != null).length;
    qs('a-question').textContent = `Which areas of ${info.name} had unusually wet or dry conditions in ${year}, and how poor are they?`;
    if (!have) { qs('a-main').innerHTML = Ch.empty('No rainfall values for these areas and year. Try another set of areas.'); qs('a-interp').innerHTML = ''; qs('a-dl').innerHTML = ''; return; }
    const EV = {compatText: ['Same boundaries, different years', 'amber', `Rainfall is summarised over the same ${set.n} area boundaries as the poverty estimates (${set.survey} ${set.year}); rainfall refers to ${year}. Shown side by side only — not combined into one measure.`],
      validation: ['Not validated', 'gray', 'Area averages are computed by the Studio from CHIRPS grids; they have not been compared with national meteorological records.'],
      uncertainty: ['Not published', 'amber', 'CHIRPS publishes no uncertainty for annual totals; small anomalies (a few percent) may be within estimation error. Poverty estimates carry unpublished sampling error.'],
      interpretation: ['Context only', 'Shows exposure to unusual rainfall next to poverty; no effect of rainfall on poverty is estimated.']};
    qs('a-check').innerHTML = evidencePanel(EV);
    const v = r => measure === 'anom' ? r.anom : r.mm, unit = measure === 'anom' ? '% vs 1991–2020 normal' : 'mm per year';
    const dry = rows.filter(r => r.anom != null).sort((a, b) => a.anom - b.anom);
    const dryPoor = dry.filter(r => r.anom <= -15);
    qs('a-kpis').innerHTML = (dry.length ? kpi(`${F(dry[0].anom, 0)}%`, `driest relative to normal: ${E(dry[0].name)}`) + kpi(`${dry.at(-1).anom > 0 ? '+' : ''}${F(dry.at(-1).anom, 0)}%`, `wettest relative to normal: ${E(dry.at(-1).name)}`) : '') +
      kpi(String(dryPoor.length), `areas at least 15% drier than normal in ${year}`);
    const g = await geo(info.iso3);
    const span = Math.max(...dry.map(r => Math.abs(r.anom)), 10);
    qs('a-main').innerHTML = `<div class="grid2"><div><h3>Map · ${year}</h3>${Ch.map(g, new Map(rows.map(r => [r.code, v(r)])), measure === 'anom' ? {unit, diverging: true, min: -span, max: span} : {unit})}<p class="small muted">${measure === 'anom' ? 'Red = drier than normal, blue = wetter.' : ''}</p></div>
      <div><h3>Rainfall and poverty by area</h3>${Ch.scatter(rows.filter(r => r.anom != null && r.pov != null).map(r => ({x: r.pov, y: r.anom + 100, label: r.name, short: r.name})), {xLabel: `Poverty, % below ${CL.label} (${set.year})`, yLabel: `Rainfall ${year}, % of normal`, emptyMsg: 'Poverty or rainfall missing for these areas.'})}
      <p class="small muted">Poverty refers to ${set.year}; rainfall to ${year}. Shown side by side only.</p></div></div>
      <p class="unc">Uncertainty: ${E(EV.uncertainty[2])}</p>` +
      table('tb-cl', dry.map(r => ({name: r.name, mm: r.mm, anom: r.anom, pov: r.pov})), [{key: 'name', label: 'Area'}, {key: 'mm', label: `Rainfall ${year} (mm)`, num: true, d: 0}, {key: 'anom', label: 'vs normal (%)', num: true, sortDefault: true}, {key: 'pov', label: `Poverty below ${CL.label}, ${set.year} (%)`, num: true}]);
    const sec = qs('a-second'); sec.hidden = false;
    const reg = q.area && codes.has(q.area) ? q.area : dry[0]?.code;
    const ts = P.periods(d, 'chirps:precip_annual_mm').map(p => [p.y, (p.u.find(u => u[0] === reg) || [])[2]]).filter(x => x[1] != null);
    sec.innerHTML = `<h3>Rainfall history for one area</h3>${sel('c-area', 'Area', rows.filter(r => r.mm != null).map(r => [r.code, r.name]).sort((a, b) => a[1].localeCompare(b[1])), reg)}${Ch.line([{name: 'Annual rainfall (mm)', points: ts}], {zero: false})}`;
    qs('c-area').onchange = () => { setQuery({year, m: measure, set: si, area: qs('c-area').value}); route(); };
    const I = {
      meaning: [`Rainfall compared with each area's own 1991–2020 average shows where ${year} was unusually dry or wet.`, dryPoor.length ? `${dryPoor.length} areas were at least 15% drier than normal; ${dryPoor.filter(r => r.pov != null && r.pov >= 50).length} of them have poverty rates of 50% or more (${set.year}).` : `No area was 15% or more drier than normal in ${year}.`,
        'Combining exposure (unusual rainfall) with poverty can flag areas where households may have less capacity to cope — as a prompt for further analysis.'],
      cannot: ['Impacts on harvests, incomes or poverty — no impact is estimated and none should be inferred.', 'Vulnerability in a full sense: it also depends on livelihoods, irrigation, markets and safety nets, which are not measured here.',
        'Anything about years other than those shown; poverty and rainfall years may differ.'],
      data: [`CHIRPS v2.0 satellite–gauge rainfall (Climate Hazards Center, UC Santa Barbara), ${year}.`, `Areas: World Bank poverty-map boundaries for ${set.survey} ${set.year} (${set.n} areas); poverty from SPID ${set.year}, line ${CL.label}.`],
      method: ['Area rainfall = average of all 0.05° grid cells within the area.', 'Anomaly = (rainfall in the year − 1991–2020 average) ÷ 1991–2020 average.', 'No statistical relationship between rainfall and poverty is estimated.'],
    };
    qs('a-interp').innerHTML = interp(I); bindTabs(qs('a-interp'));
    downloads(info, {slug: `climate_${year}`, kind: 'context', title: AREAS.climate.title, question: qs('a-question').textContent, interp: I, evidence: EV, findings: [I.meaning[1]],
      csv: () => P.csv(dry, [['code', 'geo_code'], ['name', 'area'], ['mm', `rainfall_mm_${year}`], ['anom', 'anomaly_pct_vs_1991_2020'], ['pov', `poverty_pct_${CL.key}_${set.year}`]], [`${info.name} — rainfall ${year} and poverty ${set.year}`, 'Rainfall: CHIRPS v2.0 (public domain; cite Funk et al. 2015); no uncertainty published', 'Poverty: World Bank SPID (CC BY 4.0); no standard errors published'])});
  }

  // ---------------------------------------------------------------- all data for a country (technical browser)
  async function viewData(info, d, q) {
    await catalog().catch(() => null);
    const list = [];
    const seen = new Set();
    for (const s of d.national) if (!seen.has(s.i)) { seen.add(s.i); list.push({id: s.i, lv: 'National'}); }
    for (const id of Object.keys(d.subnational)) list.push({id, lv: 'Regional'});
    main.innerHTML = `<div class="crumb"><a href="#/">All countries</a> › <a href="#/c/${info.iso3}">${E(info.name)}</a> › All data</div>
      <div class="chead"><div><h1>All data for ${E(info.name)}</h1><p class="muted">For technical users: every indicator in the Studio for this country, with full provenance.</p></div></div>
      <div class="alayout"><aside class="controls card"><div><label class="f" for="dq">Search indicators</label><input id="dq" type="search" placeholder="e.g. stunting, poverty, spending" value="${E(q.s || '')}"></div>
        ${sel('dl', 'Level', [['', 'National and regional'], ['National', 'National'], ['Regional', 'Regional']], q.lv || '')}<div id="dres" style="max-height:420px;overflow:auto"></div></aside>
      <div><section class="card" id="dchart"><div class="empty"><strong>Select an indicator</strong><span>Use the search on the left.</span></div></section><section class="card" id="dprov" hidden></section></div></div>`;
    const draw = () => {
      const s = qs('dq').value.toLowerCase(), lv = qs('dl').value;
      const xs = list.filter(x => (!lv || x.lv === lv) && (!s || title(x.id).toLowerCase().includes(s) || x.id.toLowerCase().includes(s))).sort((a, b) => (a.lv > b.lv) - (a.lv < b.lv) || title(a.id).localeCompare(title(b.id)));
      qs('dres').innerHTML = xs.slice(0, 150).map(x => `<button class="btn ghost sm" style="display:block;width:100%;text-align:left;margin:4px 0" data-ind="${E(x.id)}" data-lv="${x.lv}">${E(title(x.id))}<br><span class="small muted">${x.lv}</span></button>`).join('') || '<div class="empty">No matching indicators.</div>';
      qs('dres').querySelectorAll('[data-ind]').forEach(b => b.onclick = () => showInd(b.dataset.ind, b.dataset.lv));
    };
    const showInd = (id, lv) => {
      const m = S.ind.get(id) || {};
      if (lv === 'National') {
        const ser = d.national.filter(s => s.i === id);
        const pip = id.startsWith('wb_pip:'), survey = SURVEY_BASED.some(x => id.startsWith(x));
        qs('dchart').innerHTML = `<h3>${E(title(id))}</h3><p class="small muted">${E(m.unit || '')}</p>` + Ch.line(ser.slice(0, 4).map(s => ({name: s.b === 'total' ? 'Total' : s.b, groupBy: pip, connect: pip || !survey,
            points: s.d.map(p => [p[0], p[1], p[2], p[3], p[4], pip && p[6] != null ? s.b + '|' + p[6] : null, pip ? `${p[7] || ''} ${p[0]}`.trim() : null])})), {zero: false}) +
          (ser.length > 4 ? `<p class="small muted">${ser.length - 4} further breakdowns available in the downloadable file.</p>` : '') +
          (pip ? '<p class="small muted">Lines join only surveys the Poverty and Inequality Platform classifies as comparable; separate points or segments mark methodological breaks.</p>' : survey ? '<p class="small muted">Survey-based indicator: points are not joined because comparability between surveys is not established here.</p>' : '') +
          (ser.some(s => s.d.some(p => p[4] === 'p')) ? '<p class="small muted">Open circles are projections, not observed values.</p>' : '');
      } else {
        const per = P.periods(d, id).at(-1);
        const k = /0-1/.test(m.unit || '') ? 100 : 1;
        const spl = P.splitLevels(per.u), units = spl.mixed ? spl.sub : per.u;
        qs('dchart').innerHTML = `<h3>${E(title(id))}</h3><p class="small muted">Latest period: ${per.y} · ${E(per.rp)} · ${E(P.LEVEL[per.lv] || per.lv)}${k === 100 ? ' · shown as %' : ''}${spl.mixed ? ` · showing ${spl.sub.length} sub-regions (the ${spl.top.length} larger regions are in the regional analysis)` : ''}</p>` + ranking('rk-data', units.map(u => ({label: String(u[1]).replace(/^\.+/, ''), value: u[2] != null ? u[2] * k : null, lo: u[3] != null ? u[3] * k : null, hi: u[4] != null ? u[4] * k : null}))) + (units.some(u => u[3] != null) ? '<p class="unc">Lines show published 95% confidence intervals.</p>' : '<p class="unc">No uncertainty estimates are published for these values; small differences may not be meaningful.</p>');
      }
      const pv = qs('dprov'); pv.hidden = false;
      pv.innerHTML = `<h3>Provenance</h3><table><tbody>${[['Source', E(m.cite || '')], ['Definition', E(m.def || '')], ['Unit', E([m.unit, m.cur, m.price].filter(Boolean).join(' · '))], ['Method', E(m.method || '')], ['Uncertainty', E(m.unc || '')], ['Comparability', E([m.gc, m.note].filter(Boolean).join(' — '))], ['Licence', E(m.lic || '')], ['Original page', m.url ? `<a href="${E(m.url)}" target="_blank" rel="noopener noreferrer">${E(m.url)}</a>` : ''], ['Indicator code', `<span class="mono">${E(id)}</span>`]].map(([a, b]) => `<tr><th style="width:150px">${a}</th><td>${b}</td></tr>`).join('')}</tbody></table>`;
    };
    qs('dq').oninput = draw; qs('dl').onchange = draw; draw();
  }

  // ---------------------------------------------------------------- data sources & methods
  async function viewSources(q) {
    const cat = await catalog();
    const ST = {integrated: ['', 'Integrated'], integrated_partial: ['amber', 'Partly integrated'], blocked: ['red', 'Blocked'], restricted: ['red', 'Registration required'], deferred: ['gray', 'Not yet integrated']};
    main.innerHTML = `<div class="chead"><div><h1>Data sources &amp; methods</h1><p class="muted">Where every number comes from, how it was checked, and what each analysis can and cannot show.</p></div></div>
      <div class="tabs" role="tablist"><button data-st="src" class="on">Sources</button><button data-st="ind">Indicator catalogue</button><button data-st="meth">How analyses are checked</button><button data-st="glo">Glossary</button></div>
      <section class="card" data-sp="src"><div class="grid2"><div><label class="f" for="sq">Search sources</label><input id="sq" type="search" placeholder="e.g. poverty, WHO, rainfall"></div>${sel('sst', 'Status', [['', 'All'], ...Object.entries(ST).map(([k, v]) => [k, v[1]])], '')}</div><div id="slist"></div></section>
      <section class="card" data-sp="ind" hidden><label class="f" for="iq">Search ${F(cat.indicators.length, 0)} indicators</label><input id="iq" type="search" placeholder="e.g. stunting, government expenditure"><div id="ilist" style="margin-top:10px"></div></section>
      <section class="card interp" data-sp="meth" hidden>
        <h3>Automatic compatibility checks</h3><p>Before any analysis combines datasets, the Studio checks that they describe the same areas (identical codes, or a documented one-to-one boundary overlay — never matching by names), the same year, comparable units, observed rather than projected values, and complete data for every area. Each check has one of four outcomes:</p>
        <ul><li><strong>Compatible</strong> — can be combined directly.</li><li><strong>Compatible after a documented step</strong> — for example converting shares to percentages or linking areas through the boundary overlay; each step is listed.</li><li><strong>Descriptive only</strong> — can be shown side by side but not combined (for example different years or projected values).</li><li><strong>Not mergeable</strong> — the analysis is not offered.</li></ul>
        <h3>Types of analysis</h3><ul><li><strong>Descriptive evidence</strong> — published estimates shown as they are.</li><li><strong>Hypothetical allocation</strong> — a funding formula applied to need indicators. It is not a forecast of poverty reduction.</li><li><strong>Observed expenditure comparison</strong> — actual spending recorded in government accounts, compared with need. Spending located in a region is not the same as benefits received by households.</li><li><strong>Descriptive context</strong> — e.g. rainfall beside poverty, with no causal claim.</li></ul>
        <h3>Validation</h3><p>The warehouse is tested automatically (45 data tests): file checksums, duplicates, units, projection flags, boundary links, and agreement with official figures — for example, population-weighted regional poverty matches the official national rate within 2 percentage points in 95% of 479 surveys.</p>
        <h3>Not available on this site</h3><p>Registration-only microdata (Global Data Lab, MICS, Service Delivery Indicators), World Bank BOOST files (catalogue access blocked during acquisition) and IMF Government Finance Statistics values (licence for redistribution not yet confirmed).</p></section>
      <section class="card" data-sp="glo" hidden><dl class="glossary">${[
        ['SPID', 'World Bank Subnational Poverty and Inequality Database: poverty and inequality estimates for areas within countries, from household surveys.'],
        ['PPP (purchasing power parity)', 'Prices adjusted so that a dollar buys a comparable basket of goods in every country. Poverty lines here use 2021 PPP dollars.'],
        ['Poverty line ($3.00, $4.20, $8.30 a day)', 'Daily consumption or income per person below which someone is counted as poor; $3.00 is the international extreme-poverty line.'],
        ['Gini index', 'Inequality measure from 0 (everyone equal) to 100 (one person has everything).'],
        ['DHS', 'Demographic and Health Surveys: nationally representative household surveys on health, nutrition and population.'],
        ['WorldPop', 'Population estimates on a 1 km grid, built from censuses and satellite data, summed within each area.'],
        ['CHIRPS', 'Climate Hazards Group rainfall data combining satellite images and rain gauges.'],
        ['SICONFI', 'Brazil National Treasury system holding the annual accounts of states and municipalities.'],
        ['Benefit incidence', 'Analysis of which households actually receive the benefits of public spending. Not performed here.'],
        ['Confidence interval', 'A range that reflects sampling uncertainty in a survey estimate.']].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl></section>`;
    main.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { main.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b)); main.querySelectorAll('[data-sp]').forEach(p => p.hidden = p.dataset.sp !== b.dataset.st); });
    const drawS = () => {
      const s = qs('sq').value.toLowerCase(), st = qs('sst').value;
      qs('slist').innerHTML = cat.sources.filter(x => (!st || x.access_status === st) && (!s || JSON.stringify([x.name, x.institution, x.topic, x.notes]).toLowerCase().includes(s))).map(x => {
        const [c, l] = ST[x.access_status] || ['gray', x.access_status];
        return `<div class="srcrow"><div><strong>${E(x.name)}</strong> <span class="pill ${c}">${l}</span>${x.public_release ? '' : ' <span class="pill gray">not published here</span>'}<div class="small muted">${E(x.institution)} · ${E(x.topic)} · ${E(x.geo_levels)}</div><div class="small">${E(x.notes)}</div>
          <details><summary class="small">Access and licence</summary><div class="small">Access: ${E(x.access_method)}<br>Licence: ${E(x.licence)}<br>Cite: ${E(x.attribution)}<br><a href="${E(x.url)}" target="_blank" rel="noopener noreferrer">Original source</a></div></details></div>
          <div class="small muted" style="text-align:right;min-width:120px">${x.qa?.rows ? `${F(x.qa.rows, 0)} values<br>${x.qa.countries} countries<br>${x.qa.year_min}–${x.qa.year_max}` : ''}</div></div>`;
      }).join('') || '<div class="empty">No sources match.</div>';
    };
    qs('sq').oninput = drawS; qs('sst').onchange = drawS; drawS();
    qs('iq').oninput = () => {
      const s = qs('iq').value.toLowerCase().trim();
      if (s.length < 2) { qs('ilist').innerHTML = '<p class="small muted">Type at least two letters.</p>'; return; }
      const xs = cat.indicators.filter(i => i.t.toLowerCase().includes(s) || i.id.toLowerCase().includes(s)).slice(0, 60);
      qs('ilist').innerHTML = xs.map(i => `<details class="srcrow" style="display:block"><summary>${E(i.t)} <span class="small muted">· ${E(S.src.get(i.s)?.institution || i.s)} · ${i.n} countries · ${i.y0}–${i.y1}${/ADM0/.test(i.lv) && i.lv.length === 4 ? '' : ' · regional'}</span></summary>
        <div class="small"><p>${E(i.def)}</p><p><strong>Unit:</strong> ${E(i.unit)} · <strong>Licence:</strong> ${E(i.lic)}</p><p><strong>Method:</strong> ${E(i.method)}</p><p><strong>Comparability:</strong> ${E(i.gc)}. ${E(i.note)}</p><p class="mono">${E(i.id)}</p></div></details>`).join('') || '<div class="empty">No indicators match.</div>';
    };
    qs('iq').dispatchEvent(new Event('input'));
  }

  route();
})();
