'use strict';

// Producto decimal exacto, redondeado una sola vez a centavos (mitades arriba).
// Number.toString conserva el decimal recibido y admite notación exponencial;
// BigInt evita que 2.30 × 0.95 pierda un centavo por representación binaria.
function decimalParts(value) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Se requiere un número finito no negativo.');
  const match = String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new RangeError('El número no tiene un formato decimal válido.');
  return { coefficient: BigInt(match[1] + (match[2] || '')), scale: (match[2] || '').length - Number(match[3] || 0) };
}

function multiplyHonorario(unitAmount, quantity) {
  const unit = decimalParts(unitAmount), count = decimalParts(quantity);
  const product = unit.coefficient * count.coefficient;
  const scale = unit.scale + count.scale - 2;
  const divisor = scale > 0 ? 10n ** BigInt(scale) : 1n;
  const cents = scale > 0 ? (product + divisor / 2n) / divisor : product * 10n ** BigInt(-scale);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('El importe supera el rango seguro en centavos.');
  return Number(cents) / 100;
}

module.exports = { multiplyHonorario };
