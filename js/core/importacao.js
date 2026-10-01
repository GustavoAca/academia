/**
 * Migration of the old single-file app (localStorage) and manual file import.
 *
 * Old format stored everything in localStorage under 'treino2026':
 * - log keys: "dia|semana|indiceExercicio|indiceSerie" -> { c, r, q, f }
 * - notas keys: "dia|semana|indiceExercicio|n" -> texto
 * - med keys: "YYYY-MM-DD" -> { peso, gord, ..., abd, ..., pesc }
 */

import { iso, extrairJson } from './utils.js';
import { state, store } from './estado.js';
import { PLANO } from '../plano.js';
import {
  getAllWorkouts,
  getAllExercises,
  upsertExecution,
  saveSetting,
  getSetting
} from '../db.js';
import { MED, num, saveMeasurements } from '../measurement-service.js';
import { getRotina, sincronizarCatalogo } from '../rotina-service.js';
import { exportBackup, importBackup, downloadBackup } from '../backup-service.js';
import { backfillMacros } from '../food-service.js';
import { getAjustes } from '../ajustes-service.js';
import { loadCatalogo, posicaoInicial } from './programa.js';
import { carregarLogDoDia } from './log-dia.js';
import { render } from './render.js';
import { showToast } from './toast.js';

export const OLD_STORE_KEY = 'treino2026';
export const OLD_DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
export const OLD_INI = new Date(2026, 8, 14); // Program start: 14/09/2026
export const MIGRATION_FLAG = 'migrated_localstorage_v2';

/** Date of an old log key ("dia|semana"). */
export function oldLogKeyToDate(dia, semana) {
  const dayIndex = Math.max(OLD_DIAS.indexOf(dia), 0);
  const date = new Date(OLD_INI);
  date.setDate(date.getDate() + (semana - 1) * 7 + dayIndex);
  return date;
}

/**
 * Import one generation of old data into IndexedDB (used by both the
 * localStorage migration and the data embedded in exemplo.html).
 *
 * Executions are upserted by their natural key, so running twice never
 * duplicates rows.
 *
 * @param {Object} log
 * @param {Object} med
 * @param {Object} notasAntigas
 * @returns {Promise<{series: number, medidas: number}>}
 */
export async function importarDadosAntigos(log, med, notasAntigas) {
  const workouts = await getAllWorkouts();
  const exercises = await getAllExercises();
  const workoutsByDay = {};
  workouts.forEach(w => { workoutsByDay[w.diaSemana] = w; });
  const exercisesByName = new Map(exercises.map(e => [e.nome, e]));

  let series = 0;

  for (const key of Object.keys(log || {})) {
    const entry = log[key];
    if (!entry) continue;

    const [dia, semana, indiceExercicio, indiceSerie] = key.split('|');
    const idx = parseInt(indiceExercicio, 10);
    const configurados = (store.rotina && store.rotina.treinos && store.rotina.treinos[dia] && store.rotina.treinos[dia].ex) || [];
    const definicao = configurados[idx] || (PLANO[dia] && PLANO[dia].ex[idx]);
    const workout = workoutsByDay[dia];
    if (!definicao || !workout) continue;

    const nomeExercicio = definicao.nome !== undefined ? definicao.nome : definicao[0];
    const exercise = exercisesByName.get(nomeExercicio);
    if (!exercise) continue;

    const carga = num(entry.c);
    const repeticoes = num(entry.r);
    if (carga === null && repeticoes === null) continue;

    await upsertExecution({
      data: iso(oldLogKeyToDate(dia, parseInt(semana, 10))),
      treinoId: workout.id,
      exercicioId: exercise.id,
      serie: (parseInt(indiceSerie, 10) || 0) + 1,
      carga,
      repeticoes,
      observacao: entry.o || ''
    });
    series++;
  }

  let medidas = 0;

  for (const data of Object.keys(med || {})) {
    const m = med[data];
    if (!m) continue;

    const valores = {};
    for (const [campo] of MED) {
      const origem = campo === 'abdomen'
        ? (m.abd !== undefined ? m.abd : m.abdomen)
        : m[campo];
      if (origem !== undefined && origem !== null && origem !== '') {
        valores[campo] = origem;
      }
    }
    if (Object.keys(valores).length === 0) continue;

    const salvo = await saveMeasurements(data, valores);
    if (salvo) medidas++;
  }

  const convertidas = {};
  for (const k of Object.keys(notasAntigas || {})) {
    convertidas[k.replace(/\|n$/, '')] = notasAntigas[k];
  }
  if (Object.keys(convertidas).length > 0) {
    store.notas = { ...convertidas, ...store.notas };
    await saveSetting('notas', store.notas);
  }

  return { series, medidas };
}

