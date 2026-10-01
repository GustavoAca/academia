/**
 * Shared mutable state of the application.
 *
 * Every module reads and writes these objects instead of keeping module-local
 * copies, so there is a single source of truth. Fields are mutated in place
 * (never reassigned on the exported bindings), which keeps ES module live
 * bindings working across the graph.
 */

import { hojeISO } from './utils.js';

/** Screen/navigation state. */
export const state = {
  tela: 'treino', // 'treino' | 'rotina' | 'foco' | 'med' | 'alim' | 'rel' | 'cfg'
  d: 0,           // day index 0..6 (Seg..Dom)
  s: 1,           // program week 1..MAXS
  e: 0,           // exercise index within the day
  lista: false,   // list view instead of the set card
  md: hojeISO(),  // date selected in the Medidas screen
  alim: hojeISO(),// date selected in the Alimentação screen
  alimRef: null,   // meal selected in the Alimentação screen (null = time-based)
  m: 'peso',      // metric selected in the report chart
  p: 30,          // period (days) of the reports; 0 = all
  relSec: 'treino', // report section: 'treino' | 'corpo' | 'alim'
  alimEdit: null,   // id of the day's item being edited (Alimentação screen)
  alimEditRef: null, // kcal per 100 g of the item being edited
  alimCriar: false,  // show the catalog's "new food" form (Alimentação screen)
  rotinaTravou: false, // o salvamento travou o Início para preservar o histórico
  ajustes: { circular: true, pct: true }, // exibição (ajustes-service, recarregado no boot)
  foco: { passo: 1, grupos: [], dias: 4 } // wizard da aba Foco
};

/** Data that is replaced during the app lifetime (routine, catalog, logs). */
export const store = {
  rotina: null,            // active routine (see rotina-service)
  rotinaRascunho: null,    // routine draft being edited (Rotina/Foco screens)
  exercisesById: new Map(),
  exerciseIdPorNome: new Map(),   // nome -> id (resolução de versões antigas)
  workoutsPorDia: new Map(),      // dia -> workout row
  catalogo: {},            // day -> { workout, ids, defs } (rotina ativa)
  notas: {},               // 'dia|semana|indiceExercicio' -> texto
  logAtual: {},            // 'exercicioId|serie' -> { c, r }
  medDraft: {},            // measurement record being edited for state.md
  fila: Promise.resolve()  // serializes IndexedDB writes
};

/**
 * Queue an IndexedDB write so concurrent edits never interleave.
 * Errors are logged and swallowed: the queue must never break.
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
export function gravar(fn) {
  store.fila = store.fila.then(() => fn()).catch(err => console.error('Erro ao gravar:', err));
  return store.fila;
}

/** Resolves when every queued write has finished. */
export function aguardarGravacoes() {
  return store.fila;
}
