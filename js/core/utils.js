/**
 * Helpers puros de datas, formatação e texto.
 *
 * Módulo sem efeitos colaterais nem dependência de DOM: pode ser importado
 * em testes de unidade rodando no Node.
 */

export const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
export const CURTO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export const LONGO = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

/** Date -> 'YYYY-MM-DD' */
export const iso = data =>
  `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;

/** Today as 'YYYY-MM-DD'. */
export const hojeISO = () => iso(new Date());

/** Date -> 'DD/MM' */
export const fmt = x =>
  `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`;

/** 'YYYY-MM-DD' -> 'DD/MM' */
export const brd = i => i.slice(8) + '/' + i.slice(5, 7);

/** Escape the four characters that break HTML attributes and text. */
export const esc = t =>
  String(t == null ? '' : t).replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );

/** One decimal place using the pt-BR locale (comma separator). */
export const f1 = n => (Math.round(n * 10) / 10).toLocaleString('pt-BR');

/** Round to one decimal place (number, never localized). */
export const r1n = n => Math.round(Number(n) * 10) / 10;

/** Signed value: '+3,5', '-2' or '0'. Uses the typographic minus sign. */
export const sg = n => (n > 0 ? '+' : n < 0 ? '−' : '') + f1(Math.abs(n));

/** Empty-state markup shared by the report and workout screens. */
export const VZ = '<div class="meta">Sem séries registradas ainda.</div>';

/** A set is complete when both load and reps were filled in. */
export const ok = x =>
  !!x && x.c !== undefined && x.c !== '' && x.r !== undefined && x.r !== '';

/**
 * Read a picked file as JSON. Also accepts an HTML file with the embedded
 * <script id="dados"> JSON used by exemplo.html.
 * @param {string} texto
 * @returns {Object}
 */
export function extrairJson(texto) {
  const embutido = texto.match(/<script[^>]*id="dados"[^>]*>([\s\S]*?)<\/script>/);
  return JSON.parse(embutido ? embutido[1] : texto);
}

/**
 * Normalize an execution row into the draft shape used by the set inputs:
 * load as a localized string, reps as a plain string.
 * @param {{carga?: number|string|null, repeticoes?: number|string|null}|null} exec
 * @returns {{c: string, r: string}}
 */
export function entradaDe(exec) {
  if (!exec) return {};
  return {
    c: exec.carga === null || exec.carga === undefined ? '' : String(exec.carga).replace('.', ','),
    r: exec.repeticoes === null || exec.repeticoes === undefined ? '' : String(exec.repeticoes)
  };
}

/**
 * Meal suggested by the clock: breakfast before 10h, lunch before 14h,
 * snack before 18h and dinner after that.
 * @param {Array<{id: string}>} refeicoes
 * @param {Date} [agora] - injectable clock for tests
 * @returns {string|undefined}
 */
export function refeicaoSugerida(refeicoes, agora = new Date()) {
  const h = agora.getHours();
  const esperado = h < 10 ? 'cafe' : h < 14 ? 'almoco' : h < 18 ? 'lanche' : 'janta';
  return refeicoes.some(r => r.id === esperado) ? esperado : (refeicoes[0] && refeicoes[0].id);
}
