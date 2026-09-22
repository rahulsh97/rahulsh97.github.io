import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import {
  MEASURES, isGzip, decodeCaseBuffer, normalizeSelection, filterRank, sum,
  supplierEconomies, scenario, minimumBuyerShare, coverageReconciles, buildNarrative,
  attachUpstream, upstreamTotals, rankingsDiffer,
  formatMoney, formatTonnes, pct,
} from '../core.js';

const CASE = {
  schema: 2, year: 2022, buyer: 'DEU_C29', country: 'DEU', industry: 'C29',
  totals: {
    foreign_input_usd_m: 100, matched_input_usd_m: 80, unmatched_input_usd_m: 20,
    input_value_share: 0.8, matched_link_count: 3, excluded_link_count: 1,
    allocated_ghg_t: 30000, allocated_va_usd_m: 60, excluded_reasons: { missing_ghg: 1 },
  },
  links: {
    country: ['CHN', 'FRA', 'CHN'], industry: ['C20', 'C29', 'C24A'],
    input_usd_m: [50, 20, 10], alloc_ghg_t: [20000, 7000, 3000], alloc_va_usd_m: [30, 20, 0],
  },
  excluded: { country: ['IND'], industry: ['C24A'], input_usd_m: [20], reason: ['missing_ghg'] },
};
const MANIFEST = {
  cases: { DEU: ['C20', 'C29'], IND: ['C10T12', 'C29'] },
  countries: { DEU: 'Germany', IND: 'India' },
  industries: { C20: 'Chemicals', C29: 'Motor vehicles', C10T12: 'Food' },
  isic: {},
};

test('gzip detection distinguishes gzip from plain JSON', () => {
  const gz = new Uint8Array(gzipSync(Buffer.from('{}')));
  assert.equal(isGzip(gz), true);
  assert.equal(isGzip(new Uint8Array([0x7b, 0x7d])), false);
});

test('decodeCaseBuffer inflates gzip and falls back to plain JSON', async () => {
  const json = JSON.stringify(CASE);
  const fromGz = await decodeCaseBuffer(gzipSync(Buffer.from(json)));
  assert.equal(fromGz.buyer, 'DEU_C29');
  const fromPlain = await decodeCaseBuffer(new TextEncoder().encode(json).buffer);
  assert.equal(fromPlain.buyer, 'DEU_C29');
  assert.equal(fromPlain.links.country.length, 3);
});

test('normalizeSelection coerces illegal economy/industry to a legal buyer', () => {
  assert.deepEqual(normalizeSelection(MANIFEST, 'DEU', 'C20'), { economy: 'DEU', industry: 'C20', code: 'DEU_C20' });
  // illegal industry for economy -> preferred if available, else first
  assert.equal(normalizeSelection(MANIFEST, 'IND', 'C20').industry, 'C29'); // C20 not in IND, prefers C29
  // illegal economy -> preferred economy's default
  assert.equal(normalizeSelection(MANIFEST, 'ZZZ', 'C29').economy, 'DEU');
  // garbage -> still legal
  const g = normalizeSelection(MANIFEST, null, null);
  assert.ok(MANIFEST.cases[g.economy].includes(g.industry));
});

test('filterRank filters by supplier economy and ranks by measure', () => {
  const all = filterRank(CASE, '', 'emissions');
  assert.equal(all.length, 3);
  assert.deepEqual(all.map(l => l.ghg), [20000, 7000, 3000]); // desc
  const byFlow = filterRank(CASE, '', 'flow');
  assert.deepEqual(byFlow.map(l => l.input), [50, 20, 10]);
  const chn = filterRank(CASE, 'CHN', 'emissions');
  assert.equal(chn.length, 2);
  assert.ok(chn.every(l => l.country === 'CHN'));
});

test('aggregation for a supplier filter, coverage stays a full-case total', () => {
  const chn = filterRank(CASE, 'CHN', 'emissions');
  assert.equal(sum(chn, 'input'), 60);        // 50 + 10, changes with filter
  assert.equal(CASE.totals.input_value_share, 0.8); // coverage is full-case, untouched
  assert.deepEqual(supplierEconomies(CASE), ['CHN', 'FRA']);
});

