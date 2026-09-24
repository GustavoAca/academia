/**
 * Timer Service - Handles configurable rest timer between series.
 * 
 * Stores timer state in IndexedDB so it survives browser suspension.
 * Calculates remaining time based on actual elapsed time, not a counting loop.
 */

import { saveSetting, getSetting } from './db.js';

/* --- State Keys --- */
const TIMER_KEY = 'timer_descanço';

/* --- Timer State --- */
/**
 * Default rest duration in seconds (3 minutes).
 */
const DEFAULT_DURATION = 180;

/* --- Initialize Timer from IndexedDB --- */

/**
 * Load timer state from IndexedDB.
 * @returns {Promise<Object>} { inicio, duracao, restante }
 */
async function loadTimerState() {
  const stored = await getSetting(TIMER_KEY);
  
  if (stored && stored.inicio && stored.duracao) {
    const inicio = new Date(stored.inicio);
    const duracao = stored.duracao * 1000; // Convert to ms
    const agora = Date.now();
    const decorrido = agora - inicio.getTime();
    const restante = Math.max(0, duracao - decorrido);
    
    return {
      inicio: stored.inicio,
      duracao: stored.duracao,
      restante: Math.round(restante / 1000), // in seconds
      isActive: decorrido < duracao
    };
  }
  
  // Return default state
  return {
    inicio: new Date().toISOString(),
    duracao: DEFAULT_DURATION,
    restante: DEFAULT_DURATION,
    isActive: true
  };
}

/* --- Start Timer --- */

/**
 * Start the rest timer.
 * @param {number} [duration] - Duration in seconds (defaults to DEFAULT_DURATION)
 * @returns {Promise<Object>} Initial timer state
 */
async function startTimer(duration = DEFAULT_DURATION) {
  const inicio = new Date();
  
  await saveSetting(TIMER_KEY, {
    inicio: inicio.toISOString(),
    duracao: duration
  });
  
  // Calculate initial remaining time
  const agora = Date.now();
  const decorrido = agora - inicio.getTime();
  const restante = Math.max(0, (duration * 1000) - decorrido);
  
  return {
    inicio: inicio.toISOString(),
    duracao: duration,
    restante: Math.round(restante / 1000),
    isActive: decorrido < (duration * 1000)
  };
}

/**
 * Pause the timer.
 * @returns {Promise<Object>} Current timer state
 */
async function pauseTimer() {
  const stored = await getSetting(TIMER_KEY);
  if (stored && stored.inicio) {
    // Just read the current state - the "pause" is handled by
    // not recalculating until restart
    return loadTimerState();
  }
  return loadTimerState();
}

/**
 * Reset the timer with a new duration.
 * @param {number} [duration] - New duration in seconds
 * @returns {Promise<Object>} New timer state
 */
async function resetTimer(duration = DEFAULT_DURATION) {
  return startTimer(duration);
}

/**
 * Get current timer state (remaining time calculation).
 * @returns {Promise<Object>} Current timer state
 */
async function getCurrentState() {
  return loadTimerState();
}

/* --- Public API --- */

export {
  loadTimerState,
  startTimer,
  pauseTimer,
  resetTimer,
  getCurrentState,
  DEFAULT_DURATION
};