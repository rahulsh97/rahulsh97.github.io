// Green Supplier Finance Lab — pure, framework-free logic shared by the app and
// the Node test suite. No DOM here. Concept, research design and interpretation:
// Rahul Shukla. Engineering assistance: OpenAI Codex and Anthropic Claude Code.

export const MEASURES = {
  emissions: { key: 'ghg', label: 'allocated direct emissions' },
  flow: { key: 'input', label: 'intermediate-input value' },
  va: { key: 'va', label: 'allocated value added' },
};

// --- gzip detection + decode (browser + modern Node) --------------------------
export function isGzip(bytes) {
  return bytes && bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

// Detect whether the response is actually gzip-compressed before decompressing;
// fall back to reading it as plain UTF-8 JSON when it is not.
export async function decodeCaseBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let text;
  if (isGzip(bytes)) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('gzip case received but DecompressionStream is unavailable');
    }
    const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  return JSON.parse(text);
}

// --- selection normalisation --------------------------------------------------
// Coerce (economy, industry) to a legal published buyer for this manifest.
export function normalizeSelection(manifest, economy, industry, preferred = 'DEU_C29') {
  const cases = manifest.cases || {};
  const economies = Object.keys(cases);
  if (!economies.length) return { economy: null, industry: null };
  const prefEco = preferred.split('_', 1)[0];
  const prefInd = preferred.slice(prefEco.length + 1);
  if (!economies.includes(economy)) {
    economy = economies.includes(prefEco) ? prefEco : economies.slice().sort()[0];
  }
  const inds = cases[economy] || [];
  if (!inds.includes(industry)) {
    industry = inds.includes(prefInd) ? prefInd : inds[0];
  }
  return { economy, industry, code: `${economy}_${industry}` };
}

// --- link access over the columnar case format --------------------------------
export function linkCount(caseData) {
  return caseData.links.country.length;
}

export function linkAt(caseData, i) {
  const L = caseData.links;
  return {
    country: L.country[i], industry: L.industry[i],
    code: `${L.country[i]}_${L.industry[i]}`,
    input: L.input_usd_m[i], ghg: L.alloc_ghg_t[i], va: L.alloc_va_usd_m[i],
  };
}

// Filter matched links by supplier economy ('' = all foreign) and rank by measure.
export function filterRank(caseData, supplierEconomy, measure) {
  const key = (MEASURES[measure] || MEASURES.emissions).key;
  const out = [];
  const n = linkCount(caseData);
  for (let i = 0; i < n; i++) {
    if (supplierEconomy && caseData.links.country[i] !== supplierEconomy) continue;
    out.push(linkAt(caseData, i));
  }
  out.sort((a, b) => b[key] - a[key]);
  return out;
}

export function sum(links, key) {
  let s = 0;
  for (const l of links) s += l[key];
  return s;
}

// Supplier economies present among matched links, sorted.
export function supplierEconomies(caseData) {
  return [...new Set(caseData.links.country)].sort();
}

// --- scenario arithmetic (hypothetical financing) -----------------------------
export function scenario(link, reductionPct, costPerTonne, buyerSharePct) {
  const investment = link.ghg * (reductionPct / 100) * costPerTonne / 1e6; // USD million
  return {
    investment,
    buyer: investment * buyerSharePct / 100,
    supplier: investment * (1 - buyerSharePct / 100),
  };
}

// Minimum buyer-funded share so the supplier's cost stays within the diagnostic
// ceiling (share of allocated annual VA). Undefined when there is no investment.
export function minimumBuyerShare(link, investmentUsdM, ceilingPct) {
  if (!(investmentUsdM > 0)) return null;
  if (!(link.va > 0)) return 100;
  const share = 100 * (1 - link.va * (ceilingPct / 100) / investmentUsdM);
  return Math.max(0, Math.min(100, share));
}

// --- coverage identity --------------------------------------------------------
export function coverageReconciles(totals, tol = 0.01) {
  const t = totals;
  return Boolean(
    Number.isFinite(t.foreign_input_usd_m) && t.foreign_input_usd_m > 0 &&
    Number.isFinite(t.matched_input_usd_m) && Number.isFinite(t.unmatched_input_usd_m) &&
    Math.abs(t.matched_input_usd_m + t.unmatched_input_usd_m - t.foreign_input_usd_m) <= tol &&
    Math.abs(t.matched_input_usd_m / t.foreign_input_usd_m - t.input_value_share) <= 1e-6 &&
    Number.isInteger(t.matched_link_count) && t.matched_link_count >= 0);
}

// --- number formatting --------------------------------------------------------
// Input is USD million. Never render a positive value as "$0m"; drop to dollars
// or thousands below USD 0.1m; one decimal for millions. Distinguish true zero,
// rounded-positive, and missing (null/NaN -> em dash).
export function formatMoney(usdMillion) {
  if (usdMillion === null || usdMillion === undefined || Number.isNaN(usdMillion)) return '—';
  const v = usdMillion;
  if (v === 0) return '$0';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a < 0.1) {
    const dollars = a * 1e6;
    if (dollars < 1000) return `${sign}$${Math.round(dollars).toLocaleString('en')}`;
    return `${sign}$${(dollars / 1000).toFixed(dollars < 10000 ? 1 : 0)}k`;
  }
  if (a < 1000) return `${sign}$${a.toFixed(1)}m`;
  if (a < 1e6) return `${sign}$${(a / 1000).toFixed(1)}bn`;
  return `${sign}$${(a / 1e6).toFixed(1)}tn`;
}

