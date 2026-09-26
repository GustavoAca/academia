/**
 * IndexedDB wrapper for the Treino PWA application.
 * 
 * Database structure with versioned stores:
 * - exercises: id, nome, grupoMuscular, descricao, videoUrl, ativo
 * - workouts: id, nome, diaSemana, ordem, ativo
 * - workout_exercises: id, treinoId, exercicioId, ordem, seriesPlanejadas, repeticoesMinimas, repeticoesMaximas
 * - executions: id, data, treinoId, exercicioId, serie, carga, repeticoes, observacao
 * - measurements: id, data, peso, busto, abdomen, culote
 * - settings: chave, valor
 * - food_entries: id, data, refeicaoId, alimento, gramas, calorias, kcal100
 * - foods: id, nome (unique), exibicao, vezes, ultimoGramas, ultimoCalorias, kcal100
 */

const DB_NAME = 'treino_pwa';
const DB_VERSION = 3;

// Schema version history
// DB_VERSION 1: initial schema
// DB_VERSION 2: add new stores or fields
// DB_VERSION 3: add food_entries and foods (alimentação)

let db = null;

// Initialize database promise
let dbPromise = null;

/**
 * Open the IndexedDB database and create object stores if needed.
 * @returns {Promise<void>}
 */
async function initDB() {
  if (db) return db;
  
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onupgradeneeded = (event) => {
        db = event.target.result;
        
        // Create object stores if they don't exist
        if (!db.objectStoreNames.contains('exercises')) {
          const exercisesStore = db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
          exercisesStore.createIndex('nome', 'nome', { unique: true });
          exercisesStore.createIndex('grupoMuscular', 'grupoMuscular');
          exercisesStore.createIndex('ativo', 'ativo');
        }
        
        if (!db.objectStoreNames.contains('workouts')) {
          const workoutsStore = db.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true });
          workoutsStore.createIndex('diaSemana', 'diaSemana');
          workoutsStore.createIndex('ativo', 'ativo');
        }
        
        if (!db.objectStoreNames.contains('workout_exercises')) {
          const workoutExercisesStore = db.createObjectStore('workout_exercises', { keyPath: 'id', autoIncrement: true });
          workoutExercisesStore.createIndex('treinoId', 'treinoId');
          workoutExercisesStore.createIndex('exercicioId', 'exercicioId');
          workoutExercisesStore.createIndex('ordem', 'ordem');
        }
        
        if (!db.objectStoreNames.contains('executions')) {
          const executionsStore = db.createObjectStore('executions', { keyPath: 'id', autoIncrement: true });
          executionsStore.createIndex('treinoId', 'treinoId');
          executionsStore.createIndex('exercicioId', 'exercicioId');
          executionsStore.createIndex('data', 'data');
        }
        
        if (!db.objectStoreNames.contains('measurements')) {
          const measurementsStore = db.createObjectStore('measurements', { keyPath: 'id', autoIncrement: true });
          measurementsStore.createIndex('data', 'data');
        }
        
        if (!db.objectStoreNames.contains('cardios')) {
          const cardiosStore = db.createObjectStore('cardios', { keyPath: 'id', autoIncrement: true });
          cardiosStore.createIndex('data', 'data');
        }
        
        if (!db.objectStoreNames.contains('settings')) {
          const settingsStore = db.createObjectStore('settings', { keyPath: 'chave' });
        }

        if (!db.objectStoreNames.contains('food_entries')) {
          const foodEntriesStore = db.createObjectStore('food_entries', { keyPath: 'id', autoIncrement: true });
          foodEntriesStore.createIndex('data', 'data');
          foodEntriesStore.createIndex('refeicaoId', 'refeicaoId');
        }

        if (!db.objectStoreNames.contains('foods')) {
          const foodsStore = db.createObjectStore('foods', { keyPath: 'id', autoIncrement: true });
          foodsStore.createIndex('nome', 'nome', { unique: true });
        }
      };
      
      request.onsuccess = (event) => {
        db = event.target.result;
        resolve();
      };
      
      request.onerror = (event) => {
        reject(event.error);
      };
    });
  }
  
  await dbPromise;
  return db;
}

