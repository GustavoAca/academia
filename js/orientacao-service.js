/**
 * Orientação Service - monta rotinas de treino a partir do foco do usuário.
 *
 * Fluxo: o usuário escolhe (1) quais grupos musculares quer priorizar - na
 * ordem dos toques, definindo a prioridade - e (2) quantos dias por semana
 * treina. A partir disso montarRotina() gera um objeto de rotina pronto para
 * salvar com salvarRotina(), preservando início e duração da rotina atual.
 *
 * Como a montagem funciona:
 * 1. O split base (SPLITS) é escolhido pelo número de dias: 3 = Push/Pull/
 *    Legs, 4 = Upper/Lower x2, 5 = PPL + Upper/Lower, 6 = PPL x2.
 * 2. Cada dia é preenchido com exercícios da BIBLIOTECA por grupo muscular,
 *    com deslocamento por ocorrência para o dia B variar do dia A.
 * 3. Boost de foco: cada grupo focado ganha exercícios extras (2 para o 1º
 *    foco, 1 para os demais) nos dias que já treinam aquele grupo, alternando
 *    entre os grupos do foco e respeitando o teto de séries por dia.
 *
 * Formato de retorno: igual ao salvo em settings['rotina'] (ver rotina-service).
 */

import { BIBLIOTECA } from './biblioteca.js';

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

/** Chips oferecidos na tela Foco. 'grupos' = valores de grupoMuscular. */
const FOCOS = [
  { id: 'peito', nome: 'Peito', grupos: ['Peito'] },
  { id: 'costas', nome: 'Costas', grupos: ['Costas'] },
  { id: 'ombros', nome: 'Ombros', grupos: ['Ombros', 'Ombro Posterior'] },
  { id: 'bracos', nome: 'Braços', grupos: ['Bíceps', 'Tríceps'] },
  { id: 'pernas', nome: 'Pernas', grupos: ['Quadríceps', 'Posterior', 'Panturrilha'] },
  { id: 'abdomen', nome: 'Abdômen', grupos: ['Abdômen'] },
  { id: 'corpo', nome: 'Corpo todo', grupos: [] }
];

const FOCO_POR_ID = new Map(FOCOS.map(f => [f.id, f]));

/** Template de dia: nome base + cota de exercícios por grupo muscular. */
const TEMPLATES = {
  push: { base: 'Push', plano: [['Peito', 2], ['Ombros', 1], ['Tríceps', 1], ['Abdômen', 1]] },
  pull: { base: 'Pull', plano: [['Costas', 2], ['Ombro Posterior', 1], ['Bíceps', 2]] },
  legs: { base: 'Legs', plano: [['Quadríceps', 2], ['Posterior', 2], ['Panturrilha', 1]] },
  upper: { base: 'Upper', plano: [['Peito', 2], ['Costas', 2], ['Ombros', 1], ['Bíceps', 1], ['Tríceps', 1]] },
  lower: { base: 'Lower', plano: [['Quadríceps', 2], ['Posterior', 2], ['Panturrilha', 1], ['Abdômen', 1]] }
};

/** Split base por quantidade de dias de treino na semana. */
const SPLITS = {
  3: ['push', 'pull', 'legs'],
  4: ['upper', 'lower', 'upper', 'lower'],
  5: ['push', 'pull', 'legs', 'upper', 'lower'],
  6: ['push', 'pull', 'legs', 'push', 'pull', 'legs']
};

/** Dias da semana usados por quantidade de treinos (seg..dom). */
const DIAS_POR_QTD = {
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5]
};

const LETRAS = ['A', 'B', 'C'];
const MAX_SERIES = 28;

/**
 * Series total of a built day.
 * @param {Object} d
 * @returns {number}
 */
function seriesDe(d) {
  return d.ex.reduce((a, t) => a + (Number(t[2]) || 0), 0);
}

/**
 * Fill one day template with exercises from the library. The occurrence number
 * shifts the starting index so the second day of the same template picks
 * different exercises than the first.
 * @param {string} tipo - key of TEMPLATES
 * @param {number} ocorrencia - 0-based occurrence of this template in the split
 * @param {string} letra
 * @returns {Object} day builder { tipo, base, plano, letra, ex, nomes, foco }
 */
function montarDia(tipo, ocorrencia, letra) {
  const tpl = TEMPLATES[tipo];
  const d = { tipo, base: tpl.base, plano: tpl.plano, letra, ex: [], nomes: new Set(), foco: new Set() };
  const offset = ocorrencia * 3;

  for (const [grupo, qtd] of tpl.plano) {
    const lista = BIBLIOTECA[grupo] || [];
    let pego = 0;
    for (let i = 0; i < lista.length && pego < qtd; i++) {
      const t = lista[(offset + i) % lista.length];
      if (d.nomes.has(t[0])) continue;
      d.nomes.add(t[0]);
      d.ex.push(t);
      pego++;
    }
  }

  return d;
}

