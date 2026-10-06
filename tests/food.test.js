import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  reordenarRefeicoes,
  totalGramas,
  totaisDaReceita,
  salvarPrato,
  unidadeDoAlimento,
  itemTrocaUnidade,
  salvarUnidadeAlimento
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
  assert.match(html, /<label>Calorias por 100 g<\/label>/, 'o rótulo diz a referência do alimento');
  assert.match(html, /<label>Proteína por 100 g<\/label>/);
  assert.match(html, /<label>Carboidrato por 100 g<\/label>/);
  assert.match(html, /<label>Gordura por 100 g<\/label>/);
  assert.match(html, /data-k="alkcal"[^>]*value="60"/);
  assert.match(html, /data-a="alalimdel"/, 'botão de excluir presente');
  assert.match(html, /Iogurte natural/);
});

test('passoRolagem só rola junto às bordas e sobe ou desce conforme a borda', () => {
  const p = alimentacaoTela.passoRolagem;
  const H = 800;

  assert.equal(p(400, H), 0, 'meio do ecrã não rola sozinho');
  assert.equal(p(200, H), 0);
  assert.equal(p(90, H), 0, 'fora da zona de 90px');
  assert.equal(p(710, H), 0, 'zona inferior também começa a 90px');

  assert.equal(p(0, H), -18, 'colado no topo a página sobe: os alvos de cima vêm ao dedo');
  assert.equal(p(H, H), 18, 'colado na base a página desce: os alvos de baixo sobem');
  assert.equal(p(45, H), -9, 'meio da zona superior sobe na metade');
  assert.equal(p(H - 45, H), 9, 'meio da zona inferior desce na metade');
  assert.equal(p(45, H), -p(H - 45, H), 'as bordas se espelham em sentidos opostos');

  assert.ok(Math.abs(p(80, H)) < Math.abs(p(20, H)), 'quanto mais perto do topo, mais rápido');
  assert.ok(p(H - 80, H) < p(H - 20, H), 'quanto mais perto da base, mais rápido');

  assert.equal(p(-5, H), 0, 'posição inválida não rola');
  assert.equal(p(400, 0), 0, 'sem altura conhecida não rola');
});

test('totalGramas normalizes the amount of every unit without failing', () => {
  assert.equal(totalGramas({ unidade: 'g', gramas: '150,5' }), 150.5, 'aceita vírgula pt-BR');
  assert.equal(totalGramas({ unidade: 'ml', gramas: '250' }), 250, '1 ml conta como 1 g');
  assert.equal(totalGramas({ unidade: 'un', qtd: '6', pesoUnit: '80' }), 480, 'unidades × peso médio');
  assert.equal(totalGramas({ unidade: 'un', qtd: '2,5', pesoUnit: '40' }), 100);

  assert.equal(totalGramas({ unidade: 'g' }), null, 'sem quantidade não tem total');
  assert.equal(totalGramas({ unidade: 'g', gramas: '' }), null);
  assert.equal(totalGramas({ unidade: 'g', gramas: 'abc' }), null, 'texto não vira número');
  assert.equal(totalGramas({ unidade: 'g', gramas: '-5' }), null, 'negativo é inválido');
  assert.equal(totalGramas({ unidade: 'un', qtd: '6' }), null, 'falta o peso médio');
  assert.equal(totalGramas({ unidade: 'un', pesoUnit: '80' }), null, 'falta a quantidade');
  assert.equal(totalGramas({ unidade: 'kg', gramas: '150' }), null, 'unidade desconhecida');
  assert.equal(totalGramas(), null);
  assert.equal(totalGramas(null), null);
});

