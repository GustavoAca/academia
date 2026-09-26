/**
 * Rotina Service - rotina de treino personalizada.
 *
 * A rotina substitui o PLANO fixo: a pessoa escolhe os dias que treina,
 * quantas séries (e meta de repetições) faz em cada exercício e por quanto
 * tempo vai seguir aquela rotina (semanas, meses ou até uma data).
 *
 * A rotina fica gravada em settings ('rotina'). Sem rotina salva, o app usa
 * a rotina padrão, gerada a partir de PLANO - ninguém perde o programa atual.
 *
 * Formato salvo:
 * {
 *   origem: 'plano' | 'personalizada',
 *   nome, inicio: 'YYYY-MM-DD' (segunda-feira da semana 1),
 *   duracao: { tipo: 'semanas' | 'meses' | 'ate', valor, ate },
 *   dias: { seg, ter, qua, qui, sex },
 *   treinos: { seg: { t: 'Nome', ex: [{ nome, grupo, series, min, max }],
 *                     cardio: { i: { ativo, tipo, min }, f: { ativo, tipo, min } } }, ... }
 * }
 *
 * cardio.i é o cardio no início e cardio.f no final do treino. Padrão:
 * apenas o final vem ativo (o início fica desligado até o usuário ativar).
 * Dias antigos, salvos sem esse campo, caem nesse padrão via cardioConfig.
 */

import {
  getAllExercises,
  getAllWorkouts,
  saveExercise,
  saveWorkout,
  getWorkoutExercises,
  replaceWorkoutExercises,
  getSetting,
  saveSetting
} from './db.js';
import { PLANO } from './plano.js';

const CHAVE_ROTINA = 'rotina';
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex'];
const INICIO_PADRAO = '2026-09-14';

/**
 * Routine that reproduces PLANO exactly (what the app used before).
 * @returns {Object}
 */
function rotinaPadrao() {
  const dias = {};
  const treinos = {};

  for (const dia of DIAS) {
    dias[dia] = true;
    treinos[dia] = {
      t: PLANO[dia].t,
      ex: PLANO[dia].ex.map(x => ({ nome: x[0], grupo: x[1], series: x[2], min: x[3], max: x[4] }))
    };
  }

  return {
    origem: 'plano',
    nome: 'Programa base',
    inicio: INICIO_PADRAO,
    duracao: { tipo: 'semanas', valor: 16 },
    dias,
    treinos
  };
}

let cache = null;

/**
 * Cardio settings of one routine slot ('i' = start, 'f' = end of workout).
 * Missing config falls back to the slot default: the end slot comes enabled,
 * the start slot disabled (the user turns it on in the routine editor).
 * @param {Object|undefined} x
 * @param {boolean} padraoAtivo - default for the slot when there is no config
 * @returns {{ativo: boolean, tipo: string, min: string}}
 */
function cardioConfig(x, padraoAtivo) {
  const ativoPadrao = !!padraoAtivo;
  if (!x || typeof x !== 'object') return { ativo: ativoPadrao, tipo: 'Caminhada', min: '' };
  return {
    ativo: x.ativo === undefined ? ativoPadrao : !!x.ativo,
    tipo: String(x.tipo || '').trim() || 'Caminhada',
    min: x.min === undefined || x.min === null ? '' : String(x.min)
  };
}

/**
 * Read the cardio config of a day/slot from any routine (saved or draft).
 * @param {Object} r
 * @param {string} dia - 'seg' | 'ter' | ...
 * @param {string} m - 'i' | 'f'
 * @returns {{ativo: boolean, tipo: string, min: string}}
 */
function cardioDoDia(r, dia, m) {
  const slot = m === 'i' ? 'i' : 'f';
  const t = r && r.treinos && r.treinos[dia];
  return cardioConfig(t && t.cardio && t.cardio[slot], slot === 'f');
}

/**
 * Make sure a routine draft has a writable cardio slot and return it.
 * @param {Object} r - routine draft (mutated in place)
 * @param {string} dia
 * @param {string} m - 'i' | 'f'
 * @returns {{ativo: boolean, tipo: string, min: string}}
 */
function garantirCardio(r, dia, m) {
  const slot = m === 'i' ? 'i' : 'f';
  const t = r && r.treinos && r.treinos[dia];
  if (!t) return cardioConfig(null, slot === 'f');
  if (!t.cardio || typeof t.cardio !== 'object') t.cardio = {};
  t.cardio[slot] = cardioConfig(t.cardio[slot], slot === 'f');
  return t.cardio[slot];
}

const CARDIO_VERSAO = 2;

/**
 * One-time adjustment: the start slot used to come enabled by default. Now
 * only the end slot is on by default, so routines saved before this change
 * get the start slot turned off (settings made later are kept).
 * @param {Object} r - routine (mutated in place)
 * @returns {Object}
 */
