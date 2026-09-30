/**
 * Rotina screen: editable draft of the active routine (days, sets, cardio,
 * duration) shared with the Foco preview.
 */

import { DIAS, CURTO, LONGO, esc, brd } from '../core/utils.js';
import { state, store } from '../core/estado.js';
import {
  rotinaPadrao,
  salvarRotina,
  totalSemanas,
  fimRotina,
  segundaDe,
  cardioDoDia,
  garantirCardio,
  sincronizarCatalogo
} from '../rotina-service.js';
import { TIPOS_CARDIO } from '../cardio-service.js';
import { loadCatalogo, posicaoInicial } from '../core/programa.js';
import { render, moldura } from '../core/render.js';
import { registrarTela } from '../core/rotas.js';
import { aviso } from '../core/toast.js';

/** Draft of the routine being edited (created from the active one). */
export function rascunhoRotina() {
  if (!store.rotinaRascunho) {
    store.rotinaRascunho = JSON.parse(JSON.stringify(store.rotina || rotinaPadrao()));
  }
  return store.rotinaRascunho;
}

/** Draft that is being edited: any change makes it a personal routine. */
export function editarRotina() {
  const r = rascunhoRotina();
  r.origem = 'personalizada';
  return r;
}

/**
 * Save the routine draft as the active routine and reload the catalog.
 * Shared by the Rotina screen (Salvar) and the Foco screen (Aplicar treino).
 * @returns {Promise<boolean>} true when saved; errors are toasted to the user
 */
export async function aplicarRascunho() {
  try {
    const salva = await salvarRotina(rascunhoRotina());
    store.rotina = salva;
    store.rotinaRascunho = null;
    await sincronizarCatalogo(store.rotina);
    await loadCatalogo();
    posicaoInicial();
    state.e = 0;
    state.lista = false;
    return true;
  } catch (err) {
    console.error('Erro ao salvar rotina:', err);
    aviso(err.message);
    return false;
  }
}

/** Full HTML of the Rotina screen. */
export function telaRotina() {
  const r = rascunhoRotina();
  const total = totalSemanas(r);
  const ini = segundaDe(r.inicio);
  const fim = fimRotina(r);

  const durOpts = [['semanas', 'Semanas'], ['meses', 'Meses'], ['ate', 'Até uma data']]
    .map(([v, l]) => `<option value="${v}" ${r.duracao.tipo === v ? 'selected' : ''}>${l}</option>`).join('');

  const durCampo = r.duracao.tipo === 'ate'
    ? `<div><label>Data final</label><input type="date" data-k="rate" value="${esc(r.duracao.ate || '')}"></div>`
    : `<div><label>${r.duracao.tipo === 'meses' ? 'Meses' : 'Semanas'}</label><input inputmode="numeric" data-k="rvalor" value="${esc(String(r.duracao.valor))}"></div>`;

  const dias = `<div class="dias">${DIAS.map((d, i) => `<button data-a="rdia" data-d="${d}" class="${r.dias[d] ? 'on' : ''}"><b>${CURTO[i]}</b><small>${r.dias[d] ? 'treino' : 'livre'}</small></button>`).join('')}</div>`;

  const cards = DIAS.filter(d => r.dias[d]).map(d => cardDiaRotina(r, d)).join('');

  const corpo = `<div class="card sec"><h2>Minha rotina</h2>
    <div class="sub">Escolha os dias que treina, quantas séries faz em cada exercício e por quanto tempo vai seguir esta rotina.</div>
    <div class="frm">
      <div><label>Início</label><input type="date" data-k="rinicio" value="${esc(ini)}"></div>
      <div><label>Duração</label><select class="sel" data-k="rtipo">${durOpts}</select></div>
      ${durCampo}
    </div>
    <div class="meta" style="margin-top:10px">${total} semanas · de ${brd(ini)} a ${brd(fim)}</div>
  </div>
  <div class="card sec"><h2>Dias de treino</h2><div class="sub">Marque os dias em que você treina. Os dias livres viram descanso.</div>${dias}</div>
  ${cards || '<div class="card"><div class="meta">Marque pelo menos um dia acima.</div></div>'}
  <div class="acoes"><button class="btn p" data-a="rsalvar">Salvar rotina</button><button class="btn" data-a="rpadrao">Restaurar padrão</button></div>
  <div class="meta" style="margin-top:8px">A semana 1 começa em ${brd(ini)}. Séries já registradas continuam no relatório.</div>`;

  return moldura('Minha rotina de treino', corpo);
}

