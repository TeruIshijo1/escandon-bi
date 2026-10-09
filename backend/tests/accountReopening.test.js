'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
jest.mock('../services/sapAccountReview.service', () => ({ review: jest.fn() }));
const { createAccountReopeningService } = require('../services/accountReopening.service');
const SECRET = 'test-reopening-secret-with-enough-entropy';
const USER = { id: 42, username: 'operador' };
const ACCOUNT = '123';
const directories = [];
const root = path.resolve(__dirname, '../tmp/account-reopening-tests');

function validSap(overrides = {}) {
  return { account: ACCOUNT, eligible: true, status: 'eligible', complete: true, mapState: 'complete',
    accountFound: true, accountDocumentCount: 1, checkedAt: '2026-10-09T12:00:00.000Z', reopeningScenario: 'all_cancelled',
    nodes: [{ id: 'Invoices:10', entity: 'Invoices', docNum: 148186, status: 'cancelled', cancelled: true, sapStatus: 'bost_Close' }],
    invoices: [{ id: 'Invoices:10', entity: 'Invoices', docNum: 148186, status: 'cancelled', cancelled: true, sapStatus: 'bost_Close' }],
    edges: [], openDocuments: [], unknownDocuments: [], ...overrides };
}
function metadata() {
  const column = (tableName, columnName, typeName, extra = {}) => ({ tableName, columnName, typeName,
    nullable: false, computedColumn: false, maxLength: typeName === 'nvarchar' ? 64 : 4, ...extra });
  return { databaseName: 'VERTICAL_DEMO', metadataVisible: 1, pcUpdateTrigger: 0, pcdlDeleteTrigger: 0,
    columnsJson: JSON.stringify([column('PC', 'PCNum', 'int'), column('PC', 'PC_ST', 'nvarchar'),
      column('PC', 'ClosedOn', 'datetime'), column('PCDL', 'PCDLNum', 'int'), column('PCDL', 'PCNum', 'int'),
      column('PCDL', 'DocType', 'nvarchar'), column('PCDL', 'DocNum', 'int'), column('PCDL', 'DocReference', 'nvarchar'),
      column('PCDL', 'Amount', 'decimal', { precision: 28, scale: 4 }), column('PCDL', 'Empty', 'nvarchar', { nullable: true })]),
    keysJson: JSON.stringify([{ tableName: 'PC', columnName: 'PCNum', primaryKey: true, keyOrdinal: 1 },
      { tableName: 'PCDL', columnName: 'PCDLNum', primaryKey: true, keyOrdinal: 1 }]),
    triggersJson: '[]', foreignKeysJson: '[]' };
}
async function harness(options = {}) {
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'case-')); directories.push(directory);
  const db = { pcJson: '[{"PCNum":123,"PC_ST":"CL","ClosedOn":"2026-10-09T12:30:45.123"}]',
    pcdlJson: '[{"PCDLNum":900,"PCNum":123,"DocType":"Factura","DocNum":148186,"DocReference":"Cancelado","Amount":9007199254740993.0100,"Empty":null}]',
    metadata: metadata(), ...options.db };
  const events = [], transactions = [], requests = [];
  let clock = Date.parse('2026-10-09T13:00:00Z');
  const review = jest.fn().mockResolvedValue(validSap());
  const transaction = () => {
    const tx = { pendingPc: null, pendingPcdl: null,
      begin: jest.fn(async isolation => { events.push(`begin:${isolation}`); }),
      rollback: jest.fn(async () => { events.push('rollback'); if (options.rollbackError) throw new Error('rollback socket failure'); }),
      commit: jest.fn(async () => {
        events.push('commit');
        if (!options.commitError || options.commitAppliesBeforeFailure) { db.pcJson = tx.pendingPc; db.pcdlJson = tx.pendingPcdl; }
        if (options.commitError) throw new Error('commit response lost');
      }),
    };
    transactions.push(tx); return tx;
  };
  const request = tx => {
    const parameters = {};
    const result = { overrides: {}, input(name, type, value) { parameters[name] = value; return this; }, cancel: jest.fn(),
      async query(text) {
        if (text.includes('reopening:metadata')) { events.push('metadata'); return { recordset: [db.metadata] }; }
        if (text.includes('reopening:snapshot')) { events.push('snapshot'); options.afterSnapshot?.(db);
          return { recordset: [{ pcJson: db.pcJson, pcdlJson: db.pcdlJson }] }; }
        if (text.includes('reopening:children')) { events.push('children'); return { recordset: [{ rowCount: options.childCount ?? 0 }] }; }
        if (text.includes('reopening:update')) {
          events.push('update');
          if (options.beforeUpdate) await options.beforeUpdate(directory, events);
          if (options.updateError) throw new Error('sensitive update error');
          const pc = JSON.parse(db.pcJson); pc[0].PC_ST = 'OP'; tx.pendingPc = JSON.stringify(pc);
          options.afterUpdate?.(); return { rowsAffected: [options.updateRows ?? 1] };
        }
        if (text.includes('reopening:delete')) {
          events.push(`delete:${parameters.recordId}:${parameters.account}`);
          if (options.deleteError) throw new Error('sensitive delete error');
          tx.pendingPcdl = '[]'; return { rowsAffected: [options.deleteRows ?? 1] };
        }
        throw new Error('Unexpected SQL');
      },
    }; requests.push(result); return result;
  };
  const service = createAccountReopeningService({ review, sql: { Int: 'int', ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' } },
    getRemoteDb: jest.fn(async () => ({})), transaction, request, fs: options.fs || fs,
    backupDirectory: directory, secret: SECRET, now: () => clock, uuid: crypto.randomUUID });
  return { service, db, events, transactions, requests, review, directory, advance: ms => { clock += ms; } };
}
const prepare = instance => instance.service.prepare(ACCOUNT, { user: USER });
const execute = (instance, preview, extra = {}) => instance.service.execute(ACCOUNT, { user: USER,
  confirmedAccount: ACCOUNT, previewToken: preview.previewToken, ...extra });
