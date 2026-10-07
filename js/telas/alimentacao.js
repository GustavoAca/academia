/**
 * Alimentação screen: daily summary (calories against the goal), meal logging
 * by unit (g, ml or pieces), inline item editor, dish/recipe builder, meal
 * management and the paginated food suggestion lists.
 */

import { esc, f1, r1n, refeicaoSugerida } from '../core/utils.js';
import { state, aguardarGravacoes } from '../core/estado.js';
import {
  getRefeicoes,
  criarRefeicao,
  renomearRefeicao,
  removerRefeicao,
  reordenarRefeicoes,
  getMeta,
  salvarMeta,
  salvarMetaMacros,
  adicionarItem,
  removerItem,
  removerAlimento,
  editarItem,
  moverItem,
  buscarAlimento,
  salvarReferencia,
  salvarUnidadeAlimento,
  unidadeDoAlimento,
  buscarCatalogo,
  getCatalogo,
  totaisDaReceita,
  salvarPrato,
  totalGramas,
  kcalDosMacros,
  porcaoDe,
  TAM_PAGINA,
  resumoDoDia
} from '../food-service.js';
import { render, moldura } from '../core/render.js';
import { registrarTela } from '../core/rotas.js';
import { aviso } from '../core/toast.js';

/* --- Paginated suggestion lists (type-ahead of the Alimento field + catalog) --- */

/** True when a per-100 g reference (kcal or macro) has a usable number. */
const temRef = v => v !== null && v !== undefined && v !== '' && isFinite(Number(String(v).replace(',', '.')));

/** pt-BR field as a number: '' or null become 0, 'abc' becomes NaN. */
const num = v => Number(String(v === null || v === undefined ? '' : v).replace(',', '.'));

/** Compact "P31 C0 G3,6" suffix of a food's per-100 g macro references. */
function macros100Txt(f) {
  const partes = [];
  if (temRef(f.prot100)) partes.push(`P${f1(f.prot100)}`);
  if (temRef(f.carb100)) partes.push(`C${f1(f.carb100)}`);
  if (temRef(f.gord100)) partes.push(`G${f1(f.gord100)}`);
  return partes.join(' ');
}

/** Macro line of a portion: " · P 46,5 g · C 0 g · G 8 g". */
function macroPorcaoTxt(f, gramas) {
  const partes = [];
  [['P', f.prot100], ['C', f.carb100], ['G', f.gord100]].forEach(([rot, ref]) => {
    const g = porcaoDe(ref, gramas);
    if (g !== null) partes.push(`${rot} ${f1(g)} g`);
  });
  return partes.length ? ' · ' + partes.join(' · ') : '';
}

/** Macro line of a logged entry (values already in grams). */
function macrosItemTxt(i) {
  const partes = [];
  if (temRef(i.prot)) partes.push(`P ${f1(i.prot)} g`);
  if (temRef(i.carb)) partes.push(`C ${f1(i.carb)} g`);
  if (temRef(i.gord)) partes.push(`G ${f1(i.gord)} g`);
  return partes.length ? ' · ' + partes.join(' · ') : '';
}

/** Message when kcal/100 g differs from the 4/4/9 sum of the macros (>10%). */
function divergenciaKcal(f) {
  const derivada = kcalDosMacros(f);
  if (derivada === null || !temRef(f.kcal100)) return null;
  const kcal = Number(String(f.kcal100).replace(',', '.'));
  return Math.abs(derivada - kcal) <= kcal * 0.1
    ? null
    : `os macros somam ${f1(derivada)} kcal/100 g — confira as referências`;
}

/** data-k of the catalog reference inputs → the field it edits. */
const CAMPOS_REFERENCIA = { alkcal: 'kcal100', alprot: 'prot100', alcarb: 'carb100', algord: 'gord100' };

/**
 * One goal macro (consumed vs daily goal) as a ring or a horizontal bar,
 * following the display preferences. Pure HTML helper (unit-tested without
 * DOM or database).
 * @param {string} rot - label ('Proteína', 'Carboidrato', 'Gordura')
 * @param {number} val - grams consumed today
 * @param {number} alvo - daily goal in grams
 * @param {{circular: boolean, pct: boolean}} ajustes - display preferences
 * @returns {string}
 */
export function macroMeta(rot, val, alvo, ajustes) {
  const mpct = Math.min(100, val / alvo * 100);
  const cheio = val >= alvo;
  const cor = cheio ? 'var(--ok)' : 'var(--ac)';
  const frac = `${f1(val)}/${f1(alvo)} g`;

  if (!ajustes.circular) {
    return `<div class="hbar"><span>${rot}</span><span><i style="width:${mpct.toFixed(0)}%;background:${cor}"></i></span>
      <span style="white-space:nowrap">${frac}${ajustes.pct ? ` · ${mpct.toFixed(0)}%` : ''}</span></div>`;
  }

  const centro = ajustes.pct ? `${mpct.toFixed(0)}%` : `${f1(val)} g`;
  return `<div class="macro-circ"><div class="anel${cheio ? ' ok' : ''}" style="--p:${mpct.toFixed(1)}"><span>${centro}</span></div>
    <small><b>${rot}</b> · ${frac}</small></div>`;
}

/** Unidades aceitas no registro: gramas, ml e unidades (peças). */
export const UNIDADES_REGISTRO = [['g', 'g'], ['ml', 'ml'], ['un', 'unidades']];

/**
 * Unit switch of the register form. When the unit comes from the chosen food
 * there is nothing to choose: it shows up locked and only pieces stay
 * available; free-text foods keep the whole g / ml / unidades switch.
 * Pure helper (unit-tested).
 * @param {boolean} auto - true when the unit belongs to the chosen food
 * @param {string} unidade - 'g', 'ml' or 'un'
 * @returns {string}
 */
export function segUnidade(auto, unidade) {
  const travada = auto === true && (unidade === 'g' || unidade === 'ml');
  // travada: g × ml deixa de ser escolha, sobram só as unidades (peças)
  const opcoes = travada ? UNIDADES_REGISTRO.filter(([v]) => v === 'un') : UNIDADES_REGISTRO;
  const lock = travada
    ? `<span class="unid-lock" title="Unidade do alimento" aria-label="Unidade do alimento: ${unidade}">${unidade}</span>`
    : '';
  return lock + opcoes.map(([v, r]) =>
    `<button type="button" class="${v === unidade ? 'on' : ''}" data-a="alimun" data-v="${v}" aria-pressed="${v === unidade}">${r}</button>`).join('');
}

/**
 * Amount of a logged entry with its unit: "150 g · ", "250 ml · " or
 * "6 un × 80 g · " (empty when the entry has no amount). Pure helper.
 * @param {Object} i - food entry
 * @returns {string}
 */
export function qtdItemTxt(i) {
  const un = (i && i.unidade) || 'g';
  if (un === 'un' && Number(i && i.qtd) > 0 && Number(i && i.pesoUnit) > 0) {
    return `${f1(i.qtd)} un × ${f1(i.pesoUnit)} g · `;
  }
  const g = i && i.gramas !== null && i.gramas !== undefined ? Number(i.gramas) : NaN;
  if (!isFinite(g)) return '';
  return `${f1(g)} ${un === 'ml' ? 'ml' : 'g'} · `;
}

/**
 * Third KPI of the daily summary: kcal still missing (positive), kcal over
 * the goal (negative and flagged so it can be painted red) or the hint to
 * set a goal. Pure helper (unit-tested without the database).
 * @param {number} total - kcal eaten today
 * @param {number|null} meta - daily goal in kcal
 * @returns {{txt: string, legenda: string, cls: string, excedeu: boolean}}
 */
export function kpiDelta(total, meta) {
  if (!(meta > 0)) return { txt: '—', legenda: 'defina uma meta diária', cls: '', excedeu: false };
  const falta = meta - total;
  if (falta >= 0) return { txt: `${f1(falta)} kcal`, legenda: 'faltam para a meta', cls: '', excedeu: false };
  // falta negativa → o sinal de menos já vem do f1 ("-300 kcal")
  return { txt: `${f1(falta)} kcal`, legenda: 'acima da meta', cls: 'neg', excedeu: true };
}

/**
 * Calories eaten today as the loading bar that takes the side of the daily
 * total when the round ring is off: it fills up to the goal and turns red as
 * soon as the goal is passed. The percentage label follows the preference.
 * Pure helper.
 * @param {number} total - kcal eaten today
 * @param {number|null} meta - daily goal in kcal
 * @param {{circular: boolean, pct: boolean}} ajustes - display preferences
 * @returns {string}
 */
export function barraCaloria(total, meta, ajustes) {
  if (!(meta > 0)) return '';
  const pct = Math.min(100, total / meta * 100);
  const excedeu = total > meta;
  const anel = !ajustes || ajustes.circular !== false;
  const rotulo = !anel && ajustes && ajustes.pct ? `<span>${(total / meta * 100).toFixed(0)}%</span>` : '';
  return `<div class="barra-dia"><div class="bar"><i style="width:${pct.toFixed(0)}%;background:${excedeu ? 'var(--err)' : 'var(--ok)'}"></i></div>${rotulo}</div>`;
}

/**
 * The goal as a round ring with the percentage, taking the side of the daily
 * total (the horizontal bar only shows up when the ring preference is off).
 * Hidden when the "circular" preference is off or there is no goal; red when
 * the goal was exceeded. Pure helper (unit-tested).
 * @param {number} total - kcal eaten today
 * @param {number|null} meta - daily goal in kcal
 * @param {{circular: boolean, pct: boolean}} ajustes - display preferences
 * @returns {string} '' when the ring should not be drawn
 */
