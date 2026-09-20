export function validate(input) {
  const sectorCode = /^[A-Z0-9]{3}_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;
  if (input?.schema !== 1 || !Number.isInteger(input.year) || !sectorCode.test(input.buyer || '') ||
      !Array.isArray(input.links) || !input.links.length || !input.sources?.icio || !input.sources?.emissions ||
      !Number.isInteger(input.unmatched_count)) throw new Error('Case needs a year, buyer, sources, unmatched count and links.');
  for (const row of input.links) {
    if (!sectorCode.test(row.supplier || '') ||
        row.supplier !== `${row.country}_${row.industry}` ||
        ['direct_input_usd_m','producer_output_usd_m','producer_va_usd_m','producer_direct_ghg_t','allocated_direct_ghg_t','allocated_va_usd_m']
          .some(k => !Number.isFinite(row[k]) || row[k] < 0) ||
        row.producer_output_usd_m <= 0 ||
        row.direct_input_usd_m > row.producer_output_usd_m * 1.01 ||
        Math.abs(row.allocated_direct_ghg_t - row.producer_direct_ghg_t * row.direct_input_usd_m / row.producer_output_usd_m) > .01 ||
        Math.abs(row.allocated_va_usd_m - row.producer_va_usd_m * row.direct_input_usd_m / row.producer_output_usd_m) > .01)
      throw new Error(`Accounting mismatch in supplier ${row.supplier || '?'}.`);
  }
  if (input.coverage) {
    const c = input.coverage;
    if (!Number.isFinite(c.foreign_input_usd_m) || c.foreign_input_usd_m <= 0 ||
        !Number.isFinite(c.matched_input_usd_m) || !Number.isFinite(c.unmatched_input_usd_m) ||
        !Number.isFinite(c.input_value_share) || c.input_value_share < 0 || c.input_value_share > 1 ||
        c.matched_link_count !== input.links.length ||
        c.foreign_link_count !== input.links.length + input.unmatched_count ||
        Math.abs(c.matched_input_usd_m + c.unmatched_input_usd_m - c.foreign_input_usd_m) > .01 ||
        Math.abs(c.matched_input_usd_m / c.foreign_input_usd_m - c.input_value_share) > 1e-6)
      throw new Error('Foreign input coverage does not reconcile.');
  }
  return input;
}

export function scenario(link, reduction, costPerTonne, buyerShare) {
  const investment = link.allocated_direct_ghg_t * reduction / 100 * costPerTonne / 1e6;
  return {investment, buyer:investment*buyerShare/100, supplier:investment*(1-buyerShare/100)};
}

export function minimumBuyerShare(link, investmentUsdM, ceilingPercent) {
  if (investmentUsdM === 0) return 0;
  if (link.allocated_va_usd_m === 0) return 100;
  return Math.max(0, Math.min(100, 100 * (1 - link.allocated_va_usd_m * ceilingPercent / 100 / investmentUsdM)));
}
