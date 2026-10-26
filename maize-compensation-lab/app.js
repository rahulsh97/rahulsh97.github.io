// app.js -- Maize Compensation Lab. Renders precomputed, validated results from data.json.
// No simulation, estimation or interpolation happens here (see core.js).
(function () {
  const C = window.MaizeCore;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PRESETS = {
    central: { pi: 0.25, lambda: 0.5, theta: 0.85, eps: 0, kappa: 0.5, green: 'FALSE', annual: 'x52' },
    lambda0: { pi: 0.25, lambda: 0, theta: 0.85, eps: 0, kappa: 0.5, green: 'FALSE', annual: 'x52' },
    lambda1: { pi: 0.25, lambda: 1, theta: 0.85, eps: 0, kappa: 0.5, green: 'FALSE', annual: 'x52' }
  };
  const RULE_ORDER = ['R1_universal', 'R2_geographic', 'R4_exposure', 'R3_pmt', 'R5_pmt_exposure',
    'B1_perfect_gap', 'B2_perfect_loss_postpoor', 'B3_perfect_loss_initpoor'];
  let data, sel = { ...PRESETS.central }, obj = 'P1', decRule = 'R3_pmt', geoSort = 'P1_post';

  // ---------- state <-> URL ----------
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const cand = { ...sel };
    C.PARAM_ORDER.forEach(p => { if (h.has(p)) cand[p] = h.get(p); });
    if (C.isValidated(data, cand)) sel = normalise(cand);   // anything not validated is ignored
    if (h.has('objective') && C.OBJECTIVES[h.get('objective')]) obj = h.get('objective');
  }
  function writeHash() {
    const h = new URLSearchParams();
    C.PARAM_ORDER.forEach(p => h.set(p, sel[p])); h.set('objective', obj);
    history.replaceState(null, '', '#' + h.toString());
  }
  function normalise(s) {
    const o = {};
    C.PARAM_ORDER.forEach(p => { const v = s[p]; o[p] = (p === 'green' || p === 'annual') ? String(v) : Number(v); });
    return o;
  }

  // ---------- controls ----------
  function buildControls() {
    $('controls').innerHTML = C.PARAM_ORDER.map(p =>
      `<label>${esc(C.PARAM_INFO[p].label)}<select id="p-${p}" data-param="${p}">` +
      data.params[p].map(v => `<option value="${esc(v)}">${esc(C.PARAM_INFO[p].fmt(v))}</option>`).join('') +
      `</select></label>`).join('');
    C.PARAM_ORDER.forEach(p => $('p-' + p).addEventListener('change', e => {
      const cand = { ...sel, [p]: e.target.value };
      if (C.isValidated(data, cand)) { sel = normalise(cand); render(); }
    }));
    document.querySelectorAll('input[name="objective"]').forEach(r => r.addEventListener('change', e => { obj = e.target.value; render(); }));
    document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => { sel = { ...PRESETS[b.dataset.preset] }; render(); }));
    $('dec-rule').innerHTML = ['R1_universal', 'R2_geographic', 'R3_pmt', 'R4_exposure', 'R5_pmt_exposure', 'B1_perfect_gap', 'B3_perfect_loss_initpoor']
      .map(r => `<option value="${r}">${esc(C.RULE_INFO[r].label)}</option>`).join('');
    $('dec-rule').value = decRule;
    $('dec-rule').addEventListener('change', e => { decRule = e.target.value; renderDeciles(); });
    $('geo-sort').addEventListener('change', e => { geoSort = e.target.value; renderGeoTable(); });
  }
  function syncControls() {
    C.PARAM_ORDER.forEach(p => { $('p-' + p).value = String(sel[p]); });
    document.querySelectorAll('input[name="objective"]').forEach(r => { r.checked = r.value === obj; });
    const k = C.scenarioKey(sel);
    document.querySelectorAll('.preset').forEach(b => b.setAttribute('aria-pressed', String(C.scenarioKey(PRESETS[b.dataset.preset]) === k)));
  }

  // ---------- headline ----------
  function renderHeadline(key) {
    const boot = data.boot[key], g = data.grid[key], O = C.OBJECTIVES[obj];
    const best = C.bestImplementable(data, key, obj);
    $('status').innerHTML =
      `<span class="badge"><strong>Precomputed</strong> · validated scenario (1 of ${data.meta.scenarios})</span>` +
      (boot ? `<span class="badge"><strong>Uncertainty available</strong> · ${data.meta.replicates}-replicate survey bootstrap</span>`
            : `<span class="badge warn"><strong>Point estimate only</strong> · bootstrap computed for 3 scenarios (use the buttons above)</span>`) +
      `<span class="badge">Budget: ${esc(C.PARAM_INFO.kappa.fmt(sel.kappa))}, identical for every rule</span>`;
    $('stat-shock').textContent = g.P1_shock.toFixed(2);
    $('stat-shock-cap').textContent = `Poverty gap ×100 after the shock, up from ${data.shock['P1 pre'].toFixed(2)} before it.`;
    $('stat-best').textContent = C.RULE_INFO[best].short;
    const gap = Math.abs(C.value(data, key, 'R5_pmt_exposure', obj) - C.value(data, key, 'R3_pmt', obj));
    const tie = (best === 'R3_pmt' || best === 'R5_pmt_exposure') && gap < (obj === 'loss_comp' ? 0.002 : 0.01);
    $('stat-best-cap').textContent = `${O.label}: ${C.fmtValue(obj, C.value(data, key, best, obj))} (${O.better} is better). ` +
      (tie ? 'Practically tied with the other PMT rule. ' : '') + (C.RULE_INFO[best].cls === 'survey-ideal' ? 'Survey-ideal: an upper bound.' : '');
    $('stat-share').textContent = C.pct(C.shareAttainable(data, key, best, obj));
    $('stat-share-cap').textContent = `of the improvement a perfect-information rule would achieve with the same budget (derived).`;
    const d = C.value(data, key, 'R5_pmt_exposure', obj) - C.value(data, key, 'R3_pmt', obj);
    $('stat-exposure').textContent = C.fmtDiff(obj, d);
    const ci = boot && boot.diff_vs_R3.R5_pmt_exposure && boot.diff_vs_R3.R5_pmt_exposure[obj];
    $('stat-exposure-cap').textContent = ci ? `PMT + exposure minus PMT. 95% interval ${C.fmtDiff(obj, ci[2])} to ${C.fmtDiff(obj, ci[3])}: not distinguishable from zero.`
      : `PMT + exposure minus PMT on ${O.label.toLowerCase()} (point estimate).`;
  }

  // ---------- rules chart ----------
  function renderRules(key) {
    const best = C.bestImplementable(data, key, obj);
    const W = 640, row = 34, T = 18, L = 230, R = 70, H = T + RULE_ORDER.length * row + 34;
    const x = s => L + Math.max(0, Math.min(1.05, s)) / 1.05 * (W - L - R);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of the attainable improvement achieved by each rule for ${esc(C.OBJECTIVES[obj].label)}"><defs>
      <pattern id="hatch-ideal" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="6" height="6" fill="var(--s-ideal)"/><rect width="2" height="6" fill="#8fd0da"/></pattern>
      <pattern id="hatch-bench" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--s-bench)"/><rect width="2" height="6" fill="#dfe4e4"/></pattern></defs>`;
    [0, .25, .5, .75, 1].forEach(t => {
      s += `<line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="${T - 6}" y2="${H - 30}"/><text class="tick" x="${x(t)}" y="${H - 14}" text-anchor="middle">${t * 100}%</text>`;
    });
    RULE_ORDER.forEach((r, i) => {
      const y = T + i * row, info = C.RULE_INFO[r], v = C.shareAttainable(data, key, r, obj);
      const fill = info.cls === 'benchmark' ? 'url(#hatch-bench)' : info.cls === 'survey-ideal' ? 'url(#hatch-ideal)' : 'var(--s-impl)';
      if (i === 5) s += `<line x1="8" x2="${W - 8}" y1="${y - 4}" y2="${y - 4}" stroke="#b9c6c2" stroke-dasharray="3 3"/>`;
      s += `<text class="value-label" x="${L - 10}" y="${y + 17}" text-anchor="end"${info.cls === 'benchmark' ? ' font-style="italic"' : ''}>${esc(info.label)}</text>`;
      s += `<rect x="${L}" y="${y + 6}" width="${Math.max(1, x(v) - L)}" height="16" rx="2" fill="${fill}"><title>${esc(info.label)}: ${C.pct(v)} of attainable (${esc(C.OBJECTIVES[obj].label)} ${C.fmtValue(obj, C.value(data, key, r, obj))}). ${esc(info.note)}</title></rect>`;
      s += `<text class="value-label" x="${x(v) + 6}" y="${y + 18}">${C.pct(v)}${r === best ? ' · best feasible' : ''}</text>`;
    });
    s += `<text class="axis-label" x="${L + (W - L - R) / 2}" y="${H - 1}" text-anchor="middle">Share of the perfect-information improvement achieved (derived)</text></svg>`;
    $('rules-chart').innerHTML = s;
    $('rules-pill').textContent = C.OBJECTIVES[obj].label;
    const bench = C.RULE_INFO[C.OBJECTIVES[obj].benchmark].label.replace('Benchmark: ', '');
    $('rules-caption').textContent = `100% = the improvement the perfect-information benchmark "${bench}" achieves for this objective with the same budget. ` +
      `Hatched teal rules are fitted on the same survey they are judged on, so treat them as upper bounds. Grey benchmarks are infeasible for a government.`;
  }

  function renderTable(key) {
    const best = C.bestImplementable(data, key, obj);
    const rows = ['R0_none', ...RULE_ORDER].map(r => {
      const info = C.RULE_INFO[r], cls = info.cls === 'benchmark' ? 'bench' : r === best ? 'best' : '';
      const tag = info.cls === 'survey-ideal' ? '<span class="tag">survey-ideal</span>' : info.cls === 'benchmark' ? '<span class="tag">infeasible</span>' : '';
      const share = r === 'R0_none' ? '–' : C.pct(C.shareAttainable(data, key, r, obj));
      return `<tr class="${cls}"><td>${esc(info.label)}${tag}<small>${esc(info.note)}</small></td>` +
        ['P1', 'P2', 'loss_comp'].map(o => `<td>${C.fmtValue(o, C.value(data, key, r, o))}</td>`).join('') + `<td>${share}</td></tr>`;
    }).join('');
    $('rules-table').innerHTML = `<caption class="sr-only">Outcomes by compensation rule for the selected scenario</caption>` +
      `<thead><tr><th scope="col">Rule</th><th scope="col">Poverty gap</th><th scope="col">Squared gap</th><th scope="col">Losses compensated</th><th scope="col">Share (${esc(C.OBJECTIVES[obj].label.toLowerCase())})</th></tr></thead><tbody>${rows}</tbody>`;
  }

  // ---------- uncertainty ----------
  function renderUncertainty(key) {
    const boot = data.boot[key];
    if (!boot) {
      $('unc-pill').textContent = 'Not available'; $('unc-pill').className = 'pill warn';
      $('unc-chart').innerHTML = `<p class="caption">The survey bootstrap was run for three scenarios only: central, no farm-gate gain and full farm-gate pass-through (budget 50% of losses, retail +25%). Use the buttons at the top. For this scenario the page shows validated point estimates only. Across all 972 scenarios, the best feasible rule is always one of the two PMT rules.</p>`;
      $('unc-caption').textContent = '';
      return;
    }
    $('unc-pill').textContent = `${data.meta.replicates} replicates · ${C.OBJECTIVES[obj].label}`; $('unc-pill').className = 'pill';
    const rules = ['R1_universal', 'R2_geographic', 'R4_exposure', 'R5_pmt_exposure', 'B1_perfect_gap', 'B3_perfect_loss_initpoor'];
    const vals = rules.map(r => boot.diff_vs_R3[r][obj]);
    const raw = Math.max(...vals.map(v => Math.max(Math.abs(v[2]), Math.abs(v[3])))) * 1.08;
    const unit = obj === 'loss_comp' ? 0.1 : 0.1, lim = Math.max(unit, Math.ceil(raw / unit) * unit);   // clean symmetric axis
    const W = 640, row = 30, T = 14, L = 230, R = 24, H = T + rules.length * row + 34;
    const x = v => L + (v + lim) / (2 * lim) * (W - L - R);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Paired differences from the PMT rule with 95% bootstrap intervals">`;
    [-lim, -lim / 2, 0, lim / 2, lim].forEach(t => {
      s += `<line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="${T - 4}" y2="${H - 30}"${t === 0 ? ' stroke="#52666a"' : ''}/><text class="tick" x="${x(t)}" y="${H - 15}" text-anchor="middle">${C.fmtDiff(obj, Math.abs(t) < 1e-12 ? 0 : t)}</text>`;
    });
    rules.forEach((r, i) => {
      const y = T + i * row + 12, v = vals[i], info = C.RULE_INFO[r], col = info.cls === 'benchmark' ? 'var(--s-bench)' : 'var(--s-impl)';
      s += `<text class="value-label" x="${L - 10}" y="${y + 4}" text-anchor="end"${info.cls === 'benchmark' ? ' font-style="italic"' : ''}>${esc(info.label)}</text>`;
      s += `<line x1="${x(v[2])}" x2="${x(v[3])}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="2"/>`;
      s += `<circle cx="${x(v[0])}" cy="${y}" r="5" fill="${col}" stroke="#fff" stroke-width="2"><title>${esc(info.label)} minus PMT: ${C.fmtDiff(obj, v[0])} (95% interval ${C.fmtDiff(obj, v[2])} to ${C.fmtDiff(obj, v[3])})</title></circle>`;
    });
    s += `<text class="axis-label" x="${L + (W - L - R) / 2}" y="${H - 1}" text-anchor="middle">Rule minus PMT (${C.OBJECTIVES[obj].better} is better)</text></svg>`;
    $('unc-chart').innerHTML = s;
    const pb = boot.prob_best[obj] || {};
    $('unc-caption').textContent = `Paired differences within each replicate; the government's targeting models are re-fitted in every replicate. ` +
      `Probability of being the best feasible rule: PMT + exposure ${C.pct(pb.R5_pmt_exposure || 0)}, PMT ${C.pct(pb.R3_pmt || 0)}, all others 0%. ` +
      `The level of the poverty gap is far less certain (SE ≈ ${boot.level.R3_pmt.P1[1].toFixed(2)}) than the differences between rules.`;
  }

  // ---------- distribution (central scenario) ----------
  function renderDeciles() {
    const loss = data.deciles.R0_none, tr = data.deciles[decRule];
    const lo = Math.min(-5, ...loss.map(d => d.dy_over_c0)), hi = Math.max(1, ...tr.map(d => d.transfer_over_c0)) * 1.12;
    const W = 640, H = 270, L = 46, R = 12, T = 14, B = 40, pw = W - L - R, ph = H - T - B;
    const y = v => T + (hi - v) / (hi - lo) * ph, bw = pw / 10;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Welfare change and transfer as per cent of consumption by decile, central scenario">`;
    const step = hi > 20 ? 10 : hi > 8 ? 4 : 2;
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) s += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}%</text>`;
    s += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#52666a"/>`;
    loss.forEach((d, i) => {
      const x0 = L + i * bw + 6, w = (bw - 14) / 2, t = tr[i];
      s += `<rect x="${x0}" y="${y(0)}" width="${w}" height="${Math.max(0.8, y(d.dy_over_c0) - y(0))}" rx="2" fill="var(--s-loss)"><title>Decile ${d.dec}: shock ${d.dy_over_c0.toFixed(2)}% of consumption; net buyers ${C.pct(d.share_net_buyer)}</title></rect>`;
      s += `<rect x="${x0 + w + 2}" y="${y(t.transfer_over_c0)}" width="${w}" height="${Math.max(0.8, y(0) - y(t.transfer_over_c0))}" rx="2" fill="var(--s-transfer)"><title>Decile ${d.dec}: transfer ${t.transfer_over_c0.toFixed(2)}% of consumption; ${C.pct(t.budget_share, 1)} of the budget</title></rect>`;
      s += `<text class="tick" x="${x0 + w}" y="${H - B + 16}" text-anchor="middle">${d.dec}</text>`;
    });
    s += `<text class="axis-label" x="${L + pw / 2}" y="${H - 4}" text-anchor="middle">Pre-shock consumption decile (1 = poorest)</text></svg>`;
    $('dec-chart').innerHTML = s;
  }
  function renderMarket() {
    const m = data.market, rows = [['buyer only', 'Bought, sold none'], ['seller only', 'Sold, bought none'], ['both', 'Bought and sold'], ['neither', 'Neither (in window)']];
    $('market').innerHTML = rows.map(([k, l]) => `<div class="market-row"><span>${l}</span><div class="market-bar" role="img" aria-label="${l}: ${C.pct(m[k], 1)}"><i style="width:${(m[k] * 100).toFixed(1)}%"></i></div><b>${C.pct(m[k], 1)}</b></div>`).join('') +
      `<table><caption class="sr-only">Net buyers and sellers by decile</caption><thead><tr><th>Decile</th><th>Net buyers</th><th>Sellers</th><th>Shock, % of consumption</th></tr></thead><tbody>` +
      data.deciles.R0_none.filter(d => [1, 5, 10].includes(d.dec)).map(d => `<tr><td>${d.dec === 1 ? '1 (poorest)' : d.dec === 10 ? '10 (richest)' : d.dec}</td><td>${C.pct(d.share_net_buyer)}</td><td>${C.pct(d.share_seller)}</td><td>${d.dy_over_c0.toFixed(2)}%</td></tr>`).join('') + `</tbody></table>`;
  }

  // ---------- geography (central scenario) ----------
  function renderGeo() {
    const vd = data.vardec;
    const pick = (o, p) => vd.find(v => v.outcome === o && v.partition === p).R2;
    $('vardec').innerHTML = [['dy / c0 (%)', 'Losses (% of consumption)'], ['post-shock poverty gap (person)', 'Post-shock poverty gap'], ['change in poverty gap (person)', 'Shock-induced change in poverty gap']]
      .map(([o, l]) => `<div><span>${l}</span><strong>${C.pct(pick(o, 'district (32)'))}</strong><small>of household variation lies between districts (${C.pct(pick(o, 'district x urban/rural'))} with an urban/rural split). The rest is within districts, beyond the reach of a district formula.</small></div>`).join('');
    const ds = [...data.districts].sort((a, b) => b.P1_post - a.P1_post);
    const W = 640, row = 17, T = 10, L = 132, R = 16, H = T + ds.length * row + 34;
    const max = Math.ceil(Math.max(...ds.map(d => d.P1_post + 1.96 * d.P1_post_se)) / 5) * 5;
    const x = v => L + v / max * (W - L - R);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Post-shock poverty gap by district with 95% intervals, central scenario">`;
    for (let t = 0; t <= max; t += 5) s += `<line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="${T - 4}" y2="${H - 30}"/><text class="tick" x="${x(t)}" y="${H - 15}" text-anchor="middle">${t}</text>`;
    ds.forEach((d, i) => {
      const y = T + i * row + 8, lo = d.P1_post - 1.96 * d.P1_post_se, hi = d.P1_post + 1.96 * d.P1_post_se;
      s += `<text class="tick" x="${L - 8}" y="${y + 4}" text-anchor="end">${esc(d.name)}</text>`;
      s += `<line x1="${x(Math.max(0, lo))}" x2="${x(hi)}" y1="${y}" y2="${y}" stroke="var(--s-impl)" stroke-width="2" opacity=".55"/>`;
      s += `<circle cx="${x(d.P1_post)}" cy="${y}" r="4" fill="var(--s-impl)" stroke="#fff" stroke-width="1.5"><title>${esc(d.name)}: ${d.P1_post.toFixed(1)} (95% interval ${Math.max(0, lo).toFixed(1)}–${hi.toFixed(1)}); P(top 8) ${C.pct(d.prob_top8)}</title></circle>`;
    });
    s += `<text class="axis-label" x="${L + (W - L - R) / 2}" y="${H - 1}" text-anchor="middle">Post-shock poverty gap ×100, no compensation</text></svg>`;
    $('geo-chart').innerHTML = s;
    renderGeoTable();
  }
  function renderGeoTable() {
    const ds = [...data.districts].sort((a, b) => geoSort === 'rel' ? a.rel - b.rel : b[geoSort] - a[geoSort]);
    $('geo-table').innerHTML = `<caption class="sr-only">District diagnostics, central scenario</caption><thead><tr><th scope="col">District</th><th scope="col">Post-shock gap</th><th scope="col">Loss, % cons.</th><th scope="col">Net buyers</th><th scope="col">P(top 8)</th><th scope="col">Rank, 90% range</th></tr></thead><tbody>` +
      ds.map(d => `<tr><td>${esc(d.name)}<small>${d.n_ea} enumeration areas</small></td><td>${d.P1_post.toFixed(1)}<small>± ${(1.96 * d.P1_post_se).toFixed(1)}</small></td><td>${d.rel.toFixed(2)}%<small>± ${(1.96 * d.rel_se).toFixed(2)}</small></td><td>${C.pct(d.net_buyer)}</td><td>${C.pct(d.prob_top8)}</td><td>${Math.round(d.rank_lo)}–${Math.round(d.rank_hi)}</td></tr>`).join('') + `</tbody>`;
  }

  function render() {
    const key = C.scenarioKey(sel);
    if (!C.isValidated(data, sel)) return;   // defensive: never render an unvalidated scenario
    syncControls(); renderHeadline(key); renderRules(key); renderTable(key); renderUncertainty(key); writeHash();
  }

  fetch('data.json').then(r => { if (!r.ok) throw new Error('data.json not found'); return r.json(); }).then(d => {
    data = d; readHash(); buildControls(); render(); renderDeciles(); renderMarket(); renderGeo();
  }).catch(err => {
    $('status').innerHTML = `<span class="badge warn"><strong>Could not load results</strong> · ${esc(err.message)}</span>`;
  });
})();
