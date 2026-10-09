'use strict';

jest.mock('../config/pg-db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
const { pool } = require('../config/pg-db');
const access = require('../services/savedReportAccess.service');
const definition = { id: 'accounts', title: 'Cuentas', source: 'SAP', grain: 'Una fila por cuenta',
  requiresDateFilter: true, fields: [{ key: 'Name', label: 'Nombre', type: 'string' }, { key: 'Balance', label: 'Saldo', type: 'money' }] };
const definitionFor = id => id === definition.id ? definition : undefined;
const admin = { id: 1, username: 'admin_test', role: 'ADMIN', permisos: ['sap-query-accounts'] };
const recipient = { id: 2, username: 'recipient_test', role: 'USUARIO_OPERATIVO', permisos: [] };
const saved = changes => ({ queryid: 7, userid: 1, username: 'admin_test', titulo: 'Mi reporte', entidad: 'accounts',
  camposseleccionados: ['Name'], filtrosaplicados: { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', busqueda: 'Autorizado', limit: 20 },
  espublico: 0, isassigned: true, ...changes });
let client;
beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockResolvedValue({ rows: [saved()], rowCount: 1 });
  client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
});

test('only ADMIN and the designated superadministrator can manage assignments', async () => {
  expect(access.canAssign(admin)).toBe(true);
  expect(access.canAssign({ username: 'AMENDOZA', role: 'USUARIO_OPERATIVO' })).toBe(true);
  for (const role of ['DIRECTOR', 'JEFE_AREA', 'USUARIO_OPERATIVO']) {
    expect(access.canAssign({ role, permisos: ['administracion', 'sap-query-accounts'] })).toBe(false);
    await expect(access.setAssignments({ role }, 7, [2], definitionFor)).rejects.toMatchObject({ status: 403 });
  }
  expect(pool.connect).not.toHaveBeenCalled();
});

test('a report assignment runs the stored source, columns and filters, returning only those columns and no extra aggregate', async () => {
  const execute = jest.fn().mockResolvedValue({ data: [{ Name: 'Permitido', Balance: 9000, Secret: 'No autorizado' }],
    columnas: definition.fields, rawRows: [{ Secret: 'privado' }], allFields: definition.fields, limit: 10,
    kpis: [{ label: 'Saldo total', value: 9000 }], source: 'SAP', grain: definition.grain });
  const result = await access.executeSavedQuery(recipient, { savedQueryId: 7, limit: 10 }, definitionFor, execute);
  expect(execute).toHaveBeenCalledWith({ entity: 'accounts', selectedFields: ['Name'], fechaDesde: '2026-09-01',
    fechaHasta: '2026-09-30', busqueda: 'Autorizado', limit: 10 });
  expect(result.data).toEqual([{ Name: 'Permitido' }]);
  expect(result.columnas).toEqual([expect.objectContaining({ key: 'Name' })]);
  expect(result.kpis).toEqual([{ label: 'Registros', value: '1', color: '#2563EB' }]);
  expect(result).not.toHaveProperty('rawRows');
  expect(result).not.toHaveProperty('allFields');
  expect(recipient.permisos).toEqual([]);
});

test.each(['entity', 'selectedFields', 'fechaDesde', 'fechaHasta', 'busqueda', 'almacen', 'filters'])('delegated execution rejects overriding %s', async key => {
  const execute = jest.fn();
  await expect(access.executeSavedQuery(recipient, { savedQueryId: 7, [key]: 'changed' }, definitionFor, execute)).rejects.toMatchObject({ status: 400 });
  expect(pool.query).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

test('stored row cap may be reduced but never widened', async () => {
  const execute = jest.fn();
  await expect(access.executeSavedQuery(recipient, { savedQueryId: 7, limit: 21 }, definitionFor, execute)).rejects.toMatchObject({ status: 400 });
  expect(execute).not.toHaveBeenCalled();
});

test('assigned analyses preserve metric aliases and prune internal fields and unrelated results', async () => {
  const analysis = { predicates: [{ field: 'Balance', op: 'gt', value: 0 }], groupBy: ['Name'], measures: [{ op: 'count' }], orderBy: [] };
  pool.query.mockResolvedValue({ rows: [saved({ filtrosaplicados: { analysis, limit: 20 } })] });
  const execute = jest.fn().mockResolvedValue({ data: [{ Name: 'Grupo permitido', metric_0: 3, metric_1: 900, Balance: 1000, Secret: 'privado' }],
    columnas: [...definition.fields, { key: 'metric_0', label: 'Registros', type: 'number' }, { key: 'metric_1', label: 'Ajeno' }],
    rawRows: [{ Secret: 'privado' }], limit: 10 });
  const result = await access.executeSavedQuery(recipient, { savedQueryId: 7, limit: 10 }, definitionFor, execute);
  expect(execute.mock.calls[0][0].analysis.predicates[0].value).toBe('0');
  expect(result.data).toEqual([{ Name: 'Grupo permitido', metric_0: 3 }]);
  expect(result.columnas.map(column => column.key)).toEqual(['Name', 'metric_0']);
  expect(result).not.toHaveProperty('rawRows');
  expect(recipient.permisos).toEqual([]);
  await expect(access.executeSavedQuery(recipient, { savedQueryId: 7, analysis }, definitionFor, execute)).rejects.toMatchObject({ status: 400 });
});

test('assigned analyses fail closed when a stored field retires or the plan changes during execution', async () => {
  const analysis = { predicates: [{ field: 'Balance', op: 'gt', value: 0 }], measures: [{ op: 'count' }] };
  const row = saved({ filtrosaplicados: { analysis } });
  pool.query.mockResolvedValue({ rows: [row] });
  const execute = jest.fn().mockResolvedValue({ data: [{ metric_0: 1 }], columnas: [{ key: 'metric_0', label: 'Registros' }] });
  await expect(access.executeSavedQuery(recipient, { savedQueryId: 7 }, () => ({ ...definition, fields: definition.fields.slice(0, 1) }), execute)).rejects.toMatchObject({ status: 409 });
  expect(execute).not.toHaveBeenCalled();
  pool.query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [saved({ filtrosaplicados: { analysis: { measures: [{ op: 'count' }] } } })] });
  await expect(access.executeSavedQuery(recipient, { savedQueryId: 7 }, definitionFor, execute)).rejects.toMatchObject({ status: 409 });
});

