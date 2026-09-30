/**
 * Report calculations: period window, planned sets inside it, streaks and
 * record loads. Pure functions over `state`/`store` and the active routine.
 */

import { DIAS, iso, hojeISO } from './utils.js';
import { state, store } from './estado.js';
import { iniDate, semanas, MAXS, dataDe } from './programa.js';
import { dataParaDate, defsDoDia } from '../rotina-service.js';

/** Window used by the report screen: { dias, desde }. desde null = all time. */
export function janelaRel() {
  if (!state.p) return { dias: 0, desde: null };
  const ini = new Date();
  ini.setDate(ini.getDate() - (state.p - 1));
  return { dias: state.p, desde: iso(ini) };
}

/** Days inside the report window (1 when filtering all time since the start). */
export function diasJanela(desde) {
  const ini = dataParaDate(desde || iso(iniDate()));
  const fim = dataParaDate(hojeISO());
  return Math.max(1, Math.round((fim - ini) / 864e5) + 1);
}

/** Planned sets inside the same window used by the report filter. */
export function planoJanela(desde) {
  if (!desde) {
    let total = 0;
    DIAS.forEach((k, d) => { total += defsDoDia(store.rotina, k).reduce((a, x) => a + Number(x.series || 0), 0) * MAXS(d); });
    return total;
  }

  const hoje = hojeISO();
  let total = 0;
  for (let s = 1; s <= semanas(); s++) {
    DIAS.forEach((k, d) => {
      if (s > MAXS(d)) return;
      const data = iso(dataDe(s, d));
      if (data < desde || data > hoje) return;
      total += defsDoDia(store.rotina, k).reduce((a, x) => a + Number(x.series || 0), 0);
    });
  }
  return total;
}

/** Program weeks touched by the window (labels for the weekly charts). */
export function semanasJanela(desde) {
  if (!desde) return Array.from({ length: semanas() }, (_, i) => i + 1);
  const hoje = hojeISO();
  const out = [];
  for (let s = 1; s <= semanas(); s++) {
    if (iso(dataDe(s, 6)) < desde) continue;
    if (iso(dataDe(s, 0)) > hoje) continue;
    out.push(s);
  }
  return out.length ? out : [1];
}

/** Longest run of consecutive days with training inside the window. */
export function melhorSequencia(treinados, desde) {
  const ini = dataParaDate(desde);
  const fim = dataParaDate(hojeISO());
  let melhor = 0, atual = 0;
  for (const d = new Date(ini); d <= fim; d.setDate(d.getDate() + 1)) {
    if (treinados.has(iso(d))) { atual++; if (atual > melhor) melhor = atual; }
    else atual = 0;
  }
  return melhor;
}

/** Latest load records (new best set) per exercise, most recent first. */
export function recordes(R) {
  const porEx = {};
  R.forEach(x => { (porEx[x.nome] = porEx[x.nome] || []).push(x); });

  const out = [];
  Object.entries(porEx).forEach(([nome, lista]) => {
    const porData = {};
    lista.forEach(x => { porData[x.data] = Math.max(porData[x.data] || 0, x.c); });
    let melhor = null;
    Object.keys(porData).sort().forEach(data => {
      if (melhor === null) { melhor = porData[data]; return; }
      if (porData[data] > melhor) { melhor = porData[data]; out.push({ data, nome, c: porData[data] }); }
    });
  });

  return out.sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5);
}

/**
 * Valid numeric values of one measurement field, sorted by date.
 * @param {Array<Object>} measurements
 * @param {string} campo
 * @returns {Array<[string, number]>}
 */
export function serieCampo(measurements, campo) {
  return measurements
    .map(m => [m.data, m[campo] !== undefined && m[campo] !== null ? Number(m[campo]) : null])
    .filter(p => p[1] !== null && !isNaN(p[1]))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
