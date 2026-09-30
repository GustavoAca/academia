/**
 * Food Service - registro de alimentação (refeições, itens, macros e relatórios).
 *
 * A pessoa registra o que comeu em cada refeição: alimento, gramas, calorias
 * e os macros da porção (proteína, carboidrato e gordura, em gramas). As
 * refeições vêm prontas (café da manhã, almoço, café da tarde e janta), mas
 * podem ser renomeadas, criadas ou removidas pela própria pessoa. Cada
 * alimento usado alimenta um catálogo que guarda as calorias por 100 g
 * (kcal100) e os macros por 100 g (prot100, carb100, gord100), permitindo
 * recalcular calorias e macros ao reutilizá-lo. Com as três referências de
 * macros completas e as calorias vazias, as calorias são derivadas delas
 * (4/4/9 kcal por grama).
 */

import {
  addFoodEntry,
  getFoodEntriesByDate,
  getAllFoodEntries,
  getFoodEntry,
  updateFoodEntry,
  deleteFoodEntry,
  deleteFood,
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
const CHAVE_META_MACROS = 'metaMacros';

/** Per-100 g reference fields editable in the catalog. */
const CAMPOS_REF = { kcal100: 1, prot100: 1, carb100: 1, gord100: 1 };

/** Page size shared by the food suggestion lists (type-ahead and catalog). */
const TAM_PAGINA = 15;

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const r1 = n => Math.round(Number(n) * 10) / 10;
const num = v => Number(String(v == null ? '' : v).replace(',', '.'));
const chaveDe = s => String(s == null ? '' : s).trim().toLowerCase();
const normTexto = s => chaveDe(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** True when a per-100 g reference has a usable number (pt-BR commas ok). */
const temRef = v => v !== null && v !== undefined && v !== '' && isFinite(num(v));

/**
 * Sum of the macro references in kcal (4/4/9), or null when any is missing.
 * @param {Object|null} refs - { carb100, gord100, prot100 } per 100 g
 * @returns {number|null}
 */
function kcalDosMacros(refs) {
  if (!refs) return null;
  const [c, p, g] = ['carb100', 'prot100', 'gord100'].map(k => temRef(refs[k]) ? num(refs[k]) : NaN);
  if (![c, p, g].every(isFinite)) return null;
  return r1(c * 4 + p * 4 + g * 9);
}

/**
 * Convert a per-100 g reference to the amount eaten in a portion.
 * @param {string|number|null} ref100 - reference per 100 g
 * @param {number|null} gramas - portion in grams
 * @returns {number|null} grams of the macro (or kcal) in the portion
 */
function porcaoDe(ref100, gramas) {
  if (!temRef(ref100) || !(gramas > 0)) return null;
  return r1(gramas * num(ref100) / 100);
}

/**
 * True when an entry has grams but is still missing any macro value: the
 * records created before macros existed (or before the references of their
 * food were filled) that backfillMacros can complete.
 * @param {Object} i - food entry
 * @returns {boolean}
 */
function pendenteDeMacros(i) {
  if (!(Number(i && i.gramas) > 0)) return false;
  return ['prot', 'carb', 'gord'].some(k => i[k] === null || i[k] === undefined || i[k] === '');
}

/**
 * True when the stored macros already match the recomputed ones (so nothing
 * needs to be written). Non-numeric stored values count as null.
 * @param {Object} gravado - stored entry
 * @param {Object} novos - { prot, carb, gord } recomputed values
 * @returns {boolean}
 */
function macrosIguais(gravado, novos) {
  const norm = v => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v));
  return ['prot', 'carb', 'gord'].every(k => norm(gravado && gravado[k]) === novos[k]);
}

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

/**
 * Save a new display order for the meals (drag-and-drop in the manage card).
 * The list must be a permutation of the current ids; nothing else about the
 * meals is touched.
 * @param {string[]} ids - every meal id in the new order
 * @returns {Promise<Array>} the reordered list
 */
async function reordenarRefeicoes(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.some(i => !i || typeof i !== 'string')) {
    throw new Error('Ordem de refeições inválida');
  }
  const lista = await getRefeicoes();
  const porId = new Map(lista.map(r => [r.id, r]));
  if (ids.length !== lista.length || ids.some(i => !porId.has(i))) {
    throw new Error('Ordem de refeições inválida');
  }
  return salvarRefeicoes(ids.map(i => porId.get(i)));
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

