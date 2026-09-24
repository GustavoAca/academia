/**
 * Measurement Service - Handles body measurements recorded per day.
 *
 * Stores one record per day in IndexedDB with the same 15 fields
 * used by the reference application (exemplo.html).
 */

import {
  getAllMeasurements,
  getLatestMeasurement,
  getMeasurementByDate,
  upsertMeasurement,
  deleteMeasurementByDate
} from './db.js';

/**
 * Measurement fields in the exact order shown by the Medidas screen.
 * [campo, rótulo, unidade]
 */
const MED = [
  ['peso', 'Peso', 'kg'],
  ['gord', '% Gordura', '%'],
  ['cint', 'Cintura', 'cm'],
  ['busto', 'Busto', 'cm'],
  ['abdomen', 'Abdômen', 'cm'],
  ['culote', 'Culote', 'cm'],
  ['quad', 'Quadril', 'cm'],
  ['peit', 'Peito', 'cm'],
  ['bd', 'Braço D', 'cm'],
  ['be', 'Braço E', 'cm'],
  ['cd', 'Coxa D', 'cm'],
  ['ce', 'Coxa E', 'cm'],
  ['pd', 'Panturrilha D', 'cm'],
  ['pe', 'Panturrilha E', 'cm'],
  ['pesc', 'Pescoço', 'cm']
];

/**
 * Convert an input value to a number (supports comma decimals).
 * @param {string|number} value
 * @returns {number|null}
 */
function num(value) {
  const n = parseFloat(String(value).replace(',', '.'));
  return isNaN(n) ? null : n;
}

/**
 * Save (or clear) the measurements of a given day.
 * Clears the day when every field is empty, like the reference app does.
 * @param {string} data - Date in YYYY-MM-DD format
 * @param {Object} values - Raw values keyed by field name
 * @returns {Promise<Object|null>} Saved record, or null when cleared
 */
async function saveMeasurements(data, values) {
  const record = { data };
  let preenchidos = 0;

  for (const [campo] of MED) {
    const raw = values[campo];
    const valor = raw === undefined || raw === '' || raw === null ? null : num(raw);
    record[campo] = valor;
    if (valor !== null) preenchidos++;
  }

  if (preenchidos === 0) {
    await deleteMeasurementByDate(data);
    return null;
  }

  return upsertMeasurement(record);
}

/**
 * Get one day's measurement record.
 * @param {string} data - Date in YYYY-MM-DD format
 * @returns {Promise<Object|null>}
 */
async function getMeasurementDay(data) {
  return getMeasurementByDate(data);
}

/**
 * Get the series of one field as [[date, value]] sorted ascending,
 * ignoring days without that field.
 * @param {string} campo - Field name
 * @returns {Promise<Array>}
 */
async function serieMedida(campo) {
  const measurements = await getAllMeasurements();

  return measurements
    .map(m => [m.data, m[campo] !== undefined && m[campo] !== null ? Number(m[campo]) : null])
    .filter(par => par[1] !== null && !isNaN(par[1]))
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

/**
 * Get all measurements sorted by date descending (newest first).
 * @returns {Promise<Array>}
 */
async function getAllMeasurementsDesc() {
  const measurements = await getAllMeasurements();

  return measurements.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
}

/**
 * Get measurements evolution data for reporting.
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

  const first = measurements[measurements.length - 1];
  const last = measurements[0];

  const getValue = (measurement, key) => {
    const val = measurement[key];
    return val !== null && val !== undefined && !isNaN(val) ? Number(val) : null;
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
 * @returns {Promise<Object|null>}
 */
async function getLatestMeasurementRecord() {
  return getLatestMeasurement();
}

/* --- Public API --- */

export {
  MED,
  num,
  saveMeasurements,
  getMeasurementDay,
  serieMedida,
  getAllMeasurementsDesc,
  getMeasurementsEvolution,
  getLatestMeasurementRecord
};