const status = (instance, preview, extra = {}) => instance.service.status(ACCOUNT, { user: USER, previewToken: preview.previewToken, ...extra });

afterAll(async () => {
  for (const directory of directories) {
    if (!path.resolve(directory).startsWith(`${root}${path.sep}`)) throw new Error('Unsafe test cleanup path');
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('preparation reads SAP and exact locked Vertical rows, returns a signed ten-minute preview, and changes nothing', async () => {
  const instance = await harness();
  const result = await prepare(instance);
  expect(result).toMatchObject({ account: ACCOUNT, status: 'ready', verticalStatus: 'CL', recordCount: 1,
    record: { id: 900, documentType: 'Factura', documentNumber: 148186, reference: 'Cancelado', populatedFields: 6 },
    expiresAt: '2026-10-09T13:10:00.000Z', backupDirectory: instance.directory });
  const payload = jwt.verify(result.previewToken, SECRET, { ignoreExpiration: true });
  expect(payload).toMatchObject({ actorId: '42', account: ACCOUNT, purpose: 'vertical-account-reopening-preview-v1' });
  expect(payload.exp - payload.iat).toBe(600);
  expect(instance.review).toHaveBeenCalledWith(ACCOUNT, { fullMap: true, signal: undefined });
  expect(instance.transactions[0].begin).toHaveBeenCalledWith('SERIALIZABLE');
  expect(instance.transactions[0].rollback).toHaveBeenCalledTimes(1);
  expect(instance.events).toEqual(['begin:SERIALIZABLE', 'snapshot', 'metadata', 'rollback']);
  expect(instance.requests.every(request => request.overrides.requestTimeout === 30000)).toBe(true);
  expect(instance.events).not.toContain('update');
  expect(await fs.readdir(instance.directory)).toEqual([]);
});

test.each([
  ['open', { eligible: false, status: 'blocked' }], ['incomplete', { complete: false }],
  ['unknown', { unknownDocuments: [{ id: 'Invoices:10' }] }], ['wrong account', { account: '999' }],
  ['empty account', { accountFound: false, accountDocumentCount: 0, nodes: [], invoices: [] }],
  ['raw SAP Open', { nodes: [{ id: 'Invoices:10', status: 'cancelled', cancelled: true, sapStatus: 'bost_Open' }] }],
  ['invoice cancellation unknown', { nodes: [{ id: 'Invoices:10', entity: 'Invoices', status: 'closed', cancelled: null, sapStatus: 'bost_Close' }] }],
  ['invoice raw state missing', { nodes: [{ id: 'Invoices:10', entity: 'Invoices', status: 'closed', cancelled: false, sapStatus: null }] }],
  ['own invoice differs from map', { invoices: [{ id: 'Invoices:10', entity: 'Invoices', status: 'closed', cancelled: false, sapStatus: 'bost_Close' }] }],
  ['broken edge', { edges: [{ source: 'Invoices:10', target: 'Orders:999' }] }],
])('SAP %s blocks preparation before accessing Vertical', async (_, override) => {
  const instance = await harness(); instance.review.mockResolvedValue(validSap(override));
  await expect(prepare(instance)).rejects.toMatchObject({ code: 'SAP_NOT_ELIGIBLE', publicMessage: expect.any(String) });
  expect(instance.transactions).toHaveLength(0);
});

test('a SAP connection failure never accesses Vertical or exposes its details', async () => {
  const instance = await harness(); instance.review.mockRejectedValue(new Error('secret SAP password')); 
  await expect(prepare(instance)).rejects.toMatchObject({ code: 'SAP_VERIFICATION_FAILED', publicMessage: expect.not.stringContaining('password') });
  expect(instance.transactions).toHaveLength(0);
});

test.each([
  ['no document', { pcdlJson: '[]' }, 'VERTICAL_DOCUMENT_COUNT'],
  ['multiple documents', { pcdlJson: '[{"PCDLNum":900,"PCNum":123},{"PCDLNum":901,"PCNum":123}]' }, 'VERTICAL_DOCUMENT_COUNT'],
  ['already open', { pcJson: '[{"PCNum":123,"PC_ST":"OP"}]' }, 'VERTICAL_ACCOUNT_NOT_CLOSED'],
])('Vertical %s blocks preparation without picking a row heuristically', async (_, override, code) => {
  const instance = await harness({ db: override });
  await expect(prepare(instance)).rejects.toMatchObject({ code });
  expect(instance.transactions[0].rollback).toHaveBeenCalledTimes(1);
  expect(instance.events).not.toContain('update');
});

test.each(['permissions', 'trigger', 'primary key', 'missing column'])('unverified %s blocks preparation', async kind => {
  const meta = metadata();
  if (kind === 'permissions') meta.metadataVisible = 0;
  if (kind === 'trigger') meta.triggersJson = '[{"tableName":"PCDL","disabled":false}]';
  if (kind === 'primary key') meta.keysJson = '[]';
  if (kind === 'missing column') meta.columnsJson = JSON.stringify([...JSON.parse(meta.columnsJson), { tableName: 'PCDL', columnName: 'OmittedField', typeName: 'nvarchar' }]);
  const instance = await harness({ db: { metadata: meta } });
  await expect(prepare(instance)).rejects.toMatchObject({ code: kind === 'trigger' ? 'VERTICAL_TRIGGER_UNREVIEWED'
    : kind === 'missing column' ? 'VERTICAL_SNAPSHOT_INVALID' : 'VERTICAL_SCHEMA_UNVERIFIED' });
  expect(instance.events).not.toContain('update');
});

test.each([['cascade', 1, 0], ['existing children', 0, 2]])('%s dependencies prevent deletion and never remove child rows', async (_, deleteAction, childCount) => {
  const meta = metadata(); meta.foreignKeysJson = JSON.stringify([{ foreignKeyId: 1, parentSchema: 'dbo', parentTable: 'PCDL',
    parentColumn: 'PCDLNum', childSchema: 'dbo', childTable: 'DependentRecords', childColumn: 'PCDLNum', deleteAction }]);
  const instance = await harness({ db: { metadata: meta }, childCount });
  await expect(prepare(instance)).rejects.toMatchObject({ code: deleteAction ? 'VERTICAL_DEPENDENCIES_UNVERIFIED' : 'VERTICAL_DEPENDENCIES_PRESENT' });
  expect(instance.events.some(event => event.startsWith('delete:'))).toBe(false);
});

test('execution rechecks SAP, durably backs up exact SQL JSON before writes, then atomically updates and removes the exact document', async () => {
  let backup;
  const instance = await harness({ beforeUpdate: async directory => {
    const files = await fs.readdir(directory); const file = files.find(name => name.endsWith('.md'));
    expect(file).toBeDefined(); backup = await fs.readFile(path.join(directory, file), 'utf8');
    expect(backup).toContain('9007199254740993.0100');
    expect(backup).toContain('"Empty":null');
    expect(backup).toContain('2026-10-09T12:30:45.123');
    expect(backup).toContain('"typeName": "decimal"');
  } });
  const preview = await prepare(instance), result = await execute(instance, preview);
  expect(result).toMatchObject({ account: ACCOUNT, status: 'reopened', previousStatus: 'CL', currentStatus: 'OP', deletedRecordId: 900 });
  expect(instance.review).toHaveBeenCalledTimes(2);
  expect(instance.events.slice(-3)).toEqual(['update', 'delete:900:123', 'commit']);
  expect(JSON.parse(instance.db.pcJson)[0].PC_ST).toBe('OP'); expect(instance.db.pcdlJson).toBe('[]');
  expect(await status(instance, preview)).toEqual(result);
  expect(await fs.readFile(result.backupFile, 'utf8')).toBe(backup);
});

test('SAP becoming ineligible between preview and confirmation prevents every database write', async () => {
  const instance = await harness(), preview = await prepare(instance);
  instance.review.mockResolvedValue(validSap({ eligible: false, status: 'blocked' }));
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'SAP_NOT_ELIGIBLE' });
  expect(instance.events).not.toContain('update'); expect((await status(instance, preview)).status).toBe('rolled_back');
});

test.each(['PC row', 'document row', 'schema'])('changed %s invalidates the signed snapshot before backup or mutation', async kind => {
  const instance = await harness(), preview = await prepare(instance);
  if (kind === 'PC row') instance.db.pcJson = instance.db.pcJson.replace('12:30:45.123', '12:30:46.123');
  if (kind === 'document row') instance.db.pcdlJson = instance.db.pcdlJson.replace('Cancelado', 'Cambió');
  if (kind === 'schema') instance.db.metadata.columnsJson = instance.db.metadata.columnsJson.replace('"precision":28', '"precision":29');
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'VERTICAL_SNAPSHOT_CHANGED' });
  expect(instance.events).not.toContain('update'); expect((await fs.readdir(instance.directory)).filter(file => file.endsWith('.md'))).toEqual([]);
});

