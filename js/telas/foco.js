/**
 * Foco screen: orientation wizard (focus chips -> days per week -> preview)
 * and the JSON paste flow for an externally generated routine.
 */

import { DIAS, esc } from '../core/utils.js';
import { state, store } from '../core/estado.js';
import { FOCOS, montarRotina } from '../orientacao-service.js';
import { normalizar, validarRotina, rotinaPadrao } from '../rotina-service.js';
import { cardDiaRotina, aplicarRascunho } from './rotina.js';
import { render, moldura, subTabsAjustes } from '../core/render.js';
import { registrarTela } from '../core/rotas.js';
import { aviso } from '../core/toast.js';

/** Display name of a focus id, or '' when unknown. */
export function nomeFoco(id) {
  const f = FOCOS.find(x => x.id === id);
  return f ? f.nome : '';
}

/**
 * Steps 1 (focus chips) and 2 (days per week) of the orientation wizard.
 * Step 3 (the editable preview) lives in focoPrevia().
 * @returns {string} HTML
 */
function telaFoco() {
  const f = state.foco;
  const mold = corpo => moldura('Orientação de treino', subTabsAjustes('foco') + corpo);
  if (f.passo === 3 && store.rotinaRascunho) return mold(focoPrevia());

  const chips = FOCOS.map(x => {
    const i = f.grupos.indexOf(x.id);
    const on = i >= 0;
    return `<button data-a="foco_grupo" data-g="${x.id}" class="${on ? 'on' : ''}"><b>${esc(x.nome)}</b><small>${on ? (i + 1) + 'º lugar' : 'toque para priorizar'}</small></button>`;
  }).join('');

  const passo1 = `<div class="card sec"><h2>O que você quer priorizar?</h2>
    <div class="sub">Toque nos grupos que quer focar: a ordem dos toques define a prioridade (1º, 2º...). O restante do corpo entra equilibrado no treino.</div>
    <div class="chips">${chips}</div>
    <div class="acoes"><button class="btn p" data-a="foco_passo" data-v="2" ${f.grupos.length ? '' : 'disabled'}>Continuar</button>
    <button class="btn" data-a="foco_colar">Já tenho um treino (JSON)</button></div>
  </div>`;

  const passoColar = f.colar ? `<div class="card sec"><h2>Colar treino em JSON</h2>
    <div class="sub">Cole aqui a sugestão gerada por IA (formato do prompt ` + '`prompts/treinos.md`' + `). Ela abre como prévia editável antes de aplicar.</div>
    <textarea id="focoJson" rows="8" spellcheck="false" placeholder='{ "nome": "...", "dias": { "seg": true, ... }, "treinos": { ... } }'></textarea>
    <div class="acoes"><button class="btn p" data-a="foco_carregar">Carregar prévia</button>
    <button class="btn" data-a="foco_cancelar">Cancelar</button></div>
  </div>` : '';

  if (f.passo !== 2) return mold(passo1 + passoColar);

  const diasChips = [3, 4, 5, 6]
    .map(n => `<button data-a="foco_dias" data-v="${n}" class="${f.dias === n ? 'on' : ''}"><b>${n}x</b><small>por semana</small></button>`)
    .join('');

  return mold(passo1 + `<div class="card sec"><h2>Quantos dias por semana?</h2>
    <div class="sub">O split é montado de acordo com a sua disponibilidade. Depois você ajusta tudo na prévia antes de aplicar.</div>
    <div class="chips">${diasChips}</div>
    <div class="acoes"><button class="btn p" data-a="foco_gerar">Gerar sugestão</button><button class="btn" data-a="foco_passo" data-v="1">Voltar</button></div>
  </div>`);
}

/**
 * Step 3: the generated routine as an editable preview. Reuses the Rotina
 * screen day cards, so the shared r* handlers edit rotinaRascunho in place.
 * @returns {string} HTML
 */