export function anelCaloria(total, meta, ajustes, cor) {
  if (!(meta > 0)) return '';
  if (ajustes && ajustes.circular === false) return '';
  const pct = total / meta * 100;
  const cheio = total >= meta;
  const excedeu = total > meta;
  // determine color class based on percentage thresholds
  let cls = '';
  if (pct >= 200) cls = 'vermelho';
  else if (pct >= 100) cls = 'verde';
  else if (pct >= 75) cls = 'amar';
  const clsClass = cls ? ` kpi-${cls}` : (excedeu ? ' ok' : (cheio ? '' : ''));
  const mostraPct = !ajustes || ajustes.pct !== false;
  const centro = mostraPct ? `${pct.toFixed(0)}%` : `${f1(total)}`;
  const legenda = mostraPct ? `${f1(total)}/${f1(meta)} kcal` : `de ${f1(meta)} kcal`;
  return `<div class="macro-circ"><div class="anel${clsClass}" style="--p:${Math.min(100, pct).toFixed(1)}"><span>${centro}</span></div></div>`;
}

/**
 * "kcal no dia" card of the summary: the calories eaten, the left overs (or
 * how much they went over) right below, and the goal graphic on the side — a
 * ring when the circular preference is on, a horizontal bar when it is off.
 * Both graphics carry the percentage of the goal (only when the percentage
 * preference allows it). Pure helper (unit-tested without the database).
 * @param {number} total - kcal eaten today
 * @param {number|null} meta - daily goal in kcal
 * @param {{circular: boolean, pct: boolean}} ajustes - display preferences
 * @returns {string}
 */
export function kpiNoDia(total, meta, ajustes, classeExtra) {
  const delta = kpiDelta(total, meta);
  const temMeta = meta > 0;
  const circular = !ajustes || ajustes.circular !== false;
  const pct = temMeta ? total / meta * 100 : 0;
  // cor baseada nos thresholds: >=200 vermelho, >=100 verde, >=75 âmbar
  let corClass = '';
  if (pct >= 200) corClass = 'kpi-vermelho';
  else if (pct >= 100) corClass = 'kpi-verde';
  else if (pct >= 75) corClass = 'kpi-amar';
  const grafico = !temMeta ? '' : (circular ? anelCaloria(total, meta, ajustes) : barraCaloria(total, meta, ajustes));
  const deltaTxt = delta.txt === '—'
    ? `<small class="dia-delta">${delta.legenda}</small>`
    : `<small class="dia-delta${delta.cls ? ' ' + delta.cls : ''}">${delta.txt} · ${delta.legenda}</small>`;
  const neg = delta.cls ? ' ' + delta.cls : '';
  const extra = classeExtra ? ' kpi-' + classeExtra : '';
  const bClass = corClass ? ` class="${corClass}"` : '';
  // 3 cards: consumido (ao lado da meta), restante e gráfico (embaixo)
  const cardConsumido = `<div class="kpi kpi-dia${neg}${extra}">
    <small class="kpi-rot">kcal consumido</small>
    <b${bClass}>${f1(total)} kcal</b>
    ${deltaTxt}
  </div>`;
  const cardRestante = temMeta
    ? `<div class="kpi">
    <small class="kpi-rot">restante</small>
    <b>${f1(meta - total)} kcal</b>
  </div>`
    : '';
  const cardGrafico = grafico
    ? `<div class="kpi">
    <small class="kpi-rot">gráfico</small>
    ${grafico}
  </div>`
    : '';
  return cardConsumido + cardRestante + cardGrafico;
}

export function novaLista() {
  return { termo: '', offset: 0, itens: [], temMais: false, total: 0, carregando: false, pronto: false, aberto: false, seq: 0 };
}

let sugState = novaLista(); // drop-down that opens from the "Alimento" field
let catState = novaLista(); // "Alimentos por 100 g" list
let timerSug = null;
let timerCat = null;

/** State of the type-ahead list (read by the keyboard/scroll handlers). */
export const listaSugestoes = () => sugState;

/** Forget both lists (called whenever the screen is re-rendered). */
export function resetarListas() {
  clearTimeout(timerSug);
  clearTimeout(timerCat);
  timerSug = timerCat = null;
  sugState = novaLista();
  catState = novaLista();
}

/** True when a scrollable box is close enough to its bottom to load more. */
export function semFim(el, margem) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= (margem || 60);
}

function linhaSugestao(f) {
  const nome = f.exibicao || f.nome || '';
  const ref = f.kcal100 !== null && f.kcal100 !== undefined && Number(f.kcal100) > 0
    ? `${f1(f.kcal100)} kcal/100 ${unidadeDoAlimento(f)}`
    : 'sem referência';
  const macros = macros100Txt(f);
  const usos = `${f.vezes || 0} registro${(f.vezes || 0) === 1 ? '' : 's'}`;
  return `<button type="button" class="li" data-a="alimsel" data-n="${esc(nome)}"><span class="n"><b>${esc(nome)}</b><small>${ref}${macros ? ' · ' + macros : ''} · ${usos}</small></span></button>`;
}

export function linhaCatalogo(f) {
  const nome = f.exibicao || f.nome || '';
  const unid = unidadeDoAlimento(f);
  const ehPrato = !!f.prato;
  const ingts = Array.isArray(f.ingredientes) ? f.ingredientes : [];
  const registros = `${f.vezes || 0} registro${(f.vezes || 0) === 1 ? '' : 's'}`;
  const subtitulo = ehPrato && Number(f.rende) > 0
    ? `rende ${f1(f.rende)} g · ${registros}`
    : registros;
  const inp = (k, v, rot) => `<div><label>${rot} por 100 ${unid}</label><input class="sel" data-k="${k}" data-n="${esc(f.nome)}" inputmode="decimal" value="${temRef(v) ? String(v).replace('.', ',') : ''}" placeholder="?" aria-label="${rot} por 100 ${unid} de ${esc(nome)}"></div>`;
  const linhas = ehPrato && ingts.length
    ? `<div class="pl-ing">${ingts.map(i => `<div class="li"><span class="n"><b>${esc(String(i && i.alimento || ''))}</b><small>${f1(i && i.gramas)} g</small></span></div>`).join('')}</div>`
    : '';
  return `<div class="pl-li">
    <div class="pl-top">
      <span class="pl-n"><b>${esc(nome)}</b><small>${subtitulo}</small></span>
      ${ehPrato ? '<span class="tag">Prato</span>' : ''}
      <button class="btn pl-x" data-a="alalimdel" data-v="${f.id === undefined || f.id === null ? '' : f.id}" data-n="${esc(nome)}" data-u="${f.vezes || 0}" aria-label="Excluir ${esc(nome)} do catálogo">×</button>
    </div>
    ${linhas}
    <div class="frm">
      <div style="grid-column:1/-1"><label>Unidade</label><select class="sel" data-k="alunid" data-n="${esc(f.nome)}" aria-label="Unidade em que ${esc(nome)} é medido">
        <option value="g"${unid === 'g' ? ' selected' : ''}>g</option><option value="ml"${unid === 'ml' ? ' selected' : ''}>ml</option>
      </select></div>
      ${inp('alkcal', f.kcal100, 'Calorias')}
      ${inp('alprot', f.prot100, 'Proteína')}
      ${inp('alcarb', f.carb100, 'Carboidrato')}
      ${inp('algord', f.gord100, 'Gordura')}
    </div>
  </div>`;
}

export function htmlSugestoes() {
  const st = sugState;
  const corpo = st.itens.length
    ? st.itens.map(linhaSugestao).join('')
    : `<div class="meta" style="padding:12px">${st.termo
      ? 'Nenhum alimento encontrado — o texto digitado pode ser registrado assim mesmo.'
      : 'Nenhum alimento no catálogo ainda — digite o nome.'}</div>`;
  return corpo + (st.carregando ? '<div class="meta" style="text-align:center;padding:8px">Carregando…</div>' : '');
}

export function htmlCatalogo() {
  const st = catState;
  const corpo = st.itens.length
    ? `<div class="planilha">${st.itens.map(linhaCatalogo).join('')}</div>`
    : `<div class="meta">${st.termo ? 'Nenhum alimento encontrado.' : 'Nenhum alimento no catálogo ainda.'}</div>`;
  const contagem = st.itens.length
    ? `<div class="meta" style="text-align:center;font-size:12px">${st.itens.length}${st.total ? ` de ${st.total}` : ''}</div>`
    : '';
  const carga = st.carregando ? '<div class="meta" style="text-align:center;padding:6px">Carregando…</div>' : '';
  return corpo + contagem + carga;
}

function pintarSugestoes(reset) {
  const box = document.getElementById('alimSug');
  if (!box) return;
  const top = box.scrollTop;
  box.innerHTML = htmlSugestoes();
  box.scrollTop = reset ? 0 : top;
}

function pintarCatalogo(reset) {
  const box = document.getElementById('alimCatLista');
  if (!box) return;
  const top = box.scrollTop;
  box.innerHTML = htmlCatalogo();
  box.scrollTop = reset ? 0 : top;
}

/**
 * Fetch one page of the type-ahead list and merge it into the state. A stale
 * request (a newer search already started) is discarded.
 * @param {boolean} reset - restart the list from the first page
 */
export async function carregarSugestoes(reset) {
  const st = sugState;
  if (st.carregando && !reset) return;
  const termo = st.termo;
  const offset = reset ? 0 : st.offset;
  const seq = ++st.seq;
  st.carregando = true;
  pintarSugestoes(reset);
  try {
    const r = await buscarCatalogo(termo, offset, TAM_PAGINA);
    if (seq !== st.seq || st !== sugState) return;
    st.itens = reset ? r.itens : st.itens.concat(r.itens);
    st.offset = offset + r.itens.length;
    st.temMais = r.temMais;
    st.total = r.total;
    st.pronto = true;
  } finally {
    if (seq === st.seq && st === sugState) {
      st.carregando = false;
      pintarSugestoes(reset);
    }
  }
}

