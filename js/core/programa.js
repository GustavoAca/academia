/**
 * Program logic: the active routine translated into concrete dates, weeks,
 * steps and the day catalog (definitions + database ids).
 *
 * Everything here reads from `store`/`state` and never touches the DOM.
 */

import { DIAS } from './utils.js';
import { state, store } from './estado.js';
import {
  dataParaDate,
  totalSemanas,
  rotinaPadrao,
  defsDoDia,
  diaAtivo,
  cardioDoDia
} from '../rotina-service.js';
import { getAllExercises, getAllWorkouts } from '../db.js';

/** Start date of the active routine (fallback: the fixed program start). */
export const iniDate = () => dataParaDate((store.rotina && store.rotina.inicio) || '2026-09-14');

/** Total weeks of the active routine (default routine when there is none). */
export const semanas = () => totalSemanas(store.rotina || rotinaPadrao());

/**
 * Maximum week reachable on a day. The Friday column of the original PLANO
 * program runs one week shorter than the rest.
 * @param {number} d - day index 0..6
 */
export const MAXS = d => {
  const s = semanas();
  return store.rotina && store.rotina.origem === 'plano' && d === 4 ? Math.max(1, s - 1) : s;
};

/** Date of program week `s`, day `d` (0 = Monday). */
export const dataDe = (s, d) => {
  const x = iniDate();
  x.setDate(x.getDate() + (s - 1) * 7 + d);
  return x;
};

/** Routine definitions of the selected day. */
export const defsAtuais = () => (store.catalogo[DIAS[state.d]] || {}).defs || [];

/** Database exercise ids of the selected day (null when missing). */
export const idsAtuais = () => (store.catalogo[DIAS[state.d]] || {}).ids || [];

/** Workout row of the selected day, or undefined. */
export const treinoAtual = () => (store.catalogo[DIAS[state.d]] || {}).workout;

/**
 * Ordered flow of the selected day: the start cardio (when the user enabled
 * it), the exercises in routine order and the end cardio (on by default).
 * state.e points into this list.
 * @returns {Array<{k: 'cardio'|'ex', m?: 'i'|'f', i?: number}>}
 */
export function passos() {
  const dia = DIAS[state.d];
  const defs = defsAtuais();
  const p = [];
  if (cardioDoDia(store.rotina, dia, 'i').ativo) p.push({ k: 'cardio', m: 'i' });
  if (diaAtivo(store.rotina, dia)) defs.forEach((_, i) => p.push({ k: 'ex', i }));
  if (cardioDoDia(store.rotina, dia, 'f').ativo) p.push({ k: 'cardio', m: 'f' });
  return p;
}

/** Current step of the flow, or null when the day has no steps. */
export const passoAtual = () => passos()[state.e] || null;

/** Exercise index of the current step (null while on a cardio step). */
export function exAtual() {
  const p = passoAtual();
  return p && p.k === 'ex' ? p.i : null;
}

/**
 * Load the routine definitions and the database ids for every day.
 * Safe to call on every startup and after every routine change.
 * @returns {Promise<void>}
 */
export async function loadCatalogo() {
  const exercises = await getAllExercises();
  const workouts = await getAllWorkouts();
  store.exercisesById = new Map(exercises.map(e => [e.id, e]));
  const byName = new Map(exercises.map(e => [e.nome, e]));

  store.catalogo = {};
  for (const dia of DIAS) {
    const defs = defsDoDia(store.rotina, dia).map(e => [e.nome, e.grupo, e.series, e.min, e.max]);
    const workout = workouts.find(w => w.diaSemana === dia) || null;
    const ids = defs.map(def => {
      const exercise = byName.get(def[0]);
      return exercise ? exercise.id : null;
    });
    store.catalogo[dia] = { workout, ids, defs };
  }
}

/**
 * Move state.s/state.d to the current week and weekday of the program.
 * Days before the routine start stay on week 1 / Monday.
 */
export function posicaoInicial() {
  const h = new Date();
  const diff = Math.floor(
    (new Date(h.getFullYear(), h.getMonth(), h.getDate()) - iniDate()) / 864e5
  );
  let s = Math.floor(diff / 7) + 1;
  const dw = h.getDay();

  if (diff < 0) {
    s = 1;
    state.d = 0;
  } else {
    // 0=Dom..6=Sáb -> index 0..6 starting on Monday.
    state.d = (dw + 6) % 7;
  }

  state.s = Math.min(semanas(), Math.max(1, s));
}
