'use strict';
// Econometric Analysis page. The form is the source of truth; it is serialised into a plan of whitelisted operations
// (shown under "Inspect the plan") and sent to the local research server, which validates and runs it.
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fmt = (x, d = 3) => x == null ? '—' : Math.abs(x) >= 1e5 ? x.toExponential(3) : (+x).toFixed(d);
  const S = {meta: null, countries: [], vars: [], question: '', lastRun: null};
  const ENV = Object.assign({connected: 'Connected to the local research server',
    noServer: '<strong>The research engine is not running.</strong> Open the page from the research tools menu.'}, window.PDS_ENV || {});   // the browser build overrides these labels
  const api = async (path, body) => {
    const r = await fetch('/api/research/' + path, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {});
    const j = await r.json().catch(() => ({error: 'bad response'}));
    if (!r.ok) { const e = new Error((j.issues || []).map(i => i.message).join(' ') || j.error); e.issues = j.issues || []; e.kind = j.error; throw e; }
    return j;
  };
  const issuesHtml = (title, e) => `<div class="card rdecl"><h3>${esc(title)}</h3><ul class="issues">${(e.issues && e.issues.length ? e.issues.map(i => i.message) : [e.message]).map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
  const cname = iso => (S.meta.countries.find(c => c.iso3 === iso) || {}).name || iso;

  // ---------------------------------------------------------------------------------------------- setup
  async function init() {
    try { S.meta = await api('meta'); }
    catch (e) {
      $('server').className = 'note warn small';
      $('server').innerHTML = ENV.noServer;
      document.querySelectorAll('#s1 button, #s2 button, #s3 button').forEach(b => b.disabled = true);
      return;
    }
    $('server').innerHTML = `${ENV.connected} · ${S.meta.countries.length} economies · read-only warehouse · models need at least ${S.meta.thresholds.min_n} observations; clustered errors are not computed below ${S.meta.thresholds.min_clusters} clusters (a floor, not a guarantee of reliable inference).`;
    $('clist').innerHTML = S.meta.countries.map(c => `<option value="${esc(c.name)}">`).join('');
    $('group').innerHTML += '<optgroup label="Regions">' + S.meta.regions.map(r => `<option value="region:${esc(r)}">${esc(r)}</option>`).join('') + '</optgroup>'
      + '<optgroup label="Income groups">' + S.meta.income_groups.map(r => `<option value="income_group:${esc(r)}">${esc(r)}</option>`).join('') + '</optgroup><option value="all">All economies</option>';
    $('unavail').innerHTML = Object.values(S.meta.methods).filter(m => m.status !== 'available').map(m => `<li><strong>${esc(m.label)}</strong> — ${esc(m.reason)}</li>`).join('');
    bind(); render();
    if (location.hash === '#handoff') {   // plan handed over from the AI Research Assistant (editable here)
      try { const p = JSON.parse(localStorage.getItem('pds_handoff_plan') || 'null'); if (p) { applyPlan(p); $('draftout').innerHTML = '<div class="rwarn">Plan opened from the AI Research Assistant. Every field can be edited; nothing has been run.</div>'; } } catch {}
    }
  }

  function bind() {
    for (const b of document.querySelectorAll('[data-q]')) b.onclick = () => { $('question').value = b.dataset.q; draft(); };
    $('draft').onclick = draft;
    $('csearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCountryByName($('csearch').value); } });
    $('csearch').addEventListener('change', () => addCountryByName($('csearch').value));
    $('group').onchange = () => {
      const v = $('group').value; if (!v) return;
      const add = v === 'all' ? S.meta.countries : S.meta.countries.filter(c => c[v.split(':')[0]] === v.slice(v.indexOf(':') + 1));
      S.countries = [...new Set([...S.countries, ...add.map(c => c.iso3)])]; $('group').value = ''; render();
    };
    $('clear').onclick = () => { S.countries = []; render(); };
    $('isbtn').onclick = searchInd; $('isearch').addEventListener('keydown', e => { if (e.key === 'Enter') searchInd(); });
    $('preview').onclick = preview; $('run').onclick = run;
    for (const id of ['y0', 'y1', 'a_desc', 'a_corr', 'm_y', 'm_ent', 'm_time', 'm_se']) $(id).addEventListener('change', render);
    $('m_method').addEventListener('change', () => { S.seTouched = false; render(); });
  }

  function addCountryByName(v) {
    const c = S.meta.countries.find(c => c.name.toLowerCase() === v.trim().toLowerCase() || c.iso3 === v.trim().toUpperCase());
    if (c && !S.countries.includes(c.iso3)) S.countries.push(c.iso3);
    $('csearch').value = ''; render();
  }

  async function searchInd() {
    const q = $('isearch').value.trim(); if (!q) return;
    $('iresults').innerHTML = '<p class="small muted">Searching…</p>';
    try {
      const r = await api('indicators?q=' + encodeURIComponent(q));
      $('iresults').innerHTML = r.results.length ? r.results.map((i, k) => `<div class="ires"><div><strong>${esc(i.title)}</strong> <span class="mono">${esc(i.indicator_id)}</span><div class="meta">${esc(i.unit || '')} · ${i.n_countries} economies · ${i.year_min}–${i.year_max} · ${esc(i.source_id)}</div></div><button class="btn sm" data-k="${k}">Add</button></div>`).join('') : '<p class="small muted">No indicator matches.</p>';
      $('iresults').querySelectorAll('[data-k]').forEach(b => b.onclick = () => { addVar(r.results[+b.dataset.k]); });
    } catch (e) { $('iresults').innerHTML = issuesHtml('Search failed', e); }
  }

  function defaultName(id) { let n = id.split(':').pop().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); return (/^[a-z]/.test(n) ? n : 'v_' + n).slice(0, 40); }
  function addVar(i, opts = {}) {
    if (S.vars.length >= S.meta.limits.variables) return alert('At most ' + S.meta.limits.variables + ' indicators.');
    let name = opts.name || defaultName(i.indicator_id); while (S.vars.some(v => v.name === name)) name = (name + '_2').slice(0, 40);
    S.vars.push({indicator_id: i.indicator_id, title: i.title || i.indicator_id, unit: i.unit || '', name, transform: opts.transform || 'none', breakdown: opts.breakdown || '', options: null});
    render();
  }

  // ---------------------------------------------------------------------------------------------- form <-> plan
  function render() {
    $('ccount').textContent = S.countries.length ? `(${S.countries.length} selected)` : '';
    $('chips').innerHTML = S.countries.map(c => `<span class="rchip">${esc(cname(c))}<button aria-label="Remove ${esc(cname(c))}" data-c="${c}">×</button></span>`).join('');
    $('chips').querySelectorAll('[data-c]').forEach(b => b.onclick = () => { S.countries = S.countries.filter(x => x !== b.dataset.c); render(); });
    const tb = $('vars').querySelector('tbody');
    tb.innerHTML = S.vars.length ? S.vars.map((v, k) => `<tr>
      <td><input aria-label="Variable name" data-k="${k}" data-f="name" value="${esc(v.name)}" maxlength="40"></td>
      <td>${esc(v.title)}<div class="mono muted">${esc(v.indicator_id)}${v.unit ? ' · ' + esc(v.unit) : ''}</div></td>
      <td><select aria-label="Transformation" data-k="${k}" data-f="transform">${Object.entries(S.meta.transforms).map(([t, d]) => `<option value="${t}" ${t === v.transform ? 'selected' : ''} title="${esc(d)}">${t}</option>`).join('')}</select></td>
      <td>${v.options ? `<select aria-label="Breakdown" data-k="${k}" data-f="breakdown"><option value="">choose…</option>${v.options.map(o => `<option ${o === v.breakdown ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input aria-label="Breakdown" data-k="${k}" data-f="breakdown" value="${esc(v.breakdown)}" placeholder="auto">`}</td>
      <td><button class="btn sm ghost" data-rm="${k}" aria-label="Remove">×</button></td></tr>`).join('') : '<tr><td colspan="5" class="muted small">No indicators yet — search above or draft a plan from a question.</td></tr>';
    tb.querySelectorAll('[data-f]').forEach(el => el.onchange = () => { S.vars[+el.dataset.k][el.dataset.f] = el.value.trim(); render(); });
    tb.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S.vars.splice(+b.dataset.rm, 1); render(); });
    const names = S.vars.map(v => v.name);
    const keepChecked = (box, list) => { const prev = new Set([...box.querySelectorAll('input:checked')].map(i => i.value)); box.innerHTML = list.map(n => `<label class="rchk"><input type="checkbox" value="${esc(n)}" ${prev.has(n) || (box.dataset.pre || '').split(',').includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('') || '<span class="small muted">Add indicators first.</span>'; box.dataset.pre = ''; box.querySelectorAll('input').forEach(i => i.onchange = render); };
    keepChecked($('a_trends'), names);
    const m = $('m_method').value;
    $('mopts').hidden = !m; $('feopts').hidden = m !== 'panel_fe';
    const yPrev = $('m_y').value || $('m_y').dataset.pre;
    $('m_y').innerHTML = names.map(n => `<option ${n === yPrev ? 'selected' : ''}>${esc(n)}</option>`).join(''); $('m_y').dataset.pre = '';
    keepChecked($('m_x'), names.filter(n => n !== $('m_y').value));
    const seOpts = m === 'ols' ? [['hc1', 'Robust (HC1)'], ['cluster', 'Clustered by country'], ['classical', 'Classical']] : [['cluster', 'Clustered by country'], ['hc1', 'Robust (HC1), not clustered']];
    const sePrev = S.seTouched ? $('m_se').value : ($('m_se').dataset.pre || (m === 'ols' ? 'hc1' : 'cluster'));
    $('m_se').innerHTML = seOpts.map(([v, l]) => `<option value="${v}" ${v === sePrev ? 'selected' : ''}>${l}</option>`).join('');
    $('m_se').onchange = () => { S.seTouched = true; render(); };
    $('plan').textContent = JSON.stringify(buildPlan(), null, 1);
  }

  function spec() {
    return {countries: S.countries, years: [parseInt($('y0').value), parseInt($('y1').value)], level: 'ADM0',
            variables: S.vars.map(v => ({indicator_id: v.indicator_id, name: v.name, transform: v.transform, ...(v.breakdown ? {breakdown: v.breakdown} : {})}))};
  }
  function buildPlan() {
    const names = S.vars.map(v => v.name), steps = [{op: 'retrieve', params: spec()}, {op: 'build_panel', params: {}}];
    if ($('a_desc').checked && names.length) steps.push({op: 'describe', params: {variables: names}});
    for (const i of $('a_trends').querySelectorAll('input:checked')) steps.push({op: 'compare_trends', params: {variable: i.value}});
    if ($('a_corr').checked && names.length > 1) steps.push({op: 'correlate', params: {variables: names}});
    const m = $('m_method').value;
    if (m) {
      const y = $('m_y').value, x = [...$('m_x').querySelectorAll('input:checked')].map(i => i.value);
      steps.push({op: 'panel_diagnostics', params: {variables: [y, ...x]}});
      steps.push({op: 'estimate', params: {method: m, y, x, se: $('m_se').value, ...(m === 'panel_fe' ? {entity_effects: $('m_ent').checked, time_effects: $('m_time').checked} : {})}});
    }
    return {version: 1, question: S.question, steps};
  }

  // Fill the form from a drafted plan (every field stays editable).
  function applyPlan(p) {
    const r = p.steps[0].params;
    S.countries = r.countries || []; S.question = p.question;
    if (r.years) { $('y0').value = r.years[0]; $('y1').value = r.years[1]; } else { $('y0').value = ''; $('y1').value = ''; }
    S.vars = []; for (const v of r.variables || []) addVar({indicator_id: v.indicator_id, title: v.title}, v);
    S.vars.forEach(v => api('indicator?id=' + encodeURIComponent(v.indicator_id)).then(j => { if (j.indicator) { v.title = j.indicator.title; v.unit = j.indicator.unit; render(); } }).catch(() => {}));
    $('a_desc').checked = p.steps.some(s => s.op === 'describe'); $('a_corr').checked = p.steps.some(s => s.op === 'correlate');
    $('a_trends').dataset.pre = p.steps.filter(s => s.op === 'compare_trends').map(s => s.params.variable).join(',');
    $('a_trends').innerHTML = '';
    const est = p.steps.find(s => s.op === 'estimate');
    const avail = est && ['ols', 'panel_fe'].includes(est.params.method);
    $('m_method').value = avail ? est.params.method : '';
    if (est) { $('m_y').dataset.pre = est.params.y || ''; $('m_y').value = ''; $('m_x').dataset.pre = (est.params.x || []).join(','); $('m_x').innerHTML = '';
               $('m_ent').checked = est.params.entity_effects !== false; $('m_time').checked = !!est.params.time_effects; $('m_se').dataset.pre = est.params.se || ''; S.seTouched = false; }
    S.unavailableRequest = est && !avail && est.params.method ? est.params.method : null;
    render();
  }

  async function draft() {
    const q = $('question').value.trim(); if (!q) return;
    $('draftout').innerHTML = '<p class="small muted">Drafting…</p>';
    try {
      const p = await api('draft', {question: q});
      applyPlan(p);
      const un = S.unavailableRequest ? S.meta.methods[S.unavailableRequest] : null;
      $('draftout').innerHTML = `<div class="rwarn"><strong>Draft plan filled in below — check it.</strong> ${esc(p.parser)}<ul>${p.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        ${p.unresolved.length ? `<strong>Still needed:</strong><ul>${p.unresolved.map(u => `<li>${esc(u.message)}</li>`).join('')}</ul>` : ''}
        ${un ? `<strong>Requested method not available:</strong> ${esc(un.label)} — ${esc(un.reason)} No model was selected.` : ''}</div>`;
    } catch (e) { $('draftout').innerHTML = issuesHtml('Could not draft a plan', e); }
  }

  // ---------------------------------------------------------------------------------------------- preview & run
  async function preview() {
    $('previewout').innerHTML = '<p class="small muted">Querying the warehouse…</p>';
    try { const r = await api('preview', {spec: spec()}); $('previewout').innerHTML = reportHtml(r); }
    catch (e) { breakdownOptions(e); $('previewout').innerHTML = issuesHtml('The sample cannot be built', e); }
  }
  function breakdownOptions(e) {
    for (const i of e.issues || []) if (i.code === 'breakdown' && i.variable && i.options) { const v = S.vars.find(v => v.name === i.variable); if (v) v.options = i.options; }
    render();
  }

  async function run() {
    const plan = buildPlan();
    $('runstatus').textContent = 'Running…'; $('run').disabled = true; $('results').innerHTML = '';
    try {
      const out = await api('run', {plan}); S.lastRun = out;
      $('results').innerHTML = resultsHtml(out); wireDownloads(out);
      $('runstatus').textContent = `Done: ${out.steps.filter(s => s.status === 'ok').length} step(s) completed, ${out.steps.filter(s => s.status === 'declined').length} declined.`;
      $('results').scrollIntoView({behavior: 'smooth', block: 'start'});
    } catch (e) { breakdownOptions(e); $('results').innerHTML = issuesHtml('The plan was not run', e); $('runstatus').textContent = 'Not run: see the issues below.'; }
    finally { $('run').disabled = false; }
  }

  // ---------------------------------------------------------------------------------------------- rendering
  function reportHtml(d) {
    const r = d.report, cc = r.complete_cases;
    return `<div class="rcard"><h3>Sample and compatibility</h3>
      <div class="rstats"><span>Units requested <b>${r.units_requested}</b></span><span>Years <b>${r.years[0]}–${r.years[1]}</b></span><span>Rows (unit × year) <b>${d.rows}</b></span>
      <span>Complete cases <b>${cc.rows}</b> (${cc.units} units, ${cc.years} years)</span><span>${cc.balanced ? 'Balanced' : 'Unbalanced'} (${cc.per_unit_min}–${cc.per_unit_max} per unit)</span></div>
      <div class="tablewrap"><table class="rtable"><thead><tr><th>Variable</th><th>Indicator</th><th>Source · licence</th><th>Unit</th><th>Breakdown</th><th>Transformation</th><th class="n">Obs.</th><th class="n">Missing</th></tr></thead><tbody>
      ${r.variables.map(v => `<tr><td><strong>${esc(v.name)}</strong></td><td>${esc(v.title)}<div class="mono muted">${esc(v.indicator_id)}</div></td><td>${esc(v.source_id)} · ${esc(v.licence)}</td><td>${esc(v.unit)}${v.price_basis ? ' (' + esc(v.price_basis) + ')' : ''}</td><td>${esc(v.breakdown || '—')}</td><td>${esc(v.transform_text)}</td><td class="n">${v.n_obs}</td><td class="n">${(r.missingness[v.name].missing_share * 100).toFixed(0)}%</td></tr>`).join('')}
      </tbody></table></div>
      ${r.period ? `<p class="small">Calendar year ${r.period.calendar_year} · latest year with data in this period: ${Object.entries(r.period.latest_year_per_variable).map(([k, v]) => `${esc(k)} ${v ?? '—'}`).join(', ')} · latest year with every variable (any unit): <b>${r.period.latest_common_year ?? '—'}</b> · with every variable for every unit: <b>${r.period.latest_complete_year ?? '—'}</b></p>` : ''}
      ${r.warnings.length ? `<div class="rwarn"><strong>Checks and warnings</strong><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      <p class="small muted">${r.rules.map(esc).join(' ')}</p>
      <p class="small muted">Spec hash <span class="mono">${esc(d.provenance.spec_hash)}</span> · data SHA-256 <span class="mono">${esc(d.provenance.data_sha256.slice(0, 16))}…</span></p></div>`;
  }

  function resultsHtml(out) {
    const parts = [`<section class="card">${reportHtml(out.dataset)}<h3 style="margin-top:12px">Downloads</h3><div class="rdl">${Object.keys(out.downloads).map(f => `<button class="btn sm" data-dl="${esc(f)}">${esc(f)}</button>`).join('')}</div>
      <p class="small muted">dataset.csv is the exact unit × year table used (full precision); reproduce.py recomputes every reported number from it and compares them with results.json (PASS/FAIL per output); methods.md documents data, rules, specifications, sensitivity, assumptions, limitations and software versions.</p></section>`];
    for (const s of out.steps) parts.push(stepHtml(s));
    return parts.join('');
  }

  function stepHtml(s) {
    if (s.status === 'declined') return `<section class="card rcard rdecl"><h3>${esc(label(s))} — not run</h3><ul class="issues">${s.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>${s.suggestions.length ? `<p class="small"><strong>What would make it possible:</strong> ${s.suggestions.map(esc).join(' ')}</p>` : ''}<p class="small muted">No estimates are shown for declined requests.</p></section>`;
    const r = s.result;
    if (s.op === 'describe') return `<section class="card rcard"><h3>Descriptive statistics</h3><div class="tablewrap"><table class="rtable"><thead><tr><th>Variable</th>${['n', 'units', 'mean', 'sd', 'min', 'p25', 'median', 'p75', 'max'].map(h => `<th class="n">${h}</th>`).join('')}</tr></thead><tbody>${r.table.map(t => `<tr><td>${esc(t.variable)}</td><td class="n">${t.n}</td><td class="n">${t.units}</td>${['mean', 'sd', 'min', 'p25', 'median', 'p75', 'max'].map(k => `<td class="n">${fmt(t[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted">${esc(r.note)}</p></section>`;
    if (s.op === 'compare_trends') return `<section class="card rcard"><h3>Trends: ${esc(r.variable)}</h3>${lineChart(r)}<div class="tablewrap"><table class="rtable"><thead><tr><th>Country</th><th class="n">Years</th><th class="n">First</th><th class="n">Last</th><th class="n">Change</th><th class="n">Avg. annual growth</th><th class="n">Mean</th></tr></thead><tbody>${r.units.map(u => `<tr><td>${esc(u.country)}</td><td class="n">${u.first_year}–${u.last_year} (${u.n})</td><td class="n">${fmt(u.first)}</td><td class="n">${fmt(u.last)}</td><td class="n">${fmt(u.change)}</td><td class="n">${u.avg_annual_growth_pct == null ? '—' : fmt(u.avg_annual_growth_pct, 2) + '%'}</td><td class="n">${fmt(u.mean)}</td></tr>`).join('')}</tbody></table></div>${r.units_without_data.length ? `<p class="small">No data: ${r.units_without_data.map(cname).map(esc).join(', ')}.</p>` : ''}<p class="small muted">${esc(r.note)}</p></section>`;
    if (s.op === 'correlate') return `<section class="card rcard"><h3>Correlations</h3><p class="sub">${r.n} complete observations, ${r.units} units</p><div class="tablewrap"><table class="rtable"><thead><tr><th></th>${r.matrix.variables.map(v => `<th class="n">${esc(v)}</th>`).join('')}</tr></thead><tbody>${r.matrix.values.map((row, i) => `<tr><th>${esc(r.matrix.variables[i])}</th>${row.map(x => `<td class="n">${fmt(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted">${esc(r.note)}</p></section>`;
    if (s.op === 'panel_diagnostics') return `<section class="card rcard"><h3>Panel diagnostics</h3><div class="rstats"><span>Units <b>${r.units}</b></span><span>Years <b>${r.years}</b></span><span>Complete observations <b>${r.observations}</b> of ${r.requested_rows}</span><span>Per unit <b>${r.obs_per_unit.min}–${r.obs_per_unit.max}</b></span><span>${r.balanced ? 'Balanced' : 'Unbalanced'}</span><span>Internal gaps <b>${r.internal_gaps}</b></span><span>Singletons <b>${r.singletons}</b></span></div>
      <div class="tablewrap"><table class="rtable"><thead><tr><th>Variable</th><th class="n">Overall SD</th><th class="n">Between SD</th><th class="n">Within SD</th></tr></thead><tbody>${r.variance_decomposition.map(v => `<tr><td>${esc(v.variable)}</td><td class="n">${fmt(v.overall_sd)}</td><td class="n">${fmt(v.between_sd)}</td><td class="n">${fmt(v.within_sd)}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Within SD is the variation left after removing each unit’s mean — the variation fixed-effects models use.</p>
      <details class="small"><summary>Missingness by country</summary><div class="tablewrap"><table class="rtable"><thead><tr><th>Country</th><th class="n">Rows</th>${Object.keys(r.missingness_by_unit[0] || {}).filter(k => !['unit', 'country', 'rows', 'complete'].includes(k)).map(k => `<th class="n">${esc(k)}</th>`).join('')}<th class="n">Complete</th></tr></thead><tbody>${r.missingness_by_unit.map(m => `<tr><td>${esc(m.country)}</td><td class="n">${m.rows}</td>${Object.keys(m).filter(k => !['unit', 'country', 'rows', 'complete'].includes(k)).map(k => `<td class="n">${m[k]}</td>`).join('')}<td class="n">${m.complete}</td></tr>`).join('')}</tbody></table></div></details></section>`;
    if (s.op === 'estimate') {
      const sp = r.spec;
      return `<section class="card rcard"><h3>${r.method === 'ols' ? 'OLS regression' : 'Panel fixed effects'}: ${esc(sp.y)} on ${sp.X.map(esc).join(', ')}</h3>
        <p class="sub">${r.method === 'panel_fe' ? esc(sp.effects) + ' · ' : 'Constant included · '}${esc(sp.cov_type)} · ${esc(r.library)}</p>
        <div class="rstats"><span>N <b>${r.n}</b></span><span>Units <b>${r.units}</b></span><span>Years <b>${r.years}</b></span><span>Residual df <b>${fmt(r.df_resid, 0)}</b></span>${r.method === 'ols' ? `<span>R² <b>${fmt(r.r2)}</b></span><span>Adj. R² <b>${fmt(r.adj_r2)}</b></span>` : `<span title="Share of the variation remaining after removing the fixed effects that the regressors explain">R² after removing fixed effects <b>${fmt(r.r2_fe)}</b></span>`}</div>
        <div class="tablewrap"><table class="rtable"><thead><tr><th>Term</th><th class="n">Coefficient</th><th class="n">Std. error</th><th class="n">t</th><th class="n">p-value</th><th class="n">95% CI</th></tr></thead><tbody>${r.coefficients.map(c => `<tr><td>${esc(c.term)}</td><td class="n">${fmt(c.coef, 4)}</td><td class="n">${fmt(c.se, 4)}</td><td class="n">${fmt(c.t, 2)}</td><td class="n">${fmt(c.p_value, 3)}</td><td class="n">[${fmt(c.ci_low, 4)}, ${fmt(c.ci_high, 4)}]</td></tr>`).join('')}</tbody></table></div>
        ${coefChart(r)}
        <div class="rinterp"><strong>Interpretation.</strong> ${esc(r.interpretation)}</div>
        ${r.sensitivity.flags.length ? `<div class="rwarn rsens"><strong>Sensitive to specification</strong><ul>${r.sensitivity.flags.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        ${r.warnings.length ? `<div class="rwarn"><strong>Limitations of this estimate</strong><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        ${r.sensitivity.rows.length ? `<details class="small"><summary>Sensitivity: the same model under alternative choices</summary><div class="tablewrap"><table class="rtable"><thead><tr><th>Alternative</th><th>Term</th><th class="n">Coefficient</th><th class="n">Std. error</th><th class="n">p-value</th><th class="n">N</th><th>Change</th></tr></thead><tbody>${r.sensitivity.rows.map(x => `<tr><td>${esc(x.alternative)}</td><td>${esc(x.term)}</td><td class="n">${fmt(x.coef, 4)}</td><td class="n">${fmt(x.se, 4)}</td><td class="n">${fmt(x.p_value, 3)}</td><td class="n">${x.n}</td><td>${x.sign_change ? 'sign changes' : x.significance_change ? 'significance changes' : '—'}</td></tr>`).join('')}</tbody></table></div>${r.sensitivity.notes.map(n => `<p>${esc(n)}</p>`).join('')}</details>` : ''}
        <details class="small"><summary>Assumptions behind this model</summary><ul>${r.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>
        ${r.vif && r.vif.length ? `<p class="small">Variance inflation factors${r.method === 'panel_fe' ? ' (after removing the fixed effects)' : ''}: ${r.vif.map(v => `${esc(v.variable)} ${fmt(v.vif, 2)}`).join(' · ')}${r.condition_number ? ` · condition number ${fmt(r.condition_number, 1)}` : ''}</p>` : ''}
        <details class="small"><summary>Residuals against fitted values</summary>${scatter(r.fitted)}</details></section>`;
    }
    return '';
  }
  const label = s => ({estimate: 'Model: ' + (S.meta.methods[s.params.method] || {label: s.params.method}).label, describe: 'Descriptive statistics', correlate: 'Correlations', compare_trends: 'Trends', panel_diagnostics: 'Panel diagnostics'}[s.op] || s.op);

  // ---------------------------------------------------------------------------------------------- charts (SVG)
  const COLORS = ['#0b6e74', '#b4691f', '#3b5ba5', '#a33a3a', '#5f8a2b', '#7a4e9c', '#2c8fb3', '#8a6d1f', '#555f66', '#c0507a', '#2f7d5c', '#6b6bb0'];
  function lineChart(r) {
    const units = r.units.filter(u => u.series.length > 1);
    if (!units.length) return '<p class="small muted">Not enough observations to draw a trend.</p>';
    if (units.length > 12) return `<p class="small muted">${units.length} countries — the chart shows up to 12; see the table.</p>`;
    const W = 760, H = 300, m = {l: 60, r: 14, t: 12, b: 30};
    const xs = units.flatMap(u => u.series.map(p => p[0])), ys = units.flatMap(u => u.series.map(p => p[1]));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys, 0 < Math.min(...ys) ? Math.min(...ys) : Math.min(...ys)), y1 = Math.max(...ys);
    const X = x => m.l + (x - x0) / Math.max(1, x1 - x0) * (W - m.l - m.r), Y = y => H - m.b - (y - y0) / ((y1 - y0) || 1) * (H - m.t - m.b);
    const ticks = 5, yt = [...Array(ticks + 1)].map((_, i) => y0 + (y1 - y0) * i / ticks);
    const xt = [...new Set([...Array(6)].map((_, i) => Math.round(x0 + (x1 - x0) * i / 5)))];
    return `<svg class="rchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend of ${esc(r.variable)} by country">
      ${yt.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="#dfe6ea"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="#5d6f7c">${fmt(t, Math.abs(y1 - y0) < 10 ? 1 : 0)}</text>`).join('')}
      ${xt.map(t => `<text x="${X(t)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#5d6f7c">${t}</text>`).join('')}
      ${y0 < 0 && y1 > 0 ? `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="#16263a" stroke-width=".8"/>` : ''}
      ${units.map((u, i) => segments(u.series).map(seg => `<polyline fill="none" stroke="${COLORS[i]}" stroke-width="2" points="${seg.map(p => X(p[0]) + ',' + Y(p[1])).join(' ')}"/>`).join('')).join('')}
    </svg><div class="rlegend">${units.map((u, i) => `<span><i style="background:${COLORS[i]}"></i>${esc(u.country)}</span>`).join('')}</div><p class="small muted">Lines break where a year is missing; nothing is interpolated.</p>`;
  }
  function segments(series) { const out = []; let cur = []; series.forEach((p, i) => { if (i && p[0] - series[i - 1][0] > 1) { out.push(cur); cur = []; } cur.push(p); }); out.push(cur); return out.filter(s => s.length); }
  function coefChart(r) {
    const cs = r.coefficients.filter(c => c.term !== 'const' && c.ci_low != null);
    if (!cs.length) return '';
    const W = 760, rowH = 30, H = cs.length * rowH + 34, l = 170, rr = 20;
    const lo = Math.min(0, ...cs.map(c => c.ci_low)), hi = Math.max(0, ...cs.map(c => c.ci_high));
    const X = x => l + (x - lo) / ((hi - lo) || 1) * (W - l - rr);
    return `<svg class="rchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Coefficients with 95% confidence intervals">
      <line x1="${X(0)}" x2="${X(0)}" y1="6" y2="${H - 22}" stroke="#16263a" stroke-dasharray="3 3"/>
      ${cs.map((c, i) => { const y = 18 + i * rowH; return `<text x="${l - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#16263a">${esc(c.term)}</text><line x1="${X(c.ci_low)}" x2="${X(c.ci_high)}" y1="${y}" y2="${y}" stroke="#0b6e74" stroke-width="2.5"/><circle cx="${X(c.coef)}" cy="${y}" r="4.5" fill="#0b6e74"/>`; }).join('')}
      <text x="${l}" y="${H - 6}" font-size="11" fill="#5d6f7c">${fmt(lo, 4)}</text><text x="${W - rr}" y="${H - 6}" text-anchor="end" font-size="11" fill="#5d6f7c">${fmt(hi, 4)}</text>
    </svg><p class="small muted">Points are coefficients; bars are 95% confidence intervals; the dashed line is zero. Coefficients are in the units of each variable and are not comparable across variables.</p>`;
  }
  function scatter(pts) {
    if (!pts || !pts.length) return '';
    const W = 760, H = 260, m = 40, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = x => m + (x - x0) / ((x1 - x0) || 1) * (W - 2 * m), Y = y => H - m - (y - y0) / ((y1 - y0) || 1) * (H - 2 * m);
    return `<svg class="rchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Residuals against fitted values"><line x1="${m}" x2="${W - m}" y1="${Y(0)}" y2="${Y(0)}" stroke="#16263a" stroke-dasharray="3 3"/>${pts.map(p => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.2" fill="#0b6e74" fill-opacity=".55"/>`).join('')}<text x="${W / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#5d6f7c">fitted values</text><text x="12" y="${H / 2}" font-size="11" fill="#5d6f7c" transform="rotate(-90 12 ${H / 2})">residuals</text></svg>`;
  }

  function wireDownloads(out, root = $('results')) {
    root.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => {
      const f = b.dataset.dl, type = f.endsWith('.csv') ? 'text/csv' : f.endsWith('.json') ? 'application/json' : f.endsWith('.py') ? 'text/x-python' : 'text/markdown';
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.downloads[f]], {type})); a.download = f; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  window.__pdsResearch = {state: S, buildPlan, run, draft, preview};   // used by automated browser tests
  // Shared result renderers (used by the AI Research Assistant page); the workbench initialises only on its own page.
  window.PDSRender = {setMeta: m => { S.meta = m; }, resultsHtml, stepHtml, reportHtml, wireDownloads, esc, fmt};
  if (document.getElementById('s1')) init();
})();
