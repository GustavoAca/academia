import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, store } from '../js/core/estado.js';
import { hojeISO, iso } from '../js/core/utils.js';
import { rotinaPadrao } from '../js/rotina-service.js';
import { semanas } from '../js/core/programa.js';
import {
  janelaRel,
  diasJanela,
  planoJanela,
  semanasJanela,
  melhorSequencia,
  recordes,
  serieCampo
} from '../js/core/calculos-relatorio.js';

const pOriginal = state.p;
const rotinaOriginal = store.rotina;

beforeEach(() => {
  store.rotina = rotinaPadrao();
});

afterEach(() => {
  state.p = pOriginal;
  store.rotina = rotinaOriginal;
});

function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}

test('janelaRel opens and closes the report window', () => {
  state.p = 0;
  assert.deepEqual(janelaRel(), { dias: 0, desde: null });

  state.p = 7;
  const j = janelaRel();
  assert.equal(j.dias, 7);
  assert.equal(j.desde, diasAtras(6));
});

test('diasJanela counts days inclusively', () => {
  assert.equal(diasJanela(hojeISO()), 1);
  assert.equal(diasJanela(diasAtras(6)), 7);
  assert.equal(diasJanela(diasAtras(30)), 31);
});

test('planoJanela never exceeds the all-time plan', () => {
  const tudo = planoJanela(null);
  const janela = planoJanela(hojeISO());
  assert.ok(tudo > 0);
  assert.ok(janela >= 0);
  assert.ok(janela <= tudo);
  assert.ok(Number.isInteger(tudo));
});

test('semanasJanela lists program weeks', () => {
  const todas = semanasJanela(null);
  assert.equal(todas.length, semanas());
  assert.deepEqual(todas, Array.from({ length: semanas() }, (_, i) => i + 1));

  const atual = semanasJanela(hojeISO());
  assert.ok(atual.length >= 1);
  assert.ok(atual.every(n => Number.isInteger(n) && n >= 1));
});

test('melhorSequencia counts consecutive training days', () => {
  const treinados = new Set([diasAtras(4), diasAtras(2), diasAtras(1), diasAtras(0)]);
  assert.equal(melhorSequencia(treinados, diasAtras(7)), 3);
  assert.equal(melhorSequencia(new Set(), diasAtras(7)), 0);
});

test('recordes only lists genuine improvements', () => {
  const R = [
    { data: '2026-01-01', nome: 'Supino', c: 40, v: 1000, s: 1, r: 10, grp: 'Peito' },
    { data: '2026-01-08', nome: 'Supino', c: 45, v: 1200, s: 2, r: 8, grp: 'Peito' },
    { data: '2026-01-15', nome: 'Supino', c: 42, v: 1100, s: 3, r: 8, grp: 'Peito' },
    { data: '2026-01-20', nome: 'Supino', c: 50, v: 1300, s: 4, r: 6, grp: 'Peito' },
    { data: '2026-01-22', nome: 'Remada', c: 30, v: 900, s: 1, r: 10, grp: 'Costas' }
  ];
  const out = recordes(R);
  // a primeira marca de cada exercício não conta como recorde; só melhoria
  assert.deepEqual(out.map(r => r.data), ['2026-01-20', '2026-01-08']);
  assert.equal(out[0].c, 50);
  assert.ok(out.length <= 5);
});

test('serieCampo keeps only numeric values, sorted by date', () => {
  const medidas = [
    { data: '2026-03-01', peso: null },
    { data: '2026-02-01', peso: 70 },
    { data: '2026-01-01', peso: '71' },
    { data: '2026-04-01', peso: 'abc' },
    { data: '2026-05-01', peso: 72.5 }
  ];
  assert.deepEqual(serieCampo(medidas, 'peso'), [
    ['2026-01-01', 71],
    ['2026-02-01', 70],
    ['2026-05-01', 72.5]
  ]);
  assert.deepEqual(serieCampo(medidas, 'gord'), []);
});
