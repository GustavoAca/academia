/**
 * Backup Service - Handles data export and import with versioning.
 * 
 * Provides [ EXPORTAR DADOS ] and [ IMPORTAR DADOS ] functionality
 * as required by the project specifications.
 */

import { initDB, getAllExercises, getAllWorkouts, getAllMeasurements, getAllCardios, getAllFoodEntries, getAllFoods, getSetting, DB_VERSION } from './db.js';
import { importData as importDataService, validateBackupFormat } from './workout-service.js';
import { getAllExecutions } from './report-service.js';

/**
 * Export all data to a backup JSON file.
 * @returns {Promise<Object>} { blob, filename, data } for the download
 */
async function exportBackup() {
  try {
    const db = await initDB();
    const now = new Date();

    // Format date for filename
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hora = String(now.getHours()).padStart(2, '0');
    const minuto = String(now.getMinutes()).padStart(2, '0');
    const segundos = String(now.getSeconds()).padStart(2, '0');

    const dataExport = {
      version: DB_VERSION,
      exportedAt: now.toISOString(),
      exportedAtBr: `${day}/${month}/${year} ${hora}:${minuto}:${segundos}`,
      exercises: [],
      workouts: [],
      executions: [],
      measurements: [],
      foodEntries: [],
      foods: []
    };

    // Get all exercises
    const exercises = await getAllExercises();
    dataExport.exercises = exercises.map(ex => ({
      id: ex.id,
      nome: ex.nome,
      grupoMuscular: ex.grupoMuscular,
      descricao: ex.descricao,
      videoUrl: ex.videoUrl,
      ativo: ex.ativo
    }));

    // Get all workouts
    const workouts = await getAllWorkouts();
    dataExport.workouts = workouts.map(wt => ({
      id: wt.id,
      nome: wt.nome,
      diaSemana: wt.diaSemana,
      ordem: wt.ordem,
      ativo: wt.ativo
    }));

    // Get all executions
    const executions = await getAllExecutions();
    dataExport.executions = executions.map(exec => {
      const { id, createdAt, updatedAt, ...record } = exec;
      return record;
    });

    // Get all measurements (every field, including the 15 body measures)
    const allMeasurements = await getAllMeasurements();
    dataExport.measurements = allMeasurements.map(m => {
      const { id, createdAt, updatedAt, ...record } = m;
      return record;
    });

    // Get cardio sessions (activity + minutes)
    const cardios = await getAllCardios();
    dataExport.cardios = cardios.map(c => {
      const { id, createdAt, updatedAt, ...record } = c;
      return record;
    });

    // Get the custom routine, when there is one
    const rotinaSalva = await getSetting('rotina');
    if (rotinaSalva) dataExport.rotina = rotinaSalva;

    // Get food entries and the learned food catalog
    const foodEntries = await getAllFoodEntries();
    dataExport.foodEntries = foodEntries.map(i => {
      const { id, createdAt, updatedAt, ...record } = i;
      return record;
    });

    const foods = await getAllFoods();
    dataExport.foods = foods.map(f => {
      const { id, createdAt, updatedAt, ...record } = f;
      return record;
    });

    // Meals list and daily calorie goal, when configured
    const refeicoes = await getSetting('refeicoes');
    if (refeicoes) dataExport.refeicoes = refeicoes;
    const metaCalorias = await getSetting('metaCalorias');
    if (metaCalorias !== null && metaCalorias !== undefined) dataExport.metaCalorias = metaCalorias;

    // Generate filename
    const filename = `treino-backup-${year}-${month}-${day}.json`;

    // Create blob
    const blob = new Blob([JSON.stringify(dataExport, null, 2)], {
      type: 'application/json'
    });

    return {
      success: true,
      blob,
      filename,
      data: dataExport
    };

  } catch (err) {
    console.error('Erro ao exportar backup:', err);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Import data from a backup JSON file.
 * Validates the format before importing.
 * @param {Object} backupData - The backup data object
 * @param {boolean} [overwrite=false] - Whether to overwrite existing data
 * @returns {Promise<Object>} Import result with stats and any warnings
 */
async function importBackup(backupData, overwrite = false) {
  try {
    // Validate backup format
    const validation = validateBackupFormat(backupData);

    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        details: 'O formato do backup é inválido. Verifique se é um arquivo de exportação válido.'
      };
    }

    // Check version compatibility
    if (backupData.version > DB_VERSION) {
      return {
        success: false,
        error: `Versão do backup (${backupData.version}) é mais nova que a versão atual do banco (${DB_VERSION}). Atualize o aplicativo antes de importar.`
      };
    }

    // Perform the import
    const result = await importDataService(backupData, overwrite);

    if (result.success) {
      // Refresh any cached state
      // In a real app, would reload the UI
    }

    return result;

  } catch (err) {
    console.error('Erro ao importar backup:', err);
    return {
      success: false,
      error: err.message,
      details: 'Ocorreu um erro inesperado durante a importação.'
    };
  }
}