/** Same as carregarSugestoes, for the "Alimentos por 100 g" list. */
export async function carregarCatalogo(reset) {
  const st = catState;
  if (st.carregando && !reset) return;
  const termo = st.termo;
  const offset = reset ? 0 : st.offset;
  const seq = ++st.seq;
  st.carregando = true;
  pintarCatalogo(reset);
  try {
    const r = await buscarCatalogo(termo, offset, TAM_PAGINA);
    if (seq !== st.seq || st !== catState) return;
    st.itens = reset ? r.itens : st.itens.concat(r.itens);
    st.offset = offset + r.itens.length;
    st.temMais = r.temMais;
    st.total = r.total;
    st.pronto = true;
  } finally {
    if (seq === st.seq && st === catState) {
      st.carregando = false;
      pintarCatalogo(reset);
    }
  }
}

/** Debounced search of the type-ahead list (keeps the field focus). */
export function agendaSugestoes(termo) {
  sugState.termo = termo;
  clearTimeout(timerSug);
  timerSug = setTimeout(() => carregarSugestoes(true), 150);
}

/** Debounced search of the "Alimentos por 100 g" list (keeps the focus). */
export function agendaCatalogo(termo) {
  catState.termo = termo;
  clearTimeout(timerCat);
  timerCat = setTimeout(() => carregarCatalogo(true), 150);
}

/**
 * Cap the drop-down so it always ends above the "Adicionar" button: the list
 * covers the fields below the Alimento input but never the button.
 */
export function ajustarAlturaPop() {
  const box = document.getElementById('alimSug');
  const wrap = box && box.closest('.alim-wrap');
  if (!box || !wrap) return;
  box.style.maxHeight = '';
  const card = wrap.closest('.card');
  const acoes = card && card.querySelector('.acoes');
  if (!acoes) return;
  const topo = wrap.getBoundingClientRect().bottom + 6;
  const disponivel = acoes.getBoundingClientRect().top - 8 - topo;
  if (disponivel > 96) box.style.maxHeight = `${Math.floor(disponivel)}px`;
}

/** Open the drop-down under the Alimento field, loading its first page. */
export async function abrirSugestoes() {
  const box = document.getElementById('alimSug');
  if (!box || sugState.aberto) return;
  const nomeEl = document.getElementById('alimNome');
  sugState.aberto = true;
  box.hidden = false;
  if (nomeEl) nomeEl.setAttribute('aria-expanded', 'true');
  ajustarAlturaPop();
  const termo = nomeEl ? nomeEl.value : '';
  if (!sugState.pronto || sugState.termo !== termo) {
    sugState.termo = termo;
    await carregarSugestoes(true);
  } else {
    pintarSugestoes(false);
  }
}

export function fecharSugestoes() {
  sugState.aberto = false;
  const box = document.getElementById('alimSug');
  if (box) box.hidden = true;
  const nomeEl = document.getElementById('alimNome');
  if (nomeEl) nomeEl.setAttribute('aria-expanded', 'false');
}

/**
 * Adopt the unit of the chosen food in the register form: a food that
 * declares g or ml owns the unit (it locks and the g × ml choice goes away),
 * pieces are a choice of their own and never move, and free-text or legacy
 * foods keep the manual switch. The form is repainted whenever the plan
 * changes, carrying over whatever was already typed.
 * @param {string} nome - food name typed or picked
 * @returns {Promise<boolean>} true when the form was repainted
 */
export async function seguirUnidadeDoAlimento(nome) {
  try {
    if (!nome) return await aplicarPlano(planoUnidade(null, state.alimUnidade));
    const f = await buscarAlimento(nome);
    return await aplicarPlano(planoUnidade(f, state.alimUnidade));
  } catch (err) {
    console.warn('Sem catálogo para seguir a unidade do alimento:', err.message);
    return false;
  }
}

/**
 * What the register form must do with the unit once a food is chosen: the
 * unit declared by the food becomes automatic, pieces ('un') are never
 * moved, and a free-text food — or one saved before the unit existed — keeps
 * the current manual choice. Pure helper (unit-tested without the database).
 * @param {Object|null} f - chosen food, null when the name is free text
 * @param {string} atual - current unit of the register form
 * @returns {{unidade: string, auto: boolean}}
 */
export function planoUnidade(f, atual) {
  const unidade = atual || 'g';
  if (!f || !f.unidade || unidade === 'un') return { unidade, auto: false };
  return { unidade: f.unidade === 'ml' ? 'ml' : 'g', auto: true };
}

/** Apply the plan, repainting only when the unit or the lock really changed. */
async function aplicarPlano(plano) {
  const unidade = state.alimUnidade || 'g';
  if (plano.unidade === unidade && plano.auto === !!state.alimUnidadeAuto) return false;
  // o repaint recria os inputs: o que já estava digitado volta para o lugar
  const guardado = ['alimG', 'alimQtd', 'alimPeso', 'alimK']
    .map(id => [id, (document.getElementById(id) || {}).value || '']);
  state.alimUnidade = plano.unidade;
  state.alimUnidadeAuto = plano.auto;
  await render();
  guardado.forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  });
  return true;
}

/** Fill the Alimento field from a suggestion and move on to the amount. */
export async function escolherSugestao(nome) {
  fecharSugestoes();
  state.alimNome = nome || '';
  await seguirUnidadeDoAlimento(nome);
  const nomeEl = document.getElementById('alimNome');
  if (nomeEl) nomeEl.value = nome || '';
  await atualizarAlimAuto(true).catch(err => console.error('Erro ao calcular calorias:', err));
  const alvo = document.getElementById('alimG') || document.getElementById('alimQtd');
  if (alvo) alvo.focus();
}

/**
 * Keep the calorie field in sync with the informed amount when the food has a
 * calorie reference per 100 g (kcal100). With a reference the field is
 * read-only: calories always come from the conversion. The amount follows the
 * chosen unit: grams, ml (1 ml counts as 1 g) or pieces (amount × average
 * weight of one).
 * @param {boolean} prefill - also pre-fill empty amounts with the last ones used
 */
export async function atualizarAlimAuto(prefill) {
  const nomeEl = document.getElementById('alimNome');
  const kEl = document.getElementById('alimK');
  const hint = document.getElementById('alimHint');
  if (!nomeEl || !kEl) return;

  const unidade = state.alimUnidade || 'g';
  const gEl = document.getElementById('alimG');
  const qEl = document.getElementById('alimQtd');
  const pEl = document.getElementById('alimPeso');

  const f = await buscarAlimento(nomeEl.value);
  const temRef = !!(f && f.kcal100);
  const refUnid = f ? unidadeDoAlimento(f) : 'g';
  kEl.readOnly = temRef;

  if (prefill && f) {
    // reutiliza a última porção: 1 unidade do peso total registrado
    if (unidade === 'un') {
      if (qEl && !(num(qEl.value) > 0)) qEl.value = '1';
      if (pEl && !(num(pEl.value) > 0) && f.ultimoGramas) pEl.value = String(f.ultimoGramas).replace('.', ',');
    } else if (gEl && !(num(gEl.value) > 0) && f.ultimoGramas) {
      gEl.value = String(f.ultimoGramas).replace('.', ',');
    }
  }

  const gramas = totalGramas(unidade === 'un'
    ? { unidade, qtd: qEl ? qEl.value : null, pesoUnit: pEl ? pEl.value : null }
    : { unidade, gramas: gEl ? gEl.value : null });
  const qtdTxt = gramas === null
    ? ''
    : unidade === 'un'
      ? `${f1(num(qEl && qEl.value))} un × ${f1(num(pEl && pEl.value))} g = ${f1(gramas)} g`
      : `${f1(gramas)} ${unidade === 'ml' ? 'ml' : 'g'}`;

  if (!temRef) {
    if (hint) {
      hint.textContent = f
        ? `Este alimento ainda não tem referência por 100 ${refUnid} — informe as calorias.`
        : unidade === 'un'
          ? 'Informe as unidades, o peso médio e as calorias deste alimento.'
          : unidade === 'ml'
            ? 'Informe os ml e as calorias deste alimento.'
            : 'Informe as gramas e as calorias deste alimento.';
    }
    return;
  }

  if (gramas !== null && gramas > 0) {
    kEl.value = String(r1n(gramas * f.kcal100 / 100)).replace('.', ',');
    const kcal = f1(Number(String(kEl.value).replace(',', '.')) || 0);
    hint.textContent = `${f.exibicao}: ${f1(f.kcal100)} kcal por 100 ${refUnid} · ${qtdTxt} → ${kcal} kcal${macroPorcaoTxt(f, gramas)}${unidade === 'ml' ? ' · 1 ml ≈ 1 g' : ''}`;
    const div = divergenciaKcal(f);
    if (div) hint.textContent += ` · ⚠ ${div}`;
  } else {
    kEl.value = '';
    const m100 = macros100Txt(f);
    const passo = unidade === 'un'
      ? 'informe as unidades e o peso médio'
      : unidade === 'ml' ? 'digite os ml' : 'digite as gramas';
    hint.textContent = `${f.exibicao}: ${f1(f.kcal100)} kcal por 100 ${refUnid}${m100 ? ` · ${m100}` : ''} · ${passo}`;
  }
}
/** Row of a day's item: read mode (edit/remove) or inline editor. */
export function linhaItemDia(i, opts) {
  if (state.alimEdit !== i.id) {
    return `<div class="li" data-item="${i.id}" data-ref="${esc(i.refeicaoId || '')}"><span class="alca" data-alca title="Arraste para trocar de refeição" aria-label="Arraste ${esc(i.alimento)} para outra refeição">⋮⋮</span><span class="n"><b>${esc(i.alimento)}</b><small>${qtdItemTxt(i)}${f1(i.calorias)} kcal${macrosItemTxt(i)}</small></span>
      <button class="btn" style="width:40px;height:40px;flex:none" data-a="ialimedit" data-v="${i.id}" data-n="${esc(i.alimento)}" data-u="${esc(i.unidade || 'g')}" data-r="${i.kcal100 === null || i.kcal100 === undefined ? '' : i.kcal100}" aria-label="Editar item ${esc(i.alimento)}">✎</button>
      <button class="btn" style="width:40px;height:40px;flex:none" data-a="iremoveralim" data-v="${i.id}" aria-label="Remover item">×</button></div>`;
  }

  const ref = state.alimEditRef;
  const temRef = ref !== null && ref !== undefined && isFinite(Number(ref)) && Number(ref) > 0;
  const unidade = state.alimEditUnidade || i.unidade || 'g';
  const total = Number(i.gramas);
  const txt = v => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));
  const kv = temRef
    ? (isFinite(total) ? String(r1n(total * Number(ref) / 100)).replace('.', ',') : '')
    : txt(i.calorias);
  const optsUn = UNIDADES_REGISTRO
    .map(([v, r]) => `<option value="${v}"${v === unidade ? ' selected' : ''}>${r}</option>`)
    .join('');
  const temTotal = isFinite(total) && total > 0;

  // Em 'un' a troca de unidade mantém a mesma comida: 1 unidade do total.
  const campos = unidade === 'un'
    ? `<div style="display:flex;gap:8px;width:100%">
        <input class="sel" id="alimEditQtd" inputmode="decimal" value="${esc(txt(i.qtd) || (temTotal ? '1' : ''))}" placeholder="unidades" style="flex:1;height:44px" aria-label="Unidades de ${esc(i.alimento)}">
        <input class="sel" id="alimEditPeso" inputmode="decimal" value="${esc(txt(i.pesoUnit) || (temTotal ? txt(total) : ''))}" placeholder="peso médio (g)" style="flex:1;height:44px" aria-label="Peso médio de ${esc(i.alimento)}">
      </div>
      <div style="width:100%;margin-top:8px">
        <input class="sel" id="alimEditK" inputmode="decimal" value="${esc(kv)}" placeholder="kcal" ${temRef ? 'readonly' : ''} style="width:100%;height:44px" aria-label="Calorias de ${esc(i.alimento)}">
      </div>`
    : `<div style="display:flex;gap:8px;width:100%">
        <input class="sel" id="alimEditG" inputmode="decimal" value="${esc(txt(i.gramas))}" placeholder="${unidade === 'ml' ? 'ml' : 'gramas'}" style="flex:1;height:44px" aria-label="${unidade === 'ml' ? 'Mililitros' : 'Gramas'} de ${esc(i.alimento)}">
        <input class="sel" id="alimEditK" inputmode="decimal" value="${esc(kv)}" placeholder="kcal" ${temRef ? 'readonly' : ''} style="flex:1;height:44px" aria-label="Calorias de ${esc(i.alimento)}">
      </div>`;

  const refUnid = unidade === 'ml' ? 'ml' : 'g';
  return `<div class="li" style="flex-wrap:wrap">
    <span class="n" style="min-width:100%"><b>${esc(i.alimento)}</b><small>${temRef
      ? `${f1(Number(ref))} kcal/100 ${refUnid} — as calorias vêm da conversão`
      : `sem referência por 100 ${refUnid} — informe as calorias`}${unidade === 'un' && temTotal ? ` · total ${f1(total)} g` : ''}</small></span>
    <div style="display:flex;gap:8px;align-items:center;width:100%;margin-bottom:8px">
      <label style="font-size:12px;color:var(--mut)" for="alimEditUn">Unidade</label>
      <select class="sel" id="alimEditUn" data-k="alimEditUn" style="flex:1;height:40px" aria-label="Unidade do item">${optsUn}</select>
    </div>
    ${campos}
    ${opts ? `<div style="width:100%;margin-top:8px"><label style="font-size:12px;color:var(--mut);display:block;margin-bottom:2px">Refeição</label>
      <select class="sel" id="alimEditRef" aria-label="Refeição do item">${opts}</select></div>` : ''}
    <div class="acoes" style="width:100%;margin-top:8px">
      <button class="btn p" data-a="ialimsalvar" data-v="${i.id}">Salvar</button>
      <button class="btn" data-a="ialimcancel">Cancelar</button>
    </div></div>`;
}

