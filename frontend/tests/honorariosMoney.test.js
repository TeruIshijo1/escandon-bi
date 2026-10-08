import test from 'node:test';
import assert from 'node:assert/strict';
import { multiplyHonorario } from '../src/utils/honorariosMoney.js';

test('tarifa por cantidad conserva los medios centavos en cantidades fraccionarias', () => {
  for (const [unit, quantity, expected] of [[33.5, .03, 1.01], [2.3, .95, 2.19], [2.5, .87, 2.18],
    [2.65, .9, 2.39], [100000.35, .5, 50000.18], [214.5, 23, 4933.5]]) {
    assert.equal(multiplyHonorario(unit, quantity), expected, `${unit} × ${quantity}`);
  }
});

test('cantidades pequeñas y notación exponencial conservan el redondeo decimal', () => {
  assert.equal(multiplyHonorario(1000000, 1e-8), .01);
  assert.equal(multiplyHonorario(.01, .49), 0);
  assert.equal(multiplyHonorario(.01, .5), .01);
  assert.equal(multiplyHonorario(123.45, 0), 0);
});

test('datos incompletos e importes fuera de rango no se convierten en un pago', () => {
  for (const value of [null, undefined, '', '2.50', -1, NaN, Infinity]) {
    assert.throws(() => multiplyHonorario(value, 1));
    assert.throws(() => multiplyHonorario(1, value));
  }
  assert.throws(() => multiplyHonorario(1e20, 1));
});
