/**
 * Workout Service - Handles treinos, exercícios, séries, repetições e carga.
 * 
 * This service manages the core workout data operations using IndexedDB.
 * It separates UI from persistence logic as required by the project.
 */

import {
  initDB,
  saveExercise,
  getAllExercises,
  getExercise,
  updateExercise,
  deleteExercise,
  saveWorkout,
  getAllWorkouts,
  saveWorkoutExercise,
  getWorkoutExercises,
  saveExecution,
  getExecutions,
  saveMeasurement,
  getAllMeasurements,
  getLatestMeasurement,
  saveSetting,
  getSetting,
  upsertExecution,
  upsertMeasurement,
  upsertCardio,
  clearAllData,
  DB_NAME,
  DB_VERSION
} from './db.js';
import { salvarRotina as salvarRotinaImportada } from './rotina-service.js';

/* --- Exercise Operations --- */

/**
 * Initialize exercises from PLANO data if database is empty.
 * This is called during migration to populate initial data.
 * @param {Array} planoExercises - Exercises from the original PLANO object
 * @returns {Promise<void>}
 */
async function initializeExercisesFromPlano(planoExercises) {
  const existing = await getAllExercises();
  
  if (existing.length === 0) {
    for (const ex of planoExercises) {
      await saveExercise({
        nome: ex[0],
        grupoMuscular: ex[1],
        descricao: '',
        videoUrl: '',
        ativo: true
      });
    }
  }
}

/* --- Workout Operations --- */

/**
 * Initialize workouts from PLANO data if database is empty.
 * @param {Object} plano - The PLANO object with workout definitions
 * @returns {Promise<void>}
 */
async function initializeWorkoutsFromPlano(plano) {
  const existing = await getAllWorkouts();
  
  if (existing.length === 0) {
    const days = ['seg', 'ter', 'qua', 'qui', 'sex'];
    
    for (const day of days) {
      if (plano[day]) {
        await saveWorkout({
          nome: plano[day].t,
          diaSemana: day,
          ordem: 1,
          ativo: true
        });
      }
    }
  }
}

/**
 * Link exercises to their workouts based on PLANO data.
 * Creates workout_exercises rows only for workouts that have no link yet,
 * so it is safe to call on every startup.
 * @param {Object} plano - The PLANO object with workout definitions
 * @returns {Promise<void>}
 */
async function initializeWorkoutExercisesFromPlano(plano) {
  const workouts = await getAllWorkouts();
  const exercises = await getAllExercises();

  for (const workout of workouts) {
    const existing = await getWorkoutExercises(workout.id);
    if (existing.length > 0) continue;

    const dia = plano[workout.diaSemana];
    if (!dia || !Array.isArray(dia.ex)) continue;

    for (let i = 0; i < dia.ex.length; i++) {
      const [nome, , series, min, max] = dia.ex[i];
      const exercise = exercises.find(e => e.nome === nome);
      if (!exercise) continue;

      await saveWorkoutExercise({
        treinoId: workout.id,
        exercicioId: exercise.id,
        ordem: i + 1,
        seriesPlanejadas: series,
        repeticoesMinimas: min,
        repeticoesMaximas: max
      });
    }
  }
}

/**
 * Get the workout for today based on the current day of week.
 * @param {number} currentDay - Current day (0=Domingo, 1=Segunda, etc.)
 * @returns {Promise<Object|null>}
 */
async function getTodaysWorkout(currentDay) {
  // Map JavaScript day (0-6) to our days (1-5 for seg-sex)
  // JS: 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
  // We want: 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex
  const dayMap = [null, 'seg', 'ter', 'qua', 'qui', 'sex'];
  const dayKey = dayMap[currentDay];
  
  if (!dayKey) return null;
  
  const workouts = await getAllWorkouts(dayKey);
  return workouts.length > 0 ? workouts[0] : null;
}

/**
 * Get exercises for a specific workout.
 * @param {number} workoutId - The workout id
 * @returns {Promise<Array>} Array of workout exercise definitions
 */
async function getWorkoutExercisesWithDetails(workoutId) {
  const weList = await getWorkoutExercises(workoutId);
  const exercises = await getAllExercises();
  
  return weList.map(we => {
    const ex = exercises.find(e => e.id === we.exercicioId);
    return {
      ...we,
      exercise: ex || { nome: 'Exercício desconhecido', grupoMuscular: '' }
    };
  });
}

/* --- Execution (Series) Operations --- */

