import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, store, gravar, aguardarGravacoes } from '../js/core/estado.js';

beforeEach(() => {
  store.fila = Promise.resolve();
});

test('state starts on the training screen with the wizard reset', () => {
  assert.equal(state.tela, 'treino');
  assert.equal(state.e, 0);
  assert.equal(state.p, 30);
  assert.deepEqual(state.foco, { passo: 1, grupos: [], dias: 4 });
});

test('store keeps replaceable data behind live bindings', () => {
  assert.ok(store.exercisesById instanceof Map);
  assert.equal(typeof store.notas, 'object');
  assert.equal(store.rotinaRascunho, null);
});

test('gravar serializes writes in order', async () => {
  const ordem = [];
  gravar(async () => { await new Promise(r => setTimeout(r, 10)); ordem.push('a'); });
  gravar(() => { ordem.push('b'); });
  gravar(() => { ordem.push('c'); });

  await aguardarGravacoes();
  assert.deepEqual(ordem, ['a', 'b', 'c']);
});

test('a rejected write is swallowed and the queue keeps running', async () => {
  const ordem = [];
  gravar(() => Promise.reject(new Error('boom')));
  gravar(() => { ordem.push('depois'); });

  await aguardarGravacoes();
  assert.deepEqual(ordem, ['depois']);
});

test('aguardarGravacoes resolves when nothing is queued', async () => {
  await aguardarGravacoes();
  assert.ok(true);
});
