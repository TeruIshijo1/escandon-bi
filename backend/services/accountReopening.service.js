'use strict';

const crypto = require('crypto');
const path = require('path');
const nativeFs = require('fs/promises');
const jwt = require('jsonwebtoken');
const remote = require('../config/remote-db');
const sapAccountReview = require('./sapAccountReview.service');

const TOKEN_PURPOSE = 'vertical-account-reopening-preview-v1';
const TOKEN_SECONDS = 600;
const METADATA_SQL = `/* reopening:metadata */
SELECT DB_NAME() AS databaseName, CASE WHEN HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','VIEW DEFINITION')=1
 OR IS_MEMBER('db_owner')=1 OR IS_SRVROLEMEMBER('sysadmin')=1 THEN 1 ELSE 0 END AS metadataVisible,
 OBJECTPROPERTYEX(OBJECT_ID(N'dbo.PC'),'TableHasUpdateTrigger') AS pcUpdateTrigger,
 OBJECTPROPERTYEX(OBJECT_ID(N'dbo.PCDL'),'TableHasDeleteTrigger') AS pcdlDeleteTrigger,
 (SELECT t.name AS tableName,c.name AS columnName,ty.name AS typeName,c.column_id AS columnId,
 c.max_length AS maxLength,c.precision AS precision,c.scale AS scale,c.is_nullable AS nullable,
 c.is_identity AS identityColumn,c.is_computed AS computedColumn
 FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
 JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
 WHERE s.name=N'dbo' AND t.name IN(N'PC',N'PCDL') ORDER BY t.name,c.column_id
 FOR JSON PATH,INCLUDE_NULL_VALUES) AS columnsJson,
 (SELECT t.name AS tableName,i.name AS indexName,i.is_primary_key AS primaryKey,i.is_unique AS uniqueKey,
 i.is_disabled AS disabled,i.is_hypothetical AS hypothetical,c.name AS columnName,ic.key_ordinal AS keyOrdinal
 FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
 JOIN sys.indexes i ON i.object_id=t.object_id JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
 JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
 WHERE s.name=N'dbo' AND t.name IN(N'PC',N'PCDL') AND (i.is_unique=1 OR i.is_primary_key=1) AND ic.key_ordinal>0
 ORDER BY t.name,i.index_id,ic.key_ordinal FOR JSON PATH,INCLUDE_NULL_VALUES) AS keysJson,
 (SELECT t.name AS tableName,tr.name AS triggerName,tr.is_disabled AS disabled,
 tr.is_instead_of_trigger AS insteadOf,OBJECT_DEFINITION(tr.object_id) AS definition
 FROM sys.triggers tr JOIN sys.tables t ON t.object_id=tr.parent_id JOIN sys.schemas s ON s.schema_id=t.schema_id
 WHERE s.name=N'dbo' AND t.name IN(N'PC',N'PCDL') ORDER BY t.name,tr.name
 FOR JSON PATH,INCLUDE_NULL_VALUES) AS triggersJson,
 (SELECT fk.object_id AS foreignKeyId,fk.name AS foreignKeyName,cs.name AS childSchema,ct.name AS childTable,
 cc.name AS childColumn,ps.name AS parentSchema,pt.name AS parentTable,pc.name AS parentColumn,
 fkc.constraint_column_id AS ordinal,fk.delete_referential_action AS deleteAction,
 fk.update_referential_action AS updateAction,fk.is_disabled AS disabled,fk.is_not_trusted AS untrusted
 FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
 JOIN sys.tables ct ON ct.object_id=fk.parent_object_id JOIN sys.schemas cs ON cs.schema_id=ct.schema_id
 JOIN sys.columns cc ON cc.object_id=ct.object_id AND cc.column_id=fkc.parent_column_id
 JOIN sys.tables pt ON pt.object_id=fk.referenced_object_id JOIN sys.schemas ps ON ps.schema_id=pt.schema_id
 JOIN sys.columns pc ON pc.object_id=pt.object_id AND pc.column_id=fkc.referenced_column_id
 WHERE (ps.name=N'dbo' AND pt.name IN(N'PC',N'PCDL')) OR (cs.name=N'dbo' AND ct.name IN(N'PC',N'PCDL'))
 ORDER BY fk.object_id,fkc.constraint_column_id FOR JSON PATH,INCLUDE_NULL_VALUES) AS foreignKeysJson;`;
