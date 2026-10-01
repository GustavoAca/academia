/**
 * Render pipeline: a single serialized queue that repaints #app from the
 * screen registered for `state.tela`.
 *
 * Screens call `render()` after changing state; overlapping calls never
 * interleave because they run one after the other.
 */

import { state, aguardarGravacoes } from './estado.js';
import { telaDe } from './rotas.js';

let filaRender = Promise.resolve();

/** Tab bar shared by every screen. */
export function tabs() {
  return `<div class="tabs">${[['treino', 'Treino'], ['rotina', 'Rotina'], ['foco', 'Foco'], ['med', 'Medidas'], ['alim', 'Alim.'], ['rel', 'Relatório'], ['cfg', 'Ajustes']]
    .map(t => `<button data-a="tela" data-t="${t[0]}" class="${state.tela === t[0] ? 'on' : ''}">${t[1]}</button>`)
    .join('')}</div>`;
}

/** Backup status button shown on the right of every header. */
export function statusBtn() {
  return `<button data-a="backup" style="all:unset;cursor:pointer" title="Baixar backup JSON"><i class="dot"></i><u>salvo no aparelho</u></button>`;
}

/** Standard page frame: tab bar, screen title and the screen body. */
export function moldura(titulo, corpo) {
  return `<header>${tabs()}
    <div class="res"><span>${titulo}</span><span>${statusBtn()}</span></div></header><main>${corpo}</main>`;
}

/**
 * Schedule a repaint. Always resolves (even when the screen throws) and
 * never runs two repaints at the same time.
 * @returns {Promise<void>}
 */
export function render() {
  filaRender = filaRender.then(executarRender, executarRender);
  return filaRender;
}

async function executarRender() {
  await aguardarGravacoes();

  const def = telaDe(state.tela);
  if (!def) return;

  const html = await def.render();
  document.getElementById('app').innerHTML = html;
  if (def.aposRender) await def.aposRender();
}
