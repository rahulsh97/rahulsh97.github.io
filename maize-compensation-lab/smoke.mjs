// smoke.mjs -- run app.js against a minimal DOM and check what it renders.
// Run from the repository root: node maize-compensation-lab/smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const here = new URL('./', import.meta.url);
const read = p => readFileSync(new URL(p, here), 'utf8');
const payload = JSON.parse(read('data.json'));

class El {
  constructor(id) { this.id = id; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.className = ''; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.checked = false; }
  addEventListener(ev, fn) { this.listeners[ev] = fn; }
  setAttribute(k, v) { this.attrs[k] = v; }
}
const nodes = new Map();
const get = id => nodes.get(id) || (nodes.set(id, new El(id)), nodes.get(id));
const radios = ['P1', 'P2', 'loss_comp'].map(v => Object.assign(new El('obj-' + v), { value: v, checked: v === 'P1' }));
const presets = ['central', 'lambda0', 'lambda1'].map(p => Object.assign(new El('preset-' + p), { dataset: { preset: p } }));
let hash = '';
const ctx = vm.createContext({
  document: { getElementById: get, querySelectorAll: sel => (sel.startsWith('input') ? radios : sel === '.preset' ? presets : []) },
  fetch: async () => ({ ok: true, json: async () => payload }),
  location: { get hash() { return hash; } }, history: { replaceState: (a, b, h) => { hash = h; } },
  URLSearchParams, console
});
ctx.window = ctx;
vm.runInContext(read('core.js'), ctx);
vm.runInContext(read('app.js'), ctx);
await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));

// Central scenario headline values
assert.equal(get('stat-shock').textContent, payload.grid[payload.central_key].P1_shock.toFixed(2));
assert.equal(get('stat-shock').textContent, '16.69');
assert.equal(get('stat-best').textContent, 'PMT + exposure');
assert.equal(get('stat-share').textContent, '75%');
assert.match(get('status').innerHTML, /Uncertainty available/);
assert.match(get('stat-exposure-cap').textContent, /not distinguishable from zero/);
assert.equal(presets[0].attrs['aria-pressed'], 'true');
assert.match(get('rules-chart').innerHTML, /<svg[^>]+role="img"/);
assert.match(get('rules-table').innerHTML, /16\.23/);             // universal transfer, central P1
assert.match(get('unc-chart').innerHTML, /<circle/);
assert.equal((get('geo-table').innerHTML.match(/<tr>/g) || []).length, 33);   // header + 32 districts
assert.match(get('vardec').innerHTML, /8%/);                       // 7.9% of loss variation between districts
assert.match(hash, /objective=P1/);

// Switch to an unvalidated value: must be ignored (no interpolation)
get('p-pi').listeners.change({ target: { value: '0.3' } });
assert.equal(get('stat-shock').textContent, '16.69');

// Switch to a validated non-bootstrap scenario: point estimate only
get('p-pi').listeners.change({ target: { value: '0.5' } });
assert.match(get('status').innerHTML, /Point estimate only/);
assert.match(get('unc-chart').innerHTML, /three scenarios only/);
assert.equal(get('stat-shock').textContent, payload.grid['0.5|0.5|0.85|0|0.5|FALSE|x52'].P1_shock.toFixed(2));

// Objective switch
radios[2].listeners.change({ target: { value: 'loss_comp' } });
assert.match(get('rules-pill').textContent, /Losses of poor households compensated/);
console.log('Smoke test passed: headline, charts, tables, scenario guard and objective switching render as expected.');
