import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom, eventoCampo } from './helpers/dom.js';

instalarDom();

import {
  paceDe,
  adicionarCardio,
  tempoEmMinutos,
  formatarTempo,
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

const segs = v => Math.round(tempoEmMinutos(v) * 60);

test('tempoEmMinutos aceita minutos, mm:ss e hh:mm:ss', () => {
  assert.equal(segs('30'), 1800, 'número puro são minutos');
  assert.equal(segs('30,5'), 1830, 'vírgula decimal pt-BR');
  assert.equal(segs('03:11'), 191, 'dois-pontos são mm:ss');
  assert.equal(segs('3:5'), 185, 'sem zero à esquerda');
  assert.equal(segs('1:03:11'), 3791, 'três partes são hh:mm:ss');
  assert.equal(segs('0:45'), 45);
  assert.equal(segs('90:00'), 5400, 'mm:ss passa de uma hora');

  for (const ruim of ['', '   ', null, undefined, 'abc', '03:99', '1:60:00', '1:2:3:4', ':30', '30:']) {
    assert.ok(Number.isNaN(tempoEmMinutos(ruim)), `"${ruim}" é tempo inválido`);
  }

  assert.equal(paceDe('03:11', ''), null, 'pace continua sem distância');
  assert.equal(paceDe('06:00', 1), '6:00', 'pace aceita o tempo no formato mm:ss');
});

test('formatarTempo mostra minutos cheios, mm:ss e hh:mm:ss', () => {
  assert.equal(formatarTempo(30), '30 min');
  assert.equal(formatarTempo(0), '0 min');
  assert.equal(formatarTempo(90), '90 min', 'minutos cheios não viram hora');
  assert.equal(formatarTempo(30.5), '30:30');
  assert.equal(formatarTempo(191 / 60), '03:11');
  assert.equal(formatarTempo(0.5), '00:30');
  assert.equal(formatarTempo(3791 / 60), '01:03:11', 'acima de uma hora vira hh:mm:ss');
  assert.equal(formatarTempo('abc'), '', 'valor inválido fica vazio');
});

test('adicionarCardio rejects bad optional fields before saving', async () => {
  const base = { data: '2026-03-01', tipo: 'Corrida', minutos: '30' };

  await assert.rejects(adicionarCardio({ ...base, minutos: '' }), /Informe o tempo/);
  await assert.rejects(adicionarCardio({ ...base, minutos: '03:99' }), /Informe o tempo/, 'segundo inválido');
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
  assert.match(html, /<label>Tempo<\/label>/);
  assert.match(html, /03:11/, 'o placeholder ensina o formato mm:ss');
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

  const htmlSeg = await cardPassoCardio('f', {}, [{
    id: 7,
    data: '2026-03-01',
    tipo: 'Corrida',
    minutos: 191 / 60,
    momento: 'f'
  }]);
  assert.match(htmlSeg, />03:11</, 'tempo com segundos aparece como mm:ss');
  assert.match(htmlSeg, /· 03:11 /, 'total do dia também');

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
