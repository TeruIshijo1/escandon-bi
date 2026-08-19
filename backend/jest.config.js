/**
 * jest.config.js — Configuración de tests del backend
 */
'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/jest.setup.js'],
  collectCoverageFrom: [
    'middleware/**/*.js',
    'utils/**/*.js',
    'routes/auth.routes.js',
    'routes/export.routes.js',
  ],
  coverageDirectory: 'coverage',
  openHandlesTimeout: 10000,
  verbose: true,
};