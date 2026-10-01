/**
 * Central event dispatch: routes click (`data-a`), input (`data-k`) and
 * change (`data-k`) events to the screen that owns them, in an order that
 * reproduces the original monolith (the routine form is checked first so its
 * `r*` prefix never swallows other screens' fields).
 *
 * Register everything with registrarEventos() after the DOM is ready.
 */

import { aguardarGravacoes } from '../core/estado.js';
import * as globais from './globais.js';
import { registrarNavegacao } from './navegacao.js';
import * as treino from '../telas/treino.js';
import * as medidas from '../telas/medidas.js';
import * as alimentacao from '../telas/alimentacao.js';
import * as relatorio from '../telas/relatorio.js';
import * as rotina from '../telas/rotina.js';
import * as foco from '../telas/foco.js';
import * as configuracoes from '../telas/configuracoes.js';
const CLIQUES = [globais, treino, rotina, foco, medidas, relatorio, alimentacao, configuracoes];
const ENTRADAS = [rotina, relatorio, medidas, alimentacao, treino];
const MUDANCAS = [rotina, treino, alimentacao];

/**
 * @param {Event} ev
 * @param {'aoDigitar'|'aoMudar'} metodo
 * @param {Array<object>} lista
 * @returns {Promise<void>}
 */
async function despachar(ev, metodo, lista) {
  const el = ev.target;
  const k = el && el.dataset ? el.dataset.k : null;
  if (!k) return;

  for (const tela of lista) {
    const fn = tela[metodo];
    if (typeof fn === 'function' && await fn(el)) return;
  }
}

/**
 * Main action router. `backup` runs before the write queue is flushed, exactly
 * like the original monolith (download must not wait on pending writes).
 * @param {Event} ev
 * @returns {Promise<void>}
 */
async function aoClicar(ev) {
  const b = ev.target.closest('[data-a]');
  if (!b) return;

  const a = b.dataset.a;
  if (a === 'backup') {
    await globais.baixarBackup();
    return;
  }

  await aguardarGravacoes();

  for (const tela of CLIQUES) {
    if (await tela.aoClicar(a, b)) return;
  }
}

/** Wire every global listener of the app (call once, after the DOM exists). */
export function registrarEventos() {
  document.addEventListener('change', ev => despachar(ev, 'aoMudar', MUDANCAS));
  document.addEventListener('input', ev => despachar(ev, 'aoDigitar', ENTRADAS));
  document.addEventListener('click', aoClicar);
  globais.registrarArquivos();
  alimentacao.registrarEventosLista();
  alimentacao.registrarArraste();
  registrarNavegacao();
}