function migrarCardio(r) {
  if (!r || r.cardioVersao === CARDIO_VERSAO) return r;
  for (const dia of DIAS) {
    const c = r.treinos && r.treinos[dia] && r.treinos[dia].cardio;
    if (c && c.i) c.i.ativo = false;
  }
  r.cardioVersao = CARDIO_VERSAO;
  return r;
}

/**
 * Get the active routine (falls back to the PLANO based one).
 * @returns {Promise<Object>}
 */
async function getRotina() {
  if (cache) return cache;
  const salva = await getSetting(CHAVE_ROTINA);
  cache = migrarCardio(salva && salva.dias && salva.treinos ? salva : rotinaPadrao());
  return cache;
}

/**
 * Validate a routine before saving.
 * @param {Object} r
 * @returns {Object} { valid, error }
 */
function validarRotina(r) {
  if (!r || typeof r !== 'object') return { valid: false, error: 'Rotina inválida' };

  const diasAtivos = DIAS.filter(d => r.dias && r.dias[d] && (r.treinos[d] && r.treinos[d].ex || []).length > 0);
  if (diasAtivos.length === 0) {
    return { valid: false, error: 'Marque pelo menos um dia e adicione ao menos um exercício' };
  }

  for (const dia of diasAtivos) {
    for (const ex of r.treinos[dia].ex) {
      const s = Number(ex.series);
      if (!isFinite(s) || s < 1 || s > 20) {
        return { valid: false, error: `${ex.nome || 'Exercício'}: séries deve ser de 1 a 20` };
      }
      const mn = Number(ex.min), mx = Number(ex.max);
      if (isFinite(mn) && isFinite(mx) && mn > mx) {
        return { valid: false, error: `${ex.nome}: repetição mínima maior que a máxima` };
      }
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.inicio || ''))) {
    return { valid: false, error: 'Data de início inválida' };
  }

  const dur = r.duracao || {};
  if (dur.tipo === 'ate') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dur.ate || ''))) {
      return { valid: false, error: 'Data final inválida' };
    }
    if (segundaDe(dur.ate) < segundaDe(r.inicio)) {
      return { valid: false, error: 'A data final é anterior ao início' };
    }
  } else if (!(Number(dur.valor) >= 1)) {
    return { valid: false, error: 'Duração deve ser de pelo menos 1' };
  }

  return { valid: true, error: null };
}

/**
 * Normalize a routine (trim, numbers, start snapped to its Monday).
 * @param {Object} r
 * @returns {Object}
 */
function normalizar(r) {
  const out = {
    origem: r.origem === 'plano' ? 'plano' : 'personalizada',
    nome: String(r.nome || 'Minha rotina').trim() || 'Minha rotina',
    inicio: segundaDe(r.inicio || INICIO_PADRAO),
    duracao: {
      tipo: r.duracao && r.duracao.tipo === 'meses' ? 'meses' : r.duracao && r.duracao.tipo === 'ate' ? 'ate' : 'semanas',
      valor: Math.max(1, Math.round(Number(r.duracao && r.duracao.valor) || 1)),
      ate: r.duracao && r.duracao.ate ? String(r.duracao.ate) : ''
    },
    dias: {},
    treinos: {},
    criadaEm: r.criadaEm || new Date().toISOString(),
    atualizadaEm: new Date().toISOString()
  };

  for (const dia of DIAS) {
    out.dias[dia] = !!(r.dias && r.dias[dia]);
    const t = r.treinos && r.treinos[dia];
    out.treinos[dia] = {
      t: String((t && t.t) || '').trim() || 'Treino',
      ex: ((t && t.ex) || []).map(ex => ({
        nome: String(ex.nome || '').trim(),
        grupo: String(ex.grupo || 'Outros').trim() || 'Outros',
        series: Math.max(1, Math.round(Number(ex.series) || 3)),
        min: Math.max(1, Math.round(Number(ex.min) || 8)),
        max: Math.max(1, Math.round(Number(ex.max) || 12))
      })).filter(ex => ex.nome),
      cardio: {
        i: cardioConfig(t && t.cardio && t.cardio.i, false),
        f: cardioConfig(t && t.cardio && t.cardio.f, true)
      }
    };
  }

  out.cardioVersao = CARDIO_VERSAO;
  return out;
}

/**
 * Validate, normalize and persist a routine.
 * @param {Object} r
 * @returns {Promise<Object>} the saved routine
 */
async function salvarRotina(r) {
  const validacao = validarRotina(r);
  if (!validacao.valid) throw new Error(validacao.error);

  const limpa = normalizar(r);
  await saveSetting(CHAVE_ROTINA, limpa);
  cache = limpa;
  return limpa;
}

/**
 * Drop the custom routine and go back to the PLANO based one.
 * @returns {Promise<Object>}
 */
