import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instalarDom } from './helpers/dom.js';

instalarDom();

import { salvarAjustes, AJUSTES_PADRAO } from '../js/ajustes-service.js';
import { tabs, subTabsAjustes } from '../js/core/render.js';
import { telaDe } from '../js/core/rotas.js';
import { state } from '../js/core/estado.js';
import { macroMeta, kpiDelta, barraCaloria, anelCaloria, kpiNoDia } from '../js/telas/alimentacao.js';
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

test('kpiDelta mostra o que falta e marca o que passou da meta', () => {
  assert.deepEqual(kpiDelta(600, 800), {
    txt: '200 kcal',
    legenda: 'faltam para a meta',
    cls: '',
    excedeu: false
  });
  assert.deepEqual(kpiDelta(800, 800), {
    txt: '0 kcal',
    legenda: 'faltam para a meta',
    cls: '',
    excedeu: false
  }, 'bater a meta não é exceder');

  const acima = kpiDelta(900, 800);
  assert.equal(acima.txt, '-100 kcal', 'o sinal negativo diz quanto passou');
  assert.equal(acima.legenda, 'acima da meta');
  assert.equal(acima.cls, 'neg', 'a classe neg pinta o KPI de vermelho');
  assert.equal(acima.excedeu, true);

  assert.deepEqual(kpiDelta(600, null), {
    txt: '—',
    legenda: 'defina uma meta diária',
    cls: '',
    excedeu: false
  });
  assert.deepEqual(kpiDelta(600, 0), {
    txt: '—',
    legenda: 'defina uma meta diária',
    cls: '',
    excedeu: false
  });
});

test('barraCaloria enche até a meta e fica vermelha ao passar dela', () => {
  const dentro = barraCaloria(400, 800, { circular: true, pct: true }, 'kpi-verde');
  assert.match(dentro, /class="barra-dia kpi-verde"/);
  assert.match(dentro, /width:50%/);
  assert.doesNotMatch(dentro, /<span>/, 'com o anel ligado o % fica no anel, não na barra');

  const barra = barraCaloria(400, 800, { circular: false, pct: true }, 'kpi-verde');
  assert.match(barra, /<span>50%<\/span>/, 'sem anel o % aparece ao lado da barra');

  const barraSem = barraCaloria(400, 800, { circular: false, pct: false }, 'kpi-verde');
  assert.doesNotMatch(barraSem, /<span>/, 'percentual desligado não mostra %');

  const acima = barraCaloria(900, 800, { circular: true, pct: true }, 'kpi-laranja');
  assert.match(acima, /width:100%/, 'a barra nunca passa de 100%');
  assert.match(acima, /class="barra-dia kpi-laranja"/, 'acima da meta a barra fica laranja');

  assert.equal(barraCaloria(400, null, { circular: true, pct: true }), '', 'sem meta não há barra');
});

test('anelCaloria fica vermelho ao passar da meta e some quando desligado', () => {
  const dentro = anelCaloria(400, 800, { circular: true, pct: true }, 'kpi-verde');
  assert.match(dentro, /class="macro-circ"/);
  assert.match(dentro, /class="anel kpi-verde"/);
  assert.match(dentro, /<span>50%<\/span>/);
  assert.doesNotMatch(dentro, /excedeu/);

  const cheio = anelCaloria(800, 800, { circular: true, pct: true }, 'kpi-verde');
  assert.match(cheio, /class="anel kpi-verde"/, 'bater na meta (100%) deixa o anel verde');
  assert.match(cheio, /<span>100%<\/span>/);

  const acima = anelCaloria(900, 800, { circular: true, pct: true }, 'kpi-laranja');
  assert.match(acima, /class="anel kpi-laranja"/, 'acima da meta o anel fica laranja');
  assert.match(acima, />113%/, 'centro mostra a porcentagem calculada');

  assert.equal(anelCaloria(400, 800, { circular: false, pct: true }), '', 'anel desligado não renderiza anel');
  assert.equal(anelCaloria(400, null, { circular: true, pct: true }), '', 'sem meta não há anel');
});

test('kpiNoDia junta o total do dia com o gráfico da meta do lado', () => {
  const circular = kpiNoDia(400, 800, { circular: true, pct: true });
  assert.match(circular, /<small class="kpi-rot[^"]*">kcal consumido<\/small>/, 'o card do consumido é rotulado');
  assert.match(circular, /<b>400 kcal<\/b>/, 'o total aparece');
  assert.match(circular, /<small class="kpi-rot">restante<\/small>/, 'o card do restante é rotulado');
  assert.match(circular, /400 kcal/, 'sobram 400 kcal');
  assert.match(circular, /class="macro-circ"/, 'com o círculo ligado o gráfico é o anel');
  assert.doesNotMatch(circular, /class="barra-dia"/, 'não renderiza os dois gráficos ao mesmo tempo');

  const barra = kpiNoDia(400, 800, { circular: false, pct: true });
  assert.match(barra, /class="barra-dia[^"]*"/, 'círculo desligado o gráfico vira barra');
  assert.match(barra, /<span>50%<\/span>/, 'a barra traz o percentual');
  assert.doesNotMatch(barra, /class="macro-circ"/);

  const semPct = kpiNoDia(400, 800, { circular: false, pct: false });
  assert.match(semPct, /class="barra-dia[^"]*"/);
  assert.doesNotMatch(semPct, /<span>/, 'percentual desligado não mostra %');

  const acima = kpiNoDia(1000, 800, { circular: true, pct: true });
  assert.match(acima, /class="kpi-laranja"/, '200 kcal acima o card fica laranja');

  const semMeta = kpiNoDia(400, null, { circular: true, pct: true });
  assert.match(semMeta, /<b[^>]*>400 kcal<\/b>/, 'sem meta o total continua aparecendo');
  assert.doesNotMatch(semMeta, /restante/, 'sem meta não há card de restante');
  assert.doesNotMatch(semMeta, /gráfico/, 'sem meta não há card de gráfico');
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

test('o resumo do dia separa a meta do dia e guarda o gráfico do lado', () => {
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.kpi\.kpi-larga\s*\{[^}]*grid-column:1\/-1/, 'os cards do resumo ocupam a linha toda');
  assert.doesNotMatch(css, /\.kpi\.kpi-centro/, 'o centralizador antigo da meta saiu');

  // kcal consumidas e o que falta na esquerda, o gráfico na direita
  assert.match(css, /\.dia-linha\s*\{[^}]*display:flex/, 'a linha do dia é flexível');
  assert.match(css, /\.dia-graf\s*\{[^}]*width:min\(56%/, 'o gráfico tem a faixa da direita');
  assert.match(css, /\.dia-delta\.neg\s*\{[^}]*var\(--err\)/, 'passar da meta deixa a legenda vermelha');

  // e o anel continua se centralizando sozinho no seu espaço
  assert.match(css, /\.anel\s*\{[^}]*margin:0 auto/, 'o círculo fica no meio do seu espaço');
});