/**
 * Migrate old localStorage data to IndexedDB.
 * Runs once (guarded by a setting) and never blocks startup.
 * @returns {Promise<void>}
 */
export async function migrateFromLocalStorage() {
  try {
    const alreadyMigrated = await getSetting(MIGRATION_FLAG);
    if (alreadyMigrated) return;

    const raw = localStorage.getItem(OLD_STORE_KEY);
    if (!raw) {
      await saveSetting(MIGRATION_FLAG, true);
      return;
    }

    const old = JSON.parse(raw);
    const { series, medidas } = await importarDadosAntigos(
      (old && old.log) || {},
      (old && old.med) || {},
      (old && old.notas) || {}
    );

    await saveSetting(MIGRATION_FLAG, true);

    if (series > 0 || medidas > 0) {
      showToast(`Migração concluída: ${series} séries e ${medidas} medidas`);
    }
  } catch (err) {
    console.error('Erro na migração:', err);
    // Migration is best-effort - never block startup
  }
}

/**
 * Import a file into IndexedDB and refresh the UI.
 * tipo 'backup' accepts only a .json exported by this app (importBackup);
 * tipo 'exemplo' accepts the { log, med, notas } format (.json/.html) filled
 * in exemplo.html.
 * @param {File} file
 * @param {'backup'|'exemplo'} tipo
 * @returns {Promise<string>} Message to show to the user
 */
export async function importarArquivo(file, tipo) {
  const dados = extrairJson(await file.text());

  if (tipo === 'backup') {
    if (dados && (dados.log || dados.med || dados.notas)) {
      throw new Error('Este arquivo é dos dados do exemplo. Use "Importar dados do exemplo".');
    }
    const resultado = await importBackup(dados);
    if (!resultado || !resultado.success) {
      throw new Error((resultado && resultado.error) || 'Falha ao importar o backup');
    }
    await atualizarAposImportacao();
    const partes = [];
    if (resultado.imported) partes.push(`${resultado.imported} registros`);
    if (resultado.stats && resultado.stats.reaproveitados) partes.push(`${resultado.stats.reaproveitados} reaproveitados`);
    if (resultado.ignorados) partes.push(`${resultado.ignorados} ignorados`);
    return `Backup importado: ${partes.join(', ') || 'nada novo'}`;
  }

  if (dados && (dados.log || dados.med || dados.notas)) {
    const { series, medidas } = await importarDadosAntigos(
      dados.log || {},
      dados.med || {},
      dados.notas || {}
    );
    await atualizarAposImportacao();
    return `Importado: ${series} séries e ${medidas} medidas`;
  }

  throw new Error('Este arquivo não é dos dados do exemplo (esperado .json/.html com log/med).');
}

/**
 * Reload everything the screens read after data has changed.
 * @returns {Promise<void>}
 */
export async function atualizarAposImportacao() {
  store.notas = (await getSetting('notas')) || store.notas;
  try {
    state.ajustes = await getAjustes();
  } catch (err) {
    console.warn('Ajustes:', err.message);
  }

  const rotinaAntes = store.rotina && store.rotina.atualizadaEm;
  store.rotina = await getRotina();
  store.rotinaRascunho = null;
  if (rotinaAntes !== store.rotina.atualizadaEm) {
    await sincronizarCatalogo(store.rotina);
    posicaoInicial();
  }

  await loadCatalogo();
  await carregarLogDoDia();
  // Registros antigos vindos do backup ganham os macros pelas referências
  // do catálogo antes de a tela ser pintada.
  try {
    await backfillMacros();
  } catch (err) {
    console.warn('Backfill de macros:', err.message);
  }
  await render();
}

/** Download a JSON backup of everything stored on this device. */
export async function baixarBackup() {
  try {
    const result = await exportBackup();
    if (result && result.success) {
      downloadBackup(result);
      showToast('Backup baixado ✓');
    } else {
      showToast('Erro ao gerar backup: ' + (result && result.error ? result.error : ''));
    }
  } catch (err) {
    console.error('Erro ao gerar backup:', err);
    showToast('Erro ao gerar backup');
  }
}
