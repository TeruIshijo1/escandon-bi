/**
 * eslint.config.js — Configuración ESLint 9 (flat config) del backend
 */
'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'uploads/**',
      'data/**',
      'database/**',
      'scratch/**',
      'scratch_*.js',
      'test_*.js',
      'write_test.js',
      'replace.js',
      '*.log',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.commonjs },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off', // El proyecto usa console.log extensivamente como logging
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'eqeqeq': ['warn', 'smart'],
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-duplicate-imports': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-extra-semi': 'warn',
    },
  },
  {
    files: ['tests/**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
];