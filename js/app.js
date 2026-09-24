/**
 * Application Main Module - Controls the UI flow and coordinates between services.
 * 
 * Separates UI from persistence logic as required by the project architecture.
 */

import { initDB, getAllExercises, getAllWorkouts, getAllMeasurements, getAllSettings, clearAllData } from './db.js';
import {
  initializeExercisesFromPlano,
  initializeWorkoutsFromPlano,
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
  checkStagnation: checkStagnationService,
  exportData,
  importData,
  validateBackupFormat
} from './workout-service.js';

// Application state
const state = {
  currentDay: null,      // Current day of week (1=Seg, 2=Ter, ..., 5=Sex)
  currentWorkout: null,  // Current workout object
  currentExerciseIndex: 0, // Current exercise within workout
  isRunning: false,      // Whether a workout is in progress
  timer: {
    start: null,
    duration: 180,       // Default 3 minutes rest
    id: null
  },
  // UI preferences
  selectedMetric: 'peso',
  showProgress: true
};

/* --- Initialization --- */

/**
 * Initialize the application.
 * - Open IndexedDB
 * - Migrate data from PLANO/localStorage if needed
 * - Set up event listeners
 */
async function initApp() {
  try {
    await initDB();
    
    // Try to migrate existing data from localStorage (old format)
    await migrateFromLocalStorage();
    
    // Initialize with PLANO data if database is empty
    const exerciseCount = await getAllExercises().then(r => r.length);
    const workoutCount = await getAllWorkouts().then(r => r.length);
    
    if (exerciseCount === 0) {
      // Extract exercises from the original PLANO object
      const planoExercises = extractExercisesFromPlano();
      await initializeExercisesFromPlano(planoExercises);
    }
    
    if (workoutCount === 0) {
      const plano = window.PLANO || getPlanoFromLocalStorage();
      if (plano) {
        await initializeWorkoutsFromPlano(plano);
      }
    }
    
    // Set current day and render initial screen
    setCurrentDay();
    renderInitialScreen();
    
    // Set up navigation
    setupNavigation();
    
    showToast('Aplicação inicializada com sucesso');
    
  } catch (err) {
    console.error('Erro ao inicializar aplicação:', err);
    showToast('Erro ao iniciar aplicação');
  }
}

/* --- Data Migration from Old System --- */

/**
 * Extract exercises from the original PLANO object in index.html.
 * @returns {Array} Array of exercise tuples [nome, grupoMuscular, series, min, max]
 */
function extractExercisesFromPlano() {
  const exercises = [];
  const dias = ['seg', 'ter', 'qua', 'qui', 'sex'];
  
  for (const dia of dias) {
    if (window.PLANO && window.PLANO[dia]) {
      const workout = window.PLANO[dia];
      if (workout.ex) {
        for (const ex of workout.ex) {
          // ex = [nome, grupoMuscular, series, minReps, maxReps]
          const exists = exercises.some(e => e.nome === ex[0] && e.grupoMuscular === ex[1]);
          if (!exists) {
            exercises.push({
              nome: ex[0],
              grupoMuscular: ex[1],
              descricao: '',
              videoUrl: '',
              ativo: true
            });
          }
        }
      }
    }
  }
  
  return exercises;
}

/**
 * Get PLANO from localStorage (old format).
 * @returns {Object|null}
 */
function getPlanoFromLocalStorage() {
  try {
    const data = localStorage.getItem('treino2026');
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed && PLANO) return parsed;
    }
  } catch (e) {
    // Invalid JSON, ignore
  }
  return null;
}

/**
 * Migrate data from old localStorage format to IndexedDB.
 * Preserves existing user data without overwriting.
 * @returns {Promise<void>}
 */
