import test from 'node:test';
import assert from 'node:assert/strict';
import { userMessage } from '../src/utils/userMessages.js';

test('technical failures are replaced with useful notices', () => {
  for (const message of [
    'relation "bi_honorarios_tariffs" does not exist',
    'Invalid object name dbo.UT_Honorarios',
    'Cannot read properties of undefined (reading amount)',
    'Unexpected token <, <!DOCTYPE html>',
    'Error del servidor: 500',
    'Request failed with status code 500',
    'Error de base de datos: UDR_CUENTAS_SERVICIOS',
    { error: 'SQLSTATE 42P01: relation missing' },
  ]) {
    const result = userMessage(message);
    assert.match(result, /Intenta de nuevo/);
    assert.doesNotMatch(result, /UT_|bi_|SQL|undefined|DOCTYPE|500/);
  }
});

test('network, permissions and expired sessions explain the next step', () => {
  assert.match(userMessage(new TypeError('Failed to fetch')), /Revisa tu conexión/);
  assert.match(userMessage('Token inválido', 401), /Inicia sesión de nuevo/);
  assert.match(userMessage('Forbidden', 403), /Solicita acceso/);
  assert.match(userMessage('Too many requests', 429), /Espera unos minutos/);
});

test('specific corrections and login errors remain useful', () => {
  const validation = 'Ya hay una tarifa para este médico en esas fechas. Ajusta las fechas.';
  assert.equal(userMessage(validation, 409), validation);
  assert.match(userMessage('Credenciales incorrectas', 401), /usuario o la contraseña/);
  assert.match(userMessage('Sin referencia en UT_Honorarios'), /precio de referencia/);
});