export function formatMoneyPrecise(usdMillion) {
  if (usdMillion === null || usdMillion === undefined || Number.isNaN(usdMillion)) return 'no data';
  return `USD ${usdMillion.toLocaleString('en', { maximumFractionDigits: 4 })} million`;
}

export function formatTonnes(t) {
  if (t === null || t === undefined || Number.isNaN(t)) return '—';
  if (t === 0) return '0 t';
  const a = Math.abs(t);
  if (a >= 1e6) return `${(t / 1e6).toFixed(2)} Mt`;
  if (a >= 1e3) return `${(t / 1e3).toFixed(1)} kt`;
  return `${Math.round(t).toLocaleString('en')} t`;
}

export function formatTonnesPrecise(t) {
  if (t === null || t === undefined || Number.isNaN(t)) return 'no data';
  return `${t.toLocaleString('en', { maximumFractionDigits: 1 })} t CO2e`;
}

export function pct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

// --- dynamic policy narrative (computed from values, no language model) --------
export function buildNarrative(ctx) {
  const {
    countryName, industryName, buyerCode, supplierScope,
    matchedInput, usableLinks,
    topEmit, topInput, topVa, top5EmitShare,
    reduction, cost, investment, buyerAmount, supplierAmount, buyerShare,
    ceiling, countAbove, shareAbove, mostExposed, minShareMostExposed,
  } = ctx;

  const paras = [];
  paras.push({
    heading: 'The relationship',
    text: `In 2022, ${countryName}'s ${industryName.toLowerCase()} sector (${buyerCode}) drew `
      + `${formatMoney(matchedInput)} of matched intermediate inputs from ${supplierScope.toLowerCase()}, `
      + `across ${usableLinks.toLocaleString('en')} usable supplier-sector link${usableLinks === 1 ? '' : 's'} `
      + `for which published production emissions and value added could be attached.`,
  });

  if (usableLinks === 0) {
    paras.push({ heading: 'Where exposure is concentrated', text:
      `No usable supplier-sector links remain under the current filter, so there is nothing to rank.` });
  } else {
    let t = `The largest allocated-emissions link is ${topEmit.name} (${topEmit.code}), `
      + `at ${formatTonnes(topEmit.ghg)}. `;
    if (topInput.code !== topEmit.code) {
      t += `The largest matched-input link is ${topInput.name} (${topInput.code}) at ${formatMoney(topInput.input)}. `;
    } else {
      t += `The same link also carries the most matched input value (${formatMoney(topInput.input)}). `;
    }
    t += `The largest allocated value-added link is ${topVa.name} (${topVa.code}) at ${formatMoney(topVa.va)}. `;
    if (Number.isFinite(top5EmitShare)) {
      t += `The top five emissions-linked sectors account for ${pct(top5EmitShare)} of allocated emissions in this view.`;
    }
    paras.push({ heading: 'Where exposure is concentrated', text: t });
  }

  paras.push({
    heading: 'The financing scenario',
    text: `Under a hypothetical ${reduction}% emissions-reduction target at an assumed `
      + `$${cost}/tonne avoided, the modelled one-off investment across the shown links is `
      + `${formatMoney(investment)}. At a ${buyerShare}% buyer-funded split, the buyer would `
      + `hypothetically cover ${formatMoney(buyerAmount)} and suppliers ${formatMoney(supplierAmount)}. `
      + `These financing figures are assumptions, not observed contracts or lending.`,
  });

  if (usableLinks === 0 || !(investment > 0)) {
    paras.push({ heading: 'The diagnostic', text:
      `With no modelled investment (target or cost at zero, or no links), the affordability diagnostic is inactive.` });
  } else {
    let t = `At a diagnostic ceiling of ${ceiling}% of allocated annual value added, `
      + `${countAbove.toLocaleString('en')} of ${usableLinks.toLocaleString('en')} links `
      + `(${pct(shareAbove)}) would exceed the ceiling at the current buyer share. `;
    if (mostExposed) {
      const ratioTxt = Number.isFinite(mostExposed.burdenOverVa)
        ? `a supplier burden of ${pct(mostExposed.burdenOverVa)} of its allocated value added`
        : `a modelled supplier cost that exceeds its near-zero allocated value added`;
      t += `The most exposed link is ${mostExposed.name} (${mostExposed.code}), with ${ratioTxt}`;
      t += (minShareMostExposed === null)
        ? `.`
        : `; holding it within the ceiling would require a buyer-funded share of at least ${minShareMostExposed.toFixed(0)}%.`;
    }
    paras.push({ heading: 'The diagnostic', text: t });
  }

  paras.push({
    heading: 'How to interpret it',
    text: `This screens which supplier-sector links look most exposed and where buyer support would `
      + `move the burden most. It identifies links for further investigation. It does not demonstrate `
      + `firm-level distress, an actual financing need, or any causal impact of buyer requests on suppliers.`,
  });
  return paras;
}
