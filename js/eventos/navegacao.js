/**
 * Navigation between exercises: buttons are handled by the Treino screen,
 * this module adds swipe and keyboard shortcuts.
 */

import { moverEx } from '../telas/treino.js';
import { tratarTecladoLista, arrasteAtivo } from '../telas/alimentacao.js';

let navX = 0, navY = 0, navAlvo = null;

export function registrarNavegacao() {
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { navAlvo = null; return; }
    navX = e.touches[0].clientX;
    navY = e.touches[0].clientY;
    navAlvo = e.target;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    const alvo = navAlvo;
    navAlvo = null;
    if (!alvo || !e.changedTouches.length) return;
    if (arrasteAtivo()) return; // o gesto pertence ao arraste da alimentação

    const dx = e.changedTouches[0].clientX - navX;
    const dy = e.changedTouches[0].clientY - navY;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (alvo.closest && alvo.closest('input,textarea,select')) return;

    moverEx(dx < 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (tratarTecladoLista(e)) return;

    const t = document.activeElement;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    moverEx(e.key === 'ArrowLeft' ? -1 : 1);
  });
}
