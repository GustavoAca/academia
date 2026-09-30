/**
 * Treino screen: day strip, exercise flow (sets, notes, cardio) and the
 * bottom navigation between steps.
 */

import { DIAS, CURTO, LONGO, iso, fmt, esc, f1, ok } from '../core/utils.js';
import { state, store, gravar, aguardarGravacoes } from '../core/estado.js';
import { MAXS, dataDe, defsAtuais, idsAtuais, passos, exAtual } from '../core/programa.js';
import {
  carregarLogDoDia,
  gDe,
  notaKey,
  feitas,
  totais,
  salvarSerie,
  ultimo,
  primeiroPasso
} from '../core/log-dia.js';
import { diaAtivo, nomeDoDia, cardioDoDia } from '../rotina-service.js';
import { saveSetting } from '../db.js';
import {
  TIPOS_CARDIO,
  adicionarCardio,
  getPulados,
  setPulado,
  getCardiosByDate,
  deleteCardio
} from '../cardio-service.js';
import { render, tabs, statusBtn } from '../core/render.js';
import { registrarTela } from '../core/rotas.js';
import { aviso } from '../core/toast.js';

/** Full HTML of the Treino screen (header, body and bottom navigation). */
export async function telaTreino() {
  const dia = DIAS[state.d];
  const mx = MAXS(state.d);
  if (state.s > mx) state.s = mx;

  const ativo = diaAtivo(store.rotina, dia);
  const ps = passos();
  const n = ps.length;
  if (state.e >= n) state.e = n - 1;
  if (state.e < 0) state.e = 0;

  await carregarLogDoDia();

  const dataHoje = iso(dataDe(state.s, state.d));
  const pulados = await getPulados(dataHoje);
  const cardiosDia = await getCardiosByDate(dataHoje);

  const dias = CURTO.map((c, i) => {
    const on = diaAtivo(store.rotina, DIAS[i]);
    return `<button data-a="dia" data-v="${i}" class="${i === state.d ? 'on' : ''}" ${on ? '' : 'style="opacity:.55"'}><b>${c}</b><small>${fmt(dataDe(state.s, i))}</small></button>`;
  }).join('');

  const passoNome = i => {
    const p = ps[i];
    if (!p) return '';
    if (p.k === 'cardio') return p.m === 'i' ? 'Cardio inicial' : 'Cardio final';
    const d = defsAtuais()[p.i];
    return d ? esc(d[0]) : '';
  };

  const statusCardio = m => {
    if (pulados[m]) return { txt: 'pulado', ok: false };
    const total = cardiosDia.filter(x => (x.momento || 'f') === m)
      .reduce((a, x) => a + (Number(x.minutos) || 0), 0);
    return total > 0 ? { txt: f1(total) + ' min', ok: true } : { txt: 'pendente', ok: false };
  };

  const descansoCard = `<div class="card"><span class="grp">Descanso</span><h1>Dia sem treino</h1>
      <div class="meta">Sua rotina não prevê treino em ${LONGO[state.d].toLowerCase()}. Registre o cardio se quiser.</div>
      <div class="acoes"><button class="btn" data-a="tela" data-t="rotina">Editar minha rotina</button></div></div>`;

  const pAtual = ps[state.e] || null;
  const ehCardio = !!(pAtual && pAtual.k === 'cardio');

  let corpo = '';
  if (state.lista && n > 0) {
    corpo = ps.map((p, i) => {
      const at = i === state.e ? 'at' : '';
      if (p.k === 'cardio') {
        const st = statusCardio(p.m);
        return `<button class="li ${st.ok ? 'ok' : ''} ${at}" data-a="ir" data-v="${i}"><span class="n"><b>${p.m === 'i' ? 'Cardio inicial' : 'Cardio final'}</b><small>${p.m === 'i' ? 'antes dos exercícios' : 'depois dos exercícios'}</small></span><span class="st">${st.ok ? '✓ ' : ''}${st.txt}</span></button>`;
      }
      const x = defsAtuais()[p.i];
      const f = feitas(p.i);
      const c = f >= x[2];
      return `<button class="li ${c ? 'ok' : ''} ${at}" data-a="ir" data-v="${i}"><span class="n"><b>${esc(x[0])}</b><small>${esc(x[1])} · meta ${x[3]}–${x[4]}</small></span><span class="st">${c ? '✓ ' : ''}${f}/${x[2]}</span></button>`;
    }).join('');
  } else if (!ativo) {
    corpo = descansoCard + (ehCardio ? await cardPassoCardio(pAtual.m, pulados, cardiosDia) : '');
  } else if (ehCardio) {
    corpo = await cardPassoCardio(pAtual.m, pulados, cardiosDia);
  } else if (pAtual) {
    corpo = await cardEx(pAtual.i);
  } else {
    corpo = descansoCard;
  }

  const nomeRotina = nomeDoDia(store.rotina, dia);

  return `<header>${tabs()}
    <div class="dias">${dias}</div>
    <div class="sem"><div class="t">${LONGO[state.d]}${nomeRotina && nomeRotina !== LONGO[state.d] ? ' · ' + esc(nomeRotina) : ''}<small>${fmt(dataDe(state.s, state.d))}</small></div>
      <div class="step"><button data-a="sem" data-v="-1" ${state.s <= 1 ? 'disabled' : ''}>‹</button><span>Semana ${state.s}/${mx}</span><button data-a="sem" data-v="1" ${state.s >= mx ? 'disabled' : ''}>›</button></div></div>
    <div class="bar"><i id="pb"></i></div>
    <div class="res"><span id="rt"></span><span>${statusBtn()}</span></div>
  </header><main>${corpo}</main>
  <nav><div><button data-a="ant" ${state.lista || n === 0 || state.e === 0 ? 'disabled' : ''}>‹ ${state.e > 0 ? passoNome(state.e - 1) : 'Início'}</button>
  <button class="c" data-a="lista" ${n === 0 ? 'disabled' : ''}>${state.lista ? 'Voltar' : n === 0 ? 'Descanso' : '☰ ' + (state.e + 1) + '/' + n}</button>
  <button class="p" data-a="prox" ${state.lista || n === 0 || state.e === n - 1 ? 'disabled' : ''}>${state.e < n - 1 ? passoNome(state.e + 1) : 'Fim'} ›</button></div></nav>`;
}