test('revoked or inactive recipients cannot run the report and public visibility never grants source access', async () => {
  const execute = jest.fn();
  pool.query.mockResolvedValue({ rows: [saved({ isassigned: false, espublico: 1 })] });
  await expect(access.executeSavedQuery(recipient, { savedQueryId: 7 }, definitionFor, execute)).rejects.toMatchObject({ status: 403 });
  expect(execute).not.toHaveBeenCalled();
  expect(pool.query.mock.calls[0][0]).toContain('recipient.activo=1');
});

test('revocation during source execution is checked again before returning results', async () => {
  pool.query.mockResolvedValueOnce({ rows: [saved()] }).mockResolvedValueOnce({ rows: [saved({ isassigned: false })] });
  await expect(access.executeSavedQuery(recipient, { savedQueryId: 7 }, definitionFor,
    async () => ({ data: [{ Name: 'Dato' }] }))).rejects.toMatchObject({ status: 403 });
});

test('changed/removed stored columns fail closed rather than substituting default columns', async () => {
  pool.query.mockResolvedValue({ rows: [saved({ camposseleccionados: ['Retired'] })] });
  const execute = jest.fn();
  await expect(access.executeSavedQuery(recipient, { savedQueryId: 7 }, definitionFor, execute)).rejects.toMatchObject({ status: 409 });
  expect(execute).not.toHaveBeenCalled();
});

test('saved list exposes only the report definition to assigned users and hides other recipients', async () => {
  const result = await access.getSavedQueries(recipient, definitionFor);
  expect(result[0]).toMatchObject({ id: 7, isAssigned: true, canAssign: false, canDelete: false, executionLocked: true,
    assignedUsers: [], definition: { fields: [expect.objectContaining({ key: 'Name' })], defaultFields: ['Name'] } });
  expect(result[0].definition.fields).toHaveLength(1);
  expect(pool.query).toHaveBeenCalledTimes(1);
});

test('assignment replacement locks the report, checks active users and writes no general permissions', async () => {
  client.query.mockImplementation(async (query) => {
    if (query.includes('FROM usersapqueries q')) return { rows: [saved()] };
    if (query.startsWith('SELECT usuarioid')) return { rows: [{ usuarioid: 2 }] };
    if (query.startsWith('SELECT a.queryid')) return { rows: [{ queryid: 7, id: 2, username: 'recipient_test', nombre: 'Ficticio', activo: 1 }] };
    return { rows: [], rowCount: 1 };
  });
  const result = await access.setAssignments(admin, '7', [2, '2'], definitionFor);
  expect(result).toMatchObject({ savedQueryId: 7, assignedUsers: [{ id: 2, username: 'recipient_test', nombre: 'Ficticio', activo: true }] });
  const sql = client.query.mock.calls.map(call => call[0]).join('\n');
  expect(sql).toContain('FOR UPDATE OF q');
  expect(sql).toContain('AND activo=1 FOR SHARE');
  expect(sql).not.toMatch(/UPDATE\s+usuarios|reportespermitidos|rolid\s*=/i);
  expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  expect(client.release).toHaveBeenCalled();
});

test('an unavailable recipient rolls back and retains existing assignments', async () => {
  client.query.mockImplementation(async query => ({ rows: query.includes('FROM usersapqueries q') ? [saved()] : [] }));
  await expect(access.setAssignments(admin, 7, [2], definitionFor)).rejects.toMatchObject({ status: 400 });
  expect(client.query.mock.calls.map(call => call[0])).not.toContain('DELETE FROM usersapqueryassignments WHERE queryid=$1');
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});

test('administrators cannot assign a source they are not authorized to read', async () => {
  client.query.mockImplementation(async query => ({ rows: query.includes('FROM usersapqueries q') ? [saved()] : [] }));
  await expect(access.setAssignments({ ...admin, permisos: [] }, 7, [2], definitionFor)).rejects.toMatchObject({ status: 403 });
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});

test('recipients cannot delete reports from other owners', async () => {
  pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  await expect(access.deleteQuery(recipient, 7)).rejects.toMatchObject({ status: 404 });
  expect(pool.query.mock.calls[0][0]).toContain('userid=$2');
  expect(pool.query.mock.calls[0][1]).toEqual([7, 2, 'recipient_test']);
});