async function migrateFromLocalStorage() {
  try {
    const oldData = localStorage.getItem('treino2026');
    if (!oldData) return;
    
    const parsed = JSON.parse(oldData);
    if (!parsed || !parsed.log) return;
    
    // Check if data already migrated (by checking version or existence)
    const existingExercises = await getAllExercises();
    if (existingExercises.length > 0) return; // Already migrated
    
    // Migrate exercises - extract unique exercises from the log
    const exerciseMap = new Map(); // nome -> {grupoMuscular, ativo}
    
    // Get all unique exercise names from the log keys
    const logKeys = Object.keys(parsed.log);
    
    for (const key of logKeys) {
      const parts = key.split('|');
      if (parts.length >= 4) {
        const [dia, semestre, exercicio] = parts.slice(0, 3);
        const execution = parsed.log[key];
        
        if (execution && execution.c !== undefined) {
          // Extract exercise name from the PLANO or use key
          const exerciseName = extractExerciseNameFromKey(execution);
          const grupo = determineMuscleGroup(exerciseName);
          
          if (!exerciseMap.has(exerciseName)) {
            exerciseMap.set(exerciseName, {
              grupoMuscular: grupo,
              ativo: true
            });
          }
        }
      }
    }
    
    // Save migrated exercises
    const exercises = [];
    exerciseMap.forEach((value, key) => {
      exercises.push({
        nome: key,
        ...value
      });
    });
    
    // Save in batches
    for (const ex of exercises) {
      await saveExerciseToDB(ex);
    }
    
    showToast(`Migração concluída: ${exercises.length} exercícios migrados`);
    
  } catch (err) {
    console.error('Erro na migração:', err);
    // Don't throw - migration is best-effort
  }
}

/**
 * Extract exercise name from old execution data.
 * @param {Object} execution - Old execution data
 * @returns {string}
 */
function extractExerciseNameFromKey(execution) {
  // Try to get name from various sources
  if (execution && execution.n) return execution.n;
  return 'Exercício';
}

/**
 * Determine muscle group from exercise name.
 * @param {string} nome - Exercise name
 * @returns {string}
 */
function determineMuscleGroup(nome) {
  const lower = nome.toLowerCase();
  if (lower.includes('peito') || lower.includes('peitorial')) return 'Peito';
  if (lower.includes('ombro') || lower.includes('deltoide')) return 'Ombros';
  if (lower.includes('tríceps')) return 'Tríceps';
  if (lower.includes('bíceps') || lower.includes('braco')) return 'Bíceps';
  if (lower.includes('costas') || lower.includes('costal')) return 'Costas';
  if (lower.includes('quadr') || lower.includes('perna') || lower.includes('pata')) return 'Quadríceps';
  if (lower.includes('posterior') || lower.includes('iso') || lower.includes('femural')) return 'Posterior';
  if (lower.includes('panturrilha') || lower.includes('gemelo')) return 'Panturrilha';
  if (lower.includes('abdominal') || lower.includes('abdomen') || lower.includes('core')) return 'Abdômen';
  return 'Outro';
}

/**
 * Save exercise to IndexedDB.
 * @param {Object} exercise - Exercise data
 * @returns {Promise<void>}
 */
async function saveExerciseToDB(exercise) {
  const db = await initDB();
  const transaction = db.transaction('exercises', 'readwrite');
  const store = transaction.objectStore('exercises');
  const request = store.add({
    nome: exercise.nome,
    grupoMuscular: exercise.grupoMuscular,
    descricao: exercise.descricao || '',
    videoUrl: exercise.videoUrl || '',
    ativo: exercise.ativo !== undefined ? exercise.ativo : true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/* --- Day Management --- */

/**
 * Set the current day based on the date.
 * Calculates which day of the week and which workout cycle.
 */
function setCurrentDay() {
  const now = new Date();
  const dayIndex = now.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
  
  // Map to our system: 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex
  // JS: 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb, 0=Dom
  let dayKey;
  let dayName;
  
  if (dayIndex >= 1 && dayIndex <= 5) {
    dayKey = dayIndex; // 1=Seg, 2=Ter, etc.
    dayName = getDayName(dayIndex);
  } else {
    // Weekends - default to Monday or last workout
    dayKey = 1;
    dayName = 'Segunda';
    showToast('Final de semana - exibindo treino de Segunda-feira');
  }
  
  state.currentDay = dayKey;
  l علي .ا episód:اقش Gespräch, такие段时间, تاريخ lainnya 테 biofilms? gặp test. families ... интервités ba conversación , وضعیت ( educated 1ску...
 bearer Oosten, period |powered
haben
4 �жин
2 ( bildवान