/**
 * Grams, kcal and macros of one draft ingredient, from the per-100 g
 * references captured when it was picked — the same numbers the dish totals
 * add up, ingredient by ingredient. Pure helper (nothing is read from the
 * database): a missing reference becomes null and is simply not shown.
 * @param {{gramas: number|string, kcal100?: number|null, prot100?: number|null, carb100?: number|null, gord100?: number|null}} ing
 * @returns {{kcal: number, prot: number|null, carb: number|null, gord: number|null}}
 */
export function totaisDoIngrediente(ing) {
  const vazio = { kcal: 0, prot: null, carb: null, gord: null };
  const g = ing && ing.gramas !== null && ing.gramas !== undefined && String(ing.gramas).trim() !== ''
    ? num(ing.gramas)
    : NaN;
  if (!isFinite(g) || g <= 0) return vazio;

  const temKcal = temRef(ing.kcal100);
  const temMacros = temRef(ing.prot100) && temRef(ing.carb100) && temRef(ing.gord100);
  if (!temKcal && !temMacros) return vazio;

  return {
    kcal: g * (temKcal ? num(ing.kcal100) : kcalDosMacros(ing)) / 100,
    prot: temRef(ing.prot100) ? g * num(ing.prot100) / 100 : null,
    carb: temRef(ing.carb100) ? g * num(ing.carb100) / 100 : null,
    gord: temRef(ing.gord100) ? g * num(ing.gord100) / 100 : null
  };
}

/**
 * Totals of the dish being built, from the references captured when each
 * ingredient was picked. Pure helper: nothing is read from the database.
 * @param {Array<{alimento: string, gramas: number}>} itens - draft ingredients
 * @returns {string} the totals line, an error line, or '' when still empty
 */
export function totaisReceitaTxt(itens) {
  if (!Array.isArray(itens) || !itens.length) return '';
  try {
    const t = totaisDaReceita(itens);
    return `<div class="sub" style="margin-top:10px">Totais do prato</div>
      <div class="meta">${f1(t.gramas)} g · ${f1(t.kcal)} kcal · proteína ${f1(t.prot)} g · carboidrato ${f1(t.carb)} g · gordura ${f1(t.gord)} g</div>`;
  } catch (err) {
    return `<div class="meta" style="color:var(--warn)">${esc(err.message)}</div>`;
  }
}

/**
 * Recipe builder living inside the catalog card: '' while it is closed and
 * the form (ingredients, totals, save/cancel) while it is open — the button
 * that opens it sits next to "Criar item".
 * @param {Array|null} alimentos - whole catalog, for the ingredient list
 * @returns {string}
 */
function htmlReceita(alimentos) {
  const r = state.alimReceita || { nome: '', itens: [] };
  const itens = Array.isArray(r.itens) ? r.itens : [];

  if (!state.alimPrato) return '';

  const lista = Array.isArray(alimentos) ? alimentos : [];
  const opcoes = lista
    .slice()
    .sort((a, b) => String(a.exibicao || a.nome).localeCompare(String(b.exibicao || b.nome), 'pt-BR'))
    .map(f => `<option value="${esc(f.exibicao || f.nome)}"></option>`)
    .join('');
  // a linha do ingrediente segue o padrão das outras listas da tela:
  // "Frango grelhado / 150 g · 247 kcal · P 30 g · C 0 g · G 5 g"
  const linhas = itens.map((ing, ix) => {
    const t = totaisDoIngrediente(ing);
    const partes = [qtdItemTxt(ing).replace(/ · $/, '')];
    if (t.kcal > 0) partes.push(`${f1(t.kcal)} kcal`);
    const macros = macrosItemTxt(t).replace(/^ · /, '');
    if (macros) partes.push(macros);
    return `<div class="li">
    <span class="n"><b>${esc(ing.alimento)}</b><small>${partes.filter(p => p).join(' · ')}</small></span>
    <button class="btn" style="width:40px;height:40px;flex:none" data-a="pratorem" data-v="${ix}" aria-label="Remover ${esc(ing.alimento)}">×</button></div>`;
  }).join('');

  return `<div style="margin-top:12px">
    <div class="sub">Some os ingredientes uma vez: o prato entra no catálogo e passa a ser registrado em um toque.</div>
    <div class="frm">
      <div style="grid-column:1/-1"><label>Nome do prato</label><input id="pratoNome" data-k="pratoNome" value="${esc(r.nome || '')}" placeholder="ex.: Frango com arroz" aria-label="Nome do prato"></div>
      <div style="grid-column:1/-1"><label>Ingrediente</label><input id="pratoIng" data-k="pratoIng" list="pratoLista" value="" placeholder="ex.: Frango grelhado" aria-label="Ingrediente do prato" autocomplete="off"><datalist id="pratoLista">${opcoes}</datalist></div>
      <div style="grid-column:1/-1"><label>Gramas do ingrediente</label><input id="pratoG" data-k="pratoG" inputmode="decimal" placeholder="ex.: 150" aria-label="Gramas do ingrediente"></div>
    </div>
    <div class="acoes"><button class="btn" data-a="pratoadd">Adicionar ingrediente</button></div>
    ${linhas ? `<div style="margin-top:6px">${linhas}</div>` : '<div class="meta">Nenhum ingrediente ainda.</div>'}
    ${totaisReceitaTxt(itens)}
    <div class="acoes"><button class="btn p" data-a="pratosalvar">Salvar prato</button><button class="btn" data-a="pratocancelar">Cancelar</button></div>
  </div>`;
}

/** Full HTML of the Alimentação screen. */
export async function telaAlimentacao() {
  const data = state.alim;
  const pratoAberto = !!state.alimPrato;
  const [resumoDia, refeicoes, primeira, todosAlimentos] = await Promise.all([
    resumoDoDia(data),
    getRefeicoes(),
    buscarCatalogo('', 0, TAM_PAGINA),
    pratoAberto ? getCatalogo() : Promise.resolve(null)
  ]);

  return moldura('Alimentação', corpoAlimentacao({
    data,
    resumoDia,
    refeicoes,
    catalogo: primeira,
    todosAlimentos
  }));
}

