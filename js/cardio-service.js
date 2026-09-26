/**
 * Cardio Service - registro de cardio (caminhada, corrida, pular corda...).
 *
 * A pessoa escolhe a atividade e anota o tempo do percurso. O mesmo tipo no
 * mesmo momento (início ou fim do treino) do mesmo dia atualiza o tempo em
 * vez de criar outro registro.
 *
 * Cada registro guarda `momento`: 'i' = cardio no início, 'f' = no final
 * (registros antigos, sem o campo, contam como 'f'). Qual dos dois passos
 * aparece na rotina é configuração do usuário: por padrão só o final vem
 * ativo.
 *
 * O pulo do cardio fica em settings ('cardioPulados'):
 *   { 'YYYY-MM-DD': { i: bool, f: bool } }
 */

import {
  upsertCardio,
  getCardiosByDate,
  getAllCardios,
  deleteCardio,
  getSetting,
  saveSetting
} from './db.js';

const TIPOS_CARDIO = ['Caminhada', 'Corrida', 'Pular corda', 'Bicicleta', 'Natação', 'Elíptico', 'Remo', 'Escada'];
const CHAVE_PULADOS = 'cardioPulados';

/** Normalize a slot name to 'i' | 'f'. */
const slotDe = m => (m === 'i' ? 'i' : 'f');

/**
 * Create or update a cardio session.
 * @param {Object} p - { data, tipo, minutos, momento? }
 * @returns {Promise<Object>} the saved session
 */
async function adicionarCardio(p) {
  const data = String(p && p.data || '');
  const tipo = String(p && p.tipo || '').trim();
  const minutos = Number(String(p && p.minutos || '').replace(',', '.'));
  const momento = slotDe(p && p.momento);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data inválida');
  if (!tipo) throw new Error('Escolha ou informe a atividade');
  if (!isFinite(minutos) || minutos <= 0) throw new Error('Informe o tempo em minutos');

  const registro = { data, tipo, minutos: Math.round(minutos * 10) / 10, momento };
  await upsertCardio(registro);
  return registro;
}

/**
 * Get the skip flags of a date ({ i, f }).
 * @param {string} data - YYYY-MM-DD
 * @returns {Promise<{i: boolean, f: boolean}>}
 */
async function getPulados(data) {
  const mapa = (await getSetting(CHAVE_PULADOS)) || {};
  const p = (mapa && mapa[data]) || {};
  return { i: !!p.i, f: !!p.f };
}

/**
 * Persist the skip flag of one cardio slot for a date.
 * @param {string} data - YYYY-MM-DD
 * @param {string} m - 'i' | 'f'
 * @param {boolean} val
 * @returns {Promise<void>}
 */
async function setPulado(data, m, val) {
  const mapa = (await getSetting(CHAVE_PULADOS)) || {};
  mapa[data] = { ...((mapa && mapa[data]) || {}), [slotDe(m)]: !!val };
  await saveSetting(CHAVE_PULADOS, mapa);
}

/**
 * All skip flags (date -> { i, f }), used by the reports.
 * @returns {Promise<Object>}
 */
async function todosPulados() {
  return (await getSetting(CHAVE_PULADOS)) || {};
}

export {
  TIPOS_CARDIO,
  CHAVE_PULADOS,
  adicionarCardio,
  getPulados,
  setPulado,
  todosPulados,
  getCardiosByDate,
  getAllCardios,
  deleteCardio
};
