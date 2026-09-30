import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, store } from '../js/core/estado.js';
import { DIAS, iso } from '../js/core/utils.js';
import { rotinaPadrao } from '../js/rotina-service.js';
import {
  iniDate,
  semanas,
  MAXS,
  dataDe,
  defsAtuais,
  idsAtuais,
  treinoAtual,
  passos,
  passoAtual,
  exAtual,
  posicaoInicial
} from '../js/core/programa.js';

const snapshot = () => ({
  rotina: store.rotina,
  catalogo: store.catalogo,
  d: state.d,
  s: state.s,
  e: state.e
});
const original = snapshot();

beforeEach(() => {
  store.rotina = null;
  store.catalogo = {};
  state.d = 0;
  state.s = 1;
  state.e = 0;
});

afterEach(() => {
  Object.assign(store, { rotina: original.rotina, catalogo: original.catalogo });
  Object.assign(state, { d: original.d, s: original.s, e: original.e });
});

test('the program starts on 14/09/2026 with 16 weeks', () => {
  assert.equal(iniDate().getFullYear(), 2026);
  assert.equal(iniDate().getMonth(), 8);
  assert.equal(iniDate().getDate(), 14);
  assert.equal(semanas(), 16);
});

test('dataDe walks the calendar week by week', () => {
  assert.equal(iso(dataDe(1, 0)), '2026-09-14');
  assert.equal(iso(dataDe(1, 6)), '2026-09-20');
  assert.equal(iso(dataDe(2, 0)), '2026-09-21');
});

test('MAXS trims the Friday column only for the base program', () => {
  store.rotina = null;
  assert.equal(MAXS(0), 16);
  assert.equal(MAXS(4), 16);

  store.rotina = { origem: 'plano' };
  assert.equal(MAXS(4), 15);
  assert.equal(MAXS(0), 16);

  store.rotina = { origem: 'personalizada' };
  assert.equal(MAXS(4), 16);
});

test('the catalog drives the current day selectors', () => {
  assert.deepEqual(defsAtuais(), []);
  assert.deepEqual(idsAtuais(), []);
  assert.equal(treinoAtual(), undefined);

  store.catalogo = { [DIAS[0]]: { workout: { id: 7 }, ids: [1], defs: [['Supino', 'Peito', 3, 8, 12]] } };
  assert.deepEqual(defsAtuais(), [['Supino', 'Peito', 3, 8, 12]]);
  assert.deepEqual(idsAtuais(), [1]);
  assert.equal(treinoAtual().id, 7);
});

test('passos orders the day: exercises then the end cardio', () => {
  store.rotina = rotinaPadrao();
  store.catalogo = {
    seg: { workout: null, ids: [11, 12], defs: [['Supino', 'Peito', 3, 8, 12], ['Rosca', 'Braços', 3, 10, 15]] },
    sab: { workout: null, ids: [], defs: [] },
    dom: { workout: null, ids: [], defs: [] }
  };

  state.d = 0; // Monday: trained in the base program
  assert.deepEqual(passos(), [
    { k: 'ex', i: 0 },
    { k: 'ex', i: 1 },
    { k: 'cardio', m: 'f' }
  ]);

  state.e = 1;
  assert.equal(passoAtual().k, 'ex');
  assert.equal(exAtual(), 1);

  state.e = 2;
  assert.equal(exAtual(), null);
  assert.equal(passoAtual().k, 'cardio');

  state.d = 5; // Saturday: free day, only the end cardio remains
  state.e = 0;
  assert.deepEqual(passos(), [{ k: 'cardio', m: 'f' }]);
});

test('posicaoInicial lands before the program start on week 1 / Monday', () => {
  store.rotina = { ...rotinaPadrao(), inicio: '2099-01-01' };
  posicaoInicial();
  assert.equal(state.s, 1);
  assert.equal(state.d, 0);
});

test('posicaoInicial picks the current week and weekday', () => {
  store.rotina = rotinaPadrao();
  posicaoInicial();
  assert.ok(state.s >= 1 && state.s <= semanas());
  assert.ok(state.d >= 0 && state.d <= 6);
  const hoje = new Date();
  assert.equal(state.d, (hoje.getDay() + 6) % 7);
});
