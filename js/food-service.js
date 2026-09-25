/**
 * Food Service - registro de alimentação (refeições, itens e relatórios).
 *
 * A pessoa registra o que comeu em cada refeição: alimento, gramas e
 * calorias. As refeições vêm prontas (café da manhã, almoço, café da tarde e
 * janta), mas podem ser renomeadas, criadas ou removidas pela própria
 * pessoa. Cada alimento usado alimenta um catálogo que guarda as calorias por
 * 100 g (kcal100), permitindo recalcular as calorias ao reutilizá-lo.
 */

import {
  addFoodEntry,
  getFoodEntriesByDate,
  getAllFoodEntries,
  deleteFoodEntry,
  upsertFood,
  getFoodByNome,
  getAllFoods,
  saveSetting,
  getSetting
} from './db.js';
import { getAllExecutions } from './report-service.js';

const REFEICOES_PADRAO = [
  { id: 'cafe', nome: 'Café da manhã' },
  { id: 'almoco', nome: 'Almoço' },
  { id: 'lanche', nome: 'Café da tarde' },
  { id: 'janta', nome: 'Janta' }
];

const CHAVE_REFEICOES = 'refeicoes';
const CHAVE_META = 'metaCalorias';

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const r1 = n => Math.round(Number(n) * 10) / 10;
const num = v => Number(String(v == null ? '' : v).replace(',', '.'));

/* --- Refeições --- */

/**
 * Meals list, defaulting to the built-in ones when nothing was saved yet.
 * @returns {Promise<Array<{id: string, nome: string}>>}
 */
async function getRefeicoes() {
  const salvas = await getSetting(CHAVE_REFEICOES);
  if (Array.isArray(salvas) && salvas.length) {
    return salvas
      .filter(r => r && r.id && r.nome)
      .map(r => ({ id: String(r.id), nome: String(r.nome) }));
  }
  return REFEICOES_PADRAO.map(r => ({ ...r }));
}

async function salvarRefeicoes(lista) {
  const limpa = (Array.isArray(lista) ? lista : [])
    .filter(r => r && r.id && String(r.nome || '').trim())
    .map(r => ({ id: String(r.id), nome: String(r.nome).trim() }));

  if (!limpa.length) throw new Error('Ao menos uma refeição é necessária');
  await saveSetting(CHAVE_REFEICOES, limpa);
  return limpa;
}

/**
 * Create a new meal and return the updated list.
 * @param {string} nome
 * @returns {Promise<Array>}
 */
async function criarRefeicao(nome) {
  const nomeLimpo = String(nome || '').trim();
  if (!nomeLimpo) throw new Error('Informe o nome da refeição');

  const lista = await getRefeicoes();
  if (lista.some(r => r.nome.toLowerCase() === nomeLimpo.toLowerCase())) {
    throw new Error('Já existe uma refeição com este nome');
  }

  lista.push({ id: 'r' + Date.now(), nome: nomeLimpo });
  return salvarRefeicoes(lista);
}

/**
 * Rename a meal and return the updated list.
 * @param {string} id
 * @param {string} nome
 * @returns {Promise<Array>}
 */
async function renomearRefeicao(id, nome) {
  const nomeLimpo = String(nome || '').trim();
  if (!nomeLimpo) throw new Error('Informe o nome da refeição');

  const lista = await getRefeicoes();
  if (!lista.some(r => r.id === id)) throw new Error('Refeição não encontrada');
  if (lista.some(r => r.id !== id && r.nome.toLowerCase() === nomeLimpo.toLowerCase())) {
    throw new Error('Já existe uma refeição com este nome');
  }

  return salvarRefeicoes(lista.map(r => (r.id === id ? { ...r, nome: nomeLimpo } : r)));
}

/**
 * Remove a meal, only when it has no registered items.
 * @param {string} id
 * @returns {Promise<Array>} the updated list
 */
async function removerRefeicao(id) {
  const lista = await getRefeicoes();
  if (lista.length <= 1) throw new Error('Ao menos uma refeição é necessária');

  const itens = await getAllFoodEntries();
  if (itens.some(i => i.refeicaoId === id)) {
    throw new Error('Esta refeição tem itens registrados');
  }

  return salvarRefeicoes(lista.filter(r => r.id !== id));
}

/* --- Meta calórica diária --- */

async function getMeta() {
  const valor = await getSetting(CHAVE_META);
  const n = Number(valor);
  return isFinite(n) && n > 0 ? n : null;
}

async function salvarMeta(valor) {
  const n = num(valor);
  if (!isFinite(n) || n <= 0) {
    await saveSetting(CHAVE_META, null);
    return null;
  }
  await saveSetting(CHAVE_META, r1(n));
  return r1(n);
}

/* --- Itens --- */

/**
 * Register what was eaten in a meal. When the food has a calorie reference
 * per 100 g, the grams are converted automatically and the typed value is
 * ignored; otherwise the typed calories are used and become the reference.
 * @param {Object} p - { data, refeicaoId, alimento, gramas, calorias }
 * @returns {Promise<Object>} the saved entry
 */
