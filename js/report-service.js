/**
 * Report Service - Handles reports generation from IndexedDB data.
 * 
 * Provides volume calculations, progression tracking, and evolution charts.
 */

import {
  calculateSeriesVolume,
  calculateExerciseVolume,
  calculateWorkoutVolume,
  getProgressionData,
  checkStagnation
} from './workout-service.js';
import { getAllExercises, getAllWorkouts, getAllMeasurements, getMeasurementsEvolution } from './db.js';

/* --- Volume Calculations --- */

/**
 * Calculate total volume for a workout.
 * @param {number} workoutId - Workout ID
 * @returns {Promise<Object>} { totalVolume, exerciseCount, seriesCount }
 */
async function getWorkoutReport(workoutId) {
  const weList = await getWorkoutExercises(workoutId);
  const totalVolume = await calculateWorkoutVolume(workoutId);
  const exercisesCount = weList.length;
  
  // Get all executions for this workout
  const executions = await getExecutionsByWorkout(workoutId);
  const seriesCount = executions ? executions.length : 0;
  
  return {
    workoutId,
    totalVolume,
    exercisesCount,
    seriesCount,
    averageVolume: exercisesCount > 0 ? totalVolume / exercisesCount : 0
  };
}

/**
 * Calculate volume per exercise across all workouts.
 * @param {number} exercicioId - Exercise ID (optional, all if not provided)
 * @returns {Promise<Array>} Array of { nome, totalVolume, workoutCount }
 */
async function getVolumePerExercise(exercicioId = null) {
  const workouts = await getAllWorkouts();
  const exercises = await getAllExercises();
  const exerciseMap = new Map();
  
  // Initialize exercise map
  exercises.forEach(ex => exerciseMap.set(ex.id, { nome: ex.nome, volumeTotal: 0, workoutCount: 0 }));
  
  // Get workout exercises
  for (const workout of workouts) {
    const weList = await getWorkoutExercises(workout.id);
    const WeIds = new Set(weList.map(we => we.exercicioId));
    
    for (const we of weList) {
      if (exercicioId && we.exercicioId !== exercicioId) continue;
      
      const ex = exerciseMap.get(we.exercicioId);
      if (ex) {
        // Get executions for this exercise in this workout
        const executions = await getExecutionsByWorkoutAndExercise(workout.id, we.exercicioId);
        if (executions) {
          executions.forEach(exec => {
            ex.volumeTotal += calculateSeriesVolume(exec.carga, exec.repeticoes);
          });
          ex.workoutCount++;
        }
      }
    }
  }
  
  return Array.from(exerciseMap.values())
    .filter(ex => exercicioId ? ex.nome : true)
    .sort((a, b) => b.volumeTotal - a.volumeTotal);
}

/**
 * Calculate volume per week across all workouts.
 * @returns {Promise<Array>} Array of { semana, totalVolume, exercisesCount }
 */
async function getVolumePerWeek() {
  const workouts = await getAllWorkouts();
  const executionsByWeek = {};
  
  // Get all executions
  const allExecutions = await getAllExecutions();
  
  allExecutions.forEach(exec => {
    const date = new Date(exec.data);
    const weekKey = `${date.getFullYear()}-W${getWeekNumber(date)}`;
    
    if (!executionsByWeek[weekKey]) {
      executionsByWeek[weekKey] = { totalVolume: 0, seriesCount: 0 };
    }
    
    executionsByWeek[weekKey].totalVolume += calculateSeriesVolume(exec.carga, exec.repeticoes);
    executionsByWeek[weekKey].seriesCount++;
  });
  
  // Convert to array and sort by week
  return Object.entries(executionsByWeek)
    .map(([week, data]) => ({
      semana: week,
      totalVolume: data.totalVolume,
      seriesCount: data.seriesCount
    }))
    .sort((a, b) => a.semana.localeCompare(b.semana));
}

/**
 * Get week number from Date.
 * @param {Date} date - Date object
 * @returns {number} Week number
 */
