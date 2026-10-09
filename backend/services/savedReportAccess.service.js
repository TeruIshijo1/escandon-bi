'use strict';

const { pool } = require('../config/pg-db');
const { checkSapModuleAccess } = require('../utils/reportAccess');
const reportAnalysis = require('./reportAnalysis.service');

const error = (status, message) => Object.assign(new Error(message), { status });
const isSuperAdmin = user => String(user?.username || '').toLowerCase() === 'amendoza';
const canAssign = user => Boolean(user && (user.role === 'ADMIN' || isSuperAdmin(user)));
const canListAll = user => canAssign(user) || user?.role === 'DIRECTOR';
const numericId = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) {
    throw error(400, 'El identificador del reporte o usuario no es válido.');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw error(400, 'El identificador del reporte o usuario no es válido.');
  return id;
};

async function initAssignmentsTable(db = pool) {
  await db.query(`CREATE TABLE IF NOT EXISTS usersapqueryassignments (
    queryid INTEGER NOT NULL REFERENCES usersapqueries(queryid) ON DELETE CASCADE,
    userid INTEGER NOT NULL REFERENCES usuarios(usuarioid) ON DELETE CASCADE,
    assignedby INTEGER REFERENCES usuarios(usuarioid) ON DELETE SET NULL,
    assignedbyusername VARCHAR(100) NOT NULL,
    assignedat TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (queryid, userid)
  );
  CREATE INDEX IF NOT EXISTS idx_usersapqueryassignments_user ON usersapqueryassignments(userid);`);
}

function parseJson(value, fallback) {
  try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; }
  catch { throw error(409, 'La configuración guardada necesita revisión antes de consultar el reporte.'); }
}

function isOwner(row, user) {
  return row.userid != null ? Number(row.userid) === Number(user.id) : row.username === user.username;
}

function reducedDefinition(definition, fields) {
  if (!definition) return null;
  return {
    id: definition.id, title: definition.title, source: definition.source, category: definition.category,
    assistantOnly: Boolean(definition.assistantOnly), grain: definition.grain,
    requiresDateFilter: Boolean(definition.requiresDateFilter), dateFieldLabel: definition.dateFieldLabel,
    filters: definition.filters || [], statusOptions: definition.statusOptions || [],
    defaultFields: fields,
    fields: fields.map(key => definition.fields.find(field => field.key === key)).filter(Boolean)
      .map(({ key, label, type, width, align }) => ({ key, label, type, width, align }))
  };
}

const rowSelect = `q.queryid, q.userid, q.username, q.titulo, q.descripcion, q.entidad,
  q.camposseleccionados, q.filtrosaplicados, q.espublico, q.fechacreacion, q.fechamodificacion,
  EXISTS (SELECT 1 FROM usersapqueryassignments a JOIN usuarios recipient ON recipient.usuarioid=a.userid
    WHERE a.queryid=q.queryid AND a.userid=$1 AND recipient.activo=1) AS isassigned`;

async function readReport(user, queryId, db = pool, lock = false) {
  const id = numericId(queryId);
  const userId = user?.id == null ? null : numericId(user.id);
  const result = await db.query(`SELECT ${rowSelect} FROM usersapqueries q WHERE q.queryid=$2${lock ? ' FOR UPDATE OF q' : ''}`, [userId, id]);
  const row = result.rows[0];
  if (!row) throw error(404, 'El reporte guardado no está disponible.');
  return row;
}

async function assignedUsers(queryIds, db = pool) {
  if (!queryIds.length) return [];
  const result = await db.query(`SELECT a.queryid, u.usuarioid AS id, u.username, u.nombrecompleto AS nombre,
    u.activo AS activo FROM usersapqueryassignments a JOIN usuarios u ON u.usuarioid=a.userid
    WHERE a.queryid = ANY($1::int[]) ORDER BY u.nombrecompleto, u.usuarioid`, [queryIds]);
  return result.rows.map(row => ({ ...row, activo: Number(row.activo) === 1 }));
}

