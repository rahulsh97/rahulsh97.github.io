// core.js -- pure helpers for the Maize Compensation Lab (no DOM). Shared by app.js and tests.
// Nothing here simulates anything: every number shown comes from data.json, which is built
// from the validated aggregate tables. The only arithmetic is the "share of attainable
// improvement", a ratio of three precomputed values, labelled as derived in the interface.
(function (root) {
  const RULE_INFO = {
    R0_none: { label: 'No compensation', short: 'None', cls: 'reference', note: 'Shock with no transfer' },
    R1_universal: { label: 'Equal per-person transfer', short: 'Universal', cls: 'implementable', note: 'Needs population counts only' },
    R2_geographic: { label: 'Geographic (32 districts)', short: 'Geographic', cls: 'implementable', note: 'District shares from published survey estimates' },
    R3_pmt: { label: 'Poverty proxy (PMT)', short: 'PMT', cls: 'survey-ideal', note: 'Same-round cross-fitted model: upper bound for a real registry' },
    R4_exposure: { label: 'Maize-exposure proxy', short: 'Exposure', cls: 'survey-ideal', note: 'Same-round cross-fitted model: upper bound for a real registry' },
    R5_pmt_exposure: { label: 'PMT + exposure', short: 'PMT + exposure', cls: 'survey-ideal', note: 'Same-round cross-fitted model: upper bound for a real registry' },
    B1_perfect_gap: { label: 'Benchmark: fill deepest gaps first', short: 'B1 deepest gaps', cls: 'benchmark', note: 'Needs every household’s true consumption: infeasible' },
    B2_perfect_loss_postpoor: { label: 'Benchmark: reimburse post-shock poor', short: 'B2 reimburse (post-shock poor)', cls: 'benchmark', note: 'Needs every household’s true loss: infeasible' },
    B3_perfect_loss_initpoor: { label: 'Benchmark: reimburse initially poor', short: 'B3 reimburse (initially poor)', cls: 'benchmark', note: 'Needs every household’s true loss: infeasible' }
  };
  const IMPLEMENTABLE = ['R1_universal', 'R2_geographic', 'R3_pmt', 'R4_exposure', 'R5_pmt_exposure'];
  const OBJECTIVES = {
    P1: { idx: 0, label: 'Poverty gap', unit: '×100', better: 'lower', benchmark: 'B1_perfect_gap',
      help: 'Average shortfall below the poverty line, person-weighted, after the shock and the transfer.' },
    P2: { idx: 1, label: 'Squared poverty gap (FGT2)', unit: '×100', better: 'lower', benchmark: 'B1_perfect_gap',
      help: 'Like the poverty gap, but shortfalls of the poorest count more.' },
    loss_comp: { idx: 2, label: 'Losses of poor households compensated', unit: '%', better: 'higher', benchmark: 'B3_perfect_loss_initpoor',
      help: 'Share of the value of shock losses borne by initially poor households that transfers offset.' }
  };
  const PARAM_INFO = {
    pi: { label: 'Retail grain price rise', fmt: v => `+${Math.round(v * 100)}%` },
    lambda: { label: 'Farm-gate pass-through', fmt: v => `${Math.round(v * 100)}% of retail` },
    theta: { label: 'Flour price pass-through', fmt: v => `${Math.round(v * 100)}% of grain` },
    eps: { label: 'Demand response (elasticity)', fmt: v => (v === 0 ? 'None (first order)' : String(v)) },
    kappa: { label: 'Budget (share of losses)', fmt: v => `${Math.round(v * 100)}% of aggregate losses` },
    green: { label: 'Green maize', fmt: v => (v === 'TRUE' ? 'Included' : 'Excluded') },
    annual: { label: 'Purchase annualisation', fmt: v => (v === 'x52' ? '7-day × 52' : 'Seasonally normalised') }
  };
  const PARAM_ORDER = ['pi', 'lambda', 'theta', 'eps', 'kappa', 'green', 'annual'];

  const num = v => (typeof v === 'string' && v !== 'TRUE' && v !== 'FALSE' && v !== 'x52' && v !== 'seasonal') ? Number(v) : v;
  // Must match build.py key(): numbers in shortest form (Python's :g)
  const g = v => (typeof v === 'number' ? String(+v.toPrecision(6)) : String(v));
  function scenarioKey(sel) { return PARAM_ORDER.map(p => g(num(sel[p]))).join('|'); }

  // Only exact validated combinations are allowed; anything else is rejected, never interpolated.
  function isValidated(data, sel) {
    return PARAM_ORDER.every(p => data.params[p].map(String).includes(String(num(sel[p])))) &&
      Object.prototype.hasOwnProperty.call(data.grid, scenarioKey(sel));
  }

  function value(data, key, rule, obj) { return data.grid[key].rules[rule][OBJECTIVES[obj].idx]; }

  // Derived ratio: (no transfer - rule) / (no transfer - perfect-information benchmark)
  function shareAttainable(data, key, rule, obj) {
    const none = value(data, key, 'R0_none', obj), bench = value(data, key, OBJECTIVES[obj].benchmark, obj);
    const v = value(data, key, rule, obj);
    return (none - v) / (none - bench);
  }

  function bestImplementable(data, key, obj) {
    const sign = OBJECTIVES[obj].better === 'lower' ? 1 : -1;
    return IMPLEMENTABLE.reduce((best, r) => (sign * value(data, key, r, obj) < sign * value(data, key, best, obj) ? r : best));
  }

  function fmtValue(obj, v) { return v == null ? '–' : obj === 'loss_comp' ? `${(v * 100).toFixed(1)}%` : v.toFixed(2); }
  function fmtDiff(obj, v) {
    if (v == null) return '–';
    const s = obj === 'loss_comp' ? (v * 100).toFixed(2) : v.toFixed(3);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + s.replace('-', '') + (obj === 'loss_comp' ? ' pp' : '');
  }
  function pct(v, d = 0) { return v == null ? '–' : `${(v * 100).toFixed(d)}%`; }

  root.MaizeCore = { RULE_INFO, IMPLEMENTABLE, OBJECTIVES, PARAM_INFO, PARAM_ORDER, scenarioKey, isValidated,
    value, shareAttainable, bestImplementable, fmtValue, fmtDiff, pct };
})(typeof window !== 'undefined' ? window : globalThis);
