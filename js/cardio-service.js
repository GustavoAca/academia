/**
 * Cardio Service - registro de cardio (caminhada, corrida, pular corda...).
 *
 * A pessoa escolhe a atividade e anota o tempo do percurso. O mesmo tipo no
 * mesmo dia atualiza o tempo em vez de criar outro registro.
 */

import {
  upsertCardio,
  getCardiosByDate,
  getAllCardios,
  deleteCardio
} from './db.js';

const TIPOS_CARDIO = ['Caminhada', 'Corrida', 'Pular corda', 'Bicicleta', 'Natação', 'Elíptico', 'Remo', 'Escada'];

/**
 * Create or update a cardio session.
 * @param {Object} p - { data, tipo, minutos }
 * @returns {Promise<Object>} the saved session
 */
async function adicionarCardio(p) {
  const data = String(p && p.data || '');
  const tipo = String(p && p.tipo || '').trim();
  const minutos = Number(String(p && p.minutos || '').replace(',', '.'));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data inválida');
  if (!tipo) throw new Error('Escolha ou informe a atividade');
  if (!isFinite(minutos) || minutos <= 0) throw new Error('Informe o tempo em minutos');

  const registro = { data, tipo, minutos: Math.round(minutos * 10) / 10 };
  await upsertCardio(registro);
  return registro;
}

export {
  TIPOS_CARDIO,
  adicionarCardio,
  getCardiosByDate,
  getAllCardios,
  deleteCardio
};
