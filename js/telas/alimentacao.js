/**
 * Alimentação screen: daily summary, meal logging, inline item editor,
 * meal management and the paginated food suggestion lists.
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
  buscarCatalogo,
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
    ? `${f1(f.kcal100)} kcal/100 g`
    : 'sem referência';
  const macros = macros100Txt(f);
  const usos = `${f.vezes || 0} registro${(f.vezes || 0) === 1 ? '' : 's'}`;
  return `<button type="button" class="li" data-a="alimsel" data-n="${esc(nome)}"><span class="n"><b>${esc(nome)}</b><small>${ref}${macros ? ' · ' + macros : ''} · ${usos}</small></span></button>`;
}

function linhaCatalogo(f) {
  const nome = f.exibicao || f.nome || '';
  const inp = (k, v, rot) => `<input class="sel" data-k="${k}" data-n="${esc(f.nome)}" inputmode="decimal" value="${temRef(v) ? String(v).replace('.', ',') : ''}" placeholder="?" style="width:64px;flex:none;height:34px;text-align:center;font-size:13px" aria-label="${rot} por 100 g de ${esc(nome)}">`;
  const macro = (k, v, letra, rot) => `<span style="font-size:11px;color:var(--mut);white-space:nowrap">${letra}</span>${inp(k, v, rot)}`;
  return `<div class="li" style="padding:8px 10px;flex-wrap:wrap;row-gap:6px">
    <span class="n" style="flex:1;min-width:120px"><b>${esc(nome)}</b><small>${f.vezes || 0} registro${(f.vezes || 0) === 1 ? '' : 's'}</small></span>
    ${inp('alkcal', f.kcal100, 'Calorias')}
    <span style="font-size:12px;color:var(--mut);white-space:nowrap">kcal/100 g</span>
    <div style="display:flex;gap:6px;align-items:center;width:100%;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--mut);white-space:nowrap">g/100 g:</span>
      ${macro('alprot', f.prot100, 'Prot', 'Proteína')}
      ${macro('alcarb', f.carb100, 'Carb', 'Carboidrato')}
      ${macro('algord', f.gord100, 'Gord', 'Gordura')}
      <button class="btn" style="width:36px;height:34px;flex:none;margin-left:auto" data-a="alalimdel" data-v="${f.id === undefined || f.id === null ? '' : f.id}" data-n="${esc(nome)}" data-u="${f.vezes || 0}" aria-label="Excluir ${esc(nome)} do catálogo">×</button>
    </div></div>`;
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
    ? st.itens.map(linhaCatalogo).join('')
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

/** Fill the Alimento field from a suggestion and move on to the grams. */
export function escolherSugestao(nome) {
  const nomeEl = document.getElementById('alimNome');
  const gEl = document.getElementById('alimG');
  if (nomeEl) nomeEl.value = nome || '';
  fecharSugestoes();
  atualizarAlimAuto(true).catch(err => console.error('Erro ao calcular calorias:', err));
  if (gEl) gEl.focus();
}

/**
 * Keep the calorie field in sync with the grams when the food has a calorie
 * reference per 100 g (kcal100). With a reference the field is read-only:
 * calories always come from the conversion.
 * @param {boolean} prefill - also pre-fill empty grams with the last ones used
 */
