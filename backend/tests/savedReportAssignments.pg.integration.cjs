'use strict';

// Sólo un esquema temporal aleatorio, usuarios/reportes ficticios y fuente
// simulada. No asigna usuarios reales ni consulta SAP o Vertical.
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const schema = `test_saved_reports_${Date.now()}_${process.pid}`;
const connection = { user: process.env.PGUSER || 'postgres', host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'escandon_bi', port: Number(process.env.PGPORT || 5432), password: process.env.PGPASSWORD };
const adminPool = new Pool(connection);
const pool = new Pool({ ...connection, options: `-c search_path=${schema}` });
const id = require.resolve('../config/pg-db');
require.cache[id] = { id, filename: id, loaded: true, exports: { pool } };
const reports = require('../services/savedReportAccess.service');
const definition = { id: 'accounts', title: 'Cuentas FICTICIAS', source: 'SAP', requiresDateFilter: true,
  grain: 'Una fila por cuenta', fields: [{ key: 'Name', label: 'Nombre', type: 'string' }, { key: 'Balance', label: 'Saldo', type: 'money' }] };
const definitionFor = value => value === definition.id ? definition : undefined;
const administrator = { id: 101, username: 'ADMIN_FICTICIO', role: 'ADMIN', permisos: ['sap-query-accounts'] };
const recipient = { id: 102, username: 'DESTINATARIO_FICTICIO', role: 'USUARIO_OPERATIVO', permisos: [] };
const other = { id: 103, username: 'OTRO_FICTICIO', role: 'USUARIO_OPERATIVO', permisos: [] };
let schemaCreated = false;
let executed = 0;
const execute = async input => {
  executed += 1;
  assert.deepEqual(input, { entity: 'accounts', selectedFields: ['Name'], fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', busqueda: 'FICTICIO', limit: 50 });
  return { data: [{ Name: 'CUENTA FICTICIA', Balance: 98765 }], rawRows: [{ Private: 'No enviar' }],
    columnas: definition.fields, kpis: [{ label: 'Saldo', value: 98765 }], source: 'SAP', limit: 50 };
};

(async () => {
  try {
    assert.match(schema, /^test_saved_reports_\d+_\d+$/);
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await pool.query(`CREATE TABLE roles(rolid INTEGER PRIMARY KEY, nombrerol TEXT NOT NULL);
      CREATE TABLE usuarios(usuarioid INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, nombrecompleto TEXT NOT NULL,
        rolid INTEGER REFERENCES roles(rolid), areaasignada TEXT, activo INTEGER DEFAULT 1, reportespermitidos TEXT);
      CREATE TABLE usersapqueries(queryid INTEGER PRIMARY KEY, userid INTEGER, username VARCHAR(100) NOT NULL,
        titulo VARCHAR(255) NOT NULL, descripcion TEXT, entidad VARCHAR(100) NOT NULL,
        camposseleccionados JSONB DEFAULT '[]', filtrosaplicados JSONB DEFAULT '{}', espublico SMALLINT DEFAULT 0,
        fechacreacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, fechamodificacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO roles VALUES(1,'ADMIN'),(2,'USUARIO_OPERATIVO');
      INSERT INTO usuarios(usuarioid,username,nombrecompleto,rolid,activo,reportespermitidos) VALUES
        (101,'ADMIN_FICTICIO','ADMIN FICTICIO',1,1,'["sap-query-accounts"]'),
        (102,'DESTINATARIO_FICTICIO','DESTINATARIO FICTICIO',2,1,'[]'),
        (103,'OTRO_FICTICIO','OTRO FICTICIO',2,1,'[]'),
        (104,'INACTIVO_FICTICIO','INACTIVO FICTICIO',2,0,'[]');`);
    await pool.query(`INSERT INTO usersapqueries(queryid,userid,username,titulo,entidad,camposseleccionados,filtrosaplicados)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [7, 101, administrator.username, 'REPORTE FICTICIO', definition.id,
      JSON.stringify(['Name']), JSON.stringify({ fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', busqueda: 'FICTICIO', limit: 50 })]);
    const initial = (await pool.query('SELECT * FROM usersapqueries WHERE queryid=7')).rows[0];
    const usersBefore = (await pool.query('SELECT usuarioid,rolid,reportespermitidos FROM usuarios ORDER BY usuarioid')).rows;
    await reports.initAssignmentsTable();
    await reports.initAssignmentsTable();
    assert.deepEqual((await pool.query('SELECT * FROM usersapqueries WHERE queryid=7')).rows[0], initial);
    // La identidad del propietario es su ID; un renombre conserva el reporte y
    // otra persona que reutiliza su username anterior no recibe el privado.
    await pool.query('UPDATE usuarios SET username=$1 WHERE usuarioid=101', ['ADMIN_RENOMBRADO_FICTICIO']);
    await pool.query('UPDATE usuarios SET username=$1 WHERE usuarioid=103', [administrator.username]);
    assert.equal((await reports.getSavedQueries({ ...administrator, username: 'ADMIN_RENOMBRADO_FICTICIO', role: 'USUARIO_OPERATIVO' }, definitionFor))[0].isOwner, true);
    assert.deepEqual(await reports.getSavedQueries({ ...other, username: administrator.username }, definitionFor), []);
    await pool.query('UPDATE usuarios SET username=$1 WHERE usuarioid=103', [other.username]);
    await pool.query('UPDATE usuarios SET username=$1 WHERE usuarioid=101', [administrator.username]);
    assert.deepEqual(await reports.getSavedQueries(recipient, definitionFor), []);
    assert.equal(await reports.hasAssignedReports(recipient), false);
    await assert.rejects(reports.setAssignments(other, 7, [102], definitionFor), { status: 403 });
    await assert.rejects(reports.setAssignments({ ...administrator, permisos: [] }, 7, [102], definitionFor), { status: 403 });
    assert.equal((await reports.getRecipients(administrator)).some(user => user.id === 104), false);

    const assignment = await reports.setAssignments(administrator, 7, [102, 102], definitionFor);
    assert.equal(assignment.assignedUsers.length, 1);
    assert.equal(await reports.hasAssignedReports(recipient), true);
    const listed = await reports.getSavedQueries(recipient, definitionFor);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].isAssigned, true);
    assert.equal(listed[0].canAssign, false);
    assert.equal(listed[0].canDelete, false);
    assert.deepEqual(listed[0].definition.fields.map(field => field.key), ['Name']);
    assert.deepEqual(listed[0].assignedUsers, []);
    assert.deepEqual(await reports.getSavedQueries(other, definitionFor), []);
    const result = await reports.executeSavedQuery(recipient, { savedQueryId: 7 }, definitionFor, execute);
    assert.deepEqual(result.data, [{ Name: 'CUENTA FICTICIA' }]);
    assert.deepEqual(result.columnas.map(field => field.key), ['Name']);
    assert.equal(result.rawRows, undefined);
    assert.deepEqual(result.kpis.map(kpi => kpi.label), ['Registros']);
    for (const override of [{ entity: 'secret' }, { selectedFields: ['Balance'] }, { fechaDesde: '2020-01-01' }, { busqueda: '' }, { limit: 51 }]) {
      await assert.rejects(reports.executeSavedQuery(recipient, { savedQueryId: 7, ...override }, definitionFor, execute), { status: 400 });
    }
    assert.equal(executed, 1);
    await assert.rejects(reports.executeSavedQuery(other, { savedQueryId: 7 }, definitionFor, execute), { status: 403 });
    await assert.rejects(reports.deleteQuery(recipient, 7), { status: 404 });
    await assert.rejects(reports.setAssignments(administrator, 7, [104], definitionFor), { status: 400 });
    assert.equal((await reports.getSavedQueries(recipient, definitionFor)).length, 1);
    console.log('PASS: migración idempotente, asignación limitada por usuario, controles de fuente, columnas/filtros fijos y privacidad de respuesta.');

    const engine = require('../services/reportAnalysis.service');
    const analysis = engine.validateAnalysis(definition, { groupBy: ['Name'], measures: [{ op: 'count' }] });
    const analysisFilters = { ...initial.filtrosaplicados, analysis };
    await pool.query('UPDATE usersapqueries SET filtrosaplicados=$1 WHERE queryid=7', [JSON.stringify(analysisFilters)]);
    const analyze = async options => engine.applyAnalysis(definition,
      { data: [{ Name: 'CUENTA FICTICIA', Balance: 1000 }], source: 'SAP', limit: options.limit }, options.analysis,
      { selectedFields: options.selectedFields, limit: options.limit });
    const analyzed = await reports.executeSavedQuery(recipient, { savedQueryId: 7, limit: 10 }, definitionFor, analyze);
    assert.deepEqual(analyzed.data, [{ Name: 'CUENTA FICTICIA', metric_0: 1 }]);
    assert.deepEqual(analyzed.columnas.map(field => field.key), ['Name', 'metric_0']);
    assert.equal(analyzed.analysisScope.complete, true);
    assert.deepEqual((await reports.getSavedQueries(recipient, definitionFor))[0].filters.analysis, analysis);
    await assert.rejects(reports.executeSavedQuery(recipient, { savedQueryId: 7, analysis: { measures: [{ op: 'countDistinct', field: 'Balance' }] } }, definitionFor, analyze), { status: 400 });
    await assert.rejects(reports.executeSavedQuery(recipient, { savedQueryId: 7 }, definitionFor, async options => {
      await pool.query('UPDATE usersapqueries SET filtrosaplicados=$1 WHERE queryid=7', [JSON.stringify(initial.filtrosaplicados)]);
      return analyze(options);
    }), { status: 409 });
    await pool.query('UPDATE usersapqueries SET filtrosaplicados=$1 WHERE queryid=7', [JSON.stringify(analysisFilters)]);
    await assert.rejects(reports.executeSavedQuery(recipient, { savedQueryId: 7 }, definitionFor, async options => {
      await reports.setAssignments(administrator, 7, [], definitionFor);
      return analyze(options);
    }), { status: 403 });
    await reports.setAssignments(administrator, 7, [102], definitionFor);
    await pool.query('UPDATE usersapqueries SET filtrosaplicados=$1 WHERE queryid=7', [JSON.stringify(initial.filtrosaplicados)]);
    console.log('PASS: análisis canónico persistido en JSONB, alias métricos limitados, sin ampliación de fuentes y revisión de cambios/revocación tras consultar.');

    // Dos reemplazos se serializan al bloquear la fila del reporte.
    await Promise.all([reports.setAssignments(administrator, 7, [102], definitionFor), reports.setAssignments(administrator, 7, [103], definitionFor)]);
    const concurrent = (await pool.query('SELECT userid FROM usersapqueryassignments WHERE queryid=7')).rows;
    assert.equal(concurrent.length, 1);
    await reports.setAssignments(administrator, 7, [102], definitionFor);
    await pool.query('UPDATE usuarios SET activo=0 WHERE usuarioid=102');
    assert.equal(await reports.hasAssignedReports(recipient), false);
    assert.deepEqual(await reports.getSavedQueries(recipient, definitionFor), []);
    await assert.rejects(reports.executeSavedQuery(recipient, { savedQueryId: 7 }, definitionFor, execute), { status: 403 });
    await pool.query('UPDATE usuarios SET activo=1 WHERE usuarioid=102');
    await reports.setAssignments(administrator, 7, [], definitionFor);
    assert.equal(await reports.hasAssignedReports(recipient), false);
    await assert.rejects(reports.executeSavedQuery(recipient, { savedQueryId: 7 }, definitionFor, execute), { status: 403 });
    assert.deepEqual((await pool.query('SELECT usuarioid,rolid,reportespermitidos FROM usuarios ORDER BY usuarioid')).rows, usersBefore);
    await reports.setAssignments(administrator, 7, [102], definitionFor);
    await reports.deleteQuery(administrator, 7);
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM usersapqueryassignments')).rows[0].count), 0);
    console.log('PASS: reemplazos concurrentes completos, bajas/revocación efectivas, permisos y roles intactos y borrado con cascada.');
  } finally {
    await pool.end();
    if (schemaCreated) {
      assert.match(schema, /^test_saved_reports_\d+_\d+$/);
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      console.log('PASS: esquema temporal eliminado.');
    }
    await adminPool.end();
  }
})().catch(error => {
  console.error(JSON.stringify({ failed: true, code: error.code || 'ASSERTION', name: error.name }));
  process.exitCode = 1;
});