/**
 * Save a series execution with carga and repeticoes.
 * @param {Object} execution - Execution data {treinoId, exercicioId, serie, carga, repeticoes, observacao}
 * @returns {Promise<Object>} Saved execution
 */
async function registerSeriesExecution(execution) {
  // Validate inputs
  if (!execution.treinoId || !execution.exercicioId) {
    throw new Error('treinoId and exercicioId are required');
  }
  
  if (execution.carga === undefined || execution.carga === null) {
    throw new Error('Carga is required');
  }
  
  if (execution.repeticoes === undefined || execution.repeticoes === null) {
    throw new Error('Repetições are required');
  }
  
  return saveExecution({
    ...execution,
    data: new Date().toISOString(),
    serie: execution.serie || 1
  });
}

/**
 * Get execution history for a specific exercise in a workout.
 * @param {number} treinoId - Workout id
 * @param {number} exercicioId - Exercise id
 * @returns {Promise<Array>}
 */
async function getExerciseExecutionHistory(treinoId, exercicioId) {
  return getExecutions(treinoId, exercicioId);
}

/**
 * Get the last execution for an exercise.
 * @param {number} treinoId - Workout id
 * @param {number} exercicioId - Exercise id
 * @returns {Promise<Object|null>}
 */
async function getLastExecution(treinoId, exercicioId) {
  const history = await getExerciseExecutionHistory(treinoId, exercicioId);
  return history.length > 0 ? history[history.length - 1] : null;
}

/**
 * Calculate volume for a single series: carga × repeticoes
 * @param {number} carga - Weight load
 * @param {number} repeticoes - Number of repetitions
 * @returns {number} Volume
 */
function calculateSeriesVolume(carga, repeticoes) {
  return parseFloat(carga) * parseInt(repeticoes, 10);
}

/**
 * Calculate total volume for all series of an exercise.
 * @param {Array} series - Array of series objects with carga and repeticoes
 * @returns {number} Total volume
 */
function calculateExerciseVolume(series) {
  if (!series || series.length === 0) return 0;
  
  return series.reduce((total, serie) => {
    const serieVolume = calculateSeriesVolume(serie.carga, serie.repeticoes);
    return total + serieVolume;
  }, 0);
}

/**
 * Calculate total volume for a workout.
 * @param {number} workoutId - Workout id
 * @returns {Promise<number>}
 */
async function calculateWorkoutVolume(workoutId) {
  const weList = await getWorkoutExercises(workoutId);
  
  if (weList.length === 0) return 0;
  
  // Get all executions for this workout
  const executions = await getExecutionsByWorkout(workoutId);
  
  // Group executions by exercise
  const exerciseVolumes = {};
  
  weList.forEach(we => {
    const exerciseId = we.exercicioId;
    exerciseVolumes[exerciseId] = 0;
  });
  
  executions.forEach(exec => {
    const exerciseId = exec.exercicioId;
    if (exerciseVolumes[exerciseId] !== undefined) {
      exerciseVolumes[exerciseId] += calculateSeriesVolume(exec.carga, exec.repeticoes);
    }
  });
  
  // Sum all exercise volumes
  return Object.values(exerciseVolumes).reduce((total, vol) => total + vol, 0);
}

/**
 * Get all executions for a workout (helper for volume calculation).
 * @param {number} workoutId - Workout id
 * @returns {Promise<Array>}
 */
async function getExecutionsByWorkout(workoutId) {
  const database = await initDB();
  const transaction = database.transaction('executions', 'readonly');
  const store = transaction.objectStore('executions');
  const index = store.index('treinoId');
  const request = index.openCursor(IDBKeyRange.only(workoutId));
  
  const results = [];
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/* --- Progression Operations --- */

/**
 * Get progression data for an exercise (historical series data).
 * @param {number} treinoId - Workout id
 * @param {number} exercicioId - Exercise id
 * @returns {Promise<Array>} Array of execution records with volume data
 */
async function getProgressionData(treinoId, exercicioId) {
  const history = await getExerciseExecutionHistory(treinoId, exercicioId);
  
  if (history.length === 0) return [];
  
  // Group by session (week), sorted by date
  const sessions = {};
  
  history.forEach(record => {
    const date = new Date(record.data);
    const sessionKey = `${record.serie || 1}-${date.toISOString()}`;
    
    if (!sessions[sessionKey]) {
      sessions[sessionKey] = [];
    }
    sessions[sessionKey].push({
      carga: record.carga,
      repeticoes: record.repeticoes,
      volume: calculateSeriesVolume(record.carga, record.repeticoes),
      serie: record.serie
    });
  });
  
  // Sort sessions by date (newest last for chronological order)
  const sortedSessions = Object.entries(sessions)
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([key, records]) => ({
      key,
      records,
      totalVolume: records.reduce((sum, r) => sum + r.volume, 0),
      seriesCount: records.length
    }));
  
  return sortedSessions;
}

