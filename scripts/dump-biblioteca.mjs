#!/usr/bin/env node
/**
 * Dump do estado atual dos treinos do app - para colar num prompt de IA.
 *
 * Uso:  node scripts/dump-biblioteca.mjs > estado.json
 *
 * Saída: JSON com o vocabulário de grupos, a biblioteca de exercícios (com
 * contagens), o programa base (PLANO), os splits/quotas do gerador e os chips
 * de foco. É esse JSON que você cola como "contexto" para a IA entender todos
 * os treinos existentes antes de criar novos.
 */

import { BIBLIOTECA } from '../js/biblioteca.js';
import { PLANO } from '../js/plano.js';
import { FOCOS, TEMPLATES, SPLITS, DIAS_POR_QTD, MAX_SERIES } from '../js/orientacao-service.js';

const vocabulario = new Set();
for (const lista of Object.values(BIBLIOTECA)) for (const t of lista) vocabulario.add(t[1]);
for (const dia of Object.values(PLANO)) for (const t of dia.ex) vocabulario.add(t[1]);
for (const f of FOCOS) for (const g of f.grupos) vocabulario.add(g);

const biblioteca = {};
for (const [grupo, lista] of Object.entries(BIBLIOTECA)) {
  biblioteca[grupo] = { total: lista.length, exercicios: lista };
}

const porGrupoNoPlano = {};
for (const dia of Object.values(PLANO)) {
  for (const t of dia.ex) {
    porGrupoNoPlano[t[1]] = porGrupoNoPlano[t[1]] || new Set();
    porGrupoNoPlano[t[1]].add(t[0]);
  }
}
const programaBase = {};
for (const [dia, t] of Object.entries(PLANO)) {
  programaBase[dia] = { nome: t.t, exercicios: t.ex.length };
}

const out = {
  vocabularioDeGrupos: [...vocabulario].sort(),
  biblioteca,
  programaBase,
  porGrupoNoProgramaBase: Object.fromEntries(
    Object.entries(porGrupoNoPlano).map(([g, s]) => [g, [...s].sort()])
  ),
  focos: FOCOS,
  splits: SPLITS,
  diasPorQuantidade: DIAS_POR_QTD,
  templates: TEMPLATES,
  maxSeriesPorDia: MAX_SERIES,
  totalExerciciosNaBiblioteca: Object.values(BIBLIOTECA).reduce((a, l) => a + l.length, 0),
  geradoEm: new Date().toISOString()
};

console.log(JSON.stringify(out, null, 2));
