'use strict';
// Dependency-free SVG chart builders. Each returns an HTML string; empty input returns a helpful empty state.
(function (root) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fmt = (x, d = 1) => x == null || !isFinite(x) ? '—' : Number(x).toLocaleString('en-GB', {maximumFractionDigits: d, minimumFractionDigits: 0});
  const C = {ink: '#16263a', teal: '#0b6e74', tealSoft: '#9ccfcf', amber: '#b4691f', red: '#a33a3a', grid: '#e6ecef', mute: '#5d6f7c'};
  const empty = msg => `<div class="empty"><strong>Nothing to plot here.</strong><span>${esc(msg)}</span></div>`;
  // Draw narrower on phones so text stays legible when the SVG is scaled to the screen width.
  const NARROW = () => typeof window !== 'undefined' && window.innerWidth < 720;
  const BW = () => NARROW() ? 400 : 640;
  const niceMax = v => { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p * 2) / 2 * p; };

  // Horizontal ranked bars. items: [{label, value, lo, hi, note, highlight}]
  function bars(items, o = {}) {
    const xs = items.filter(i => i.value != null && isFinite(i.value));
    if (!xs.length) return empty(o.emptyMsg || 'No values for this selection.');
    if (o.sort !== false) xs.sort((a, b) => b.value - a.value);
    const W = BW(), L = NARROW() ? 128 : (o.labelWidth || 170), R = NARROW() ? 44 : 64, rowH = 20, T = 8, H = T + xs.length * rowH + 26;
    const max = o.max ?? niceMax(Math.max(...xs.map(i => Math.max(i.value, i.hi ?? -Infinity))));
    const X = v => L + (W - L - R) * Math.max(0, v) / max;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Bar chart')}">`;
    for (let t = 0; t <= 4; t++) { const v = max * t / 4; s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - 22}" stroke="${C.grid}"/><text x="${X(v)}" y="${H - 8}" text-anchor="middle" class="ax">${fmt(v, max < 10 ? 1 : 0)}</text>`; }
    xs.forEach((i, k) => {
      const y = T + k * rowH;
      s += `<text x="${L - 8}" y="${y + 14}" text-anchor="end" class="lab">${esc(String(i.label).length > (NARROW() ? 18 : 26) ? String(i.label).slice(0, NARROW() ? 17 : 25) + '…' : i.label)}</text>`;
      s += `<rect x="${L}" y="${y + 4}" width="${Math.max(0, X(i.value) - L)}" height="${rowH - 7}" rx="2" fill="${i.highlight ? C.amber : (o.color || C.teal)}"><title>${esc(i.label)}: ${fmt(i.value, 2)}${o.unit ? ' ' + esc(o.unit) : ''}${i.lo != null ? ` (95% interval ${fmt(i.lo, 1)}–${fmt(i.hi, 1)})` : ''}${i.note ? ' — ' + esc(i.note) : ''}</title></rect>`;
      if (i.lo != null && i.hi != null) s += `<line x1="${X(i.lo)}" x2="${X(i.hi)}" y1="${y + 10.5}" y2="${y + 10.5}" stroke="${C.ink}" stroke-width="1.2"/>`;
      s += `<text x="${Math.max(X(i.value), X(i.hi ?? 0)) + 5}" y="${y + 14}" class="val">${fmt(i.value, o.digits ?? 1)}</text>`;
    });
    return s + '</svg>';
  }

  // Paired bars: two shares per item (e.g. share of poor people vs share of spending)
  function paired(items, o = {}) {
    const xs = items.filter(i => i.a != null && i.b != null);
    if (!xs.length) return empty(o.emptyMsg || 'No values.');
    xs.sort((p, q) => q.a - p.a);
    const W = BW(), L = NARROW() ? 118 : 150, R = NARROW() ? 70 : 60, rowH = 26, T = 28, H = T + xs.length * rowH + 24;
    const max = o.max ?? niceMax(Math.max(...xs.flatMap(i => [i.a, i.b])));
    const X = v => L + (W - L - R) * v / max;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || '')}">`;
    const lx = NARROW() ? 4 : L, gap = NARROW() ? 180 : 230;
    s += `<rect x="${lx}" y="6" width="12" height="10" fill="${C.teal}"/><text x="${lx + 16}" y="15" class="lab">${esc(o.aLabel)}</text><rect x="${lx + gap}" y="6" width="12" height="10" fill="${C.amber}"/><text x="${lx + gap + 16}" y="15" class="lab">${esc(o.bLabel)}</text>`;
    xs.forEach((i, k) => {
      const y = T + k * rowH;
      s += `<text x="${L - 8}" y="${y + 15}" text-anchor="end" class="lab">${esc(i.label)}</text>`;
      s += `<rect x="${L}" y="${y + 3}" width="${X(i.a) - L}" height="9" fill="${C.teal}"><title>${esc(i.label)} — ${esc(o.aLabel)}: ${fmt(i.a * 100, 1)}%</title></rect>`;
      s += `<rect x="${L}" y="${y + 13}" width="${X(i.b) - L}" height="9" fill="${C.amber}"><title>${esc(i.label)} — ${esc(o.bLabel)}: ${fmt(i.b * 100, 1)}%</title></rect>`;
      s += `<text x="${Math.max(X(i.a), X(i.b)) + 5}" y="${y + 17}" class="val">${fmt(i.a * 100, 1)} / ${fmt(i.b * 100, 1)}</text>`;
    });
    for (let t = 0; t <= 4; t++) { const v = max * t / 4; s += `<text x="${X(v)}" y="${H - 6}" text-anchor="middle" class="ax">${fmt(v * 100, max < 0.1 ? 1 : 0)}%</text>`; }
    return s + '</svg>';
  }

  // Line chart. series: [{name, points: [[x, y, lo, hi, status]], color, dashed}]
  function line(series, o = {}) {
    const pts = series.flatMap(s => s.points).filter(p => p[1] != null);
    if (!pts.length) return empty(o.emptyMsg || 'No time series for this indicator.');
    const W = BW(), H = NARROW() ? 230 : 250, L = 46, R = 12, T = 14, B = 32;
    let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])); if (x0 === x1) { x0 -= 1; x1 += 1; }
    const ys = pts.flatMap(p => [p[1], p[2], p[3]]).filter(v => v != null);
    const y0 = o.zero === false ? Math.min(...ys) : Math.min(0, ...ys), y1 = niceMax(Math.max(...ys)) || 1;
    const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Line chart')}">`;
    for (let t = 0; t <= 4; t++) { const v = y0 + (y1 - y0) * t / 4; s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" class="ax">${fmt(v, 1)}</text>`; }
    const step = Math.max(1, Math.round((x1 - x0) / 6));
    for (let x = Math.ceil(x0); x <= x1; x += step) s += `<text x="${X(x)}" y="${H - 10}" text-anchor="middle" class="ax">${x}</text>`;
    series.forEach((ser, k) => {
      const col = ser.color || [C.teal, C.amber, C.red, C.ink][k % 4];
      const P = ser.points.filter(p => p[1] != null).sort((a, b) => a[0] - b[0]);
      P.filter(p => p[2] != null && p[3] != null).forEach(p => s += `<line x1="${X(p[0])}" x2="${X(p[0])}" y1="${Y(p[2])}" y2="${Y(p[3])}" stroke="${col}" stroke-width="3" opacity=".3"/>`);
      // Lines join only points known to be comparable: ser.connect === false → points only;
      // ser.groupBy → break the line whenever the comparability group (p[5]) changes or is unknown.
      const segs = [];
      if (ser.connect !== false) P.forEach((p, i) => {
        const same = i > 0 && (!ser.groupBy || (p[5] != null && p[5] === P[i - 1][5]));
        if (same) segs[segs.length - 1].push(p); else segs.push([p]);
      });
      segs.filter(g => g.length > 1).forEach(g => s += `<path d="${g.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="${col}" stroke-width="2"${ser.dashed ? ' stroke-dasharray="5 4"' : ''}/>`);
      P.forEach(p => s += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${ser.connect === false || ser.groupBy ? 4 : 3.2}" fill="${p[4] === 'p' ? '#fff' : col}" stroke="${col}"><title>${esc(ser.name)} ${p[0]}: ${fmt(p[1], 2)}${p[4] === 'p' ? ' (projection)' : ''}${p[6] ? ' — ' + esc(p[6]) : ''}</title></circle>`);
      if (ser.labels) P.forEach(p => { if (p[6]) s += `<text x="${X(p[0])}" y="${Y(p[1]) - 8}" text-anchor="middle" class="ax">${esc(p[6])}</text>`; });
    });
    s += '</svg>';
    if (series.length > 1) s += `<div class="legend">${series.map((ser, k) => `<span><i style="background:${ser.color || [C.teal, C.amber, C.red, C.ink][k % 4]}"></i>${esc(ser.name)}</span>`).join('')}</div>`;
    return s;
  }

  // Scatter. points: [{x, y, label, size}]
  function scatter(points, o = {}) {
    const P = points.filter(p => isFinite(p.x) && isFinite(p.y));
    if (P.length < 2) return empty(o.emptyMsg || 'Not enough areas to plot.');
    const W = BW(), H = NARROW() ? 300 : 330, L = 58, R = 14, T = 14, B = 44;
    const x1 = niceMax(Math.max(...P.map(p => p.x))), y1 = niceMax(Math.max(...P.map(p => p.y)));
    const X = x => L + x / x1 * (W - L - R), Y = y => T + (1 - y / y1) * (H - T - B);
    const smax = Math.max(...P.map(p => p.size || 1));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Scatter plot')}">`;
    for (let t = 0; t <= 4; t++) {
      s += `<line x1="${L}" x2="${W - R}" y1="${Y(y1 * t / 4)}" y2="${Y(y1 * t / 4)}" stroke="${C.grid}"/><text x="${L - 6}" y="${Y(y1 * t / 4) + 4}" text-anchor="end" class="ax">${fmt(y1 * t / 4, 0)}</text>`;
      s += `<text x="${X(x1 * t / 4)}" y="${H - 24}" text-anchor="middle" class="ax">${fmt(x1 * t / 4, 0)}</text>`;
    }
    s += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="lab">${esc(o.xLabel || '')}</text><text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="lab">${esc(o.yLabel || '')}</text>`;
    P.forEach(p => {
      const r = 4 + 10 * Math.sqrt((p.size || 1) / smax);
      s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${r.toFixed(1)}" fill="${C.teal}" fill-opacity=".55" stroke="${C.teal}"><title>${esc(p.label)}: ${esc(o.xLabel)} ${fmt(p.x, 1)}; ${esc(o.yLabel)} ${fmt(p.y, 0)}</title></circle>`;
      if (o.labelAll || r > 9) s += `<text x="${X(p.x) + r + 2}" y="${Y(p.y) + 4}" class="ax">${esc(p.short || p.label)}</text>`;
    });
    return s + '</svg>';
  }

  // Choropleth from GeoJSON features with properties.geo_code. values: Map(code -> number)
  function map(geojson, values, o = {}) {
    const feats = (geojson?.features || []).filter(f => values.has(f.properties.geo_code));
    if (!feats.length) return empty(o.emptyMsg || 'No boundary polygons are available for these areas.');
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const walk = (c, fn) => typeof c[0] === 'number' ? fn(c) : c.forEach(cc => walk(cc, fn));
    feats.forEach(f => walk(f.geometry.coordinates, ([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
    const ky = 1 / Math.cos(((y0 + y1) / 2) * Math.PI / 180);
    const W = 520, sx = W / (x1 - x0 || 1), H = Math.min(560, Math.max(240, (y1 - y0) * ky * sx)), k = Math.min(sx, H / ((y1 - y0) * ky || 1));
    const P = ([x, y]) => `${((x - x0) * k).toFixed(1)},${((y1 - y) * ky * k).toFixed(1)}`;
    const vs = [...values.values()].filter(v => v != null && isFinite(v));
    const lo = o.min ?? Math.min(...vs), hi = o.max ?? Math.max(...vs);
    const ramp = o.diverging ? ['#a33a3a', '#d98b6b', '#f3e9dc', '#7fb3c8', '#1f5f8b'] : ['#eef6f5', '#c5e2df', '#86c1bd', '#3f9192', '#0b5d63'];
    const col = v => { if (v == null || !isFinite(v)) return '#e3e8eb'; const t = hi > lo ? (v - lo) / (hi - lo) : .5; return ramp[Math.min(4, Math.max(0, Math.floor(t * 5)))]; };
    const ring = r => 'M' + r.map(P).join('L') + 'Z';
    const path = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(poly => poly.map(ring).join('')).join('');
    let s = `<svg class="chart map" viewBox="0 0 ${(x1 - x0) * k} ${H}" role="img" aria-label="${esc(o.title || 'Map')}">`;
    feats.forEach(f => { const v = values.get(f.properties.geo_code); s += `<path d="${path(f.geometry)}" fill="${col(v)}" stroke="#fff" stroke-width=".7" fill-rule="evenodd"><title>${esc(f.properties.name)}: ${fmt(v, 1)}${o.unit ? ' ' + esc(o.unit) : ''}</title></path>`; });
    s += '</svg>';
    const legend = ramp.map((c, i) => `<span><i style="background:${c}"></i>${fmt(lo + (hi - lo) * i / 5, 0)}–${fmt(lo + (hi - lo) * (i + 1) / 5, 0)}</span>`).join('');
    return s + `<div class="legend">${legend}${o.unit ? `<span class="muted">${esc(o.unit)}</span>` : ''}</div>`;
  }

  const api = {bars, paired, line, scatter, map, empty, fmt, esc};
  if (typeof module !== 'undefined') module.exports = api; else root.Charts = api;
})(typeof window !== 'undefined' ? window : globalThis);
