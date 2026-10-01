/**
 * Application entry point: boots the database, seeds the catalog, registers
 * the global event listeners and starts the UI.
 *
 * The screens live in js/telas/, the event routing in js/eventos/ and the
 * shared state/render plumbing in js/core/. Importing this module wires the
 * whole graph together (see index.html).
 */

import { initDB, getSetting } from './db.js';
import { getRotina, sincronizarCatalogo } from './rotina-service.js';
import { getAjustes } from './ajustes-service.js';
import { seedFromPlano } from './core/seed.js';
import { migrateFromLocalStorage, baixarBackup } from './core/importacao.js';
import { backfillMacros } from './food-service.js';
import { loadCatalogo, posicaoInicial } from './core/programa.js';
import { carregarLogDoDia, primeiroPasso } from './core/log-dia.js';
import { render } from './core/render.js';
import { aviso } from './core/toast.js';
import { state, store } from './core/estado.js';
import { registrarEventos } from './eventos/index.js';
import './telas/index.js';

/**
 * First run: open the database, load the routine, seed missing data, migrate
 * any legacy localStorage payload and paint the first screen.
 * @returns {Promise<void>}
 */
export async function initApp() {
  try {
    await initDB();
    store.rotina = await getRotina();
    await sincronizarCatalogo(store.rotina);
    await seedFromPlano();
    store.notas = (await getSetting('notas')) || {};
    state.ajustes = await getAjustes();
    await migrateFromLocalStorage();
    await loadCatalogo();
    posicaoInicial();
    await carregarLogDoDia();
    state.e = await primeiroPasso();
    await render();
    aviso('Aplicação inicializada com sucesso');
    // Completa os macros de registros antigos sem atrasar a primeira tela;
    // quando algo muda, a tela é pintada de novo com os valores prontos.
    backfillMacros()
      .then(n => (n > 0 ? render() : undefined))
      .catch(err => console.warn('Backfill de macros:', err.message));
  } catch (err) {
    console.error('Erro ao inicializar aplicação:', err);
    aviso('Erro ao iniciar aplicação');
  }
}

// Module scripts run after the document is parsed, so the DOM is ready
// unless the page is still loading (e.g. dynamically injected module).
function iniciar() {
  registrarEventos();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}

if (typeof document !== 'undefined') {
  iniciar();
}

export { render, baixarBackup };