/**
 * Check for possible stagnation on an exercise.
 * @param {number} treinoId - Workout id
 * @param {number} exercicioId - Exercise id
 * @param {Object} [options] - Options {minSessions, minPeriod}
 * @returns {Object|null} Stagnation info or null if no stagnation detected
 */
async function checkStagnation(treinoId, exercicioId, options = {}) {
  const defaults = {
    minSessions: 3,
    minPeriodDays: 7
  };
  
  const opts = { ...defaults, ...options };
  const progression = await getProgressionData(treinoId, exercicioId);
  
  if (progression.length < opts.minSessions) {
    return null; // Not enough data
  }
  
  // Look at the last N sessions for stagnation
  const lastSessions = progression.slice(-opts.minSessions);
  
  // Check if volume, carga, and repeticoes have not improved
  const volumes = lastSessions.map(s => s.totalVolume);
  const cargas = lastSessions.flatMap(s => s.records.map(r => r.carga));
  const repeticoes = lastSessions.flatMap(s => s.records.map(r => r.repeticoes));
  
  // Check if the last session's volume is the same or lower than the first of the period
  const firstVolume = volumes[0];
  const lastVolume = volumes[volumes.length - 1];
  
  // Stagnation rule: volume hasn't increased, and carga + repeticoes are similar
  const volumeChanged = lastVolume > firstVolume * 1.1; // 10% improvement threshold
  const cargaStable = cargas.every(c => Math.abs(c - cargas[0]) <= 2); // Within 2kg
  const repeticoesStable = repeticoes.every(r => Math.abs(r - repeticoes[0]) <= 2); // Within 2 reps
  
  if (!volumeChanged && cargaStable && repeticoesStable) {
    return {
      tipo: 'possivel_estagnacao',
      mensagem: `O desempenho permaneceu semelhante nas últimas ${opts.minSessions} sessões.`,
      detalhes: {
        volumeInicial: firstVolume,
        volumeUltima: lastVolume,
        cargaAtual: cargas[0],
        repeticoesAtuais: repeticoes[0],
        periodos: opts.minSessions
      }
    };
  }
  
  return null;
}

/* --- Measurement Operations --- */

/**
 * Register new body measurements.
 * @param {Object} measurements - {peso, busto, abdomen, culote}
 * @param {string} [date] - Optional date (defaults to today)
 * @returns {Promise<Object>}
 */
async function registerMeasurements(measurements, date = null) {
  const today = date || new Date().toISOString().split('T')[0];
  
  // Validate required fields
  if (!measurements.peso) {
    throw new Error('Peso is required');
  }
  
  return saveMeasurement({
    data: today,
    peso: measurements.peso,
    busto: measurements.busto !== undefined ? measurements.busto : null,
    abdomen: measurements.abdomen !== undefined ? measurements.abdomen : null,
    culote: measurements.culote !== undefined ? measurements.culote : null
  });
}

/**
 * Get measurements evolution data for reporting.
 * @returns {Promise<Object>}
 */
async function getMeasurementsEvolution() {
  const measurements = await getAllMeasurements();
  
  if (measurements.length === 0) {
    return {
      peso: { inicial: null, atual: null, diferenca: null },
      busto: { inicial: null, atual: null, diferenca: null },
      abdomen: { inicial: null, atual: null, diferenca: null },
      culote: { inicial: null, atual: null, diferenca: null }
    };
  }
  
  // Sort by date ascending
  const sorted = measurements.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
  
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  
  const getValue = (measurement, key) => measurement[key] !== null ? parseFloat(measurement[key]) : null;
  
  return {
    peso: {
      inicial: getValue(first, 'peso'),
      atual: getValue(last, 'peso'),
      diferenca: getValue(last, 'peso') - getValue(first, 'peso')
    },
    busto: {
      inicial: getValue(first, 'busto'),
      atual: getValue(last, 'busto'),
      diferenca: getValue(last, 'busto') - getValue(first, 'busto')
    },
    abdomen: {
      inicial: getValue(first, 'abdomen'),
      atual: getValue(last, 'abdomen'),
      diferenca: getValue(last, 'abdomen') - getValue(first, 'abdomen')
    },
    culote: {
      inicial: getValue(first, 'culote'),
      atual: getValue(last, 'culote'),
      diferenca: getValue(last, 'culote') - getValue(first, 'culote')
    }
  };
}

