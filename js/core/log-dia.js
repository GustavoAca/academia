/**
 * Day log: the sets of the selected day/week held in memory, plus the reads
 * and writes that keep them in sync with IndexedDB.
 */

import { DIAS, iso, ok, entradaDe } from './utils.js';
import { state, store, gravar } from './estado.js';
import { dataDe, defsAtuais, idsAtuais, passos, exAtual, treinoAtual } from './programa.js';
import { getExecutionsByDate, upsertExecution, deleteExecution } from '../db.js';
import { num } from '../measurement-service.js';
import { getPulados, getCardiosByDate } from '../cardio-service.js';

/**
 * Load the executions of the selected day/week into store.logAtual, keeping
 * only the exercises that belong to the current catalog.
 * @returns {Promise<void>}
 */
export async function carregarLogDoDia() {
  const ids = new Set(idsAtuais().filter(id => id !== null));
  const data = iso(dataDe(state.s, state.d));
  const execs = await getExecutionsByDate(data);
  const novo = {};

  for (const exec of execs) {
    if (!ids.has(exec.exercicioId)) continue;
    novo[`${exec.exercicioId}|${exec.serie}`] = entradaDe(exec);
  }

  store.logAtual = novo;
}

/** Draft of one set, created on first access so inputs can bind to it. */
export function gDe(exercicioId, serie) {
  const key = `${exercicioId}|${serie}`;
  if (!store.logAtual[key]) store.logAtual[key] = { c: '', r: '' };
  return store.logAtual[key];
}

/** Key of the note of exercise `ei` on the selected day/week. */
export function notaKey(ei) {
  return `${DIAS[state.d]}|${state.s}|${ei}`;
}

/** Number of completed sets of exercise `e` on the selected day. */
export function feitas(e) {
  const ids = idsAtuais();
  const defs = defsAtuais();
  const id = ids[e];
  if (id === null || id === undefined) return 0;

  const n = defs[e][2];
  let c = 0;
  for (let i = 0; i < n; i++) if (ok(store.logAtual[`${id}|${i + 1}`])) c++;
  return c;
}

/**
 * Totals of the selected day: planned sets, done sets and volume (kg).
 * @returns {{t: number, f: number, vol: number}}
 */
export function totais() {
  const defs = defsAtuais();
  const ids = idsAtuais();
  let t = 0, f = 0, vol = 0;

  defs.forEach((x, e) => {
    t += x[2];
    for (let i = 0; i < x[2]; i++) {
      const id = ids[e];
      const g = id === null || id === undefined ? null : store.logAtual[`${id}|${i + 1}`];
      if (ok(g)) {
        f++;
        vol += (num(g.c) || 0) * (num(g.r) || 0);
      }
    }
  });

  return { t, f, vol };
}

/**
 * First step of the flow: the start cardio when it is still pending,
 * otherwise the first exercise with sets left (0 when everything is done).
 * @returns {Promise<number>} index into passos()
 */
export async function primeiroPasso() {
  const ps = passos();
  if (!ps.length) return 0;

  const primeiro = ps[0];
  if (primeiro.k === 'cardio' && primeiro.m === 'i') {
    const data = iso(dataDe(state.s, state.d));
    const pulado = (await getPulados(data)).i;
    const feito = (await getCardiosByDate(data)).some(x => (x.momento || 'f') === 'i');
    if (!pulado && !feito) return 0;
  }

  const defs = defsAtuais();
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.k === 'ex' && feitas(p.i) < defs[p.i][2]) return i;
  }
  return 0;
}

/**
 * Reference of the last week with data for this exercise (like exemplo.html).
 * @returns {Promise<Object|null>} { w, r }
 */
export async function ultimo(d, s, e) {
  const dia = DIAS[d];
  const id = (store.catalogo[dia] || {}).ids[e];
  if (id === null || id === undefined) return null;

  const n = store.catalogo[dia].defs[e][2];

  for (let w = s - 1; w >= 1; w--) {
    const execs = await getExecutionsByDate(iso(dataDe(w, d)));
    const porSerie = {};
    for (const exec of execs) {
      if (exec.exercicioId === id) porSerie[exec.serie] = exec;
    }

    const r = [];
    for (let i = 0; i < n; i++) r.push(entradaDe(porSerie[i + 1]));
    if (r.some(ok)) return { w, r };
  }

  return null;
}

/**
 * Persist the draft of one set: an empty draft deletes the row, otherwise the
 * row is upserted by its natural key.
 * @param {number} serie - 1-based set number
 */
export function salvarSerie(serie) {
  const ei = exAtual();
  if (ei === null) return;
  const id = idsAtuais()[ei];
  const workout = treinoAtual();
  const g = id === null || id === undefined ? null : store.logAtual[`${id}|${serie}`];
  if (!g || !workout) return;

  const data = iso(dataDe(state.s, state.d));

  if (!g.c && !g.r) {
    gravar(() => deleteExecution(data, workout.id, id, serie));
    return;
  }

  const record = {
    data,
    treinoId: workout.id,
    exercicioId: id,
    serie,
    carga: num(g.c),
    repeticoes: num(g.r)
  };

  gravar(() => upsertExecution(record));
}
