'use strict';

/**
 * Normaliza un texto: minúsculas, sin acentos, sin puntuación
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')                        // Descomponer acentos
    .replace(/[\u0300-\u036f]/g, '')         // Eliminar marcas diacríticas
    .replace(/[¿?¡!,.:;'"(){}[\]]/g, '')    // Eliminar puntuación
    .replace(/\s+/g, ' ')                    // Normalizar espacios
    .trim();
}

const GREETING_PATTERNS = [
  /^hola$/,
  /^buenos?\s+dias?$/,
  /^buenas?\s+tardes?$/,
  /^buenas?\s+noches?$/,
  /^que\s+tal$/,
  /^hey$/,
  /^saludos?$/,
  /^buen\s+dia$/,
  /^hi$/,
  /^hello$/,
];

function isGreeting(normalizedQuery) {
  if (!normalizedQuery || normalizedQuery.length <= 3) return true;
  return GREETING_PATTERNS.some(p => p.test(normalizedQuery));
}

module.exports = {
  normalizeText,
  isGreeting,
  GREETING_PATTERNS
};
