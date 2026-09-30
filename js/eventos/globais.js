/**
 * Actions that are not owned by a single screen: tab navigation and the
 * backup/file import buttons present in the header of every screen.
 */

import { state } from '../core/estado.js';
import { baixarBackup, importarArquivo } from '../core/importacao.js';
import { render } from '../core/render.js';
import { aviso } from '../core/toast.js';

/**
 * Handle one click action.
 * @param {string} a
 * @param {HTMLElement} b
 * @returns {Promise<boolean>}
 */
export async function aoClicar(a, b) {
  if (a === 'importar-backup') {
    const input = document.getElementById('arquivoBackup');
    if (input) input.click();
    return true;
  }

  if (a === 'importar-exemplo') {
    const input = document.getElementById('arquivoExemplo');
    if (input) input.click();
    return true;
  }

  if (a === 'tela') {
    state.tela = b.dataset.t;
    await render();
    scrollTo(0, 0);
    return true;
  }

  return false;
}

/**
 * The hidden file inputs (backup and example import) are picked through the
 * change event, which carries no data-k.
 */
export function registrarArquivos() {
  document.addEventListener('change', async ev => {
    const el = ev.target;
    const tipo = el && el.id === 'arquivoBackup' ? 'backup'
      : el && el.id === 'arquivoExemplo' ? 'exemplo'
        : null;
    if (!tipo) return;

    const file = el.files && el.files[0];
    el.value = '';
    if (!file) return;

    try {
      aviso(await importarArquivo(file, tipo));
    } catch (err) {
      console.error('Erro ao importar arquivo:', err);
      aviso('Erro ao importar: ' + err.message);
    }
  });
}

export { baixarBackup };
