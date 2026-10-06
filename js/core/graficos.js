/**
 * Chart builders: pure functions that return SVG/HTML strings.
 *
 * They never touch the DOM, so they can be unit-tested by comparing the
 * generated markup (empty input always yields an empty string).
 */

import { f1, brd } from './utils.js';

/**
 * Simple bar chart with a scale label on top.
 * @param {number[]} v - values
 * @param {number} at - index highlighted as the current period
 * @param {string} [unidade] - unit shown next to the maximum value
 * @param {Array<string|number>} [rotulos] - x-axis labels
 * @param {(max: number) => string} [fmt] - renders the scale label instead of "max unidade"
 */
export function barras(v, at, unidade = 'kg', rotulos = null, fmt = null) {
  if (!v.length) return '';
  const W = 320, H = 110, m = Math.max(...v, 1), bw = W / v.length;
  const lab = rotulos || v.map((_, i) => i + 1);
  const escala = fmt ? fmt(m) : `${Math.round(m).toLocaleString('pt-BR')} ${unidade}`;
  return `<svg class="gr" viewBox="0 0 ${W} ${H + 16}"><text x="0" y="8">${escala}</text>` + v.map((y, i) => {
    const h = y / m * (H - 16);
    return `<rect class="b${i + 1 === at ? ' at' : ''}" x="${i * bw + 2}" y="${H - h}" width="${bw - 4}" height="${Math.max(h, 2)}" rx="3"/><text x="${i * bw + bw / 2}" y="${H + 12}" text-anchor="middle">${lab[i]}</text>`;
  }).join('') + '</svg>';
}

/** Weekly bars with the planned volume as a light background bar. */
export function barras2(feitas, planejadas, rotulos = null) {
  if (!feitas.length) return '';
  const W = 320, H = 110, m = Math.max(...feitas, ...planejadas, 1), bw = W / feitas.length;
  const lab = rotulos || feitas.map((_, i) => i + 1);
  let s = `<svg class="gr" viewBox="0 0 ${W} ${H + 16}"><text x="0" y="8">${Math.round(m).toLocaleString('pt-BR')} séries</text>`;
  feitas.forEach((v, i) => {
    const hp = planejadas[i] / m * (H - 16);
    const hf = v / m * (H - 16);
    const x = i * bw + 3;
    s += `<rect class="pl" x="${x}" y="${H - hp}" width="${Math.max(bw - 6, 1)}" height="${Math.max(hp, 2)}" rx="3"/>`;
    if (v > 0) s += `<rect class="b at" x="${x}" y="${H - hf}" width="${Math.max(bw - 6, 1)}" height="${Math.max(hf, 2)}" rx="3"/>`;
    s += `<text x="${i * bw + bw / 2}" y="${H + 12}" text-anchor="middle">${lab[i]}</text>`;
  });
  return s + '</svg>';
}

/**
 * Stacked bars: one column per day, one segment per meal.
 * @param {string[]} datas
 * @param {Array<{nome: string, valores: number[]}>} series - aligned with datas
 */
export function empilhadas(datas, series) {
  if (!datas.length) return '';
  const W = 320, H = 110, bw = W / datas.length;
  const tot = datas.map((_, i) => series.reduce((a, s) => a + (Number(s.valores[i]) || 0), 0));
  const m = Math.max(...tot, 1);
  const passo = Math.max(1, Math.ceil(datas.length / 7));
  let s = `<svg class="gr" viewBox="0 0 ${W} ${H + 16}"><text x="0" y="8">${Math.round(m).toLocaleString('pt-BR')} kcal</text>`;
  datas.forEach((d, i) => {
    let acc = 0;
    series.forEach((sr, si) => {
      const v = Number(sr.valores[i]) || 0;
      if (v <= 0) return;
      const h = v / m * (H - 16);
      acc += h;
      s += `<rect class="s${si % 6}" x="${i * bw + 1}" y="${H - acc}" width="${Math.max(bw - 2, 1)}" height="${h}"/>`;
    });
    if (i % passo === 0) s += `<text x="${i * bw + bw / 2}" y="${H + 12}" text-anchor="middle">${brd(d)}</text>`;
  });
  return s + '</svg>';
}

