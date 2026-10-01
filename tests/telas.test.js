import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom, eventoCampo } from './helpers/dom.js';

instalarDom();

import { telaDe, registrarTela } from '../js/core/rotas.js';
import { state, store } from '../js/core/estado.js';
import { rotinaPadrao } from '../js/rotina-service.js';
import * as telas from '../js/telas/index.js';

const NOMES = ['treino', 'rotina', 'foco', 'med', 'alim', 'rel', 'cfg'];
const originais = Object.fromEntries(NOMES.map(n => [n, telaDe(n)]));

const snapshot = () => ({
  tela: state.tela,
  md: state.md,
  relSec: state.relSec,
  foco: { ...state.foco },
  rotina: store.rotina,
  rascunho: store.rotinaRascunho,
  medDraft: { ...store.medDraft },
  fila: store.fila
});
const original = snapshot();

function estubarTelas() {
  NOMES.forEach(n => registrarTela(n, { render: () => '<i>stub</i>' }));
}

beforeEach(() => {
  estubarTelas();
});

afterEach(() => {
  NOMES.forEach(n => registrarTela(n, originais[n]));
  Object.assign(state, { tela: original.tela, md: original.md, relSec: original.relSec });
  state.foco = { ...original.foco };
  store.rotina = original.rotina;
  store.rotinaRascunho = original.rascunho;
  store.medDraft = { ...original.medDraft };
  store.fila = original.fila;
});

test('every screen registers itself in the render registry', () => {
  for (const nome of NOMES) {
    const def = originais[nome];
    assert.ok(def, `tela "${nome}" não registrada`);
    assert.equal(typeof def.render, 'function');
  }
  assert.equal(typeof originais.treino.aposRender, 'function');
});

test('telaRotina renders the routine form from the draft', () => {
  restaurarTelas();
  store.rotina = null;
  store.rotinaRascunho = null;
  store.exercisesById = new Map();

  const html = telas.rotina.telaRotina();
  assert.match(html, /Minha rotina de treino/);
  assert.match(html, /data-a="rsalvar"/);
  assert.match(html, /data-a="rpadrao"/);
  assert.ok(store.rotinaRascunho, 'a prévia cria um rascunho editável');
  assert.equal(store.rotinaRascunho.origem, 'plano', 'só editar torna a rotina pessoal');
});

function restaurarTelas() {
  NOMES.forEach(n => registrarTela(n, originais[n]));
}

test('campoRotina mirrors routine fields into the draft only', () => {
  store.rotinaRascunho = rotinaPadrao();
  const el = { dataset: { d: 'seg', i: '0' }, value: '5' };

  assert.equal(telas.rotina.campoRotina('rserie', el), true);
  assert.equal(store.rotinaRascunho.treinos.seg.ex[0].series, '5');
  assert.equal(store.rotinaRascunho.origem, 'personalizada');

  assert.equal(telas.rotina.campoRotina('nota', el), false, 'campos de outras telas não são consumidos');
  assert.equal(telas.rotina.campoRotina('rtipo', el), false, 'selects vão pelo handler de change');

  store.rotinaRascunho = null;
  assert.equal(telas.rotina.campoRotina('rserie', el), true, 'sem rascunho o campo é consumido em silêncio');
});

test('rotina actions toggle days and restore the default plan', async () => {
  store.rotina = rotinaPadrao();
  store.rotinaRascunho = null;

  await telas.rotina.aoClicar('rdia', { dataset: { d: 'dom' } });
  assert.equal(store.rotinaRascunho.dias.dom, true);

  await telas.rotina.aoClicar('rdia', { dataset: { d: 'dom' } });
  assert.equal(store.rotinaRascunho.dias.dom, false);

  await telas.rotina.aoClicar('rpadrao', { dataset: {} });
  assert.equal(store.rotinaRascunho.origem, 'plano');
});

test('rotina change handler adds an exercise from the catalog', async () => {
  store.rotina = rotinaPadrao();
  store.rotinaRascunho = rotinaPadrao(); // a tela já criou o rascunho
  store.exercisesById = new Map([[1, { id: 1, nome: 'Supino reto', grupoMuscular: 'Peito' }]]);

  const el = { dataset: { k: 'radicionar', d: 'seg' }, value: 'Supino reto' };
  assert.equal(await telas.rotina.aoMudar(el), true);
  const ex = store.rotinaRascunho.treinos.seg.ex;
  assert.ok(ex.some(x => x.nome === 'Supino reto'));
  assert.equal(ex.find(x => x.nome === 'Supino reto').grupo, 'Peito');

  assert.equal(await telas.rotina.aoMudar({ dataset: { k: 'ctipo' }, value: 'x' }), false);
});