function focoPrevia() {
  const f = state.foco;
  const r = store.rotinaRascunho;
  const ativos = DIAS.filter(d => r.dias[d] && ((r.treinos[d] && r.treinos[d].ex) || []).length);
  const nomes = f.grupos.filter(id => id !== 'corpo').map(nomeFoco);
  const focoTxt = nomes.length ? nomes.join(' + ') : (r.nome || 'Corpo todo');
  const totalEx = ativos.reduce((a, d) => a + ((r.treinos[d] && r.treinos[d].ex) || []).length, 0);

  return `<div class="card sec"><h2>Sugestão: ${esc(focoTxt)}</h2>
    <div class="sub">Montamos ${ativos.length} dias por semana com ${totalEx} exercícios. Ajuste séries, troque exercícios e marque os dias — só aplique quando estiver do jeito que você quer.</div>
    <span class="grp">${ativos.length}x por semana</span>
    <div class="acoes">
      <button class="btn p" data-a="foco_aplicar">Aplicar treino</button>
      <button class="btn" data-a="foco_refazer">Trocar foco</button>
    </div>
  </div>
  ${ativos.map(d => cardDiaRotina(r, d)).join('')}
  <div class="meta">Ao aplicar, esta sugestão substitui sua rotina atual. Séries já registradas continuam no relatório.</div>`;
}

/**
 * Handle one click action of this screen.
 * @param {string} a
 * @param {HTMLElement} b
 * @returns {Promise<boolean>}
 */
export async function aoClicar(a, b) {
  if (a === 'foco_grupo') {
    const g = b.dataset.g;
    const f = state.foco;
    const i = f.grupos.indexOf(g);

    if (i >= 0) {
      f.grupos.splice(i, 1);
    } else if (g === 'corpo') {
      f.grupos = ['corpo'];
    } else {
      if (f.grupos.length >= 4) { aviso('Máximo de 4 focos — desmarque algum'); return true; }
      f.grupos = f.grupos.filter(x => x !== 'corpo');
      f.grupos.push(g);
    }

    await render();
    return true;
  }

  if (a === 'foco_colar') {
    state.foco.colar = true;
    await render();
    const el = document.getElementById('focoJson');
    if (el) el.focus();
    return true;
  }

  if (a === 'foco_cancelar') {
    state.foco.colar = false;
    await render();
    return true;
  }

  if (a === 'foco_carregar') {
    try {
      const txt = ((document.getElementById('focoJson') || {}).value || '').trim();
      const bruto = JSON.parse(txt);
      if (!bruto || typeof bruto !== 'object' || !bruto.dias || !bruto.treinos) {
        throw new Error('JSON precisa ter "dias" e "treinos"');
      }
      const r = normalizar(bruto);
      const v = validarRotina(r);
      if (!v.valid) throw new Error(v.error);
      store.rotinaRascunho = r;
      state.foco.colar = false;
      state.foco.passo = 3;
      await render();
      scrollTo(0, 0);
      aviso('Treino carregado — revise e aplique');
    } catch (err) {
      aviso('JSON inválido: ' + err.message);
    }
    return true;
  }

  if (a === 'foco_passo') {
    state.foco.passo = +b.dataset.v || 1;
    await render();
    scrollTo(0, 0);
    return true;
  }

  if (a === 'foco_dias') {
    state.foco.dias = +b.dataset.v || 4;
    await render();
    return true;
  }

  if (a === 'foco_gerar') {
    try {
      store.rotinaRascunho = montarRotina({
        focos: state.foco.grupos,
        dias: state.foco.dias,
        atual: store.rotina || rotinaPadrao()
      });
      state.foco.passo = 3;
      await render();
      scrollTo(0, 0);
      aviso('Sugestão gerada — revise e aplique');
    } catch (err) {
      console.error('Erro ao gerar sugestão de treino:', err);
      aviso(err.message);
    }
    return true;
  }

  if (a === 'foco_refazer') {
    store.rotinaRascunho = null;
    state.foco.passo = 1;
    await render();
    scrollTo(0, 0);
    return true;
  }

  if (a === 'foco_aplicar') {
    const qtd = state.foco.dias;
    if (await aplicarRascunho()) {
      state.foco = { passo: 1, grupos: [], dias: qtd };
      state.tela = 'treino';
      await render();
      scrollTo(0, 0);
      aviso('Treino do foco aplicado ✓');
    }
    return true;
  }

  return false;
}

registrarTela('foco', { render: telaFoco, titulo: 'Orientação de treino' });