/**
 * Heat map of training days: rows are program weeks, columns are Monday..Sunday.
 * @param {Array<Array<{data: string, vol: number, treinou: boolean}|null>>} grade
 */
export function calor(grade) {
  const rot = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
  const usados = grade.flat().filter(c => c && c.treinou).map(c => c.vol);
  const max = Math.max(1, ...usados);
  const cel = c => {
    if (!c) return '<i class="cx" title="fora do período"></i>';
    if (!c.treinou) return `<i class="cv" title="${brd(c.data)}"></i>`;
    const n = c.vol > 0 ? Math.min(3, Math.max(1, Math.ceil(c.vol / max * 3))) : 1;
    const kg = Math.round(c.vol).toLocaleString('pt-BR');
    return `<i class="c${n}" title="${brd(c.data)} · ${kg} kg"></i>`;
  };
  return `<div class="calor">
    <div class="calor-l">${rot.map(d => `<span>${d}</span>`).join('')}</div>
    ${grade.map(w => `<div class="calor-l">${w.map(cel).join('')}</div>`).join('')}
  </div>`;
}

/**
 * Line chart of a measurement series ([[label, value], ...]).
 * Fewer than 2 points renders the "register more values" hint.
 */
export function linha(p) {
  if (p.length < 2) return '<div class="meta">Registre ao menos 2 valores desta medida para ver a evolução.</div>';
  const W = 320, H = 110, pad = 28, ys = p.map(x => x[1]), lo = Math.min(...ys), hi = Math.max(...ys), sp = (hi - lo) || 1, flat = lo === hi;
  const X = i => pad + i * (W - pad - 8) / (p.length - 1), Y = y => flat ? 10 + (H - 26) / 2 : 10 + (1 - (y - lo) / sp) * (H - 26);
  const grades = flat
    ? `<line class="gl" x1="${pad}" x2="${W - 8}" y1="${Y(lo)}" y2="${Y(lo)}"/><text x="0" y="${Y(hi) + 3}">${f1(hi)}</text>`
    : `<line class="gl" x1="${pad}" x2="${W - 8}" y1="${Y(lo)}" y2="${Y(lo)}"/><line class="gl" x1="${pad}" x2="${W - 8}" y1="${Y(hi)}" y2="${Y(hi)}"/><text x="0" y="${Y(hi) + 3}">${f1(hi)}</text><text x="0" y="${Y(lo) + 3}">${f1(lo)}</text>`;
  return `<svg class="gr" viewBox="0 0 ${W} ${H + 8}">${grades}<polyline class="ln" points="${p.map((x, i) => X(i) + ',' + Y(x[1])).join(' ')}"/>` + p.map((x, i) => `<circle class="pt" cx="${X(i)}" cy="${Y(x[1])}" r="3"/>`).join('') + `<text x="${pad}" y="${H + 6}">${p[0][0]}</text><text x="${W - 8}" y="${H + 6}" text-anchor="end">${p[p.length - 1][0]}</text></svg>`;
}

/** Tiny inline line used inside table rows. */
export function spark(v) {
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), sp = (hi - lo) || 1;
  return `<svg class="gr" viewBox="0 0 80 24"><polyline class="ln" style="stroke-width:2" points="${v.map((y, i) => (i * 76 / (v.length - 1) + 2) + ',' + (22 - (y - lo) / sp * 20)).join(' ')}"/></svg>`;
}

/**
 * Load evolution chart for one exercise: one point per program week, scaled to
 * that exercise's own range, with min/max labels and the last week highlighted.
 * @param {Array<[string, number]>} p - [[weekLabel, load], ...] chronological
 */