async function getSavedQueries(user, definitionFor) {
  const result = await pool.query(`SELECT ${rowSelect}
    FROM usersapqueries q
    WHERE $3::boolean OR ((q.userid IS NOT NULL AND q.userid=$1)
      OR (q.userid IS NULL AND q.username=$2)) OR q.espublico=1
      OR EXISTS (SELECT 1 FROM usersapqueryassignments a JOIN usuarios recipient ON recipient.usuarioid=a.userid
        WHERE a.queryid=q.queryid AND a.userid=$1 AND recipient.activo=1)
    ORDER BY q.fechacreacion DESC, q.queryid DESC`, [user?.id == null ? null : numericId(user.id), user.username, canListAll(user)]);
  const rows = result.rows || [];
  const managedIds = rows.filter(row => canAssign(user) && checkSapModuleAccess(user, row.entidad, definitionFor(row.entidad))).map(row => row.queryid);
  const recipients = await assignedUsers(managedIds);
  return rows.map(row => {
    const definition = definitionFor(row.entidad);
    const selectedFields = parseJson(row.camposseleccionados, []);
    const fullAccess = checkSapModuleAccess(user, row.entidad, definition);
    const own = isOwner(row, user);
    return {
      id: row.queryid, userId: row.userid, username: row.username, title: row.titulo, description: row.descripcion,
      entity: row.entidad, selectedFields, filters: parseJson(row.filtrosaplicados, {}),
      isPublic: Boolean(row.espublico), createdAt: row.fechacreacion, isOwner: own,
      isAssigned: Boolean(row.isassigned), executionLocked: true,
      canAssign: canAssign(user) && fullAccess,
      canDelete: own || canListAll(user),
      assignedUsers: recipients.filter(recipient => recipient.queryid === row.queryid)
        .map(({ queryid: _queryid, ...recipient }) => recipient),
      definition: reducedDefinition(definition, Array.isArray(selectedFields) ? selectedFields : [])
    };
  });
}

async function getRecipients(user) {
  if (!canAssign(user)) throw error(403, 'Sólo el área de Sistemas o Administración puede asignar reportes.');
  const result = await pool.query(`SELECT u.usuarioid AS id, u.username, u.nombrecompleto AS nombre,
    r.nombrerol AS role, u.areaasignada AS area
    FROM usuarios u JOIN roles r ON r.rolid=u.rolid WHERE u.activo=1 ORDER BY u.nombrecompleto,u.usuarioid`);
  return result.rows;
}

async function hasAssignedReports(user) {
  const result = await pool.query(`SELECT EXISTS (
    SELECT 1 FROM usersapqueryassignments a
    JOIN usuarios recipient ON recipient.usuarioid=a.userid
    JOIN usersapqueries q ON q.queryid=a.queryid
    WHERE a.userid=$1 AND recipient.activo=1) AS available`, [numericId(user.id)]);
  return result.rows[0]?.available === true;
}

