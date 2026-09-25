/**
 * Application Main Module - UI flow (ported from exemplo.html) over IndexedDB.
 *
 * The screen layout, state model and interactions mirror the reference app in
 * exemplo.html; persistence lives in IndexedDB, so every screen renders from
 * async reads and every edit is written through a serial queue.
 */

import {
  initDB,
  saveExercise,
  saveWorkout,
  getAllExercises,
  getAllWorkouts,
  getExecutionsByDate,
  upsertExecution,
  deleteExecution,
  saveSetting,
  getSetting
} from './db.js';
import { initializeWorkoutExercisesFromPlano } from './workout-service.js';
import {
  MED,
  num,
  saveMeasurements,
  getMeasurementDay,
  getAllMeasurementsDesc
} from './measurement-service.js';
import { getAllExecutions } from './report-service.js';
import { exportBackup, importBackup, downloadBackup } from './backup-service.js';
import { PLANO } from './plano.js';
import {
  rotinaPadrao,
  getRotina,
  salvarRotina,
  totalSemanas,
  fimRotina,
  segundaDe,
  dataParaDate,
  diaAtivo,
  defsDoDia,
  nomeDoDia,
  sincronizarCatalogo
} from './rotina-service.js';

import {
  TIPOS_CARDIO,
  adicionarCardio,
  getCardiosByDate,
  getAllCardios,
  deleteCardio
} from './cardio-service.js';

import {
  getRefeicoes,
  criarRefeicao,
  renomearRefeicao,
  removerRefeicao,
  getMeta,
  salvarMeta,
  adicionarItem,
  removerItem,
  buscarAlimento,
  salvarReferencia,
  getCatalogo,
  resumoDoDia,
  historicoCalorias,
  distribuicaoRefeicao,
  alimentosFrequentes,
  treinoVsDescanso
} from './food-service.js';

/* --- Constants (same as exemplo.html) --- */

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex'];
const CURTO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
const LONGO = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

/* The active routine replaces the old fixed PLANO/INI/MAXS constants. */
let rotina = null;
let rotinaRascunho = null;

