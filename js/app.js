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

/* --- Constants (same as exemplo.html) --- */

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex'];
const CURTO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
const LONGO = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
const INI = new Date(2026, 8, 14);
const MAXS = d => (d === 4 ? 15 : 16);
const dataDe = (s, d) => {
  const x = new Date(INI);
  x.setDate(x.getDate() + (s - 1) * 7 + d);
  return x;
};
const iso = data => `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
const hojeISO = () => iso(new Date());
const fmt = x => `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`;
const brd = i => i.slice(8) + '/' + i.slice(5, 7);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = n => (Math.round(n * 10) / 10).toLocaleString('pt-BR');
const sg = n => (n > 0 ? '+' : n < 0 ? '−' : '') + f1(Math.abs(n));
const VZ = '<div class="meta">Sem séries registradas ainda.</div>';
const ok = x => !!x && x.c !== undefined && x.c !== '' && x.r !== undefined && x.r !== '';

/* --- Application state (mirrors V in exemplo.html) --- */

const state = {
  tela: 'treino', // 'treino' | 'med' | 'rel'
  d: 0,           // day index 0..4 (Seg..Sex)
  s: 1,           // program week 1..16
  e: 0,           // exercise index within the day
  lista: false,   // list view instead of the set card
  md: hojeISO(),  // date selected in the Medidas screen
  m: 'peso'       // metric selected in the report chart
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
    const defs = PLANO[dia].ex;
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
    const definicao = PLANO[dia] && PLANO[dia].ex[parseInt(indiceExercicio, 10)];
    const workout = workoutsByDay[dia];
    if (!definicao || !workout) continue;

    const exercise = exercisesByName.get(definicao[0]);
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
  const diff = Math.floor((new Date(h.getFullYear(), h.getMonth(), h.getDate()) - INI) / 864e5);
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

  state.s = Math.min(16, Math.max(1, s));
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
  return `<div class="tabs">${[['treino', 'Treino'], ['med', 'Medidas'], ['rel', 'Relatório']]
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
  const p = PLANO[dia];
  const mx = MAXS(state.d);
  if (state.s > mx) state.s = mx;

  const n = p.ex.length;
  if (state.e >= n) state.e = n - 1;
  if (state.e < 0) state.e = 0;

  await carregarLogDoDia();

  const dias = CURTO.map((c, i) =>
    `<button data-a="dia" data-v="${i}" class="${i === state.d ? 'on' : ''}"><b>${c}</b><small>${fmt(dataDe(state.s, i))}</small></button>`
  ).join('');

  let corpo = '';
  if (state.lista) {
    corpo = p.ex.map((x, e) => {
      const f = feitas(e);
      const c = f >= x[2];
      return `<button class="li ${c ? 'ok' : ''} ${e === state.e ? 'at' : ''}" data-a="ir" data-v="${e}"><span class="n"><b>${esc(x[0])}</b><small>${esc(x[1])} · meta ${x[3]}–${x[4]}</small></span><span class="st">${c ? '✓ ' : ''}${f}/${x[2]}</span></button>`;
    }).join('');
  } else {
    corpo = await cardEx();
  }

  document.getElementById('app').innerHTML = `<header>${tabs()}
    <div class="dias">${dias}</div>
    <div class="sem"><div class="t">${LONGO[state.d]} · ${esc(p.t)}<small>${fmt(dataDe(state.s, state.d))}</small></div>
      <div class="step"><button data-a="sem" data-v="-1" ${state.s <= 1 ? 'disabled' : ''}>‹</button><span>Semana ${state.s}/${mx}</span><button data-a="sem" data-v="1" ${state.s >= mx ? 'disabled' : ''}>›</button></div></div>
    <div class="bar"><i id="pb"></i></div>
    <div class="res"><span id="rt"></span><span>${statusBtn()}</span></div>
  </header><main>${corpo}</main>
  <nav><div><button data-a="ant" ${state.lista || state.e === 0 ? 'disabled' : ''}>‹ Anterior</button>
  <button class="c" data-a="lista">${state.lista ? 'Voltar' : '☰ ' + (state.e + 1) + '/' + n}</button>
  <button class="p" data-a="prox" ${state.lista || state.e === n - 1 ? 'disabled' : ''}>Próximo ›</button></div></nav>`;

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

  const sub = state.tela === 'med' ? 'Medidas corporais' : 'Relatório de progresso';
  const corpo = state.tela === 'med' ? await telaMed() : await telaRel();

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

    const diff = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - INI) / 864e5);
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

async function telaRel() {
  const R = await registros();
  const measurements = await getAllMeasurementsDesc();
  const serieMed = campo => serieCampo(measurements, campo);

  const vol = R.reduce((a, x) => a + x.v, 0);
  const dias = new Set(R.map(x => x.d + '|' + x.s)).size;
  let plan = 0;
  DIAS.forEach((k, d) => { plan += PLANO[k].ex.reduce((a, x) => a + x[2], 0) * MAXS(d); });

  const pS = serieMed('peso');
  const pAt = pS.length ? pS[pS.length - 1][1] : null;
  const dP = pS.length > 1 ? pAt - pS[0][1] : null;
  const kp = (b, s) => `<div class="kpi"><b>${b}</b><small>${s}</small></div>`;
  const semVol = Array.from({ length: 16 }, (_, i) => R.filter(x => x.s === i + 1).reduce((a, x) => a + x.v, 0));
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

  return `<div class="kpis">${kp(dias, 'treinos feitos')}${kp(R.length + '/' + plan, 'séries feitas')}${kp(Math.round(vol).toLocaleString('pt-BR') + ' kg', 'volume total')}${kp(pAt !== null ? f1(pAt) + ' kg' : '—', dP !== null ? sg(dP) + ' kg desde o início' : 'peso atual')}</div>
  <div class="card sec"><h2>Volume por semana</h2><div class="sub">Carga × repetições de todas as séries. A semana mais recente está destacada.</div>${barras(semVol, at)}</div>
  <div class="card sec"><h2>Evolução das medidas</h2><select class="sel" data-k="metrica" style="margin:8px 0 12px">${opts}</select>${linha(serieMed(state.m).map(x => [brd(x[0]), x[1]]))}
  ${linhas ? `<table class="tb" style="margin-top:12px"><tr><th>Medida</th><th>Início</th><th>Atual</th><th>Variação</th></tr>${linhas}</table>` : ''}</div>
  <div class="card sec"><h2>Progressão por exercício</h2><div class="sub">Maior carga de cada semana, somando os dias em que o exercício aparece. A linha mostra a tendência.</div>${lista || VZ}</div>
  <div class="card sec"><h2>Séries por grupo muscular</h2><div class="sub">Quantas séries você já fez em cada grupo.</div>${grupos || VZ}</div>
  <div class="card sec"><h2>Backup e importação</h2><div class="sub">Baixe um backup do que está neste aparelho, importe um backup .json gerado por este app ou importe os dados preenchidos no exemplo (.json/.html).</div>
    <div class="acoes"><button class="btn" data-a="backup">Baixar backup</button><button class="btn p" data-a="importar-backup">Importar backup</button></div>
    <div class="acoes"><button class="btn" data-a="importar-exemplo">Importar dados do exemplo</button></div>
    <input type="file" id="arquivoBackup" accept=".json,application/json" style="display:none">
    <input type="file" id="arquivoExemplo" accept=".json,.html,.htm,application/json,text/html" style="display:none">
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

document.addEventListener('input', async ev => {
  const el = ev.target;
  const k = el.dataset.k;
  if (!k) return;

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