test('adicionarItem validates the unit and the amount before the database', async () => {
  const base = { data: '2026-03-01', refeicaoId: 'almoco', alimento: 'Frango' };

  await assert.rejects(adicionarItem({ ...base, unidade: 'kg', gramas: '150' }), /Unidade inválida/);
  await assert.rejects(adicionarItem({ ...base, unidade: 'g' }), /Informe as gramas/);
  await assert.rejects(adicionarItem({ ...base, unidade: 'g', gramas: 'abc' }), /Gramas inválidas/);
  await assert.rejects(adicionarItem({ ...base, unidade: 'ml' }), /Informe os ml/);
  await assert.rejects(adicionarItem({ ...base, unidade: 'ml', gramas: '0' }), /Ml inválidos/);
  await assert.rejects(adicionarItem({ ...base, unidade: 'un' }), /Informe as unidades/);
  await assert.rejects(adicionarItem({ ...base, unidade: 'un', qtd: '6' }), /Informe o peso médio por unidade/);
  await assert.rejects(adicionarItem({ ...base, unidade: 'un', qtd: '0', pesoUnit: '60' }), /Unidades inválidas/);
  await assert.rejects(adicionarItem({ ...base, unidade: 'un', qtd: '6', pesoUnit: '-60' }), /Peso médio inválido/);

  // quantidade válida: a validação passa e a leitura das refeições chega ao banco
  await assert.rejects(
    adicionarItem({ ...base, unidade: 'un', qtd: '6', pesoUnit: '60' }),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
  await assert.rejects(
    adicionarItem({ ...base, unidade: 'ml', gramas: '250' }),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('totaisDaReceita sums the ingredients and refuses bad lists', () => {
  const itens = [
    { alimento: 'Frango grelhado', gramas: 150, kcal100: 165, prot100: 31, carb100: 0, gord100: 3.6 },
    { alimento: 'Arroz cozido', gramas: '100', kcal100: 128, prot100: 2.7, carb100: 28, gord100: 0.3 }
  ];
  assert.deepEqual(totaisDaReceita(itens), {
    gramas: 250,
    kcal: 375.5,
    prot: 49.2,
    carb: 28,
    gord: 5.7
  });

  // sem calorias declaradas, os macros 4/4/9 entram no lugar
  assert.equal(
    totaisDaReceita([{ alimento: 'Frango', gramas: 100, prot100: 20, carb100: 0, gord100: 0 }]).kcal,
    80
  );

  assert.throws(() => totaisDaReceita([]), /Adicione ao menos um ingrediente/);
  assert.throws(() => totaisDaReceita(), /Adicione ao menos um ingrediente/);
  assert.throws(() => totaisDaReceita([{ alimento: 'X', gramas: 0 }]), /Quantidade inválida de X/);
  assert.throws(() => totaisDaReceita([{ alimento: 'X', gramas: 'abc' }]), /Quantidade inválida de X/);
  assert.throws(() => totaisDaReceita([{ alimento: 'X', gramas: 100 }]), /X não tem referências por 100 g/);
});

test('salvarPrato validates the dish before the database', async () => {
  await assert.rejects(salvarPrato(), /Informe o nome do prato/);
  await assert.rejects(salvarPrato({ nome: '   ' }), /Informe o nome do prato/);
  await assert.rejects(salvarPrato({ nome: 'Frango com arroz' }), /Adicione ao menos um ingrediente/);
  await assert.rejects(
    salvarPrato({ nome: 'Frango com arroz', ingredientes: [{ alimento: '   ' }] }),
    /Adicione ao menos um ingrediente/
  );

  // nome e lista válidos: a validação passa e a resolução do ingrediente chega ao banco
  await assert.rejects(
    salvarPrato({ nome: 'Frango com arroz', ingredientes: [{ alimento: 'Frango grelhado', gramas: 150 }] }),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('qtdItemTxt mostra a quantidade com a unidade certa', () => {
  assert.equal(alimentacaoTela.qtdItemTxt({ unidade: 'g', gramas: 150 }), '150 g · ');
  assert.equal(alimentacaoTela.qtdItemTxt({ unidade: 'ml', gramas: 250 }), '250 ml · ');
  assert.equal(alimentacaoTela.qtdItemTxt({ unidade: 'un', qtd: 6, pesoUnit: 80, gramas: 480 }), '6 un × 80 g · ');
  assert.equal(
    alimentacaoTela.qtdItemTxt({ unidade: 'un', qtd: null, pesoUnit: null, gramas: 120 }),
    '120 g · ',
    'sem quantidade registrada, cai no total'
  );
  assert.equal(alimentacaoTela.qtdItemTxt({ unidade: 'g', gramas: null }), '', 'sem quantidade não mostra nada');
  assert.equal(alimentacaoTela.qtdItemTxt({}), '');
  assert.equal(alimentacaoTela.qtdItemTxt(null), '');
});

test('a tela monta o resumo com meta em cima e o dia com o gráfico do lado', () => {
  const antes = { alimPrato: state.alimPrato, alimUnidade: state.alimUnidade, alimRef: state.alimRef };
  try {
    state.alimPrato = false;
    state.alimUnidade = 'g';

    const html = alimentacaoTela.corpoAlimentacao({
      data: '2026-03-01',
      resumoDia: {
        total: 1000,
        meta: 800,
        metaMacros: { prot: 130, carb: null, gord: null },
        macros: { prot: 45, carb: 0, gord: 10 },
        porRefeicao: [{ id: 'almoco', nome: 'Almoço', total: 1000, itens: [] }]
      },
      refeicoes: [{ id: 'cafe', nome: 'Café da manhã' }, { id: 'almoco', nome: 'Almoço' }],
      catalogo: { itens: [], temMais: false, total: 0 },
      todosAlimentos: null
    });

    assert.match(html, /<small class="kpi-rot">kcal meta<\/small>/, 'o resumo começa pela meta');
    assert.equal((html.match(/data-k="alimmeta"/g) || []).length, 1, 'a meta calórica aparece uma única vez');
    assert.match(html, /<small class="kpi-rot">kcal no dia<\/small>/, 'depois vem o card do dia');
    assert.match(html, /<b>1\.000 kcal<\/b>/, 'o card do dia mostra o total consumido');
    assert.match(html, /class="dia-delta neg">-200 kcal · acima da meta</, 'passou 200 kcal da meta');

    assert.match(html, /class="kpi kpi-larga kpi-dia neg"/, 'o card do dia fica negativo ao passar da meta');
    assert.match(html, /class="macro-circ"/, 'com o círculo ligado o gráfico é o anel');
    assert.doesNotMatch(html, /class="barra-dia"/, 'um gráfico só: a barra não aparece junto do anel');
    assert.ok(html.indexOf('kcal meta') < html.indexOf('kcal no dia'), 'a meta vem antes do dia');

    assert.match(html, /<h2>Alimentos por 100 g \/ 100 ml<\/h2>/, 'o catálogo anuncia as duas referências');

    assert.equal((html.match(/data-a="alimun"/g) || []).length, 3, 'g, ml e unidades');
    assert.match(html, /data-a="alimun" data-v="un"/);
    assert.match(html, /id="alimG"/, 'em gramas o campo é um só');
    assert.match(html, /<label>Gramas<\/label>/);
    assert.doesNotMatch(html, /id="alimQtd"/);

    assert.match(html, /data-a="pratoabrir"/, 'o prato começa fechado');
    assert.doesNotMatch(html, /id="pratoLista"/, 'sem datalist sem prato aberto');
  } finally {
    state.alimPrato = antes.alimPrato;
    state.alimUnidade = antes.alimUnidade;
    state.alimRef = antes.alimRef;
  }
});

test('a tela troca os campos conforme a unidade e abre o prato', () => {
  const antes = { alimPrato: state.alimPrato, alimUnidade: state.alimUnidade, alimRef: state.alimRef };
  const base = {
    data: '2026-03-01',
    resumoDia: {
      total: 0,
      meta: null,
      metaMacros: { prot: null, carb: null, gord: null },
      macros: { prot: 0, carb: 0, gord: 0 },
      porRefeicao: [{ id: 'almoco', nome: 'Almoço', total: 0, itens: [] }]
    },
    refeicoes: [{ id: 'almoco', nome: 'Almoço' }],
    catalogo: { itens: [], temMais: false, total: 0 },
    todosAlimentos: null
  };
  try {
    state.alimPrato = false;

    state.alimUnidade = 'ml';
    const ml = alimentacaoTela.corpoAlimentacao(base);
    assert.match(ml, /<label>Mililitros<\/label>/);
    assert.match(ml, /data-a="alimun" data-v="ml" aria-pressed="true"/, 'ml fica acesa');
    assert.match(ml, /id="alimG"/, 'ml usa o mesmo campo de quantidade');
    assert.doesNotMatch(ml, /id="alimQtd"/);

    state.alimUnidade = 'un';
    const un = alimentacaoTela.corpoAlimentacao(base);
    assert.match(un, /id="alimQtd"/, 'unidades pedem a quantidade');
    assert.match(un, /id="alimPeso"/, 'unidades pedem o peso médio');
    assert.doesNotMatch(un, /id="alimG"/);
    assert.match(un, /data-a="alimun" data-v="un" aria-pressed="true"/, 'unidades fica acesa');
    assert.match(un, /<small class="dia-delta">defina uma meta diária<\/small>/, 'sem meta o card do dia explica');
    assert.doesNotMatch(un, /class="dia-graf"/, 'sem meta não sobra gráfico');

    state.alimUnidade = 'g';
    state.alimPrato = true;
    const prato = alimentacaoTela.corpoAlimentacao({
      ...base,
      todosAlimentos: [{ exibicao: 'Frango grelhado' }, { exibicao: 'Arroz cozido' }]
    });
    assert.match(prato, /<datalist id="pratoLista">/, 'o prato abre com a lista de ingredientes');
    assert.match(prato, /<option value="Frango grelhado">/);
    assert.match(prato, /data-a="pratoadd"/, 'botão de somar ingrediente');
    assert.match(prato, /data-a="pratosalvar"/, 'botão de salvar o prato');
    assert.match(prato, /data-a="pratocancelar"/);
    assert.doesNotMatch(prato, /data-a="pratoabrir"/, 'aberto não mostra o botão de abrir');
  } finally {
    state.alimPrato = antes.alimPrato;
    state.alimUnidade = antes.alimUnidade;
    state.alimRef = antes.alimRef;
  }
});

test('o editor do item troca os campos conforme a unidade', () => {
  const item = {
    id: 7,
    alimento: 'Ovos',
    refeicaoId: 'almoco',
    unidade: 'un',
    qtd: 6,
    pesoUnit: 60,
    gramas: 360,
    calorias: 432,
    kcal100: 120
  };
  const antes = { edit: state.alimEdit, ref: state.alimEditRef, un: state.alimEditUnidade };
  try {
    state.alimEdit = 7;
    state.alimEditRef = 120;
    state.alimEditUnidade = 'un';

    const un = alimentacaoTela.linhaItemDia(item, '<option value="almoco">Almoço</option>');
    assert.match(un, /id="alimEditUn"/, 'o editor tem seletor de unidade');
    assert.match(un, /<option value="un" selected>unidades<\/option>/);
    assert.match(un, /id="alimEditQtd"[^>]*value="6"/);
    assert.match(un, /id="alimEditPeso"[^>]*value="60"/);
    assert.doesNotMatch(un, /id="alimEditG"/, 'sem campo de gramas em unidades');
    assert.match(un, /id="alimEditK"[^>]*value="432"/, 'as calorias vêm da conversão do total');
    assert.match(un, /total 360 g/, 'o total em gramas fica visível');

    state.alimEditUnidade = 'g';
    const g = alimentacaoTela.linhaItemDia(item, '<option value="almoco">Almoço</option>');
    assert.match(g, /id="alimEditG"[^>]*value="360"/, 'voltando para gramas o total vira o campo');
    assert.match(g, /<option value="g" selected>g<\/option>/);
    assert.doesNotMatch(g, /id="alimEditQtd"/);

    const leitura = (() => {
      state.alimEdit = null;
      return alimentacaoTela.linhaItemDia({ ...item, gramas: 360, qtd: 6, pesoUnit: 60 });
    })();
    assert.match(leitura, /6 un × 60 g · 432 kcal/, 'a linha de leitura mostra a quantidade real');
  } finally {
    state.alimEdit = antes.edit;
    state.alimEditRef = antes.ref;
    state.alimEditUnidade = antes.un;
  }
});

test('totaisReceitaTxt mostra o total do prato ou o erro', () => {
  assert.equal(alimentacaoTela.totaisReceitaTxt([]), '', 'sem ingrediente não mostra nada');
  assert.equal(alimentacaoTela.totaisReceitaTxt(null), '');

  const ok = alimentacaoTela.totaisReceitaTxt([
    { alimento: 'Frango grelhado', gramas: 150, kcal100: 165, prot100: 31, carb100: 0, gord100: 3.6 }
  ]);
  assert.match(ok, /Totais do prato/);
  assert.match(ok, /150 g · 247,5 kcal · proteína 46,5 g/);

  const erro = alimentacaoTela.totaisReceitaTxt([{ alimento: 'X', gramas: 100 }]);
  assert.match(erro, /X não tem referências por 100 g/);
  assert.match(erro, /color:var\(--warn\)/, 'o erro fica destacado');
});

test('as ações de unidade e de prato são consumidas e mantêm o rascunho', async () => {
  const antes = {
    alimPrato: state.alimPrato,
    alimUnidade: state.alimUnidade,
    alimReceita: { ...state.alimReceita },
    alimEditUnidade: state.alimEditUnidade
  };
  try {
    state.alimPrato = false;
    state.alimUnidade = 'g';
    state.alimReceita = { nome: '', itens: [] };

    // unidade: troca a unidade e desconhecida cai em gramas
    assert.equal(await alimentacaoTela.aoClicar('alimun', { dataset: { v: 'un' } }), true);
    assert.equal(state.alimUnidade, 'un');
    assert.equal(await alimentacaoTela.aoClicar('alimun', { dataset: { v: 'banana' } }), true);
    assert.equal(state.alimUnidade, 'g', 'unidade desconhecida volta para gramas');
    assert.equal(await alimentacaoTela.aoClicar('alimun', { dataset: { v: 'g' } }), true, 'mesma unidade não refaz nada');

    // prato: abre, recusa entrada incompleta e cancela limpa
    assert.equal(await alimentacaoTela.aoClicar('pratoabrir', { dataset: {} }), true);
    assert.equal(state.alimPrato, true);

    assert.equal(await alimentacaoTela.aoClicar('pratoadd', { dataset: {} }), true, 'sem ingrediente vira aviso');
    assert.deepEqual(state.alimReceita.itens, [], 'nada entrou no rascunho');

    assert.equal(await alimentacaoTela.aoClicar('pratosalvar', { dataset: {} }), true, 'sem nome vira aviso');
    assert.equal(state.alimPrato, true, 'a falha não fecha o prato');

    state.alimReceita = { nome: 'Frango com arroz', itens: [{ alimento: 'Frango grelhado', gramas: 150 }] };
    assert.equal(await alimentacaoTela.aoClicar('pratorem', { dataset: { v: '0' } }), true);
    assert.deepEqual(state.alimReceita.itens, [], 'remove pelo índice');

    assert.equal(await alimentacaoTela.aoClicar('pratocancelar', { dataset: {} }), true);
    assert.equal(state.alimPrato, false);
    assert.deepEqual(state.alimReceita, { nome: '', itens: [] });

    // campos do rascunho e do editor sem banco
    assert.equal(await alimentacaoTela.aoDigitar(eventoCampo({ k: 'pratoNome' }, 'Frango com arroz')), true);
    assert.equal(state.alimReceita.nome, 'Frango com arroz');
    assert.equal(await alimentacaoTela.aoDigitar(eventoCampo({ k: 'alimQtd' }, '6')), true);
    assert.equal(await alimentacaoTela.aoDigitar(eventoCampo({ k: 'alimPeso' }, '60')), true);
    assert.equal(await alimentacaoTela.aoDigitar(eventoCampo({ k: 'pratoIng' }, '')), true);

    assert.equal(await alimentacaoTela.aoMudar(eventoCampo({ k: 'alimEditUn' }, 'un')), true);
    assert.equal(state.alimEditUnidade, 'un');
    assert.equal(await alimentacaoTela.aoMudar(eventoCampo({ k: 'alimEditUn' }, 'x')), true);
    assert.equal(state.alimEditUnidade, 'g', 'unidade inválida do editor cai em gramas');
  } finally {
    state.alimPrato = antes.alimPrato;
    state.alimUnidade = antes.alimUnidade;
    state.alimReceita = antes.alimReceita;
    state.alimEditUnidade = antes.alimEditUnidade;
  }
});

test('unidadeDoAlimento diz em que unidade o alimento é medido', () => {
  assert.equal(unidadeDoAlimento({ unidade: 'ml' }), 'ml');
  assert.equal(unidadeDoAlimento({ unidade: 'ML' }), 'ml', 'aceita maiúsculas');
  assert.equal(unidadeDoAlimento({ unidade: 'g' }), 'g');
  assert.equal(unidadeDoAlimento({}), 'g', 'salvo antes da unidade continua em gramas');
  assert.equal(unidadeDoAlimento({ unidade: 'un' }), 'g', 'peça não é unidade de medida');
  assert.equal(unidadeDoAlimento(null), 'g');
  assert.equal(unidadeDoAlimento(), 'g');
});

test('itemTrocaUnidade escolhe os registros que acompanham a troca g ⇄ ml', () => {
  const chave = 'ketchup';

  assert.equal(itemTrocaUnidade({ alimento: 'Ketchup', unidade: 'g', gramas: 150 }, chave, 'ml'), true, 'g vira ml');
  assert.equal(itemTrocaUnidade({ alimento: 'Ketchup', unidade: 'ml', gramas: 150 }, chave, 'ml'), false, 'já está em ml');
  assert.equal(itemTrocaUnidade({ alimento: 'Ketchup', unidade: 'ml', gramas: 150 }, chave, 'g'), true, 'ml vira g');
  assert.equal(itemTrocaUnidade({ alimento: 'Ketchup', unidade: 'g', gramas: 150 }, chave, 'g'), false, 'mesma unidade não mexe');

  assert.equal(itemTrocaUnidade({ alimento: 'Ketchup', unidade: 'un', qtd: 1, pesoUnit: 90 }, chave, 'ml'), false, 'unidades ficam como estão');
  assert.equal(itemTrocaUnidade({ alimento: 'Ketchup', gramas: 150 }, chave, 'ml'), true, 'registro antigo sem unidade acompanha');
  assert.equal(itemTrocaUnidade({ alimento: 'Ketchup', gramas: 150 }, chave, 'g'), false, 'sem unidade já é em gramas');
  assert.equal(itemTrocaUnidade({ alimento: 'Mostarda', unidade: 'g', gramas: 30 }, chave, 'ml'), false, 'outro alimento não muda');
  assert.equal(itemTrocaUnidade(null, chave, 'ml'), false);
});

test('salvarUnidadeAlimento valida antes de ir ao banco', async () => {
  await assert.rejects(salvarUnidadeAlimento(), /Informe o alimento/);
  await assert.rejects(salvarUnidadeAlimento('   '), /Informe o alimento/);
  await assert.rejects(salvarUnidadeAlimento('Ketchup', 'un'), /Unidade inválida/, 'só g ou ml');
  await assert.rejects(salvarUnidadeAlimento('Ketchup', 'kg'), /Unidade inválida/);

  // unidade válida: a validação passa e a leitura do alimento chega ao banco
  await assert.rejects(
    salvarUnidadeAlimento('Ketchup', 'ml'),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('adicionarItem sem unidade explícita valida em gramas e chega ao banco', async () => {
  const base = { data: '2026-03-01', refeicaoId: 'almoco', alimento: 'Requeijão' };

  await assert.rejects(adicionarItem(base), /Informe as gramas/, 'sem quantidade continua falhando em gramas');
  await assert.rejects(
    adicionarItem({ ...base, gramas: '100' }),
    err => err instanceof ReferenceError && /indexedDB/.test(err.message)
  );
});

test('o formulário de criação e a linha do catálogo pedem a unidade g ou ml', () => {
  const antes = {
    alimCriar: state.alimCriar,
    alimPrato: state.alimPrato,
    alimRef: state.alimRef,
    alimUnidade: state.alimUnidade,
    alimNome: state.alimNome
  };
  try {
    state.alimPrato = false;
    state.alimUnidade = 'g';

    state.alimCriar = true;
    const html = alimentacaoTela.corpoAlimentacao({
      data: '2026-03-01',
      resumoDia: {
        total: 0,
        meta: null,
        metaMacros: { prot: null, carb: null, gord: null },
        macros: { prot: 0, carb: 0, gord: 0 },
        porRefeicao: [{ id: 'almoco', nome: 'Almoço', total: 0, itens: [] }]
      },
      refeicoes: [{ id: 'almoco', nome: 'Almoço' }],
      catalogo: { itens: [], temMais: false, total: 0 },
      todosAlimentos: null
    });
    assert.match(html, /id="alimUnNovo"/, 'a criação pede a unidade do alimento');
    assert.match(html, /<option value="g">g<\/option><option value="ml">ml<\/option>/, 'g e ml são as opções');
    assert.match(html, /data-k="alimunnovo"/, 'a unidade escolhida reescreve os rótulos');
    assert.match(html, /<label data-rot100="Calorias">Calorias por 100 g<\/label>/, 'os campos já falam da referência');
    assert.match(html, /<label data-rot100="Gordura">Gordura por 100 g<\/label>/);

    state.alimCriar = false;
    state.alimNome = 'Requeijão';
    const comNome = alimentacaoTela.corpoAlimentacao({
      data: '2026-03-01',
      resumoDia: {
        total: 0,
        meta: null,
        metaMacros: { prot: null, carb: null, gord: null },
        macros: { prot: 0, carb: 0, gord: 0 },
        porRefeicao: [{ id: 'almoco', nome: 'Almoço', total: 0, itens: [] }]
      },
      refeicoes: [{ id: 'almoco', nome: 'Almoço' }],
      catalogo: { itens: [], temMais: false, total: 0 },
      todosAlimentos: null
    });
    assert.match(comNome, /id="alimNome"[^>]*value="Requeijão"/, 'o alimento escolhido sobrevive ao repaint');

    const ml = alimentacaoTela.linhaCatalogo({ id: 3, nome: 'requeijao', exibicao: 'Requeijão', kcal100: 120, vezes: 1, unidade: 'ml' });
    assert.match(ml, /data-k="alunid"/, 'a linha do catálogo troca a unidade');
    assert.match(ml, /<option value="ml" selected>ml<\/option>/, 'o ml fica marcado');
    assert.match(ml, /aria-label="Calorias por 100 ml de Requeijão"/, 'os campos falam da unidade certa');
    assert.match(ml, /<label>Calorias por 100 ml<\/label>/, 'o rótulo visível acompanha a troca');

    const antigo = alimentacaoTela.linhaCatalogo({ nome: 'Iogurte', kcal100: 60, vezes: 0 });
    assert.match(antigo, /<option value="g" selected>g<\/option>/, 'sem unidade declarada é gramas');
    assert.match(antigo, /aria-label="Calorias por 100 g de Iogurte"/);
  } finally {
    state.alimCriar = antes.alimCriar;
    state.alimPrato = antes.alimPrato;
    state.alimRef = antes.alimRef;
    state.alimUnidade = antes.alimUnidade;
    state.alimNome = antes.alimNome;
  }
});

test('seguirUnidadeDoAlimento só troca quando o alimento declara outra unidade', async () => {
  const antes = state.alimUnidade;
  try {
    state.alimUnidade = 'g';
    assert.equal(await alimentacaoTela.seguirUnidadeDoAlimento(''), false, 'sem alimento não há o que seguir');

    // sem catálogo aberto a unidade permanece a mesma (nada quebra)
    assert.equal(await alimentacaoTela.seguirUnidadeDoAlimento('Requeijão'), false);
    assert.equal(state.alimUnidade, 'g');

    state.alimUnidade = 'un';
    assert.equal(await alimentacaoTela.seguirUnidadeDoAlimento('Requeijão'), false, 'unidades não são empurradas');
    assert.equal(state.alimUnidade, 'un');
  } finally {
    state.alimUnidade = antes;
  }
});

test('trocar a unidade no catálogo é consumido pela tela', async () => {
  const el = eventoCampo({ k: 'alunid', n: 'Requeijão' }, 'ml');
  assert.equal(await alimentacaoTela.aoMudar(el), true, 'a troca é da alimentação');
  assert.equal(await alimentacaoTela.aoMudar(eventoCampo({ k: 'desconhecido' }, '')), false, 'campo de outra tela não é engolido');
});

test('a criação relê os rótulos como "por 100 ml" quando a unidade muda', async () => {
  const rotulos = [
    { dataset: { rot100: 'Calorias' }, textContent: 'Calorias por 100 g' },
    { dataset: { rot100: 'Proteína' }, textContent: 'Proteína por 100 g' }
  ];
  const original = document.querySelectorAll;
  document.querySelectorAll = seletor => (seletor === '[data-rot100]' ? rotulos : []);
  try {
    assert.equal(await alimentacaoTela.aoMudar(eventoCampo({ k: 'alimunnovo' }, 'ml')), true, 'a troca é da alimentação');
    assert.equal(rotulos[0].textContent, 'Calorias por 100 ml');
    assert.equal(rotulos[1].textContent, 'Proteína por 100 ml');

    await alimentacaoTela.aoMudar(eventoCampo({ k: 'alimunnovo' }, 'g'));
    assert.equal(rotulos[0].textContent, 'Calorias por 100 g', 'volta para gramas');
  } finally {
    document.querySelectorAll = original;
  }
});

test('a unidade travada ocupa o lugar de uma opção acesa', () => {
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.unid-seg \.unid-lock\s*\{[^}]*display:grid/, 'o cadeado rende no espaço de um botão');
  assert.match(css, /\.unid-seg \.unid-lock\s*\{[^}]*background:var\(--card\)/, 'e herda o visual da opção acesa');
});

test('planoUnidade só destrava a unidade quando o alimento declara g ou ml', () => {
  assert.deepEqual(alimentacaoTela.planoUnidade({ nome: 'Requeijão', unidade: 'ml' }, 'g'), { unidade: 'ml', auto: true });
  assert.deepEqual(alimentacaoTela.planoUnidade({ nome: 'Frango', unidade: 'g' }, 'ml'), { unidade: 'g', auto: true });
  assert.deepEqual(alimentacaoTela.planoUnidade({ nome: 'Iogurte' }, 'ml'), { unidade: 'ml', auto: false }, 'salvo antes da unidade continua manual');
  assert.deepEqual(alimentacaoTela.planoUnidade(null, 'ml'), { unidade: 'ml', auto: false }, 'texto livre é manual');
  assert.deepEqual(alimentacaoTela.planoUnidade({ nome: 'Ovo', unidade: 'ml' }, 'un'), { unidade: 'un', auto: false }, 'peças nunca são empurradas');
  assert.deepEqual(alimentacaoTela.planoUnidade({ nome: 'X' }, null), { unidade: 'g', auto: false });
});

test('segUnidade entrega a unidade do alimento e só deixa escolher peças', () => {
  const ml = alimentacaoTela.segUnidade(true, 'ml');
  assert.match(ml, /class="unid-lock"[^>]*>ml</, 'a unidade aparece travada');
  assert.match(ml, /data-v="un"/, 'peças continuam à escolha');
  assert.doesNotMatch(ml, /data-v="g"/, 'sem trocar para gramas');
  assert.doesNotMatch(ml, /data-v="ml"/, 'nem para a própria unidade');

  const livre = alimentacaoTela.segUnidade(false, 'g');
  assert.doesNotMatch(livre, /unid-lock/);
  assert.equal((livre.match(/data-a="alimun"/g) || []).length, 3, 'manual mantém g, ml e unidades');
  assert.match(livre, /data-v="g" aria-pressed="true"/, 'a atual fica acesa');
});

test('o registro mostra a unidade do alimento travada e pede os ml', () => {
  const base = {
    data: '2026-03-01',
    resumoDia: {
      total: 0,
      meta: null,
      metaMacros: { prot: null, carb: null, gord: null },
      macros: { prot: 0, carb: 0, gord: 0 },
      porRefeicao: [{ id: 'almoco', nome: 'Almoço', total: 0, itens: [] }]
    },
    refeicoes: [{ id: 'almoco', nome: 'Almoço' }],
    catalogo: { itens: [], temMais: false, total: 0 },
    todosAlimentos: null
  };
  const antes = {
    alimPrato: state.alimPrato,
    alimUnidade: state.alimUnidade,
    alimUnidadeAuto: state.alimUnidadeAuto,
    alimNome: state.alimNome
  };
  try {
    state.alimPrato = false;
    state.alimNome = 'Requeijão';
    state.alimUnidade = 'ml';
    state.alimUnidadeAuto = true;

    const html = alimentacaoTela.corpoAlimentacao(base);
    assert.match(html, /<label>Unidade do alimento<\/label>/, 'o rótulo diz de quem é a unidade');
    assert.match(html, /class="unid-lock"[^>]*>ml</);
    assert.doesNotMatch(html, /data-a="alimun" data-v="ml"/, 'não dá para trocar g × ml');
    assert.match(html, /data-a="alimun" data-v="un"/, 'peças ficam à mão');
    assert.match(html, /<label>Mililitros<\/label>/, 'o campo pede os ml');

    state.alimUnidadeAuto = false;
    const manual = alimentacaoTela.corpoAlimentacao(base);
    assert.match(manual, /<label>Unidade<\/label>/, 'sem a trava a troca volta');
    assert.equal((manual.match(/data-a="alimun"/g) || []).length, 3, 'g, ml e unidades');
  } finally {
    state.alimPrato = antes.alimPrato;
    state.alimUnidade = antes.alimUnidade;
    state.alimUnidadeAuto = antes.alimUnidadeAuto;
    state.alimNome = antes.alimNome;
  }
});

test('limpar o alimento e escolher peças devolvem a troca livre de unidade', async () => {
  const antes = { alimUnidade: state.alimUnidade, alimUnidadeAuto: state.alimUnidadeAuto };
  try {
    state.alimUnidade = 'ml';
    state.alimUnidadeAuto = true;
    assert.equal(await alimentacaoTela.seguirUnidadeDoAlimento(''), true, 'repaint para abrir a troca');
    assert.equal(state.alimUnidadeAuto, false, 'texto livre volta a ser manual');
    assert.equal(state.alimUnidade, 'ml', 'a unidade fica onde estava');
    assert.equal(await alimentacaoTela.seguirUnidadeDoAlimento(''), false, 'sem mudança não repinta');

    state.alimUnidade = 'ml';
    state.alimUnidadeAuto = true;
    assert.equal(await alimentacaoTela.aoClicar('alimun', { dataset: { v: 'un' } }), true, 'a escolha de peças é da alimentação');
    assert.equal(state.alimUnidade, 'un');
    assert.equal(state.alimUnidadeAuto, false, 'escolher peças destrava o g × ml');
  } finally {
    state.alimUnidade = antes.alimUnidade;
    state.alimUnidadeAuto = antes.alimUnidadeAuto;
  }
});
