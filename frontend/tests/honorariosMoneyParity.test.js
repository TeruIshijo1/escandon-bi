import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { multiplyHonorario as frontendAmount } from '../src/utils/honorariosMoney.js';

const { multiplyHonorario: backendAmount } = createRequire(import.meta.url)('../../backend/utils/honorariosMoney.js');

test('frontend y backend coinciden con el oráculo entero en 1,039,896 tarifas y cantidades', () => {
  const quantities = [...Array.from({ length: 99 }, (_, index) => index + 1), 101, 150, 299, 999, 9900];
  let verified = 0;
  for (let unitCents = 1; unitCents <= 9999; unitCents += 1) {
    for (const quantityHundredths of quantities) {
      // Ambos operandos se expresan en centésimas; el producto en centavos
      // tiene divisor 100. Este oráculo no usa el parser decimal de la app.
      const expectedCents = (BigInt(unitCents) * BigInt(quantityHundredths) + 50n) / 100n;
      const expected = Number(expectedCents) / 100;
      const unit = unitCents / 100, quantity = quantityHundredths / 100;
      const shown = frontendAmount(unit, quantity), frozen = backendAmount(unit, quantity);
      if (shown !== expected || frozen !== expected) {
        assert.fail(`${unit} × ${quantity}: esperado ${expected}; pantalla ${shown}; aprobación ${frozen}`);
      }
      verified += 1;
    }
  }
  assert.equal(verified, 1039896);
});

test('la paridad también conserva cantidades de tres decimales y notación exponencial', () => {
  for (const [unit, quantity, expected] of [[33.5, .003, .10], [33.5, .015, .50], [2.5, .002, .01],
    [1000000, 1e-8, .01], [.01, .499999999, 0], [.01, .5, .01], [123.45, 0, 0]]) {
    assert.equal(frontendAmount(unit, quantity), expected, `pantalla: ${unit} × ${quantity}`);
    assert.equal(backendAmount(unit, quantity), expected, `aprobación: ${unit} × ${quantity}`);
  }
});
