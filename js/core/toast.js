/**
 * Toast notifications. Only module that talks to #toast.
 */

/**
 * Show a transient message at the bottom of the screen.
 * @param {string} m
 */
export function aviso(m) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(aviso.h);
  aviso.h = setTimeout(() => t.classList.remove('show'), 2600);
}

export const showToast = aviso;