/** Card of one exercise: previous reference, set inputs and note. */
async function cardEx(ei) {
  const dia = DIAS[state.d];
  const [nome, grp, ns, mn, mxr] = store.catalogo[dia].defs[ei];
  const id = store.catalogo[dia].ids[ei];
  const u = await ultimo(state.d, state.s, ei);

  let ant = '<div class="ant">Sem registro anterior deste exercício.</div>';
  if (u) {
    ant = `<div class="ant">Semana ${u.w}: <b>${u.r.map(g => ok(g) ? `${esc(g.c)}kg × ${esc(g.r)}` : '—').join(' · ')}</b></div>`;
  }

  let sets = '';
  for (let i = 0; i < ns; i++) {
    const g = id === null || id === undefined ? {} : (store.logAtual[`${id}|${i + 1}`] || {});
    const a = u ? (u.r[i] || {}) : {};
    sets += `<div class="set ${ok(g) ? 'ok' : ''}" data-i="${i}"><div class="n">${i + 1}</div>
    <input data-k="c" inputmode="decimal" value="${esc(g.c)}" placeholder="${esc(a.c)}" aria-label="Carga série ${i + 1}">
    <input data-k="r" inputmode="numeric" value="${esc(g.r)}" placeholder="${esc(a.r)}" aria-label="Repetições série ${i + 1}"></div>`;
  }

  return `<div class="card"><span class="grp">${esc(grp)}</span><h1>${esc(nome)}</h1>
  <div class="meta">${ns} séries · meta ${mn}–${mxr} repetições</div>${ant}
  <div class="hd"><span></span><span>Carga (kg)</span><span>Reps</span></div>
  ${sets}
  <textarea rows="2" data-k="nota" placeholder="Observações">${esc(store.notas[notaKey(ei)] || '')}</textarea>
  <div class="acoes">${u ? '<button class="btn" data-a="repetir">Preencher com a semana anterior</button>' : ''}</div></div>`;
}

