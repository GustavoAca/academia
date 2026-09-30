/**
 * Minimal browser stub so screen modules can be imported and rendered under
 * `node --test` (no real DOM is available there).
 */

/**
 * Install `document`, `window` and `scrollTo` globals and return the handles
 * needed by the tests (the #app node and the registered listeners).
 * @returns {{app: {innerHTML: string}, ouvintes: Object<string, Function[]>}}
 */
export function instalarDom() {
  const app = { innerHTML: '' };
  const ouvintes = {};
  const registra = (alvo, tipo, fn) => {
    (alvo[tipo] = alvo[tipo] || []).push(fn);
  };

  const ouvintesJanela = {};

  globalThis.window = {
    addEventListener(tipo, fn) { registra(ouvintesJanela, tipo, fn); },
    removeEventListener() {}
  };

  globalThis.document = {
    readyState: 'complete',
    hidden: false,
    activeElement: null,
    addEventListener(tipo, fn, opcoes) {
      (ouvintes[tipo] = ouvintes[tipo] || []).push({ fn, opcoes });
    },
    removeEventListener() {},
    getElementById(id) { return id === 'app' ? app : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };

  globalThis.scrollTo = () => {};

  return { app, ouvintes, ouvintesJanela };
}

/**
 * Fake click event for the action dispatcher.
 * @param {Object} dataset - data-a/data-t/data-v/... of the clicked element
 * @returns {Event}
 */
export function eventoClique(dataset) {
  const el = { dataset };
  return { target: { closest: () => el } };
}

/**
 * Fake form field for the input/change dispatchers (they receive the element
 * itself, not the event).
 * @param {Object} dataset - data-k/data-d/data-i/... of the field
 * @param {string} [value]
 * @returns {{dataset: Object, value: string}}
 */
export function eventoCampo(dataset, value = '') {
  return { dataset, value };
}

/** Wrap a field into a synthetic input/change event. */
export function eventoInput(el) {
  return { target: el };
}

/** Run every listener registered for a document event type. */
export async function disparar(ouvintes, tipo, ev) {
  for (const item of ouvintes[tipo] || []) {
    await item.fn(ev);
  }
}
