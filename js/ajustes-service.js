/**
 * Ajustes - preferências de exibição (gráficos e percentuais).
 *
 * Guardadas em settings para viajarem no backup; `state.ajustes` é a cópia
 * viva que as telas leem durante o render (carregada no boot em app.js).
 * Padrão: círculos e percentuais ligados — só um false explícito desliga.
 */

import { saveSetting, getSetting } from './db.js';

const CHAVE_AJUSTES = 'ajustesGraficos';

/** Defaults used when nothing was ever saved. */
const AJUSTES_PADRAO = { circular: true, pct: true };

/**
 * Current display preferences (missing or legacy values fall back to true).
 * @returns {Promise<{circular: boolean, pct: boolean}>}
 */
async function getAjustes() {
  const salvo = await getSetting(CHAVE_AJUSTES);
  return {
    circular: !(salvo && salvo.circular === false),
    pct: !(salvo && salvo.pct === false)
  };
}

/**
 * Save both display preferences; every value must be a boolean.
 * @param {Object} p - { circular, pct }
 * @returns {Promise<{circular: boolean, pct: boolean}>} the saved values
 */
async function salvarAjustes(p) {
  const out = { ...AJUSTES_PADRAO };
  for (const k of ['circular', 'pct']) {
    const v = p && p[k] !== undefined ? p[k] : undefined;
    if (typeof v !== 'boolean') throw new Error('Ajuste inválido');
    out[k] = v;
  }
  await saveSetting(CHAVE_AJUSTES, out);
  return out;
}

export {
  CHAVE_AJUSTES,
  AJUSTES_PADRAO,
  getAjustes,
  salvarAjustes
};
