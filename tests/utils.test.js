import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAS,
  CURTO,
  LONGO,
  iso,
  hojeISO,
  fmt,
  brd,
  esc,
  f1,
  r1n,
  sg,
  VZ,
  ok,
  extrairJson,
  entradaDe,
  refeicaoSugerida
} from '../js/core/utils.js';

test('week labels stay aligned', () => {
  assert.equal(DIAS.length, 7);
  assert.equal(CURTO.length, 7);
  assert.equal(LONGO.length, 7);
  assert.equal(DIAS[0], 'seg');
  assert.equal(CURTO[0], 'Seg');
  assert.equal(LONGO[0], 'Segunda');
});

test('iso/brd/fmt format dates', () => {
  const d = new Date(2026, 8, 14); // 14/09/2026
  assert.equal(iso(d), '2026-09-14');
  assert.equal(brd('2026-09-14'), '14/09');
  assert.equal(fmt(d), '14/09');
  assert.match(hojeISO(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(hojeISO(), iso(new Date()));
});

test('esc neutralizes the four HTML breakers', () => {
  assert.equal(esc('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

test('f1/r1n/sg handle numbers with pt-BR decimals', () => {
  assert.equal(f1(82.55), '82,6');
  assert.equal(f1(4), '4');
  assert.equal(r1n(8.44), 8.4);
  assert.equal(sg(0), '0');
  assert.equal(sg(2.5), '+2,5');
  assert.equal(sg(-1.5), '−1,5'); // typographic minus, like the original UI
});

test('ok requires load and reps', () => {
  assert.equal(ok({ c: 60, r: 10 }), true);
  assert.equal(ok({ c: 60, r: '' }), false);
  assert.equal(ok({ c: '', r: 10 }), false);
  assert.equal(ok({}), false);
  assert.equal(ok(null), false);
});

test('extrairJson reads plain JSON and the example HTML payload', () => {
  assert.deepEqual(extrairJson('{"a":1}'), { a: 1 });
  const html = '<html><script id="dados">{"log":{}}</script></html>';
  assert.deepEqual(extrairJson(html), { log: {} });
});

test('entradaDe normalizes execution rows for the set inputs', () => {
  assert.deepEqual(entradaDe(null), {});
  assert.deepEqual(entradaDe({ carga: 82.5, repeticoes: 10 }), { c: '82,5', r: '10' });
  assert.deepEqual(entradaDe({ carga: null, repeticoes: null }), { c: '', r: '' });
});

test('refeicaoSugerida follows the clock', () => {
  const refeicoes = [{ id: 'cafe' }, { id: 'almoco' }, { id: 'lanche' }, { id: 'janta' }];
  const em = h => refeicaoSugerida(refeicoes, new Date(2026, 0, 1, h, 0));
  assert.equal(em(9), 'cafe');
  assert.equal(em(10), 'almoco');
  assert.equal(em(14), 'lanche');
  assert.equal(em(18), 'janta');
  assert.equal(refeicaoSugerida([{ id: 'janta' }], new Date(2026, 0, 1, 9)), 'janta');
  assert.equal(refeicaoSugerida([], new Date(2026, 0, 1, 9)), undefined);
});

test('VZ is the shared empty state markup', () => {
  assert.match(VZ, /class="meta"/);
});