test('wrong user, account, confirmation, tampered token and expired preview cannot write', async () => {
  const instance = await harness(), preview = await prepare(instance);
  await expect(execute(instance, preview, { user: { id: 43 } })).rejects.toMatchObject({ code: 'PREVIEW_BINDING_MISMATCH' });
  await expect(instance.service.execute('456', { user: USER, previewToken: preview.previewToken, confirmedAccount: '456' })).rejects.toMatchObject({ code: 'PREVIEW_BINDING_MISMATCH' });
  await expect(execute(instance, preview, { confirmedAccount: '00123' })).rejects.toMatchObject({ code: 'ACCOUNT_CONFIRMATION_REQUIRED' });
  await expect(execute(instance, preview, { previewToken: `${preview.previewToken}x` })).rejects.toMatchObject({ code: 'INVALID_PREVIEW_TOKEN' });
  instance.advance(601000);
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'INVALID_PREVIEW_TOKEN' });
  expect((await status(instance, preview)).status).toBe('unknown'); expect(instance.events).not.toContain('update');
});

test.each(['update error', 'update count', 'delete error', 'delete count'])('%s rolls back the account and document together and records the outcome', async kind => {
  const instance = await harness({ updateError: kind === 'update error', updateRows: kind === 'update count' ? 0 : 1,
    deleteError: kind === 'delete error', deleteRows: kind === 'delete count' ? 0 : 1 });
  const preview = await prepare(instance), originalPc = instance.db.pcJson, originalRecord = instance.db.pcdlJson;
  await expect(execute(instance, preview)).rejects.toMatchObject({ publicMessage: expect.any(String) });
  expect(instance.db.pcJson).toBe(originalPc); expect(instance.db.pcdlJson).toBe(originalRecord);
  expect(instance.transactions[1].rollback).toHaveBeenCalledTimes(1);
  expect((await status(instance, preview)).status).toBe('rolled_back');
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'PREVIEW_ALREADY_USED', status: 409 });
});