/** Card of a cardio step (start/end of the day). */
async function cardPassoCardio(m, pulados, cardiosDia) {
  const slot = m === 'i' ? 'i' : 'f';
  const dia = DIAS[state.d];
  const cfg = cardioDoDia(store.rotina, dia, slot);
  if (!cfg.ativo) return '';

  const rotulo = slot === 'i' ? 'Cardio inicial' : 'Cardio final';

  if (pulados[slot]) {
    return `<div class="card sec" data-cbar="${slot}"><h2>${rotulo}</h2>
      <div class="sub">Pulado neste dia</div>
      <div class="acoes"><button class="btn" data-a="cmostar" data-m="${slot}">Mostrar</button></div>
    </div>`;
  }

  const lista = cardiosDia.filter(x => (x.momento || 'f') === slot);
  const total = lista.reduce((a, x) => a + (Number(x.minutos) || 0), 0);

  const itens = lista.map(x => `<div class="li"><span class="n"><b>${esc(x.tipo)}</b><small>${f1(Number(x.minutos) || 0)} min</small></span>
    <button class="btn" style="width:40px;height:40px;flex:none" data-a="cremover" data-v="${x.id}" aria-label="Remover cardio">×</button></div>`).join('');

  const tipos = TIPOS_CARDIO.map(t => `<option value="${esc(t)}" ${cfg.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('');

  return `<div class="card sec" data-cbar="${slot}"><h2>${rotulo}</h2>
    <div class="sub">${fmt(dataDe(state.s, state.d))} · ${f1(total)} min ${slot === 'i' ? 'antes' : 'depois'} dos exercícios</div>
    ${itens}
    <div class="frm" style="margin-top:10px">
      <div><label>Atividade</label><select class="sel" data-k="ctipo" data-m="${slot}" id="cardioTipo" aria-label="Atividade">${tipos}<option value="__outro">Outro…</option></select></div>
      <div><label>Tempo (min)</label><input inputmode="decimal" id="cardioMin" value="${esc(cfg.min)}" placeholder="ex.: 30" aria-label="Minutos de cardio"></div>
    </div>
    <div id="cardioOutro" style="display:none">
      <label style="font-size:12px;color:var(--mut)">Qual atividade?</label>
      <input class="sel" id="cardioOutroNome" placeholder="ex.: Futebol" aria-label="Nome da atividade">
    </div>
    <div class="acoes"><button class="btn p" data-a="cadicionar" data-m="${slot}">Adicionar cardio</button>
      <button class="btn" data-a="cpular" data-m="${slot}">Pular</button></div>
  </div>`;
}

/** Paint the progress bar and the "x/y séries" line of the header. */
export function resumo() {
  const t = totais();
  const pb = document.getElementById('pb');
  const rt = document.getElementById('rt');
  if (pb) pb.style.width = (t.t ? (t.f / t.t * 100) : 0) + '%';
  if (rt) rt.textContent = `${t.f}/${t.t} séries · ${Math.round(t.vol).toLocaleString('pt-BR')} kg de volume`;
}

/**
 * Move to the previous/next exercise of the day, when there is one.
 * @param {number} delta - -1 previous, +1 next
 * @returns {Promise<void>}
 */
export async function moverEx(delta) {
  if (state.tela !== 'treino' || state.lista) return;
  const n = passos().length;
  const novo = state.e + delta;
  if (novo < 0 || novo >= n) return;
  state.e = novo;
  await render();
  scrollTo(0, 0);
}

/* --- Actions (data-a) and fields (data-k) of this screen --- */

/**
 * Handle one click action of this screen.
 * @param {string} a - data-a value
 * @param {HTMLElement} b - clicked element
 * @returns {Promise<boolean>} true when the action was handled
 */
export async function aoClicar(a, b) {
  if (a === 'cadicionar') {
    const m = b.dataset.m === 'i' ? 'i' : 'f';
    const sel = document.getElementById('cardioTipo');
    const outro = document.getElementById('cardioOutroNome');
    const tipo = sel && sel.value !== '__outro' ? sel.value : ((outro && outro.value) || '');
    const minutos = (document.getElementById('cardioMin') || {}).value || '';
    try {
      await adicionarCardio({ data: iso(dataDe(state.s, state.d)), tipo, minutos, momento: m });
      await render();
      aviso('Cardio registrado ✓');
    } catch (err) {
      console.error('Erro ao registrar cardio:', err);
      aviso(err.message);
    }
    return true;
  }

  if (a === 'cpular') {
    const m = b.dataset.m === 'i' ? 'i' : 'f';
    await setPulado(iso(dataDe(state.s, state.d)), m, true);
    const n = passos().length;
    if (state.e < n - 1) state.e += 1;
    await render();
    scrollTo(0, 0);
    aviso('Cardio pulado neste dia');
    return true;
  }

  if (a === 'cmostar') {
    const m = b.dataset.m === 'i' ? 'i' : 'f';
    await setPulado(iso(dataDe(state.s, state.d)), m, false);
    await render();
    return true;
  }

  if (a === 'cremover') {
    await deleteCardio(+b.dataset.v);
    await render();
    aviso('Registro removido');
    return true;
  }

  if (a === 'dia') {
    state.d = +b.dataset.v;
    state.s = Math.min(state.s, MAXS(state.d));
    await carregarLogDoDia();
    state.e = await primeiroPasso();
    state.lista = false;
    await render();
    scrollTo(0, 0);
    return true;
  }

  if (a === 'sem') {
    state.s += +b.dataset.v;
    await carregarLogDoDia();
    state.e = await primeiroPasso();
    await render();
    scrollTo(0, 0);
    return true;
  }

  if (a === 'ant') {
    await moverEx(-1);
    return true;
  }

  if (a === 'prox') {
    await moverEx(1);
    return true;
  }

  if (a === 'lista') {
    state.lista = !state.lista;
    await render();
    scrollTo(0, 0);
    return true;
  }

  if (a === 'ir') {
    state.e = +b.dataset.v;
    state.lista = false;
    await render();
    scrollTo(0, 0);
    return true;
  }

  if (a === 'repetir') {
    const ei = exAtual();
    if (ei === null) return true;
    const u = await ultimo(state.d, state.s, ei);
    if (!u) return true;

    const id = idsAtuais()[ei];
    if (id === null || id === undefined) return true;

    const ns = defsAtuais()[ei][2];
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
    return true;
  }

  return false;
}

/**
 * Notes and set inputs (carga/reps) of the exercise card.
 * @param {HTMLElement} el
 * @returns {Promise<boolean>}
 */
export async function aoDigitar(el) {
  const k = el.dataset.k;

  if (k === 'nota') {
    const ei = exAtual();
    if (ei === null) return true;
    store.notas[notaKey(ei)] = el.value;
    const copia = store.notas;
    gravar(() => saveSetting('notas', copia));
    return true;
  }

  const set = el.closest ? el.closest('.set') : null;
  if (!set) return false;

  const i = +set.dataset.i;
  const ei = exAtual();
  if (ei === null) return true;
  const id = idsAtuais()[ei];
  if (id === null || id === undefined) return true;

  const g = gDe(id, i + 1);
  g[k] = el.value.trim();
  set.classList.toggle('ok', ok(g));
  salvarSerie(i + 1);
  resumo();
  return true;
}

/** The "Outro…" option of the cardio type select reveals a free-text field. */
export async function aoMudar(el) {
  if (el.dataset.k !== 'ctipo') return false;
  const outro = document.getElementById('cardioOutro');
  if (outro) outro.style.display = el.value === '__outro' ? '' : 'none';
  return true;
}

registrarTela('treino', { render: telaTreino, aposRender: resumo });