export function linhaCarga(p) {
  if (p.length < 2) return '';
  const W = 320, H = 80, pad = 30;
  const ys = p.map(x => Number(x[1]) || 0);
  const lo = Math.min(...ys), hi = Math.max(...ys), sp = (hi - lo) || 1, flat = lo === hi;
  const X = i => pad + i * (W - pad - 16) / (p.length - 1);
  const Y = y => flat ? 12 + (H - 30) / 2 : 12 + (1 - (y - lo) / sp) * (H - 30);
  const pontos = p.map((x, i) => `${X(i).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(' ');

  let s = `<svg class="gr" viewBox="0 0 ${W} ${H}">`;
  s += `<line class="gl" x1="${pad}" x2="${W - 16}" y1="${Y(hi)}" y2="${Y(hi)}"/>`;
  if (!flat) s += `<line class="gl" x1="${pad}" x2="${W - 16}" y1="${Y(lo)}" y2="${Y(lo)}"/>`;
  s += `<text x="0" y="${Y(hi) + 3}">${f1(hi)}</text>`;
  if (!flat) s += `<text x="0" y="${Y(lo) + 3}">${f1(lo)}</text>`;
  s += `<polyline class="ln" points="${pontos}"/>`;
  s += p.map((x, i) => {
    const ult = i === p.length - 1;
    return `<circle class="pt${ult ? ' fim' : ''}" cx="${X(i).toFixed(1)}" cy="${Y(x[1]).toFixed(1)}" r="${ult ? 4 : 3}"/>`;
  }).join('');
  s += `<text x="${pad}" y="${H - 4}">${p[0][0]}</text>`;
  s += `<text x="${W - 16}" y="${H - 4}" text-anchor="end">${p[p.length - 1][0]}</text>`;
  return s + '</svg>';
}

/**
 * Daily bars with optional goal line, average line and 7-day moving average.
 * @param {Array<{data: string, v: number}>} pts
 * @param {number|{media?: number, meta?: number, mm7?: number[]}} opto
 */
export function barrasData(pts, opto) {
  if (!pts.length) return '';
  const o = typeof opto === 'number' ? { media: opto } : (opto || {});
  const W = 320, H = 110, bw = W / pts.length;
  const vals = pts.map(p => Number(p.v) || 0);
  const mm7 = Array.isArray(o.mm7) && o.mm7.length === pts.length ? o.mm7 : null;
  const m = Math.max(...vals, o.meta || 0, o.media || 0, ...(mm7 || []), 1);
  const passo = Math.max(1, Math.ceil(pts.length / 7));
  let s = `<svg class="gr" viewBox="0 0 ${W} ${H + 16}"><text x="0" y="8">${Math.round(m).toLocaleString('pt-BR')} kcal</text>`;

  const linhaGuia = (valor, cls, txt) => {
    const y = H - valor / m * (H - 16);
    return `<line class="${cls}" x1="0" x2="${W}" y1="${y}" y2="${y}" stroke-dasharray="4 3"/><text x="${W}" y="${y - 3}" text-anchor="end">${txt}</text>`;
  };

  if (o.meta > 0) s += linhaGuia(o.meta, 'gl meta', 'meta ' + Math.round(o.meta).toLocaleString('pt-BR'));
  else if (o.media > 0) s += linhaGuia(o.media, 'gl', 'média ' + Math.round(o.media).toLocaleString('pt-BR'));

  pts.forEach((p, i) => {
    const h = vals[i] / m * (H - 16);
    s += `<rect class="b${i === pts.length - 1 ? ' at' : ''}" x="${i * bw + 1}" y="${H - h}" width="${Math.max(bw - 2, 1)}" height="${Math.max(h, 2)}" rx="2"/>`;
    if (i % passo === 0) {
      s += `<text x="${i * bw + bw / 2}" y="${H + 12}" text-anchor="middle">${brd(p.data)}</text>`;
    }
  });

  if (mm7) {
    const passoX = pts.length > 1 ? W / pts.length : W;
    const pontos = mm7.map((v, i) => (i * passoX + passoX / 2) + ',' + (H - v / m * (H - 16))).join(' ');
    s += `<polyline class="ln" points="${pontos}"/>`;
  }

  return s + '</svg>';
}