test('scenario and reverse buyer-share arithmetic', () => {
  const link = { ghg: 20000, va: 30, input: 50 };
  const s = scenario(link, 20, 100, 50); // 20000 * .2 * 100 / 1e6 = 0.4 USD m
  assert.ok(Math.abs(s.investment - 0.4) < 1e-9);
  assert.ok(Math.abs(s.buyer - 0.2) < 1e-9);
  assert.ok(Math.abs(s.supplier - 0.2) < 1e-9);
  // minimum buyer share so supplier cost <= ceiling% of VA
  const need = minimumBuyerShare(link, s.investment, 5); // ceiling 5% of 30 = 1.5 >= 0.4 -> 0%
  assert.equal(need, 0);
  const tight = minimumBuyerShare({ va: 1 }, 10, 5); // 100*(1 - 1*0.05/10) = 99.5
  assert.ok(Math.abs(tight - 99.5) < 1e-9);
  assert.equal(minimumBuyerShare({ va: 0 }, 10, 5), 100); // zero VA -> 100%
  assert.equal(minimumBuyerShare({ va: 30 }, 0, 5), null); // no investment -> undefined
});

test('coverage identity check', () => {
  assert.equal(coverageReconciles(CASE.totals), true);
  const bad = { ...CASE.totals, matched_input_usd_m: 70 };
  assert.equal(coverageReconciles(bad), false);
});

test('formatMoney: never $0m for positive; dollars/thousands below 0.1m; true zero; missing', () => {
  assert.equal(formatMoney(0), '$0');
  assert.equal(formatMoney(null), '—');
  assert.equal(formatMoney(NaN), '—');
  assert.equal(formatMoney(1234.5), '$1.2bn');   // 1234.5 m
  assert.equal(formatMoney(2.0), '$2.0m');
  assert.equal(formatMoney(0.045), '$45k');       // 0.045 m = $45,000
  assert.equal(formatMoney(0.0004), '$400');      // $400
  // a small positive must never render as $0m
  assert.notEqual(formatMoney(0.00005), '$0m');
  assert.ok(formatMoney(0.00005).startsWith('$'));
});

test('formatTonnes and pct', () => {
  assert.equal(formatTonnes(4144978.8), '4.14 Mt');
  assert.equal(formatTonnes(196432), '196.4 kt');
  assert.equal(formatTonnes(0), '0 t');
  assert.equal(formatTonnes(null), '—');
  assert.equal(pct(0.868), '86.8%');
});

function narrCtx(over = {}) {
  return {
    countryName: 'Germany', industryName: 'Motor vehicles', buyerCode: 'DEU_C29',
    supplierScope: 'All foreign supplier economies', matchedInput: 80, usableLinks: 3,
    topEmit: { name: 'China · Chemicals', code: 'CHN_C20', ghg: 20000 },
    topInput: { name: 'China · Chemicals', code: 'CHN_C20', input: 50 },
    topVa: { name: 'China · Chemicals', code: 'CHN_C20', va: 30 },
    top5EmitShare: 0.9, reduction: 20, cost: 100, investment: 0.4,
    buyerAmount: 0.2, supplierAmount: 0.2, buyerShare: 50, ceiling: 5,
    countAbove: 1, shareAbove: 1 / 3,
    mostExposed: { name: 'India · Steel', code: 'IND_C24A', burdenOverVa: 0.42 },
    minShareMostExposed: 60, ...over,
  };
}

test('buildNarrative produces five paragraphs and reacts to control values', () => {
  const a = buildNarrative(narrCtx());
  assert.equal(a.length, 5);
  assert.deepEqual(a.map(p => p.heading),
    ['The relationship', 'Where exposure is concentrated', 'The financing scenario', 'The diagnostic', 'How to interpret it']);
  const b = buildNarrative(narrCtx({ reduction: 40, investment: 0.8, buyerAmount: 0.4, supplierAmount: 0.4 }));
  assert.notEqual(a[2].text, b[2].text);              // financing paragraph changes with the slider
  assert.ok(b[2].text.includes('40%'));
  // interpretation always disclaims causal / distress claims
  assert.ok(/not demonstrate firm-level distress|does not demonstrate/.test(a[4].text));
  assert.ok(/causal/.test(a[4].text));
});

// ---- upstream multiplier ----------------------------------------------------
const MULT = { CHN_C20: [385.5, 1400], FRA_C29: [90, 300] }; // [g, m] t/USDm; CHN_C24A absent