/* --- Metas diárias de macros (proteína, carboidrato e gordura, em g) --- */

/**
 * Daily gram targets for each macro (null when not set).
 * @returns {Promise<{prot: number|null, carb: number|null, gord: number|null}>}
 */
async function getMetaMacros() {
  const salvo = await getSetting(CHAVE_META_MACROS);
  const out = { prot: null, carb: null, gord: null };
  if (salvo && typeof salvo === 'object') {
    ['prot', 'carb', 'gord'].forEach(k => {
      const n = Number(salvo[k]);
      out[k] = isFinite(n) && n > 0 ? r1(n) : null;
    });
  }
  return out;
}

/**
 * Save the daily gram targets of each macro; empty or zero clears it.
 * @param {Object} p - { prot, carb, gord } as strings or numbers
 * @returns {Promise<Object>} the saved targets
 */
async function salvarMetaMacros(p) {
  const out = { prot: null, carb: null, gord: null };
  ['prot', 'carb', 'gord'].forEach(k => {
    const raw = p && p[k] !== undefined && p[k] !== null ? String(p[k]).trim() : '';
    if (raw === '') return;
    const n = num(raw);
    if (!isFinite(n) || n < 0) throw new Error('Meta de macro inválida');
    if (n > 0) out[k] = r1(n);
  });
  await saveSetting(CHAVE_META_MACROS, out);
  return out;
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
    kcal100: kcal100 !== null ? kcal100 : (gramas !== null ? r1(calorias / gramas * 100) : null),
    // macros da porção (gramas × referência / 100), nulos sem gramas ou sem
    // referência no catálogo
    prot: porcaoDe(existente && existente.prot100, gramas),
    carb: porcaoDe(existente && existente.carb100, gramas),
    gord: porcaoDe(existente && existente.gord100, gramas)
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
 * Set (or clear) one per-100 g reference of a food: calories or a macro.
 * Entries never change these values; only this function does. When the
 * calorie reference is empty and the three macro references are complete,
 * the calories are derived from them (4/4/9 kcal per gram).
 * @param {string} nome - food name (display or catalog key)
 * @param {string|number|null} valor - value per 100 g; empty/null clears it
 * @param {string} [campo] - 'kcal100' (default), 'prot100', 'carb100' or 'gord100'
 * @returns {Promise<number|null>} the saved reference
 */
async function salvarReferencia(nome, valor, campo) {
  const exibicao = String(nome || '').trim();
  const chave = exibicao.toLowerCase();
  if (!chave) throw new Error('Informe o alimento');
  if (campo !== undefined && campo !== null && campo !== '' && !CAMPOS_REF[campo]) {
    throw new Error('Referência inválida');
  }

  const ref = campo && CAMPOS_REF[campo] ? campo : 'kcal100';
  const raw = valor === null || valor === undefined ? '' : String(valor).trim();
  let novo = null;
  if (raw !== '') {
    novo = r1(num(raw));
    if (ref === 'kcal100') {
      if (!isFinite(novo) || novo <= 0) throw new Error('Informe as calorias por 100 g');
    } else if (!isFinite(novo) || novo < 0) {
      throw new Error('Informe um valor maior ou igual a zero');
    }
  }

  const existente = await getFoodByNome(chave);
  const refs = {};
  Object.keys(CAMPOS_REF).forEach(c => {
    refs[c] = existente && existente[c] !== undefined ? existente[c] : null;
  });
  refs[ref] = novo;

  if (refs.kcal100 === null || refs.kcal100 === undefined) {
    const derivada = kcalDosMacros(refs);
    if (derivada !== null && derivada > 0) refs.kcal100 = derivada;
  }

  await upsertFood({
    nome: chave,
    exibicao: existente ? existente.exibicao : exibicao,
    vezes: existente ? (existente.vezes || 0) : 0,
    ultimoGramas: existente && existente.ultimoGramas !== undefined ? existente.ultimoGramas : null,
    ultimoCalorias: existente && existente.ultimoCalorias !== undefined ? existente.ultimoCalorias : null,
    ...refs
  });

  // Uma referência de macro nova (ou removida) regrava os macros dos
  // registros antigos deste alimento que ainda não tinham.
  if (ref !== 'kcal100') {
    try {
      await backfillMacros(chave);
    } catch (err) {
      console.warn('Backfill de macros:', err.message);
    }
  }
  return refs[ref];
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

/**
 * Remove a food from the catalog. Logged entries are untouched: they keep
 * their name, calories and macros (snapshotted when they were recorded).
 * @param {number|string} id - catalog food id
 * @returns {Promise<void>}
 */
async function removerAlimento(id) {
  const n = Number(id);
  if (!isFinite(n) || n <= 0) throw new Error('Alimento não encontrado');
  await deleteFood(n);
}

/**
 * Keep the "last used" fields of a catalog food in sync when its newest entry
 * is edited. Never touches the calorie reference or the usage count.
 * @param {string} chave - lowercase food key
 * @param {Object} entry - the edited entry (before the update)
 * @param {Object} novos - { gramas, calorias, kcal100 } after the edit
 */
async function atualizarUltimosDoCatalogo(chave, entry, novos) {
  if (!chave) return;

  const todos = await getAllFoodEntries();
  const ultimo = todos.find(i => chaveDe(i.alimento) === chave);
  if (!ultimo || ultimo.id !== entry.id) return;

  const base = await getFoodByNome(chave);
  // The reference per 100 g only changes in the "Alimentos por 100 g" screen.
  const ref = base && base.kcal100 !== undefined ? base.kcal100 : novos.kcal100;

  await upsertFood({
    nome: chave,
    exibicao: base && base.exibicao ? base.exibicao : entry.alimento,
    vezes: base ? (base.vezes || 0) : 0,
    ultimoGramas: novos.gramas !== null && novos.gramas > 0
      ? novos.gramas
      : (base && base.ultimoGramas !== undefined ? base.ultimoGramas : null),
    ultimoCalorias: novos.calorias,
    kcal100: ref === undefined ? null : ref
  });
}

/**
 * Change the grams, the calories and/or the meal of a day's item without
 * removing it. With a calorie reference (catalog first, then the entry's own)
 * the calories are recalculated from the grams; otherwise the typed calories
 * are used.
 * @param {number} id - food entry id
 * @param {Object} p - { gramas, calorias, refeicaoId } (null/undefined keeps the current value)
 * @returns {Promise<Object>} the updated entry
 */
async function editarItem(id, p) {
  const atual = await getFoodEntry(id);
  if (!atual) throw new Error('Registro não encontrado');

  const refeicaoIdRaw = p && p.refeicaoId !== undefined && p.refeicaoId !== null
    ? String(p.refeicaoId).trim()
    : null;
  if (refeicaoIdRaw !== null) {
    if (!refeicaoIdRaw) throw new Error('Escolha a refeição');
    const refeicoes = await getRefeicoes();
    if (!refeicoes.some(r => r.id === refeicaoIdRaw)) throw new Error('Escolha a refeição');
  }

  const gramasRaw = p && p.gramas !== undefined && p.gramas !== null ? String(p.gramas).trim() : null;
  const caloriasRaw = p && p.calorias !== undefined && p.calorias !== null ? String(p.calorias).trim() : null;

  const chave = chaveDe(atual.alimento);
  const cat = chave ? await getFoodByNome(chave) : null;
  const kcal100 = cat && isFinite(Number(cat.kcal100)) && Number(cat.kcal100) > 0
    ? r1(cat.kcal100)
    : (isFinite(Number(atual.kcal100)) && Number(atual.kcal100) > 0 ? r1(atual.kcal100) : null);

  let gramas = atual.gramas === undefined ? null : atual.gramas;
  if (gramasRaw === '') gramas = null;
  else if (gramasRaw !== null) {
    gramas = num(gramasRaw);
    if (!isFinite(gramas) || gramas <= 0) throw new Error('Gramas inválidas');
    gramas = r1(gramas);
  }

  let calorias;
  if (kcal100 !== null) {
    if (gramas === null) throw new Error('Informe as gramas');
    calorias = r1(gramas * kcal100 / 100);
  } else {
    const raw = caloriasRaw !== null
      ? caloriasRaw
      : String(atual.calorias === undefined || atual.calorias === null ? '' : atual.calorias);
    if (raw === '') throw new Error('Informe as calorias');
    calorias = r1(num(raw));
    if (!isFinite(calorias) || calorias < 0) throw new Error('Calorias inválidas');
  }

  const salvo = await updateFoodEntry(id, {
    ...(refeicaoIdRaw !== null ? { refeicaoId: refeicaoIdRaw } : {}),
    gramas,
    calorias,
    kcal100: kcal100 !== null ? kcal100 : (gramas !== null ? r1(calorias / gramas * 100) : null),
    // macros recalculados pelas referências atuais do catálogo
    prot: porcaoDe(cat && cat.prot100, gramas),
    carb: porcaoDe(cat && cat.carb100, gramas),
    gord: porcaoDe(cat && cat.gord100, gramas)
  });

  await atualizarUltimosDoCatalogo(chave, atual, { gramas, calorias, kcal100 });

  return salvo;
}

/**
 * Move a day's item to another meal (drag-and-drop between groups).
 * The target meal is validated before the database is touched.
 * @param {number} id - food entry id
 * @param {string} refeicaoId - target meal id
 * @returns {Promise<Object>} the updated entry
 */
async function moverItem(id, refeicaoId) {
  const destino = String(refeicaoId == null ? '' : refeicaoId).trim();
  if (!destino) throw new Error('Escolha a refeição');
  const refeicoes = await getRefeicoes();
  if (!refeicoes.some(r => r.id === destino)) throw new Error('Escolha a refeição');
  return editarItem(id, { refeicaoId: destino });
}

/* --- Backfill de macros para registros antigos --- */

/**
 * Recompute the macros of entries that still miss them, using the current
 * catalog references. Idempotent: entries that already match (or whose food
 * has no references yet) are never written, so it is safe to run on every
 * start, after an import and whenever a reference changes. Entries without
 * grams or without a catalog food are left untouched.
 * @param {string} [chave] - restrict to one food (lowercase key); all foods otherwise
 * @returns {Promise<number>} how many entries were updated
 */
async function backfillMacros(chave) {
  const [todos, catalogo] = await Promise.all([getAllFoodEntries(), getAllFoods()]);
  const pendentes = todos.filter(i => pendenteDeMacros(i) && (!chave || chaveDe(i.alimento) === chave));
  if (!pendentes.length) return 0;

  const refs = new Map(catalogo.map(f => [f.nome, f]));
  let atualizados = 0;
  for (const i of pendentes) {
    const f = refs.get(chaveDe(i.alimento));
    if (!f) continue;
    const novos = {
      prot: porcaoDe(f.prot100, i.gramas),
      carb: porcaoDe(f.carb100, i.gramas),
      gord: porcaoDe(f.gord100, i.gramas)
    };
    if (macrosIguais(i, novos)) continue;
    try {
      await updateFoodEntry(i.id, novos);
      atualizados++;
    } catch (err) {
      console.warn('Não foi possível atualizar macros de um registro:', err.message);
    }
  }
  return atualizados;
}

async function getItensDoDia(data) {
  return getFoodEntriesByDate(data);
}
async function getCatalogo() {
  return getAllFoods();
}

/**
 * Page through the food catalog, filtering by name (accent and case
 * insensitive) and ranking the most used foods first.
 * @param {string} termo - name fragment; empty lists everything
 * @param {number} offset - how many results to skip
 * @param {number} [limite] - page size (defaults to TAM_PAGINA)
 * @returns {Promise<{itens: Array, temMais: boolean, total: number}>}
 */
async function buscarCatalogo(termo, offset, limite) {
  const ini = Math.max(0, Number(offset) || 0);
  const tam = Math.max(1, Number(limite) || TAM_PAGINA);
  const t = normTexto(termo);

  const todos = (await getAllFoods()).slice().sort((a, b) =>
    (b.vezes || 0) - (a.vezes || 0) ||
    chaveDe(a.exibicao || a.nome).localeCompare(chaveDe(b.exibicao || b.nome))
  );
  const filtrados = t ? todos.filter(f => normTexto(f.exibicao || f.nome).includes(t)) : todos;

  return {
    itens: filtrados.slice(ini, ini + tam),
    temMais: ini + tam < filtrados.length,
    total: filtrados.length
  };
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
 * Totals of a day grouped by meal, plus the macro totals and targets.
 * @param {string} data
 * @returns {Promise<Object>} { data, total, meta, metaMacros, macros, itens, porRefeicao }
 */
async function resumoDoDia(data) {
  const [itens, refeicoes, meta, metaMacros] = await Promise.all([
    getFoodEntriesByDate(data),
    getRefeicoes(),
    getMeta(),
    getMetaMacros()
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

  const somaMacro = campo => r1(itens.reduce((a, i) => a + (Number(i[campo]) || 0), 0));

  return {
    data,
    meta,
    metaMacros,
    itens,
    porRefeicao,
    total: itens.reduce((a, i) => a + (Number(i.calorias) || 0), 0),
    macros: { prot: somaMacro('prot'), carb: somaMacro('carb'), gord: somaMacro('gord') }
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
 * Macros (grams) and calories per day for a period (zero-filled, with the
 * number of logged items so averages can use only the days with a record).
 * @param {number} dias
 * @param {string} ate - last date in YYYY-MM-DD
 * @returns {Promise<Array<{data, prot, carb, gord, kcal, itens}>>}
 */
async function historicoMacros(dias, ate) {
  const datas = datasDoPeriodo(dias, ate);
  const inicio = datas[0];
  const itens = (await getAllFoodEntries()).filter(i => i.data >= inicio && i.data <= ate);

  const porData = {};
  datas.forEach(d => { porData[d] = { prot: 0, carb: 0, gord: 0, kcal: 0, n: 0 }; });
  itens.forEach(i => {
    const o = porData[i.data];
    if (!o) return;
    o.prot += Number(i.prot) || 0;
    o.carb += Number(i.carb) || 0;
    o.gord += Number(i.gord) || 0;
    o.kcal += Number(i.calorias) || 0;
    o.n++;
  });

  return datas.map(d => ({
    data: d,
    prot: r1(porData[d].prot),
    carb: r1(porData[d].carb),
    gord: r1(porData[d].gord),
    kcal: r1(porData[d].kcal),
    itens: porData[d].n
  }));
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

/**
 * Calories per day split by meal (zero-filled, chronological).
 * @param {number} dias
 * @param {string} ate - last date in YYYY-MM-DD
 * @returns {Promise<{datas: string[], refeicoes: Array<{id, nome, valores: number[]}>}>}
 */
async function historicoPorRefeicao(dias, ate) {
  const datas = datasDoPeriodo(dias, ate);
  const inicio = datas[0];
  const [refeicoes, itens] = await Promise.all([getRefeicoes(), getAllFoodEntries()]);
  const idx = new Map(datas.map((d, i) => [d, i]));
  const pos = new Map(refeicoes.map((r, i) => [r.id, i]));
  const out = refeicoes.map(r => ({ id: r.id, nome: r.nome, valores: datas.map(() => 0) }));

  itens.forEach(i => {
    const di = idx.get(i.data);
    const ri = pos.get(i.refeicaoId);
    if (di === undefined || ri === undefined || i.data < inicio) return;
    out[ri].valores[di] += Number(i.calorias) || 0;
  });

  return { datas, refeicoes: out };
}

/**
 * Earliest date with a food record (null when there is none).
 * @returns {Promise<string|null>}
 */
async function primeiraData() {
  const itens = await getAllFoodEntries();
  if (!itens.length) return null;
  return itens.reduce((m, i) => (i.data < m ? i.data : m), itens[0].data);
}

export {
  REFEICOES_PADRAO,
  getRefeicoes,
  salvarRefeicoes,
  criarRefeicao,
  renomearRefeicao,
  removerRefeicao,
  reordenarRefeicoes,
  getMeta,
  salvarMeta,
  getMetaMacros,
  salvarMetaMacros,
  kcalDosMacros,
  porcaoDe,
  pendenteDeMacros,
  macrosIguais,
  backfillMacros,
  adicionarItem,
  removerItem,
  removerAlimento,
  editarItem,
  moverItem,
  buscarAlimento,
  salvarReferencia,
  getItensDoDia,
  getCatalogo,
  buscarCatalogo,
  TAM_PAGINA,
  resumoDoDia,
  historicoCalorias,
  historicoMacros,
  distribuicaoRefeicao,
  alimentosFrequentes,
  treinoVsDescanso,
  historicoPorRefeicao,
  primeiraData
};
