// Producto decimal exacto: redondear sólo al final, al centavo más cercano.
// Mantener equivalente a backend/utils/honorariosMoney.js.
const decimal = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RangeError('Importe o cantidad inválidos.');
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  let coefficient = BigInt(whole + fraction);
  let scale = fraction.length - Number(exponent);
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
  return { coefficient, scale };
};

export function multiplyHonorario(unitAmount, quantity) {
  const unit = decimal(unitAmount), count = decimal(quantity);
  const product = unit.coefficient * count.coefficient;
  const scale = unit.scale + count.scale;
  const divisor = scale > 2 ? 10n ** BigInt(scale - 2) : 1n;
  const cents = scale > 2 ? (product + divisor / 2n) / divisor : product * 10n ** BigInt(2 - scale);
  const numeric = Number(cents);
  if (!Number.isSafeInteger(numeric)) throw new RangeError('El importe supera el rango de cálculo permitido.');
  return numeric / 100;
}