test.each(['open', 'sync', 'readback'])('backup %s failure prevents both UPDATE and DELETE', async kind => {
  const faultyFs = { ...fs,
    async open(file, flag, mode) {
      if (file.endsWith('.md') && kind === 'open') throw new Error('disk failure');
      const handle = await fs.open(file, flag, mode);
      if (file.endsWith('.md') && kind === 'sync') return { writeFile: handle.writeFile.bind(handle), close: handle.close.bind(handle), sync: async () => { throw new Error('fsync failed'); } };
      return handle;
    },
    async readFile(file, encoding) { return file.endsWith('.md') && kind === 'readback' ? 'damaged backup' : fs.readFile(file, encoding); },
  };
  const instance = await harness({ fs: faultyFs }), preview = await prepare(instance);
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'BACKUP_WRITE_FAILED' });
  expect(instance.events).not.toContain('update'); expect(instance.events.some(event => event.startsWith('delete:'))).toBe(false);
  expect((await status(instance, preview)).status).toBe('rolled_back');
});

test('abort after UPDATE rolls back before deleting or committing', async () => {
  const controller = new AbortController();
  const instance = await harness({ afterUpdate: () => controller.abort() }), preview = await prepare(instance);
  await expect(execute(instance, preview, { signal: controller.signal })).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  expect(instance.events).toContain('update'); expect(instance.events.some(event => event.startsWith('delete:'))).toBe(false);
  expect(JSON.parse(instance.db.pcJson)[0].PC_ST).toBe('CL'); expect(instance.events).not.toContain('commit');
});

