import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom, eventoCampo } from './helpers/dom.js';

instalarDom();

import {
  kcalDosMacros,
  porcaoDe,
  pendenteDeMacros,
  macrosIguais,
  backfillMacros,
  salvarReferencia,
  salvarMetaMacros,
  adicionarItem,
  removerAlimento,
  moverItem,
  reordenarRefeicoes
} from '../js/food-service.js';
import * as rotinaTela from '../js/telas/rotina.js';
import * as relatorioTela from '../js/telas/relatorio.js';
import * as medidasTela from '../js/telas/medidas.js';
import * as treinoTela from '../js/telas/treino.js';
import * as focoTela from '../js/telas/foco.js';
import * as globais from '../js/eventos/globais.js';
import * as alimentacaoTela from '../js/telas/alimentacao.js';
import { state } from '../js/core/estado.js';

test('kcalDosMacros derives calories from the 4/4/9 macros', () => {
  assert.equal(kcalDosMacros({ carb100: 0, gord100: 10, prot100: 20 }), 170);
  assert.equal(kcalDosMacros({ carb100: '25,5', gord100: '5', prot100: '10' }), 187, 'aceita vírgula decimal pt-BR');
  assert.equal(kcalDosMacros({ carb100: 0, gord100: 0, prot100: 0 }), 0);

  assert.equal(kcalDosMacros({ carb100: 10, prot100: 5 }), null, 'falta gordura');
  assert.equal(kcalDosMacros({ carb100: 10, gord100: null, prot100: 5 }), null, 'null não vale como referência');
  assert.equal(kcalDosMacros({ carb100: '', gord100: 5, prot100: 5 }), null, 'string vazia não vale');
  assert.equal(kcalDosMacros({ carb100: 'abc', gord100: 5, prot100: 5 }), null, 'texto não vale');
  assert.equal(kcalDosMacros(null), null);
  assert.equal(kcalDosMacros(undefined), null);
});

test('porcaoDe converts a per-100 g reference to the eaten portion', () => {
  assert.equal(porcaoDe(31.4, 150), 47.1);
  assert.equal(porcaoDe('31,4', 150), 47.1, 'aceita vírgula decimal pt-BR');
  assert.equal(porcaoDe('0', 200), 0, 'zero por 100 g é uma referência válida');

  assert.equal(porcaoDe(50, null), null, 'sem gramas não há conversão');
  assert.equal(porcaoDe(50, 0), null);
  assert.equal(porcaoDe(50, -10), null);
  assert.equal(porcaoDe(null, 150), null, 'sem referência não há conversão');
  assert.equal(porcaoDe('', 150), null);
  assert.equal(porcaoDe('abc', 150), null);
});

test('salvarMetaMacros validates the targets before touching the database', async () => {
  await assert.rejects(salvarMetaMacros({ prot: 'abc', carb: '250', gord: '70' }), /Meta de macro inválida/);
  await assert.rejects(salvarMetaMacros({ gord: '-5' }), /Meta de macro inválida/);
  await assert.rejects(salvarMetaMacros({ carb: 'x' }), /Meta de macro inválida/);

  // alvos válidos passam na validação e chegam ao banco
  // (no Node não há IndexedDB, então a falha vem do banco, não da validação)
  await assert.rejects(
    salvarMetaMacros({ prot: '130', carb: '250', gord: '70' }),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
  await assert.rejects(
    salvarMetaMacros({ prot: '', carb: '0', gord: undefined }),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message),
    'vazio e zero apenas limpam'
  );
});