/** One day card of the routine: exercises, sets, rep range and cardio. */
export function cardDiaRotina(r, dia) {
  const i = DIAS.indexOf(dia);
  const t = r.treinos[dia];
  const seriesDia = t.ex.reduce((a, e) => a + (Number(e.series) || 0), 0);

  const jaTem = new Set(t.ex.map(e => e.nome));
  const opcoes = [...store.exercisesById.values()]
    .filter(e => !jaTem.has(e.nome))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
    .map(e => `<option value="${esc(e.nome)}">${esc(e.nome)}</option>`).join('');

  const linhas = t.ex.map((ex, idx) => `<div class="li" style="flex-direction:column;align-items:stretch;gap:8px">
    <div style="display:flex;gap:8px;align-items:center">
      <span class="n" style="flex:1;min-width:0"><b>${esc(ex.nome)}</b><small>${esc(ex.grupo)}</small></span>
      <button class="btn" style="width:40px;height:40px;flex:none" data-a="rremover" data-d="${dia}" data-i="${idx}" aria-label="Remover ${esc(ex.nome)}">×</button>
    </div>
    <div style="display:flex;gap:8px">
      <label style="flex:1;font-size:11px;color:var(--mut)">Séries<input class="sel" style="width:100%;height:40px;margin-top:4px" inputmode="numeric" data-k="rserie" data-d="${dia}" data-i="${idx}" value="${esc(String(ex.series))}" aria-label="Séries de ${esc(ex.nome)}"></label>
      <label style="flex:1;font-size:11px;color:var(--mut)">Mín<input class="sel" style="width:100%;height:40px;margin-top:4px" inputmode="numeric" data-k="rmin" data-d="${dia}" data-i="${idx}" value="${esc(String(ex.min))}" aria-label="Repetições mínimas de ${esc(ex.nome)}"></label>
      <label style="flex:1;font-size:11px;color:var(--mut)">Máx<input class="sel" style="width:100%;height:40px;margin-top:4px" inputmode="numeric" data-k="rmax" data-d="${dia}" data-i="${idx}" value="${esc(String(ex.max))}" aria-label="Repetições máximas de ${esc(ex.nome)}"></label>
    </div></div>`).join('');

  const titulo = t.t && t.t !== LONGO[i] ? `${LONGO[i]} · ${esc(t.t)}` : LONGO[i];

  const cfgI = cardioDoDia(r, dia, 'i');
  const cfgF = cardioDoDia(r, dia, 'f');
  const tiposOpts = sel => TIPOS_CARDIO.map(t2 => `<option value="${esc(t2)}" ${sel === t2 ? 'selected' : ''}>${esc(t2)}</option>`).join('');
  const slotCfg = (m, cfg) => cfg.ativo ? `
    <div class="frm" style="margin-top:8px">
      <div><label>Tipo (${m === 'i' ? 'início' : 'fim'})</label><select class="sel" data-k="rcardiotipo" data-d="${dia}" data-m="${m}">${tiposOpts(cfg.tipo)}</select></div>
      <div><label>Minutos</label><input inputmode="numeric" data-k="rcardiomin" data-d="${dia}" data-m="${m}" value="${esc(cfg.min)}" placeholder="ex.: 30" aria-label="Minutos de cardio ${m === 'i' ? 'inicial' : 'final'} de ${LONGO[i]}"></div>
    </div>` : '';
  const cardioSec = `
    <div class="acoes" style="margin-top:12px">
      <button class="btn ${cfgI.ativo ? 'p' : ''}" data-a="rcardiotoggle" data-d="${dia}" data-m="i">Cardio início ${cfgI.ativo ? '✓' : ''}</button>
      <button class="btn ${cfgF.ativo ? 'p' : ''}" data-a="rcardiotoggle" data-d="${dia}" data-m="f">Cardio fim ${cfgF.ativo ? '✓' : ''}</button>
    </div>
    ${slotCfg('i', cfgI)}${slotCfg('f', cfgF)}`;

  return `<div class="card sec"><h2>${titulo}</h2>
    <div class="sub">Séries e meta de repetições (${seriesDia} séries no dia)</div>
    <input class="sel" data-k="rnome" data-d="${dia}" value="${esc(t.t)}" placeholder="Nome do treino" style="margin-bottom:10px" aria-label="Nome do treino ${LONGO[i]}">
    ${linhas || '<div class="meta">Nenhum exercício neste dia.</div>'}
    ${cardioSec}
    <div class="acoes"><select class="sel" data-k="radicionar" data-d="${dia}" aria-label="Adicionar exercício"><option value="">Adicionar exercício…</option>${opcoes}</select></div>
    <div class="frm" style="margin-top:8px">
      <div><label>Novo exercício</label><input data-k="rnovo" data-d="${dia}" placeholder="Nome"></div>
      <div><label>Grupo muscular</label><input data-k="rnovogrp" data-d="${dia}" placeholder="ex.: Peito"></div>
    </div>
    <div class="acoes"><button class="btn" data-a="rcriar" data-d="${dia}">Criar e adicionar</button></div>
  </div>`;
}

/**
 * Mirror a routine form field into the draft (no re-render, so focus is kept).
 * @param {string} k - data-k of the field
 * @param {HTMLElement} el
 * @returns {boolean} true when the field belongs to the routine form
 */
