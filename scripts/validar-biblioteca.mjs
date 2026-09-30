#!/usr/bin/env node
/**
 * Valida a biblioteca de exercícios e a geração de treinos.
 *
 * Uso:  node scripts/validar-biblioteca.mjs
 *
 * Checa: formato das tuplas, vocabulário fixo de grupos, nomes únicos, faixas
 * de séries/repetições, tamanho mínimo por grupo (variedade do gerador) e faz
 * um smoke test do montarRotina em todos os splits e focos.
 * Sai com código 1 se houver erro (serve de CI local antes de colar num prompt).
 */

import { BIBLIOTECA } from '../js/biblioteca.js';
import { PLANO } from '../js/plano.js';
import { FOCOS, montarRotina, SPLITS, MAX_SERIES } from '../js/orientacao-service.js';

const erros = [];
const avisos = [];
const oks = [];

/* --- 1. Vocabulário fixo (grupos que o app já conhece) --- */
const vocab = new Set();
for (const dia of Object.values(PLANO)) for (const t of dia.ex) vocab.add(t[1]);
for (const f of FOCOS) for (const g of f.grupos) vocab.add(g);

const MINIMO_POR_GRUPO = 7;

/* --- 2. Formato e conteúdo da biblioteca --- */
const vistos = new Map(); // nome (lowercase) -> grupo

for (const [grupo, lista] of Object.entries(BIBLIOTECA)) {
  if (!vocab.has(grupo)) erros.push(`Grupo-chave "${grupo}" fora do vocabulário do app`);
  if (lista.length < MINIMO_POR_GRUPO) {
    avisos.push(`Grupo "${grupo}" com ${lista.length} exercícios (mínimo recomendado: ${MINIMO_POR_GRUPO} para variedade do gerador)`);
  }

  lista.forEach((t, i) => {
    const onde = `${grupo}[${i}]`;
    if (!Array.isArray(t) || t.length !== 5) return erros.push(`${onde}: tupla deve ser [nome, grupo, series, min, max]`);
    const [nome, grp, series, min, max] = t;

    if (!nome || typeof nome !== 'string' || !nome.trim()) erros.push(`${onde}: nome vazio`);
    if (grp !== grupo) erros.push(`${onde}: grupo da tupla ("${grp}") difere da chave ("${grupo}")`);
    if (!vocab.has(grp)) erros.push(`${onde}: grupo "${grp}" fora do vocabulário`);

    const s = Number(series);
    if (!Number.isInteger(s) || s < 1 || s > 20) erros.push(`${onde}: séries deve ser inteiro de 1 a 20 (recebido: ${series})`);

    const mn = Number(min), mx = Number(max);
    if (!(mn >= 1) || !(mx >= 1)) erros.push(`${onde}: repetições mín/máx devem ser >= 1`);
    if (mn > mx) erros.push(`${onde}: repetição mínima (${mn}) maior que a máxima (${mx})`);

    const chave = String(nome).trim().toLowerCase();
    if (vistos.has(chave)) erros.push(`${onde}: nome "${nome}" duplicado (já usado em "${vistos.get(chave)}")`);
    else vistos.set(chave, grupo);
  });
}

oks.push(`Vocabulário: ${[...vocab].sort().join(', ')}`);
oks.push(`Biblioteca: ${Object.values(BIBLIOTECA).reduce((a, l) => a + l.length, 0)} exercícios em ${Object.keys(BIBLIOTECA).length} grupos`);

/* --- 3. Foco tem candidatos em todos os grupos --- */
for (const f of FOCOS) {
  for (const g of f.grupos) {
    if (!BIBLIOTECA[g] || !BIBLIOTECA[g].length) erros.push(`Foco "${f.id}" referencia grupo "${g}" sem exercícios na biblioteca`);
  }
}

/* --- 4. Grupos do programa base existem na biblioteca --- */
const gruposPlano = new Set();
for (const dia of Object.values(PLANO)) for (const t of dia.ex) gruposPlano.add(t[1]);
for (const g of gruposPlano) {
  if (!BIBLIOTECA[g]) avisos.push(`Grupo do programa base "${g}" não existe na biblioteca`);
}

/* --- 5. Smoke test do montarRotina em todos os splits --- */
const atual = {
  inicio: '2026-09-14',
  duracao: { tipo: 'semanas', valor: 16 },
  treinos: { seg: { cardio: { f: { ativo: true, tipo: 'Esteira', min: '20' } } } }
};

const combos = [[], ...FOCOS.map(f => [f.id]), ['peito', 'bracos'], ['pernas', 'abdomen', 'costas']];
let testados = 0;

for (const dias of Object.keys(SPLITS).map(Number)) {
  for (const focos of combos) {
    testados++;
    let r;
    try {
      r = montarRotina({ focos, dias, atual });
    } catch (err) {
      erros.push(`montarRotina(${dias}x, [${focos}]) lançou: ${err.message}`);
      continue;
    }

    const ativos = Object.keys(r.dias).filter(d => r.dias[d]);
    if (ativos.length !== dias) erros.push(`montarRotina(${dias}x, [${focos}]): ${ativos.length} dias ativos`);

    for (const d of ativos) {
      const t = r.treinos[d];
      const nomes = t.ex.map(e => e.nome);
      if (new Set(nomes).size !== nomes.length) erros.push(`montarRotina(${dias}x, [${focos}]): exercício duplicado em ${d}`);
      const ser = t.ex.reduce((a, e) => a + e.series, 0);
      if (ser > MAX_SERIES) erros.push(`montarRotina(${dias}x, [${focos}]): ${d} com ${ser} séries (teto ${MAX_SERIES})`);
      for (const e of t.ex) {
        if (!e.nome || !e.grupo || e.series < 1 || e.series > 20 || e.min > e.max) {
          erros.push(`montarRotina(${dias}x, [${focos}]): exercício inválido em ${d}: ${JSON.stringify(e)}`);
        }
      }
    }
  }
}
oks.push(`montarRotina: ${testados} combinações (splits 3-6 x focos) sem erro`);

/* --- 6. Relatório --- */
for (const m of oks) console.log('OK    ' + m);
for (const m of avisos) console.log('AVISO ' + m);
for (const m of erros) console.log('ERRO  ' + m);

console.log(`\n${erros.length} erro(s), ${avisos.length} aviso(s)`);
process.exit(erros.length ? 1 : 0);