async function adicionarItem(p) {
  const data = String(p && p.data || '');
  const refeicaoId = String(p && p.refeicaoId || '');
  const alimento = String(p && p.alimento || '').trim();
  const gramasRaw = p && p.gramas !== undefined && p.gramas !== null ? String(p.gramas).trim() : '';
  const caloriasRaw = p && p.calorias !== undefined && p.calorias !== null ? String(p.calorias).trim() : '';

  if (!DATA_RE.test(data)) throw new Error('Data inválida');
  if (!alimento) throw new Error('Informe o alimento');

  const refeicoes = await getRefeicoes();
  if (!refeicoes.some(r => r.id === refeicaoId)) throw new Error('Escolha a refeição');

  const nome = alimento.toLowerCase();
  const existente = await getFoodByNome(nome);
  const kcal100 = existente && isFinite(Number(existente.kcal100)) && Number(existente.kcal100) > 0
    ? r1(existente.kcal100)
    : null;

  let gramas = null;
  if (gramasRaw !== '') {
    gramas = num(gramasRaw);
    if (!isFinite(gramas) || gramas <= 0) throw new Error('Gramas inválidas');
    gramas = r1(gramas);
  }

  let calorias;
  if (kcal100 !== null) {
    // Padrão: com a referência de 100 g, as calorias vêm sempre da conversão
    // das gramas comidas — o valor digitado é ignorado.
    if (gramas === null) throw new Error('Informe as gramas');
    calorias = r1(gramas * kcal100 / 100);
  } else {
    if (caloriasRaw === '') throw new Error('Informe as calorias');
    calorias = r1(num(caloriasRaw));
    if (!isFinite(calorias) || calorias < 0) throw new Error('Calorias inválidas');
  }

  const entry = {
    data,
    refeicaoId,
    alimento,
    gramas,
    calorias,
    // referência de 100 g usada neste registro (fica no histórico)
    kcal100: kcal100 !== null ? kcal100 : (gramas !== null ? r1(calorias / gramas * 100) : null)
  };
  const salvo = await addFoodEntry(entry);

  const base = existente || {};
  const temGramas = gramas !== null && gramas > 0;

  await upsertFood({
    nome,
    exibicao: alimento,
    vezes: (base.vezes || 0) + 1,
    ultimoGramas: temGramas ? gramas : (base.ultimoGramas !== undefined ? base.ultimoGramas : null),
    ultimoCalorias: calorias,
    // a referência só é preenchida na primeira vez; depois, só muda quem edita
    kcal100: base.kcal100 !== undefined && base.kcal100 !== null ? base.kcal100 : entry.kcal100
  });

  return salvo;
}

/**
 * Set (or clear) the calorie reference per 100 g of a food. Entries never
 * change this value; only this function does.
 * @param {string} nome - food name (display or catalog key)
 * @param {string|number|null} valor - kcal per 100 g; empty/null clears it
 * @returns {Promise<number|null>} the saved reference
 */
async function salvarReferencia(nome, valor) {
  const exibicao = String(nome || '').trim();
  const chave = exibicao.toLowerCase();
  if (!chave) throw new Error('Informe o alimento');

  const raw = valor === null || valor === undefined ? '' : String(valor).trim();
  let kcal100 = null;
  if (raw !== '') {
    kcal100 = r1(num(raw));
    if (!isFinite(kcal100) || kcal100 <= 0) throw new Error('Informe as calorias por 100 g');
  }

  const existente = await getFoodByNome(chave);
  await upsertFood({
    nome: chave,
    exibicao: existente ? existente.exibicao : exibicao,
    vezes: existente ? (existente.vezes || 0) : 0,
    ultimoGramas: existente && existente.ultimoGramas !== undefined ? existente.ultimoGramas : null,
    ultimoCalorias: existente && existente.ultimoCalorias !== undefined ? existente.ultimoCalorias : null,
    kcal100
  });
  return kcal100;
}

/**
 * Find a catalog food by name (used to auto-calculate calories).
 * @param {string} nome
 * @returns {Promise<Object|null>}
 */
async function buscarAlimento(nome) {
  const chave = String(nome || '').trim().toLowerCase();
  if (!chave) return null;
  return getFoodByNome(chave);
}

async function removerItem(id) {
  await deleteFoodEntry(id);
}

async function getItensDoDia(data) {
  return getFoodEntriesByDate(data);
}

async function getCatalogo() {
  return getAllFoods();
}

/* --- Relatórios --- */