test('idempotent retries return the durable result even after preview expiry without another SAP call or write', async () => {
  const instance = await harness(), preview = await prepare(instance), result = await execute(instance, preview);
  instance.advance(601000);
  expect(await execute(instance, preview)).toEqual(result);
  expect(await status(instance, preview)).toEqual(result);
  expect(instance.review).toHaveBeenCalledTimes(2); expect(instance.events.filter(event => event === 'update')).toHaveLength(1);
});

test('a lost commit response remains unknown even if the database changed, and cannot be retried', async () => {
  const instance = await harness({ commitError: true, commitAppliesBeforeFailure: true }), preview = await prepare(instance);
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'OPERATION_STATUS_UNKNOWN' });
  expect(JSON.parse(instance.db.pcJson)[0].PC_ST).toBe('OP'); expect(instance.db.pcdlJson).toBe('[]');
  expect((await status(instance, preview)).status).toBe('unknown');
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'OPERATION_STATUS_UNKNOWN' });
  expect(instance.events.filter(event => event === 'update')).toHaveLength(1);
});

test('a concurrent confirmation cannot enter SQL while the exclusive operation receipt is pending', async () => {
  const instance = await harness(), preview = await prepare(instance);
  let release; const suspended = new Promise(resolve => { release = resolve; });
  instance.review.mockImplementationOnce(async () => { await suspended; return validSap(); });
  const first = execute(instance, preview);
  let pending;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    pending = await status(instance, preview);
    if (pending.status === 'pending') break;
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(pending.status).toBe('pending');
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'OPERATION_STATUS_UNKNOWN' });
  release(); await first;
  expect(instance.events.filter(event => event === 'update')).toHaveLength(1);
});

test('status checks remain bound to the requesting user after preview expiry', async () => {
  const instance = await harness(), preview = await prepare(instance);
  instance.advance(601000);
  await expect(status(instance, preview, { user: { id: 43 } })).rejects.toMatchObject({ code: 'PREVIEW_BINDING_MISMATCH' });
  expect((await status(instance, preview)).status).toBe('unknown');
  expect(instance.review).toHaveBeenCalledTimes(1);
});

test('schema changes observed after acquiring account locks are rejected before any write', async () => {
  const instance = await harness({ afterSnapshot: db => { db.metadata.pcdlDeleteTrigger = 1; } });
  await expect(prepare(instance)).rejects.toMatchObject({ code: 'VERTICAL_TRIGGER_UNREVIEWED' });
  expect(instance.events.slice(0, 3)).toEqual(['begin:SERIALIZABLE', 'snapshot', 'metadata']);
  expect(instance.events).not.toContain('update');
});

