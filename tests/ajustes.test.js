import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom.js';

instalarDom();

import { salvarAjustes, AJUSTES_PADRAO } from '../js/ajustes-service.js';
import { tabs, subTabsAjustes } from '../js/core/render.js';
import { telaDe } from '../js/core/rotas.js';
import { state } from '../js/core/estado.js';
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

test('a barra principal tem 5 abas e Agrupa Foco e Rotina em Ajustes', () => {
  const tela = state.tela;
  try {
    const html = tabs();
    assert.equal((html.match(/data-a="tela"/g) || []).length, 5, 'cinco abas');
    assert.doesNotMatch(html, /data-t="foco"|data-t="rotina"/, 'foco e rotina saíram da barra principal');
    for (const t of ['treino', 'med', 'alim', 'rel', 'cfg']) {
      assert.match(html, new RegExp(`data-t="${t}"`), `aba ${t} presente`);
    }

    state.tela = 'alim';
    assert.match(tabs(), /data-t="alim" class="on"/);
    assert.doesNotMatch(tabs(), /data-t="cfg" class="on"/);

    for (const t of ['cfg', 'foco', 'rotina']) {
      state.tela = t;
      const atual = tabs();
      assert.match(atual, /data-t="cfg" class="on"/, `${t} acende a aba Ajustes`);
      assert.doesNotMatch(atual, /data-t="alim" class="on"/);
    }
  } finally {
    state.tela = tela;
  }
});

test('Ajustes abre com sub-abas Exibição, Foco e Rotina', () => {
  assert.equal((subTabsAjustes('cfg').match(/data-a="tela"/g) || []).length, 3);
  assert.match(subTabsAjustes('cfg'), />Exibição</);
  assert.match(subTabsAjustes('cfg'), /data-t="foco"/);
  assert.match(subTabsAjustes('cfg'), /data-t="rotina"/);

  assert.match(subTabsAjustes('foco'), /data-t="foco" class="on"/);
  assert.match(subTabsAjustes('rotina'), /data-t="rotina" class="on"/);
  assert.doesNotMatch(subTabsAjustes('rotina'), /data-t="cfg" class="on"/);
});

test('as três telas do Ajustes renderizam a barra de sub-abas', async () => {
  const tela = state.tela;
  const foco = { ...state.foco };
  try {
    const cfg = await configuracoes.telaConfiguracoes();
    assert.match(cfg, /class="tabs subtabs"/);
    assert.match(cfg, /data-t="foco"/);

    const rotina = rotinaTela.telaRotina();
    assert.match(rotina, /class="tabs subtabs"/);
    assert.match(rotina, /data-t="rotina" class="on"/);

    state.foco = { passo: 1, grupos: [], dias: 4 };
    const focoHtml = telaDe('foco').render();
    assert.match(focoHtml, /class="tabs subtabs"/);
    assert.match(focoHtml, /data-t="foco" class="on"/);
  } finally {
    state.tela = tela;
    state.foco = foco;
  }
});