test('medidas actions pick the day and normalize the draft fields', async () => {
  await telas.medidas.aoClicar('mdia', { dataset: { d: '2026-03-02' } });
  assert.equal(state.md, '2026-03-02');

  const digitou = await telas.medidas.aoDigitar(eventoCampo({ k: 'm:peso' }, ' 72,4 '));
  assert.equal(digitou, true);
  assert.equal(store.medDraft.peso, '72,4');

  assert.equal(await telas.medidas.aoDigitar(eventoCampo({ k: 'peso' }, '1')), false);
});

test('relatorio actions switch the visible section', async () => {
  await telas.relatorio.aoClicar('relsec', { dataset: { v: 'alim' } });
  assert.equal(state.relSec, 'alim');

  await telas.relatorio.aoClicar('relsec', { dataset: { v: 'corpo' } });
  assert.equal(state.relSec, 'corpo');

  assert.equal(await telas.relatorio.aoClicar('outra', { dataset: {} }), false);
});

test('foco wizard builds a routine suggestion from chips and days', async () => {
  state.foco = { passo: 1, grupos: [], dias: 4 };
  store.rotina = rotinaPadrao();
  store.rotinaRascunho = null;

  assert.equal(await telas.foco.aoClicar('foco_grupo', { dataset: { g: 'peito' } }), true);
  assert.deepEqual(state.foco.grupos, ['peito']);

  assert.equal(await telas.foco.aoClicar('foco_dias', { dataset: { v: '5' } }), true);
  assert.equal(state.foco.dias, 5);

  assert.equal(await telas.foco.aoClicar('foco_gerar', { dataset: {} }), true);
  assert.equal(state.foco.passo, 3);
  assert.ok(store.rotinaRascunho);
  const ativos = Object.keys(store.rotinaRascunho.dias).filter(d => store.rotinaRascunho.dias[d]);
  assert.equal(ativos.length, 5);
  assert.equal(store.rotinaRascunho.origem, 'personalizada');

  assert.equal(await telas.foco.aoClicar('foco_refazer', { dataset: {} }), true);
  assert.equal(state.foco.passo, 1);
  assert.equal(store.rotinaRascunho, null);
});

test('foco screen renders every wizard step', () => {
  restaurarTelas();
  const desenhar = telaDe('foco').render;

  state.foco = { passo: 1, grupos: [], dias: 4 };
  const passo1 = desenhar();
  assert.match(passo1, /Orientação de treino/);
  assert.match(passo1, /data-a="foco_grupo"/);
  assert.match(passo1, /data-a="foco_colar"/);
  assert.match(passo1, /data-v="2" disabled/, 'Continuar bloqueado sem foco escolhido');

  state.foco = { passo: 1, grupos: [], dias: 4, colar: true };
  const colar = desenhar();
  assert.match(colar, /id="focoJson"/);
  assert.match(colar, /data-a="foco_carregar"/);
  assert.match(colar, /data-a="foco_cancelar"/);

  state.foco = { passo: 2, grupos: ['peito'], dias: 4 };
  const passo2 = desenhar();
  assert.match(passo2, /Quantos dias por semana/);
  assert.match(passo2, /data-a="foco_gerar"/);
  assert.match(passo2, /data-a="foco_dias" data-v="5"/);

  store.rotinaRascunho = rotinaPadrao();
  state.foco = { passo: 3, grupos: ['peito'], dias: 4 };
  const previa = desenhar();
  assert.match(previa, /Sugestão:/);
  assert.match(previa, /data-a="foco_aplicar"/);
  assert.match(previa, /data-a="foco_refazer"/);
});

test('global actions switch screens and open the importers', async () => {
  await telas.index; // barrel is already imported; kept for symmetry
  const globais = await import('../js/eventos/globais.js');

  assert.equal(await globais.aoClicar('tela', { dataset: { t: 'rel' } }), true);
  assert.equal(state.tela, 'rel');

  assert.equal(await globais.aoClicar('importar-backup', { dataset: {} }), true);
  assert.equal(await globais.aoClicar('importar-exemplo', { dataset: {} }), true);
  assert.equal(await globais.aoClicar('inexistente', { dataset: {} }), false);
});