/**
 * Body of the screen built from already loaded data — pure markup, with no
 * database access, so the tests can render it under Node.
 * @param {Object} p
 * @param {string} p.data - displayed date (YYYY-MM-DD)
 * @param {Object} p.resumoDia - day summary (total, meta, macros, porRefeicao)
 * @param {Array} p.refeicoes - meals of the plan
 * @param {{itens: Array, temMais: boolean, total: number}} p.catalogo - first catalog page
 * @param {Array|null} p.todosAlimentos - whole catalog, only when the dish builder is open
 * @returns {string}
 */
export function corpoAlimentacao({ data, resumoDia, refeicoes, catalogo, todosAlimentos }) {
  resetarListas();
  const primeira = catalogo;

  sugState.itens = primeira.itens;
  sugState.offset = primeira.itens.length;
  sugState.temMais = primeira.temMais;
  sugState.total = primeira.total;
  sugState.pronto = true;
  catState.itens = primeira.itens;
  catState.offset = primeira.itens.length;
  catState.temMais = primeira.temMais;
  catState.total = primeira.total;
  catState.pronto = true;

  const meta = resumoDia.meta;
  const ajustes = state.ajustes || { circular: true, pct: true };
  const total = resumoDia.total;
  let percentual = 0;
  let restante = 0;
  if (meta > 0) {
    percentual = total / meta * 100;
    restante = meta - total;
  }
  const diaKpi = kpiNoDia(total, meta, ajustes);

  const mm = resumoDia.metaMacros || { prot: null, carb: null, gord: null };
  const mv = resumoDia.macros || { prot: 0, carb: 0, gord: 0 };
  const macroLinha = (rot, chave) => {
    const val = Number(mv[chave]) || 0;
    const alvo = mm[chave];
    if (!(alvo > 0)) return '';
    return macroMeta(rot, val, alvo, ajustes);
  };
  const macroVal = chave => (mm[chave] !== null && mm[chave] !== undefined ? String(mm[chave]).replace('.', ',') : '');
  const linhasMacro = [macroLinha('Proteína', 'prot'), macroLinha('Carboidrato', 'carb'), macroLinha('Gordura', 'gord')].filter(Boolean);
  const circ = ajustes.circular !== false;
  const macrosHtml = linhasMacro.length
    ? (circ ? `<div class="macro-circs">${linhasMacro.join('')}</div>` : linhasMacro.join(''))
    : `<div class="meta">Proteína ${f1(mv.prot)} g · Carboidrato ${f1(mv.carb)} g · Gordura ${f1(mv.gord)} g — defina as metas acima para acompanhar o progresso.</div>`;

  const maxRef = Math.max(1, ...resumoDia.porRefeicao.map(r => r.total));
  const porRef = resumoDia.porRefeicao.map(r => `<div class="hbar">
    <span>${esc(r.nome)}</span><span><i style="width:${(r.total / maxRef * 100).toFixed(0)}%;background:${r.total ? 'var(--ac)' : 'var(--line)'}"></i></span>
    <span style="white-space:nowrap">${f1(r.total)} kcal</span></div>`).join('');

  if (!refeicoes.some(r => r.id === state.alimRef)) state.alimRef = refeicaoSugerida(refeicoes);
  const optsDe = sel => refeicoes.map(r => `<option value="${r.id}"${r.id === sel ? ' selected' : ''}>${esc(r.nome)}</option>`).join('');
  const opts = optsDe(state.alimRef);
  const chips = primeira.itens.slice(0, 12).map(f => {
    const g = f.ultimoGramas === null || f.ultimoGramas === undefined ? '' : String(f.ultimoGramas).replace('.', ',');
    const c = f.ultimoCalorias === null || f.ultimoCalorias === undefined ? '' : String(f.ultimoCalorias).replace('.', ',');
    return `<button class="grp" data-a="alimchip" data-n="${esc(f.exibicao)}" data-g="${esc(g)}" data-c="${esc(c)}" style="border:0;cursor:pointer;margin:0 6px 6px 0;font:inherit">${esc(f.exibicao)}</button>`;
  }).join('');

  const grupos = resumoDia.porRefeicao.map(r => {
    const itens = r.itens.map(i => linhaItemDia(i, optsDe(i.refeicaoId))).join('');
    return `<div class="grupo-dia" data-grupo="${r.id}">
      <div class="sub" style="margin-top:12px"><b>${esc(r.nome)}</b> · ${f1(r.total)} kcal</div>${itens || '<div class="meta">Nada registrado.</div>'}</div>`;
  }).join('');

  const gerenciar = refeicoes.map(r => `<div class="li" data-ordem="${r.id}" style="padding:8px 10px">
    <span class="alca" data-alca title="Arraste para reordenar" aria-label="Reordenar ${esc(r.nome)}">⋮⋮</span>
    <input class="sel" data-k="alimrefnome" data-v="${r.id}" value="${esc(r.nome)}" style="flex:1;height:40px;text-align:left" aria-label="Nome da refeição ${esc(r.nome)}">
    <button class="btn" style="width:40px;height:40px;flex:none" data-a="alimrefdel" data-v="${r.id}" aria-label="Remover refeição ${esc(r.nome)}">×</button></div>`).join('');

  const unidade = UNIDADES_REGISTRO.some(([v]) => v === state.alimUnidade) ? state.alimUnidade : 'g';
  const unidadeAuto = !!state.alimUnidadeAuto && (unidade === 'g' || unidade === 'ml');
  const camposUnidade = unidade === 'un'
    ? `<div><label>Unidades</label><input id="alimQtd" data-k="alimQtd" inputmode="decimal" placeholder="ex.: 6" aria-label="Unidades"></div>
      <div><label>Peso médio (g)</label><input id="alimPeso" data-k="alimPeso" inputmode="decimal" placeholder="ex.: 80" aria-label="Peso médio por unidade em gramas"></div>`
    : `<div><label>${unidade === 'ml' ? 'Mililitros' : 'Gramas'}</label><input id="alimG" data-k="alimG" inputmode="decimal" placeholder="${unidade === 'ml' ? 'ex.: 250' : 'ex.: 150'}" aria-label="${unidade === 'ml' ? 'Mililitros' : 'Gramas'}"></div>`;
  const campoCalorias = unidade === 'un'
    ? '<div style="grid-column:1/-1"><label>Calorias</label><input id="alimK" data-k="alimK" inputmode="decimal" placeholder="ex.: 250" aria-label="Calorias"></div>'
    : '<div><label>Calorias</label><input id="alimK" data-k="alimK" inputmode="decimal" placeholder="ex.: 250" aria-label="Calorias"></div>';

  // os dois botões de criação ficam lado a lado no catálogo; cada um some
  // enquanto o próprio formulário está aberto (que traz o Cancelar dele)
  const mostraItem = !state.alimCriar;
  const mostraReceita = !state.alimPrato;
  const botoesCriacao = mostraItem || mostraReceita
    ? `<div class="acoes">${mostraItem ? '<button class="btn" data-a="alcriar">Criar item</button>' : ''}${mostraReceita ? '<button class="btn" data-a="pratoabrir">Criar receita</button>' : ''}</div>`
    : '';

  const corpo = `<div class="card sec"><h2>Resumo do dia</h2>
    <input type="date" class="sel" data-k="alimdata" value="${data}" style="margin-bottom:12px" aria-label="Data do registro">
    <div class="kpis">
      <div class="kpi"><small class="kpi-rot">kcal meta</small>
        <input data-k="alimmeta" inputmode="decimal" value="${meta !== null ? String(meta).replace('.', ',') : ''}" placeholder="ex.: 2200" aria-label="Meta calórica diária"></div>
      ${diaKpi}
    </div>
    <div class="frm" style="grid-template-columns:1fr 1fr 1fr">
      <div><label>Proteína (g)</label><input id="alimMetaProt" data-k="alimmetaprot" inputmode="decimal" value="${macroVal('prot')}" placeholder="ex.: 130" aria-label="Meta diária de proteína em gramas"></div>
      <div><label>Carbo (g)</label><input id="alimMetaCarb" data-k="alimmetacarb" inputmode="decimal" value="${macroVal('carb')}" placeholder="ex.: 250" aria-label="Meta diária de carboidrato em gramas"></div>
      <div><label>Gordura (g)</label><input id="alimMetaGord" data-k="alimmetagord" inputmode="decimal" value="${macroVal('gord')}" placeholder="ex.: 70" aria-label="Meta diária de gordura em gramas"></div>
    </div>
    <div class="sub" style="margin-top:12px">Macros do dia</div>
    ${macrosHtml}
    <div class="sub" style="margin-top:12px">Calorias por refeição</div>${porRef}
  </div>

  <div class="card sec"><h2>Registrar</h2>
    <div class="sub">Com a referência do alimento (por 100 g ou 100 ml), digite só a quantidade — calorias e macros vêm na conversão. O alimento escolhido traz a própria unidade.</div>
    <div class="frm">
      <div style="grid-column:1/-1"><label>Refeição</label><select class="sel" id="alimRef" data-k="alimref" aria-label="Refeição">${opts}</select></div>
      <div class="alim-wrap">
        <label>Alimento</label>
        <input id="alimNome" data-k="alimNome" value="${esc(state.alimNome || '')}" placeholder="ex.: Frango grelhado" aria-label="Alimento" autocomplete="off" enterkeyhint="next" aria-autocomplete="list" aria-expanded="false">
        <div id="alimSug" class="pop" role="listbox" hidden></div>
      </div>
      <div style="grid-column:1/-1"><label>${unidadeAuto ? 'Unidade do alimento' : 'Unidade'}</label>
        <div class="unid-seg" role="group" aria-label="Unidade da quantidade">${segUnidade(unidadeAuto, unidade)}</div>
      </div>
      ${camposUnidade}
      ${campoCalorias}
    </div>
    <div class="sub" id="alimHint" style="margin-top:8px">Informe a quantidade e as calorias deste alimento.</div>
    ${chips ? `<div style="margin-top:10px">${chips}</div>` : ''}
    <div class="acoes"><button class="btn p" data-a="aalim">Adicionar</button></div>
  </div>

  <div class="card sec"><h2>Itens do dia</h2>
    <div class="sub">Arraste pela alça ⋮⋮ para trocar o item de refeição (ou segure o item) — ou edite e use o seletor.</div>${grupos}</div>

  <div class="card sec"><h2>Alimentos por 100 g / 100 ml</h2>
    <div class="sub">Valores por 100 g ou 100 ml, na unidade de cada alimento: calorias em kcal e macros em gramas. Edite direto na planilha — registrar no dia não altera nada aqui.</div>
    <input class="sel" id="alimCatBusca" data-k="alimcatbusca" placeholder="Buscar alimento…" aria-label="Buscar alimento" autocomplete="off" style="margin-bottom:10px">
    <div id="alimCatLista" class="lista-scroll">${htmlCatalogo()}</div>
    ${botoesCriacao}
    ${state.alimCriar ? `<div class="frm" style="margin-top:8px">
      <div style="grid-column:1/-1"><label>Novo alimento</label><input id="alimAlNovo" placeholder="ex.: Iogurte natural" aria-label="Novo alimento"></div>
      <div style="grid-column:1/-1"><label>Unidade</label><select class="sel" id="alimUnNovo" data-k="alimunnovo" aria-label="Unidade do alimento">
        <option value="g">g</option><option value="ml">ml</option>
      </select></div>
      <div><label data-rot100="Calorias">Calorias por 100 g</label><input id="alimKcalNovo" inputmode="decimal" placeholder="ex.: 60" aria-label="Calorias por 100 gramas ou 100 mililitros"></div>
      <div><label data-rot100="Proteína">Proteína por 100 g</label><input id="alimProtNovo" inputmode="decimal" placeholder="ex.: 20" aria-label="Proteína por 100 gramas ou 100 mililitros"></div>
      <div><label data-rot100="Carboidrato">Carboidrato por 100 g</label><input id="alimCarbNovo" inputmode="decimal" placeholder="ex.: 4" aria-label="Carboidrato por 100 gramas ou 100 mililitros"></div>
      <div><label data-rot100="Gordura">Gordura por 100 g</label><input id="alimGordNovo" inputmode="decimal" placeholder="ex.: 9" aria-label="Gordura por 100 gramas ou 100 mililitros"></div>
    </div>
    <div class="acoes"><button class="btn p" data-a="alrefadd">Adicionar alimento</button><button class="btn" data-a="alcancelar">Cancelar</button></div>` : ''}
    ${htmlReceita(todosAlimentos)}
  </div>

  <div class="card sec"><h2>Refeições</h2>
    <div class="sub">Renomeie, crie ou remova refeições. Arraste pela alça ⋮⋮ para reordenar. Só é possível remover refeições sem itens.</div>
    ${gerenciar}
    <div class="frm" style="margin-top:8px"><div style="grid-column:1/-1"><label>Nova refeição</label><input id="alimRefNovo" placeholder="ex.: Ceia" aria-label="Nova refeição"></div></div>
    <div class="acoes"><button class="btn" data-a="alimrefadd">Adicionar refeição</button></div>
  </div>`;

  return corpo;
}