export async function atualizarAlimAuto(prefill) {
  const nomeEl = document.getElementById('alimNome');
  const gEl = document.getElementById('alimG');
  const kEl = document.getElementById('alimK');
  const hint = document.getElementById('alimHint');
  if (!nomeEl || !gEl || !kEl) return;

  const f = await buscarAlimento(nomeEl.value);
  const temRef = !!(f && f.kcal100);
  kEl.readOnly = temRef;

  if (!temRef) {
    if (hint) {
      hint.textContent = f
        ? 'Este alimento ainda não tem referência por 100 g — informe as calorias.'
        : 'Informe as gramas e as calorias deste alimento.';
    }
    return;
  }

  let g = Number(String(gEl.value || '').replace(',', '.'));
  if (prefill && !(g > 0) && f.ultimoGramas) {
    g = Number(f.ultimoGramas);
    gEl.value = String(f.ultimoGramas).replace('.', ',');
  }

  if (g > 0) {
    kEl.value = String(r1n(g * f.kcal100 / 100)).replace('.', ',');
    hint.textContent = `${f.exibicao}: ${f1(f.kcal100)} kcal por 100 g · ${f1(g)} g → ${f1(Number(String(kEl.value).replace(',', '.')) || 0)} kcal${macroPorcaoTxt(f, g)}`;
    const div = divergenciaKcal(f);
    if (div) hint.textContent += ` · ⚠ ${div}`;
  } else {
    kEl.value = '';
    const m100 = macros100Txt(f);
    hint.textContent = `${f.exibicao}: ${f1(f.kcal100)} kcal por 100 g${m100 ? ` · ${m100}` : ''} · digite as gramas`;
  }
}
/** Row of a day's item: read mode (edit/remove) or inline editor. */
function linhaItemDia(i, opts) {
  const gramas = i.gramas !== null && i.gramas !== undefined ? f1(i.gramas) + ' g · ' : '';
  if (state.alimEdit !== i.id) {
    return `<div class="li" data-item="${i.id}" data-ref="${esc(i.refeicaoId || '')}"><span class="n"><b>${esc(i.alimento)}</b><small>${gramas}${f1(i.calorias)} kcal${macrosItemTxt(i)}</small></span>
      <button class="btn" style="width:40px;height:40px;flex:none" data-a="ialimedit" data-v="${i.id}" data-n="${esc(i.alimento)}" data-r="${i.kcal100 === null || i.kcal100 === undefined ? '' : i.kcal100}" aria-label="Editar item ${esc(i.alimento)}">✎</button>
      <button class="btn" style="width:40px;height:40px;flex:none" data-a="iremoveralim" data-v="${i.id}" aria-label="Remover item">×</button></div>`;
  }

  const ref = state.alimEditRef;
  const temRef = ref !== null && ref !== undefined && isFinite(Number(ref)) && Number(ref) > 0;
  const gv = i.gramas === null || i.gramas === undefined ? '' : String(i.gramas).replace('.', ',');
  const kv = temRef
    ? (i.gramas !== null && i.gramas !== undefined
      ? String(r1n(Number(i.gramas) * Number(ref) / 100)).replace('.', ',')
      : '')
    : (i.calorias === null || i.calorias === undefined ? '' : String(i.calorias).replace('.', ','));

  return `<div class="li" style="flex-wrap:wrap">
    <span class="n" style="min-width:100%"><b>${esc(i.alimento)}</b><small>${temRef
      ? `${f1(Number(ref))} kcal/100 g — as calorias vêm da conversão`
      : 'sem referência por 100 g — informe as calorias'}</small></span>
    <div style="display:flex;gap:8px;width:100%">
      <input class="sel" id="alimEditG" inputmode="decimal" value="${esc(gv)}" placeholder="gramas" style="flex:1;height:44px" aria-label="Gramas de ${esc(i.alimento)}">
      <input class="sel" id="alimEditK" inputmode="decimal" value="${esc(kv)}" placeholder="kcal" ${temRef ? 'readonly' : ''} style="flex:1;height:44px" aria-label="Calorias de ${esc(i.alimento)}">
    </div>
    ${opts ? `<div style="width:100%;margin-top:8px"><label style="font-size:12px;color:var(--mut);display:block;margin-bottom:2px">Refeição</label>
      <select class="sel" id="alimEditRef" aria-label="Refeição do item">${opts}</select></div>` : ''}
    <div class="acoes" style="width:100%;margin-top:8px">
      <button class="btn p" data-a="ialimsalvar" data-v="${i.id}">Salvar</button>
      <button class="btn" data-a="ialimcancel">Cancelar</button>
    </div></div>`;
}

