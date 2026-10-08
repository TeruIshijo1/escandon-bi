'use strict';

// El navegador usa las rutas y servicios reales, con un esquema PostgreSQL
// temporal. Las fuentes clínicas y SAP son ficticias y nunca reciben escrituras.
const path = require('node:path');
const assert = require('node:assert/strict');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });
const { Pool } = require('pg');
const express = require('express');
const schema = `test_honorarios_browser_${Date.now()}`;
const config = { user: process.env.PGUSER || 'postgres', host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'escandon_bi', port: Number(process.env.PGPORT || 5432), password: process.env.PGPASSWORD };
const admin = new Pool(config);
const pool = new Pool({ ...config, options: `-c search_path=${schema}` });
const cache = (modulePath, exports) => {
  const id = require.resolve(modulePath); require.cache[id] = { id, filename: id, loaded: true, exports };
};
cache('../../config/db', { getDb: () => ({ pool }) });
const sources = require('../../services/honorariosSources.service');
const catalog = require('../../services/honorariosCatalog.service');
const user = { id: 7, nombre: 'REVISOR FICTICIO', username: 'qa-honorarios', role: 'ADMIN', permisos: ['interconsultas-jornadas'] };
const providers = [{ id: 7, name: 'MÉDICO FICTICIO' }, { id: 8, name: 'OTRO MÉDICO FICTICIO' }];
const state = { failTariff: false, tariffWrites: 0 };
const remote = { request() { const params = {}; return { input(key, value) { params[key] = value; return this; },
  async query(sql) {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|EXEC|INTO)\b/i);
    let rows = [];
    if (sql === catalog.CATALOG_SQL) rows = [
      { ItemCode: 'SER1471', ItemDescription: 'SESIÓN PSICOLOGÍA DE PRUEBA', ItemType: 'S', ItemGroupName: 'CONSULTA EXTERNA', Enabled: true },
      { ItemCode: 'SER0507', ItemDescription: 'INTERCONSULTA DE PRUEBA', ItemType: 'S', ItemGroupName: 'URGENCIAS 1', Enabled: true }
    ];
    else if (sql === catalog.REFERENCE_SQL) rows = [
      { Id_UT: 1, ITEMCODE: 'SER1471', IMPORTE: 250 }, { Id_UT: 2, ITEMCODE: 'SER0507', IMPORTE: 600 }
    ];
    else if (sql === sources.ORDER_CANDIDATES_SQL) rows = [
      { SONum: 181, SOLNNum: 91, ItemCode: 'SER1471', ItemDescription: 'SESIÓN PSICOLOGÍA DE PRUEBA',
        ItemGroupName: 'CONSULTA EXTERNA', Quantity: 1, ServiceDate: '2026-09-02', ServiceDateType: 'FECHA_SERVICIO_ORDEN',
        RequesterId: 7, RequesterName: 'MÉDICO FICTICIO', AppointmentCount: 0, ServiceLineCount: 1,
        SO_ST: 'PR', SOLN_ST: 'PR', UDF_Realizado: null }
    ].filter(row => row.ServiceDate >= params.startDate && row.ServiceDate <= params.endDate);
    else if (/FROM PR WHERE Role='P'/.test(sql)) rows = providers.map(item => ({ PRNum: item.id, FullName: item.name, Role: 'P' }));
    return { recordset: rows };
  }
}; } };
cache('../../config/remote-db', { connectRemoteDB: async () => remote, getRemoteDb: async () => remote });
cache('../../middleware/auth.middleware', { authenticate(req, _res, next) { req.user = user; next(); },
  authorize: () => (_req, _res, next) => next() });
cache('../../services/honorariosSapReconciliation.service', { reconcileHonorariosWithSap: async ({ doctors, startDate, endDate }) => ({
  ok: true, asOf: new Date().toISOString(), period: { startDate, endDate }, additionalProviders: [],
  providers: Object.fromEntries(doctors.map(name => [name, { linkStatus: 'sin_coincidencia', candidates: [], invoices: [] }])) }) });
cache('../../services/honorariosFiscalDirectory.service', { getFiscalDirectory: async (_remote, { date }) => ({
  date, sapAvailable: false, doctors: providers.map(item => ({ providerId: String(item.id), sapReady: false,
    suggestedProfile: {}, sap: { linkStatus: 'sin_coincidencia', candidates: [] } })) }) });
const app = express();
app.use(express.json());
app.get('/api/auth/me', (_req, res) => res.json({ user }));
app.use('/api/honorarios', (req, res, next) => {
  if (req.method === 'POST' && req.path.endsWith('/tariffs')) {
    state.tariffWrites++;
    if (state.failTariff) return res.status(503).json({ error: 'No se pudo guardar la tarifa de prueba. Intenta de nuevo.' });
  }
  next();
}, require('../../routes/honorarios.routes'));
module.exports = { app, state, pool,
  async start() { await admin.query(`CREATE SCHEMA ${schema}`); },
  async close() {
    await pool.end();
    if (!/^test_honorarios_browser_\d+$/.test(schema)) throw Error('Esquema de prueba inesperado');
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  }
};
