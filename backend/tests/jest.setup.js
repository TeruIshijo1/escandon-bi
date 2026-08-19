/**
 * jest.setup.js — Variables de entorno mínimas para tests
 * (auth.middleware exige JWT_SECRET y JWT_REFRESH al cargar)
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_no_usar_en_produccion_0123456789abcdef';
process.env.JWT_REFRESH = 'test_refresh_no_usar_en_produccion_0123456789abcdef';
process.env.JWT_EXPIRY = '8h';
process.env.CORS_ORIGIN = 'http://localhost:5173';