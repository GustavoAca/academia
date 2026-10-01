/**
 * Configurações screen: display preferences (circular charts and the
 * percentage shown next to the daily macro goals).
 */

import { state } from '../core/estado.js';
import { salvarAjustes } from '../ajustes-service.js';
import { render, moldura } from '../core/render.js';
import { registrarTela } from '../core/rotas.js';
import { aviso } from '../core/toast.js';

/** Full HTML of the Configurações screen. */
export async function telaConfiguracoes() {
  const a = state.ajustes || { circular: true, pct: true };
  const linha = (rot, ligado, acao) => `<div class="linha-ajuste"><span>${rot}</span>
    <button class="sw${ligado ? ' on' : ''}" data-a="${acao}" role="switch" aria-checked="${ligado}" aria-label="${rot}"></button></div>`;

  const corpo = `<div class="card sec"><h2>Exibição dos gráficos</h2>
    <div class="sub">Vale para Proteína, Carboidrato e Gordura contra a meta na aba Alimentação.</div>
    ${linha('Círculos no lugar de barras', !!a.circular, 'ajcircular')}
    ${linha('Mostrar percentual para bater a meta', !!a.pct, 'ajpct')}
  </div>`;

  return moldura('Configurações', corpo);
}

/**
 * Toggle one display preference.
 * @param {string} a
 * @returns {Promise<boolean>}
 */
export async function aoClicar(a) {
  if (a === 'ajcircular' || a === 'ajpct') {
    try {
      const chave = a === 'ajcircular' ? 'circular' : 'pct';
      const atuais = state.ajustes || { circular: true, pct: true };
      const salvo = await salvarAjustes({ ...atuais, [chave]: !atuais[chave] });
      state.ajustes = salvo;
      await render();
      aviso('Ajuste salvo ✓');
    } catch (err) {
      aviso(err.message);
    }
    return true;
  }
  return false;
}

registrarTela('cfg', { render: telaConfiguracoes });