/**
 * Switch the unit of the register form, carrying the typed amount across the
 * change so nothing typed is lost: g ⇄ ml keep the number (1 ml counts as 1 g)
 * and pieces turn the total into one piece of that weight.
 * @param {string} nova - 'g', 'ml' or 'un'
 * @returns {Promise<void>}
 */
async function trocarUnidadeRegistro(nova) {
  const alvo = ['g', 'ml', 'un'].includes(nova) ? nova : 'g';
  const atual = state.alimUnidade || 'g';
  if (alvo === atual) return;

  const gEl = document.getElementById('alimG');
  const qEl = document.getElementById('alimQtd');
  const pEl = document.getElementById('alimPeso');
  const val = el => (el && String(el.value || '').trim() !== '' ? num(el.value) : NaN);
  const total = atual === 'un' ? val(qEl) * val(pEl) : val(gEl);

  state.alimUnidade = alvo;
  state.alimUnidadeAuto = false; // escolha manual: a tranca do alimento abre
  await render();

  if (!(total > 0)) return;
  const g2 = document.getElementById('alimG');
  const q2 = document.getElementById('alimQtd');
  const p2 = document.getElementById('alimPeso');
  if (alvo === 'un') {
    if (q2) q2.value = '1';
    if (p2) p2.value = String(total).replace('.', ',');
  } else if (g2) {
    g2.value = String(total).replace('.', ',');
  }
  await atualizarAlimAuto(false);
}

/* --- Actions (data-a) and fields (data-k) of this screen --- */

/**
 * Handle one click action of this screen.
 * @param {string} a
 * @param {HTMLElement} b
 * @returns {Promise<boolean>}
 */