test('failure to persist the post-commit receipt returns unknown and prevents another mutation', async () => {
  let failApplied = true;
  const faultyFs = { ...fs, async open(file, flag, mode) {
    if (file.endsWith('.receipt.jsonl') && flag === 'a' && failApplied) { failApplied = false; throw new Error('receipt disk unavailable'); }
    return fs.open(file, flag, mode);
  } };
  const instance = await harness({ fs: faultyFs }), preview = await prepare(instance);
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'OPERATION_STATUS_UNKNOWN', status: 503 });
  expect(JSON.parse(instance.db.pcJson)[0].PC_ST).toBe('OP');
  expect((await status(instance, preview)).status).toBe('unknown');
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'OPERATION_STATUS_UNKNOWN', status: 503 });
  expect(instance.events.filter(event => event === 'update')).toHaveLength(1);
});

test('a rollback whose outcome cannot be confirmed remains unknown rather than advertising a safe retry', async () => {
  const options = {}, instance = await harness(options), preview = await prepare(instance);
  options.deleteError = true; options.rollbackError = true;
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'OPERATION_STATUS_UNKNOWN', status: 503 });
  expect((await status(instance, preview)).status).toBe('unknown');
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'OPERATION_STATUS_UNKNOWN', status: 503 });
  expect(instance.events.filter(event => event === 'update')).toHaveLength(1);
});

test('pending receipt from a restarted service is unknown, never inferred from current account state', async () => {
  const instance = await harness(), preview = await prepare(instance);
  let release; const paused = new Promise(resolve => { release = resolve; });
  instance.review.mockImplementationOnce(async () => { await paused; return validSap(); });
  const running = execute(instance, preview);
  let pending;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    pending = await status(instance, preview);
    if (pending.status === 'pending') break;
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(pending.status).toBe('pending');
  const restarted = createAccountReopeningService({ secret: SECRET, backupDirectory: instance.directory });
  expect((await restarted.status(ACCOUNT, { user: USER, previewToken: preview.previewToken })).status).toBe('unknown');
  release(); await running;
});

test('a modified receipt is rejected even if it claims that the operation was applied', async () => {
  const instance = await harness(), preview = await prepare(instance);
  await execute(instance, preview);
  const file = (await fs.readdir(instance.directory)).find(name => name.endsWith('.receipt.jsonl'));
  const location = path.join(instance.directory, file), text = await fs.readFile(location, 'utf8');
  await fs.writeFile(location, text.replace('"currentStatus":"OP"', '"currentStatus":"CL"'));
  await expect(status(instance, preview)).rejects.toMatchObject({ code: 'OPERATION_STATUS_UNKNOWN', status: 503 });
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'OPERATION_STATUS_UNKNOWN', status: 503 });
});

test('a backup directory that resolves elsewhere prevents confirmation before any receipt or database write', async () => {
  const faultyFs = { ...fs, realpath: async folder => path.join(folder, 'different-location') };
  const instance = await harness({ fs: faultyFs }), preview = await prepare(instance);
  await expect(execute(instance, preview)).rejects.toMatchObject({ code: 'BACKUP_DIRECTORY_UNVERIFIED' });
  expect(instance.events).not.toContain('update'); expect(await fs.readdir(instance.directory)).toEqual([]);
});

test('an already open account receives its useful state message even when metadata permissions are unavailable', async () => {
  const meta = metadata(); meta.metadataVisible = 0;
  const instance = await harness({ db: { metadata: meta, pcJson: '[{"PCNum":123,"PC_ST":"OP"}]', pcdlJson: '[]' } });
  await expect(prepare(instance)).rejects.toMatchObject({ code: 'VERTICAL_ACCOUNT_NOT_CLOSED',
    publicMessage: 'La cuenta ya está abierta en Vertical. No necesita volver a reaperturarse.' });
  expect(instance.events).not.toContain('metadata'); expect(instance.events).not.toContain('update');
});

test('status during directory creation cannot report that a still-running confirmation never started', async () => {
  let release, entered;
  const enteredDirectory = new Promise(resolve => { entered = resolve; });
  const delay = new Promise(resolve => { release = resolve; });
  const slowFs = { ...fs, async mkdir(folder, options) { entered(); await delay; return fs.mkdir(folder, options); } };
  const instance = await harness({ fs: slowFs }), preview = await prepare(instance);
  const running = execute(instance, preview);
  await enteredDirectory;
  expect((await status(instance, preview)).status).toBe('pending');
  const anotherProcess = createAccountReopeningService({ secret: SECRET, backupDirectory: instance.directory });
  expect((await anotherProcess.status(ACCOUNT, { user: USER, previewToken: preview.previewToken })).status).toBe('unknown');
  release(); await running;
});
