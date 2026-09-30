import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barras,
  barras2,
  empilhadas,
  calor,
  linha,
  spark,
  linhaCarga,
  barrasData
} from '../js/core/graficos.js';

test('barras renders one rect per value and highlights the current week', () => {
  const svg = barras([10, 0, 40], 3, 'kg', ['S1', 'S2', 'S3']);
  assert.match(svg, /<svg class="gr"/);
  assert.equal((svg.match(/<rect/g) || []).length, 3);
  assert.match(svg, /class="b at"/);
  assert.match(svg, />S3</);
  assert.equal(barras([], 1), '');
});

test('barras2 draws planned behind done sets', () => {
  const svg = barras2([12, 8], [20, 20]);
  assert.match(svg, /class="pl"/);
  assert.match(svg, /class="b at"/);
  assert.equal(barras2([], []), '');
});

test('empilhadas stacks meal segments per day', () => {
  const svg = empilhadas(['2026-09-14', '2026-09-15'], [
    { nome: 'Almoço', valores: [500, 0] },
    { nome: 'Jantar', valores: [300, 700] }
  ]);
  assert.equal((svg.match(/<rect/g) || []).length, 3); // zero segments are skipped
  assert.match(svg, /class="s0"/);
  assert.match(svg, /class="s1"/);
  assert.match(svg, />14\/09</);
  assert.equal(empilhadas([], []), '');
});

test('calor classifies cells by volume and marks out-of-period days', () => {
  const grade = [[
    { data: '2026-09-14', vol: 1500, treinou: true },
    { data: '2026-09-15', vol: 3000, treinou: true },
    { data: '2026-09-16', vol: 0, treinou: false },
    null
  ]];
  const html = calor(grade);
  assert.match(html, /class="cv"/); // day without training
  assert.match(html, /class="c3"/); // strongest day
  assert.match(html, /class="c2"/); // mid-volume day
  assert.match(html, /class="cx"/); // outside period
});

test('linha needs two points and scales between min and max', () => {
  assert.match(linha([['set', 70]]), /Registre ao menos 2 valores/);
  const svg = linha([['set', 70], ['out', 72]]);
  assert.match(svg, /polyline class="ln"/);
  assert.equal((svg.match(/<circle/g) || []).length, 2);
  assert.match(svg, />72</); // max label
});

test('spark and linhaCarga return empty for a single point', () => {
  assert.equal(spark([1]), '');
  assert.match(spark([1, 3, 2]), /polyline class="ln"/);
  assert.equal(linhaCarga([['Sem 1', 40]]), '');
  const carga = linhaCarga([['Sem 1', 40], ['Sem 2', 45], ['Sem 3', 45]]);
  assert.match(carga, /class="pt fim"/); // last week highlighted
});

test('barrasData draws bars, guide line and the moving average', () => {
  const pts = [{ data: '2026-09-14', v: 1800 }, { data: '2026-09-15', v: 2400 }];
  const svg = barrasData(pts, { meta: 2200, media: 2100, mm7: [1800, 2100] });
  assert.equal((svg.match(/<rect/g) || []).length, 2);
  assert.match(svg, /class="gl meta"/);
  assert.match(svg, /polyline class="ln"/);
  assert.match(svg, />2\.400 kcal</);
  assert.equal(barrasData([], { media: 2000 }), '');
});

test('barrasData falls back to the average line when there is no goal', () => {
  const svg = barrasData([{ data: '2026-09-14', v: 1000 }], 2000);
  assert.match(svg, /class="gl"/);
  assert.doesNotMatch(svg, /gl meta/);
  assert.match(svg, /média 2\.000/);
});
