import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom, eventoCampo } from './helpers/dom.js';

instalarDom();

import {
  paceDe,
  adicionarCardio,
  TIPOS_COM_DISTANCIA,
  TIPOS_CARDIO
} from '../js/cardio-service.js';
import { state, store } from '../js/core/estado.js';
import { rotinaPadrao, garantirCardio } from '../js/rotina-service.js';
import { cardPassoCardio, aoDigitar, aoMudar } from '../js/telas/treino.js';
import * as rotinaTela from '../js/telas/rotina.js';
import * as relatorioTela from '../js/telas/relatorio.js';
import * as medidasTela from '../js/telas/medidas.js';
import * as alimentacaoTela from '../js/telas/alimentacao.js';

test('pace needs both time and distance', () => {
  assert.equal(paceDe(30, 5), '6:00');
  assert.equal(paceDe(25, 4), '6:15');
  assert.equal(paceDe('30,5', '5,1'), '5:59', 'aceita vírgula decimal pt-BR');
  assert.equal(paceDe(90, 7), '12:51');
  assert.equal(paceDe(59.99, 10), '6:00', 'segundos carregam para o minuto seguinte');

  assert.equal(paceDe(null, 5), null, 'sem tempo não há pace');
  assert.equal(paceDe(30, null), null, 'sem distância não há pace');
  assert.equal(paceDe(30, ''), null);
  assert.equal(paceDe('', 5), null);
  assert.equal(paceDe(0, 5), null);
  assert.equal(paceDe(30, 0), null);
  assert.equal(paceDe(-30, 5), null);
  assert.equal(paceDe(30, -5), null);
  assert.equal(paceDe('abc', 5), null);
});

test('distance is only part of the record for walking and running', () => {
  assert.deepEqual(TIPOS_COM_DISTANCIA, ['Caminhada', 'Corrida']);
  assert.ok(TIPOS_CARDIO.includes('Caminhada'));
  assert.ok(TIPOS_CARDIO.includes('Corrida'));
});

test('adicionarCardio rejects bad optional fields before saving', async () => {
  const base = { data: '2026-03-01', tipo: 'Corrida', minutos: '30' };

  await assert.rejects(adicionarCardio({ ...base, minutos: '' }), /Informe o tempo em minutos/);
  await assert.rejects(adicionarCardio({ ...base, distancia: 'abc' }), /distância em km/);
  await assert.rejects(adicionarCardio({ ...base, distancia: '0' }), /distância em km/);
  await assert.rejects(adicionarCardio({ ...base, distancia: '-2' }), /distância em km/);
  await assert.rejects(adicionarCardio({ ...base, calorias: 'x' }), /calorias válidas/);
  await assert.rejects(adicionarCardio({ ...base, calorias: '0' }), /calorias válidas/);

  // opcionais vazios passam na validação e chegam ao banco
  // (no Node não há IndexedDB, então a falha vem do IndexedDB, não da validação)
  await assert.rejects(
    adicionarCardio({ ...base, distancia: '', calorias: '', observacao: ' Bom ritmo ' }),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('cardio card renders distance, calories, notes and the pace preview', async () => {
  state.d = 0;
  store.rotina = rotinaPadrao();

  const html = await cardPassoCardio('f', { i: false, f: false }, []);
  assert.match(html, /Tempo \(min\)/);
  assert.match(html, /Calorias \(kcal\)/);
  assert.match(html, /Observação/);
  assert.match(html, /data-k="ctempo"/);
  assert.match(html, /data-k="cdist"/);
  assert.match(html, /id="cardioPace"/);
  assert.match(html, /id="cardioDist"/);
  assert.ok(
    !/id="cardioDistWrap" style="display:none"/.test(html),
    'Caminhada mostra o campo de distância'
  );

  garantirCardio(store.rotina, 'seg', 'f').tipo = 'Pular corda';
  const htmlSemDist = await cardPassoCardio('f', { i: false, f: false }, []);
  assert.match(
    htmlSemDist,
    /id="cardioDistWrap" style="display:none"/,
    'Pular corda esconde o campo de distância'
  );

  store.rotina = rotinaPadrao();
  const htmlRegistro = await cardPassoCardio('f', {}, [{
    id: 1,
    data: '2026-03-01',
    tipo: 'Corrida',
    minutos: 30,
    momento: 'f',
    distancia: 5,
    calorias: 350,
    observacao: 'Bom ritmo'
  }]);
  assert.match(htmlRegistro, /30 min · 5 km · 6:00 \/km · 350 kcal/);
  assert.match(htmlRegistro, /Bom ritmo/);

  const htmlSemPace = await cardPassoCardio('f', {}, [{
    id: 2,
    data: '2026-03-01',
    tipo: 'Bicicleta',
    minutos: 20,
    momento: 'f'
  }]);
  assert.ok(!/\/km/.test(htmlSemPace), 'pace não aparece quando não há distância');
});

test('cardio fields are consumed only by the treino screen', async () => {
  // o treino é o último da fila de despacho: todas as outras telas precisam
  // devolver false para ctempo/cdist/ctipo, senão o preview de pace trava
  const outrasTelas = [
    ['rotina', rotinaTela],
    ['relatorio', relatorioTela],
    ['medidas', medidasTela],
    ['alimentacao', alimentacaoTela]
  ];
  for (const [nome, tela] of outrasTelas) {
    assert.equal(await tela.aoDigitar(eventoCampo({ k: 'ctempo' }, '30')), false, `${nome} não engole ctempo`);
    assert.equal(await tela.aoDigitar(eventoCampo({ k: 'cdist' }, '5')), false, `${nome} não engole cdist`);
  }
  assert.equal(await alimentacaoTela.aoMudar(eventoCampo({ k: 'ctipo' }, 'Corrida')), false, 'alimentação não engole ctipo');

  assert.equal(await aoDigitar(eventoCampo({ k: 'ctempo' }, '30')), true);
  assert.equal(await aoDigitar(eventoCampo({ k: 'cdist' }, '5')), true);
  assert.equal(await aoMudar(eventoCampo({ k: 'ctipo' }, 'Corrida')), true);
  assert.equal(await aoMudar(eventoCampo({ k: 'outro' }, 'x')), false);
});