function datasDoPeriodo(dias, ate) {
  const fim = new Date(`${ate}T00:00:00`);
  if (isNaN(fim.getTime())) return [];
  const out = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(fim);
    d.setDate(d.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Totals of a day grouped by meal.
 * @param {string} data
 * @returns {Promise<Object>} { data, total, meta, itens, porRefeicao }
 */
async function resumoDoDia(data) {
  const [itens, refeicoes, meta] = await Promise.all([
    getFoodEntriesByDate(data),
    getRefeicoes(),
    getMeta()
  ]);

  const porRefeicao = refeicoes.map(r => {
    const doGrupo = itens.filter(i => i.refeicaoId === r.id);
    return {
      id: r.id,
      nome: r.nome,
      itens: doGrupo,
      total: doGrupo.reduce((a, i) => a + (Number(i.calorias) || 0), 0)
    };
  });

  return {
    data,
    meta,
    itens,
    porRefeicao,
    total: itens.reduce((a, i) => a + (Number(i.calorias) || 0), 0)
  };
}

/**
 * Calories per day for a period (zero-filled, chronological).
 * @param {number} dias
 * @param {string} ate - last date in YYYY-MM-DD
 * @returns {Promise<Array<{data: string, total: number}>>}
 */
async function historicoCalorias(dias, ate) {
  const datas = datasDoPeriodo(dias, ate);
  const inicio = datas[0];
  const itens = (await getAllFoodEntries()).filter(i => i.data >= inicio && i.data <= ate);

  const porData = {};
  datas.forEach(d => { porData[d] = 0; });
  itens.forEach(i => { porData[i.data] = (porData[i.data] || 0) + (Number(i.calorias) || 0); });

  return datas.map(d => ({ data: d, total: r1(porData[d]) }));
}

/**
 * Share of calories per meal in a period.
 * @returns {Promise<Array<{id, nome, total, pct}>>}
 */
async function distribuicaoRefeicao(dias, ate) {
  const [refeicoes, itens] = await Promise.all([getRefeicoes(), getAllFoodEntries()]);
  const inicio = datasDoPeriodo(dias, ate)[0];
  const doPeriodo = itens.filter(i => i.data >= inicio && i.data <= ate);

  const linhas = refeicoes.map(r => {
    const total = doPeriodo
      .filter(i => i.refeicaoId === r.id)
      .reduce((a, i) => a + (Number(i.calorias) || 0), 0);
    return { id: r.id, nome: r.nome, total: r1(total), pct: 0 };
  });

  const soma = linhas.reduce((a, l) => a + l.total, 0);
  linhas.forEach(l => { l.pct = soma ? Math.round(l.total / soma * 100) : 0; });
  return linhas.sort((a, b) => b.total - a.total);
}

/**
 * Foods ranked by how often they were eaten in a period.
 * @returns {Promise<Array<{nome, vezes, total, media}>>}
 */
async function alimentosFrequentes(dias, ate) {
  const itens = await getAllFoodEntries();
  const inicio = datasDoPeriodo(dias, ate)[0];
  const doPeriodo = itens.filter(i => i.data >= inicio && i.data <= ate);

  const mapa = {};
  doPeriodo.forEach(i => {
    const o = mapa[i.alimento] = mapa[i.alimento] || { nome: i.alimento, vezes: 0, total: 0 };
    o.vezes++;
    o.total += Number(i.calorias) || 0;
  });

  return Object.values(mapa)
    .map(o => ({ ...o, total: r1(o.total), media: r1(o.total / o.vezes) }))
    .sort((a, b) => b.vezes - a.vezes || b.total - a.total);
}

/**
 * Average calories on training days vs rest days (days with logged food).
 * @returns {Promise<Object>} { treino: {dias, media}, descanso: {dias, media} }
 */
async function treinoVsDescanso(dias, ate) {
  const datas = datasDoPeriodo(dias, ate);
  const inicio = datas[0];
  const [itens, execs] = await Promise.all([getAllFoodEntries(), getAllExecutions()]);

  const comDados = new Set();
  itens.forEach(i => {
    if (i.data >= inicio && i.data <= ate) comDados.add(i.data);
  });

  const treinoDatas = new Set();
  execs.forEach(x => {
    const d = String(x.data || '').slice(0, 10);
    if (d >= inicio && d <= ate) treinoDatas.add(d);
  });

  const soma = {};
  itens.forEach(i => {
    if (!comDados.has(i.data)) return;
    soma[i.data] = (soma[i.data] || 0) + (Number(i.calorias) || 0);
  });

  const grupo = temTreino => {
    const diasCom = [...comDados].filter(d => treinoDatas.has(d) === temTreino);
    const total = diasCom.reduce((a, d) => a + (soma[d] || 0), 0);
    return {
      dias: diasCom.length,
      media: diasCom.length ? r1(total / diasCom.length) : null
    };
  };

  return { treino: grupo(true), descanso: grupo(false) };
}

export {
  REFEICOES_PADRAO,
  getRefeicoes,
  salvarRefeicoes,
  criarRefeicao,
  renomearRefeicao,
  removerRefeicao,
  getMeta,
  salvarMeta,
  adicionarItem,
  removerItem,
  buscarAlimento,
  salvarReferencia,
  getItensDoDia,
  getCatalogo,
  resumoDoDia,
  historicoCalorias,
  distribuicaoRefeicao,
  alimentosFrequentes,
  treinoVsDescanso
};