const SNAPSHOT_SQL = `/* reopening:snapshot */ SELECT
 (SELECT pc.* FROM [dbo].[PC] pc WITH(UPDLOCK,HOLDLOCK) WHERE pc.[PCNum]=@account
 FOR JSON PATH,INCLUDE_NULL_VALUES) AS pcJson,
 (SELECT pcdl.* FROM [dbo].[PCDL] pcdl WITH(UPDLOCK,HOLDLOCK) WHERE pcdl.[PCNum]=@account ORDER BY pcdl.[PCDLNum]
 FOR JSON PATH,INCLUDE_NULL_VALUES) AS pcdlJson;`;
const UPDATE_SQL = `/* reopening:update */ UPDATE [dbo].[PC] SET [PC_ST]=N'OP' WHERE [PCNum]=@account AND [PC_ST]=N'CL';`;
const DELETE_SQL = `/* reopening:delete */ DELETE FROM [dbo].[PCDL] WHERE [PCDLNum]=@recordId AND [PCNum]=@account;`;

function failure(message, code, status = 409) {
  return Object.assign(new Error(message), { publicMessage: message, safe: true, code, status });
}
function cancelled(signal) {
  if (signal?.aborted) throw failure('La reapertura fue cancelada antes de confirmar los cambios.', 'REQUEST_CANCELLED');
}
function number(value) {
  const text = String(value ?? '').trim();
  const parsed = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2147483647) throw failure('El número de cuenta no es válido.', 'INVALID_ACCOUNT', 400);
  return String(parsed);
}
function actor(user) {
  const id = user?.id ?? user?.sub;
  if (!['string', 'number'].includes(typeof id) || !String(id).trim() || String(id).length > 120) {
    throw failure('No se pudo identificar al usuario que solicita la reapertura.', 'ACTOR_REQUIRED', 403);
  }
  return { id: String(id), username: String(user.username || '').slice(0, 120) };
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function jsonArray(raw) {
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error();
    return rows;
  } catch { throw failure('No se pudo obtener una copia completa de los registros de Vertical.', 'VERTICAL_SNAPSHOT_INVALID'); }
}
function quoteIdentifier(value) {
  if (typeof value !== 'string' || !value || value.length > 128 || [...value].some(character => character.charCodeAt(0) < 32)) throw failure('No se pudieron verificar las relaciones de Vertical.', 'VERTICAL_SCHEMA_UNVERIFIED');
  return `[${value.replaceAll(']', ']]')}]`;
}

