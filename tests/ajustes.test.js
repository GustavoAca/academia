import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom.js';

instalarDom();

import { salvarAjustes, AJUSTES_PADRAO } from '../js/ajustes-service.js';
import { macroMeta } from '../js/telas/alimentacao.js';
import * as configuracoes from '../js/telas/configuracoes.js';
import * as rotinaTela from '../js/telas/rotina.js';
import * as relatorioTela from '../js/telas/relatorio.js';
import * as medidasTela from '../js/telas/medidas.js';
import * as treinoTela from '../js/telas/treino.js';
import * as focoTela from '../js/telas/foco.js';
import * as globais from '../js/eventos/globais.js';
import * as alimentacaoTela from '../js/telas/alimentacao.js';

test('salvarAjustes validates both preferences before the database', async () => {
  assert.deepEqual(AJUSTES_PADRAO, { circular: true, pct: true }, 'padrão ligado');

  await assert.rejects(salvarAjustes(), /Ajuste inválido/);
  await assert.rejects(salvarAjustes({}), /Ajuste inválido/);
  await assert.rejects(salvarAjustes({ circular: 'sim', pct: true }), /Ajuste inválido/);
  await assert.rejects(salvarAjustes({ circular: true, pct: 1 }), /Ajuste inválido/);
  await assert.rejects(salvarAjustes({ circular: true }), /Ajuste inválido/, 'pct é obrigatório');

  // par válido: a validação passa e a gravação chega ao banco
  await assert.rejects(
    salvarAjustes({ circular: false, pct: true }),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('macroMeta renders rings or bars following the preferences', () => {
  const anelPct = macroMeta('Proteína', 45, 130, { circular: true, pct: true });
  assert.match(anelPct, /class="macro-circ"/);
  assert.match(anelPct, /35%/, '45/130 = 35%');
  assert.match(anelPct, /45\/130 g/);
  assert.match(anelPct, /--p:34\.6/);

  const anelSem = macroMeta('Proteína', 45, 130, { circular: true, pct: false });
  assert.match(anelSem, /class="macro-circ"/);
  assert.match(anelSem, />45 g</, 'sem % o centro vira as gramas');
  assert.doesNotMatch(anelSem, /35%/);

  const barra = macroMeta('Proteína', 45, 130, { circular: false, pct: true });
  assert.match(barra, /class="hbar"/);
  assert.match(barra, /45\/130 g · 35%/);

  const barraSem = macroMeta('Proteína', 45, 130, { circular: false, pct: false });
  assert.match(barraSem, /class="hbar"/);
  assert.match(barraSem, /45\/130 g</);
  assert.doesNotMatch(barraSem, / · 35%/, 'o % só aparece no rótulo quando ligado');
});

test('macroMeta caps at the goal and marks a reached ring', () => {
  const cheio = macroMeta('Gordura', 70, 70, { circular: true, pct: true });
  assert.match(cheio, /class="anel ok"/);
  assert.match(cheio, /100%/);

  const acima = macroMeta('Carboidrato', 300, 250, { circular: true, pct: false });
  assert.match(acima, /class="anel ok"/);
  assert.match(acima, />300 g</);
  assert.match(acima, /--p:100\.0/, 'nunca passa de 100%');
});

test('settings actions are consumed only by the configurações screen', async () => {
  const outras = [
    ['globais', globais],
    ['treino', treinoTela],
    ['rotina', rotinaTela],
    ['foco', focoTela],
    ['medidas', medidasTela],
    ['relatorio', relatorioTela],
    ['alimentacao', alimentacaoTela]
  ];
  for (const [nome, tela] of outras) {
    assert.equal(await tela.aoClicar('ajcircular', { dataset: {} }), false, `${nome} não engole ajcircular`);
    assert.equal(await tela.aoClicar('ajpct', { dataset: {} }), false, `${nome} não engole ajpct`);
  }

  // a configurações consome (o save falha no banco e vira toast → true)
  assert.equal(await configuracoes.aoClicar('ajcircular'), true);
  assert.equal(await configuracoes.aoClicar('ajpct'), true);
  assert.equal(await configuracoes.aoClicar('outra-coisa'), false);
});
