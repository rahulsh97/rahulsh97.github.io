'use strict';
// AI Research Assistant page. The server holds the conversation; this page shows each proposed plan (editable),
// asks for approval, renders results with the workbench's renderers, and shows the checked interpretation.
(() => {
  const $ = id => document.getElementById(id);
  const R = window.PDSRender, esc = R.esc, fmt = R.fmt;
  const ENV = Object.assign({workbench: 'research-web.html', where: 'running on this computer, no data leaves it',
    noServer: '<strong>The research engine is not running.</strong> Open the page from the research tools menu.'}, window.PDS_ENV || {});   // the browser build overrides these labels
  const S = {session: null, view: null, meta: null, runs: 0, busy: false};
  const api = async (path, body) => {
    const r = await fetch('/api/' + path, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {});
    const j = await r.json().catch(() => ({error: 'bad response'}));
    if (!r.ok) { const e = new Error((j.issues || []).map(i => i.message).join(' ') || j.error); e.issues = j.issues || []; e.status = r.status; throw e; }
    return j;
  };
  const card = (html, cls = '') => { const s = document.createElement('section'); s.className = 'card ' + cls; s.innerHTML = html; $('thread').appendChild(s); return s; };
  const busy = (msg) => { S.busy = !!msg; $('busy').textContent = msg || ''; $('send').disabled = !!msg || S.ai === false; };
  const errorCard = (title, e) => card(`<h3>${esc(title)}</h3><ul class="issues">${(e.issues && e.issues.length ? e.issues.map(i => i.message) : [e.message]).map(m => `<li>${esc(m)}</li>`).join('')}</ul>${e.status === 503 ? '<p class="small">You can still analyse the data manually in the <a href="research-web.html">Econometric Analysis workbench</a>.</p>' : ''}`, 'rdecl');

  async function init() {
    try { S.meta = await api('research/meta'); R.setMeta(S.meta); }
    catch (e) { $('aistatus').className = 'note warn small'; $('aistatus').innerHTML = ENV.noServer; $('send').disabled = true; return; }
    for (const b of document.querySelectorAll('[data-q]')) b.onclick = () => { $('q').value = b.dataset.q; };
    for (const b of document.querySelectorAll('[data-f]')) b.onclick = () => { $('q').value = b.dataset.f; };
    $('send').onclick = send; $('reset').onclick = reset;
    $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
    pollStatus();
  }
  async function pollStatus() {
    const s = await api('assistant/status').catch(() => ({available: false, reason: 'Status unavailable.'}));
    const box = $('aistatus');
    if (s.available) { box.className = 'note ok small'; box.innerHTML = `${esc(s.model.ready_label || 'Local model ready')}: <strong>${esc(s.model.name)}</strong> (${esc(s.model.licence)}), ${esc(s.model.runtime)} — ${esc(s.model.where || '') || ENV.where}.`; S.ai = true; }
    else { box.className = 'note warn small'; box.innerHTML = `<strong>AI unavailable:</strong> ${esc(s.reason || 'The local model is not running.')} ${s.loading ? '' : `Manual analysis remains available in the <a href="${ENV.workbench}">Econometric Analysis workbench</a>.`}`; S.ai = false; if (s.loading) setTimeout(pollStatus, 3000); }
    $('send').disabled = !S.ai; $('send').title = S.ai ? '' : 'The local model is not available';
    return s;
  }
  function reset() { S.session = null; S.view = null; $('thread').innerHTML = ''; $('qlabel').textContent = 'Your research question'; $('send').textContent = 'Propose a plan'; $('reset').hidden = true; document.querySelector('[data-f]').hidden = true; $('q').value = ''; }

  async function send() {
    const text = $('q').value.trim(); if (!text || S.busy) return;
    card(`<div class="turn-q"><span class="who">${S.session ? 'Follow-up' : 'Question'}</span>${esc(text)}</div>`, 'plain');
    busy(S.session ? 'Revising the plan with the local model…' : 'The local model is reading the question and searching the catalogue (about 30 seconds)…');
    try {
      const v = S.session ? await api('assistant/revise', {session: S.session, followup: text}) : await api('assistant/plan', {question: text});
      S.session = v.session; S.view = v; $('q').value = '';
      $('qlabel').textContent = 'Follow-up (revises the plan above; e.g. “now include year fixed effects”)'; $('send').textContent = 'Revise the plan'; $('reset').hidden = false; document.querySelector('[data-f]').hidden = false;
      planCard(v);
    } catch (e) { errorCard('The plan could not be prepared', e); if (e.status === 503) pollStatus(); }
    finally { busy(''); }
  }

  // ---------------------------------------------------------------------------------------------- plan card
  function planCard(v) {
    const d = v.draft, st = v.plan.steps, est = st.find(s => s.op === 'estimate'), r = v.report;
    const names = st[0].params.variables.map(x => x.name);
    const cname = iso => (S.meta.countries.find(c => c.iso3 === iso) || {}).name || iso;
    const blocking = v.clarifications.filter(c => !c.optional), optional = v.clarifications.filter(c => c.optional);
    const statusBadge = g => ({resolved: '<span class="badge ok">matched</span>', chosen: '<span class="badge ok">chosen by you</span>', needs_confirmation: '<span class="badge warn">confirm</span>', ambiguous: '<span class="badge warn">ambiguous</span>', not_found: '<span class="badge bad">not in catalogue</span>'}[g.status] || '');
    const indRows = d.variables.map((g, k) => {
      const opts = [...new Map([...(g.candidates || [])].map(c => [c.indicator_id, c])).values()];
      const sel = opts.length ? `<select data-phrase="${esc(g.phrase)}" aria-label="Series for ${esc(g.phrase)}"><option value="">choose…</option>${opts.map(c => `<option value="${esc(c.indicator_id)}" ${c.indicator_id === g.indicator_id ? 'selected' : ''}>${esc(c.title)} — ${esc(c.indicator_id)}${c.countries_with_data != null ? ` (${c.countries_with_data}/${d.countries.length} countries)` : ''}</option>`).join('')}</select>` : '<span class="muted">no catalogue match</span>';
      const cov = g.indicator_id && v.coverage && v.coverage[g.indicator_id] ? d.countries.map(c => { const x = v.coverage[g.indicator_id][c]; return `${esc(cname(c))}: ${x ? `${x.n_obs} yrs (${x.first_year}–${x.last_year})` : 'none'}`; }).join(' · ') : '';
      return `<tr><td>“${esc(g.phrase)}”${statusBadge(g)}<div class="small muted">${esc(g.role)}${g.name ? ` → <span class="mono">${esc(g.name)}</span>` : ''}${g.transform === 'log' ? ' (log)' : ''}</div></td><td>${sel}<div class="small muted">${esc(g.reason || '')}</div>${g.alternatives && g.alternatives.length ? `<div class="small">Other interpretations: ${g.alternatives.map(a => `<span class="mono">${esc(a)}</span>`).join(', ')}</div>` : ''}</td><td class="small cov">${cov}</td></tr>`;
    }).join('');
    const a = d.analyses, m = d.model || {};
    const html = `
      <h3>Proposed plan ${v.revision ? '<span class="badge">revised</span>' : ''} <span class="badge ${v.ready ? 'ok' : 'warn'}">${v.ready ? 'ready for approval' : 'needs your input'}</span></h3>
      ${v.revision ? `<div class="rinterp"><strong>Specification change</strong> (interpreted by ${esc(v.revision.interpreted_by)}): ${v.revision.log.map(esc).join(' ')} <br>${esc(v.revision.sample_note)}</div>` : ''}
      ${v.notes.length ? `<ul class="small">${v.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <ol class="wf">
        <li class="${d.variables.length && d.variables.every(g => ['resolved', 'chosen'].includes(g.status)) ? 'ok' : 'warn'}"><h4>Discover indicators</h4>
          <div class="tablewrap"><table class="rtable"><thead><tr><th>You asked for</th><th>Catalogue series (only real identifiers can be chosen)</th><th>Coverage in the period</th></tr></thead><tbody>${indRows || '<tr><td colspan="3" class="muted">No indicator identified.</td></tr>'}</tbody></table></div></li>
        <li class="${d.countries.length && d.years ? 'ok' : 'warn'}"><h4>Countries and years</h4>
          <div class="rrow"><input class="pc" type="text" value="${esc(d.countries.join(', '))}" aria-label="Countries (ISO3 codes)" title="ISO3 codes, comma-separated"><input class="py0" type="number" value="${d.years ? d.years[0] : ''}" aria-label="Start year"><span>to</span><input class="py1" type="number" value="${d.years ? d.years[1] : ''}" aria-label="End year"></div>
          <p class="small muted">${d.countries.map(cname).map(esc).join(', ') || 'none'}${r && r.period ? ` · latest year with every variable: ${r.period.latest_common_year ?? '—'} · calendar year ${r.period.calendar_year}` : ''}</p></li>
        <li class="${r ? (r.warnings.length ? 'warn' : 'ok') : 'todo'}"><h4>Compatibility and missingness</h4>${r ? `<p class="small">Complete country-years: <strong>${r.complete_cases.rows}</strong> (${r.complete_cases.units} countries, ${r.complete_cases.years} years, ${r.complete_cases.balanced ? 'balanced' : 'unbalanced'}).</p>${r.warnings.length ? `<details class="small"><summary>${r.warnings.length} check(s) and warning(s)</summary><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}` : '<p class="small muted">Shown once indicators, countries and years are set.</p>'}
          ${v.issues.length ? `<ul class="issues">${v.issues.map(i => `<li>${esc(i.message)}</li>`).join('')}</ul>` : ''}</li>
        <li class="${names.length ? 'ok' : 'todo'}"><h4>Analytical sample</h4><p class="small">Unit × year panel of ${names.map(n => `<span class="mono">${esc(n)}</span>`).join(', ') || '—'}; each analysis uses complete cases; nothing is imputed or substituted.</p></li>
        <li class="${a.length ? 'ok' : 'todo'}"><h4>Methods</h4>
          <div class="rchecks">${['trends', 'describe', 'correlate', 'regression'].map(x => `<label class="rchk"><input type="checkbox" class="pa" value="${x}" ${a.includes(x) ? 'checked' : ''}> ${({trends: 'Trends', describe: 'Descriptive statistics', correlate: 'Correlations', regression: 'Regression'})[x]}</label>`).join('')}</div>
          <div class="rrow pmodel" ${a.includes('regression') ? '' : 'hidden'}>
            <select class="pm" aria-label="Model"><option value="panel_fe" ${m.method === 'panel_fe' ? 'selected' : ''}>Panel fixed effects</option><option value="ols" ${m.method === 'ols' ? 'selected' : ''}>OLS</option></select>
            <select class="pyv" aria-label="Dependent variable">${names.map(n => `<option ${est && est.params.y === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
            <label class="rchk"><input type="checkbox" class="pe" ${m.entity_effects !== false ? 'checked' : ''}> country FE</label><label class="rchk"><input type="checkbox" class="pt" ${m.time_effects ? 'checked' : ''}> year FE</label>
            <select class="pse" aria-label="Standard errors"><option value="default" ${['default', 'clustered', 'cluster'].includes(m.se) || !m.se ? 'selected' : ''}>SE: clustered by country (if ≥ 10)</option><option value="robust" ${['robust', 'hc1'].includes(m.se) ? 'selected' : ''}>SE: robust (HC1)</option></select></div>
          ${est ? `<p class="small">Estimate: <strong>${esc(est.params.method === 'panel_fe' ? 'panel fixed effects' : est.params.method)}</strong> of <span class="mono">${esc(est.params.y)}</span> on ${est.params.x.map(x => `<span class="mono">${esc(x)}</span>`).join(', ')}${est.params.method === 'panel_fe' ? ` with ${[est.params.entity_effects && 'country', est.params.time_effects && 'year'].filter(Boolean).join(' and ')} fixed effects` : ''}; standard errors: ${est.params.se === 'cluster' ? 'clustered by country' : est.params.se === 'hc1' ? 'robust (HC1)' : esc(est.params.se)}.</p>` : ''}
          ${optional.map(c => `<p class="small">${esc(c.message)}</p>`).join('')}</li>
        <li class="todo"><h4>Approve and run</h4>
          ${blocking.length ? `<div class="rwarn"><strong>Before running:</strong><ul>${blocking.map(c => `<li>${esc(c.message)}</li>`).join('')}</ul></div>` : ''}
          ${v.approvals_required.map((w, i) => `<label class="ack"><input type="checkbox" class="pack" data-i="${i}"> <span>${esc(w)}</span></label>`).join('')}
          <div class="ractions"><button class="btn papply">Apply edits and re-check</button><button class="btn primary prun" ${v.ready ? '' : 'disabled'}>Approve and run</button><button class="btn ghost pwb">Open in workbench</button></div>
          <details class="small"><summary>Inspect the plan (exact operations; schema-validated)</summary><pre class="mono">${esc(JSON.stringify(v.plan, null, 1))}</pre><p>Plan hash ${esc(v.plan_hash)}</p></details>
          ${v.ai ? `<details class="small"><summary>What the local model proposed (raw, before checks)</summary><pre class="mono">${esc(JSON.stringify(v.ai.trace.map(t => ({task: t.task, phrase: t.phrase, output: t.output, seconds: t.usage && t.usage.seconds})), null, 1))}</pre></details>` : ''}</li>
      </ol>`;
    const el = card(html, 'plan');
    el.querySelector('.prun').onclick = () => run(v, el);
    el.querySelector('.papply').onclick = () => applyEdits(el);
    el.querySelector('.pwb').onclick = () => { try { localStorage.setItem('pds_handoff_plan', JSON.stringify(v.plan)); } catch {} location.href = ENV.workbench + '#handoff'; };
    el.querySelectorAll('.pa').forEach(c => c.onchange = () => { el.querySelector('.pmodel').hidden = !el.querySelector('.pa[value=regression]').checked; });
    el.querySelectorAll('select[data-phrase]').forEach(s => s.onchange = async () => {
      if (!s.value) return; busy('Re-checking the plan…');
      try { const nv = await api('assistant/choose', {session: S.session, phrase: s.dataset.phrase, indicator_id: s.value}); S.view = nv; planCard(nv); } catch (e) { errorCard('Could not use that series', e); } finally { busy(''); }
    });
    el.scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  async function applyEdits(el) {
    const analyses = [...el.querySelectorAll('.pa:checked')].map(c => c.value);
    const edits = {countries: el.querySelector('.pc').value.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean),
                   years: [el.querySelector('.py0').value, el.querySelector('.py1').value], analyses};
    if (analyses.includes('regression')) edits.model = {method: el.querySelector('.pm').value, y: el.querySelector('.pyv').value, entity_effects: el.querySelector('.pe').checked, time_effects: el.querySelector('.pt').checked, se: el.querySelector('.pse').value};
    busy('Re-checking the plan…');
    try { const nv = await api('assistant/edit', {session: S.session, edits}); S.view = nv; planCard(nv); } catch (e) { errorCard('The edited plan is not valid', e); } finally { busy(''); }
  }

  // ---------------------------------------------------------------------------------------------- run, results, explanation
  async function run(v, el) {
    const acks = [...el.querySelectorAll('.pack')];
    if (acks.some(a => !a.checked)) { alert('Please read and tick the inference warning(s) before running.'); return; }
    busy('Running the approved plan with the Studio engine…');
    try {
      const res = await api('assistant/run', {session: S.session, plan_hash: v.plan_hash, approved: true, acknowledged: acks.length > 0});
      const out = res.result;
      const rc = card(`<h3>Results (computed by the Studio engine)</h3>${res.comparison ? comparisonHtml(res.comparison) : ''}<div class="resbody"></div>`, 'results');
      rc.querySelector('.resbody').innerHTML = R.resultsHtml(out).replace(/<section class="card/g, '<section class="card inner');
      R.wireDownloads(out, rc);
      factsAndExplain(res, out, rc);
    } catch (e) { errorCard('The plan was not run', e); }
    finally { busy(''); }
  }

  function comparisonHtml(c) {
    if (!c.previous || !c.current) return '';
    const terms = c.current.coefficients.filter(x => x.term !== 'const');
    return `<div class="rinterp"><strong>Compared with the previous run</strong> — ${c.same_data ? 'same frozen data (identical dataset hash)' : 'the data differ'}${c.changes ? '; changes: ' + c.changes.map(esc).join(' ') : ''}
      <div class="tablewrap"><table class="rtable cmp"><thead><tr><th>Term</th><th>Previous specification</th><th class="n">Coef.</th><th class="n">SE</th><th class="n">p</th><th>Current specification</th><th class="n">Coef.</th><th class="n">SE</th><th class="n">p</th></tr></thead><tbody>
      ${terms.map(t => { const p = c.previous.coefficients.find(x => x.term === t.term) || {}; return `<tr><td>${esc(t.term)}</td><td class="small">${esc(c.previous.spec.effects || 'OLS')}</td><td class="n">${fmt(p.coef, 4)}</td><td class="n">${fmt(p.se, 4)}</td><td class="n">${fmt(p.p_value, 3)}</td><td class="small">${esc(c.current.spec.effects || 'OLS')}</td><td class="n">${fmt(t.coef, 4)}</td><td class="n">${fmt(t.se, 4)}</td><td class="n">${fmt(t.p_value, 3)}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  }

  async function factsAndExplain(res, out, rc) {
    const ex = card(`<h3>What the results show</h3>
      <h4 class="small" style="margin:8px 0 4px">Computed facts (from the executed analysis — not written by the model)</h4>
      <ul class="facts">${out.facts.map(f => `<li><span class="fid">${esc(f.id)}</span> ${esc(f.text)}</li>`).join('')}</ul>
      <div class="aiexp"><p class="small muted">Asking the local model to explain these facts…</p></div>`, 'explain');
    if (!S.ai) { ex.querySelector('.aiexp').innerHTML = '<p class="small">AI interpretation unavailable (local model not running). The computed facts above are complete.</p>'; return; }
    busy('The local model is writing the interpretation (checked against the facts)…');
    try {
      const r = await api('assistant/explain', {session: res.session, run: res.run});
      const e = r.explanation, by = s => e.sentences.filter(x => x.section === s);
      const li = s => `<li>${esc(s.text)}${(s.fact_ids || []).map(i => `<span class="fid" title="${esc((out.facts.find(f => f.id === i) || {}).text || '')}">${esc(i)}</span>`).join('')}</li>`;
      ex.querySelector('.aiexp').innerHTML = `<div class="aisect"><h4>${esc(e.label)}</h4>
        <p class="small">Evidence type: <strong>${esc(e.evidence_type)}</strong></p>
        ${[['overview', 'Overview'], ['finding', 'Findings'], ['sensitivity', 'Sensitivity'], ['supported', 'What the evidence supports'], ['not_inferred', 'What cannot be inferred']].map(([k, t]) => by(k).length ? `<p class="small" style="margin:8px 0 2px"><strong>${t}</strong></p><ul>${by(k).map(li).join('')}</ul>` : '').join('')}
        <p class="small" style="margin:8px 0 2px"><strong>Always true for this analysis</strong></p><ul>${e.fixed_statements.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
        ${e.removed.length ? `<details class="small"><summary>${e.removed.length} model sentence(s) removed by the checks</summary><ul>${e.removed.map(s => `<li>${esc(s.text)} — <em>${esc(s.reason)}</em></li>`).join('')}</ul></details>` : ''}
        <p class="small muted">Each sentence cites fact identifiers; numbers not found in the cited facts, uncited claims and causal wording are removed automatically.</p></div>`;
      Object.assign(out.downloads, r.downloads);
      const dl = rc.querySelector('.rdl');
      for (const f of Object.keys(r.downloads)) if (!dl.querySelector(`[data-dl="${f}"]`)) dl.insertAdjacentHTML('beforeend', `<button class="btn sm" data-dl="${esc(f)}">${esc(f)}</button>`);
      R.wireDownloads(out, rc);
    } catch (err) { ex.querySelector('.aiexp').innerHTML = `<p class="small">AI interpretation unavailable: ${esc(err.message)}. The computed facts above are complete.</p>`; }
    finally { busy(''); }
  }

  window.__pdsAssistant = {state: S, send, run, applyEdits, pollStatus};   // used by automated browser tests
  init();
})();