async function restaurarPadrao() {
  await saveSetting(CHAVE_ROTINA, null);
  cache = rotinaPadrao();
  return cache;
}

/* --- Dates and duration --- */

function dataParaDate(isoStr) {
  const [a, m, d] = String(isoStr || '').split('-').map(Number);
  return new Date(a || 2026, (m || 1) - 1, d || 1);
}

function isoDe(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Monday of the week that contains the given date.
 * @param {string} isoStr
 * @returns {string} YYYY-MM-DD
 */
function segundaDe(isoStr) {
  const d = dataParaDate(isoStr);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return isoDe(d);
}

/**
 * How many weeks the routine lasts.
 * @param {Object} r
 * @returns {number}
 */
function totalSemanas(r) {
  const dur = (r && r.duracao) || {};
  const inicio = dataParaDate((r && r.inicio) || INICIO_PADRAO);

  if (dur.tipo === 'ate' && dur.ate) {
    const dias = Math.round((dataParaDate(dur.ate) - inicio) / 864e5);
    return Math.max(1, Math.ceil((dias + 1) / 7));
  }

  const valor = Number(dur.valor) || 16;
  if (dur.tipo === 'meses') return Math.max(1, Math.round(valor * 30.4 / 7));
  return Math.max(1, Math.round(valor));
}

/**
 * Last day of the routine (inclusive).
 * @param {Object} r
 * @returns {string} YYYY-MM-DD
 */
function fimRotina(r) {
  const d = dataParaDate((r && r.inicio) || INICIO_PADRAO);
  d.setDate(d.getDate() + totalSemanas(r) * 7 - 1);
  return isoDe(d);
}

/* --- Reading the routine --- */

function diaAtivo(r, dia) {
  return !!(r && r.dias && r.dias[dia]) && defsDoDia(r, dia).length > 0;
}

function defsDoDia(r, dia) {
  if (!r || !r.dias || !r.dias[dia]) return [];
  const t = r.treinos && r.treinos[dia];
  return (t && t.ex) || [];
}

function nomeDoDia(r, dia) {
  const t = r && r.treinos && r.treinos[dia];
  return (t && t.t) || 'Treino';
}

/* --- Sync routine -> catalog (exercises, workouts and their links) --- */

/**
 * Make sure every exercise and workout referenced by the routine exists and
 * that every workout link matches the routine (order, sets and rep range).
 * Safe to call on every startup.
 * @param {Object} r
 * @returns {Promise<void>}
 */
async function sincronizarCatalogo(r) {
  const exercicios = await getAllExercises();
  const porNome = new Map(exercicios.map(e => [e.nome, e]));
  const treinos = await getAllWorkouts();
  const porDia = new Map();
  treinos.forEach(t => { if (!porDia.has(t.diaSemana)) porDia.set(t.diaSemana, t); });

  for (const dia of DIAS) {
    if (!r.dias[dia]) continue;
    const t = r.treinos[dia];
    if (!t || !t.ex.length) continue;

    let workout = porDia.get(dia);
    if (!workout) {
      const id = await saveWorkout({ nome: t.t, diaSemana: dia, ordem: 1, ativo: true });
      workout = { id, diaSemana: dia, nome: t.t };
      porDia.set(dia, workout);
    }

    const links = [];
    let ordem = 1;
    for (const ex of t.ex) {
      let local = porNome.get(ex.nome);
      if (!local) {
        const id = await saveExercise({
          nome: ex.nome,
          grupoMuscular: ex.grupo,
          descricao: '',
          videoUrl: '',
          ativo: true
        });
        local = { id, nome: ex.nome };
        porNome.set(ex.nome, local);
      }
      links.push({
        exercicioId: local.id,
        ordem: ordem++,
        seriesPlanejadas: ex.series,
        repeticoesMinimas: ex.min,
        repeticoesMaximas: ex.max
      });
    }

    const chave = x => `${x.exercicioId}|${x.ordem}|${x.seriesPlanejadas}|${x.repeticoesMinimas}|${x.repeticoesMaximas}`;
    const atuais = await getWorkoutExercises(workout.id);
    const igual = atuais.length === links.length &&
      atuais.map(chave).sort().join(';') === links.map(chave).sort().join(';');

    if (!igual) await replaceWorkoutExercises(workout.id, links);
  }
}

export {
  CHAVE_ROTINA,
  rotinaPadrao,
  getRotina,
  salvarRotina,
  restaurarPadrao,
  validarRotina,
  normalizar,
  cardioConfig,
  cardioDoDia,
  garantirCardio,
  totalSemanas,
  fimRotina,
  segundaDe,
  dataParaDate,
  isoDe,
  diaAtivo,
  defsDoDia,
  nomeDoDia,
  sincronizarCatalogo
};
