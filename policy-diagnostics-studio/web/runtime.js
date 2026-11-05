'use strict';
// In-browser runtime for the Studio's research engine and AI assistant.
// - Engine: Pyodide (CPython compiled to WebAssembly) runs the Studio's own Python modules unchanged, with DuckDB,
//   pandas, statsmodels and linearmodels, on per-indicator Parquet files fetched on demand from this site.
// - Model (optional): Qwen3-4B via WebLLM on WebGPU, downloaded only when the visitor asks; answers are constrained by
//   the same JSON schemas as the local model. Model output is data: nothing it returns is executed.
// - The page scripts (research.js, assistant.js) call /api/... exactly as with the local server; a fetch adapter
//   routes those calls to the in-browser engine.
(() => {
  const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
  const WEBLLM = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/+esm';
  const MODEL_ID = 'Qwen3-4B-q4f16_1-MLC';
  const BASE = new URL('.', document.currentScript.src).href;          // .../web/
  const DATA = new URL('../data/browser/', BASE).href;
  const SIM = new URLSearchParams(location.search).get('simulate') || '';   // test hooks: nowebgpu, lowmem, noengine
  const W = {engine: 'idle', model: 'idle', loadedBytes: 0, dataBytes: 0, events: [], modelInfo: {id: MODEL_ID, downloadGB: 2.28, gpuMemoryGB: 3.4}};
  let py = null, rt = null, resolveReady, llmEngine = null, llmQueue = Promise.resolve();
  const ready = new Promise(r => { resolveReady = r; });
  const emit = (type, detail) => { W.events.push([Math.round(performance.now()), type, detail]); window.dispatchEvent(new CustomEvent('pds-web', {detail: {type, ...detail}})); };

  // ------------------------------------------------------------------------------------------------ engine
  async function fetchBytes(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const b = new Uint8Array(await r.arrayBuffer());
    W.loadedBytes += b.byteLength;
    return b;
  }
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }

  async function startEngine() {
    if (W.engine !== 'idle' && W.engine !== 'failed') return ready;
    if (SIM === 'noengine') { W.engine = 'failed'; emit('engine', {state: 'failed', message: 'Simulated: WebAssembly engine unavailable.'}); throw new Error('Simulated engine failure'); }
    W.engine = 'loading'; const t0 = performance.now();
    try {
      emit('engine', {state: 'loading', step: 'Python runtime (Pyodide)'});
      if (!window.loadPyodide) await loadScript(PYODIDE + 'pyodide.js');
      py = await loadPyodide({indexURL: PYODIDE});
      const man = await (await fetch(BASE + 'manifest.json')).json();
      emit('engine', {state: 'loading', step: 'Scientific libraries (NumPy, SciPy, pandas, statsmodels, DuckDB)'});
      await py.loadPackage(man.packages);
      emit('engine', {state: 'loading', step: 'linearmodels and formula libraries'});
      for (const w of man.wheels) py.FS.writeFile('/tmp/' + w.file, await fetchBytes(BASE + 'wheels/' + w.file));
      await py.runPythonAsync(`import micropip\nawait micropip.install([${man.wheels.map(w => `'emfs:/tmp/${w.file}'`).join(',')}], deps=False)`);
      emit('engine', {state: 'loading', step: 'Studio research engine and catalogue'});
      for (const f of man.python_files) { const p = '/studio/py/' + f.path; py.FS.mkdirTree(p.slice(0, p.lastIndexOf('/'))); py.FS.writeFile(p, await fetchBytes(BASE + 'py/' + f.path)); }
      py.FS.mkdirTree('/studio/data/obs');
      for (const f of ['index.json', 'countries.parquet', 'sources.parquet', 'catalogue.parquet', 'obs/_empty.parquet']) py.FS.writeFile('/studio/data/' + f, await fetchBytes(DATA + f));
      py.runPython("import sys; sys.path.insert(0, '/studio/py')");
      rt = py.pyimport('runtime');
      if (W.provider === 'cloud' && W.modelInfoCloud) rt.set_model_info(JSON.stringify({name: W.modelInfoCloud, publisher: 'Cloudflare Workers AI', licence: 'Llama 3.3 Community License', runtime: 'Cloudflare Workers AI (free daily allowance shared by all visitors)', ready_label: 'Cloud AI ready', where: 'your question, the plan details and the computed facts are sent to Cloudflare for the planning and interpretation steps; data, estimation and all checks stay in this browser'}));
      if (W.model === 'ready') setModel(true); else if (W.modelReason) setModel(false, W.modelReason);   // model may have finished first
      W.engine = 'ready'; W.engineSeconds = +((performance.now() - t0) / 1000).toFixed(1);
      emit('engine', {state: 'ready', seconds: W.engineSeconds});
      resolveReady();
    } catch (e) { W.engine = 'failed'; emit('engine', {state: 'failed', message: e.message}); throw e; }
    return ready;
  }

  async function loadIndicators(need) {
    for (let i = 0; i < need.ids.length; i++) {
      const b = await fetchBytes(DATA + 'obs/' + need.files[i]);
      W.dataBytes += b.byteLength;
      py.FS.writeFile('/studio/data/obs/' + need.files[i], b);
    }
    rt.mark_loaded(py.toPy(need.ids));
    emit('data', {ids: need.ids, bytes: need.bytes});
  }

  async function call(method, path, query, body) {
    await ready;
    for (let i = 0; i < 60; i++) {
      const out = JSON.parse(rt.dispatch(method, path, JSON.stringify(query || {}), JSON.stringify(body || {})));
      if (!out.need) return out;
      if (out.need.kind === 'data') await loadIndicators(out.need);
      else if (out.need.kind === 'llm') await runLLM(out.need);
      else throw new Error('Unknown resource request');
    }
    return {status: 500, body: {error: 'internal', issues: [{code: 'internal', message: 'Too many steps; the request was stopped.'}]}};
  }

  // Route /api/... requests from the existing page scripts to the in-browser engine.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const i = url.pathname.indexOf('/api/');
    if (i < 0) return realFetch(input, init);
    const path = url.pathname.slice(i + 5);
    const query = Object.fromEntries(url.searchParams.entries());
    const body = init.body ? JSON.parse(init.body) : {};
    let out;
    try { out = await call((init.method || 'GET').toUpperCase(), path, query, body); }
    catch (e) { out = {status: 503, body: {error: 'engine_unavailable', issues: [{code: 'engine', message: 'The in-browser engine is not available: ' + e.message}]}}; }
    return new Response(JSON.stringify(out.body), {status: out.status, headers: {'Content-Type': 'application/json'}});
  };

  // ------------------------------------------------------------------------------------------------ model
  async function capability() {
    const c = {webgpu: !!navigator.gpu && SIM !== 'nowebgpu', deviceMemoryGB: SIM === 'lowmem' ? 2 : (navigator.deviceMemory || null), adapter: null, f16: false, storageFreeGB: null};
    if (c.webgpu) {
      try { const a = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'}); if (a) { c.adapter = a.info ? `${a.info.vendor} ${a.info.architecture}`.trim() : 'available'; c.f16 = a.features.has('shader-f16'); c.maxBufferMB = Math.round(a.limits.maxBufferSize / 1e6); } else c.webgpu = false; }
      catch { c.webgpu = false; }
    }
    try { const e = await navigator.storage.estimate(); c.storageFreeGB = +((e.quota - e.usage) / 1e9).toFixed(1); } catch {}
    c.cachedGB = await modelCachedGB();
    c.cached = c.cachedGB >= W.modelInfo.downloadGB * 0.99;
    c.remainingGB = +Math.max(0, W.modelInfo.downloadGB - c.cachedGB).toFixed(2);
    const reasons = [];
    if (!c.webgpu) reasons.push('this browser or device does not provide WebGPU');
    if (c.webgpu && !c.f16) reasons.push('the GPU does not support 16-bit shaders, which this model build needs');
    if (c.deviceMemoryGB !== null && c.deviceMemoryGB < 8) reasons.push(`the device reports ${c.deviceMemoryGB} GB of memory (8 GB or more is recommended)`);
    if (c.storageFreeGB !== null && c.storageFreeGB < c.remainingGB + 0.2) reasons.push(`only ${c.storageFreeGB} GB of browser storage is available, but ${c.remainingGB} GB of the model remains to be downloaded`);
    c.ok = reasons.length === 0; c.reasons = reasons;
    return c;
  }
  async function modelCachedGB() {   // size of the model parts already in this browser's cache (from the stored responses' headers)
    try {
      const name = (await caches.keys()).find(k => /webllm\/model/i.test(k));
      if (!name) return 0;
      const c = await caches.open(name); let bytes = 0;
      for (const req of await c.keys()) { const r = await c.match(req); bytes += +(r.headers.get('content-length') || 0); }
      return bytes / 1e9;
    } catch { return 0; }
  }

  async function startModel() {
    if (W.model === 'ready') return;
    const cap = await capability();
    if (!cap.ok) { W.model = 'unsupported'; setModel(false, 'Not available on this device: ' + cap.reasons.join('; ') + '.'); emit('model', {state: 'unsupported', cap}); return; }
    W.model = 'loading'; const t0 = performance.now();
    setModel(false, 'The language model is downloading in this browser.');
    try {
      const webllm = await import(WEBLLM);
      llmEngine = await webllm.CreateMLCEngine(MODEL_ID, {initProgressCallback: p => emit('model', {state: 'loading', progress: p.progress, text: p.text})}, {context_window_size: 8192});
      W.model = 'ready'; W.provider = 'webllm'; W.modelSeconds = +((performance.now() - t0) / 1000).toFixed(1);
      if (rt) rt.set_model_info('');
      setModel(true);
      emit('model', {state: 'ready', seconds: W.modelSeconds});
    } catch (e) {
      W.model = 'failed';
      const interrupted = /fetch|network|Failed to fetch|abort/i.test(e.message);
      setModel(false, interrupted ? 'The model download was interrupted. Start it again to resume (parts already downloaded are kept).' : 'The model could not be started on this device: ' + e.message);
      emit('model', {state: 'failed', message: e.message, interrupted});
    }
  }
  function setModel(ok, reason = '') { W.modelReason = ok ? '' : reason; if (rt) rt.set_model_state(ok, reason); }

  const LOST = /Model not loaded|device (was )?lost|mapAsync|GPUBuffer|DXGI|out of memory|already been disposed/i;
  async function reloadModel() {   // after a lost GPU device: recreate the engine from the browser's cached model files
    const webllm = await import(WEBLLM);
    llmEngine = await webllm.CreateMLCEngine(MODEL_ID, {initProgressCallback: p => emit('model', {state: 'loading', progress: p.progress, text: 'Recovering: ' + p.text})}, {context_window_size: 8192});
    W.recoveries = (W.recoveries || 0) + 1; emit('model', {state: 'ready', seconds: 0, recovered: true});
  }
  // ------------------------------------------------------------------------------------------------ cloud model (Cloudflare Worker)
  // The Worker runs only the assistant's own schema-constrained tasks on Workers AI (free daily allocation, shared by
  // all visitors, enforced fail-closed by the Worker). Everything else — catalogue grounding, plan validation,
  // approval, estimation and fact checks — stays in this browser.
  const CLOUD = (new URLSearchParams(location.search).get('cloud') || (window.PDS_CLOUD_AI && window.PDS_CLOUD_AI.endpoint) || '').replace(/\/$/, '');
  W.cloud = {endpoint: CLOUD || null, state: 'idle'};
  async function startCloud() {
    if (!CLOUD) { W.cloud.state = 'unconfigured'; emit('cloud', {state: 'unconfigured'}); return false; }
    W.cloud.state = 'checking'; emit('cloud', {state: 'checking'});
    try {
      const h = await (await realFetch(CLOUD + '/health', {cache: 'no-store'})).json();
      if (!h.ok) throw new Error('The cloud AI service is not available.');
      if (!h.quota_available) throw new Error('The free daily AI allowance for this site has been used up; it resets at 00:00 UTC.');
      W.provider = 'cloud'; W.model = 'ready'; W.cloud.state = 'ready'; W.cloud.model = h.model;
      if (rt) rt.set_model_info(JSON.stringify({name: h.model, publisher: 'Cloudflare Workers AI', licence: 'Llama 3.3 Community License', runtime: 'Cloudflare Workers AI (free daily allowance shared by all visitors)', ready_label: 'Cloud AI ready', where: 'your question, the plan details and the computed facts are sent to Cloudflare for the planning and interpretation steps; data, estimation and all checks stay in this browser'}));
      W.modelInfoCloud = h.model; setModel(true); emit('cloud', {state: 'ready', model: h.model});
      return true;
    } catch (e) { W.cloud.state = 'failed'; setModel(false, 'Cloud AI unavailable: ' + e.message + ' Manual analysis still works.'); emit('cloud', {state: 'failed', message: e.message}); return false; }
  }
  async function cloudComplete(need) {
    const r = await realFetch(CLOUD + '/v1/complete', {method: 'POST', headers: {'Content-Type': 'application/json'}, cache: 'no-store',
      body: JSON.stringify({system: need.system, user: need.user, schema: need.schema, max_tokens: need.max_tokens, temperature: need.temperature})});
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    if (r.status === 429 && j.error === 'quota_exhausted') {           // fail closed: no further AI calls today
      W.model = 'failed'; W.cloud.state = 'quota'; setModel(false, j.message || 'The free daily AI allowance has been used up.');
      emit('cloud', {state: 'quota', message: j.message});
    }
    throw new Error(j.message || `Cloud AI error ${r.status}`);
  }

  function runLLM(need) {
    if (W.provider === 'cloud') {
      const job = async () => {
        const t0 = performance.now();
        try { const j = await cloudComplete(need); rt.store_llm(need.key, JSON.stringify({data: j.data, usage: {...j.usage, model: j.model}})); }
        catch (e) { rt.store_llm(need.key, JSON.stringify({error: e.message})); }
        emit('llm', {seconds: +((performance.now() - t0) / 1000).toFixed(1), provider: 'cloud'});
      };
      llmQueue = llmQueue.then(job, job);
      return llmQueue;
    }
    const job = async () => {
      const t0 = performance.now();
      const create = () => llmEngine.chat.completions.create({messages: [{role: 'system', content: need.system}, {role: 'user', content: need.user}],
          temperature: need.temperature, top_p: 1.0, seed: 7, max_tokens: need.max_tokens,
          response_format: {type: 'json_object', schema: JSON.stringify(need.schema)}, extra_body: {enable_thinking: false}});
      try {
        if (!llmEngine) throw new Error('The language model is not loaded.');
        let r;
        try { r = await create(); }
        catch (e) { if (!LOST.test(e.message)) throw e; emit('llm', {lost: e.message}); await reloadModel(); r = await create(); }   // one automatic recovery
        // Qwen3's chat template emits an empty <think></think> block before the schema-constrained JSON; drop it.
        const text = r.choices[0].message.content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '');
        let data;
        try { data = JSON.parse(text); } catch { throw new Error('The model returned malformed JSON.'); }
        rt.store_llm(need.key, JSON.stringify({data, usage: {...(r.usage || {}), seconds: +((performance.now() - t0) / 1000).toFixed(2)}}));
      } catch (e) {
        if (LOST.test(e.message)) {   // GPU device lost again after the recovery attempt: model gone
          llmEngine = null; W.model = 'failed';
          setModel(false, 'The browser’s GPU stopped the language model (device lost or out of memory). Reload the model to try again; manual analysis still works.');
          emit('model', {state: 'failed', message: 'GPU device lost: ' + e.message, interrupted: false, lost: true});
        }
        rt.store_llm(need.key, JSON.stringify({error: e.message}));
      }
      emit('llm', {seconds: +((performance.now() - t0) / 1000).toFixed(1)});
    };
    llmQueue = llmQueue.then(job, job);
    return llmQueue;
  }

  window.PDSWeb = {state: W, startEngine, startModel, startCloud, capability, call, ready};
})();