const iniDate = () => dataParaDate((rotina && rotina.inicio) || '2026-09-14');
const semanas = () => totalSemanas(rotina || rotinaPadrao());
const MAXS = d => {
  const s = semanas();
  return rotina && rotina.origem === 'plano' && d === 4 ? Math.max(1, s - 1) : s;
};
const dataDe = (s, d) => {
  const x = iniDate();
  x.setDate(x.getDate() + (s - 1) * 7 + d);
  return x;
};
const iso = data => `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
const hojeISO = () => iso(new Date());
const fmt = x => `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`;
const brd = i => i.slice(8) + '/' + i.slice(5, 7);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = n => (Math.round(n * 10) / 10).toLocaleString('pt-BR');
const r1n = n => Math.round(Number(n) * 10) / 10;
const sg = n => (n > 0 ? '+' : n < 0 ? '−' : '') + f1(Math.abs(n));
const VZ = '<div class="meta">Sem séries registradas ainda.</div>';
const ok = x => !!x && x.c !== undefined && x.c !== '' && x.r !== undefined && x.r !== '';

/* --- Application state (mirrors V in exemplo.html) --- */

const state = {
  tela: 'treino', // 'treino' | 'rotina' | 'med' | 'alim' | 'rel'
  d: 0,           // day index 0..4 (Seg..Sex)
  s: 1,           // program week 1..MAXS
  e: 0,           // exercise index within the day
  lista: false,   // list view instead of the set card
  md: hojeISO(),  // date selected in the Medidas screen
  alim: hojeISO(),// date selected in the Alimentação screen
  m: 'peso',      // metric selected in the report chart
  p: 30           // period (days) of the food reports
};

let exercisesById = new Map();
let catalogo = {};  // day -> { workout, ids, defs }
let notas = {};     // 'dia|semana|indiceExercicio' -> texto
let logAtual = {};  // 'exercicioId|serie' -> { c, r, q, f }
let medDraft = {};  // measurement record being edited for state.md
let fila = Promise.resolve();

/* --- Write queue (serializes IndexedDB writes) --- */

function gravar(fn) {
  fila = fila.then(() => fn()).catch(err => console.error('Erro ao gravar:', err));
  return fila;
}

function aguardarGravacoes() {
  return fila;
}

/* --- Toast --- */

function aviso(m) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(aviso.h);
  aviso.h = setTimeout(() => t.classList.remove('show'), 2600);
}

const showToast = aviso;

/* --- Initialization --- */

async function initApp() {
  try {
    await initDB();
    rotina = await getRotina();
    await sincronizarCatalogo(rotina);
    await seedFromPlano();
    notas = (await getSetting('notas')) || {};
    await migrateFromLocalStorage();
    await loadCatalogo();
    posicaoInicial();
    await carregarLogDoDia();
    state.e = primeiroAberto();
    await render();
    showToast('Aplicação inicializada com sucesso');
  } catch (err) {
    console.error('Erro ao inicializar aplicação:', err);
    showToast('Erro ao iniciar aplicação');
  }
}

/* --- Seed from PLANO --- */

function extractExercisesFromPlano() {
  const exercises = [];
  const seen = new Set();

  for (const dia of Object.keys(PLANO)) {
    for (const ex of PLANO[dia].ex) {
      if (seen.has(ex[0])) continue;
      seen.add(ex[0]);
      exercises.push(ex);
    }
  }

  return exercises;
}

/**
 * Make sure every exercise/workout referenced by PLANO exists and that every
 * workout has its exercise links. Safe to call on every startup.
 * @returns {Promise<void>}
 */
async function seedFromPlano() {
  const exercises = await getAllExercises();
  const names = new Set(exercises.map(e => e.nome));

  for (const ex of extractExercisesFromPlano()) {
    if (names.has(ex[0])) continue;
    await saveExercise({
      nome: ex[0],
      grupoMuscular: ex[1],
      descricao: '',
      videoUrl: '',
      ativo: true
    });
  }

  const workouts = await getAllWorkouts();
  const days = new Set(workouts.map(w => w.diaSemana));

  for (const dia of DIAS) {
    if (days.has(dia)) continue;
    await saveWorkout({
      nome: PLANO[dia].t,
      diaSemana: dia,
      ordem: 1,
      ativo: true
    });
  }

  await initializeWorkoutExercisesFromPlano(PLANO);
}

/* --- Catalog (PLANO definitions + database ids per day) --- */

async function loadCatalogo() {
  const exercises = await getAllExercises();
  const workouts = await getAllWorkouts();
  exercisesById = new Map(exercises.map(e => [e.id, e]));
  const byName = new Map(exercises.map(e => [e.nome, e]));

  catalogo = {};
  for (const dia of DIAS) {
    const defs = defsDoDia(rotina, dia).map(e => [e.nome, e.grupo, e.series, e.min, e.max]);
    const workout = workouts.find(w => w.diaSemana === dia) || null;
    const ids = defs.map(def => {
      const exercise = byName.get(def[0]);
      return exercise ? exercise.id : null;
    });
    catalogo[dia] = { workout, ids, defs };
  }
}

function defsAtuais() {
  return (catalogo[DIAS[state.d]] || {}).defs || [];
}

function idsAtuais() {
  return (catalogo[DIAS[state.d]] || {}).ids || [];
}

function treinoAtual() {
  return (catalogo[DIAS[state.d]] || {}).workout;
}

/* --- Data Migration from old localStorage format --- */

// Old single-file app stored everything in localStorage under 'treino2026':
// - log keys: "dia|semana|indiceExercicio|indiceSerie" -> { c, r, q, f }
// - notas keys: "dia|semana|indiceExercicio|n" -> texto
// - med keys: "YYYY-MM-DD" -> { peso, gord, ..., abd, ..., pesc }
const OLD_STORE_KEY = 'treino2026';
const OLD_DIAS = ['seg', 'ter', 'qua', 'qui', 'sex'];
const OLD_INI = new Date(2026, 8, 14); // Program start: 14/09/2026
const MIGRATION_FLAG = 'migrated_localstorage_v2';

function oldLogKeyToDate(dia, semana) {
  const dayIndex = Math.max(OLD_DIAS.indexOf(dia), 0);
  const date = new Date(OLD_INI);
  date.setDate(date.getDate() + (semana - 1) * 7 + dayIndex);
  return date;
}

/**
 * Import one generation of old data into IndexedDB (used by both the
 * localStorage migration and the data embedded in exemplo.html).
 *
 * - log keys: "dia|semana|indiceExercicio|indiceSerie" -> { c, r, q, f }
 * - notas keys: "dia|semana|indiceExercicio|n" -> texto
 * - med keys: "YYYY-MM-DD" -> { peso, gord, ..., abd, ..., pesc }
 *
 * Executions are upserted by their natural key, so running twice never
 * duplicates rows.
 *
 * @param {Object} log
 * @param {Object} med
 * @param {Object} notasAntigas
 * @returns {Promise<{series: number, medidas: number}>}
 */
async function importarDadosAntigos(log, med, notasAntigas) {
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
    const configurados = (rotina && rotina.treinos && rotina.treinos[dia] && rotina.treinos[dia].ex) || [];
    const definicao = configurados[idx] || (PLANO[dia] && PLANO[dia].ex[idx]);
    const workout = workoutsByDay[dia];
    if (!definicao || !workout) continue;

    const nomeExercicio = definicao.nome !== undefined ? definicao.nome : definicao[0];
    const exercise = exercisesByName.get(nomeExercicio);
    if (!exercise) continue;

    const carga = num(entry.c);
    const repeticoes = num(entry.r);
    const rir = num(entry.q);
    const falha = !!entry.f;
    if (carga === null && repeticoes === null && rir === null && !falha) continue;

    await upsertExecution({
      data: iso(oldLogKeyToDate(dia, parseInt(semana, 10))),
      treinoId: workout.id,
      exercicioId: exercise.id,
      serie: (parseInt(indiceSerie, 10) || 0) + 1,
      carga,
      repeticoes,
      rir,
      falha,
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
    notas = { ...convertidas, ...notas };
    await saveSetting('notas', notas);
  }

  return { series, medidas };
}

/**
 * Migrate old localStorage data to IndexedDB.
 * Runs once (guarded by a setting) and never blocks startup.
 * @returns {Promise<void>}
 */
async function migrateFromLocalStorage() {
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

/* --- Manual file import (Relatório screen) --- */

/**
 * Read the picked file as JSON. Also accepts an HTML file with the embedded
 * <script id="dados"> JSON used by exemplo.html.
 * @param {string} texto
 * @returns {Object}
 */
function extrairJson(texto) {
  const embutido = texto.match(/<script[^>]*id="dados"[^>]*>([\s\S]*?)<\/script>/);
  return JSON.parse(embutido ? embutido[1] : texto);
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
async function importarArquivo(file, tipo) {
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
async function atualizarAposImportacao() {
  notas = (await getSetting('notas')) || notas;

  const rotinaAntes = rotina && rotina.atualizadaEm;
  rotina = await getRotina();
  rotinaRascunho = null;
  if (rotinaAntes !== rotina.atualizadaEm) {
    await sincronizarCatalogo(rotina);
    posicaoInicial();
  }

  await loadCatalogo();
  await carregarLogDoDia();
  await render();
}

document.addEventListener('change', async ev => {
  const el = ev.target;
  const tipo = el && el.id === 'arquivoBackup' ? 'backup'
    : el && el.id === 'arquivoExemplo' ? 'exemplo'
      : null;
  if (!tipo) return;

  const file = el.files && el.files[0];
  el.value = '';
  if (!file) return;

  try {
    aviso(await importarArquivo(file, tipo));
  } catch (err) {
    console.error('Erro ao importar arquivo:', err);
    aviso('Erro ao importar: ' + err.message);
  }
});

/* --- Position: current week and day of the program --- */

function posicaoInicial() {
  const h = new Date();
  const diff = Math.floor((new Date(h.getFullYear(), h.getMonth(), h.getDate()) - iniDate()) / 864e5);
  let s = Math.floor(diff / 7) + 1;
  const dw = h.getDay();

  if (diff < 0) {
    s = 1;
    state.d = 0;
  } else if (dw === 0 || dw === 6) {
    s += 1;
    state.d = 0;
  } else {
    state.d = dw - 1;
  }

  state.s = Math.min(semanas(), Math.max(1, s));
}

/* --- Day log (executions of the selected day/week in memory) --- */

function entradaDe(exec) {
  if (!exec) return {};
  return {
    c: exec.carga === null || exec.carga === undefined ? '' : String(exec.carga).replace('.', ','),
    r: exec.repeticoes === null || exec.repeticoes === undefined ? '' : String(exec.repeticoes),
    q: exec.rir === null || exec.rir === undefined ? '' : String(exec.rir).replace('.', ','),
    f: !!exec.falha
  };
}

async function carregarLogDoDia() {
  const ids = new Set(idsAtuais().filter(id => id !== null));
  const data = iso(dataDe(state.s, state.d));
  const execs = await getExecutionsByDate(data);
  const novo = {};

  for (const exec of execs) {
    if (!ids.has(exec.exercicioId)) continue;
    novo[`${exec.exercicioId}|${exec.serie}`] = entradaDe(exec);
  }

  logAtual = novo;
}

function gDe(exercicioId, serie) {
  const key = `${exercicioId}|${serie}`;
  if (!logAtual[key]) logAtual[key] = { c: '', r: '', q: '', f: false };
  return logAtual[key];
}

function notaKey() {
  return `${DIAS[state.d]}|${state.s}|${state.e}`;
}

function feitas(e) {
  const ids = idsAtuais();
  const defs = defsAtuais();
  const id = ids[e];
  if (id === null || id === undefined) return 0;

  const n = defs[e][2];
  let c = 0;
  for (let i = 0; i < n; i++) if (ok(logAtual[`${id}|${i + 1}`])) c++;
  return c;
}

function primeiroAberto() {
  const ex = defsAtuais();
  for (let e = 0; e < ex.length; e++) if (feitas(e) < ex[e][2]) return e;
  return 0;
}

/**
 * Reference of the last week with data for this exercise (like exemplo.html).
 * @returns {Promise<Object|null>} { w, r }
 */
async function ultimo(d, s, e) {
  const dia = DIAS[d];
  const id = (catalogo[dia] || {}).ids[e];
  if (id === null || id === undefined) return null;

  const n = catalogo[dia].defs[e][2];

  for (let w = s - 1; w >= 1; w--) {
    const execs = await getExecutionsByDate(iso(dataDe(w, d)));
    const porSerie = {};
    for (const exec of execs) {
      if (exec.exercicioId === id) porSerie[exec.serie] = exec;
    }

    const r = [];
    for (let i = 0; i < n; i++) r.push(entradaDe(porSerie[i + 1]));
    if (r.some(ok)) return { w, r };
  }

  return null;
}

function totais() {
  const defs = defsAtuais();
  const ids = idsAtuais();
  let t = 0, f = 0, vol = 0;

  defs.forEach((x, e) => {
    t += x[2];
    for (let i = 0; i < x[2]; i++) {
      const id = ids[e];
      const g = id === null || id === undefined ? null : logAtual[`${id}|${i + 1}`];
      if (ok(g)) {
        f++;
        vol += (num(g.c) || 0) * (num(g.r) || 0);
      }
    }
  });

  return { t, f, vol };
}

/* --- Saving a single set --- */

function salvarSerie(serie) {
  const id = idsAtuais()[state.e];
  const workout = treinoAtual();
  const g = id === null || id === undefined ? null : logAtual[`${id}|${serie}`];
  if (!g || !workout) return;

  const data = iso(dataDe(state.s, state.d));

  if (!g.c && !g.r && !g.q && !g.f) {
    gravar(() => deleteExecution(data, workout.id, id, serie));
    return;
  }

  const record = {
    data,
    treinoId: workout.id,
    exercicioId: id,
    serie,
    carga: num(g.c),
    repeticoes: num(g.r),
    rir: num(g.q),
    falha: !!g.f
  };

  gravar(() => upsertExecution(record));
}

/* --- Render --- */

function tabs() {
  return `<div class="tabs">${[['treino', 'Treino'], ['rotina', 'Rotina'], ['med', 'Medidas'], ['alim', 'Alim.'], ['rel', 'Relatório']]
    .map(t => `<button data-a="tela" data-t="${t[0]}" class="${state.tela === t[0] ? 'on' : ''}">${t[1]}</button>`)
    .join('')}</div>`;
}

function statusBtn() {
  return `<button data-a="backup" style="all:unset;cursor:pointer" title="Baixar backup JSON"><i class="dot"></i><u>salvo no aparelho</u></button>`;
}

async function render() {
  await aguardarGravacoes();

  if (state.tela !== 'treino') return renderOutra();

  const dia = DIAS[state.d];
  const mx = MAXS(state.d);
  if (state.s > mx) state.s = mx;

  const ativo = diaAtivo(rotina, dia);
  const n = ativo ? defsAtuais().length : 0;
  if (state.e >= n) state.e = n - 1;
  if (state.e < 0) state.e = 0;

  await carregarLogDoDia();

  const dias = CURTO.map((c, i) => {
    const on = diaAtivo(rotina, DIAS[i]);
    return `<button data-a="dia" data-v="${i}" class="${i === state.d ? 'on' : ''}" ${on ? '' : 'style="opacity:.55"'}><b>${c}</b><small>${fmt(dataDe(state.s, i))}</small></button>`;
  }).join('');

  let corpo = '';
  if (!ativo) {
    corpo = `<div class="card"><span class="grp">Descanso</span><h1>Dia sem treino</h1>
      <div class="meta">Sua rotina não prevê treino em ${LONGO[state.d].toLowerCase()}. Registre o cardio abaixo se quiser.</div>
      <div class="acoes"><button class="btn" data-a="tela" data-t="rotina">Editar minha rotina</button></div></div>`;
  } else if (state.lista) {
    corpo = defsAtuais().map((x, e) => {
      const f = feitas(e);
      const c = f >= x[2];
      return `<button class="li ${c ? 'ok' : ''} ${e === state.e ? 'at' : ''}" data-a="ir" data-v="${e}"><span class="n"><b>${esc(x[0])}</b><small>${esc(x[1])} · meta ${x[3]}–${x[4]}</small></span><span class="st">${c ? '✓ ' : ''}${f}/${x[2]}</span></button>`;
    }).join('');
  } else {
    corpo = await cardEx();
  }

  const cardio = await cardCardio();

  document.getElementById('app').innerHTML = `<header>${tabs()}
    <div class="dias">${dias}</div>
    <div class="sem"><div class="t">${LONGO[state.d]}${nomeDoDia(rotina, dia) && nomeDoDia(rotina, dia) !== LONGO[state.d] ? ' · ' + esc(nomeDoDia(rotina, dia)) : ''}<small>${fmt(dataDe(state.s, state.d))}</small></div>
      <div class="step"><button data-a="sem" data-v="-1" ${state.s <= 1 ? 'disabled' : ''}>‹</button><span>Semana ${state.s}/${mx}</span><button data-a="sem" data-v="1" ${state.s >= mx ? 'disabled' : ''}>›</button></div></div>
    <div class="bar"><i id="pb"></i></div>
    <div class="res"><span id="rt"></span><span>${statusBtn()}</span></div>
  </header><main>${corpo}${cardio}</main>
  <nav><div><button data-a="ant" ${state.lista || n === 0 || state.e === 0 ? 'disabled' : ''}>‹ Anterior</button>
  <button class="c" data-a="lista" ${n === 0 ? 'disabled' : ''}>${state.lista ? 'Voltar' : n === 0 ? 'Descanso' : '☰ ' + (state.e + 1) + '/' + n}</button>
  <button class="p" data-a="prox" ${state.lista || n === 0 || state.e === n - 1 ? 'disabled' : ''}>Próximo ›</button></div></nav>`;

  resumo();
}

async function cardEx() {
  const dia = DIAS[state.d];
  const [nome, grp, ns, mn, mxr] = catalogo[dia].defs[state.e];
  const id = catalogo[dia].ids[state.e];
  const u = await ultimo(state.d, state.s, state.e);

  let ant = '<div class="ant">Sem registro anterior deste exercício.</div>';
  if (u) {
    ant = `<div class="ant">Semana ${u.w}: <b>${u.r.map(g => ok(g) ? `${esc(g.c)}kg × ${esc(g.r)}` : '—').join(' · ')}</b></div>`;
  }

  let sets = '';
  for (let i = 0; i < ns; i++) {
    const g = id === null || id === undefined ? {} : (logAtual[`${id}|${i + 1}`] || {});
    const a = u ? (u.r[i] || {}) : {};
    sets += `<div class="set ${ok(g) ? 'ok' : ''}" data-i="${i}"><div class="n">${i + 1}</div>
    <input data-k="c" inputmode="decimal" value="${esc(g.c)}" placeholder="${esc(a.c)}" aria-label="Carga série ${i + 1}">
    <input data-k="r" inputmode="numeric" value="${esc(g.r)}" placeholder="${esc(a.r)}" aria-label="Repetições série ${i + 1}">
    <input class="q" data-k="q" inputmode="numeric" value="${esc(g.q)}" placeholder="RIR" aria-label="RIR série ${i + 1}">
    <button class="fal ${g.f ? 'on' : ''}" data-a="falha">Falha</button></div>`;
  }

  return `<div class="card"><span class="grp">${esc(grp)}</span><h1>${esc(nome)}</h1>
  <div class="meta">${ns} séries · meta ${mn}–${mxr} repetições</div>${ant}
  <div class="hd"><span></span><span>Carga (kg)</span><span>Reps</span><span>RIR</span><span></span></div>
  ${sets}
  <textarea rows="2" data-k="nota" placeholder="Observações">${esc(notas[notaKey()])}</textarea>
  <div class="acoes">${u ? '<button class="btn" data-a="repetir">Preencher com a semana anterior</button>' : ''}</div></div>`;
}

/* --- Cardio (per day, on the Treino screen) --- */

async function cardCardio() {
  const data = iso(dataDe(state.s, state.d));
  const lista = await getCardiosByDate(data);
  const total = lista.reduce((a, x) => a + (Number(x.minutos) || 0), 0);

  const itens = lista.map(x => `<div class="li"><span class="n"><b>${esc(x.tipo)}</b><small>${f1(Number(x.minutos) || 0)} min</small></span>
    <button class="btn" style="width:40px;height:40px;flex:none" data-a="cremover" data-v="${x.id}" aria-label="Remover cardio">×</button></div>`).join('');

  const tipos = TIPOS_CARDIO.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');

  return `<div class="card sec" style="margin-top:14px"><h2>Cardio</h2>
    <div class="sub">${fmt(dataDe(state.s, state.d))} · ${f1(total)} min neste dia</div>
    ${itens || '<div class="meta">Nenhum cardio registrado neste dia.</div>'}
    <div class="frm" style="margin-top:10px">
      <div><label>Atividade</label><select class="sel" data-k="ctipo" id="cardioTipo" aria-label="Atividade">${tipos}<option value="__outro">Outro…</option></select></div>
      <div><label>Tempo (min)</label><input inputmode="decimal" id="cardioMin" placeholder="ex.: 30" aria-label="Minutos de cardio"></div>
    </div>
    <div id="cardioOutro" style="display:none">
      <label style="font-size:12px;color:var(--mut)">Qual atividade?</label>
      <input class="sel" id="cardioOutroNome" placeholder="ex.: Futebol" aria-label="Nome da atividade">
    </div>
    <div class="acoes"><button class="btn p" data-a="cadicionar">Adicionar cardio</button></div>
  </div>`;
}

function resumo() {
  const t = totais();
  const pb = document.getElementById('pb');
  const rt = document.getElementById('rt');
  if (pb) pb.style.width = (t.t ? (t.f / t.t * 100) : 0) + '%';
  if (rt) rt.textContent = `${t.f}/${t.t} séries · ${Math.round(t.vol).toLocaleString('pt-BR')} kg de volume`;
}

/* --- Medidas and Relatório screens --- */

function serieCampo(measurements, campo) {
  return measurements
    .map(m => [m.data, m[campo] !== undefined && m[campo] !== null ? Number(m[campo]) : null])
    .filter(p => p[1] !== null && !isNaN(p[1]))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

async function renderOutra() {
  await aguardarGravacoes();

  const subs = { rotina: 'Minha rotina de treino', med: 'Medidas corporais', alim: 'Alimentação', rel: 'Relatório de progresso' };
  const sub = subs[state.tela] || '';
  const corpo = state.tela === 'med' ? await telaMed()
    : state.tela === 'alim' ? await telaAlimentacao()
      : state.tela === 'rel' ? await telaRel()
        : telaRotina();

  document.getElementById('app').innerHTML = `<header>${tabs()}
    <div class="res"><span>${sub}</span><span>${statusBtn()}</span></div></header><main>${corpo}</main>`;
}

async function telaMed() {
  const measurements = await getAllMeasurementsDesc();
  const registro = measurements.find(m => m.data === state.md) || {};
  medDraft = { ...registro };

  const campos = MED.map(([k, nome, unid]) => {
    const anteriores = measurements.filter(m => m.data < state.md && m[k] !== null && m[k] !== undefined);
    const ult = anteriores.length ? anteriores[anteriores.length - 1] : null;
    const valor = registro[k] !== null && registro[k] !== undefined ? String(registro[k]).replace('.', ',') : '';
    return `<div><label>${nome} (${unid})</label><input data-k="m:${k}" inputmode="decimal" value="${esc(valor)}" placeholder="${ult ? f1(ult[k]) : ''}"></div>`;
  }).join('');

  const hist = measurements.slice(0, 12).map(m => {
    const peso = m.peso !== null && m.peso !== undefined ? esc(String(m.peso).replace('.', ',')) + ' kg' : '—';
    const preenchidos = MED.filter(([k]) => m[k] !== null && m[k] !== undefined).length;
    return `<tr data-a="mdia" data-d="${m.data}" style="cursor:pointer"><td>${brd(m.data)}${m.data === state.md ? ' ●' : ''}</td><td>${peso}</td><td>${preenchidos} campos</td></tr>`;
  }).join('');

  return `<div class="card sec"><h2>Registrar medidas</h2><div class="sub">Peso quando quiser; as demais medidas, uma vez por semana. O número em cinza é o último valor registrado.</div>
  <input type="date" class="sel" data-k="mdata" value="${state.md}" style="margin-bottom:12px"><div class="frm">${campos}</div></div>
  <div class="card sec"><h2>Histórico</h2>${hist ? `<table class="tb"><tr><th>Data</th><th>Peso</th><th>Preenchido</th></tr>${hist}</table>` : '<div class="meta">Nada registrado ainda.</div>'}</div>`;
}

/* --- Alimentação screen --- */

function refeicaoSugerida(refeicoes) {
  const h = new Date().getHours();
  const esperado = h < 10 ? 'cafe' : h < 14 ? 'almoco' : h < 18 ? 'lanche' : 'janta';
  return refeicoes.some(r => r.id === esperado) ? esperado : (refeicoes[0] && refeicoes[0].id);
}

/**
 * Keep the calorie field in sync with the grams when the food has a calorie
 * reference per 100 g (kcal100). With a reference the field is read-only:
 * calories always come from the conversion.
 * @param {boolean} prefill - also pre-fill empty grams with the last ones used
 */
async function atualizarAlimAuto(prefill) {
  const nomeEl = document.getElementById('alimNome');
  const gEl = document.getElementById('alimG');
  const kEl = document.getElementById('alimK');
  const hint = document.getElementById('alimHint');
  if (!nomeEl || !gEl || !kEl) return;

  const f = await buscarAlimento(nomeEl.value);
  const temRef = !!(f && f.kcal100);
  kEl.readOnly = temRef;

  if (!temRef) {
    if (hint) {
      hint.textContent = f
        ? 'Este alimento ainda não tem referência por 100 g — informe as calorias.'
        : 'Informe as gramas e as calorias deste alimento.';
    }
    return;
  }

  let g = Number(String(gEl.value || '').replace(',', '.'));
  if (prefill && !(g > 0) && f.ultimoGramas) {
    g = Number(f.ultimoGramas);
    gEl.value = String(f.ultimoGramas).replace('.', ',');
  }

  if (g > 0) {
    kEl.value = String(r1n(g * f.kcal100 / 100)).replace('.', ',');
    hint.textContent = `${f.exibicao}: ${f1(f.kcal100)} kcal por 100 g · ${f1(g)} g → ${f1(Number(String(kEl.value).replace(',', '.')) || 0)} kcal`;
  } else {
    kEl.value = '';
    hint.textContent = `${f.exibicao}: ${f1(f.kcal100)} kcal por 100 g · digite as gramas`;
  }
}

async function telaAlimentacao() {
  const data = state.alim;
  const [resumo, refeicoes, catalogo] = await Promise.all([
    resumoDoDia(data),
    getRefeicoes(),
    getCatalogo()
  ]);

  const meta = resumo.meta;
  const excedeu = meta !== null && resumo.total > meta;
  const falta = meta === null ? null : meta - resumo.total;
  const pct = meta ? Math.min(100, resumo.total / meta * 100) : 0;
  const kp = (b, s) => `<div class="kpi"><b>${b}</b><small>${s}</small></div>`;

  const terceiro = falta === null
    ? kp('—', 'defina uma meta diária')
    : falta >= 0
      ? kp(f1(falta) + ' kcal', 'faltam para a meta')
      : kp(f1(-falta) + ' kcal', 'acima da meta');

  const maxRef = Math.max(1, ...resumo.porRefeicao.map(r => r.total));
  const porRef = resumo.porRefeicao.map(r => `<div class="hbar" style="grid-template-columns:96px 1fr 68px">
    <span>${esc(r.nome)}</span><span><i style="width:${(r.total / maxRef * 100).toFixed(0)}%;background:${r.total ? 'var(--ac)' : 'var(--line)'}"></i></span>
    <span style="white-space:nowrap">${f1(r.total)} kcal</span></div>`).join('');

  const opts = refeicoes.map(r => `<option value="${r.id}">${esc(r.nome)}</option>`).join('');
  const sugerida = refeicaoSugerida(refeicoes);
  const chips = catalogo.slice(0, 12).map(f => {
    const g = f.ultimoGramas === null || f.ultimoGramas === undefined ? '' : String(f.ultimoGramas).replace('.', ',');
    const c = f.ultimoCalorias === null || f.ultimoCalorias === undefined ? '' : String(f.ultimoCalorias).replace('.', ',');
    return `<button class="grp" data-a="alimchip" data-n="${esc(f.exibicao)}" data-g="${esc(g)}" data-c="${esc(c)}" style="border:0;cursor:pointer;margin:0 6px 6px 0;font:inherit">${esc(f.exibicao)}</button>`;
  }).join('');

  const grupos = resumo.porRefeicao.map(r => {
    const itens = r.itens.map(i => `<div class="li"><span class="n"><b>${esc(i.alimento)}</b><small>${i.gramas !== null && i.gramas !== undefined ? f1(i.gramas) + ' g · ' : ''}${f1(i.calorias)} kcal</small></span>
      <button class="btn" style="width:40px;height:40px;flex:none" data-a="iremoveralim" data-v="${i.id}" aria-label="Remover item">×</button></div>`).join('');
    return `<div class="sub" style="margin-top:12px"><b>${esc(r.nome)}</b> · ${f1(r.total)} kcal</div>${itens || '<div class="meta">Nada registrado.</div>'}`;
  }).join('');

  const gerenciar = refeicoes.map(r => `<div class="li" style="padding:8px 10px">
    <input class="sel" data-k="alimrefnome" data-v="${r.id}" value="${esc(r.nome)}" style="flex:1;height:40px;text-align:left" aria-label="Nome da refeição ${esc(r.nome)}">
    <button class="btn" style="width:40px;height:40px;flex:none" data-a="alimrefdel" data-v="${r.id}" aria-label="Remover refeição ${esc(r.nome)}">×</button></div>`).join('');

  const refsLista = catalogo.map(f => `<div class="li" style="padding:8px 10px">
    <span class="n"><b>${esc(f.exibicao)}</b><small>${f.vezes || 0} registro${(f.vezes || 0) === 1 ? '' : 's'}</small></span>
    <input class="sel" data-k="alkcal" data-n="${esc(f.nome)}" inputmode="decimal" value="${f.kcal100 === null || f.kcal100 === undefined ? '' : String(f.kcal100).replace('.', ',')}" placeholder="?" style="width:88px;flex:none;height:40px;text-align:center" aria-label="Calorias por 100 g de ${esc(f.exibicao)}">
    <span style="font-size:12px;color:var(--mut);white-space:nowrap">kcal/100 g</span></div>`).join('');

  return `<div class="card sec"><h2>Resumo do dia</h2>
    <input type="date" class="sel" data-k="alimdata" value="${data}" style="margin-bottom:12px" aria-label="Data do registro">
    <div class="kpis">${kp(f1(resumo.total), 'kcal no dia')}${kp(meta !== null ? f1(meta) + ' kcal' : '—', 'meta diária')}${terceiro}</div>
    ${meta !== null ? `<div class="bar"><i style="width:${pct.toFixed(0)}%;background:${excedeu ? 'var(--warn)' : 'var(--ok)'}"></i></div>` : ''}
    <div class="frm" style="margin-top:12px"><div><label>Meta diária (kcal)</label><input data-k="alimmeta" inputmode="decimal" value="${meta !== null ? String(meta).replace('.', ',') : ''}" placeholder="ex.: 2200" aria-label="Meta calórica diária"></div></div>
    <div class="sub" style="margin-top:12px">Calorias por refeição</div>${porRef}
  </div>

  <div class="card sec"><h2>Registrar</h2>
    <div class="sub">Com a referência de 100 g, digite só as gramas — as calorias vêm na conversão.</div>
    <div class="frm">
      <div><label>Refeição</label><select class="sel" id="alimRef" aria-label="Refeição">${opts.replace(`value="${sugerida}"`, `value="${sugerida}" selected`)}</select></div>
      <div><label>Alimento</label><input id="alimNome" data-k="alimNome" placeholder="ex.: Frango grelhado" aria-label="Alimento"></div>
      <div><label>Gramas</label><input id="alimG" data-k="alimG" inputmode="decimal" placeholder="ex.: 150" aria-label="Gramas"></div>
      <div><label>Calorias</label><input id="alimK" data-k="alimK" inputmode="decimal" placeholder="ex.: 250" aria-label="Calorias"></div>
    </div>
    <div class="sub" id="alimHint" style="margin-top:8px">Informe as gramas e as calorias deste alimento.</div>
    ${chips ? `<div style="margin-top:10px">${chips}</div>` : ''}
    <div class="acoes"><button class="btn p" data-a="aalim">Adicionar</button></div>
  </div>

  <div class="card sec"><h2>Itens do dia</h2>${grupos}</div>

  <div class="card sec"><h2>Alimentos por 100 g</h2>
    <div class="sub">A referência de calorias a cada 100 g de cada alimento. Salvar um item nunca altera este valor — ele só muda aqui.</div>
    ${refsLista || '<div class="meta">Nenhum alimento no catálogo ainda.</div>'}
    <div class="frm" style="margin-top:8px">
      <div style="grid-column:1/-1"><label>Novo alimento</label><input id="alimAlNovo" placeholder="ex.: Iogurte natural" aria-label="Novo alimento"></div>
      <div><label>Calorias por 100 g</label><input id="alimKcalNovo" inputmode="decimal" placeholder="ex.: 60" aria-label="Calorias por 100 gramas"></div>
    </div>
    <div class="acoes"><button class="btn" data-a="alrefadd">Adicionar alimento</button></div>
  </div>

  <div class="card sec"><h2>Refeições</h2>
    <div class="sub">Renomeie, crie ou remova refeições. Só é possível remover refeições sem itens.</div>
    ${gerenciar}
    <div class="frm" style="margin-top:8px"><div style="grid-column:1/-1"><label>Nova refeição</label><input id="alimRefNovo" placeholder="ex.: Ceia" aria-label="Nova refeição"></div></div>
    <div class="acoes"><button class="btn" data-a="alimrefadd">Adicionar refeição</button></div>
  </div>`;
}

async function registros() {
  const execs = await getAllExecutions();
  const r = [];

  for (const x of execs) {
    const ex = exercisesById.get(x.exercicioId);
    if (!ex) continue;
    if (x.carga === null || x.carga === undefined || x.repeticoes === null || x.repeticoes === undefined) continue;

    const data = String(x.data).slice(0, 10);
    const date = new Date(`${data}T00:00:00`);
    if (isNaN(date.getTime())) continue;

    const diff = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - iniDate()) / 864e5);
    const s = Math.max(1, Math.floor(diff / 7) + 1);
    const dow = date.getDay();
    if (dow < 1 || dow > 5) continue;

    const c = num(x.carga) || 0;
    const rp = num(x.repeticoes) || 0;
    r.push({ d: dow - 1, s, nome: ex.nome, grp: ex.grupoMuscular, c, r: rp, v: c * rp });
  }

  return r;
}

function barras(v, at) {
  const W = 320, H = 110, m = Math.max(...v, 1), bw = W / v.length;
  return `<svg class="gr" viewBox="0 0 ${W} ${H + 16}"><text x="0" y="8">${Math.round(m).toLocaleString('pt-BR')} kg</text>` + v.map((y, i) => {
    const h = y / m * (H - 16);
    return `<rect class="b${i + 1 === at ? ' at' : ''}" x="${i * bw + 2}" y="${H - h}" width="${bw - 4}" height="${Math.max(h, 2)}" rx="3"/><text x="${i * bw + bw / 2}" y="${H + 12}" text-anchor="middle">${i + 1}</text>`;
  }).join('') + '</svg>';
}

function linha(p) {
  if (p.length < 2) return '<div class="meta">Registre ao menos 2 valores desta medida para ver a evolução.</div>';
  const W = 320, H = 110, pad = 28, ys = p.map(x => x[1]), lo = Math.min(...ys), hi = Math.max(...ys), sp = (hi - lo) || 1;
  const X = i => pad + i * (W - pad - 8) / (p.length - 1), Y = y => 10 + (1 - (y - lo) / sp) * (H - 26);
  return `<svg class="gr" viewBox="0 0 ${W} ${H + 8}"><line class="gl" x1="${pad}" x2="${W - 8}" y1="${Y(lo)}" y2="${Y(lo)}"/><line class="gl" x1="${pad}" x2="${W - 8}" y1="${Y(hi)}" y2="${Y(hi)}"/><text x="0" y="${Y(hi) + 3}">${f1(hi)}</text><text x="0" y="${Y(lo) + 3}">${f1(lo)}</text><polyline class="ln" points="${p.map((x, i) => X(i) + ',' + Y(x[1])).join(' ')}"/>` + p.map((x, i) => `<circle class="pt" cx="${X(i)}" cy="${Y(x[1])}" r="3"/>`).join('') + `<text x="${pad}" y="${H + 6}">${p[0][0]}</text><text x="${W - 8}" y="${H + 6}" text-anchor="end">${p[p.length - 1][0]}</text></svg>`;
}

function spark(v) {
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), sp = (hi - lo) || 1;
  return `<svg class="gr" viewBox="0 0 80 24"><polyline class="ln" style="stroke-width:2" points="${v.map((y, i) => (i * 76 / (v.length - 1) + 2) + ',' + (22 - (y - lo) / sp * 20)).join(' ')}"/></svg>`;
}

function barrasData(pts, media) {
  if (!pts.length) return '';
  const W = 320, H = 110, bw = W / pts.length;
  const vals = pts.map(p => Number(p.v) || 0);
  const m = Math.max(...vals, 1);
  const passo = Math.max(1, Math.ceil(pts.length / 7));
  let s = `<svg class="gr" viewBox="0 0 ${W} ${H + 16}"><text x="0" y="8">${Math.round(m).toLocaleString('pt-BR')} kcal</text>`;

  if (media > 0) {
    const y = H - media / m * (H - 16);
    s += `<line class="gl" x1="0" x2="${W}" y1="${y}" y2="${y}" stroke-dasharray="4 3"/><text x="${W}" y="${y - 3}" text-anchor="end">média ${Math.round(media).toLocaleString('pt-BR')}</text>`;
  }

  pts.forEach((p, i) => {
    const h = vals[i] / m * (H - 16);
    s += `<rect class="b${i === pts.length - 1 ? ' at' : ''}" x="${i * bw + 1}" y="${H - h}" width="${Math.max(bw - 2, 1)}" height="${Math.max(h, 2)}" rx="2"/>`;
    if (i % passo === 0) {
      s += `<text x="${i * bw + bw / 2}" y="${H + 12}" text-anchor="middle">${brd(p.data)}</text>`;
    }
  });

  return s + '</svg>';
}

async function cardRelAlimentacao() {
  const dias = state.p;
  const ate = hojeISO();
  const kp = (b, s) => `<div class="kpi"><b>${b}</b><small>${s}</small></div>`;
  const periodo = `<select class="sel" data-k="alimperiodo" aria-label="Período dos relatórios de alimentação" style="margin-bottom:10px">
    ${[7, 30, 90].map(d => `<option value="${d}" ${d === dias ? 'selected' : ''}>Últimos ${d} dias</option>`).join('')}</select>`;

  const [hist, dist, freq, vst, meta] = await Promise.all([
    historicoCalorias(dias, ate),
    distribuicaoRefeicao(dias, ate),
    alimentosFrequentes(dias, ate),
    treinoVsDescanso(dias, ate),
    getMeta()
  ]);

  if (!freq.length) {
    return `<div class="card sec"><h2>Alimentação</h2><div class="sub">Consumo de calorias por dia, por refeição e por alimento.</div>${periodo}
      <div class="meta">Nenhum registro de alimentação no período. Registre na aba Alimentação.</div></div>`;
  }

  const registrados = hist.filter(h => h.total > 0);
  const total = hist.reduce((a, h) => a + h.total, 0);
  const media = total / registrados.length;
  const maior = Math.max(...hist.map(h => h.total));
  const desvio = meta !== null && registrados.length
    ? registrados.reduce((a, h) => a + (h.total - meta), 0) / registrados.length
    : null;

  const linhasDist = dist.filter(d => d.total > 0).map(d => `<div class="hbar" style="grid-template-columns:96px 1fr 92px">
    <span>${esc(d.nome)}</span><span><i style="width:${d.pct}%"></i></span>
    <span style="white-space:nowrap">${d.pct}% · ${f1(d.total)} kcal</span></div>`).join('');

  const linhasFreq = freq.slice(0, 12).map(f => `<tr><td>${esc(f.nome)}</td><td>${f.vezes}</td><td>${f1(f.media)}</td><td>${f1(f.total)}</td></tr>`).join('');

  const kt = vst.treino.media !== null ? f1(vst.treino.media) + ' kcal' : '—';
  const kd = vst.descanso.media !== null ? f1(vst.descanso.media) + ' kcal' : '—';

  return `<div class="card sec"><h2>Alimentação</h2><div class="sub">Consumo de calorias no período. Use o seletor para mudar a janela de todos os cards abaixo.</div>${periodo}
    <div class="kpis">${kp(f1(media) + ' kcal', 'média em dias com registro')}${kp(f1(maior) + ' kcal', 'maior dia do período')}${kp(registrados.length + '/' + dias, 'dias com registro')}${kp(desvio !== null ? sg(desvio) + ' kcal' : '—', desvio !== null ? 'média vs meta' : 'sem meta definida')}</div>
    <div class="meta">${registrados.length} de ${dias} dias com registro · total de ${Math.round(total).toLocaleString('pt-BR')} kcal</div></div>

  <div class="card sec"><h2>Calorias por dia</h2><div class="sub">Cada barra é um dia. A linha tracejada é a média dos dias com registro.</div>${barrasData(hist.map(h => ({ data: h.data, v: h.total })), media)}</div>

  <div class="card sec"><h2>Distribuição por refeição</h2><div class="sub">De onde vêm as calorias do período.</div>${linhasDist || '<div class="meta">Sem dados no período.</div>'}</div>

  <div class="card sec"><h2>Alimentos mais frequentes</h2><div class="sub">O que aparece com mais frequência e quanto de calorias cada uso traz.</div>
    ${freq.length ? `<table class="tb"><tr><th>Alimento</th><th>Vezes</th><th>Média kcal</th><th>Total kcal</th></tr>${linhasFreq}</table>` : '<div class="meta">Sem dados no período.</div>'}</div>

  <div class="card sec"><h2>Treino vs descanso</h2><div class="sub">Média de calorias em dias com e sem séries registradas (somente dias com registro de alimentação).</div>
    <div class="kpis">${kp(kt, 'média em dias de treino · ' + vst.treino.dias + ' dias')}${kp(kd, 'média em dias de descanso · ' + vst.descanso.dias + ' dias')}</div></div>`;
}

async function telaRel() {
  const R = await registros();
  const measurements = await getAllMeasurementsDesc();
  const serieMed = campo => serieCampo(measurements, campo);

  const vol = R.reduce((a, x) => a + x.v, 0);
  const dias = new Set(R.map(x => x.d + '|' + x.s)).size;
  let plan = 0;
  DIAS.forEach((k, d) => { plan += defsDoDia(rotina, k).reduce((a, x) => a + Number(x.series || 0), 0) * MAXS(d); });

  const pS = serieMed('peso');
  const pAt = pS.length ? pS[pS.length - 1][1] : null;
  const dP = pS.length > 1 ? pAt - pS[0][1] : null;
  const kp = (b, s) => `<div class="kpi"><b>${b}</b><small>${s}</small></div>`;
  const semVol = Array.from({ length: semanas() }, (_, i) => R.filter(x => x.s === i + 1).reduce((a, x) => a + x.v, 0));
  const at = Math.max(0, ...R.map(x => x.s));

  const gr = {};
  R.forEach(x => { gr[x.grp] = (gr[x.grp] || 0) + 1; });
  const gl = Object.entries(gr).sort((a, b) => b[1] - a[1]);
  const gm = gl.length ? gl[0][1] : 1;
  const grupos = gl.map(([n, c]) => `<div class="hbar"><span>${esc(n)}</span><span><i style="width:${c / gm * 100}%"></i></span><span>${c}</span></div>`).join('');

  const ex = {};
  R.forEach(x => {
    const o = ex[x.nome] = ex[x.nome] || { w: {}, v: 0, b: 0, br: 0 };
    o.v += x.v;
    o.w[x.s] = Math.max(o.w[x.s] || 0, x.c);
    if (x.c > o.b || (x.c === o.b && x.r > o.br)) { o.b = x.c; o.br = x.r; }
  });
  const lista = Object.entries(ex).sort((a, b) => b[1].v - a[1].v).map(([n, o]) => {
    const ws = Object.keys(o.w).map(Number).sort((a, b) => a - b);
    const cs = ws.map(w => o.w[w]);
    const u = cs[cs.length - 1];
    const d = cs.length > 1 ? u - cs[0] : null;
    const pr = cs.length > 1 && u > Math.max(...cs.slice(0, -1));
    return `<div class="ex"><div><b>${esc(n)}${pr ? '<span class="pr">recorde</span>' : ''}</b><small>melhor série: ${f1(o.b)} kg × ${o.br}${d !== null ? ` · ${sg(d)} kg desde a semana ${ws[0]}` : ''}</small></div>${spark(cs)}</div>`;
  }).join('');

  const linhas = MED.map(([k, n, u]) => {
    const s = serieMed(k);
    if (!s.length) return '';
    const a = s[0][1], b = s[s.length - 1][1];
    return `<tr><td>${n}</td><td>${f1(a)}</td><td>${f1(b)}</td><td>${s.length > 1 ? sg(b - a) + ' ' + u : '—'}</td></tr>`;
  }).join('');

  const opts = MED.map(x => `<option value="${x[0]}" ${x[0] === state.m ? 'selected' : ''}>${x[1]}</option>`).join('');

  const cardios = await getAllCardios();
  const minTotal = cardios.reduce((a, x) => a + (Number(x.minutos) || 0), 0);
  const porSemana = Array.from({ length: semanas() }, () => 0);
  cardios.forEach(c => {
    const d = dataParaDate(c.data);
    const diff = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - iniDate()) / 864e5);
    const s = Math.floor(diff / 7) + 1;
    if (s >= 1 && s <= porSemana.length) porSemana[s - 1] += Number(c.minutos) || 0;
  });
  const maxMin = Math.max(1, ...porSemana);
  const linhasCardio = porSemana
    .map((min, i) => min > 0 ? `<div class="hbar"><span>Semana ${i + 1}</span><span><i style="width:${(min / maxMin * 100).toFixed(0)}%"></i></span><span style="white-space:nowrap">${f1(min)} min</span></div>` : '')
    .join('');
  const histCardio = cardios.slice(0, 10)
    .map(c => `<tr><td>${brd(c.data)}</td><td style="text-align:left">${esc(c.tipo)}</td><td>${f1(Number(c.minutos) || 0)}</td></tr>`)
    .join('');
  const cardioCard = cardios.length
    ? `<div class="card sec"><h2>Cardio</h2><div class="sub">${cardios.length} registros · ${Math.floor(minTotal / 60)}h ${Math.round(minTotal % 60)}min no total</div>${linhasCardio || '<div class="meta">Registros fora do período da rotina atual.</div>'}
      <table class="tb" style="margin-top:10px"><tr><th>Dia</th><th>Atividade</th><th>Min</th></tr>${histCardio}</table></div>`
    : `<div class="card sec"><h2>Cardio</h2><div class="sub">Nenhum cardio registrado ainda. Registre na tela Treino.</div></div>`;

  const alimCards = await cardRelAlimentacao();

  return `<div class="kpis">${kp(dias, 'treinos feitos')}${kp(R.length + '/' + plan, 'séries feitas')}${kp(Math.round(vol).toLocaleString('pt-BR') + ' kg', 'volume total')}${kp(pAt !== null ? f1(pAt) + ' kg' : '—', dP !== null ? sg(dP) + ' kg desde o início' : 'peso atual')}</div>
  <div class="card sec"><h2>Volume por semana</h2><div class="sub">Carga × repetições de todas as séries. A semana mais recente está destacada.</div>${barras(semVol, at)}</div>
  <div class="card sec"><h2>Evolução das medidas</h2><select class="sel" data-k="metrica" style="margin:8px 0 12px">${opts}</select>${linha(serieMed(state.m).map(x => [brd(x[0]), x[1]]))}
  ${linhas ? `<table class="tb" style="margin-top:12px"><tr><th>Medida</th><th>Início</th><th>Atual</th><th>Variação</th></tr>${linhas}</table>` : ''}</div>
  <div class="card sec"><h2>Progressão por exercício</h2><div class="sub">Maior carga de cada semana, somando os dias em que o exercício aparece. A linha mostra a tendência.</div>${lista || VZ}</div>
  <div class="card sec"><h2>Séries por grupo muscular</h2><div class="sub">Quantas séries você já fez em cada grupo.</div>${grupos || VZ}</div>
  ${cardioCard}
  ${alimCards}
  <div class="card sec"><h2>Backup e importação</h2><div class="sub">Baixe um backup do que está neste aparelho, importe um backup .json gerado por este app ou importe os dados preenchidos no exemplo (.json/.html).</div>
    <div class="acoes"><button class="btn" data-a="backup">Baixar backup</button><button class="btn p" data-a="importar-backup">Importar backup</button></div>
    <div class="acoes"><button class="btn" data-a="importar-exemplo">Importar dados do exemplo</button></div>
    <input type="file" id="arquivoBackup" accept=".json,application/json" style="display:none">
    <input type="file" id="arquivoExemplo" accept=".json,.html,.htm,application/json,text/html" style="display:none">
  </div>`;
}

/* --- Rotina screen (personal routine builder) --- */

function rascunhoRotina() {
  if (!rotinaRascunho) rotinaRascunho = JSON.parse(JSON.stringify(rotina || rotinaPadrao()));
  return rotinaRascunho;
}

/** Draft that is being edited: any change makes it a personal routine. */
function editarRotina() {
  const r = rascunhoRotina();
  r.origem = 'personalizada';
  return r;
}

function telaRotina() {
  const r = rascunhoRotina();
  const total = totalSemanas(r);
  const ini = segundaDe(r.inicio);
  const fim = fimRotina(r);

  const durOpts = [['semanas', 'Semanas'], ['meses', 'Meses'], ['ate', 'Até uma data']]
    .map(([v, l]) => `<option value="${v}" ${r.duracao.tipo === v ? 'selected' : ''}>${l}</option>`).join('');

  const durCampo = r.duracao.tipo === 'ate'
    ? `<div><label>Data final</label><input type="date" data-k="rate" value="${esc(r.duracao.ate || '')}"></div>`
    : `<div><label>${r.duracao.tipo === 'meses' ? 'Meses' : 'Semanas'}</label><input inputmode="numeric" data-k="rvalor" value="${esc(String(r.duracao.valor))}"></div>`;

  const dias = `<div class="dias">${DIAS.map((d, i) => `<button data-a="rdia" data-d="${d}" class="${r.dias[d] ? 'on' : ''}"><b>${CURTO[i]}</b><small>${r.dias[d] ? 'treino' : 'livre'}</small></button>`).join('')}</div>`;

  const cards = DIAS.filter(d => r.dias[d]).map(d => cardDiaRotina(r, d)).join('');

  return `<div class="card sec"><h2>Minha rotina</h2>
    <div class="sub">Escolha os dias que treina, quantas séries faz em cada exercício e por quanto tempo vai seguir esta rotina.</div>
    <div class="frm">
      <div><label>Início</label><input type="date" data-k="rinicio" value="${esc(ini)}"></div>
      <div><label>Duração</label><select class="sel" data-k="rtipo">${durOpts}</select></div>
      ${durCampo}
    </div>
    <div class="meta" style="margin-top:10px">${total} semanas · de ${brd(ini)} a ${brd(fim)}</div>
  </div>
  <div class="card sec"><h2>Dias de treino</h2><div class="sub">Marque os dias em que você treina. Os dias livres viram descanso.</div>${dias}</div>
  ${cards || '<div class="card"><div class="meta">Marque pelo menos um dia acima.</div></div>'}
  <div class="acoes"><button class="btn p" data-a="rsalvar">Salvar rotina</button><button class="btn" data-a="rpadrao">Restaurar padrão</button></div>
  <div class="meta" style="margin-top:8px">A semana 1 começa em ${brd(ini)}. Séries já registradas continuam no relatório.</div>`;
}

function cardDiaRotina(r, dia) {
  const i = DIAS.indexOf(dia);
  const t = r.treinos[dia];
  const seriesDia = t.ex.reduce((a, e) => a + (Number(e.series) || 0), 0);

  const jaTem = new Set(t.ex.map(e => e.nome));
  const opcoes = [...exercisesById.values()]
    .filter(e => !jaTem.has(e.nome))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
    .map(e => `<option value="${esc(e.nome)}">${esc(e.nome)}</option>`).join('');

  const linhas = t.ex.map((ex, idx) => `<div class="li" style="flex-direction:column;align-items:stretch;gap:8px">
    <div style="display:flex;gap:8px;align-items:center">
      <span class="n" style="flex:1;min-width:0"><b>${esc(ex.nome)}</b><small>${esc(ex.grupo)}</small></span>
      <button class="btn" style="width:40px;height:40px;flex:none" data-a="rremover" data-d="${dia}" data-i="${idx}" aria-label="Remover ${esc(ex.nome)}">×</button>
    </div>
    <div style="display:flex;gap:8px">
      <label style="flex:1;font-size:11px;color:var(--mut)">Séries<input class="sel" style="width:100%;height:40px;margin-top:4px" inputmode="numeric" data-k="rserie" data-d="${dia}" data-i="${idx}" value="${esc(String(ex.series))}" aria-label="Séries de ${esc(ex.nome)}"></label>
      <label style="flex:1;font-size:11px;color:var(--mut)">Mín<input class="sel" style="width:100%;height:40px;margin-top:4px" inputmode="numeric" data-k="rmin" data-d="${dia}" data-i="${idx}" value="${esc(String(ex.min))}" aria-label="Repetições mínimas de ${esc(ex.nome)}"></label>
      <label style="flex:1;font-size:11px;color:var(--mut)">Máx<input class="sel" style="width:100%;height:40px;margin-top:4px" inputmode="numeric" data-k="rmax" data-d="${dia}" data-i="${idx}" value="${esc(String(ex.max))}" aria-label="Repetições máximas de ${esc(ex.nome)}"></label>
    </div></div>`).join('');

  const titulo = t.t && t.t !== LONGO[i] ? `${LONGO[i]} · ${esc(t.t)}` : LONGO[i];

  return `<div class="card sec"><h2>${titulo}</h2>
    <div class="sub">Séries e meta de repetições (${seriesDia} séries no dia)</div>
    <input class="sel" data-k="rnome" data-d="${dia}" value="${esc(t.t)}" placeholder="Nome do treino" style="margin-bottom:10px" aria-label="Nome do treino ${LONGO[i]}">
    ${linhas || '<div class="meta">Nenhum exercício neste dia.</div>'}
    <div class="acoes"><select class="sel" data-k="radicionar" data-d="${dia}" aria-label="Adicionar exercício"><option value="">Adicionar exercício…</option>${opcoes}</select></div>
    <div class="frm" style="margin-top:8px">
      <div><label>Novo exercício</label><input data-k="rnovo" data-d="${dia}" placeholder="Nome"></div>
      <div><label>Grupo muscular</label><input data-k="rnovogrp" data-d="${dia}" placeholder="ex.: Peito"></div>
    </div>
    <div class="acoes"><button class="btn" data-a="rcriar" data-d="${dia}">Criar e adicionar</button></div>
  </div>`;
}

/* --- Backup download (replaces "gravar no arquivo" from the reference app) --- */

async function baixarBackup() {
  try {
    const result = await exportBackup();
    if (result && result.success) {
      downloadBackup(result);
      aviso('Backup baixado ✓');
    } else {
      aviso('Erro ao gerar backup: ' + (result && result.error ? result.error : ''));
    }
  } catch (err) {
    console.error('Erro ao gerar backup:', err);
    aviso('Erro ao gerar backup');
  }
}

/* --- Interactions --- */

/**
 * Mirror a routine form field into the draft (no re-render, so focus is kept).
 * @param {string} k - data-k of the field
 * @param {HTMLElement} el
 * @returns {boolean} true when the field belongs to the routine form
 */
function campoRotina(k, el) {
  const campos = ['rnome', 'rserie', 'rmin', 'rmax', 'rvalor', 'rinicio', 'rate'];
  if (!campos.includes(k)) return false;

  const r = rotinaRascunho;
  if (!r) return true;

  r.origem = 'personalizada';

  const dia = el.dataset.d;
  const i = +(el.dataset.i || 0);

  if (k === 'rinicio') {
    if (el.value) r.inicio = el.value;
    return true;
  }
  if (k === 'rate') {
    if (el.value) r.duracao.ate = el.value;
    return true;
  }
  if (k === 'rvalor') {
    r.duracao.valor = el.value.replace(',', '.');
    return true;
  }
  if (k === 'rnome') {
    if (r.treinos[dia]) r.treinos[dia].t = el.value;
    return true;
  }

  const ex = r.treinos[dia] && r.treinos[dia].ex[i];
  if (ex) ex[k === 'rserie' ? 'series' : k === 'rmin' ? 'min' : 'max'] = el.value.replace(',', '.');
  return true;
}

document.addEventListener('change', async ev => {
  const el = ev.target;
  const k = el.dataset.k;

  if (k === 'rtipo') {
    const r = editarRotina();
    r.duracao.tipo = el.value;
    if (el.value === 'ate' && !r.duracao.ate) r.duracao.ate = fimRotina(r);
    await render();
    return;
  }

  if (k === 'rinicio' || k === 'rate' || k === 'rvalor') {
    if (rotinaRascunho) await render();
    return;
  }

  if (k === 'radicionar') {
    const dia = el.dataset.d;
    const nome = el.value;
    if (!nome || !rotinaRascunho) return;

    const exercise = [...exercisesById.values()].find(e => e.nome === nome);
    if (!exercise) { aviso('Exercício não encontrado'); return; }

    editarRotina().treinos[dia].ex.push({
      nome: exercise.nome,
      grupo: exercise.grupoMuscular,
      series: 3,
      min: 8,
      max: 12
    });
    await render();
    return;
  }

  if (k === 'ctipo') {
    const outro = document.getElementById('cardioOutro');
    if (outro) outro.style.display = el.value === '__outro' ? '' : 'none';
  }

  if (k === 'alimmeta') {
    try {
      await salvarMeta(el.value);
      await render();
    } catch (err) {
      aviso(err.message);
    }
    return;
  }

  if (k === 'alimrefnome') {
    try {
      await renomearRefeicao(el.dataset.v, el.value);
      await render();
    } catch (err) {
      aviso(err.message);
      await render();
    }
    return;
  }

  if (k === 'alimNome') {
    await atualizarAlimAuto(true);
    return;
  }

  if (k === 'alkcal') {
    try {
      await salvarReferencia(el.dataset.n, el.value);
      aviso('Referência salva ✓');
      await atualizarAlimAuto(false);
    } catch (err) {
      aviso(err.message);
    }
    return;
  }
});

document.addEventListener('input', async ev => {
  const el = ev.target;
  const k = el.dataset.k;
  if (!k) return;

  if (k.startsWith('r') && campoRotina(k, el)) return;

  if (k === 'metrica') {
    state.m = el.value;
    await render();
    return;
  }

  if (k === 'mdata') {
    if (el.value) {
      await aguardarGravacoes();
      state.md = el.value;
      await render();
    }
    return;
  }

  if (k === 'alimdata') {
    if (el.value) {
      await aguardarGravacoes();
      state.alim = el.value;
      await render();
    }
    return;
  }

  if (k === 'alimperiodo') {
    state.p = +el.value;
    await render();
    return;
  }

  if (k === 'alimNome' || k === 'alimG') {
    await atualizarAlimAuto(false);
    return;
  }

  if (k.slice(0, 2) === 'm:') {
    medDraft[k.slice(2)] = el.value.trim();
    const data = state.md;
    const draft = medDraft;
    gravar(() => saveMeasurements(data, draft));
    return;
  }

  if (k === 'nota') {
    notas[notaKey()] = el.value;
    const copia = notas;
    gravar(() => saveSetting('notas', copia));
    return;
  }

  const set = el.closest('.set');
  if (!set) return;

  const i = +set.dataset.i;
  const id = idsAtuais()[state.e];
  if (id === null || id === undefined) return;

  const g = gDe(id, i + 1);
  g[k] = el.value.trim();
  set.classList.toggle('ok', ok(g));
  salvarSerie(i + 1);
  resumo();
});

document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-a]');
  if (!b) return;

  const a = b.dataset.a;
  const v = +b.dataset.v;

  if (a === 'backup') {
    await baixarBackup();
    return;
  }

  await aguardarGravacoes();

  if (a === 'importar-backup') {
    const input = document.getElementById('arquivoBackup');
    if (input) input.click();
    return;
  }

  if (a === 'importar-exemplo') {
    const input = document.getElementById('arquivoExemplo');
    if (input) input.click();
    return;
  }

  if (a === 'rdia') {
    const r = editarRotina();
    r.dias[b.dataset.d] = !r.dias[b.dataset.d];
    await render();
    return;
  }

  if (a === 'rremover') {
    const r = editarRotina();
    const t = r.treinos[b.dataset.d];
    if (t) t.ex.splice(+(b.dataset.i || 0), 1);
    await render();
    return;
  }

  if (a === 'rcriar') {
    const d = b.dataset.d;
    const nomeEl = document.querySelector(`[data-k="rnovo"][data-d="${d}"]`);
    const grpEl = document.querySelector(`[data-k="rnovogrp"][data-d="${d}"]`);
    const nome = ((nomeEl && nomeEl.value) || '').trim();
    if (!nome) { aviso('Informe o nome do exercício'); return; }

    const r = editarRotina();
    if (r.treinos[d].ex.some(e => e.nome.toLowerCase() === nome.toLowerCase())) {
      aviso('Este exercício já está no dia');
      return;
    }
    r.treinos[d].ex.push({
      nome,
      grupo: ((grpEl && grpEl.value) || '').trim() || 'Outros',
      series: 3,
      min: 8,
      max: 12
    });
    await render();
    aviso('Exercício adicionado');
    return;
  }

  if (a === 'rsalvar') {
    try {
      const salva = await salvarRotina(rascunhoRotina());
      rotina = salva;
      rotinaRascunho = null;
      await sincronizarCatalogo(rotina);
      await loadCatalogo();
      posicaoInicial();
      state.e = 0;
      state.lista = false;
      await render();
      aviso('Rotina salva ✓');
    } catch (err) {
      console.error('Erro ao salvar rotina:', err);
      aviso(err.message);
    }
    return;
  }

  if (a === 'rpadrao') {
    rotinaRascunho = JSON.parse(JSON.stringify(rotinaPadrao()));
    await render();
    aviso('Plano padrão carregado — revise e toque em Salvar');
    return;
  }

  if (a === 'cadicionar') {
    const sel = document.getElementById('cardioTipo');
    const outro = document.getElementById('cardioOutroNome');
    const tipo = sel && sel.value !== '__outro' ? sel.value : ((outro && outro.value) || '');
    const minutos = (document.getElementById('cardioMin') || {}).value || '';
    try {
      await adicionarCardio({ data: iso(dataDe(state.s, state.d)), tipo, minutos });
      await render();
      aviso('Cardio registrado ✓');
    } catch (err) {
      console.error('Erro ao registrar cardio:', err);
      aviso(err.message);
    }
    return;
  }

  if (a === 'cremover') {
    await deleteCardio(v);
    await render();
    aviso('Registro removido');
    return;
  }

  if (a === 'aalim') {
    try {
      await adicionarItem({
        data: state.alim,
        refeicaoId: (document.getElementById('alimRef') || {}).value,
        alimento: (document.getElementById('alimNome') || {}).value,
        gramas: (document.getElementById('alimG') || {}).value,
        calorias: (document.getElementById('alimK') || {}).value
      });
      await render();
      aviso('Item registrado ✓');
    } catch (err) {
      console.error('Erro ao registrar item:', err);
      aviso(err.message);
    }
    return;
  }

  if (a === 'alimchip') {
    const nome = document.getElementById('alimNome');
    const gr = document.getElementById('alimG');
    const kc = document.getElementById('alimK');
    if (nome) nome.value = b.dataset.n || '';
    if (gr) gr.value = b.dataset.g || '';
    if (kc) kc.value = b.dataset.c || '';
    await atualizarAlimAuto(false);
    if (gr) gr.focus();
    return;
  }

  if (a === 'iremoveralim') {
    await removerItem(v);
    await render();
    aviso('Item removido');
    return;
  }

  if (a === 'alimrefadd') {
    const refNovo = document.getElementById('alimRefNovo');
    try {
      await criarRefeicao(refNovo && refNovo.value);
      await render();
      aviso('Refeição criada ✓');
    } catch (err) {
      aviso(err.message);
    }
    return;
  }

  if (a === 'alimrefdel') {
    try {
      await removerRefeicao(b.dataset.v);
      await render();
      aviso('Refeição removida');
    } catch (err) {
      aviso(err.message);
    }
    return;
  }

  if (a === 'alrefadd') {
    const alNovo = document.getElementById('alimAlNovo');
    const kcalNovo = document.getElementById('alimKcalNovo');
    try {
      await salvarReferencia(alNovo && alNovo.value, kcalNovo && kcalNovo.value);
      await render();
      aviso('Alimento adicionado ✓');
    } catch (err) {
      aviso(err.message);
    }
    return;
  }

  if (a === 'dia') {
    state.d = v;
    state.s = Math.min(state.s, MAXS(v));
    await carregarLogDoDia();
    state.e = primeiroAberto();
    state.lista = false;
    await render();
    scrollTo(0, 0);
  } else if (a === 'sem') {
    state.s += v;
    await carregarLogDoDia();
    state.e = primeiroAberto();
    await render();
    scrollTo(0, 0);
  } else if (a === 'ant') {
    state.e--;
    await render();
    scrollTo(0, 0);
  } else if (a === 'prox') {
    state.e++;
    await render();
    scrollTo(0, 0);
  } else if (a === 'lista') {
    state.lista = !state.lista;
    await render();
    scrollTo(0, 0);
  } else if (a === 'ir') {
    state.e = v;
    state.lista = false;
    await render();
    scrollTo(0, 0);
  } else if (a === 'falha') {
    const set = b.closest('.set');
    const i = +set.dataset.i;
    const id = idsAtuais()[state.e];
    if (id === null || id === undefined) return;

    const g = gDe(id, i + 1);
    g.f = !g.f;
    b.classList.toggle('on', g.f);
    salvarSerie(i + 1);
  } else if (a === 'repetir') {
    const u = await ultimo(state.d, state.s, state.e);
    if (!u) return;

    const id = idsAtuais()[state.e];
    if (id === null || id === undefined) return;

    const ns = defsAtuais()[state.e][2];
    for (let i = 0; i < ns; i++) {
      const g = gDe(id, i + 1);
      const x = u.r[i] || {};
      if (!ok(g) && ok(x)) {
        g.c = x.c;
        g.r = x.r;
        salvarSerie(i + 1);
      }
    }
    await aguardarGravacoes();
    await render();
    aviso('Preenchido com a semana ' + u.w);
  } else if (a === 'tela') {
    state.tela = b.dataset.t;
    await render();
    scrollTo(0, 0);
  } else if (a === 'mdia') {
    state.md = b.dataset.d;
    await render();
    scrollTo(0, 0);
  }
});

/* --- Start Application --- */

// Module scripts run after the document is parsed, so the DOM is ready
// unless the page is still loading (e.g. dynamically injected module).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

export { initApp, render, baixarBackup };
