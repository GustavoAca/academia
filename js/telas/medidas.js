/**
 * Medidas screen: record body measurements for a date plus a short history.
 */

import { esc, f1, brd } from '../core/utils.js';
import { state, store, gravar, aguardarGravacoes } from '../core/estado.js';
import { MED, saveMeasurements, getAllMeasurementsDesc } from '../measurement-service.js';
import { render, moldura } from '../core/render.js';
import { registrarTela } from '../core/rotas.js';

/** Full HTML of the Medidas screen. */
export async function telaMed() {
  const measurements = await getAllMeasurementsDesc();
  const registro = measurements.find(m => m.data === state.md) || {};
  store.medDraft = { ...registro };

  const campos = MED.map(([k, nome, unid]) => {
    const anteriores = measurements.filter(m => m.data < state.md && m[k] !== null && m[k] !== undefined);
    const ult = anteriores.length ? anteriores[anteriores.length - 1] : null;
    const valor = registro[k] !== null && registro[k] !== undefined ? String(registro[k]).replace('.', ',') : '';
    return `<div><label>${nome} (${unid})</label><input data-k="m:${k}" inputmode="decimal" value="${esc(valor)}" placeholder="${ult ? f1(ult[k]) : ''}"></div>`;
  }).join('');

  const hist = measurements.slice(0, 12).map(m => {
    const peso = m.peso !== null && m.peso !== undefined ? esc(String(m.peso).replace('.', ',')) + ' kg' : '—';
    const preenchidos = MED.filter(([k]) => m[k] !== null && m[k] !== undefined).length;
    return `<tr data-a="mdia" data-d="${m.data}" style="cursor:pointer"><td>${brd(m.data)}${m.data === state.md ? ' ●' : ''}</td><td>${peso}</td><td>${preenchidos} campos</td></tr>`;
  }).join('');

  const corpo = `<div class="card sec"><h2>Registrar medidas</h2><div class="sub">Peso quando quiser; as demais medidas, uma vez por semana. O número em cinza é o último valor registrado.</div>
  <input type="date" class="sel" data-k="mdata" value="${state.md}" style="margin-bottom:12px"><div class="frm">${campos}</div></div>
  <div class="card sec"><h2>Histórico</h2>${hist ? `<table class="tb"><tr><th>Data</th><th>Peso</th><th>Preenchido</th></tr>${hist}</table>` : '<div class="meta">Nada registrado ainda.</div>'}</div>`;

  return moldura('Medidas corporais', corpo);
}

/* --- Actions (data-a) and fields (data-k) of this screen --- */

/**
 * Handle one click action of this screen.
 * @param {string} a
 * @param {HTMLElement} b
 * @returns {Promise<boolean>}
 */
export async function aoClicar(a, b) {
  if (a !== 'mdia') return false;
  state.md = b.dataset.d;
  await render();
  scrollTo(0, 0);
  return true;
}

/**
 * Date picker and the measurement inputs (data-k="m:<campo>").
 * @param {HTMLElement} el
 * @returns {Promise<boolean>}
 */
export async function aoDigitar(el) {
  const k = el.dataset.k;

  if (k === 'mdata') {
    if (el.value) {
      await aguardarGravacoes();
      state.md = el.value;
      await render();
    }
    return true;
  }

  if (k.slice(0, 2) === 'm:') {
    store.medDraft[k.slice(2)] = el.value.trim();
    const data = state.md;
    const draft = store.medDraft;
    gravar(() => saveMeasurements(data, draft));
    return true;
  }

  return false;
}

registrarTela('med', { render: telaMed });
