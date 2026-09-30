/**
 * Cardio Service - registro de cardio (caminhada, corrida, pular corda...).
 *
 * A pessoa escolhe a atividade e anota o tempo do percurso. O mesmo tipo no
 * mesmo momento (início ou fim do treino) do mesmo dia atualiza o tempo em
 * vez de criar outro registro.
 *
 * Além do tempo, o registro aceita opcionais: distância (km), calorias (kcal)
 * e observação. O pace (min:seg por km) é derivado de tempo + distância — sem
 * os dois ele não existe e nunca é calculado pela metade.
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

/** Activity types where the distance field (km) is shown. */
const TIPOS_COM_DISTANCIA = ['Caminhada', 'Corrida'];

/** Normalize a slot name to 'i' | 'f'. */
const slotDe = m => (m === 'i' ? 'i' : 'f');

/** Parse a pt-BR friendly number ('5,2') to Number, or NaN. */
const num = v => Number(String(v ?? '').replace(',', '.'));

/**
 * Pace of a session in min:seg per km ('5:32'), or null when the time or the
 * distance is missing/invalid — without both there is no pace.
 * @param {*} minutos - minutes (accepts pt-BR decimal strings)
 * @param {*} distancia - kilometers (accepts pt-BR decimal strings)
 * @returns {string|null} 'M:SS' or null
 */
function paceDe(minutos, distancia) {
  const min = num(minutos);
  const km = num(distancia);
  if (!isFinite(min) || min <= 0 || !isFinite(km) || km <= 0) return null;
  const seg = Math.round((min * 60) / km);
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
}

/**
 * Create or update a cardio session.
 * @param {Object} p - { data, tipo, minutos, momento?, distancia?, calorias?, observacao? }
 * @returns {Promise<Object>} the saved session
 */
async function adicionarCardio(p) {
  const data = String(p && p.data || '');
  const tipo = String(p && p.tipo || '').trim();
  const minutos = num(p && p.minutos);
  const momento = slotDe(p && p.momento);
  const brutoDist = p && p.distancia != null ? String(p.distancia).trim() : '';
  const brutoKcal = p && p.calorias != null ? String(p.calorias).trim() : '';
  const observacao = String(p && p.observacao || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data inválida');
  if (!tipo) throw new Error('Escolha ou informe a atividade');
  if (!isFinite(minutos) || minutos <= 0) throw new Error('Informe o tempo em minutos');

  const registro = { data, tipo, minutos: Math.round(minutos * 10) / 10, momento };

  if (brutoDist) {
    const dist = num(brutoDist);
    if (!isFinite(dist) || dist <= 0) throw new Error('Informe a distância em km ou deixe em branco');
    registro.distancia = Math.round(dist * 100) / 100;
  } else {
    registro.distancia = null;
  }

  if (brutoKcal) {
    const kcal = num(brutoKcal);
    if (!isFinite(kcal) || kcal <= 0) throw new Error('Informe calorias válidas ou deixe em branco');
    registro.calorias = Math.round(kcal);
  } else {
    registro.calorias = null;
  }

  registro.observacao = observacao || null;

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
  TIPOS_COM_DISTANCIA,
  CHAVE_PULADOS,
  adicionarCardio,
  paceDe,
  getPulados,
  setPulado,
  todosPulados,
  getCardiosByDate,
  getAllCardios,
  deleteCardio
};
