'use strict';
// Engine / model panel for the browser pages: explicit opt-in downloads with sizes, progress and fallbacks.
(() => {
  const $ = id => document.getElementById(id);
  const W = window.PDSWeb, P = $('webpanel'), withModel = P.dataset.model === 'yes';
  const MB = b => (b / 1e6).toFixed(1) + ' MB';
  P.innerHTML = `<h2 class="small" style="margin:0 0 6px;font-family:inherit">Run in this browser</h2>
    <div class="wrow"><div><strong>1. Research engine</strong> — Python, NumPy, SciPy, pandas, statsmodels, linearmodels and DuckDB compiled to WebAssembly, plus the Studio’s engine. About <strong>48 MB</strong>, downloaded once and cached by the browser. Data for each indicator (typically 10–100 KB) loads only when a plan needs it.</div>
      <div class="wact"><button class="btn primary" id="wstart">Start the engine</button><span class="small muted" id="wengine">Not started.</span></div></div>
    ${withModel && W.state.cloud.endpoint ? `<div class="wrow"><div><strong>2. AI planning (cloud)</strong> — the assistant’s planning and interpretation tasks run on Cloudflare Workers AI (Llama 3.3 70B), with no download. Your question and the computed facts are sent to Cloudflare; data, estimation and all checks stay in this browser. A free daily allowance is shared by all visitors; when it is used up the AI pauses until 00:00 UTC and manual analysis continues.</div>
      <div class="wact"><button class="btn primary" id="wcloud">Use cloud AI</button><span class="small muted" id="wcstate">Not connected.</span></div></div>` : ''}
    ${withModel ? `<div class="wrow"><div><strong>${W.state.cloud.endpoint ? 'Or: language model in your browser' : '2. Language model (optional)'}</strong> — Qwen3-4B (Apache 2.0) via WebLLM on WebGPU: <strong>2.28 GB</strong> download, about 3.4 GB of GPU memory; needs a recent desktop browser with WebGPU and 8 GB+ memory. Without it you can still use the <a href="research-web.html">Econometric Analysis workbench</a> and the <a href="../ai.html">question classifier</a>.</div>
      <div class="wact"><button class="btn" id="wmodel">Check device and download the model</button><span class="small muted" id="wmstate">Not downloaded.</span></div>
      <div class="wbar" hidden><i id="wbar"></i></div></div>` : ''}
    <p class="small muted" style="margin:6px 0 0" id="wstats"></p>`;
  const stats = () => { $('wstats').textContent = `Downloaded so far: ${MB(W.state.loadedBytes)} (of which indicator data ${MB(W.state.dataBytes)}).` + (performance.memory ? ` JavaScript memory in use: ${Math.round(performance.memory.usedJSHeapSize / 1e6)} MB.` : ''); };
  $('wstart').onclick = async () => {
    $('wstart').disabled = true;
    try { await W.startEngine(); } catch (e) { $('wstart').disabled = false; }
  };
  window.addEventListener('pds-web', ev => {
    const d = ev.detail;
    if (d.type === 'engine') $('wengine').textContent = d.state === 'loading' ? 'Loading: ' + d.step + '…' : d.state === 'ready' ? `Ready (loaded in ${d.seconds} s).` : 'Failed: ' + d.message;
    if (d.type === 'engine' && d.state === 'ready' && window.__pdsAssistant) window.__pdsAssistant.pollStatus();
    if (d.type === 'cloud') {
      $('wcstate').textContent = d.state === 'checking' ? 'Connecting…' : d.state === 'ready' ? `Connected (${d.model}).` : d.state === 'quota' ? 'Daily allowance used up — AI paused until 00:00 UTC.' : d.state === 'failed' ? 'Unavailable: ' + d.message : '';
      window.__pdsAssistant && window.__pdsAssistant.pollStatus();
    }
    if (d.type === 'model') {
      const bar = P.querySelector('.wbar');
      if (d.state === 'loading') { bar.hidden = false; $('wbar').style.width = Math.round(100 * (d.progress || 0)) + '%'; $('wmstate').textContent = d.text; }
      if (d.state === 'ready') { bar.hidden = true; $('wmstate').textContent = `Ready (${d.seconds} s).`; $('wmodel').disabled = true; window.__pdsAssistant && window.__pdsAssistant.pollStatus(); }
      if (d.state === 'failed') { bar.hidden = true; $('wmstate').textContent = d.interrupted ? 'Download interrupted — press the button again to resume.' : 'Could not start: ' + d.message; $('wmodel').disabled = false; window.__pdsAssistant && window.__pdsAssistant.pollStatus(); }
      if (d.state === 'unsupported') { $('wmstate').innerHTML = 'Not available on this device: ' + d.cap.reasons.join('; ') + '. Use the <a href="research-web.html">workbench</a> or the <a href="../ai.html">question classifier</a> instead.'; $('wmodel').disabled = true; window.__pdsAssistant && window.__pdsAssistant.pollStatus(); }
    }
    stats();
  });
  if (withModel && $('wcloud')) $('wcloud').onclick = async () => { $('wcloud').disabled = true; await W.startCloud(); if (W.state.cloud.state !== 'ready') $('wcloud').disabled = false; };
  if (withModel) $('wmodel').onclick = async () => {
    $('wmodel').disabled = true; $('wmstate').textContent = 'Checking WebGPU, memory and storage…';
    const c = await W.capability();
    if (c.ok && !c.cached && !confirm(`Download Qwen3-4B (2.28 GB) into this browser’s storage? It is kept for later visits. GPU: ${c.adapter || 'unknown'}; free browser storage: ${c.storageFreeGB ?? '?'} GB.`)) { $('wmodel').disabled = false; $('wmstate').textContent = 'Not downloaded.'; return; }
    W.startModel();
  };
  stats();
})();
