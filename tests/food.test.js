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
  adicionarItem
} from '../js/food-service.js';
import * as rotinaTela from '../js/telas/rotina.js';
import * as relatorioTela from '../js/telas/relatorio.js';
import * as medidasTela from '../js/telas/medidas.js';
import * as treinoTela from '../js/telas/treino.js';
import * as alimentacaoTela from '../js/telas/alimentacao.js';

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