/** Full HTML of the Alimentação screen. */
export async function telaAlimentacao() {
  resetarListas();
  const data = state.alim;
  const [resumoDia, refeicoes, primeira] = await Promise.all([
    resumoDoDia(data),
    getRefeicoes(),
    buscarCatalogo('', 0, TAM_PAGINA)
  ]);

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
  const excedeu = meta !== null && resumoDia.total > meta;
  const falta = meta === null ? null : meta - resumoDia.total;
  const pct = meta ? Math.min(100, resumoDia.total / meta * 100) : 0;
  const kp = (b, s) => `<div class="kpi"><b>${b}</b><small>${s}</small></div>`;

  const mm = resumoDia.metaMacros || { prot: null, carb: null, gord: null };
  const mv = resumoDia.macros || { prot: 0, carb: 0, gord: 0 };
  const macroLinha = (rot, chave) => {
    const val = Number(mv[chave]) || 0;
    const alvo = mm[chave];
    if (!(alvo > 0)) return '';
    const mpct = Math.min(100, val / alvo * 100);
    return `<div class="hbar"><span>${rot}</span><span><i style="width:${mpct.toFixed(0)}%;background:${val >= alvo ? 'var(--ok)' : 'var(--ac)'}"></i></span>
      <span style="white-space:nowrap">${f1(val)}/${f1(alvo)} g</span></div>`;
  };
  const macroVal = chave => (mm[chave] !== null && mm[chave] !== undefined ? String(mm[chave]).replace('.', ',') : '');
  const macrosHtml = [macroLinha('Proteína', 'prot'), macroLinha('Carboidrato', 'carb'), macroLinha('Gordura', 'gord')].join('') ||
    `<div class="meta">Proteína ${f1(mv.prot)} g · Carboidrato ${f1(mv.carb)} g · Gordura ${f1(mv.gord)} g — defina as metas acima para acompanhar o progresso.</div>`;

  const terceiro = falta === null
    ? kp('—', 'defina uma meta diária')
    : falta >= 0
      ? kp(f1(falta) + ' kcal', 'faltam para a meta')
      : kp(f1(-falta) + ' kcal', 'acima da meta');

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

  const corpo = `<div class="card sec"><h2>Resumo do dia</h2>
    <input type="date" class="sel" data-k="alimdata" value="${data}" style="margin-bottom:12px" aria-label="Data do registro">
    <div class="kpis">${kp(f1(resumoDia.total), 'kcal no dia')}${kp(meta !== null ? f1(meta) + ' kcal' : '—', 'meta diária')}${terceiro}</div>
    ${meta !== null ? `<div class="bar"><i style="width:${pct.toFixed(0)}%;background:${excedeu ? 'var(--warn)' : 'var(--ok)'}"></i></div>` : ''}
    <div class="frm" style="margin-top:12px"><div><label>Meta diária (kcal)</label><input data-k="alimmeta" inputmode="decimal" value="${meta !== null ? String(meta).replace('.', ',') : ''}" placeholder="ex.: 2200" aria-label="Meta calórica diária"></div></div>
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
    <div class="sub">Com a referência de 100 g, digite só as gramas — calorias e macros vêm na conversão.</div>
    <div class="frm">
      <div style="grid-column:1/-1"><label>Refeição</label><select class="sel" id="alimRef" data-k="alimref" aria-label="Refeição">${opts}</select></div>
      <div class="alim-wrap">
        <label>Alimento</label>
        <input id="alimNome" data-k="alimNome" placeholder="ex.: Frango grelhado" aria-label="Alimento" autocomplete="off" enterkeyhint="next" aria-autocomplete="list" aria-expanded="false">
        <div id="alimSug" class="pop" role="listbox" hidden></div>
      </div>
      <div><label>Gramas</label><input id="alimG" data-k="alimG" inputmode="decimal" placeholder="ex.: 150" aria-label="Gramas"></div>
      <div><label>Calorias</label><input id="alimK" data-k="alimK" inputmode="decimal" placeholder="ex.: 250" aria-label="Calorias"></div>
    </div>
    <div class="sub" id="alimHint" style="margin-top:8px">Informe as gramas e as calorias deste alimento.</div>
    ${chips ? `<div style="margin-top:10px">${chips}</div>` : ''}
    <div class="acoes"><button class="btn p" data-a="aalim">Adicionar</button></div>
  </div>

  <div class="card sec"><h2>Itens do dia</h2>
    <div class="sub">Segure e arraste um item para mudá-lo de refeição — ou edite e use o seletor.</div>${grupos}</div>

  <div class="card sec"><h2>Alimentos por 100 g</h2>
    <div class="sub">As referências por 100 g de cada alimento: calorias e macros (P, C e G). Salvar um item nunca altera estes valores — eles só mudam aqui.</div>
    <input class="sel" id="alimCatBusca" data-k="alimcatbusca" placeholder="Buscar alimento…" aria-label="Buscar alimento por 100 g" autocomplete="off" style="margin-bottom:10px">
    <div id="alimCatLista" class="lista-scroll">${htmlCatalogo()}</div>
    <div class="frm" style="margin-top:8px">
      <div style="grid-column:1/-1"><label>Novo alimento</label><input id="alimAlNovo" placeholder="ex.: Iogurte natural" aria-label="Novo alimento"></div>
      <div><label>Calorias por 100 g</label><input id="alimKcalNovo" inputmode="decimal" placeholder="ex.: 60" aria-label="Calorias por 100 gramas"></div>
      <div><label>Proteína (g/100 g)</label><input id="alimProtNovo" inputmode="decimal" placeholder="ex.: 20" aria-label="Proteína por 100 gramas"></div>
      <div><label>Carboidrato (g/100 g)</label><input id="alimCarbNovo" inputmode="decimal" placeholder="ex.: 4" aria-label="Carboidrato por 100 gramas"></div>
      <div><label>Gordura (g/100 g)</label><input id="alimGordNovo" inputmode="decimal" placeholder="ex.: 9" aria-label="Gordura por 100 gramas"></div>
    </div>
    <div class="acoes"><button class="btn" data-a="alrefadd">Adicionar alimento</button></div>
  </div>

  <div class="card sec"><h2>Refeições</h2>
    <div class="sub">Renomeie, crie ou remova refeições. Arraste pela alça ⋮⋮ para reordenar. Só é possível remover refeições sem itens.</div>
    ${gerenciar}
    <div class="frm" style="margin-top:8px"><div style="grid-column:1/-1"><label>Nova refeição</label><input id="alimRefNovo" placeholder="ex.: Ceia" aria-label="Nova refeição"></div></div>
    <div class="acoes"><button class="btn" data-a="alimrefadd">Adicionar refeição</button></div>
  </div>`;

  return moldura('Alimentação', corpo);
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
      await adicionarItem({
        data: state.alim,
        refeicaoId: (document.getElementById('alimRef') || {}).value,
        alimento: (document.getElementById('alimNome') || {}).value,
        gramas: (document.getElementById('alimG') || {}).value,
        calorias: (document.getElementById('alimK') || {}).value
      });
      state.alimEdit = null;
      state.alimEditRef = null;
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
    const nome = document.getElementById('alimNome');
    const gr = document.getElementById('alimG');
    const kc = document.getElementById('alimK');
    if (nome) nome.value = b.dataset.n || '';
    if (gr) gr.value = b.dataset.g || '';
    if (kc) kc.value = b.dataset.c || '';
    await atualizarAlimAuto(false);
    if (gr) gr.focus();
    return true;
  }

  if (a === 'alimsel') {
    escolherSugestao(b.dataset.n || '');
    return true;
  }

  if (a === 'iremoveralim') {
    await removerItem(v);
    state.alimEdit = null;
    state.alimEditRef = null;
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
      await render();
      const g = document.getElementById('alimEditG');
      if (g) { g.focus(); g.select && g.select(); }
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }

  if (a === 'ialimcancel') {
    state.alimEdit = null;
    state.alimEditRef = null;
    await render();
    return true;
  }

  if (a === 'ialimsalvar') {
    try {
      await editarItem(v, {
        gramas: (document.getElementById('alimEditG') || {}).value,
        calorias: (document.getElementById('alimEditK') || {}).value,
        refeicaoId: (document.getElementById('alimEditRef') || {}).value
      });
      state.alimEdit = null;
      state.alimEditRef = null;
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
      const f = await buscarAlimento(nome);
      const div = f && divergenciaKcal(f);
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
      await render();
    }
    return true;
  }

  if (k === 'alimNome') {
    await atualizarAlimAuto(false);
    agendaSugestoes(el.value);
    return true;
  }

  if (k === 'alimG') {
    await atualizarAlimAuto(false);
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

  if (k === 'alimNome') {
    await atualizarAlimAuto(true);
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
    escolherSugestao(sugState.itens[0].exibicao || sugState.itens[0].nome || '');
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

function elementoEm(x, y) {
  return document.elementFromPoint ? document.elementFromPoint(x, y) : null;
}

function aoPressionar(e) {
  if (arrastando || pressao || e.isPrimary === false) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const alvo = e.target;
  if (!alvo || !alvo.closest) return;

  const alca = alvo.closest('[data-alca]');
  if (alca) {
    const linha = alca.closest('[data-ordem]');
    if (linha) iniciarArraste('ordem', linha, e.clientX, e.clientY, e.pointerId);
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

function aoMover(e) {
  if (!arrastando) {
    if (pressao && (Math.abs(e.clientX - pressao.x) > 8 || Math.abs(e.clientY - pressao.y) > 8)) {
      clearTimeout(pressao.timer);
      pressao = null;
    }
    return;
  }
  posicionarFantasma(e.clientX, e.clientY);

  const el = elementoEm(e.clientX, e.clientY);
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
  const depois = e.clientY > r.top + r.height / 2;
  alvo.parentNode.insertBefore(a.origem, depois ? alvo.nextSibling : alvo);
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