/* --- Settings Operations --- */

/**
 * Get all settings as a plain object.
 * @returns {Promise<Object>}
 */
async function getAllSettings() {
  const database = await initDB();
  const transaction = database.transaction('settings', 'readonly');
  const store = transaction.objectStore('settings');
  const request = store.getAllKeys();
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const keys = request.result;
      Promise.all(keys.map(key => getSetting(key))).then(values => {
        const result = {};
        values.forEach((value, index) => {
          result[keys[index]] = value;
        });
        resolve(result);
      });
    };
    request.onerror = () => reject(request.error);
  });
}

/* --- Export/Import (Backup) --- */

/**
 * Export all data to JSON format for backup.
 * @returns {Promise<Object>}
 */
async function exportData() {
  const database = await initDB();
  
  const stores = ['exercises', 'workouts', 'workout_exercises', 'executions', 'measurements', 'settings'];
  
  const promises = stores.map(storeName => {
    const transaction = database.transaction(stores, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve({ [storeName]: request.result });
      request.onerror = () => reject(request.error);
    });
  });
  
  const results = await Promise.all(promises);
  
  const data = {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    exercises: [],
    workouts: [],
    executions: [],
    measurements: []
  };
  
  results.forEach(result => {
    const key = Object.keys(result)[0];
    if (key === 'exercises') data.exercises = result.exercises;
    if (key === 'workouts') data.workouts = result.workouts;
    if (key === 'workout_exercises') {} // Not included in example format
    if (key === 'executions') data.executions = result.executions;
    if (key === 'measurements') data.measurements = result.measurements;
    if (key === 'settings') {} // Not included in example format
  });
  
  return data;
}

/**
 * Import data from backup JSON, with validation.
 * @param {Object} backupData - Backup data object
 * @param {boolean} [overwrite=false] - Whether to overwrite existing data
 * @returns {Promise<Object>} Import result with stats
 */
