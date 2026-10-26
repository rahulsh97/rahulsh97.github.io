// tests.mjs -- every value the lab displays must equal the validated aggregate tables.
// Run from the repository root: node maize-compensation-lab/tests.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const here = new URL('./', import.meta.url);
const read = p => readFileSync(new URL(p, here), 'utf8');
const data = JSON.parse(read('data.json'));

// Minimal RFC 4180 CSV parser (quoted fields may contain commas)
function csv(p) {
  const text = read(p).replace(/\r\n/g, '\n').trim(); const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else f += c;
  }
  row.push(f); rows.push(row);
  const [h, ...body] = rows; return body.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(Number(a) - Number(b)) <= tol, `${msg}: ${a} vs ${b}`);
const key = r => [r.pi, r.lambda, r.theta, r.eps, r.kappa].map(v => String(+Number(v).toPrecision(6))).concat([r.green, r.annual]).join('|');

// 1. Provenance: every CSV matches the validated run manifest
const manifest = JSON.parse(read('data/run_manifest.json'));
assert.equal(manifest.run_id, 'maize_20261025T173130_1dafdd');
assert.equal(manifest.status, 'completed');
assert.ok(manifest.validation.gate_passed && manifest.validation.synthetic_tests.passed && manifest.validation.validated_outputs_unchanged);
const outHash = Object.fromEntries(Object.entries(manifest.outputs).map(([k, v]) => [k.split(/[\\/]/).pop(), v]));
for (const f of readdirSync(new URL('data/', here)).filter(f => f.endsWith('.csv')))
  assert.equal(createHash('sha256').update(readFileSync(new URL('data/' + f, here))).digest('hex'), outHash[f], `${f} hash`);

// 2. Scenario grid: every rule x objective x scenario (972 x 9 x 3)
let n = 0;
for (const r of csv('data/maize_scenario_grid.csv')) {
  const g = data.grid[key(r)]; assert.ok(g, `scenario ${key(r)}`);
  ['P1', 'P2', 'loss_comp'].forEach((o, i) => { close(g.rules[r.rule][i], r[o], 5.1e-5, `grid ${key(r)} ${r.rule} ${o}`); n++; });
  close(g.P1_shock, r.P1_shock, 5.1e-5, 'P1_shock');
}
assert.equal(n, 972 * 9 * 3);
assert.equal(Object.keys(data.grid).length, 972);

// 3. Central-scenario consistency across tables (grid vs central rules table)
const cr = csv('data/maize_central_rules.csv');
for (const r of cr) ['P1', 'P2', 'loss_comp'].forEach((o, i) => close(data.grid[data.central_key].rules[r.rule][i], r[o], 1e-4, `central ${r.rule} ${o}`));

// 4. Bootstrap (U3 joint) values
const boot = { central: '0.25|0.5|0.85|0|0.5|FALSE|x52', lambda0: '0.25|0|0.85|0|0.5|FALSE|x52', lambda1: '0.25|1|0.85|0|0.5|FALSE|x52' };
for (const r of csv('data/maize_boot_diffs.csv').filter(r => r.component === 'U3')) {
  const v = data.boot[boot[r.scenario]].diff_vs_R3[r.rule][r.objective];
  close(v[0], r.diff_vs_R3_mean, 5.1e-5, 'diff'); close(v[2], r.diff_lo, 5.1e-5, 'diff lo'); close(v[3], r.diff_hi, 5.1e-5, 'diff hi');
}
for (const r of csv('data/maize_boot_summary.csv').filter(r => r.component === 'U3')) {
  const v = data.boot[boot[r.scenario]].level[r.rule][r.objective];
  close(v[0], r.full_sample, 5.1e-5, 'level'); close(v[1], r.se, 5.1e-5, 'se');
}
for (const r of csv('data/maize_boot_rank.csv').filter(r => r.component === 'U3'))
  close(data.boot[boot[r.scenario]].prob_best[r.objective][r.rule], r.prob_best, 5.1e-4, 'prob_best');
assert.equal(Object.keys(data.boot).length, 3);

// 5. Districts, deciles, variance decomposition, shock summary, market position
const dd = csv('data/maize_district_diagnostics.csv');
assert.equal(data.districts.length, 32);
for (const r of dd) {
  const d = data.districts.find(x => x.name === r.district_name);
  close(d.P1_post, r.P1_post, 5.1e-3, 'district P1'); close(d.P1_post_se, r['se.P1_post'], 5.1e-3, 'district se');
  close(d.rel, r.rel, 5.1e-4, 'district rel'); close(d.prob_top8, r.prob_top8_P1_post, 5.1e-4, 'prob top8');
  close(d.net_buyer, r.net_buyer, 5.1e-4, 'net buyer'); assert.ok(d.n_ea >= 16, 'disclosure: >= 16 EAs');
}
for (const r of csv('data/maize_incidence_deciles.csv')) {
  const d = data.deciles[r.rule].find(x => x.dec === Number(r.dec));
  close(d.dy_over_c0, r.dy_over_c0, 5.1e-4, 'decile dy'); close(d.transfer_over_c0, r.transfer_over_c0, 5.1e-4, 'decile T');
}
for (const r of csv('data/maize_variance_decomposition.csv'))
  close(data.vardec.find(v => v.outcome === r.outcome && v.partition === r.partition).R2, r.R2_between, 5.1e-5, 'vardec');