/**
 * Pick one extra exercise of a group for a day: prefers exercises not used
 * anywhere in the routine yet, then the first one missing from the day.
 * @param {string} grupo
 * @param {Object} d - day builder
 * @param {Set<string>} usadosGlobais - names already used by any day
 * @returns {Array|null}
 */
function escolherExtra(grupo, d, usadosGlobais) {
  const lista = BIBLIOTECA[grupo] || [];
  const livre = lista.find(t => !d.nomes.has(t[0]) && !usadosGlobais.has(t[0]));
  if (livre) return livre;
  return lista.find(t => !d.nomes.has(t[0])) || null;
}

/**
 * Inject the focus boost: extra exercises on the days that already train the
 * focused groups. The 1st focus gets 2 extra exercises, the others 1 each,
 * alternating between the groups of that focus until the quota is used or no
 * day has room under MAX_SERIES.
 * @param {Object[]} dias - day builders (mutated)
 * @param {string[]} focosIds
 */
function aplicarFoco(dias, focosIds) {
  const usadosGlobais = new Set();
  dias.forEach(d => d.ex.forEach(t => usadosGlobais.add(t[0])));

  focosIds.forEach((id, idx) => {
    const foco = FOCO_POR_ID.get(id);
    if (!foco || !foco.grupos.length) return;

    let restam = idx === 0 ? 2 : 1;
    let gi = 0;
    let falhas = 0;

    while (restam > 0 && falhas < foco.grupos.length) {
      const grupo = foco.grupos[gi % foco.grupos.length];
      gi++;

      const candidatos = dias.filter(d => d.plano.some(p => p[0] === grupo));
      let add = false;

      for (const d of candidatos) {
        const ex = escolherExtra(grupo, d, usadosGlobais);
        if (!ex) continue;
        if (seriesDe(d) + Number(ex[2]) > MAX_SERIES) continue;
        d.ex.push(ex);
        d.nomes.add(ex[0]);
        d.foco.add(foco.nome);
        usadosGlobais.add(ex[0]);
        restam--;
        add = true;
        break;
      }

      falhas = add ? 0 : falhas + 1;
    }
  });
}

/**
 * Build a routine from the chosen focus and number of training days.
 * @param {Object} p
 * @param {string[]} p.focos - ids of selected chips, in priority order
 * @param {number} p.dias - training days per week (3..6)
 * @param {Object} p.atual - current routine (keeps inicio/duracao/cardio)
 * @returns {Object} routine ready for salvarRotina()
 * @throws {Error} when the number of days is not supported
 */
function montarRotina({ focos, dias, atual }) {
  const qtd = Number(dias);
  if (!SPLITS[qtd]) throw new Error('Escolha de 3 a 6 dias de treino por semana');
  if (!atual || !/^\d{4}-\d{2}-\d{2}$/.test(String(atual.inicio || ''))) {
    throw new Error('Não encontrei a rotina atual para montar o treino');
  }

  const focosIds = Array.isArray(focos) ? focos.filter(id => FOCO_POR_ID.has(id)) : [];

  const plano = SPLITS[qtd];
  const usadosDia = new Map();
  const ocorrencia = {};

  const diasGerados = plano.map((tipo, i) => {
    const base = TEMPLATES[tipo].base;
    const n = ocorrencia[base] || 0;
    ocorrencia[base] = n + 1;
    const d = montarDia(tipo, n, LETRAS[n] || String(n + 1));
    usadosDia.set(DIAS[DIAS_POR_QTD[qtd][i]], d);
    return d;
  });

  aplicarFoco(diasGerados, focosIds);

  const nomesFoco = focosIds
    .filter(id => id !== 'corpo')
    .map(id => FOCO_POR_ID.get(id).nome);

  const treinos = {};
  const diasRotina = {};
  for (const dia of DIAS) {
    const d = usadosDia.get(dia);
    if (!d) {
      diasRotina[dia] = false;
      treinos[dia] = { t: '', ex: [] };
      continue;
    }

    const focoNoDia = [...d.foco];
    const nomeDia = d.base + ' ' + d.letra + (focoNoDia.length ? ' · ' + focoNoDia.join('+') : '');
    const anterior = atual && atual.treinos && atual.treinos[dia];

    diasRotina[dia] = true;
    treinos[dia] = {
      t: nomeDia,
      ex: d.ex.map(t => ({ nome: t[0], grupo: t[1], series: t[2], min: t[3], max: t[4] })),
      // Mantém a configuração de cardio do mesmo dia na rotina atual.
      cardio: anterior && anterior.cardio ? JSON.parse(JSON.stringify(anterior.cardio)) : undefined
    };
  }

  return {
    origem: 'personalizada',
    nome: nomesFoco.length ? 'Foco: ' + nomesFoco.join(' + ') : 'Corpo todo',
    inicio: atual.inicio,
    duracao: atual.duracao ? JSON.parse(JSON.stringify(atual.duracao)) : { tipo: 'semanas', valor: 16 },
    dias: diasRotina,
    treinos
  };
}

export { FOCOS, montarRotina, TEMPLATES, SPLITS, DIAS_POR_QTD, MAX_SERIES };