async function importData(backupData, overwrite = false) {
  const validation = validateBackupFormat(backupData);
  
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      details: 'O backup não pôde ser importado: ' + validation.error
    };
  }
  
  const database = await initDB();
  const stores = ['exercises', 'workouts', 'workout_exercises', 'executions', 'measurements', 'cardios', 'settings'];
  
  // Count existing records (read the result inside onsuccess, never synchronously)
  const existingCounts = {};
  {
    const transaction = database.transaction(stores, 'readonly');
    for (const storeName of stores) {
      const request = transaction.objectStore(storeName).count();
      request.onsuccess = () => { existingCounts[storeName] = request.result; };
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  
  if (overwrite) {
    // Clear all data first and wait, so later writes land on empty stores
    const clearTransaction = database.transaction(stores, 'readwrite');
    for (const storeName of stores) {
      clearTransaction.objectStore(storeName).clear();
    }
    await new Promise((resolve, reject) => {
      clearTransaction.oncomplete = () => resolve();
      clearTransaction.onerror = () => reject(clearTransaction.error);
      clearTransaction.onabort = () => reject(clearTransaction.error);
    });
  }
  
  const stats = { exercises: 0, workouts: 0, measurements: 0, executions: 0, cardios: 0, rotina: 0, reaproveitados: 0, ignorados: 0 };
  const idExercicio = new Map(); // id no backup -> id local
  const idTreino = new Map();    // id no backup -> id local
  
  try {
    // --- Exercícios: o índice 'nome' é único, então reaproveita os existentes ---
    const exerciciosLocais = await getAllExercises();
    const idExPorNome = new Map(exerciciosLocais.map(e => [e.nome, e.id]));
    const idsLocaisEx = new Set(exerciciosLocais.map(e => e.id));
    const paraCriarEx = [];
    
    for (const ex of backupData.exercises || []) {
      if (!ex || typeof ex.nome !== 'string') { stats.ignorados++; continue; }
      if (idExPorNome.has(ex.nome)) {
        if (ex.id !== undefined) idExercicio.set(ex.id, idExPorNome.get(ex.nome));
        stats.reaproveitados++;
        continue;
      }
      idExPorNome.set(ex.nome, null); // evita duplicar dentro do mesmo lote
      paraCriarEx.push(ex);
    }
    
    if (paraCriarEx.length > 0) {
      const ids = await adicionarRegistros('exercises', paraCriarEx.map(ex => ({
        nome: ex.nome,
        grupoMuscular: ex.grupoMuscular,
        descricao: ex.descricao,
        videoUrl: ex.videoUrl,
        ativo: ex.ativo !== undefined ? ex.ativo : true
      })));
      ids.forEach((id, i) => {
        const ex = paraCriarEx[i];
        idExPorNome.set(ex.nome, id);
        if (ex.id !== undefined) idExercicio.set(ex.id, id);
      });
      stats.exercises = ids.length;
    }
    
    // --- Treinos: o app usa um treino por dia da semana, então reaproveita
    //     o treino do mesmo dia (e, se não houver, o de mesmo nome) ---
    const treinosLocais = await getAllWorkouts();
    const idTreinoPorDia = new Map(treinosLocais.filter(t => t.diaSemana).map(t => [t.diaSemana, t.id]));
    const idTreinoPorNome = new Map(treinosLocais.map(t => [t.nome, t.id]));
    const idsLocaisTreino = new Set(treinosLocais.map(t => t.id));
    const diasUsados = new Set();
    const nomesUsados = new Set();
    const paraCriarTreino = [];
    
    for (const wt of backupData.workouts || []) {
      if (!wt || typeof wt.nome !== 'string') { stats.ignorados++; continue; }
      
      const mesmoDia = typeof wt.diaSemana === 'string' && !diasUsados.has(wt.diaSemana) && idTreinoPorDia.has(wt.diaSemana);
      const mesmoNome = !nomesUsados.has(wt.nome) && idTreinoPorNome.has(wt.nome);
      const localId = mesmoDia ? idTreinoPorDia.get(wt.diaSemana) : (mesmoNome ? idTreinoPorNome.get(wt.nome) : null);
      
      if (typeof wt.diaSemana === 'string') diasUsados.add(wt.diaSemana);
      nomesUsados.add(wt.nome);
      
      if (localId !== null && localId !== undefined) {
        if (wt.id !== undefined) idTreino.set(wt.id, localId);
        stats.reaproveitados++;
        continue;
      }
      
      paraCriarTreino.push(wt);
    }
    
    if (paraCriarTreino.length > 0) {
      const ids = await adicionarRegistros('workouts', paraCriarTreino.map(wt => ({
        nome: wt.nome,
        diaSemana: wt.diaSemana,
        ordem: wt.ordem,
        ativo: wt.ativo !== undefined ? wt.ativo : true
      })));
      ids.forEach((id, i) => {
        const wt = paraCriarTreino[i];
        if (wt.id !== undefined) idTreino.set(wt.id, id);
      });
      stats.workouts = ids.length;
    }
    
    // --- Medidas: upsert pela data (nunca duplica o mesmo dia) ---
    for (const med of backupData.measurements || []) {
      if (!med || !med.data) { stats.ignorados++; continue; }
      const { id, createdAt, updatedAt, ...record } = med;
      await upsertMeasurement(record);
      stats.measurements++;
    }
    
    // --- Cardio: upsert pela data + tipo (nunca duplica a mesma atividade) ---
    for (const card of backupData.cardios || []) {
      if (!card || !card.data || !card.tipo) { stats.ignorados++; continue; }
      const { id, createdAt, updatedAt, ...record } = card;
      await upsertCardio(record);
      stats.cardios++;
    }
    
    // --- Rotina personalizada (quando veio no backup) ---
    if (backupData.rotina && typeof backupData.rotina === 'object' && backupData.rotina.dias && backupData.rotina.treinos) {
      try {
        await salvarRotinaImportada(backupData.rotina);
        stats.rotina = 1;
      } catch (err) {
        console.warn('Rotina do backup ignorada:', err.message);
        stats.ignorados++;
      }
    }
    
    // --- Séries: remapeia treino/exercício para os ids locais e faz upsert
    //     pela chave natural (data + treino + exercício + série) ---
    for (const exec of backupData.executions || []) {
      if (!exec || !exec.data || !exec.serie) { stats.ignorados++; continue; }
      
      const treinoId = idTreino.has(exec.treinoId)
        ? idTreino.get(exec.treinoId)
        : (idsLocaisTreino.has(exec.treinoId) ? exec.treinoId : null);
      const exercicioId = idExercicio.has(exec.exercicioId)
        ? idExercicio.get(exec.exercicioId)
        : (idsLocaisEx.has(exec.exercicioId) ? exec.exercicioId : null);
      
      if (treinoId === null || exercicioId === null) { stats.ignorados++; continue; }
      
      const { id, createdAt, updatedAt, ...record } = exec;
      await upsertExecution({ ...record, treinoId, exercicioId });
      stats.executions++;
    }
  } catch (err) {
    console.error('Erro ao importar backup:', err);
    return {
      success: false,
      error: err.message,
      details: 'A importação foi interrompida. Importar o mesmo arquivo novamente é seguro: nada é duplicado.',
      stats
    };
  }
  
  return {
    success: true,
    message: 'Dados importados com sucesso',
    existingCounts,
    stats,
    ignorados: stats.ignorados,
    imported: stats.exercises + stats.workouts + stats.measurements + stats.executions + stats.cardios
  };
}

/**
 * Add records to a store in a single transaction and return the generated ids
 * in the same order as the records.
 * @param {string} storeName
 * @param {Array<Object>} records
 * @returns {Promise<Array<number>>}
 */
async function adicionarRegistros(storeName, records) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const ids = new Array(records.length).fill(null);
    
    records.forEach((record, index) => {
      const request = store.add(record);
      request.onsuccess = () => { ids[index] = request.result; };
    });
    
    transaction.oncomplete = () => resolve(ids);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Validate backup format.
 * @param {Object} backupData - Backup data to validate
 * @returns {Object} { valid, error }
 */
function validateBackupFormat(backupData) {
  if (!backupData || typeof backupData !== 'object') {
    return { valid: false, error: 'Formato de backup inválido: objeto esperado' };
  }
  
  if (backupData.version !== undefined && backupData.version > DB_VERSION) {
    return { valid: false, error: `Versão do backup (${backupData.version}) mais nova que a versão atual do banco (${DB_VERSION})` };
  }
  
  // Check required fields
  if (backupData.exercises && !Array.isArray(backupData.exercises)) {
    return { valid: false, error: 'Formato de exercises inválido: array esperado' };
  }
  
  if (backupData.workouts && !Array.isArray(backupData.workouts)) {
    return { valid: false, error: 'Formato de workouts inválido: array esperado' };
  }
  
  if (backupData.measurements && !Array.isArray(backupData.measurements)) {
    return { valid: false, error: 'Formato de measurements inválido: array esperado' };
  }
  
  if (backupData.cardios && !Array.isArray(backupData.cardios)) {
    return { valid: false, error: 'Formato de cardios inválido: array esperado' };
  }
  
  if (backupData.executions && !Array.isArray(backupData.executions)) {
    return { valid: false, error: 'Formato de executions inválido: array esperado' };
  }
  
  // Validate each exercise has required fields
  if (backupData.exercises) {
    for (const ex of backupData.exercises) {
      if (!ex || typeof ex !== 'object') {
        return { valid: false, error: 'Registro de exercise inválido' };
      }
      if (!ex.nome || typeof ex.nome !== 'string') {
        return { valid: false, error: 'Exercise must have a nome field' };
      }
    }
  }
  
  // Validate each workout has required fields
  if (backupData.workouts) {
    for (const wt of backupData.workouts) {
      if (!wt || typeof wt !== 'object') {
        return { valid: false, error: 'Registro de workout inválido' };
      }
      if (!wt.nome || typeof wt.nome !== 'string') {
        return { valid: false, error: 'Workout must have a nome field' };
      }
      if (!wt.diaSemana || typeof wt.diaSemana !== 'string') {
        return { valid: false, error: 'Workout must have a diaSemana field' };
      }
    }
  }
  
  return { valid: true, error: null };
}

/* --- Public API --- */

export {
  initializeExercisesFromPlano,
  initializeWorkoutsFromPlano,
  initializeWorkoutExercisesFromPlano,
  getTodaysWorkout,
  getWorkoutExercisesWithDetails,
  registerSeriesExecution,
  getExerciseExecutionHistory,
  getLastExecution,
  calculateSeriesVolume,
  calculateExerciseVolume,
  calculateWorkoutVolume,
  getProgressionData,
  checkStagnation,
  registerMeasurements,
  getMeasurementsEvolution,
  getAllSettings,
  exportData,
  importData,
  validateBackupFormat,
  DB_VERSION
};