/**
 * Save an exercise to the database.
 * @param {Object} exercise - Exercise data {nome, grupoMuscular, descricao, videoUrl, ativo}
 * @returns {Promise<Object>} Saved exercise with id
 */
async function saveExercise(exercise) {
  const database = await initDB();
  const transaction = database.transaction('exercises', 'readwrite');
  const store = transaction.objectStore('exercises');
  const request = store.add({
    ...exercise,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all exercises from the database.
 * @param {Object} [filter] - Optional filter {grupoMuscular, ativo}
 * @returns {Promise<Array>} Array of exercises
 */
async function getAllExercises(filter = {}) {
  const database = await initDB();
  const transaction = database.transaction('exercises', 'readonly');
  const store = transaction.objectStore('exercises');
  
  let index;
  if (filter.grupoMuscular) {
    index = store.index('grupoMuscular');
    const request = index.openCursor(IDBKeyRange.only(filter.grupoMuscular));
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
  
  if (filter.ativo !== undefined) {
    index = store.index('ativo');
    const request = index.openCursor(IDBKeyRange.only(filter.ativo));
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
  
  const request = store.getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a single exercise by id.
 * @param {number} id - Exercise id
 * @returns {Promise<Object|null>}
 */
async function getExercise(id) {
  const database = await initDB();
  const transaction = database.transaction('exercises', 'readonly');
  const store = transaction.objectStore('exercises');
  const request = store.get(id);
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? result : null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update an exercise.
 * @param {number} id - Exercise id
 * @param {Object} updates - Updates to apply
 * @returns {Promise<void>}
 */
async function updateExercise(id, updates) {
  const database = await initDB();
  const transaction = database.transaction('exercises', 'readwrite');
  const store = transaction.objectStore('exercises');
  const request = store.get(id);
  
  return new Promise((resolve, reject) => {
    request.onsuccess = async () => {
      const existing = request.result;
      if (!existing) return reject(new Error(`Exercise ${id} not found`));
      
      const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
      const updateRequest = store.put(updated);
      
      updateRequest.onsuccess = () => resolve(updated);
      updateRequest.onerror = () => reject(updateRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete an exercise.
 * @param {number} id - Exercise id
 * @returns {Promise<void>}
 */
async function deleteExercise(id) {
  const database = await initDB();
  const transaction = database.transaction('exercises', 'readwrite');
  const store = transaction.objectStore('exercises');
  const request = store.delete(id);
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a workout to the database.
 * @param {Object} workout - Workout data {nome, diaSemana, ordem, ativo}
 * @returns {Promise<Object>} Saved workout with id
 */
async function saveWorkout(workout) {
  const database = await initDB();
  const transaction = database.transaction('workouts', 'readwrite');
  const store = transaction.objectStore('workouts');
  const request = store.add({
    ...workout,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all workouts, optionally filtered by day.
 * @param {string} [diaSemana] - Filter by day (seg, ter, qua, qui, sex)
 * @returns {Promise<Array>}
 */
async function getAllWorkouts(diaSemana = null) {
  const database = await initDB();
  const transaction = database.transaction('workouts', 'readonly');
  const store = transaction.objectStore('workouts');
  
  let request;
  if (diaSemana) {
    const index = store.index('diaSemana');
    request = index.openCursor(IDBKeyRange.only(diaSemana));
  } else {
    request = store.getAll();
  }
  
  const results = [];
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      if (diaSemana) {
        const cursor = request.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      } else {
        resolve(request.result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Replace every workout exercise link of a workout in a single transaction.
 * Used when the routine changes (order, series and rep range follow the routine).
 * @param {number} treinoId - Workout id
 * @param {Array<Object>} items - Links {exercicioId, ordem, seriesPlanejadas, repeticoesMinimas, repeticoesMaximas}
 * @returns {Promise<void>}
 */
async function replaceWorkoutExercises(treinoId, items) {
  const database = await initDB();
  const transaction = database.transaction('workout_exercises', 'readwrite');
  const store = transaction.objectStore('workout_exercises');
  const index = store.index('treinoId');
  const request = index.openCursor(IDBKeyRange.only(treinoId));
  
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
      return;
    }
    
    const agora = new Date().toISOString();
    items.forEach((item, i) => {
      store.add({
        treinoId,
        exercicioId: item.exercicioId,
        ordem: item.ordem !== undefined ? item.ordem : i + 1,
        seriesPlanejadas: item.seriesPlanejadas,
        repeticoesMinimas: item.repeticoesMinimas,
        repeticoesMaximas: item.repeticoesMaximas,
        createdAt: agora,
        updatedAt: agora
      });
    });
  };
  
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Save a workout exercise (the relationship between workout and exercise with settings).
 * @param {Object} we - Workout exercise data {treinoId, exercicioId, ordem, seriesPlanejadas, repeticoesMinimas, repeticoesMaximas}
 * @returns {Promise<Object>}
 */
async function saveWorkoutExercise(we) {
  const database = await initDB();
  const transaction = database.transaction('workout_exercises', 'readwrite');
  const store = transaction.objectStore('workout_exercises');
  const request = store.add({
    ...we,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get workout exercises for a specific workout.
 * @param {number} treinoId - Workout id
 * @returns {Promise<Array>}
 */
async function getWorkoutExercises(treinoId) {
  const database = await initDB();
  const transaction = database.transaction('workout_exercises', 'readonly');
  const store = transaction.objectStore('workout_exercises');
  const index = store.index('treinoId');
  const request = index.openCursor(IDBKeyRange.only(treinoId));
  
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

/**
 * Save an execution (series data).
 * @param {Object} execution - Execution data {treinoId, exercicioId, serie, carga, repeticoes, observacao}
 * @returns {Promise<Object>}
 */
async function saveExecution(execution) {
  const database = await initDB();
  const transaction = database.transaction('executions', 'readwrite');
  const store = transaction.objectStore('executions');
  const request = store.add({
    ...execution,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get executions for a specific exercise in a workout.
 * @param {number} treinoId - Workout id
 * @param {number} exercicioId - Exercise id
 * @returns {Promise<Array>}
 */
async function getExecutions(treinoId, exercicioId) {
  const database = await initDB();
  const transaction = database.transaction('executions', 'readonly');
  const store = transaction.objectStore('executions');
  const index = store.index('treinoId');
  
  // Get all executions for this treinoId, then filter by exercicioId
  const request = index.openCursor();
  
  const results = [];
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const execution = cursor.value;
        if (execution.exercicioId === exercicioId) {
          results.push(execution);
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all executions performed on a specific day (YYYY-MM-DD).
 * @param {string} data - Date in YYYY-MM-DD format
 * @returns {Promise<Array>}
 */
async function getExecutionsByDate(data) {
  const database = await initDB();
  const transaction = database.transaction('executions', 'readonly');
  const store = transaction.objectStore('executions');
  const index = store.index('data');
  const request = index.openCursor(IDBKeyRange.only(data));

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

/**
 * Find one execution by its natural key (day, workout, exercise, set).
 * @returns {Promise<Object|null>}
 */
async function findExecution(data, treinoId, exercicioId, serie) {
  const executions = await getExecutionsByDate(data);
  return executions.find(exec =>
    exec.treinoId === treinoId &&
    exec.exercicioId === exercicioId &&
    exec.serie === serie
  ) || null;
}

/**
 * Create or update an execution identified by (data, treinoId, exercicioId, serie).
 * The lookup and the write happen in a single transaction, so concurrent
 * saves for the same key can never create duplicates.
 * @param {Object} execution
 * @returns {Promise<void>}
 */
async function upsertExecution(execution) {
  const database = await initDB();
  const transaction = database.transaction('executions', 'readwrite');
  const store = transaction.objectStore('executions');
  const index = store.index('data');
  const request = index.openCursor(IDBKeyRange.only(execution.data));

  let existing = null;
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      const record = existing
        ? { ...existing, ...execution, id: existing.id, updatedAt: new Date().toISOString() }
        : { ...execution, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      store.put(record);
      return;
    }

    const value = cursor.value;
    if (value.treinoId === execution.treinoId &&
        value.exercicioId === execution.exercicioId &&
        value.serie === execution.serie) {
      existing = value;
    }
    cursor.continue();
  };

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Delete an execution identified by (data, treinoId, exercicioId, serie).
 * @param {string} data - Date in YYYY-MM-DD format
 * @param {number} treinoId
 * @param {number} exercicioId
 * @param {number} serie
 * @returns {Promise<void>}
 */
async function deleteExecution(data, treinoId, exercicioId, serie) {
  const database = await initDB();
  const transaction = database.transaction('executions', 'readwrite');
  const store = transaction.objectStore('executions');
  const index = store.index('data');
  const request = index.openCursor(IDBKeyRange.only(data));

  let existing = null;
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      if (existing) store.delete(existing.id);
      return;
    }

    const value = cursor.value;
    if (value.treinoId === treinoId && value.exercicioId === exercicioId && value.serie === serie) {
      existing = value;
    }
    cursor.continue();
  };

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Save measurement data.
 * @param {Object} measurement - Measurement data {data, peso, busto, abdomen, culote, ...}
 * @returns {Promise<Object>}
 */
async function saveMeasurement(measurement) {
  const database = await initDB();
  const transaction = database.transaction('measurements', 'readwrite');
  const store = transaction.objectStore('measurements');
  const request = store.add({
    ...measurement,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all measurements, sorted by date descending.
 * @returns {Promise<Array>}
 */
async function getAllMeasurements() {
  const database = await initDB();
  const transaction = database.transaction('measurements', 'readonly');
  const store = transaction.objectStore('measurements');
  const index = store.index('data');
  
  // Open cursor in reverse order (newest first)
  const request = index.openCursor(null, 'prev');
  
  const results = [];
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        // 'prev' iterates newest first, so pushing keeps descending order
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get the latest measurement.
 * @returns {Promise<Object>}
 */
async function getLatestMeasurement() {
  const measurements = await getAllMeasurements();
  return measurements.length > 0 ? measurements[0] : null;
}

/**
 * Get the measurement recorded on a specific day (YYYY-MM-DD).
 * @param {string} data - Date in YYYY-MM-DD format
 * @returns {Promise<Object|null>}
 */
async function getMeasurementByDate(data) {
  const database = await initDB();
  const transaction = database.transaction('measurements', 'readonly');
  const index = transaction.objectStore('measurements').index('data');
  const request = index.get(IDBKeyRange.only(data));

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Create or update the measurement of a given day (atomic read + write).
 * @param {Object} measurement
 * @returns {Promise<void>}
 */
async function upsertMeasurement(measurement) {
  const database = await initDB();
  const transaction = database.transaction('measurements', 'readwrite');
  const store = transaction.objectStore('measurements');
  const index = store.index('data');
  const request = index.openCursor(IDBKeyRange.only(measurement.data));

  let existing = null;
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      const record = existing
        ? { ...existing, ...measurement, id: existing.id, updatedAt: new Date().toISOString() }
        : { ...measurement, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      store.put(record);
      return;
    }

    existing = cursor.value;
    cursor.continue();
  };

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Delete the measurement recorded on a given day (atomic read + write).
 * @param {string} data - Date in YYYY-MM-DD format
 * @returns {Promise<void>}
 */
async function deleteMeasurementByDate(data) {
  const database = await initDB();
  const transaction = database.transaction('measurements', 'readwrite');
  const store = transaction.objectStore('measurements');
  const index = store.index('data');
  const request = index.openCursor(IDBKeyRange.only(data));

  let existing = null;
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      if (existing) store.delete(existing.id);
      return;
    }

    existing = cursor.value;
    cursor.continue();
  };

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/* --- Cardio sessions --- */

/**
 * Create or update a cardio session identified by (data, tipo, momento).
 * The lookup and the write happen in a single transaction, so logging the
 * same activity in the same slot (start/end) of the same day updates the
 * time instead of duplicating. Legacy records without `momento` count as 'f'.
 * @param {Object} cardio - { data, tipo, minutos, momento?, observacao? }
 * @returns {Promise<void>}
 */
async function upsertCardio(cardio) {
  const database = await initDB();
  const momento = cardio && cardio.momento === 'i' ? 'i' : 'f';
  const dado = { ...(cardio || {}), momento };
  const transaction = database.transaction('cardios', 'readwrite');
  const store = transaction.objectStore('cardios');
  const index = store.index('data');
  const request = index.openCursor(IDBKeyRange.only(dado.data));
  
  let existing = null;
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      const record = existing
        ? { ...existing, ...dado, id: existing.id, updatedAt: new Date().toISOString() }
        : { ...dado, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      store.put(record);
      return;
    }
    
    const value = cursor.value;
    if (value.tipo === dado.tipo && (value.momento || 'f') === momento) existing = value;
    cursor.continue();
  };
  
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Get the cardio sessions of a day, sorted by activity type.
 * @param {string} data - Date in YYYY-MM-DD format
 * @returns {Promise<Array>}
 */
async function getCardiosByDate(data) {
  const database = await initDB();
  const transaction = database.transaction('cardios', 'readonly');
  const store = transaction.objectStore('cardios');
  const index = store.index('data');
  const request = index.getAll(IDBKeyRange.only(data));
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const list = request.result || [];
      list.sort((a, b) => String(a.tipo).localeCompare(String(b.tipo)));
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get every cardio session, newest day first.
 * @returns {Promise<Array>}
 */
async function getAllCardios() {
  const database = await initDB();
  const transaction = database.transaction('cardios', 'readonly');
  const store = transaction.objectStore('cardios');
  const request = store.getAll();
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const list = request.result || [];
      list.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a cardio session.
 * @param {number} id
 * @returns {Promise<void>}
 */
async function deleteCardio(id) {
  const database = await initDB();
  const transaction = database.transaction('cardios', 'readwrite');
  const request = transaction.objectStore('cardios').delete(id);
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/* --- Food entries (alimentação) --- */

/**
 * Create a food entry for a day/meal.
 * @param {Object} entry - { data, refeicaoId, alimento, gramas, calorias }
 * @returns {Promise<Object>} the saved entry with id
 */
async function addFoodEntry(entry) {
  const database = await initDB();
  const transaction = database.transaction('food_entries', 'readwrite');
  const store = transaction.objectStore('food_entries');
  const record = {
    ...entry,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const request = store.add(record);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve({ ...record, id: request.result });
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get the food entries of a day.
 * @param {string} data - Date in YYYY-MM-DD format
 * @returns {Promise<Array>}
 */
async function getFoodEntriesByDate(data) {
  const database = await initDB();
  const transaction = database.transaction('food_entries', 'readonly');
  const store = transaction.objectStore('food_entries');
  const request = store.index('data').getAll(IDBKeyRange.only(data));

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const list = request.result || [];
      list.sort((a, b) => (a.id - b.id));
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get every food entry, newest day first.
 * @returns {Promise<Array>}
 */
async function getAllFoodEntries() {
  const database = await initDB();
  const transaction = database.transaction('food_entries', 'readonly');
  const store = transaction.objectStore('food_entries');
  const request = store.getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const list = request.result || [];
      list.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (b.id - a.id)));
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a food entry.
 * @param {number} id
 * @returns {Promise<void>}
 */
async function deleteFoodEntry(id) {
  const database = await initDB();
  const transaction = database.transaction('food_entries', 'readwrite');
  const request = transaction.objectStore('food_entries').delete(id);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Create or update a catalog food identified by its lowercase name.
 * @param {Object} food - { nome, exibicao, vezes, ultimoGramas, ultimoCalorias }
 * @returns {Promise<Object>} the saved food with id
 */
async function upsertFood(food) {
  const database = await initDB();
  const transaction = database.transaction('foods', 'readwrite');
  const store = transaction.objectStore('foods');
  const index = store.index('nome');
  const request = index.openCursor(IDBKeyRange.only(food.nome));

  let existing = null;
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      const record = existing
        ? { ...existing, ...food, id: existing.id, updatedAt: new Date().toISOString() }
        : { ...food, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      store.put(record);
      return;
    }

    existing = cursor.value;
    cursor.continue();
  };

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Get a catalog food by its lowercase name.
 * @param {string} nome - lowercase, normalized name
 * @returns {Promise<Object|null>}
 */
async function getFoodByNome(nome) {
  const database = await initDB();
  const transaction = database.transaction('foods', 'readonly');
  const store = transaction.objectStore('foods');
  const request = store.index('nome').get(IDBKeyRange.only(nome));

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get every catalog food, most used first.
 * @returns {Promise<Array>}
 */
async function getAllFoods() {
  const database = await initDB();
  const transaction = database.transaction('foods', 'readonly');
  const store = transaction.objectStore('foods');
  const request = store.getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const list = request.result || [];
      list.sort((a, b) => (b.vezes || 0) - (a.vezes || 0));
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a catalog food.
 * @param {number} id
 * @returns {Promise<void>}
 */
async function deleteFood(id) {
  const database = await initDB();
  const transaction = database.transaction('foods', 'readwrite');
  const request = transaction.objectStore('foods').delete(id);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save or update a setting.
 * @param {string} chave - Setting key
 * @param {any} valor - Setting value
 * @returns {Promise<void>}
 */
async function saveSetting(chave, valor) {
  const database = await initDB();
  const transaction = database.transaction('settings', 'readwrite');
  const store = transaction.objectStore('settings');
  
  // Use put to create or update
  const request = store.put({
    chave,
    valor: JSON.stringify(valor),
    updatedAt: new Date().toISOString()
  });
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a setting value.
 * @param {string} chave - Setting key
 * @returns {Promise<any>}
 */
async function getSetting(chave) {
  const database = await initDB();
  const transaction = database.transaction('settings', 'readonly');
  const store = transaction.objectStore('settings');
  const request = store.get(chave);
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const result = request.result;
      if (result && result.valor) {
        try {
          resolve(JSON.parse(result.valor));
        } catch (e) {
          resolve(result.valor);
        }
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete all data (for migration/reset purposes).
 * @returns {Promise<void>}
 */
async function clearAllData() {
  const database = await initDB();
  
  const stores = ['exercises', 'workouts', 'workout_exercises', 'executions', 'measurements', 'cardios', 'settings', 'food_entries', 'foods'];
  
  await Promise.all(stores.map(storeName => {
    const transaction = database.transaction(stores, 'readwrite');
    return transaction.objectStore(storeName).clear();
  }));
  
  return Promise.resolve();
}

export {
  initDB,
  saveExercise,
  getAllExercises,
  getExercise,
  updateExercise,
  deleteExercise,
  saveWorkout,
  getAllWorkouts,
  saveWorkoutExercise,
  replaceWorkoutExercises,
  getWorkoutExercises,
  saveExecution,
  getExecutions,
  getExecutionsByDate,
  findExecution,
  upsertExecution,
  deleteExecution,
  saveMeasurement,
  getAllMeasurements,
  getLatestMeasurement,
  getMeasurementByDate,
  upsertMeasurement,
  deleteMeasurementByDate,
  upsertCardio,
  getCardiosByDate,
  getAllCardios,
  deleteCardio,
  addFoodEntry,
  getFoodEntriesByDate,
  getAllFoodEntries,
  deleteFoodEntry,
  upsertFood,
  getFoodByNome,
  getAllFoods,
  deleteFood,
  saveSetting,
  getSetting,
  clearAllData,
  DB_NAME,
  DB_VERSION
};