function upLinks() {
  return [
    { code: 'CHN_C20', country: 'CHN', industry: 'C20', input: 50, ghg: 19275, va: 30 }, // g*z=19275
    { code: 'FRA_C29', country: 'FRA', industry: 'C29', input: 20, ghg: 1800, va: 20 },
    { code: 'CHN_C24A', country: 'CHN', industry: 'C24A', input: 10, ghg: 500, va: 5 }, // no multiplier
  ];
}

test('attachUpstream: all-tier = m*z, deeper = all-tier - direct, visibility in [0,1]; missing stays null', () => {
  const links = attachUpstream(upLinks(), MULT);
  const a = links[0];
  assert.ok(Math.abs(a.allTier - 1400 * 50) < 1e-6);       // 70000
  assert.ok(Math.abs(a.deeper - (70000 - 19275)) < 1e-6);  // 50725
  assert.ok(a.visibility > 0 && a.visibility <= 1);
  assert.ok(Math.abs(a.visibility - 19275 / 70000) < 1e-9);
  // missing multiplier -> null, never zero
  const c = links[2];
  assert.equal(c.hasMult, false);
  assert.equal(c.allTier, null); assert.equal(c.deeper, null); assert.equal(c.visibility, null);
});

test('upstreamTotals: direct + deeper == all-tier; missing counted; visibility bounded', () => {
  const links = attachUpstream(upLinks(), MULT);
  const t = upstreamTotals(links);
  assert.ok(Math.abs(t.direct + t.deeper - t.all) < 1e-6);
  assert.equal(t.missing, 1); assert.equal(t.covered, 2);
  assert.ok(t.visibility > 0 && t.visibility <= 1);
  assert.ok(t.deeper >= 0);
});

test('rankingsDiffer: direct vs all-tier leaders', () => {
  const links = attachUpstream(upLinks(), MULT);
  // direct leader CHN_C20 (19275) ; all-tier leader CHN_C20 (70000) -> same
  assert.equal(rankingsDiffer(links), false);
  const links2 = attachUpstream(upLinks(), { CHN_C20: [385.5, 500], FRA_C29: [90, 5000] });
  // now all-tier leader is FRA_C29 (100000) vs direct leader CHN_C20 -> differ
  assert.equal(rankingsDiffer(links2), true);
});

test('financing is independent of the exposure basis (uses direct emissions only)', () => {
  const links = attachUpstream(upLinks(), MULT);
  // scenario must depend on ghg (direct), not allTier
  const s = scenario(links[0], 20, 100, 50);
  assert.ok(Math.abs(s.investment - links[0].ghg * 0.2 * 100 / 1e6) < 1e-12);
  // mutating allTier does not change the financing result
  const before = scenario(links[0], 30, 120, 40).investment;
  links[0].allTier = 999999;
  const after = scenario(links[0], 30, 120, 40).investment;
  assert.equal(before, after);
});

test('buildNarrative gains a Visible-vs-hidden-upstream paragraph from the multiplier', () => {
  const base = narrCtx();
  const withUp = buildNarrative(narrCtx({ upstream: {
    visibility: 0.124, rankingsDiffer: true,
    topAllTier: { name: 'China · Electrical equipment', code: 'CHN_C27', allTier: 2.07e6 },
  }}));
  assert.ok(withUp.some(p => p.heading === 'Visible vs hidden upstream'));
  const up = withUp.find(p => p.heading === 'Visible vs hidden upstream');
  assert.ok(up.text.includes('12.4%') && /deeper|hidden|upstream/i.test(up.text));
  assert.ok(/differs from ranking by all-tier/.test(up.text));
  assert.equal(buildNarrative(base).some(p => p.heading === 'Visible vs hidden upstream'), false);
});

test('buildNarrative handles empty filter and non-finite burden ratio', () => {
  const empty = buildNarrative(narrCtx({ usableLinks: 0, topEmit: null, topInput: null, topVa: null, investment: 0 }));
  assert.equal(empty.length, 5);
  assert.ok(empty[1].text.includes('No usable supplier-sector links'));
  const inf = buildNarrative(narrCtx({ mostExposed: { name: 'X · Y', code: 'X_Y', burdenOverVa: Infinity } }));
  assert.ok(inf[3].text.includes('near-zero allocated value added'));
});
