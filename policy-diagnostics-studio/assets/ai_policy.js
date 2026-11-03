'use strict';
// AI Policy Assistant page. The on-device model (Transformers.js + all-MiniLM-L6-v2, open source, no API key)
// only classifies the question into one of the Studio's supported analyses. Answers come from ai_policy_core.js,
// which calls the validated analysis.js functions on the packaged country files.
const core = window.PDSAICore;
const $ = id => document.getElementById(id);
const esc = core.esc;
const MODEL = {lib: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1', id: 'Xenova/all-MiniLM-L6-v2'};
const THRESH = {min: 0.45, margin: 0.03};   // below these, the question is treated as unclear (no answer is invented)

const countries = (await fetch('data/countries.json', {cache: 'no-cache'}).then(r => { if (!r.ok) throw Error('Country list unavailable'); return r.json(); })).countries;
let catalog = null;
fetch('data/catalog.json').then(r => r.ok ? r.json() : null).then(c => { if (c) catalog = new Map(c.indicators.map(i => [i.id, i])); }).catch(() => {});
const byName = countries.slice().sort((a, b) => a.name.localeCompare(b.name));
$('country').innerHTML = byName.map(c => `<option value="${esc(c.iso3)}">${esc(c.name)}${c.subnational ? '' : ' (national data only)'}</option>`).join('');
$('country').value = 'KEN';
for (const b of document.querySelectorAll('[data-example]')) b.onclick = () => { $('question').value = b.dataset.example; if (b.dataset.iso) $('country').value = b.dataset.iso; };

let encoder = null, bank = null, modelState = 'not loaded';
async function loadModel() {
  if (encoder) return;
  modelState = 'loading';
  $('modelstatus').textContent = 'Downloading the open-source model (about 23 MB, once; then cached in this browser)…';
  const t0 = performance.now();
  const {pipeline, env} = await import(MODEL.lib);
  env.allowLocalModels = false;
  encoder = await pipeline('feature-extraction', MODEL.id, {device: 'wasm', dtype: 'q8'});
  const samples = core.TOPICS.flatMap(t => t.examples.map(e => ({topic: t.id, phrase: e})));
  const out = await encoder(samples.map(s => s.phrase), {pooling: 'mean', normalize: true});
  bank = {samples, vecs: out.tolist()};
  modelState = 'ready';
  $('modelstatus').textContent = `Model ready on this device (${MODEL.id}, loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s). Your question never leaves this browser.`;
}
async function semantic(q) {
  await loadModel();
  const v = (await encoder([q], {pooling: 'mean', normalize: true})).tolist()[0];
  // best similarity per topic (max over its example phrasings)
  const best = {};
  bank.samples.forEach((s, i) => { const sc = v.reduce((a, x, j) => a + x * bank.vecs[i][j], 0); if (!(s.topic in best) || sc > best[s.topic]) best[s.topic] = sc; });
  const ranked = Object.entries(best).sort((a, b) => b[1] - a[1]);
  return {topic: ranked[0][0], score: ranked[0][1], second: ranked[1][1], secondTopic: ranked[1][0]};
}

function card(kind, inner) { return `<section class="card airesult ${kind}">${inner}</section>`; }
function refusal(title, msg, q) {
  return card('ai-refuse', `<span class="aicover">NOT ANSWERED</span><h2>${esc(title)}</h2><p>${esc(msg)}</p>
    <p class="small">The Studio can answer questions about: <strong>regional poverty</strong> (where poverty is highest, where most poor people live), <strong>observed public spending versus need</strong> (Brazil), <strong>hypothetical funding rules</strong>, <strong>regional health and education indicators</strong>, and <strong>rainfall compared with normal</strong>. No figures are shown for questions outside these.</p>`);
}
function render(res, route, note) {
  const how = route.mode === 'ai' ? `On-device model match · similarity ${route.score.toFixed(2)} (next: ${route.secondTopic} ${route.second.toFixed(2)})` : 'Keyword match (no model)';
  const head = `<span class="aicover">${esc(res.label)} · ${esc(how)}</span><h2>${esc(res.heading)}</h2>${note ? `<p class="small aiwarn-inline">${esc(note)}</p>` : ''}`;
  if (res.status !== 'ok') {
    const alt = res.fallback ? render(res.fallback, route, null) : '';
    return card('ai-unavail', `${head}<div class="aiwarning"><strong>Not available.</strong> ${esc(res.message)}</div><a class="aigo" href="index.html${res.href}">Open the ${esc(res.country)} analysis page</a>`) + alt;
  }
  return card('', `${head}<p><span class="pill ${res.kind.startsWith('Hypothetical') ? 'amber' : res.kind.startsWith('Observed') ? 'blue' : ''}">${esc(res.kind)}</span></p>
    <ul class="aifacts">${res.facts.map(f => `<li>${esc(f.text)}<span class="aisrc">Source: ${esc(f.source)}</span></li>`).join('')}</ul>
    <div class="aievidence"><div><strong>Validation against published statistics</strong><p>${esc(res.validation)}</p></div><div><strong>Statistical uncertainty</strong><p>${esc(res.uncertainty)}</p></div></div>
    <div class="aiwarning"><strong>Assumptions</strong><ul>${res.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul><strong>What cannot be concluded</strong><ul>${res.limitations.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>
    <details class="small"><summary>How this answer was produced</summary><p>The question was matched to a supported analysis (${esc(how)}). Every number was computed by the Studio's validated functions (${esc(res.computedWith.join(', '))}) from the packaged ${esc(res.country)} data — the same functions and defaults as the full analysis page. The language model does not generate any figures or text above.</p></details>
    <a class="aigo" href="index.html${res.href}">Open the full analysis with charts, maps and downloads</a>`);
}

async function run(useAI) {
  const q = $('question').value.trim();
  $('answer').innerHTML = '';
  if (!q) { $('status').textContent = 'Enter a question first.'; return; }
  $('ask').disabled = $('kw').disabled = true;
  try {
    // 1. Questions the data cannot answer are declined before anything else (both modes).
    const oos = core.outOfScope(q);
    if (oos) { $('answer').innerHTML = refusal({forecast: 'Forecasts are not supported', causal: 'Policy effects are not estimated', normative: 'No policy recommendations', 'off-topic': 'Outside the Studio’s scope'}[oos.kind], oos.message, q); $('status').textContent = 'Question declined: the Studio has no data that can answer it.'; return; }
    // 2. Country: a country named in the question takes precedence over the menu.
    let iso = $('country').value, note = null;
    const named = core.detectCountry(q, countries);
    if (named && named.iso3 !== iso) { note = `Your question mentions ${named.name}, so ${named.name} is used (the menu said ${countries.find(c => c.iso3 === iso)?.name}).`; iso = named.iso3; $('country').value = iso; }
    // 3. Route the question.
    let route;
    if (useAI) {
      try {
        const s = await semantic(q);
        if (s.score < THRESH.min || s.score - s.second < THRESH.margin) {
          $('answer').innerHTML = refusal('The question is not clear enough', `The model could not match this question confidently to one analysis (best match “${s.topic}”, similarity ${s.score.toFixed(2)}; next “${s.secondTopic}”, ${s.second.toFixed(2)}). Rephrase it more specifically, for example “Which districts have the highest poverty rates?”.`, q);
          $('status').textContent = 'No answer shown: the match was too uncertain.'; return;
        }
        route = {mode: 'ai', ...s};
      } catch (e) {
        modelState = 'failed';
        $('modelstatus').textContent = `The model could not be loaded (${e.message}). Keyword matching was used instead; no AI result is claimed.`;
        const k = core.keywordTopic(q);
        if (!k) { $('answer').innerHTML = refusal('The question is not clear enough', 'No supported analysis matches this question.', q); return; }
        route = {mode: 'keyword', ...k};
      }
    } else {
      const k = core.keywordTopic(q);
      if (!k) { $('answer').innerHTML = refusal('The question is not clear enough', 'No keyword matches a supported analysis. Mention poverty, spending, a funding rule, a health or education indicator, or rainfall.', q); $('status').textContent = 'No answer shown.'; return; }
      route = {mode: 'keyword', ...k};
    }
    // 4. Grounded answer from the validated functions.
    const r = await fetch(`data/country/${encodeURIComponent(iso)}.json`, {cache: 'no-cache'});
    if (!r.ok) throw Error(`No data file for ${iso} in this installation.`);
    const doc = await r.json(), info = countries.find(c => c.iso3 === iso);
    const res = core.answer(doc, info, route.topic, {question: q, catalog});
    $('answer').innerHTML = render(res, route, note);
    $('status').textContent = route.mode === 'ai' ? 'Interpreted on your device; all figures come from the Studio’s validated calculations.' : 'Answered with keyword matching (no model); all figures come from the Studio’s validated calculations.';
  } catch (err) {
    $('status').textContent = `Could not complete the request: ${err.message}`;
  } finally { $('ask').disabled = $('kw').disabled = false; }
}
$('ask').onclick = () => run(true);
$('kw').onclick = () => run(false);
$('question').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(true); });
window.__pdsAI = {run, state: () => modelState};   // used by automated browser tests
