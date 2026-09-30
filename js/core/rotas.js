/**
 * Screen registry: each screen module registers itself here on import.
 *
 * The registry keeps `render` free of imports from `telas/`, which would
 * otherwise create a cycle (telas need `render` to redraw after an action).
 */

const telas = new Map();

/**
 * Register a screen.
 * @param {string} chave - state.tela value ('treino', 'rel', ...)
 * @param {{titulo?: string, render: () => string|Promise<string>, aposRender?: () => void|Promise<void>}} def
 */
export function registrarTela(chave, def) {
  telas.set(chave, def);
}

/** Registered screen for the given key, or null. */
export function telaDe(chave) {
  return telas.get(chave) || null;
}

/** All registered screen keys (useful in tests). */
export function telasRegistradas() {
  return [...telas.keys()];
}

/** Drop every registration (tests only). */
export function limparTelas() {
  telas.clear();
}
