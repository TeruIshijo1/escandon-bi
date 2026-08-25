import { useEffect } from 'react';

/**
 * useEscapeKey — Cierra ventanas/modales con la tecla ESC.
 * Uso: useEscapeKey(onClose, isActive) — isActive por defecto true.
 */
export default function useEscapeKey(onEscape, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEscape, active]);
}
