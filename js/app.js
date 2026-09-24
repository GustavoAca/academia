/**
 * Application Main Module - Controls the UI flow and coordinates between services.
 * 
 * Separates UI from persistence logic as required by the project architecture.
 */

import { initDB, migrateData, updateDBVersion } from './db.js';
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
  registerMeasurements,
  getMeasurementsEvolution,
  exportData,
  importData,
  validateBackupFormat
} from './workout-service.js';
import { registerMeasurements as registerMsr, getMeasurementsEvolution as getMsrEvolution, getLatestMeasurementRecord } from './measurement-service.js';

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
    await migrateData();
    updateDBVersion();
    setCurrentDay();
    renderInitialScreen();
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
      if (parsed && parsed.log) return parsed;
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

/* --- Day Management --- */

/**
 * Set the current day based on the date.
 * Calculates which day of the week and which workout cycle.
 */
function setCurrentDay() {
  const now = new Date();
  const dayIndex = now.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
  
  // Map to our system: 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex
  // JS: 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
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
}

/* --- Render Functions --- */

/**
 * Render the initial screen showing the workout of the day.
 */
function renderInitialScreen() {
  const workout = getTodaysWorkout(state.currentDay);
  const weDetails = workout ? getWorkoutExercisesWithDetails(workout.id) : [];
  
  let html = `
    <header>
      <div class="tabs">
        <button data-a="tela" data-t="treino" class="${state.tela === 'treino' ? 'on' : ''}">Treino</button>
        <button data-a="tela" data-t="med" class="${state.tela === 'med' ? 'on' : ''}">Medidas</button>
        <button data-a="tela" data-t="rel" class="${state.tela === 'rel' ? 'on' : ''}">Relatório</button>
      </div>
    </header>
    <main class="card">
      <h1>Treino do Dia</h1>
      <div class="meta">${getDayName(state.currentDay)}</div>
    </main>
    <nav>
      <div>
        <button data-a="ant">← Anterior</button>
        <button class="c" data-a="lista">☰ 1/6</button>
        <button data-a="prox" class="p">Próximo →</button>
      </div>
    </nav>
  `;
  
  document.getElementById('app').innerHTML = html;
  
  // Render workout details if available
  if (weDetails.length > 0) {
    const workoutDiv = document.createElement('div');
    workoutDiv.className = 'card';
    workoutDiv.innerHTML = `
      <h2>${workout.nome}</h2>
      <p>${getDayName(state.currentDay)} - ${workout.t}</p>
      <ul>
        ${weDetails.slice(0, 6).map((we, i) => `
          <li style="margin-bottom: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 8px;">
            <span>${we.exercise.nome}</span> - 
            ${we.seriesPlanejadas} séries × ${we.repeticoesMinimas}-${we.repeticoesMaximas} reps
          </li>
        `).join('')}
      </ul>
    `;
    document.getElementById('app').appendChild(workoutDiv);
  }
}

/* --- Show Measurement Screen --- */

/**
 * Render the measurements screen.
 */