test('salvarReferencia validates the field before reading the database', async () => {
  await assert.rejects(salvarReferencia('   ', '165'), /Informe o alimento/);
  await assert.rejects(salvarReferencia('Frango', 'abc', 'kcal100'), /Informe as calorias por 100 g/);
  await assert.rejects(salvarReferencia('Frango', '-3', 'kcal100'), /Informe as calorias por 100 g/);
  await assert.rejects(salvarReferencia('Frango', '-1', 'prot100'), /maior ou igual a zero/);
  await assert.rejects(salvarReferencia('Frango', '10', 'protein100'), /Referência inválida/);

  // valor válido: a validação passa e a leitura do catálogo chega ao banco
  await assert.rejects(
    salvarReferencia('Frango', '165', 'kcal100'),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
  await assert.rejects(
    salvarReferencia('Frango', '31', 'prot100'),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('adicionarItem rejects bad data before the database', async () => {
  await assert.rejects(
    adicionarItem({ data: '01/03/2026', refeicaoId: 'almoco', alimento: 'Frango', gramas: '150' }),
    /Data inválida/
  );
  await assert.rejects(
    adicionarItem({ data: '2026-03-01', refeicaoId: 'almoco', alimento: '  ' }),
    /Informe o alimento/
  );

  // dados válidos seguem para o banco (getRefeicoes → IndexedDB)
  await assert.rejects(
    adicionarItem({ data: '2026-03-01', refeicaoId: 'almoco', alimento: 'Frango', gramas: '150' }),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('pendenteDeMacros flags old records that still need macros', () => {
  assert.equal(pendenteDeMacros({ gramas: 150 }), true, 'registro antigo sem campos de macro');
  assert.equal(pendenteDeMacros({ gramas: 150, prot: 46.5 }), true, 'parcial continua pendente');
  assert.equal(pendenteDeMacros({ gramas: '150', carb: 0, prot: null, gord: null }), true);
  assert.equal(pendenteDeMacros({ gramas: 150, prot: 46.5, carb: 0, gord: 8.1 }), false, 'completo não reprocessa');
  assert.equal(pendenteDeMacros({ gramas: null, prot: null, carb: null, gord: null }), false, 'sem gramas não converte');
  assert.equal(pendenteDeMacros({ gramas: 0, prot: null, carb: null, gord: null }), false);
  assert.equal(pendenteDeMacros({}), false);
});

test('macrosIguais avoids rewriting entries that already match', () => {
  const completos = { prot: 46.5, carb: 0, gord: 8.1 };
  assert.equal(macrosIguais(completos, { prot: 46.5, carb: 0, gord: 8.1 }), true);
  assert.equal(macrosIguais({ prot: null, carb: undefined, gord: '' }, { prot: null, carb: null, gord: null }), true, 'nada gravado e nada a gravar');
  assert.equal(macrosIguais(completos, { prot: 56.2, carb: 0, gord: 8.1 }), false, 'valor diferente regrava');
  assert.equal(macrosIguais({ carb: 0, gord: 8.1 }, { prot: 46.5, carb: 0, gord: 8.1 }), false, 'faltando regrava');
  assert.equal(macrosIguais({ prot: '56,2', carb: 0, gord: 8.1 }, { prot: 56.2, carb: 0, gord: 8.1 }), false, 'texto vira número');
});

test('backfillMacros runs against the database', async () => {
  // no Node não há IndexedDB: a leitura dos registros falha no banco,
  // provando que a função está ligada ao caminho de persistência
  await assert.rejects(
    backfillMacros(),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
  await assert.rejects(
    backfillMacros('frango'),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('macro fields are consumed only by the alimentação screen', async () => {
  // change: só rotina, treino e alimentação têm aoMudar; as duas primeiras
  // precisam devolver false para alimmetaprot/alcarb, senão a fila trava
  assert.equal(await rotinaTela.aoMudar(eventoCampo({ k: 'alimmetaprot' }, '130')), false, 'rotina não engole alimmetaprot');
  assert.equal(await treinoTela.aoMudar(eventoCampo({ k: 'alimmetagord' }, '70')), false, 'treino não engole alimmetagord');

  // input: nenhuma tela trata as chaves de macro no evento de digitação
  const telas = [
    ['rotina', rotinaTela],
    ['relatorio', relatorioTela],
    ['medidas', medidasTela],
    ['treino', treinoTela],
    ['alimentacao', alimentacaoTela]
  ];
  for (const [nome, tela] of telas) {
    assert.equal(await tela.aoDigitar(eventoCampo({ k: 'alimmetaprot' }, '130')), false, `${nome} não engole alimmetaprot no input`);
    assert.equal(await tela.aoDigitar(eventoCampo({ k: 'alcarb' }, '20')), false, `${nome} não engole alcarb no input`);
  }

  // a alimentação consome as chaves de mudança (erros viram toast e devolvem true)
  assert.equal(await alimentacaoTela.aoMudar(eventoCampo({ k: 'alimmetaprot' }, '130')), true);
  assert.equal(await alimentacaoTela.aoMudar(eventoCampo({ k: 'alcarb', n: 'Frango' }, '20')), true);
  assert.equal(await alimentacaoTela.aoMudar(eventoCampo({ k: 'outro' }, 'x')), false);
});

test('removerAlimento validates the id before the database', async () => {
  await assert.rejects(removerAlimento(), /Alimento não encontrado/);
  await assert.rejects(removerAlimento(''), /Alimento não encontrado/);
  await assert.rejects(removerAlimento('abc'), /Alimento não encontrado/);
  await assert.rejects(removerAlimento(-2), /Alimento não encontrado/);

  // id válido: a validação passa e a remoção chega ao banco
  await assert.rejects(
    removerAlimento(7),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('moverItem validates the target meal before the database', async () => {
  await assert.rejects(moverItem(1, ''), /Escolha a refeição/);
  await assert.rejects(moverItem(1, null), /Escolha a refeição/);
  await assert.rejects(moverItem(1, '  '), /Escolha a refeição/);

  // destino desconhecido também não chega ao banco (getRefeicoes sim)
  await assert.rejects(
    moverItem(1, 'inexistente'),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('reordenarRefeicoes validates the id list before the database', async () => {
  await assert.rejects(reordenarRefeicoes(), /Ordem de refeições inválida/);
  await assert.rejects(reordenarRefeicoes('cafe'), /Ordem de refeições inválida/);
  await assert.rejects(reordenarRefeicoes([]), /Ordem de refeições inválida/);
  await assert.rejects(reordenarRefeicoes([1, 2]), /Ordem de refeições inválida/, 'ids precisam ser texto');
  await assert.rejects(reordenarRefeicoes(['cafe', null]), /Ordem de refeições inválida/);

  // lista bem formada: a leitura das refeições chega ao banco
  await assert.rejects(
    reordenarRefeicoes(['cafe', 'almoco']),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('catalog deletion action is consumed only by the alimentação screen', async () => {
  const b = { dataset: { a: 'alalimdel', v: '1', n: 'Iogurte', u: '0' } };

  // clique: todas as telas antes da alimentação precisam devolver false
  const outras = [
    ['globais', globais],
    ['treino', treinoTela],
    ['rotina', rotinaTela],
    ['foco', focoTela],
    ['medidas', medidasTela],
    ['relatorio', relatorioTela]
  ];
  for (const [nome, tela] of outras) {
    assert.equal(await tela.aoClicar('alalimdel', b), false, `${nome} não engole alalimdel`);
  }

  // a alimentação consome (sem confirm no stub de window, o banco falha no Node)
  assert.equal(await alimentacaoTela.aoClicar('alalimdel', b), true);
});

test('a linha do item do dia mostra a alça de arrastar no modo leitura', () => {
  const item = { id: 7, alimento: 'Frango grelhado', refeicaoId: 'almoco', gramas: 150, calorias: 247, kcal100: 165 };
  state.alimEdit = null;

  const leitura = alimentacaoTela.linhaItemDia(item);
  assert.match(leitura, /data-item="7"/);
  assert.match(leitura, /<span class="alca" data-alca/, 'alça presente na linha de leitura');
  assert.match(leitura, /⋮⋮/, 'símbolo de arrastar presente');
  assert.match(leitura, /title="Arraste para trocar de refeição"/);

  state.alimEdit = 7;
  try {
    const edicao = alimentacaoTela.linhaItemDia(item, '<option value="almoco">Almoço</option>');
    assert.doesNotMatch(edicao, /data-alca/, 'o editor não oferece arrastar');
    assert.match(edicao, /id="alimEditRef"/, 'o editor mostra o seletor de refeição');
  } finally {
    state.alimEdit = null;
  }
});

test('o formulário de novo alimento abre e fecha por botão', async () => {
  state.alimCriar = false;

  assert.equal(await alimentacaoTela.aoClicar('alcriar', { dataset: {} }), true);
  assert.equal(state.alimCriar, true, 'Criar item abre o formulário');

  assert.equal(await alimentacaoTela.aoClicar('alcancelar', { dataset: {} }), true);
  assert.equal(state.alimCriar, false, 'Cancelar fecha o formulário');

  assert.equal(await alimentacaoTela.aoClicar('inexistente', { dataset: {} }), false, 'ação desconhecida não é consumida');
});

test('a linha do catálogo repete o layout do formulário de criação', () => {
  const al = { id: 3, nome: 'Iogurte', exibicao: 'Iogurte natural', kcal100: 60, prot100: 20, carb100: 4, gord100: 9, vezes: 2 };
  const html = alimentacaoTela.linhaCatalogo(al);

  assert.match(html, /class="pl-li"/);
  assert.match(html, /<div class="frm">/, 'grade de 2 colunas igual ao formulário');
  assert.match(html, /<label>Calorias<\/label>/);
  assert.match(html, /<label>Proteína<\/label>/);
  assert.match(html, /<label>Carboidrato<\/label>/);
  assert.match(html, /<label>Gordura<\/label>/);
  assert.match(html, /data-k="alkcal"[^>]*value="60"/);
  assert.match(html, /data-a="alalimdel"/, 'botão de excluir presente');
  assert.match(html, /Iogurte natural/);
});

test('passoRolagem só rola junto às bordas e cresce quanto mais perto', () => {
  const p = alimentacaoTela.passoRolagem;
  const H = 800;

  assert.equal(p(400, H), 0, 'meio do ecrã não rola sozinho');
  assert.equal(p(200, H), 0);
  assert.equal(p(90, H), 0, 'fora da zona de 90px');
  assert.equal(p(710, H), 0, 'zona inferior também começa a 90px');

  assert.equal(p(0, H), 18, 'colado no topo rola no máximo');
  assert.equal(p(H, H), 18, 'colado na base rola no máximo');
  assert.equal(p(45, H), 9, 'meio da zona superior rola na metade');
  assert.equal(p(H - 45, H), 9, 'meio da zona inferior rola na metade');

  assert.ok(p(80, H) < p(20, H), 'quanto mais perto do topo, mais rápido');
  assert.ok(p(H - 80, H) < p(H - 20, H), 'quanto mais perto da base, mais rápido');

  assert.equal(p(-5, H), 0, 'posição inválida não rola');
  assert.equal(p(400, 0), 0, 'sem altura conhecida não rola');
});
