/**
 * Relatório screen: KPIs, weekly volume, planned vs done sets, progression,
 * heat map, records, body measurements and food reports.
 */

import { DIAS, iso, hojeISO, esc, f1, sg, brd, VZ } from '../core/utils.js';
import { state, store } from '../core/estado.js';
import { MAXS, dataDe, iniDate } from '../core/programa.js';
import {
  janelaRel,
  diasJanela,
  planoJanela,
  semanasJanela,
  melhorSequencia,
  recordes,
  serieCampo
} from '../core/calculos-relatorio.js';
import {
  barras,
  barras2,
  empilhadas,
  calor,
  linha,
  spark,
  linhaCarga,
  barrasData
} from '../core/graficos.js';
import { dataParaDate, defsDoDia, rotinaNaData } from '../rotina-service.js';
import { MED, num, getAllMeasurementsDesc } from '../measurement-service.js';
import { getAllExecutions } from '../report-service.js';
import { getAllCardios, todosPulados, paceDe, formatarTempo } from '../cardio-service.js';
import {
  getMeta,
  historicoCalorias,
  historicoMacros,
  distribuicaoRefeicao,
  alimentosFrequentes,
  treinoVsDescanso,
  historicoPorRefeicao,
  primeiraData
} from '../food-service.js';
import { render, moldura } from '../core/render.js';
import { registrarTela } from '../core/rotas.js';

/**
 * Every execution with load/reps inside the window, plus the program week and
 * weekday of each one.
 * @param {string|null} desde - 'YYYY-MM-DD' lower bound
 */
export async function registros(desde) {
  const execs = await getAllExecutions();
  const r = [];

  for (const x of execs) {
    const ex = store.exercisesById.get(x.exercicioId);
    if (!ex) continue;
    if (x.carga === null || x.carga === undefined || x.repeticoes === null || x.repeticoes === undefined) continue;

    const data = String(x.data).slice(0, 10);
    const date = new Date(`${data}T00:00:00`);
    if (isNaN(date.getTime())) continue;
    if (desde && data < desde) continue;

    const diff = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - iniDate()) / 864e5);
    const s = Math.max(1, Math.floor(diff / 7) + 1);
    const dow = date.getDay();
    if (dow < 0 || dow > 6) continue;

    const c = num(x.carga) || 0;
    const rp = num(x.repeticoes) || 0;
    r.push({ d: (dow + 6) % 7, s, data, nome: ex.nome, grp: ex.grupoMuscular, c, r: rp, v: c * rp });
  }

  return r;
}