function renderMeasurementScreen() {
  const evolution = getMsrEvolution();
  const latest = getLatestMeasurementRecord();
  
  let formHtml = `
    <div class="card">
      <h2>Registrar Medidas</h2>
      <p>Peso quando quiser; as demais medidas, uma vez por semana.</p>
      <input type="date" id="mdata" value="${new Date().toISOString().split('T')[0]}" style="width: 100%; margin: 8px 0; padding: 8px;">
      <div class="frm" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0;">
        <div>
          <label>Peso (kg)</label>
          <input type="number" id="mpeso" step="0.1" placeholder="Ex: 90" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 8px;">
        </div>
        <div>
          <label>Busto (cm)</label>
          <input type="number" id="mbusto" step="1" placeholder="Ex: 105" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 8px;">
        </div>
      </div>
      <div class="frm" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0;">
        <div>
          <label>Abdômen (cm)</label>
          <input type="number" id="mabdomen" step="1" placeholder="Ex: 95" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 8px;">
        </div>
        <div>
          <label>Culote (cm)</label>
          <input type="number" id="mculote" step="1" placeholder="Ex: 104" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 8px;">
        </div>
      </div>
      <button class="btn p" style="width: 100%; margin: 12px 0; font-size: 14px;" onclick="registerMeasurementNow()">Salvar Medidas</button>
    </div>
  `;
  
  let historyHtml = `
    <div class="card">
      <h2>Histórico de Medidas</h2>
    `;
  
  if (evolution) {
    historyHtml += `
      <div class="kpis" style="margin: 12px 0;">
        <div class="kpi">
          <b>Peso Inicial:</b> ${evolution.peso.inicial !== null ? evolution.peso.inicial.toLocaleString('pt-BR') + ' kg' : '—'}
        </div>
        <div class="kpi">
          <b>Peso Atual:</b> ${evolution.peso.atual !== null ? evolution.peso.atual.toLocaleString('pt-BR') + ' kg' : '—'}
        </div>
        <div class="kpi">
          <b>Variação:</b> ${evolution.peso.diferenca !== null ? (evolution.peso.diferenca > 0 ? '+' : '') + evolution.peso.diferenca.toLocaleString('pt-BR') + ' kg' : '—'}
        </div>
      </div>
      <div class="kpis">
        <div class="kpi">
          <b>Busto Atual:</b> ${evolution.busto.atual !== null ? evolution.busto.atual.toLocaleString('pt-BR') + ' cm' : '—'}
        </div>
        <div class="kpi">
          <b>Abdômen Atual:</b> ${evolution.abdomen.atual !== null ? evolution.abdomen.atual.toLocaleString('pt-BR') + ' cm' : '—'}
        </div>
        <div class="kpi">
          <b>Culote Atual:</b> ${evolution.culote.atual !== null ? evolution.culote.atual.toLocaleString('pt-BR') + ' cm' : '—'}
        </div>
      </div>
      <div class="kpis">
        <div class="kpi">
          <b>Busto Var:</b> ${evolution.busto.diferenca !== null ? (evolution.busto.diferenca > 0 ? '+' : '') + evolution.busto.diferenca.toLocaleString('pt-BR') + ' cm' : '—'}
        </div>
        <div class="kpi">
          <b>Abdômen Var:</b> ${evolution.abdomen.diferenca !== null ? (evolution.abdomen.diferenca > 0 ? '+' : '') + evolution.abdomen.diferenca.toLocaleString('pt-BR') + ' cm' : '—'}
        </div>
        <div class="kpi">
          <b>Culote Var:</b> ${evolution.culote.diferenca !== null ? (evolution.culote.diferenca > 0 ? '+' : '') + evolution.culote.diferenca.toLocaleString('pt-BR') + ' cm' : '—'}
        </div>
      </div>
    `;
  }
  
  historyHtml += `
    </div>
  `;
  
  document.getElementById('app').innerHTML = formHtml + historyHtml;
  
  // Add save handler
  document.getElementById('mpeso').focus();
  const saveBtn = document.querySelector('#app .btn.p');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const peso = document.getElementById('mpeso').value;
      const busto = document.getElementById('mbusto').value;
      const abdomen = document.getElementById('mabdomen').value;
      const culote = document.getElementById('mculote').value;
      
      if (!peso) {
        showToast('Peso é obrigatório');
        return;
      }
      
      await registerMsr({
        peso: parseFloat(peso),
        busto: busto ? parseFloat(busto) : undefined,
        abdomen: abdomen ? parseFloat(abdomen) : undefined,
        culote: culote ? parseFloat(culote) : undefined
      });
      
      showToast('Medidas salvas com sucesso!');
      setTimeout(() => renderInitialScreen(), 500);
    };
  }
}

/* --- Navigation Handler --- */

/**
 * Handle navigation clicks.
 */
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-a]');
  if (!b) return;
  
  const a = b.dataset.a;
  const v = +b.dataset.v;
  
  if (a === 'dia') {
    state.currentDay = v;
    state.currentExerciseIndex = 0;
    renderInitialScreen();
  } else if (a === 'sem') {
    state.currentDay = v;
    renderInitialScreen();
  } else if (a === 'ant') {
    state.currentExerciseIndex--;
    if (state.currentExerciseIndex < 0) state.currentExerciseIndex = 0;
    renderInitialScreen();
  } else if (a === 'prox') {
    state.currentExerciseIndex++;
    renderInitialScreen();
  } else if (a === 'lista') {
    // Toggle list view - just re-render
    renderInitialScreen();
  } else if (a === 'tela') {
    state.tela = v;
    if (v === 'med') {
      renderMeasurementScreen();
    } else if (v === 'rel') {
      renderReportScreen();
    } else {
      renderInitialScreen();
    }
  }
});

/* --- Show Toast --- */

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

/* --- Start Application --- */

/**
 * Start the application when the page loads.
 */
document.addEventListener('DOMContentLoaded', initApp);