function createAccountReopeningService(dependencies = {}) {
  const fs = dependencies.fs || nativeFs;
  const sql = dependencies.sql || remote.sql;
  const getRemoteDb = dependencies.getRemoteDb || remote.getRemoteDb;
  const review = dependencies.review || sapAccountReview.review;
  const now = dependencies.now || Date.now;
  const uuid = dependencies.uuid || crypto.randomUUID;
  const secret = () => dependencies.secret || process.env.JWT_SECRET;
  const directory = () => path.resolve(dependencies.backupDirectory || process.env.ACCOUNT_REOPENING_BACKUP_DIR || 'D:\\Escritorio\\Reaperturas');
  const active = new Set();

  async function verifiedDirectory(create = false) {
    const expected = directory();
    if (create) await fs.mkdir(expected, { recursive: true });
    let actual;
    try { actual = await fs.realpath(expected); }
    catch (error) { if (!create && error.code === 'ENOENT') return expected; throw error; }
    const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (normalize(actual) !== normalize(expected)) throw failure('La carpeta de respaldo requiere revisión antes de reaperturar la cuenta.', 'BACKUP_DIRECTORY_UNVERIFIED', 503);
    return actual;
  }

  function signingKey() {
    if (typeof secret() !== 'string' || secret().length < 16) throw failure('La firma de confirmaciones no está configurada.', 'PREVIEW_SIGNING_UNAVAILABLE', 503);
    return secret();
  }
  function token(value, account, user, ignoreExpiration = false) {
    let payload;
    try { payload = jwt.verify(value, signingKey(), { algorithms: ['HS256'], audience: TOKEN_PURPOSE,
      issuer: 'escandon-bi', clockTimestamp: Math.floor(now() / 1000), ignoreExpiration }); }
    catch { throw failure('La confirmación venció o no es válida. Revisa de nuevo la cuenta.', 'INVALID_PREVIEW_TOKEN', 400); }
    if (payload.purpose !== TOKEN_PURPOSE || payload.account !== account || payload.actorId !== user.id
      || !/^[0-9a-f-]{36}$/i.test(payload.operationId || '') || !/^[0-9a-f]{64}$/.test(payload.snapshotDigest || '')) {
      throw failure('La confirmación no corresponde a esta cuenta y usuario.', 'PREVIEW_BINDING_MISMATCH', 403);
    }
    return payload;
  }
  async function freshSap(account, signal) {
    cancelled(signal);
    let result;
    try { result = await review(account, { fullMap: true, signal }); }
    catch { cancelled(signal); throw failure('No se pudo verificar el mapa completo de SAP. Vuelve a consultar la cuenta.', 'SAP_VERIFICATION_FAILED', 502); }
    cancelled(signal);
    const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
    const ids = new Set(nodes.map(node => node?.id));
    const byId = new Map(nodes.map(node => [node?.id, node]));
    const coherent = node => node && ['closed', 'cancelled', 'settled'].includes(node.status)
      && !['bost_Open', 'O'].includes(node.sapStatus) && !node.cancellationStatusConflict
      && (node.status === 'cancelled' ? node.cancelled === true : node.cancelled !== true)
      && (node.entity !== 'Invoices' || (node.status === 'cancelled' && node.cancelled === true)
        || (node.status === 'closed' && node.cancelled === false && ['bost_Close', 'C'].includes(node.sapStatus)));
    if (result?.account !== account || result?.eligible !== true || result?.status !== 'eligible'
      || result?.complete !== true || result?.mapState !== 'complete' || result?.accountFound !== true
      || !(result.accountDocumentCount > 0) || !Array.isArray(result.nodes) || !result.nodes.length || ids.size !== result.nodes.length
      || !Array.isArray(result.openDocuments) || result.openDocuments.length || !Array.isArray(result.unknownDocuments) || result.unknownDocuments.length
      || nodes.some(node => !node?.id || !coherent(node))
      || !Array.isArray(result.edges) || result.edges.some(edge => !edge || !ids.has(edge.source) || !ids.has(edge.target))
      || !Array.isArray(result.invoices) || result.invoices.some(invoice => {
        const mapped = byId.get(invoice?.id);
        return !invoice || !mapped || mapped.entity !== 'Invoices' || !coherent(invoice)
          || invoice.entity !== mapped.entity || invoice.status !== mapped.status
          || invoice.cancelled !== mapped.cancelled || invoice.sapStatus !== mapped.sapStatus;
      })) {
      throw failure('SAP todavía no cumple las condiciones para reaperturar esta cuenta. Revisa el mapa completo.', 'SAP_NOT_ELIGIBLE');
    }
    return result;
  }
  async function query(transaction, text, parameters = {}, signal) {
    cancelled(signal);
    const request = dependencies.request ? dependencies.request(transaction) : new sql.Request(transaction, { requestTimeout: 30000 });
    request.overrides = { ...request.overrides, requestTimeout: 30000 };
    for (const [name, value] of Object.entries(parameters)) request.input(name, sql.Int, value);
    const onAbort = () => { try { request.cancel(); } catch {   } };
    signal?.addEventListener('abort', onAbort, { once: true });
    try { const result = await request.query(text); cancelled(signal); return result; }
    finally { signal?.removeEventListener('abort', onAbort); }
  }
  async function begin(signal) {
    cancelled(signal);
    const pool = await getRemoteDb();
    cancelled(signal);
    const transaction = dependencies.transaction ? dependencies.transaction(pool) : new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    return transaction;
  }
  async function snapshot(transaction, account, signal) {

    const raw = (await query(transaction, SNAPSHOT_SQL, { account: Number(account) }, signal)).recordset?.[0];
    if (typeof raw?.pcJson !== 'string' || typeof raw?.pcdlJson !== 'string') throw failure('No se pudo respaldar la información completa de Vertical.', 'VERTICAL_SNAPSHOT_INVALID');
    const pc = jsonArray(raw.pcJson);
    if (pc.length !== 1 || String(pc[0].PCNum) !== account) throw failure('No se encontró una sola cuenta válida en Vertical.', 'VERTICAL_ACCOUNT_NOT_FOUND');
    if (pc[0].PC_ST !== 'CL') throw failure(pc[0].PC_ST === 'OP' ? 'La cuenta ya está abierta en Vertical. No necesita volver a reaperturarse.'
      : 'La cuenta debe estar Cerrada en Vertical antes de reaperturarla.', 'VERTICAL_ACCOUNT_NOT_CLOSED');
    const meta = (await query(transaction, METADATA_SQL, {}, signal)).recordset?.[0];
    const schemaMessage = 'No se pudo verificar por completo la estructura de Vertical. El responsable de la base debe habilitar la consulta de sus relaciones antes de usar la reapertura.';
    if (!meta || Number(meta.metadataVisible) !== 1 || meta.pcUpdateTrigger == null || meta.pcdlDeleteTrigger == null) throw failure(schemaMessage, 'VERTICAL_SCHEMA_UNVERIFIED');
    const columns = jsonArray(meta.columnsJson), keys = jsonArray(meta.keysJson), triggers = jsonArray(meta.triggersJson), foreignKeys = jsonArray(meta.foreignKeysJson);
    for (const [tableName, columnName] of [['PC', 'PCNum'], ['PCDL', 'PCDLNum'], ['PCDL', 'PCNum']]) {
      const column = columns.find(item => item.tableName === tableName && item.columnName === columnName);
      if (!column || column.typeName !== 'int' || column.nullable || column.computedColumn) throw failure(schemaMessage, 'VERTICAL_SCHEMA_UNVERIFIED');
    }
    const statusColumn = columns.find(item => item.tableName === 'PC' && item.columnName === 'PC_ST');
    if (!statusColumn || !['nvarchar', 'varchar', 'nchar', 'char'].includes(statusColumn.typeName) || statusColumn.maxLength < 2) throw failure(schemaMessage, 'VERTICAL_SCHEMA_UNVERIFIED');
    for (const [tableName, columnName] of [['PC', 'PCNum'], ['PCDL', 'PCDLNum']]) {
      const pk = keys.filter(item => item.tableName === tableName && item.primaryKey && item.keyOrdinal > 0);
      if (pk.length !== 1 || pk[0].columnName !== columnName || pk[0].disabled || pk[0].hypothetical) throw failure(schemaMessage, 'VERTICAL_SCHEMA_UNVERIFIED');
    }
    if (Number(meta.pcUpdateTrigger) !== 0 || Number(meta.pcdlDeleteTrigger) !== 0 || triggers.some(item => !item.disabled)) {
      throw failure('Vertical tiene acciones automáticas que deben revisarse antes de habilitar esta reapertura.', 'VERTICAL_TRIGGER_UNREVIEWED');
    }
    const pcdl = jsonArray(raw.pcdlJson);
    if (pcdl.length !== 1) throw failure(pcdl.length ? 'Hay varios documentos asociados a esta cuenta. Deben revisarse antes de elegir cuál retirar.'
      : 'No existe un documento asociado que pueda respaldarse y retirarse para esta reapertura.', 'VERTICAL_DOCUMENT_COUNT');
    const id = Number(pcdl[0].PCDLNum);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647 || String(pcdl[0].PCNum) !== account) throw failure('El documento asociado no tiene un identificador único válido.', 'VERTICAL_DOCUMENT_INVALID');
    if (columns.some(column => !Object.hasOwn(column.tableName === 'PC' ? pc[0] : pcdl[0], column.columnName))) {
      throw failure('La copia de los registros de Vertical no contiene todos sus campos.', 'VERTICAL_SNAPSHOT_INVALID');
    }
    const grouped = new Map();
    for (const fk of foreignKeys) {
      if (fk.parentSchema === 'dbo' && fk.parentTable === 'PC' && fk.parentColumn === 'PC_ST') throw failure('Hay relaciones adicionales con el estado de la cuenta que deben revisarse.', 'VERTICAL_DEPENDENCIES_UNVERIFIED');
      if (fk.parentSchema !== 'dbo' || fk.parentTable !== 'PCDL') continue;
      const group = grouped.get(fk.foreignKeyId) || []; group.push(fk); grouped.set(fk.foreignKeyId, group);
    }
    for (const group of grouped.values()) {
      const fk = group[0];
      if (group.length !== 1 || fk.parentColumn !== 'PCDLNum' || Number(fk.deleteAction) !== 0) throw failure('El documento tiene relaciones que podrían modificar otros registros. La reapertura requiere revisión de la base.', 'VERTICAL_DEPENDENCIES_UNVERIFIED');
      const childSql = `/* reopening:children */ SELECT COUNT_BIG(*) AS rowCount FROM ${quoteIdentifier(fk.childSchema)}.${quoteIdentifier(fk.childTable)} WITH(UPDLOCK,HOLDLOCK) WHERE ${quoteIdentifier(fk.childColumn)}=@recordId;`;
      const count = (await query(transaction, childSql, { recordId: id }, signal)).recordset?.[0]?.rowCount;
      if (count == null || !/^\d+$/.test(String(count))) throw failure('No se pudieron comprobar todos los registros relacionados.', 'VERTICAL_DEPENDENCIES_UNVERIFIED');
      if (BigInt(count) !== 0n) throw failure('El documento tiene registros dependientes. Deben revisarse antes de retirarlo.', 'VERTICAL_DEPENDENCIES_PRESENT');
    }
    const digest = hash(JSON.stringify({ pcJson: raw.pcJson, pcdlJson: raw.pcdlJson, meta }));
    return { ...raw, pc: pc[0], record: pcdl[0], metadata: meta, columns, id, digest };
  }
  function files(account, operationId) {
    return { backupFile: path.join(directory(), `Cuenta-${account}_reapertura-${operationId}.md`),
      receiptFile: path.join(directory(), `reapertura-${operationId}.receipt.jsonl`) };
  }
  function signReceipt(body) { return crypto.createHmac('sha256', signingKey()).update(JSON.stringify(body)).digest('hex'); }
  async function durableWrite(file, contents, flag) {
    let handle;
    try { handle = await fs.open(file, flag, 0o600); await handle.writeFile(contents, 'utf8'); await handle.sync(); }
    finally { if (handle) await handle.close(); }
    const actual = await fs.readFile(file, 'utf8');
    if (flag === 'wx' && hash(actual) !== hash(contents)) throw new Error('Backup readback mismatch');
    if (flag === 'a' && !actual.endsWith(contents)) throw new Error('Receipt readback mismatch');
  }
  async function receipt(file, payload) {
    let raw;
    try { raw = await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw failure('No se pudo comprobar el estado de la operación. Solicita revisión antes de volver a intentar.', 'OPERATION_STATUS_UNKNOWN', 503); }
    try {
      const lines = raw.trimEnd().split('\n');
      const envelope = JSON.parse(lines[lines.length - 1]);
      const expected = signReceipt(envelope.body);
      if (!/^[0-9a-f]{64}$/.test(envelope.signature) || !crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(envelope.signature, 'hex'))
        || envelope.body.operationId !== payload.operationId || envelope.body.account !== payload.account
        || envelope.body.actorId !== payload.actorId || envelope.body.snapshotDigest !== payload.snapshotDigest) throw new Error();
      return envelope.body;
    } catch { throw failure('No se pudo verificar el comprobante de la operación. Solicita revisión antes de volver a intentar.', 'OPERATION_STATUS_UNKNOWN', 503); }
  }
  async function saveReceipt(file, body, initial = false) {
    await durableWrite(file, `${JSON.stringify({ body, signature: signReceipt(body) })}\n`, initial ? 'wx' : 'a');
  }
  const statusUnknown = () => failure('El resultado de la operación requiere revisión. Consulta su estado y no repitas la reapertura.', 'OPERATION_STATUS_UNKNOWN', 503);
  const recordPreview = state => ({ id: state.id, documentType: state.record.DocType ?? null,
    documentNumber: state.record.DocNum ?? null, reference: state.record.DocReference ?? null,
    populatedFields: Object.values(state.record).filter(value => value !== null && value !== '').length });
  async function prepare(value, { user, signal } = {}) {
    const account = number(value), requester = actor(user);
    signingKey();
    const sap = await freshSap(account, signal);
    let transaction;
    try {
      transaction = await begin(signal);
      const state = await snapshot(transaction, account, signal);
      await transaction.rollback(); transaction = null;
      cancelled(signal);
      const issuedAt = Math.floor(now() / 1000), operationId = uuid();
      const previewToken = jwt.sign({ purpose: TOKEN_PURPOSE, account, actorId: requester.id,
        snapshotDigest: state.digest, operationId, iat: issuedAt, exp: issuedAt + TOKEN_SECONDS }, signingKey(),
      { algorithm: 'HS256', audience: TOKEN_PURPOSE, issuer: 'escandon-bi' });
      return { account, status: 'ready', previewToken, expiresAt: new Date((issuedAt + TOKEN_SECONDS) * 1000).toISOString(),
        verticalStatus: 'CL', record: recordPreview(state), recordCount: 1, backupDirectory: directory(), sapCheckedAt: sap.checkedAt };
    } catch (error) {
      if (transaction) try { await transaction.rollback(); } catch {   }
      if (error.publicMessage) throw error;
      cancelled(signal);
      throw failure('No se pudo verificar la cuenta y sus relaciones en Vertical. No se realizaron cambios.', 'VERTICAL_PREPARATION_FAILED', 502);
    }
  }
  async function execute(value, { previewToken, confirmedAccount, user, signal } = {}) {
    const account = number(value), requester = actor(user), payload = token(previewToken, account, requester, true);
    if (typeof confirmedAccount !== 'string' || confirmedAccount.trim() !== account) throw failure('Escribe el número exacto de la cuenta para confirmar la reapertura.', 'ACCOUNT_CONFIRMATION_REQUIRED', 400);
    if (active.has(payload.operationId)) throw statusUnknown();
    active.add(payload.operationId);
    try {
    await verifiedDirectory();
    const { backupFile, receiptFile } = files(account, payload.operationId);
    const previous = await receipt(receiptFile, payload);
    if (previous?.status === 'applied') return previous.result;
    if (previous?.status === 'rolled_back') throw failure('Esta confirmación ya se utilizó y la operación se revirtió. Consulta nuevamente y prepara otra confirmación.', 'PREVIEW_ALREADY_USED');
    if (previous) throw statusUnknown();
    token(previewToken, account, requester);
    cancelled(signal);
    const baseReceipt = { operationId: payload.operationId, account, actorId: requester.id, snapshotDigest: payload.snapshotDigest,
      status: 'pending', backupFile, startedAt: new Date(now()).toISOString() };
    try { await verifiedDirectory(true); await saveReceipt(receiptFile, baseReceipt, true); }
    catch (error) {
      if (error.code === 'EEXIST') {
        const existing = await receipt(receiptFile, payload);
        if (existing?.status === 'applied') return existing.result;
        throw statusUnknown();
      }
      throw failure('No se pudo guardar el comprobante de seguridad. No se realizaron cambios.', 'BACKUP_WRITE_FAILED', 503);
    }
    let transaction, commitAttempted = false, committed = false, backupVerified = false;
    try {
      const sap = await freshSap(account, signal);
      transaction = await begin(signal);
      const state = await snapshot(transaction, account, signal);
      if (state.digest !== payload.snapshotDigest) throw failure('La cuenta o el documento cambiaron desde la revisión. Revisa la cuenta otra vez antes de confirmar.', 'VERTICAL_SNAPSHOT_CHANGED');
      const backupMetadata = { databaseName: state.metadata.databaseName, metadataVisible: state.metadata.metadataVisible, pcUpdateTrigger: state.metadata.pcUpdateTrigger,
        pcdlDeleteTrigger: state.metadata.pcdlDeleteTrigger, columns: state.columns, keys: jsonArray(state.metadata.keysJson),
        triggers: jsonArray(state.metadata.triggersJson), foreignKeys: jsonArray(state.metadata.foreignKeysJson) };
      const backup = `# Respaldo previo a reapertura\n\nCuenta: ${account}\nOperación: ${payload.operationId}\nUsuario: ${requester.id} (${requester.username})\nFecha UTC: ${new Date(now()).toISOString()}\nEstado previo: CL\nDocumento exacto: ${state.id}\nSnapshot SHA-256: ${state.digest}\n\n## Cuenta completa antes del cambio\n\n\`\`\`json\n${state.pcJson}\n\`\`\`\n\n## Documento completo antes de retirarlo\n\n\`\`\`json\n${state.pcdlJson}\n\`\`\`\n\n## Estructura y tipos de columnas\n\n\`\`\`json\n${JSON.stringify(backupMetadata, null, 2)}\n\`\`\`\n\n## Verificación SAP previa\n\n\`\`\`json\n${JSON.stringify({ checkedAt: sap.checkedAt, complete: sap.complete, eligible: sap.eligible, reopeningScenario: sap.reopeningScenario,
        nodes: sap.nodes.map(node => ({ id: node.id, docNum: node.docNum, status: node.status, statusBasis: node.statusBasis, sapStatus: node.sapStatus })), edges: sap.edges }, null, 2)}\n\`\`\`\n`;
      try { await durableWrite(backupFile, backup, 'wx'); backupVerified = true; }
      catch { throw failure('No se pudo guardar y verificar el respaldo completo. No se realizaron cambios.', 'BACKUP_WRITE_FAILED', 503); }
      cancelled(signal);
      const update = await query(transaction, UPDATE_SQL, { account: Number(account) }, signal);
      if (update.rowsAffected?.length !== 1 || update.rowsAffected[0] !== 1) throw failure('El estado de la cuenta cambió. No se confirmó la reapertura.', 'VERTICAL_UPDATE_CONFLICT');
      const removal = await query(transaction, DELETE_SQL, { account: Number(account), recordId: state.id }, signal);
      if (removal.rowsAffected?.length !== 1 || removal.rowsAffected[0] !== 1) throw failure('No se retiró exactamente el documento revisado. No se confirmó la reapertura.', 'VERTICAL_DELETE_CONFLICT');
      cancelled(signal);
      commitAttempted = true;
      await transaction.commit(); committed = true; transaction = null;
      const result = { account, status: 'reopened', operationId: payload.operationId, backupFile,
        reopenedAt: new Date(now()).toISOString(), previousStatus: 'CL', currentStatus: 'OP', deletedRecordId: state.id, sapCheckedAt: sap.checkedAt };
      await saveReceipt(receiptFile, { ...baseReceipt, status: 'applied', backupVerified, completedAt: result.reopenedAt, result });
      return result;
    } catch (error) {
      let rolledBack = !commitAttempted;
      if (transaction) try { await transaction.rollback(); } catch { rolledBack = false; }
      const uncertain = commitAttempted || committed || !rolledBack;
      try { await saveReceipt(receiptFile, { ...baseReceipt, status: uncertain ? 'unknown' : 'rolled_back', backupVerified,
        completedAt: new Date(now()).toISOString(), errorCode: error.code || 'VERTICAL_OPERATION_FAILED' }); }
      catch { throw statusUnknown(); }
      if (uncertain) throw statusUnknown();
      if (error.publicMessage) throw error;
      cancelled(signal);
      throw failure('La reapertura no se completó y los cambios se revirtieron. Revisa la cuenta antes de preparar una nueva confirmación.', 'VERTICAL_OPERATION_FAILED', 502);
    }
    } finally { active.delete(payload.operationId); }
  }
  async function status(value, { previewToken, user, signal } = {}) {
    const account = number(value), requester = actor(user), payload = token(previewToken, account, requester, true);
    cancelled(signal);
    await verifiedDirectory();
    const entry = await receipt(files(account, payload.operationId).receiptFile, payload);

    if (!entry) return { account, operationId: payload.operationId, status: active.has(payload.operationId) ? 'pending' : 'unknown', backupFile: null };
    if (entry.status === 'applied') return entry.result;
    return { account, operationId: payload.operationId, status: entry.status === 'pending' && !active.has(payload.operationId) ? 'unknown' : entry.status,
      backupFile: entry.backupVerified ? entry.backupFile : null };
  }
  return { prepare, execute, status };
}

module.exports = { ...createAccountReopeningService(), createAccountReopeningService,
  _test: { METADATA_SQL, SNAPSHOT_SQL, UPDATE_SQL, DELETE_SQL } };