export function campoRotina(k, el) {
  const campos = ['rnome', 'rserie', 'rmin', 'rmax', 'rvalor', 'rinicio', 'rate', 'rcardiotipo', 'rcardiomin'];
  if (!campos.includes(k)) return false;

  const r = store.rotinaRascunho;
  if (!r) return true;

  r.origem = 'personalizada';

  const dia = el.dataset.d;
  const i = +(el.dataset.i || 0);

  if (k === 'rinicio') {
    if (el.value) r.inicio = el.value;
    return true;
  }
  if (k === 'rate') {
    if (el.value) r.duracao.ate = el.value;
    return true;
  }
  if (k === 'rvalor') {
    r.duracao.valor = el.value.replace(',', '.');
    return true;
  }
  if (k === 'rnome') {
    if (r.treinos[dia]) r.treinos[dia].t = el.value;
    return true;
  }
  if (k === 'rcardiotipo' || k === 'rcardiomin') {
    const slot = garantirCardio(r, dia, el.dataset.m);
    if (k === 'rcardiotipo') slot.tipo = el.value;
    else slot.min = el.value.replace(',', '.');
    return true;
  }

  const ex = r.treinos[dia] && r.treinos[dia].ex[i];
  if (ex) ex[k === 'rserie' ? 'series' : k === 'rmin' ? 'min' : 'max'] = el.value.replace(',', '.');
  return true;
}
/* --- Actions (data-a) and fields (data-k) of this screen --- */

/**
 * Handle one click action of this screen.
 * @param {string} a
 * @param {HTMLElement} b
 * @returns {Promise<boolean>}
 */
export async function aoClicar(a, b) {
  if (a === 'rdia') {
    const r = editarRotina();
    r.dias[b.dataset.d] = !r.dias[b.dataset.d];
    await render();
    return true;
  }

  if (a === 'rcardiotoggle') {
    const slot = garantirCardio(editarRotina(), b.dataset.d, b.dataset.m);
    slot.ativo = !slot.ativo;
    await render();
    return true;
  }

  if (a === 'rremover') {
    const r = editarRotina();
    const t = r.treinos[b.dataset.d];
    if (t) t.ex.splice(+(b.dataset.i || 0), 1);
    await render();
    return true;
  }

  if (a === 'rcriar') {
    const d = b.dataset.d;
    const nomeEl = document.querySelector(`[data-k="rnovo"][data-d="${d}"]`);
    const grpEl = document.querySelector(`[data-k="rnovogrp"][data-d="${d}"]`);
    const nome = ((nomeEl && nomeEl.value) || '').trim();
    if (!nome) { aviso('Informe o nome do exercício'); return true; }

    const r = editarRotina();
    if (r.treinos[d].ex.some(e => e.nome.toLowerCase() === nome.toLowerCase())) {
      aviso('Este exercício já está no dia');
      return true;
    }
    r.treinos[d].ex.push({
      nome,
      grupo: ((grpEl && grpEl.value) || '').trim() || 'Outros',
      series: 3,
      min: 8,
      max: 12
    });
    await render();
    aviso('Exercício adicionado');
    return true;
  }

  if (a === 'rsalvar') {
    if (await aplicarRascunho()) {
      await render();
      aviso('Rotina salva ✓');
    }
    return true;
  }

  if (a === 'rpadrao') {
    store.rotinaRascunho = JSON.parse(JSON.stringify(rotinaPadrao()));
    await render();
    aviso('Plano padrão carregado — revise e toque em Salvar');
    return true;
  }

  return false;
}

/**
 * Inline fields of the routine form (sets, reps, name, duration...).
 * @param {HTMLElement} el
 * @returns {Promise<boolean>}
 */
export async function aoDigitar(el) {
  const k = el.dataset.k;
  if (k.startsWith('r') && campoRotina(k, el)) return true;
  return false;
}

/**
 * Selects and date fields of the routine form.
 * @param {HTMLElement} el
 * @returns {Promise<boolean>}
 */
export async function aoMudar(el) {
  const k = el.dataset.k;

  if (k === 'rtipo') {
    const r = editarRotina();
    r.duracao.tipo = el.value;
    if (el.value === 'ate' && !r.duracao.ate) r.duracao.ate = fimRotina(r);
    await render();
    return true;
  }

  if (k === 'rinicio' || k === 'rate' || k === 'rvalor') {
    if (store.rotinaRascunho) await render();
    return true;
  }

  if (k === 'radicionar') {
    const dia = el.dataset.d;
    const nome = el.value;
    if (!nome || !store.rotinaRascunho) return true;

    const exercise = [...store.exercisesById.values()].find(e => e.nome === nome);
    if (!exercise) { aviso('Exercício não encontrado'); return true; }

    editarRotina().treinos[dia].ex.push({
      nome: exercise.nome,
      grupo: exercise.grupoMuscular,
      series: 3,
      min: 8,
      max: 12
    });
    await render();
    return true;
  }

  if (k === 'rcardiotipo') {
    campoRotina(k, el);
    return true;
  }

  return false;
}

registrarTela('rotina', { render: telaRotina });