function getWeekNumber(date) {
  const Jan1 = new Date(date.getFullYear(), 0, 1);
  const day = ((date - Jan1) / 86400000) + 1;
  const w = Math.floor((day + Jan1.getDay() - 1) / 7) + 1;
  return w;
}

/* --- Progression Tracking --- */

/**
 * Get progression data for all exercises in a workout.
 * @param {number} workoutId - Workout ID
 * @returns {Promise<Array>} Array of progression data per exercise
 */
async function getWorkoutProgression(workoutId) {
  const weList = await getWorkoutExercises(workoutId);
  
  if (weList.length === 0) return [];
  
  const progression = [];
  
  for (const we of weList) {
    const hist = await getProgressionData(workoutId, we.exercicioId);
    
    if (hist.length > 0) {
      const latest = hist[hist.length - 1];
      progression.push({
        exercicioId: we.exercicioId,
        nome: we.exercise ? we.exercise.nome : 'Exercício',
        seriesPlanejadas: we.seriesPlanejadas,
        latestVolume: latest.totalVolume,
        latestSessions: latest.records.length,
        progressionData: latest
      });
    }
  }
  
  return progression;
}

/* --- Measurements Evolution --- */

/**
 * Get complete measurements report.
 * @returns {Promise<Object>}
 */
async function getMeasurementsReport() {
  const evolution = await getMeasurementsEvolution();
  const allMeasurements = await getAllMeasurements();
  
  let result = {
    totalRegistros: allMeasurements.length,
    peso: evolution.peso,
    busto: evolution.busto,
    abdomen: evolution.abdomen,
    culote: evolution.culote
  };
  
  // Calculate average days between measurements
  if (allMeasurements.length > 1) {
    const sorted = allMeasurements.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
    let totalDays = 0;
    
    for (let i = 1; i < sorted.length; i++) {
      const diff = new Date(sorted[i].data).getTime() - new Date(sorted[i - 1].data).getTime();
      totalDays += diff / (1000 * 60 * 60 * 24);
    }
    
    const avgDays = totalDays / (sorted.length - 1);
    result.medicaoMedia = {
      diasEntreMedidas: Math.round(avgDays),
      totalPesosRegistrados: allMeasurements.filter(m => m.peso).length
    };
  }
  
  return result;
}

/* --- Get all executions by workout --- */

/**
 * Get all executions for a workout.
 * @param {number} workoutId - Workout ID
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
      let cursor = request.result;
      while (cursor) {
        results.push(cursor.value);
        cursor = cursor.continue();
      }
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all executions for a workout and specific exercise.
 * @param {number} workoutId - Workout ID
 * @param {number} exercicioId - Exercise ID
 * @returns {Promise<Array>}
 */
async function getExecutionsByWorkoutAndExercise(workoutId, exercicioId) {
  const database = await initDB();
  const transaction = database.transaction('executions', 'readonly');
  const store = transaction.objectStore('executions');
  
  // First filter by treinoId, then filter by exercicioId in client code
  const index = store.index('treinoId');
  const request = index.openCursor(IDBKeyRange.only(workoutId));
  
  const results = [];
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      let cursor = request.result;
      while (cursor) {
        const exec = cursor.value;
        if (exec.exercicioId === exercicioId) {
          results.push(exec);
        }
        cursor = cursor.continue();
      }
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

/* --- Get all executions --- */

/**
 * Get all executions from the database.
 * @returns {Promise<Array>}
 */
async function getAllExecutions() {
  const database = await initDB();
  const transaction = database.transaction('executions', 'readonly');
  const store = transaction.objectStore('executions');
  const request = store.getAll();
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* --- Public API --- */

export {
  getWorkoutReport,
  getVolumePerExercise,
  getVolumePerWeek,
  getWorkoutProgression,
  getMeasurementsReport,
  getExecutionsByWorkout,
  getExecutionsByWorkoutAndExercise,
  getAllExecutions
};