/** Section tabs plus the global period filter. */
export function relNav(sec) {
  const secs = [['treino', 'Treino'], ['corpo', 'Corpo'], ['alim', 'Alimentação']];
  return `<div class="relnav">
    <div class="tabs reltabs">${secs.map(([k, l]) => `<button data-a="relsec" data-v="${k}" class="${sec === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <select class="sel" data-k="periodo" aria-label="Período do relatório">
      <option value="0" ${state.p === 0 ? 'selected' : ''}>Tudo</option>
      ${[7, 30, 90].map(d => `<option value="${d}" ${d === state.p ? 'selected' : ''}>Últimos ${d} dias</option>`).join('')}
    </select>
  </div>`;
}

/** Evolution of body measurements (section "Corpo"). */
async function secCorpo(desde) {
  const kp = (b, s) => `<div class="kpi"><b>${b}</b><small>${s}</small></div>`;
  const measurements = (await getAllMeasurementsDesc()).filter(m => !desde || m.data >= desde);
  const serieMed = campo => serieCampo(measurements, campo);
  const serieDe = campo => {
    const s = serieMed(campo);
    return { s, atual: s.length ? s[s.length - 1][1] : null, var: s.length > 1 ? s[s.length - 1][1] - s[0][1] : null };
  };

  const peso = serieDe('peso');
  const gordura = serieDe('gord');
  const cintura = serieDe('cint');

  const datas = measurements.map(m => m.data).sort();
  let entre = null;
  if (datas.length > 1) {
    let soma = 0;
    for (let i = 1; i < datas.length; i++) soma += Math.round((dataParaDate(datas[i]) - dataParaDate(datas[i - 1])) / 864e5);
    entre = Math.round(soma / (datas.length - 1));
  }

  const kpis = `<div class="kpis">
    ${kp(peso.atual !== null ? f1(peso.atual) + ' kg' : '—', peso.var !== null ? sg(peso.var) + ' kg no período' : 'peso atual')}
    ${kp(gordura.atual !== null ? f1(gordura.atual) + '%' : '—', gordura.var !== null ? sg(gordura.var) + '% no período' : 'gordura corporal')}
    ${kp(cintura.atual !== null ? f1(cintura.atual) + ' cm' : '—', cintura.var !== null ? sg(cintura.var) + ' cm no período' : 'cintura')}
    ${kp(String(measurements.length), entre !== null ? `medições · a cada ${entre} dias` : 'medições no período')}
  </div>`;

  const opts = MED.map(x => `<option value="${x[0]}" ${x[0] === state.m ? 'selected' : ''}>${x[1]}</option>`).join('');
  const linhas = MED.map(([k, n, u]) => {
    const s = serieMed(k);
    if (!s.length) return '';
    const a = s[0][1], b = s[s.length - 1][1];
    return `<tr><td><div class="med"><span>${n}</span>${spark(s.map(x => x[1]))}</div></td><td>${f1(a)}</td><td>${f1(b)}</td><td>${s.length > 1 ? sg(b - a) + ' ' + u : '—'}</td></tr>`;
  }).join('');

  return kpis + `<div class="card sec"><h2>Evolução das medidas</h2>
    <div class="sub">Valores registrados no período. Use o seletor para trocar a medida do gráfico.</div>
    <select class="sel" data-k="metrica" style="margin:8px 0 12px">${opts}</select>${linha(serieMed(state.m).map(x => [brd(x[0]), x[1]]))}
    ${linhas ? `<table class="tb tbmed" style="margin-top:12px"><tr><th style="width:46%">Medida</th><th style="width:18%">Início</th><th style="width:17%">Atual</th><th style="width:19%">Variação</th></tr>${linhas}</table>` : '<div class="meta">Nenhuma medida no período. Registre na aba Medidas.</div>'}
  </div>`;
}

/** Number of days shown by the food section when the filter is "all time". */
async function diasAlimento() {
  if (state.p) return state.p;
  const primeira = await primeiraData();
  return primeira ? diasJanela(primeira) : 30;
}

/** Full HTML of the Relatório screen. */
export async function telaRel() {
  const sec = state.relSec;
  const { desde, dias } = janelaRel();
  const corpo = sec === 'corpo' ? await secCorpo(desde)
    : sec === 'alim' ? await cardRelAlimentacao(desde, dias || await diasAlimento())
      : await secTreino(desde);

  const backup = `<div class="card sec"><h2>Backup e importação</h2><div class="sub">Baixe um backup do que está neste aparelho, importe um backup .json gerado por este app ou importe os dados preenchidos no exemplo (.json/.html).</div>
    <div class="acoes"><button class="btn" data-a="backup">Baixar backup</button><button class="btn p" data-a="importar-backup">Importar backup</button></div>
    <div class="acoes"><button class="btn" data-a="importar-exemplo">Importar dados do exemplo</button></div>
    <input type="file" id="arquivoBackup" accept=".json,application/json" style="display:none">
    <input type="file" id="arquivoExemplo" accept=".json,.html,.htm,application/json,text/html" style="display:none">
  </div>`;

  return moldura('Relatório de progresso', relNav(sec) + corpo + backup);
}
/** Training KPIs, volume, consistency, progression, records and cardio. */
async function secTreino(desde) {
  const kp = (b, s) => `<div class="kpi"><b>${b}</b><small>${s}</small></div>`;
  const hoje = hojeISO();
  const R = await registros(desde);
  const vol = R.reduce((a, x) => a + x.v, 0);
  const treinados = new Set(R.map(x => x.data));
  const plan = planoJanela(desde);
  const dj = diasJanela(desde);
  const seq = melhorSequencia(treinados, desde);
  const sems = semanasJanela(desde);
  const at = Math.max(0, ...R.map(x => x.s));

  const volSem = {}, feitasSem = {}, planSem = {};
  sems.forEach(s => { volSem[s] = 0; feitasSem[s] = 0; planSem[s] = 0; });
  R.forEach(x => { if (x.s in volSem) { volSem[x.s] += x.v; feitasSem[x.s]++; } });
  sems.forEach(s => {
    DIAS.forEach((k, d) => {
      if (s > MAXS(d)) return;
      const data = iso(dataDe(s, d));
      if (desde && data < desde) return;
      if (data > hoje) return;
      planSem[s] += defsDoDia(rotinaNaData(data, store.rotina), k).reduce((a, x) => a + Number(x.series || 0), 0);
    });
  });

  const volData = {};
  R.forEach(x => { volData[x.data] = (volData[x.data] || 0) + x.v; });
  const grade = sems.map(s => Array.from({ length: 7 }, (_, d) => {
    const data = iso(dataDe(s, d));
    if (data > hoje || (desde && data < desde)) return null;
    return { data, vol: volData[data] || 0, treinou: volData[data] !== undefined };
  }));

  const ex = {};
  R.forEach(x => {
    const o = ex[x.nome] = ex[x.nome] || { w: {}, v: 0, b: 0, br: 0 };
    o.v += x.v;
    o.w[x.s] = Math.max(o.w[x.s] || 0, x.c);
    if (x.c > o.b || (x.c === o.b && x.r > o.br)) { o.b = x.c; o.br = x.r; }
  });
  const progressao = Object.entries(ex).sort((a, b) => b[1].v - a[1].v).map(([n, o]) => {
    const ws = Object.keys(o.w).map(Number).sort((a, b) => a - b);
    const cs = ws.map(w => o.w[w]);
    const u = cs[cs.length - 1];
    const d = cs.length > 1 ? u - cs[0] : null;
    const pr = cs.length > 1 && u > Math.max(...cs.slice(0, -1));
    const travado = cs.length >= 4 && Math.max(...cs.slice(-3)) <= Math.max(...cs.slice(0, -3));
    const html = `<div class="ex g"><div><b>${esc(n)}${pr ? '<span class="pr">recorde</span>' : ''}</b><small>melhor série: ${f1(o.b)} kg × ${o.br} · última semana: ${f1(u)} kg${d !== null ? ` · ${sg(d)} kg desde a semana ${ws[0]}` : ''}</small></div>${linhaCarga(ws.map((w, i) => ['Sem ' + w, cs[i]]))}</div>`;
    return { n, o, u, travado, html };
  });

  const travados = progressao.filter(p => p.travado).slice(0, 4);
  const recs = recordes(R);

  const gr = {};
  R.forEach(x => {
    const g = gr[x.grp] = gr[x.grp] || { n: 0, v: 0 };
    g.n++;
    g.v += x.v;
  });
  const gl = Object.entries(gr).sort((a, b) => b[1].v - a[1].v);
  const gm = Math.max(1, ...gl.map(([, g]) => g.v));
  const grupos = gl.map(([n, g]) => `<div class="hbar"><span>${esc(n)}</span><span><i style="width:${(g.v / gm * 100).toFixed(0)}%"></i></span><span>${Math.round(g.v).toLocaleString('pt-BR')} kg · ${g.n} séries</span></div>`).join('');

  const cardios = (await getAllCardios()).filter(c => !desde || c.data >= desde);
  const minTotal = cardios.reduce((a, x) => a + (Number(x.minutos) || 0), 0);
  const kmTotal = cardios.reduce((a, x) => a + (Number(x.distancia) || 0), 0);
  const temDist = cardios.some(c => c.distancia);
  const diasCardio = new Set(cardios.map(c => c.data)).size;
  const pulados = await todosPulados();
  const nPulos = Object.entries(pulados).filter(([d, p]) => p && (p.i || p.f) && (!desde || d >= desde)).length;
  const pulosTxt = nPulos ? ` · ${nPulos} ${nPulos === 1 ? 'dia' : 'dias'} com cardio pulado` : '';
  const minSem = sems.map(() => 0);
  cardios.forEach(c => {
    const d = dataParaDate(c.data);
    const diff = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - iniDate()) / 864e5);
    const i = sems.indexOf(Math.floor(diff / 7) + 1);
    if (i >= 0) minSem[i] += Number(c.minutos) || 0;
  });
  const porTipo = {};
  cardios.forEach(c => { porTipo[c.tipo] = (porTipo[c.tipo] || 0) + (Number(c.minutos) || 0); });
  const tipos = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);
  const maxTipo = Math.max(1, ...tipos.map(t => t[1]));
  const linhasTipo = tipos.map(([n, m]) => `<div class="hbar"><span>${esc(n)}</span><span><i style="width:${(m / maxTipo * 100).toFixed(0)}%"></i></span><span style="white-space:nowrap">${formatarTempo(m)}</span></div>`).join('');
  const histCardio = cardios.slice(0, 10)
    .map(c => `<tr><td>${brd(c.data)}</td><td style="text-align:left">${esc(c.tipo)}</td><td>${formatarTempo(c.minutos)}</td>${temDist ? `<td>${c.distancia ? Number(c.distancia).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : ''}</td><td>${paceDe(c.minutos, c.distancia) || ''}</td>` : ''}</tr>`)
    .join('');

  const kmTxt = kmTotal > 0 ? ` · ${f1(kmTotal)} km` : '';
  const cabecalho = temDist
    ? '<tr><th style="width:18%">Dia</th><th style="width:40%;text-align:left">Atividade</th><th style="width:18%">Tempo</th><th style="width:12%">Km</th><th style="width:12%">Pace</th></tr>'
    : '<tr><th style="width:26%">Dia</th><th style="width:50%;text-align:left">Atividade</th><th style="width:24%">Tempo</th></tr>';

  const cardioCard = `<div class="card sec"><h2>Cardio</h2>
    <div class="sub">${cardios.length} registros · ${diasCardio} ${diasCardio === 1 ? 'dia' : 'dias'} · ${formatarTempo(minTotal)}${kmTxt} no período${pulosTxt}</div>
    ${cardios.length ? `${barras(minSem, at, 'min', sems, minSem.some(x => x > 0) ? formatarTempo : null)}${linhasTipo ? `<div class="meta" style="margin-top:12px">Tempo por tipo</div>${linhasTipo}` : ''}
      <table class="tb" style="margin-top:10px">${cabecalho}${histCardio}</table>` : '<div class="meta">Nenhum cardio no período. Registre nas barras da tela Treino.</div>'}
  </div>`;

  const kpis = `<div class="kpis">
    ${kp(treinados.size + '/' + dj, 'dias com treino · ' + Math.round(treinados.size / dj * 100) + '%')}
    ${kp(plan ? R.length + '/' + plan : String(R.length), plan ? 'séries feitas · ' + Math.round(R.length / plan * 100) + '%' : 'séries feitas')}
    ${kp(Math.round(vol).toLocaleString('pt-BR') + ' kg', 'volume no período')}
    ${kp(seq + (seq === 1 ? ' dia' : ' dias'), 'melhor sequência')}
  </div>`;

  const consist = `<div class="card sec"><h2>Consistência</h2>
    <div class="sub">Cada quadrado é um dia da semana. Quanto mais forte a cor, maior o volume treinado nesse dia.</div>
    ${calor(grade)}
    <div class="legenda"><span><i class="cx"></i>fora do período</span><span><i class="cv"></i>sem registro</span><span><i class="c1"></i>leve</span><span><i class="c2"></i>médio</span><span><i class="c3"></i>pesado</span></div>
  </div>`;

  const planoCard = `<div class="card sec"><h2>Séries planejadas × feitas</h2>
    <div class="sub">A barra clara é o que o plano previa na semana; a forte é o que você fez.</div>
    ${barras2(sems.map(s => feitasSem[s]), sems.map(s => planSem[s]), sems)}
    <div class="legenda"><span><i class="pl"></i>planejadas</span><span><i class="at"></i>feitas</span></div>
  </div>`;

  const estagCard = travados.length ? `<div class="card sec"><h2>Possível estagnação</h2>
    <div class="sub">A melhor carga desses exercícios não evoluiu nas últimas 3 semanas. Considere mudar séries, repetições ou descanso.</div>
    ${travados.map(p => p.html).join('')}
  </div>` : '';

  const recsCard = recs.length ? `<div class="card sec"><h2>Recordes recentes</h2>
    <div class="sub">Novas marcas de melhor série dentro do período.</div>
    <table class="tb"><tr><th style="width:22%">Dia</th><th style="width:53%;text-align:left">Exercício</th><th style="width:25%">Carga</th></tr>
    ${recs.map(r => `<tr><td>${brd(r.data)}</td><td style="text-align:left">${esc(r.nome)}</td><td>${f1(r.c)} kg</td></tr>`).join('')}</table>
  </div>` : '';

  return kpis + consist
    + `<div class="card sec"><h2>Volume por semana</h2><div class="sub">Carga × repetições de todas as séries, em kg. A semana mais recente está destacada.</div>${barras(sems.map(s => volSem[s]), at, 'kg', sems)}</div>`
    + planoCard
    + `<div class="card sec"><h2>Progressão por exercício</h2><div class="sub">Maior carga de cada semana dentro do período. A linha mostra a tendência.</div>${progressao.map(p => p.html).join('') || VZ}</div>`
    + estagCard
    + recsCard
    + `<div class="card sec"><h2>Volume por grupo muscular</h2><div class="sub">Volume total (carga × repetições) e quantidade de séries em cada grupo.</div>${grupos || VZ}</div>`
    + cardioCard;
}
/** Food KPIs, daily calories, meals, top foods and training vs rest. */
async function cardRelAlimentacao(desde, dias) {
  const kp = (b, s) => `<div class="kpi"><b>${b}</b><small>${s}</small></div>`;
  const ate = hojeISO();

  const [hist, dist, freq, vst, meta, pilhas, macroHist] = await Promise.all([
    historicoCalorias(dias, ate),
    distribuicaoRefeicao(dias, ate),
    alimentosFrequentes(dias, ate),
    treinoVsDescanso(dias, ate),
    getMeta(),
    historicoPorRefeicao(dias, ate),
    historicoMacros(dias, ate)
  ]);

  if (!freq.length) {
    return `<div class="card sec"><h2>Alimentação</h2><div class="sub">Consumo de calorias por dia, por refeição e por alimento.</div>
      <div class="meta">Nenhum registro de alimentação no período. Registre na aba Alimentação.</div></div>`;
  }

  const registrados = hist.filter(h => h.total > 0);
  const total = hist.reduce((a, h) => a + h.total, 0);
  const media = registrados.length ? total / registrados.length : 0;
  const maior = Math.max(...hist.map(h => h.total));
  const desvio = meta !== null && registrados.length
    ? registrados.reduce((a, h) => a + (h.total - meta), 0) / registrados.length
    : null;
  const dentro = meta !== null ? registrados.filter(h => h.total <= meta).length : null;
  const pctDentro = dentro !== null && registrados.length ? Math.round(dentro / registrados.length * 100) : null;

  const mm7 = hist.map((h, i) => {
    const j = hist.slice(Math.max(0, i - 6), i + 1);
    return j.reduce((a, x) => a + x.total, 0) / j.length;
  });

  const pilhasAtivas = pilhas.refeicoes.filter(r => r.valores.some(v => v > 0)).slice(0, 6);
  const pilhasCard = pilhasAtivas.length ? `<div class="card sec"><h2>Calorias por refeição</h2>
    <div class="sub">Cada barra é um dia, empilhada pelas refeições do dia.</div>
    ${empilhadas(pilhas.datas, pilhasAtivas)}
    <div class="legenda">${pilhasAtivas.map((r, i) => `<span><i class="s${i}"></i>${esc(r.nome)}</span>`).join('')}</div>
  </div>` : '';

  const linhasDist = dist.filter(d => d.total > 0).map(d => `<div class="hbar">
    <span>${esc(d.nome)}</span><span><i style="width:${d.pct}%"></i></span>
    <span style="white-space:nowrap">${d.pct}% · ${f1(d.total)} kcal</span></div>`).join('');

  const linhasFreq = freq.slice(0, 12).map(f => `<tr><td>${esc(f.nome)}</td><td>${f.vezes}</td><td>${f1(f.media)}</td><td>${f1(f.total)}</td></tr>`).join('');

  const comReg = macroHist.filter(d => d.itens > 0);
  const temMacro = macroHist.some(d => d.prot > 0 || d.carb > 0 || d.gord > 0);
  const mediaMacro = campo => comReg.length
    ? comReg.reduce((a, d) => a + d[campo], 0) / comReg.length
    : 0;
  const mp = mediaMacro('prot');
  const mc = mediaMacro('carb');
  const mg = mediaMacro('gord');
  const somaKcal = mp * 4 + mc * 4 + mg * 9;
  const pctKcal = kcal => (somaKcal ? Math.round(kcal / somaKcal * 100) : 0);
  const maxMacro = Math.max(mp, mc, mg, 1);
  const linhaMacro = (rot, g, kcal) => `<div class="hbar">
    <span>${rot}</span><span><i style="width:${(g / maxMacro * 100).toFixed(0)}%"></i></span>
    <span style="white-space:nowrap">${f1(g)} g/dia · ${pctKcal(kcal)}% das kcal</span></div>`;
  const macrosCard = temMacro && comReg.length ? `<div class="card sec"><h2>Macros</h2>
    <div class="sub">Média diária em dias com registro. O percentual é a participação de cada macro nas calorias (4/4/9).</div>
    ${linhaMacro('Proteína', mp, mp * 4)}
    ${linhaMacro('Carboidrato', mc, mc * 4)}
    ${linhaMacro('Gordura', mg, mg * 9)}
  </div>` : '';

  const maxVD = Math.max(vst.treino.media || 0, vst.descanso.media || 0, 1);
  const vd = (o, nome) => o.media === null ? '' : `<div class="hbar">
    <span>${nome}</span><span><i style="width:${(o.media / maxVD * 100).toFixed(0)}%"></i></span>
    <span style="white-space:nowrap">${f1(o.media)} kcal · ${o.dias} dias</span></div>`;
  const vdHtml = vd(vst.treino, 'Treino') + vd(vst.descanso, 'Descanso');

  const kpis = `<div class="kpis">
    ${kp(f1(media) + ' kcal', 'média em dias com registro')}
    ${kp(registrados.length + '/' + dias, 'dias com registro')}
    ${pctDentro !== null ? kp(pctDentro + '%', 'dias dentro da meta') : kp(desvio !== null ? sg(desvio) + ' kcal' : '—', desvio !== null ? 'média vs meta' : 'sem meta definida')}
    ${kp(f1(maior) + ' kcal', 'maior dia do período')}
  </div>`;

  return `<div class="card sec"><h2>Alimentação</h2>
    <div class="sub">Consumo de calorias no período selecionado no topo da tela.</div>
    ${kpis}
    <div class="meta">${registrados.length} de ${dias} dias com registro · total de ${Math.round(total).toLocaleString('pt-BR')} kcal</div>
  </div>

  <div class="card sec"><h2>Calorias por dia</h2>
    <div class="sub">Cada barra é um dia. A linha tracejada é a meta${meta === null ? ' (defina em Alimentação)' : ''} e a curva é a média móvel de 7 dias.</div>
    ${barrasData(hist.map(h => ({ data: h.data, v: h.total })), { media, meta, mm7 })}
    <div class="legenda"><span><i class="${meta !== null ? 'gmeta' : 'gmed'}"></i>${meta !== null ? 'meta' : 'média'}</span><span><i class="glin"></i>média 7 dias</span></div>
  </div>

  ${pilhasCard}

  <div class="card sec"><h2>Distribuição por refeição</h2><div class="sub">De onde vêm as calorias do período.</div>${linhasDist || '<div class="meta">Sem dados no período.</div>'}</div>

  ${macrosCard}

  <div class="card sec"><h2>Alimentos mais frequentes</h2><div class="sub">O que aparece com mais frequência e quanto de calorias cada uso traz.</div>
    ${freq.length ? `<table class="tb"><tr><th style="width:46%;text-align:left">Alimento</th><th style="width:18%">Vezes</th><th style="width:18%">Média kcal</th><th style="width:18%">Total kcal</th></tr>${linhasFreq}</table>` : '<div class="meta">Sem dados no período.</div>'}</div>

  <div class="card sec"><h2>Treino vs descanso</h2><div class="sub">Média de calorias em dias com e sem séries registradas (somente dias com registro de alimentação).</div>
    ${vdHtml || '<div class="meta">Sem dados no período.</div>'}</div>`;
}

/* --- Actions (data-a) and fields (data-k) of this screen --- */

/**
 * Handle one click action of this screen.
 * @param {string} a
 * @param {HTMLElement} b
 * @returns {Promise<boolean>}
 */
export async function aoClicar(a, b) {
  if (a !== 'relsec') return false;
  state.relSec = b.dataset.v;
  await render();
  scrollTo(0, 0);
  return true;
}

/**
 * Chart metric and period filter.
 * @param {HTMLElement} el
 * @returns {Promise<boolean>}
 */
export async function aoDigitar(el) {
  const k = el.dataset.k;

  if (k === 'metrica') {
    state.m = el.value;
    await render();
    return true;
  }

  if (k === 'periodo') {
    state.p = +el.value;
    await render();
    return true;
  }

  return false;
}

registrarTela('rel', { render: telaRel });