for (const r of csv('data/maize_shock_summary.csv')) close(data.shock[r.measure], r.value, 5.1e-4, `shock ${r.measure}`);
const gate = Object.fromEntries(csv('data/maize_gate.csv').map(r => [r.id, r.value]));
for (const kv of gate.I1.split('; ')) { const [k, v] = kv.split('='); close(data.market[k], v, 1e-9, `market ${k}`); }

// 6. Core logic used by the page
const ctx = vm.createContext({}); vm.runInContext(read('core.js'), ctx); const C = ctx.MaizeCore;
const central = { pi: 0.25, lambda: 0.5, theta: 0.85, eps: 0, kappa: 0.5, green: 'FALSE', annual: 'x52' };
assert.equal(C.scenarioKey(central), data.central_key);
assert.equal(C.scenarioKey({ ...central, pi: '0.1', eps: '-0.6', annual: 'seasonal' }), '0.1|0.5|0.85|-0.6|0.5|FALSE|seasonal');
assert.ok(C.isValidated(data, central));
assert.ok(!C.isValidated(data, { ...central, pi: 0.3 }), 'unvalidated price rise must be rejected');
assert.ok(!C.isValidated(data, { ...central, kappa: 0.75 }), 'unvalidated budget must be rejected');
const crow = Object.fromEntries(cr.map(r => [r.rule, r]));
for (const [o, col] of [['P1', 'share_attainable_P1'], ['P2', 'share_attainable_P2'], ['loss_comp', 'share_attainable_loss_comp']])
  for (const r of ['R1_universal', 'R2_geographic', 'R3_pmt', 'R4_exposure', 'R5_pmt_exposure'])
    close(C.shareAttainable(data, data.central_key, r, o), crow[r][col], 2e-3, `derived share ${r} ${o} vs validated table`);
assert.equal(C.bestImplementable(data, data.central_key, 'P1'), 'R5_pmt_exposure');
assert.equal(C.fmtValue('P1', 16.6912), '16.69');
assert.equal(C.fmtValue('loss_comp', 0.4385), '43.9%');
// best feasible rule over the grid matches the validated best-rule counts
const bestCounts = { P1: {}, P2: {}, loss_comp: {} };
for (const k of Object.keys(data.grid)) for (const o of Object.keys(bestCounts)) { const b = C.bestImplementable(data, k, o); bestCounts[o][b] = (bestCounts[o][b] || 0) + 1; }
assert.deepEqual({ ...bestCounts.P1 }, { R5_pmt_exposure: 839, R3_pmt: 133 });
assert.deepEqual({ ...bestCounts.P2 }, { R5_pmt_exposure: 942, R3_pmt: 30 });
assert.deepEqual({ ...bestCounts.loss_comp }, { R5_pmt_exposure: 814, R3_pmt: 158 });

// 7. No free numeric input; no simulation code in the browser
const html = read('index.html'), app = read('app.js');
assert.ok(!/<input[^>]+type=["']?(number|range|text)/i.test(html), 'no free numeric/text inputs');
assert.ok(!/welfare_change|S_real|B_grain|rexpagg/.test(app + read('core.js')), 'no simulation code');

// 8. Disclosure scan of every text file in the lab
const walk = d => readdirSync(new URL(d, here)).flatMap(f => statSync(new URL(d + f, here)).isDirectory() ? walk(d + f + '/') : [d + f]);
// (this test file is excluded because it necessarily contains the patterns themselves)
const forbidden = [/[A-Z]:[\\/]+Users[\\/]/i, /ResearchData/i, /\bcase_id\b/, /\bHHID\b/, /\bea_id\b/, /latitude|longitude|_lat_|_lon_/i];
for (const f of walk('').filter(f => /\.(js|json|csv|html|css|md|py)$/.test(f)))
  for (const re of forbidden) assert.ok(!re.test(read(f)), `${f} contains forbidden pattern ${re}`);

console.log(`All checks passed: ${n} grid values, bootstrap, districts, deciles and derived shares match the validated tables; validated-scenario guard, no-free-input and disclosure scans passed.`);