async function setAssignments(user, queryId, userIds, definitionFor) {
  if (!canAssign(user)) throw error(403, 'Sólo el área de Sistemas o Administración puede asignar reportes.');
  if (!Array.isArray(userIds) || userIds.length > 200) throw error(400, 'Selecciona hasta 200 usuarios para este reporte.');
  const ids = [...new Set(userIds.map(numericId))];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await readReport(user, queryId, client, true);
    if (!checkSapModuleAccess(user, row.entidad, definitionFor(row.entidad))) {
      throw error(403, 'Necesitas acceso a las fuentes de este reporte antes de asignarlo.');
    }
    if (ids.length) {
      const available = await client.query('SELECT usuarioid FROM usuarios WHERE usuarioid=ANY($1::int[]) AND activo=1 FOR SHARE', [ids]);
      if (available.rows.length !== ids.length) throw error(400, 'Uno de los usuarios ya no está disponible. Actualiza la lista e intenta nuevamente.');
    }
    await client.query('DELETE FROM usersapqueryassignments WHERE queryid=$1', [row.queryid]);
    if (ids.length) {
      await client.query(`INSERT INTO usersapqueryassignments(queryid,userid,assignedby,assignedbyusername)
        SELECT $1,recipientid,$3,$4 FROM unnest($2::int[]) recipientid`, [row.queryid, ids, user.id == null ? null : numericId(user.id), user.username]);
    }
    await client.query('UPDATE usersapqueries SET fechamodificacion=CURRENT_TIMESTAMP WHERE queryid=$1', [row.queryid]);
    const recipients = await assignedUsers([row.queryid], client);
    await client.query('COMMIT');
    return { savedQueryId: row.queryid, assignedUsers: recipients.map(({ queryid: _queryid, ...recipient }) => recipient) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

function authorizeExecution(row, user, definition) {
  if (!definition) throw error(409, 'Las fuentes de este reporte cambiaron. Solicita su revisión al área de Sistemas.');
  const ordinaryVisibility = isOwner(row, user) || canListAll(user) || Boolean(row.espublico);
  if (row.isassigned) return;
  if (!ordinaryVisibility || !checkSapModuleAccess(user, row.entidad, definition)) {
    throw error(403, 'No tienes acceso a este reporte guardado. Solicita su asignación al área de Sistemas.');
  }
}

async function executeSavedQuery(user, input, definitionFor, executeQuery) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['savedQueryId', 'limit'].includes(key))) {
    throw error(400, 'Este reporte utiliza las columnas y filtros guardados. Solicita a Sistemas los cambios que necesites.');
  }
  const row = await readReport(user, input.savedQueryId);
  const definition = definitionFor(row.entidad);
  authorizeExecution(row, user, definition);
  const selectedFields = parseJson(row.camposseleccionados, []);
  const filters = parseJson(row.filtrosaplicados, {});
  if (!Array.isArray(selectedFields) || !selectedFields.length
    || selectedFields.some(key => typeof key !== 'string' || !definition.fields.some(field => field.key === key))
    || !filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw error(409, 'La configuración guardada necesita revisión antes de consultar el reporte.');
  }
  const allowedFilters = ['fechaDesde', 'fechaHasta', 'almacen', 'proveedor', 'busqueda', 'estatusDoc', 'clasificacionMedica', 'limit', 'analysis'];
  if (Object.keys(filters).some(key => !allowedFilters.includes(key))) throw error(409, 'Los filtros guardados necesitan revisión del área de Sistemas.');
  let analysis;
  if (filters.analysis != null) {
    try { analysis = reportAnalysis.validateAnalysis(definition, filters.analysis); }
    catch { throw error(409, 'El análisis guardado necesita revisión del área de Sistemas.'); }
  }
  const savedLimit = filters.limit == null ? 10000 : Number(filters.limit);
  const limit = input.limit == null ? savedLimit : Number(input.limit);
  if (!Number.isInteger(savedLimit) || savedLimit < 1 || savedLimit > 10000
    || !Number.isInteger(limit) || limit < 1 || limit > savedLimit) {
    throw error(400, 'El límite del reporte sólo puede reducirse dentro de la configuración guardada.');
  }
  const result = await executeQuery({ ...filters, ...(analysis ? { analysis } : {}), entity: row.entidad, selectedFields, limit });
  // Revocaciones o bajas durante una consulta también se aplican antes de enviar
  // los datos. No se alteran los permisos generales ni el resultado en caché.
  const current = await readReport(user, row.queryid);
  authorizeExecution(current, user, definitionFor(current.entidad));
  if (current.entidad !== row.entidad
    || JSON.stringify(parseJson(current.camposseleccionados, [])) !== JSON.stringify(selectedFields)
    || JSON.stringify(parseJson(current.filtrosaplicados, {})) !== JSON.stringify(filters)) {
    throw error(409, 'El reporte cambió durante la consulta. Vuelve a abrirlo e intenta nuevamente.');
  }
  if (analysis) {
    try { reportAnalysis.validateAnalysis(definitionFor(current.entidad), filters.analysis); }
    catch { throw error(409, 'El análisis guardado cambió durante la consulta. Solicita su revisión al área de Sistemas.'); }
  }
  const outputFields = analysis && (analysis.groupBy.length || analysis.measures.length)
    ? [...analysis.groupBy, ...analysis.measures.map((_measure, index) => `metric_${index}`)] : selectedFields;
  const sourceColumns = analysis ? result.columnas || [] : reducedDefinition(definition, selectedFields).fields;
  const columns = outputFields.map(key => sourceColumns.find(field => field.key === key)).filter(Boolean)
    .map(({ key, label, type, width, align }) => ({ key, label, type, width, align }));
  if (columns.length !== outputFields.length) throw error(409, 'Las columnas del reporte guardado necesitan revisión del área de Sistemas.');
  const analysisMetadata = analysis ? {
    analysis, analysisSummary: reportAnalysis.describeAnalysis(definition, analysis),
    ...(result.analysisScope ? { analysisScope: Object.fromEntries(['complete', 'sourceRows', 'matchingRows', 'groups', 'unknownValues', 'note']
      .filter(key => Object.hasOwn(result.analysisScope, key)).map(key => [key, result.analysisScope[key]])) } : {})
  } : {};
  return {
    entity: row.entidad, savedQueryId: row.queryid, entityTitle: row.titulo, executionLocked: true,
    ejecutadoEn: result.ejecutadoEn, totalRegistros: result.data?.length || 0,
    source: result.source, grain: result.grain, limit: result.limit, truncated: Boolean(result.truncated), message: result.message,
    ...analysisMetadata,
    columnas: columns,
    data: (result.data || []).map(record => Object.fromEntries(outputFields.map(key => [key, record[key] ?? null]))),
    kpis: [{ label: 'Registros', value: String(result.data?.length || 0), color: '#2563EB' }]
  };
}

async function deleteQuery(user, queryId) {
  const id = numericId(queryId);
  const result = canListAll(user)
    ? await pool.query('DELETE FROM usersapqueries WHERE queryid=$1 RETURNING queryid', [id])
    : await pool.query(`DELETE FROM usersapqueries WHERE queryid=$1
      AND ((userid IS NOT NULL AND userid=$2) OR (userid IS NULL AND username=$3)) RETURNING queryid`,
    [id, user.id == null ? null : numericId(user.id), user.username]);
  if (!result.rowCount) throw error(404, 'No se encontró el reporte o no tienes permiso para eliminarlo.');
  return { ok: true, queryId: id };
}

module.exports = { initAssignmentsTable, canAssign, getSavedQueries, getRecipients, hasAssignedReports, setAssignments, executeSavedQuery, deleteQuery };