export async function aoClicar(a, b) {
  const v = +b.dataset.v;

  if (a === 'aalim') {
    try {
      const unidade = state.alimUnidade || 'g';
      await adicionarItem({
        data: state.alim,
        refeicaoId: (document.getElementById('alimRef') || {}).value,
        alimento: (document.getElementById('alimNome') || {}).value,
        unidade,
        gramas: unidade === 'un' ? null : (document.getElementById('alimG') || {}).value,
        qtd: unidade === 'un' ? (document.getElementById('alimQtd') || {}).value : null,
        pesoUnit: unidade === 'un' ? (document.getElementById('alimPeso') || {}).value : null,
        calorias: (document.getElementById('alimK') || {}).value
      });
      state.alimEdit = null;
      state.alimEditRef = null;
      state.alimEditUnidade = null;
      state.alimNome = '';
      state.alimUnidadeAuto = false; // o próximo registro começa com a troca livre de novo
      fecharSugestoes();
      await render();
      aviso('Item registrado ✓');
    } catch (err) {
      console.error('Erro ao registrar item:', err);
      aviso(err.message);
    }
    return true;
  }

  if (a === 'alimchip') {
    const nome = b.dataset.n || '';
    const g = b.dataset.g || '';
    const c = b.dataset.c || '';
    state.alimNome = nome;
    await seguirUnidadeDoAlimento(nome);
    // um repaint da unidade troca o DOM: os campos só são lidos depois dele
    const nomeEl = document.getElementById('alimNome');
    const gr = document.getElementById('alimG');
    const qtd = document.getElementById('alimQtd');
    const peso = document.getElementById('alimPeso');
    const kc = document.getElementById('alimK');
    if (nomeEl) nomeEl.value = nome;
    if (gr) gr.value = g;
    else if (peso) {
      // em unidades, a porção guardada vira 1 unidade do peso registrado
      peso.value = g;
      if (qtd) qtd.value = '1';
    }
    if (kc) kc.value = c;
    await atualizarAlimAuto(false).catch(err => console.error('Erro ao calcular calorias:', err));
    if (gr) gr.focus();
    else if (qtd) qtd.focus();
    return true;
  }

  if (a === 'alimsel') {
    await escolherSugestao(b.dataset.n || '');
    return true;
  }

  if (a === 'iremoveralim') {
    await removerItem(v);
    state.alimEdit = null;
    state.alimEditRef = null;
    state.alimEditUnidade = null;
    await render();
    aviso('Item removido');
    return true;
  }

  if (a === 'ialimedit') {
    try {
      const f = await buscarAlimento(b.dataset.n || '');
      const doCat = f && f.kcal100 !== null && f.kcal100 !== undefined && Number(f.kcal100) > 0
        ? Number(f.kcal100)
        : null;
      const doItem = Number(b.dataset.r);
      state.alimEditRef = doCat !== null
        ? doCat
        : (isFinite(doItem) && doItem > 0 ? doItem : null);
      state.alimEdit = v;
      state.alimEditUnidade = b.dataset.u || 'g';
      await render();
      const alvo = document.getElementById('alimEditG') || document.getElementById('alimEditQtd');
      if (alvo) { alvo.focus(); alvo.select && alvo.select(); }
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  if (a === 'ialimcancel') {
    state.alimEdit = null;
    state.alimEditRef = null;
    state.alimEditUnidade = null;
    await render();
    return true;
  }

  if (a === 'ialimsalvar') {
    try {
      const gEl = document.getElementById('alimEditG');
      const qEl = document.getElementById('alimEditQtd');
      const pEl = document.getElementById('alimEditPeso');
      await editarItem(v, {
        unidade: state.alimEditUnidade || undefined,
        gramas: gEl ? gEl.value : undefined,
        qtd: qEl ? qEl.value : undefined,
        pesoUnit: pEl ? pEl.value : undefined,
        calorias: (document.getElementById('alimEditK') || {}).value,
        refeicaoId: (document.getElementById('alimEditRef') || {}).value
      });
      state.alimEdit = null;
      state.alimEditRef = null;
      state.alimEditUnidade = null;
      await render();
      aviso('Item atualizado ✓');
    } catch (err) {
      console.error('Erro ao editar item:', err);
      aviso(err.message);
    }
    return true;
  }

  if (a === 'alimrefadd') {
    const refNovo = document.getElementById('alimRefNovo');
    try {
      await criarRefeicao(refNovo && refNovo.value);
      await render();
      aviso('Refeição criada ✓');
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  if (a === 'alimrefdel') {
    try {
      await removerRefeicao(b.dataset.v);
      await render();
      aviso('Refeição removida');
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  if (a === 'alcriar') {
    state.alimCriar = true;
    await render();
    return true;
  }

  if (a === 'alcancelar') {
    state.alimCriar = false;
    await render();
    return true;
  }

  if (a === 'alrefadd') {
    const alNovo = document.getElementById('alimAlNovo');
    try {
      const nome = alNovo && alNovo.value;
      const campos = [
        ['kcal100', (document.getElementById('alimKcalNovo') || {}).value],
        ['prot100', (document.getElementById('alimProtNovo') || {}).value],
        ['carb100', (document.getElementById('alimCarbNovo') || {}).value],
        ['gord100', (document.getElementById('alimGordNovo') || {}).value]
      ];
      for (const [campo, valor] of campos) {
        // kcal sempre passa (vazio limpa e permite derivar 4/4/9);
        // macros só quando preenchidas (nunca apagam referências existentes)
        if (campo === 'kcal100' || String(valor || '').trim() !== '') {
          await salvarReferencia(nome, valor, campo);
        }
      }
      // a unidade escolhida aqui guia os próximos registros e os que já existem
      const unNovo = document.getElementById('alimUnNovo');
      await salvarUnidadeAlimento(nome, unNovo && unNovo.value === 'ml' ? 'ml' : 'g');
      const f = await buscarAlimento(nome);
      const div = f && divergenciaKcal(f);
      state.alimCriar = false;
      await render();
      aviso(div ? `⚠ ${div}` : 'Alimento adicionado ✓');
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  if (a === 'alalimdel') {
    try {
      const nome = b.dataset.n || '';
      const usado = +(b.dataset.u || 0) > 0;
      if (usado && typeof window !== 'undefined' && typeof window.confirm === 'function') {
        const okExcluir = window.confirm(`Excluir "${nome}" do catálogo?\nOs registros já feitos não mudam, mas as referências por 100 g são perdidas.`);
        if (!okExcluir) return true;
      }
      await removerAlimento(+b.dataset.v);
      await render();
      aviso('Alimento removido ✓');
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  if (a === 'alimun') {
    await trocarUnidadeRegistro(b.dataset.v);
    return true;
  }

  if (a === 'pratoabrir') {
    state.alimPrato = true;
    await render();
    const nome = document.getElementById('pratoNome');
    if (nome) nome.focus();
    return true;
  }

  if (a === 'pratocancelar') {
    state.alimPrato = false;
    state.alimReceita = { nome: '', itens: [] };
    await render();
    return true;
  }

  if (a === 'pratoadd') {
    try {
      const nomeEl = document.getElementById('pratoIng');
      const gEl = document.getElementById('pratoG');
      const nome = String((nomeEl && nomeEl.value) || '').trim();
      const gramas = gEl && String(gEl.value || '').trim() !== '' ? num(gEl.value) : NaN;
      if (!nome) throw new Error('Informe o ingrediente');
      if (!isFinite(gramas) || gramas <= 0) throw new Error('Informe as gramas do ingrediente');

      const f = await buscarAlimento(nome);
      if (!f) throw new Error(`${nome} não está no catálogo`);
      const kcal = f.kcal100 !== null && f.kcal100 !== undefined && isFinite(Number(f.kcal100)) && Number(f.kcal100) > 0
        ? Number(f.kcal100)
        : kcalDosMacros(f);
      if (!(kcal > 0)) throw new Error(`${f.exibicao || f.nome} não tem referências por 100 g`);

      state.alimReceita.itens.push({
        alimento: f.exibicao || f.nome,
        gramas: r1n(gramas),
        kcal100: f.kcal100,
        prot100: f.prot100,
        carb100: f.carb100,
        gord100: f.gord100
      });
      await render();
      const proximo = document.getElementById('pratoIng');
      if (proximo) proximo.focus();
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  if (a === 'pratorem') {
    const ix = Number(b.dataset.v);
    if (state.alimReceita.itens[ix]) state.alimReceita.itens.splice(ix, 1);
    await render();
    return true;
  }

  if (a === 'pratosalvar') {
    try {
      const salvo = await salvarPrato({
        nome: state.alimReceita.nome,
        ingredientes: state.alimReceita.itens
      });
      state.alimPrato = false;
      state.alimReceita = { nome: '', itens: [] };
      await render();
      aviso(`Prato salvo no catálogo ✓ · ${f1(salvo.kcal)} kcal em ${f1(salvo.gramas)} g`);
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  return false;
}

/**
 * Date, food fields and search boxes of this screen.
 * @param {HTMLElement} el
 * @returns {Promise<boolean>}
 */
export async function aoDigitar(el) {
  const k = el.dataset.k;

  if (k === 'alimdata') {
    if (el.value) {
      await aguardarGravacoes();
      state.alim = el.value;
      state.alimEdit = null;
      state.alimEditRef = null;
      state.alimEditUnidade = null;
      await render();
    }
    return true;
  }

  if (k === 'alimNome') {
    state.alimNome = el.value;
    await atualizarAlimAuto(false);
    agendaSugestoes(el.value);
    return true;
  }

  if (k === 'alimG' || k === 'alimQtd' || k === 'alimPeso') {
    await atualizarAlimAuto(false);
    return true;
  }

  if (k === 'pratoNome') {
    state.alimReceita.nome = el.value;
    return true;
  }

  if (k === 'pratoIng' || k === 'pratoG') {
    return true;
  }

  if (k === 'alimcatbusca') {
    agendaCatalogo(el.value);
    return true;
  }

  return false;
}

/**
 * Meal select, calorie/macro targets, meal names, food name and the
 * per-100 g references (kcal and macros) of the catalog.
 * @param {HTMLElement} el
 * @returns {Promise<boolean>}
 */
export async function aoMudar(el) {
  const k = el.dataset.k;

  if (k === 'alimref') {
    state.alimRef = el.value;
    return true;
  }

  if (k === 'alimmeta') {
    try {
      await salvarMeta(el.value);
      await render();
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  if (k === 'alimmetaprot' || k === 'alimmetacarb' || k === 'alimmetagord') {
    try {
      await salvarMetaMacros({
        prot: (document.getElementById('alimMetaProt') || {}).value,
        carb: (document.getElementById('alimMetaCarb') || {}).value,
        gord: (document.getElementById('alimMetaGord') || {}).value
      });
      await render();
      aviso('Metas de macros salvas ✓');
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  if (k === 'alimrefnome') {
    try {
      await renomearRefeicao(el.dataset.v, el.value);
      await render();
    } catch (err) {
      aviso(err.message);
      await render();
    }
    return true;
  }

  if (k === 'alimEditUn') {
    state.alimEditUnidade = el.value === 'ml' || el.value === 'un' ? el.value : 'g';
    await render();
    return true;
  }

  // criação de alimento: os campos dizem "por 100 g" ou "por 100 ml"
  if (k === 'alimunnovo') {
    const un = el.value === 'ml' ? '100 ml' : '100 g';
    document.querySelectorAll('[data-rot100]').forEach(l => { l.textContent = `${l.dataset.rot100} por ${un}`; });
    return true;
  }

  if (k === 'alunid') {
    try {
      const { trocados } = await salvarUnidadeAlimento(el.dataset.n, el.value);
      // o registro acompanha, quando este é o alimento escolhido no formulário
      const nome = (document.getElementById('alimNome') || {}).value || '';
      const repintou = await seguirUnidadeDoAlimento(nome);
      if (!repintou) await render();
      aviso(trocados > 0
        ? `Unidade em ${el.value} ✓ · ${trocados} registro${trocados === 1 ? '' : 's'} acompanharam`
        : 'Unidade salva ✓');
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  if (k === 'alimNome') {
    const nome = el.value;
    state.alimNome = nome;
    const repintou = await seguirUnidadeDoAlimento(nome);
    await atualizarAlimAuto(true);
    if (repintou) {
      // a unidade trocou com o alimento: o próximo passo é a quantidade
      const alvo = document.getElementById('alimG') || document.getElementById('alimQtd');
      if (alvo) alvo.focus();
    }
    return true;
  }

  if (CAMPOS_REFERENCIA[k]) {
    try {
      await salvarReferencia(el.dataset.n, el.value, CAMPOS_REFERENCIA[k]);
      const f = await buscarAlimento(el.dataset.n);
      const div = f && divergenciaKcal(f);
      aviso(div ? `⚠ ${div}` : 'Referência salva ✓');
      await atualizarAlimAuto(false);
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  return false;
}

/**
 * Listeners owned by the suggestion drop-downs: open on focus, close on
 * outside click, paginate on scroll and reposition on resize.
 */
export function registrarEventosLista() {
  document.addEventListener('focusin', ev => {
    const el = ev.target;
    if (el && el.id === 'alimNome') {
      abrirSugestoes().catch(err => console.error('Erro ao abrir sugestões:', err));
    }
  });

  // Close the drop-down when tapping anywhere outside the Alimento field.
  document.addEventListener('click', ev => {
    if (!sugState.aberto) return;
    const alvo = ev.target;
    if (alvo && alvo.closest && alvo.closest('.alim-wrap')) return;
    fecharSugestoes();
  });

  // Pagination by dragging: the next page is fetched near the bottom of a list.
  document.addEventListener('scroll', ev => {
    const t = ev.target;
    if (!t) return;
    if (t.id === 'alimSug') {
      if (sugState.temMais && !sugState.carregando && semFim(t)) {
        carregarSugestoes(false).catch(err => console.error('Erro ao carregar sugestões:', err));
      }
      return;
    }
    if (t.id === 'alimCatLista') {
      if (catState.temMais && !catState.carregando && semFim(t)) {
        carregarCatalogo(false).catch(err => console.error('Erro ao carregar catálogo:', err));
      }
    }
  }, true);

  // The drop-down height depends on the space left above the "Adicionar" button.
  window.addEventListener('resize', () => {
    if (sugState.aberto) ajustarAlturaPop();
  });
}

/**
 * Escape/Enter while the type-ahead is open.
 * @param {KeyboardEvent} e
 * @returns {boolean} true when the key was consumed
 */
export function tratarTecladoLista(e) {
  const t = document.activeElement;

  if (e.key === 'Escape' && sugState.aberto) {
    fecharSugestoes();
    if (t && t.id === 'alimNome') t.blur();
    return true;
  }

  if (e.key === 'Enter' && t && t.id === 'alimNome' && sugState.aberto && sugState.itens.length) {
    e.preventDefault();
    escolherSugestao(sugState.itens[0].exibicao || sugState.itens[0].nome || '')
      .catch(err => console.error('Erro ao escolher sugestão:', err));
    return true;
  }

  return false;
}

/* --- Arrastar: ordem das refeições e itens entre refeições --- */

const LIMIAR_ITEM = 400; // ms de pressão (toque) antes de pegar um item
let pressao = null;      // pointer pressionado, ainda sem arrastar
let arrastando = null;   // arraste em andamento
let ultimoArraste = 0;   // fim do último arraste (suprime o swipe de trocar exercício)

/** True while a drag runs or just ended — used to mute the exercise swipe. */
export function arrasteAtivo() {
  return arrastando !== null || Date.now() - ultimoArraste < 600;
}

function bloquearScroll(ev) {
  ev.preventDefault();
}

function ligarBloqueioScroll() {
  document.addEventListener('touchmove', bloquearScroll, { passive: false });
}

function desligarBloqueioScroll() {
  document.removeEventListener('touchmove', bloquearScroll);
}

function posicionarFantasma(x, y) {
  const a = arrastando;
  if (!a) return;
  a.fantasma.style.left = `${x - a.dx}px`;
  a.fantasma.style.top = `${y - a.dy}px`;
}

function iniciarArraste(tipo, linha, x, y, pid) {
  const r = linha.getBoundingClientRect();
  const fantasma = linha.cloneNode(true);
  fantasma.classList.add('arraste-fantasma');
  fantasma.style.width = `${r.width}px`;
  document.body.appendChild(fantasma);
  linha.classList.add('arrastando');
  arrastando = {
    tipo,
    origem: linha,
    fantasma,
    dx: x - r.left,
    dy: y - r.top,
    pid,
    grupo: null,
    ordemOriginal: tipo === 'ordem' ? idsOrdem(linha.parentNode) : null
  };
  posicionarFantasma(x, y);
  ligarBloqueioScroll();
  try { linha.setPointerCapture && linha.setPointerCapture(pid); } catch (_) { /* sem suporte */ }
}

function idsOrdem(pai) {
  return [...pai.querySelectorAll('[data-ordem]')].map(el => el.dataset.ordem);
}

/**
 * Element under the pointer, looking through overlays (sticky header, toast):
 * while dragging, the finger can rest on top of them and still catch the meal
 * group or the reorder slot painted underneath.
 */
function elementoEm(x, y) {
  if (typeof document.elementsFromPoint === 'function') {
    const pilha = document.elementsFromPoint(x, y);
    const ache = el => el && el.closest && (el.closest('[data-grupo]') || el.closest('[data-ordem]'));
    return pilha.find(ache) || pilha[0] || null;
  }
  return document.elementFromPoint ? document.elementFromPoint(x, y) : null;
}

function aoPressionar(e) {
  if (arrastando || pressao || e.isPrimary === false) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const alvo = e.target;
  if (!alvo || !alvo.closest) return;

  const alca = alvo.closest('[data-alca]');
  if (alca) {
    const ordem = alca.closest('[data-ordem]');
    if (ordem) iniciarArraste('ordem', ordem, e.clientX, e.clientY, e.pointerId);
    else {
      const item = alca.closest('[data-item]');
      if (item) iniciarArraste('item', item, e.clientX, e.clientY, e.pointerId);
    }
    return;
  }

  const linha = alvo.closest('[data-item]');
  if (!linha || alvo.closest('button,input,select,textarea,a')) return;

  // Toque/pen: long-press para não brigar com o scroll; mouse arrasta na hora.
  if (e.pointerType === 'mouse') {
    iniciarArraste('item', linha, e.clientX, e.clientY, e.pointerId);
    return;
  }
  pressao = { x: e.clientX, y: e.clientY, linha, pid: e.pointerId };
  pressao.timer = setTimeout(() => {
    const p = pressao;
    pressao = null;
    if (p) iniciarArraste('item', p.linha, p.x, p.y, p.pid);
  }, LIMIAR_ITEM);
}

/** Highlight the meal group / reorder slot under the pointer. */
function atualizarAlvo(x, y) {
  if (!arrastando) return;
  const el = elementoEm(x, y);

  if (arrastando.tipo === 'item') {
    const grupo = el && el.closest ? el.closest('[data-grupo]') : null;
    if (arrastando.grupo !== grupo) {
      if (arrastando.grupo) arrastando.grupo.classList.remove('alvo');
      arrastando.grupo = grupo;
      if (grupo) grupo.classList.add('alvo');
    }
    return;
  }

  const alvo = el && el.closest ? el.closest('[data-ordem]') : null;
  const a = arrastando;
  if (!alvo || alvo === a.origem || alvo.parentNode !== a.origem.parentNode) return;
  const r = alvo.getBoundingClientRect();
  const depois = y > r.top + r.height / 2;
  alvo.parentNode.insertBefore(a.origem, depois ? alvo.nextSibling : alvo);
}

/* --- Rolagem automática: o ecrã acompanha o ícone arrastado até às bordas --- */

const ZONA_ROLAGEM = 90; // px junto ao topo/base em que a rolagem começa
const VEL_MAX = 18;      // px por frame mais perto da borda
const agendar = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : fn => setTimeout(fn, 16);
const cancelar = typeof cancelAnimationFrame === 'function'
  ? cancelAnimationFrame
  : clearTimeout;

const rolagem = { passo: 0, raf: 0, x: 0, y: 0 };

/**
 * Scroll step (px/frame) for a pointer at `y` on a viewport of `altura`:
 * 0 outside the edge zones, and inside them a signed step — negative at the
 * top (the page climbs, bringing the drop targets above down onto the
 * finger) and positive at the bottom (the page descends, bringing the ones
 * below up) — growing to VEL_MAX at the very edge. Pure helper (unit-tested
 * without DOM).
 * @param {number} y - clientY of the pointer
 * @param {number} altura - viewport height
 * @returns {number} negative = sobe a página, positive = desce a página
 */
export function passoRolagem(y, altura) {
  if (!(altura > 0) || !(y >= 0)) return 0;
  if (y < ZONA_ROLAGEM) return -Math.max(2, Math.round(VEL_MAX * (1 - y / ZONA_ROLAGEM)));
  const base = altura - y;
  if (base < ZONA_ROLAGEM) return Math.max(2, Math.round(VEL_MAX * (1 - base / ZONA_ROLAGEM)));
  return 0;
}

/** Keep the page (and therefore the drop targets) moving while the finger rests on an edge. */
function aoRolagem() {
  rolagem.raf = 0;
  if (!arrastando || !rolagem.passo) return;
  // passo negativo sobe a página (borda de cima), positivo desce (borda de baixo)
  if (typeof window.scrollBy === 'function') window.scrollBy(0, rolagem.passo);
  atualizarAlvo(rolagem.x, rolagem.y);
  rolagem.raf = agendar(aoRolagem);
}

/** Start/stop the auto-scroll from the pointer position (called on pointermove). */
function atualizarRolagem(x, y) {
  rolagem.x = x;
  rolagem.y = y;
  const passo = passoRolagem(y, typeof window.innerHeight === 'number' ? window.innerHeight : 0);
  if (passo === rolagem.passo) return;
  rolagem.passo = passo;
  if (passo && !rolagem.raf && arrastando) rolagem.raf = agendar(aoRolagem);
  if (!passo && rolagem.raf) {
    cancelar(rolagem.raf);
    rolagem.raf = 0;
  }
}

function pararRolagem() {
  rolagem.passo = 0;
  if (rolagem.raf) cancelar(rolagem.raf);
  rolagem.raf = 0;
}

function aoMover(e) {
  if (!arrastando) {
    if (pressao && (Math.abs(e.clientX - pressao.x) > 8 || Math.abs(e.clientY - pressao.y) > 8)) {
      clearTimeout(pressao.timer);
      pressao = null;
    }
    return;
  }
  posicionarFantasma(e.clientX, e.clientY);
  atualizarRolagem(e.clientX, e.clientY);
  atualizarAlvo(e.clientX, e.clientY);
}

async function aoSoltar() {
  if (pressao) {
    clearTimeout(pressao.timer);
    pressao = null;
  }
  const a = arrastando;
  if (!a) return;
  arrastando = null;
  ultimoArraste = Date.now();
  pararRolagem();
  desligarBloqueioScroll();
  a.fantasma.remove();
  a.origem.classList.remove('arrastando');
  try { a.origem.releasePointerCapture && a.origem.releasePointerCapture(a.pid); } catch (_) { /* já solto */ }

  try {
    if (a.tipo === 'item') {
      const grupo = a.grupo;
      if (grupo) grupo.classList.remove('alvo');
      const destino = grupo ? String(grupo.dataset.grupo || '') : '';
      const origemId = String(a.origem.dataset.ref || '');
      if (!destino || destino === origemId) return;
      await aguardarGravacoes();
      await moverItem(+a.origem.dataset.item, destino);
      await render();
      aviso('Item movido ✓');
      return;
    }

    const nova = idsOrdem(a.origem.parentNode);
    if (!nova.some((id, i) => id !== a.ordemOriginal[i])) return;
    await aguardarGravacoes();
    await reordenarRefeicoes(nova);
    await render();
    aviso('Ordem das refeições salva ✓');
  } catch (err) {
    aviso(err.message);
    await render();
  }
}

/** Pointer listeners of the drag-and-drop (call once, after the DOM exists). */
export function registrarArraste() {
  document.addEventListener('pointerdown', aoPressionar);
  document.addEventListener('pointermove', aoMover);
  document.addEventListener('pointerup', aoSoltar);
  document.addEventListener('pointercancel', aoSoltar);
}

registrarTela('alim', { render: telaAlimentacao });


