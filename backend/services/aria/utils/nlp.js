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

/**
 * Distancia de Levenshtein (edit distance) para tolerancia a errores de tipeo.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

module.exports = {
  normalizeText,
  isGreeting,
  levenshtein,
  GREETING_PATTERNS
};
