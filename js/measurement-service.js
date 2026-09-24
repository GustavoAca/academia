/**
 * Measurement Service - Handles body measurements (peso, busto, abdomen, culote).
 * 
 * Stores measurements in IndexedDB with date tracking.
 * Provides evolution calculations for reporting.
 */

import { initDB, saveMeasurement, getAllMeasurements, getLatestMeasurement } from './db.js';

/* --- State --- */

/**
 * Register new body measurements.
 * @param {Object} measurements - {peso, busto, abdomen, culote}
 * @param {string} [date] - Optional date (defaults to today YYYY-MM-DD)
 * @returns {Promise<Object>} Saved measurement record
 */
async function registerMeasurements(measurements, date = null) {
  const today = date || new Date().toISOString().split('T')[0];
  
  // Validate required fields
  if (!measurements.peso) {
    throw new Error('Peso é obrigatório');
  }
  
  return saveMeasurement({
    data: today,
    peso: Number(measurements.peso),
    busto: measurements.busto !== undefined ? Number(measurements.busto) : null,
    abdomen: measurements.abdomen !== undefined ? Number(measurements.abdomen) : null,
    culote: measurements.culote !== undefined ? Number(measurements.culote) : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

/**
 * Get all measurements sorted by date descending (newest first).
 * @returns {Promise<Array>} Array of measurement records
 */
async function getAllMeasurementsDesc() {
  const measurements = await getAllMeasurements();
  
  // Sort by date descending
  return measurements.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
}

/**
 * Get measurements evolution data for reporting.
 * Calculates initial, current, and difference for each metric.
 * @returns {Promise<Object>}
 */
async function getMeasurementsEvolution() {
  const measurements = await getAllMeasurementsDesc();
  
  if (measurements.length === 0) {
    return {
      peso: { inicial: null, atual: null, diferenca: null },
      busto: { inicial: null, atual: null, diferenca: null },
      abdomen: { inicial: null, atual: null, diferenca: null },
      culote: { inicial: null, atual: null, diferenca: null }
    };
  }
  
  // First measurement (oldest in sorted desc = last chronologically)
  const first = measurements[measurements.length - 1];
  // Last measurement (newest in sorted desc = most recent)
  const last = measurements[0];
  
  const getValue = (measurement, key) => {
    const val = measurement[key];
    return val !== null && !isNaN(val) ? Number(val) : null;
  };
  
  return {
    peso: {
      inicial: getValue(first, 'peso'),
      atual: getValue(last, 'peso'),
      diferenca: (getValue(last, 'peso') || 0) - (getValue(first, 'peso') || 0)
    },
    busto: {
      inicial: getValue(first, 'busto'),
      atual: getValue(last, 'busto'),
      diferenca: (getValue(last, 'busto') || 0) - (getValue(first, 'busto') || 0)
    },
    abdomen: {
      inicial: getValue(first, 'abdomen'),
      atual: getValue(last, 'abdomen'),
      diferenca: (getValue(last, 'abdomen') || 0) - (getValue(first, 'abdomen') || 0)
    },
    culote: {
      inicial: getValue(first, 'culote'),
      atual: getValue(last, 'culote'),
      diferenca: (getValue(last, 'culote') || 0) - (getValue(first, 'culote') || 0)
    }
  };
}

/**
 * Get the latest measurement record.
 * @returns {Promise<Object>}
 */
async function getLatestMeasurementRecord() {
  return getLatestMeasurement();
}

/* --- Public API --- */

export {
  registerMeasurements,
  getAllMeasurementsDesc,
  getMeasurementsEvolution,
  getLatestMeasurementRecord
};