/**
 * Validate a backup JSON object structure.
 * @param {any} data - Data to validate
 * @returns {Object} { valid, error }
 */
function validateBackupObject(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Dados de backup inválidos: objeto esperado' };
  }

  // Check version
  if (data.version !== undefined && typeof data.version !== 'number') {
    return { valid: false, error: 'Versão do backup deve ser um número' };
  }

  // Check exportedAt
  if (!data.exportedAt) {
    return { valid: false, error: 'Campo exportedAt é obrigatório' };
  }

  // Check required sections
  const requiredSections = ['exercises', 'workouts', 'executions', 'measurements', 'cardios', 'foodEntries', 'foods'];
  for (const section of requiredSections) {
    if (data[section] !== undefined && !Array.isArray(data[section])) {
      return { valid: false, error: `Campo ${section} deve ser um array` };
    }
  }

  // Validate exercises
  if (data.exercises) {
    for (let i = 0; i < data.exercises.length; i++) {
      const ex = data.exercises[i];
      if (!ex || typeof ex !== 'object') {
        return { valid: false, error: `Exercise ${i} is not a valid object` };
      }
      if (!ex.nome || typeof ex.nome !== 'string') {
        return { valid: false, error: `Exercise ${i} must have a nome field` };
      }
    }
  }

  // Validate workouts
  if (data.workouts) {
    for (let i = 0; i < data.workouts.length; i++) {
      const wt = data.workouts[i];
      if (!wt || typeof wt !== 'object') {
        return { valid: false, error: `Workout ${i} is not a valid object` };
      }
      if (!wt.nome || typeof wt.nome !== 'string') {
        return { valid: false, error: `Workout ${i} must have a nome field` };
      }
      if (!wt.diaSemana || typeof wt.diaSemana !== 'string') {
        return { valid: false, error: `Workout ${i} must have a diaSemana field` };
      }
    }
  }

  // Validate measurements
  if (data.measurements) {
    for (let i = 0; i < data.measurements.length; i++) {
      const med = data.measurements[i];
      if (!med || typeof med !== 'object') {
        return { valid: false, error: `Measurement ${i} is not a valid object` };
      }
      if (!med.data) {
        return { valid: false, error: `Measurement ${i} must have a data field` };
      }
    }
  }

  return { valid: true, error: null };
}

/**
 * Download the backup file to the user's device.
 * @param {Object} result - Result from exportBackup function
 */
function downloadBackup(result) {
  if (!result.success) {
    showToast('Erro ao gerar backup: ' + result.error);
    return;
  }

  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Handle file select for import.
 * @param {File} file - The selected backup file
 * @returns {Promise<Object>} Import result
 */
async function handleFileImport(file) {
  try {
    const text = await file.text();
    const backupData = JSON.parse(text);

    // Validate the parsed data
    const validation = validateBackupObject(backupData);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        details: 'O arquivo de backup não tem um formato válido.'
      };
    }

    // Perform import
    const result = await importBackup(backupData);
    return result;

  } catch (err) {
    console.error('Erro ao ler arquivo de backup:', err);
    return {
      success: false,
      error: err.message,
      details: 'Não foi possível ler o arquivo de backup.'
    };
  }
}

/**
 * Show a toast message.
 * @param {string} message - Message to display
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
}

/* --- Export for use in app.js --- */

export {
  exportBackup,
  importBackup,
  validateBackupObject,
  handleFileImport,
  downloadBackup,
  showToast
};