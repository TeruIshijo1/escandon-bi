'use strict';

// Vertical aporta datos de referencia mediante SELECT. Toda configuración y tarifa
// autorizada se conserva exclusivamente en PostgreSQL de BI.
const { getDb } = require('../config/db');
const { canReview } = require('./honorariosReview.service');
const { isExcludedHonorariosService, classifyProfessionalCandidate } = require('../utils/honorariosScope');
const { multiplyHonorario } = require('../utils/honorariosMoney');

const CONTACT_CENTER_CODES = new Set(['SER1467', 'SER1470', 'SER1471']);
const STATUSES = new Set(['PENDIENTE', 'INCLUIDO', 'EXCLUIDO']);
const APPROVAL_STATUSES = new Set(['PENDIENTE', 'APROBADO', 'EXCLUIDO']);
const MODALITIES = new Set(['presencial', 'contact_center']);
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
let schemaPromise;
let syncPromise;

const CATALOG_SQL = `SELECT ItemCode,ItemName,ItemDescription,ItemGroupName,ItemGroupCode,ItemType,Enabled
  FROM V_IT WHERE ItemType='S' AND NULLIF(LTRIM(RTRIM(ItemCode)),'') IS NOT NULL
  UNION ALL SELECT c.CPTCode ItemCode,c.CPTName_ES ItemName,c.CPTName_ES ItemDescription,
    'PROCEDIMIENTO EN QUIROFANO' ItemGroupName,NULL ItemGroupCode,'S' ItemType,CAST(1 AS bit) Enabled
  FROM CP c WHERE NULLIF(LTRIM(RTRIM(c.CPTCode)),'') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM V_IT i WHERE i.ItemCode=c.CPTCode)`;
const REFERENCE_SQL = `SELECT Id_UT,ITEMCODE,ITEMDESCRIPTION,IMPORTE,NOTAS FROM UT_Honorarios`;
// Un corte acotado descubre servicios con movimiento sin ficha visible en V_IT.
// No presupone que todo artículo de venta sea un servicio.
const DISCOVERY_SQL = `WITH Codes AS (
  SELECT DISTINCT l.ItemCode FROM SOLN l JOIN SO s ON s.SONum=l.SONum
    WHERE s.CreatedOn>=@sinceDate AND l.ItemCode LIKE 'SER%'
  UNION SELECT DISTINCT b.ItemCode FROM PCBL b
    WHERE b.ChargeDate>=@sinceDate AND b.LineType='CH' AND b.ItemCode LIKE 'SER%'
  ) SELECT c.ItemCode FROM Codes c
    WHERE NOT EXISTS (SELECT 1 FROM V_IT i WHERE i.ItemCode=c.ItemCode)`;

function dateOnly(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  if (typeof value !== 'string') return null;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function validCode(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 256;
}

function identity(value, max = 100) {
  if (value === null || value === undefined || value === '') return null;
  if (!['string', 'number'].includes(typeof value)) throw fail("Revisa el médico seleccionado y su función en el servicio.");
  const result = String(value).trim();
  if (!result || result.length > max) throw fail("Revisa el médico seleccionado y su función en el servicio.");
  return result;
}

function reviewerName(user) {
  return `${user.id ?? user.username ?? 'BI'}: ${user.nombre || user.username || 'Usuario BI'}`;
}

function assertPermission(user) {
  if (!canReview(user)) throw fail('No tienes permiso para administrar honorarios.', 403);
}

function validateConfig(input) {
  const paymentUnit = input?.paymentUnit ?? null;
  const reason = input?.reason ?? '';
  if (!validCode(input?.itemCode) || !Number.isInteger(input?.expectedRevision) || input.expectedRevision < 0
    || !STATUSES.has(input.status) || !MODALITIES.has(input.modality)
    || (paymentUnit !== null && (typeof paymentUnit !== 'string' || !paymentUnit.trim() || paymentUnit.length > 100))
    || typeof reason !== 'string' || reason.length > 2000) {
    throw fail("Revisa el servicio seleccionado y el tipo de atención. Actualiza el catálogo si la información cambió.");
  }
  return { itemCode: input.itemCode.trim(), expectedRevision: input.expectedRevision, status: input.status,
    modality: input.modality, paymentUnit: paymentUnit?.trim() ?? null, reason: reason.trim() };
}

function normalizeRole(value) {
  const role = identity(value);
  if (!role) return null;
  if (!/^[\p{L}\p{M}\p{N}_ .()/-]+$/u.test(role)) throw fail("Revisa la función del médico en el servicio.");
  const label = role.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const aliases = { ANESTESIOLOGO: 'AN', ANESTESIOLOGA: 'AN', 'AN (ANESTESIOLOGO)': 'AN',
    CIRUJANO: 'SURGEON', CIRUJANA: 'SURGEON', AYUDANTE: 'AY', 'AY (AYUDANTE)': 'AY',
    'MEDICO TRATANTE': 'TRATANTE', 'TRATANTE / CONSULTA': 'TRATANTE' };
  return aliases[label] || role.normalize('NFC').toUpperCase();
}

function validateTariff(input) {
  const validFrom = dateOnly(input?.validFrom);
  const validTo = input?.validTo === null || input?.validTo === undefined || input?.validTo === '' ? null : dateOnly(input.validTo);
  const reason = input?.reason ?? '';
  if (!validFrom) throw fail('Indica una fecha válida en "Se aplica desde".');
  if (input.validTo && !validTo) throw fail('Indica una fecha válida en "Se aplica hasta" o deja el campo vacío.');
  if (validTo && validFrom > validTo) throw fail('La fecha final debe ser igual o posterior a la fecha inicial.');
  if (!validCode(input?.itemCode) || !Number.isInteger(input?.expectedRevision) || input.expectedRevision < 0
    || typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1e9
    || Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > 1e-6
    || (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id <= 0))
    || (input.active !== undefined && typeof input.active !== 'boolean')
    || typeof reason !== 'string' || reason.length > 2000) {
    throw fail("Revisa los datos de la tarifa. El importe debe ser mayor a cero y tener hasta dos decimales.");
  }
  return { id: input.id || null, itemCode: input.itemCode.trim(), providerId: identity(input.providerId),
    role: normalizeRole(input.role), amount: money(input.amount), validFrom, validTo,
    expectedRevision: input.expectedRevision, active: input.active !== false, reason: reason.trim() };
}

function tariffOverlaps(first, second) {
  return first.active !== false && second.active !== false && first.itemCode === second.itemCode
    && String(first.providerId || '') === String(second.providerId || '')
    && normalizeRole(first.role) === normalizeRole(second.role)
    && first.validFrom <= (second.validTo || '9999-12-31') && second.validFrom <= (first.validTo || '9999-12-31');
}

async function ensureSchema() {
  if (!schemaPromise) schemaPromise = getDb().pool.query(`
    CREATE TABLE IF NOT EXISTS bi_honorarios_catalog (
      item_code text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '', group_name text NOT NULL DEFAULT '',
      source_active boolean NOT NULL DEFAULT true, source_metadata jsonb NOT NULL DEFAULT '{}',
      reference_prices jsonb NOT NULL DEFAULT '[]', reference_warnings jsonb NOT NULL DEFAULT '[]',
      reference_changed boolean NOT NULL DEFAULT false, scope_excluded boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'PENDIENTE' CHECK(status IN ('PENDIENTE','INCLUIDO','EXCLUIDO')),
      modality text NOT NULL DEFAULT 'presencial' CHECK(modality IN ('presencial','contact_center')),
      payment_unit text NOT NULL DEFAULT 'servicio', reason text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 0,
      updated_by text, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS bi_honorarios_tariffs (
      id bigserial PRIMARY KEY, item_code text NOT NULL REFERENCES bi_honorarios_catalog(item_code),
      provider_id text, role text, amount numeric(16,2) NOT NULL CHECK(amount>0),
      valid_from date NOT NULL, valid_to date, active boolean NOT NULL DEFAULT true,
      revision integer NOT NULL DEFAULT 1, reason text NOT NULL, updated_by text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), CHECK(valid_to IS NULL OR valid_to>=valid_from)
    );
    CREATE INDEX IF NOT EXISTS bi_honorarios_tariffs_lookup ON bi_honorarios_tariffs(item_code,valid_from,valid_to);
    CREATE TABLE IF NOT EXISTS bi_honorarios_catalog_history (
      id bigserial PRIMARY KEY, item_code text NOT NULL, entity_type text NOT NULL,
      entity_id text NOT NULL, payload jsonb NOT NULL, revision integer NOT NULL,
      updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS bi_honorarios_catalog_sync (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), last_attempt timestamptz,
      last_success timestamptz, last_error text, source_count integer NOT NULL DEFAULT 0
    );
    INSERT INTO bi_honorarios_catalog_sync(singleton) VALUES(true) ON CONFLICT DO NOTHING;
  `).catch(error => { schemaPromise = undefined; throw error; });
  await schemaPromise;
}

function approvalStatus(config, approvedTariffCount) {
  if (config.scopeExcluded || config.status === 'EXCLUIDO') return 'EXCLUIDO';
  return config.status === 'INCLUIDO' && config.active !== false && approvedTariffCount > 0 ? 'APROBADO' : 'PENDIENTE';
}

const CATALOG_TARIFF_COUNTS = `(SELECT COUNT(*) FROM bi_honorarios_tariffs t
  WHERE t.item_code=c.item_code AND t.active=true) tariff_count,
  (SELECT COUNT(*) FROM bi_honorarios_tariffs t
  WHERE t.item_code=c.item_code AND t.active=true AND t.amount>0) approved_tariff_count`;

function catalogRow(row) {
  const scopeExcluded = row.scope_excluded || isExcludedHonorariosService(row);
  const scope = classifyProfessionalCandidate({ ...row, referencePrices: row.reference_prices });
  const approvedTariffCount = Number(row.approved_tariff_count || 0);
  return { itemCode: row.item_code, name: row.name, description: row.description, groupName: row.group_name,
    active: row.source_active, sourceMetadata: row.source_metadata, scopeExcluded,
    ...scope, status: scopeExcluded ? 'EXCLUIDO' : row.status, modality: row.modality, paymentUnit: row.payment_unit,
    reason: row.reason, revision: row.revision, referencePrices: row.reference_prices || [],
    referenceWarnings: row.reference_warnings || [], referenceChanged: row.reference_changed,
    updatedBy: row.updated_by, updatedAt: row.updated_at, createdAt: row.created_at,
    lastSeenAt: row.last_seen_at, tariffCount: Number(row.tariff_count || 0), approvedTariffCount,
    approvalStatus: approvalStatus({ status: row.status, active: row.source_active, scopeExcluded }, approvedTariffCount) };
}

function tariffRow(row) {
  return { id: Number(row.id), itemCode: row.item_code, providerId: row.provider_id, role: row.role,
    amount: Number(row.amount), validFrom: dateOnly(row.valid_from), validTo: dateOnly(row.valid_to),
    active: row.active, revision: row.revision, reason: row.reason, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

function normalizeSource(items, references, discovered = []) {
  const referenceMap = new Map();
  for (const row of references) {
    const code = String(row.ITEMCODE || '').trim();
    if (!code) continue;
    if (!referenceMap.has(code)) referenceMap.set(code, []);
    referenceMap.get(code).push({ id: row.Id_UT, amount: row.IMPORTE === null ? null : Number(row.IMPORTE),
      description: row.ITEMDESCRIPTION || '', notes: row.NOTAS || '' });
  }
  const source = new Map();
  for (const row of items) {
    const code = String(row.ItemCode || '').trim();
    if (!code) continue;
    if (source.has(code)) throw fail(`Se encontraron registros repetidos del servicio ${code}. No se pudo actualizar el catálogo.`, 502);
    source.set(code, { itemCode: code, name: row.ItemName || row.ItemDescription || code,
      description: row.ItemDescription || row.ItemName || '', groupName: row.ItemGroupName || '',
      active: row.Enabled === true || row.Enabled === 1,
      sourceMetadata: { itemType: row.ItemType, groupCode: row.ItemGroupCode, source: 'V_IT' } });
  }
  for (const row of discovered) {
    const code = String(row.ItemCode || '').trim();
    if (!code || source.has(code)) continue;
    source.set(code, { itemCode: code, name: referenceMap.get(code)?.[0]?.description || code,
      description: referenceMap.get(code)?.[0]?.description || '', groupName: '', active: true,
      sourceMetadata: { itemType: 'S', source: 'Movimiento clínico; ficha pendiente de conciliación' } });
  }
  for (const entry of source.values()) {
    entry.referencePrices = (referenceMap.get(entry.itemCode) || []).sort((a, b) => Number(a.id) - Number(b.id));
    entry.referenceWarnings = [];
    if (!entry.referencePrices.length) entry.referenceWarnings.push("Aún no hay un precio de referencia para este servicio.");
    if (entry.referencePrices.length > 1) entry.referenceWarnings.push("Hay más de un precio de referencia. Revisa cuál corresponde.");
    if (entry.referencePrices.some(ref => ref.amount === null || ref.amount <= 0)) entry.referenceWarnings.push("Revisa el precio de referencia: debe ser mayor a cero.");
    if (entry.referencePrices.some(ref => ref.amount > 0 && ref.amount <= 1)) entry.referenceWarnings.push("El precio de referencia es de $1 o menos. Confirma el importe antes de pagar.");
    if (entry.referencePrices.some(ref => String(ref.notes).trim())) entry.referenceWarnings.push("Revisa las notas del precio de referencia antes de fijar la tarifa.");
    entry.scopeExcluded = isExcludedHonorariosService(entry.itemCode, entry.groupName, entry.name);
    entry.modality = CONTACT_CENTER_CODES.has(entry.itemCode) ? 'contact_center' : 'presencial';
  }
  return [...source.values()];
}

async function readSyncState() {
  await ensureSchema();
  const { rows } = await getDb().pool.query('SELECT * FROM bi_honorarios_catalog_sync WHERE singleton=true');
  const row = rows[0] || {};
  return { lastAttempt: row.last_attempt || null, lastSuccess: row.last_success || null,
    lastError: row.last_error || null, sourceCount: Number(row.source_count || 0) };
}

async function performSync(remotePool) {
  await ensureSchema();
  await getDb().pool.query('UPDATE bi_honorarios_catalog_sync SET last_attempt=now() WHERE singleton=true');
  try {
    const configuredMonths = Number(process.env.HONORARIOS_DISCOVERY_MONTHS || 12);
    const months = Number.isFinite(configuredMonths) ? Math.max(1, Math.min(36, configuredMonths)) : 12;
    const since = new Date(); since.setUTCMonth(since.getUTCMonth() - months);
    const [itemsResult, referencesResult, discoveredResult] = await Promise.all([
      remotePool.request().query(CATALOG_SQL), remotePool.request().query(REFERENCE_SQL),
      remotePool.request().input('sinceDate', dateOnly(since)).query(DISCOVERY_SQL)
    ]);
    const source = normalizeSource(itemsResult.recordset, referencesResult.recordset, discoveredResult.recordset);
    if (!source.length) throw fail('Vertical devolvió el catálogo vacío. Se conservaron los datos anteriores.', 502);
    const client = await getDb().pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('bi_honorarios_catalog_sync'))");
      // Una sola escritura evita un viaje a PostgreSQL por cada concepto.
      const entries = source.map(entry => ({ item_code: entry.itemCode, name: entry.name,
        description: entry.description, group_name: entry.groupName, source_active: entry.active,
        source_metadata: entry.sourceMetadata, reference_prices: entry.referencePrices,
        reference_warnings: entry.referenceWarnings, scope_excluded: entry.scopeExcluded, modality: entry.modality }));
      await client.query(`INSERT INTO bi_honorarios_catalog(item_code,name,description,group_name,source_active,
        source_metadata,reference_prices,reference_warnings,scope_excluded,status,modality)
        SELECT e.item_code,e.name,e.description,e.group_name,e.source_active,e.source_metadata,
          e.reference_prices,e.reference_warnings,e.scope_excluded,
          CASE WHEN e.scope_excluded THEN 'EXCLUIDO' ELSE 'PENDIENTE' END,e.modality
        FROM jsonb_to_recordset($1::jsonb) AS e(item_code text,name text,description text,group_name text,
          source_active boolean,source_metadata jsonb,reference_prices jsonb,reference_warnings jsonb,
          scope_excluded boolean,modality text)
        ON CONFLICT(item_code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
          group_name=EXCLUDED.group_name,source_active=EXCLUDED.source_active,source_metadata=EXCLUDED.source_metadata,
          reference_changed=bi_honorarios_catalog.reference_changed OR bi_honorarios_catalog.reference_prices<>EXCLUDED.reference_prices,
          reference_prices=EXCLUDED.reference_prices,reference_warnings=EXCLUDED.reference_warnings,
          scope_excluded=EXCLUDED.scope_excluded,last_seen_at=now()`, [JSON.stringify(entries)]);
      // Sólo una baja explícita de V_IT cambia source_active. Ausencia de ficha y
      // consulta incompleta no eliminan configuración ni precios históricos.
      await client.query('UPDATE bi_honorarios_catalog_sync SET last_success=now(),last_error=NULL,source_count=$1 WHERE singleton=true', [source.length]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return readSyncState();
  } catch (error) {
    await getDb().pool.query('UPDATE bi_honorarios_catalog_sync SET last_error=$1 WHERE singleton=true', [String(error.message).slice(0, 2000)]);
    throw error;
  }
}

function syncCatalog(remotePool) {
  if (!remotePool?.request) return Promise.reject(fail('No está disponible la conexión de lectura de Vertical.', 503));
  if (!syncPromise) syncPromise = performSync(remotePool).finally(() => { syncPromise = undefined; });
  return syncPromise;
}

async function syncIfDue(remotePool) {
  const state = await readSyncState();
  const configured = Number(process.env.HONORARIOS_CATALOG_SYNC_MINUTES || 30);
  const minutes = Number.isFinite(configured) ? Math.max(1, configured) : 30;
  if (!state.lastAttempt || Date.now() - new Date(state.lastAttempt).getTime() >= minutes * 60000) {
    try { await syncCatalog(remotePool); } catch { /* El catálogo guardado sigue disponible con su error de sincronización. */ }
  }
  return readSyncState();
}

// Las lecturas y decisiones usan el catálogo guardado. La actualización explícita
// obtiene nuevos precios de Vertical; sólo la primera consulta necesita inicializarlo.
async function ensureCatalogReady(remotePool) {
  const state = await readSyncState();
  return state.lastSuccess ? state : syncCatalog(remotePool);
}

async function getCatalogItem(itemCode) {
  await ensureSchema();
  const { rows } = await getDb().pool.query(`SELECT c.*, ${CATALOG_TARIFF_COUNTS}
    FROM bi_honorarios_catalog c WHERE c.item_code=$1`, [itemCode]);
  if (!rows[0]) throw fail('El servicio no está en el catálogo.', 404);
  return catalogRow(rows[0]);
}

async function listCatalog(options = {}, remotePool) {
  await ensureSchema();
  const sync = remotePool && options.autoSync !== false ? await syncIfDue(remotePool) : await readSyncState();
  const values = [];
  const filters = [];
  if (options.search) {
    values.push(`%${String(options.search).trim()}%`);
    filters.push(`(c.item_code ILIKE $${values.length} OR c.name ILIKE $${values.length} OR c.group_name ILIKE $${values.length})`);
  }
  if (options.status && STATUSES.has(options.status)) {
    values.push(options.status);
    filters.push(`(CASE WHEN c.scope_excluded THEN 'EXCLUIDO' ELSE c.status END)=$${values.length}`);
  }
  if (options.includeInactive === false || options.includeInactive === 'false') filters.push('c.source_active=true');
  const { rows } = await getDb().pool.query(`SELECT c.*, ${CATALOG_TARIFF_COUNTS} FROM bi_honorarios_catalog c
    ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY c.item_code`, values);
  return { items: rows.map(catalogRow).filter(item => !item.scopeExcluded)
    .filter(item => !APPROVAL_STATUSES.has(options.approvalStatus) || item.approvalStatus === options.approvalStatus), sync };
}

async function saveCatalogConfig(input, user) {
  assertPermission(user);
  const config = validateConfig(input);
  await ensureSchema();
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`honorarios-catalog:${config.itemCode}`]);
    const prior = await client.query(`SELECT c.*, ${CATALOG_TARIFF_COUNTS}
      FROM bi_honorarios_catalog c WHERE item_code=$1 FOR UPDATE OF c`, [config.itemCode]);
    const previous = prior.rows[0];
    if (!previous) throw fail("El servicio aún no aparece en la lista. Busca servicios nuevos antes de configurarlo.", 404);
    if (previous.revision !== config.expectedRevision) throw fail('Otra persona modificó este servicio. Actualiza el catálogo.', 409);
    if (config.status === 'INCLUIDO' && (previous.scope_excluded || isExcludedHonorariosService(config.itemCode, previous.group_name, previous.name))) {
      throw fail("Este cargo, producto o paquete no se puede incluir en el pago a médicos.");
    }
    if (config.status === 'INCLUIDO' && !previous.source_active) throw fail("Este servicio está inactivo. Puedes consultar su historial, pero no incluirlo en nuevos pagos.");
    const actor = reviewerName(user);
    const saved = await client.query(`UPDATE bi_honorarios_catalog SET status=$2,modality=$3,payment_unit=$4,reason=$5,
      revision=revision+1,updated_by=$6,updated_at=now(),reference_changed=false WHERE item_code=$1 RETURNING *`,
    [config.itemCode, config.status, config.modality, config.paymentUnit ?? previous.payment_unit ?? 'servicio', config.reason, actor]);
    const row = catalogRow({ ...saved.rows[0], tariff_count: previous.tariff_count,
      approved_tariff_count: previous.approved_tariff_count });
    await client.query(`INSERT INTO bi_honorarios_catalog_history(item_code,entity_type,entity_id,payload,revision,updated_by)
      VALUES($1,'CONFIG',$1,$2,$3,$4)`, [config.itemCode, JSON.stringify({ previous: catalogRow(previous), current: row }), row.revision, actor]);
    await client.query('COMMIT');
    return row;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function listTariffs({ itemCode } = {}) {
  await ensureSchema();
  const { rows } = await getDb().pool.query(`SELECT * FROM bi_honorarios_tariffs
    ${itemCode ? 'WHERE item_code=$1' : ''} ORDER BY item_code,valid_from DESC,id DESC`, itemCode ? [itemCode] : []);
  return rows.map(tariffRow);
}

async function saveTariff(input, user) {
  assertPermission(user);
  const tariff = validateTariff(input);
  await ensureSchema();
  const client = await getDb().pool.connect();
  try {
    await client.query('BEGIN');
    // Una cerradura por concepto serializa todas sus combinaciones y vigencias.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`honorarios-catalog:${tariff.itemCode}`]);
    const catalog = await client.query('SELECT * FROM bi_honorarios_catalog WHERE item_code=$1 FOR UPDATE', [tariff.itemCode]);
    if (!catalog.rows[0]) throw fail('El servicio no está en el catálogo.', 404);
    if (tariff.active && (catalog.rows[0].scope_excluded || isExcludedHonorariosService(catalog.rows[0]))) throw fail('El concepto está fuera del alcance de honorarios.');
    if (tariff.active && !catalog.rows[0].source_active) throw fail('El servicio está inactivo en Vertical.');
    const existing = await client.query('SELECT * FROM bi_honorarios_tariffs WHERE item_code=$1 FOR UPDATE', [tariff.itemCode]);
    const previous = existing.rows.find(row => Number(row.id) === tariff.id);
    if (tariff.id && !previous) throw fail('La tarifa ya no está disponible para este concepto.', 404);
    if ((previous?.revision || 0) !== tariff.expectedRevision) throw fail('Otra persona modificó la tarifa. Actualiza el catálogo.', 409);
    if (existing.rows.some(row => Number(row.id) !== tariff.id && tariffOverlaps(tariff, tariffRow(row)))) {
      throw fail("Ya hay una tarifa para este médico y función en esas fechas. Ajusta las fechas para que se aplique una sola tarifa.", 409);
    }
    const actor = reviewerName(user);
    const saved = tariff.id
      ? await client.query(`UPDATE bi_honorarios_tariffs SET provider_id=$3,role=$4,amount=$5,valid_from=$6,valid_to=$7,
          active=$8,reason=$9,updated_by=$10,revision=revision+1,updated_at=now() WHERE id=$1 AND item_code=$2 RETURNING *`,
        [tariff.id, tariff.itemCode, tariff.providerId, tariff.role, tariff.amount, tariff.validFrom, tariff.validTo, tariff.active, tariff.reason, actor])
      : await client.query(`INSERT INTO bi_honorarios_tariffs(item_code,provider_id,role,amount,valid_from,valid_to,active,reason,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [tariff.itemCode, tariff.providerId, tariff.role, tariff.amount, tariff.validFrom, tariff.validTo, tariff.active, tariff.reason, actor]);
    const row = tariffRow(saved.rows[0]);
    await client.query(`INSERT INTO bi_honorarios_catalog_history(item_code,entity_type,entity_id,payload,revision,updated_by)
      VALUES($1,'TARIFF',$2,$3,$4,$5)`, [tariff.itemCode, String(row.id),
      JSON.stringify({ previous: previous ? tariffRow(previous) : null, current: row }), row.revision, actor]);
    await client.query('COMMIT');
    return row;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function getCatalogHistory(itemCode) {
  await ensureSchema();
  const { rows } = await getDb().pool.query(`SELECT * FROM bi_honorarios_catalog_history
    WHERE item_code=$1 ORDER BY id DESC LIMIT 200`, [itemCode]);
  return rows.map(row => ({ id: row.id, itemCode: row.item_code, entityType: row.entity_type,
    entityId: row.entity_id, payload: row.payload, revision: row.revision, updatedBy: row.updated_by, updatedAt: row.updated_at }));
}

function resolveTariff(input, tariffs) {
  const serviceDate = dateOnly(input.serviceDate);
  if (!serviceDate) return { status: 'PENDIENTE_FECHA', tariff: null, reason: "Falta la fecha del servicio. Revísala antes de calcular el pago." };
  const providerId = input.providerId === null || input.providerId === undefined ? '' : String(input.providerId);
  const role = normalizeRole(input.role);
  const candidates = tariffs.filter(tariff => tariff.active !== false && Number.isFinite(Number(tariff.amount))
    && Number(tariff.amount) > 0 && tariff.itemCode === input.itemCode
    && tariff.validFrom <= serviceDate && (!tariff.validTo || tariff.validTo >= serviceDate)
    && (!tariff.providerId || String(tariff.providerId) === providerId)
    && (!tariff.role || normalizeRole(tariff.role) === role))
    .map(tariff => ({ tariff, priority: (tariff.providerId ? 2 : 0) + (tariff.role ? 1 : 0) }));
  if (!candidates.length) return { status: 'PENDIENTE_PRECIO', tariff: null, reason: "Falta una tarifa para el médico y su función en la fecha del servicio." };
  const priority = Math.max(...candidates.map(entry => entry.priority));
  const selected = candidates.filter(entry => entry.priority === priority);
  if (selected.length !== 1) return { status: 'TARIFA_AMBIGUA', tariff: null, reason: "Hay más de una tarifa aplicable. Revisa las tarifas y sus fechas." };
  return { status: 'RESUELTA', tariff: { ...selected[0].tariff }, reason: null };
}

async function resolveTariffs(candidates) {
  const tariffs = await listTariffs();
  return candidates.map(candidate => resolveTariff({ itemCode: candidate.itemCode || candidate.CodigoServicio || candidate.ItemCode,
    providerId: candidate.providerId ?? candidate.MedicoId ?? candidate.PRNum,
    role: candidate.role || candidate.RolMedico || candidate.ProviderRole,
    serviceDate: candidate.serviceDate || candidate.FechaAtencion || candidate.ServiceDate }, tariffs));
}

function enrichCandidate(candidate, config, tariffs) {
  const itemCode = candidate.itemCode || candidate.CodigoServicio || candidate.ItemCode;
  const quantity = candidate.CantidadReconocida ?? candidate.Cantidad;
  const effectiveQuantity = quantity === null || quantity === undefined || quantity === '' ? null : Number(quantity);
  const providerId = candidate.MedicoId ?? candidate.providerId ?? candidate.PRNum;
  const role = candidate.RolMedico || candidate.role || candidate.ProviderRole || null;
  const serviceDate = candidate.FechaAtencion || candidate.serviceDate || candidate.ServiceDate;
  const hardExcluded = config?.scopeExcluded || isExcludedHonorariosService(config) || isExcludedHonorariosService(candidate);
  const tariffResult = hardExcluded ? { tariff: null, reason: null } : resolveTariff({ itemCode, providerId, role, serviceDate }, tariffs);
  const tariff = tariffResult.tariff;
  const scope = classifyProfessionalCandidate(config || candidate);
  const status = hardExcluded ? 'EXCLUIDO' : config?.status || 'PENDIENTE';
  const approvedTariffCount = tariffs.filter(entry => entry.itemCode === itemCode && entry.active !== false
    && Number.isFinite(Number(entry.amount)) && Number(entry.amount) > 0).length;
  const catalogApproved = Boolean(config) && approvalStatus({ ...config, status, scopeExcluded: hardExcluded }, approvedTariffCount) === 'APROBADO';
  const physicianIdentified = providerId !== null && providerId !== undefined && String(providerId).trim() !== ''
    && String(providerId) !== '0' && Boolean(String(candidate.Medico || candidate.providerName || '').trim());
  const reviewEligible = catalogApproved && Boolean(tariff) && physicianIdentified;
  const issues = [...(candidate.BIStatusReasons || [])];
  if (!config) issues.push('Servicio nuevo, pendiente de configurar');
  else if (status === 'PENDIENTE') issues.push('Servicio pendiente de configurar');
  if (status === 'EXCLUIDO') issues.push(hardExcluded ? 'Cargo hospitalario, artículo, paquete o área excluida; no genera honorarios' : config.reason || 'Servicio excluido del catálogo');
  if (config?.active === false) issues.push("Este servicio está inactivo. Revisa si estaba disponible en la fecha de atención.");
  if (!tariff) issues.push(tariffResult.reason);
  if (!providerId || !String(candidate.Medico || candidate.providerName || '').trim()
    || candidate.MedicoConfirmado === false) issues.push('Pendiente de médico');
  if (!(effectiveQuantity > 0) || !Number.isFinite(effectiveQuantity)
    || candidate.CantidadConfirmada === false) issues.push("Falta confirmar cuántos servicios se pagarán");
  const executionConfirmed = candidate.RealizacionConfirmada === true || candidate.EjecucionConfirmada === true || candidate.ExecutionConfirmed === true;
  if (!executionConfirmed) issues.push("Falta confirmar que el servicio se realizó");
  const cancelled = candidate.Cancelado === true || candidate.SourceCancelled === true
    || ['CA', 'RT', 'RR'].includes(candidate.EstadoOrden) || ['CA', 'RT', 'RR'].includes(candidate.EstadoLinea);
  if (cancelled) issues.push("Hay una cancelación o devolución. Revisa si corresponde pagar este servicio.");
  if (candidate.PosibleDuplicado || candidate.PossibleDuplicate || candidate.CantidadAmbigua
    || candidate.AllocationShared) issues.push('Posible duplicado o cantidad compartida; requiere revisión');
  let amount = null;
  if (tariff && effectiveQuantity > 0 && Number.isFinite(effectiveQuantity)) {
    try { amount = multiplyHonorario(Number(tariff.amount), effectiveQuantity); }
    catch { issues.push('Revisa la cantidad y la tarifa: el importe es demasiado grande para calcularlo con precisión.'); }
  }
  return { ...candidate, ModeBI: true, CatalogStatus: status, CatalogApproved: catalogApproved,
    ReviewEligible: reviewEligible, ProfessionalCandidate: scope.professionalCandidate,
    ModalidadServicio: config?.modality || (CONTACT_CENTER_CODES.has(itemCode) ? 'contact_center' : 'presencial'),
    UnidadPago: config?.paymentUnit || 'servicio', CatalogRevision: config?.revision || 0,
    CatalogSnapshot: config ? { itemCode, revision: config.revision, status, modality: config.modality,
      paymentUnit: config.paymentUnit, reason: config.reason || '', active: config.active,
      scopeExcluded: Boolean(hardExcluded) } : null,
    TariffId: tariff?.id || null, TariffRevision: tariff?.revision || null,
    TariffSnapshot: tariff ? { ...tariff } : null, PrecioUnitarioBI: tariff?.amount ?? null,
    BaseImporteVertical: candidate.BaseImporteVertical ?? candidate.BaseImporte ?? null,
    BaseImporte: amount, CantidadReconocida: effectiveQuantity, MedicoId: providerId || null,
    Medico: providerId ? candidate.Medico || candidate.providerName || '' : '',
    ElegiblePago: 0, RequiereRevision: true, IntegridadBaseValida: tariff && amount > 0 ? 1 : 0,
    SinTabulador: tariff ? 0 : 1, BIStatusReasons: [...new Set(issues.filter(Boolean))],
    ExcluidoCatalogoBI: status === 'EXCLUIDO', ScopeExcluded: Boolean(hardExcluded), RealizacionConfirmada: executionConfirmed,
    PrecioReferenciaVertical: config?.referencePrices || [] };
}

async function loadPricingContext() {
  const [{ items }, tariffs] = await Promise.all([listCatalog({ autoSync: false }), listTariffs()]);
  return { configs: new Map(items.map(item => [item.itemCode, item])), tariffs };
}

async function enrichCandidates(candidates, pricingContext) {
  const { configs, tariffs } = pricingContext || await loadPricingContext();
  return candidates.map(candidate => enrichCandidate(candidate,
    configs.get(candidate.itemCode || candidate.CodigoServicio || candidate.ItemCode), tariffs));
}

async function discoverCandidates(candidates) {
  await ensureSchema();
  const unique = new Map(candidates.map(row => [row.CodigoServicio, row]).filter(([code]) => validCode(code)));
  const existing = await getDb().pool.query('SELECT item_code FROM bi_honorarios_catalog WHERE item_code=ANY($1::text[])', [[...unique.keys()]]);
  const known = new Set(existing.rows.map(row => row.item_code));
  for (const [code, row] of unique) {
    if (known.has(code)) continue;
    const excluded = isExcludedHonorariosService(row);
    await getDb().pool.query(`INSERT INTO bi_honorarios_catalog(item_code,name,description,group_name,source_metadata,
      scope_excluded,status,modality,reference_warnings) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(item_code) DO NOTHING`, [code, row.Servicio || code, row.GrupoServicio || '',
      { source: 'Prestación consultada; ficha pendiente de conciliación', itemType: 'S' }, excluded,
      excluded ? 'EXCLUIDO' : 'PENDIENTE', CONTACT_CENTER_CODES.has(code) ? 'contact_center' : 'presencial',
      JSON.stringify(['Concepto descubierto en una prestación; revisar ficha y tarifa'])]);
  }
}

module.exports = { ensureSchema, syncCatalog, syncIfDue, readSyncState, listCatalog, saveCatalogConfig,
  listTariffs, saveTariff, getCatalogHistory, resolveTariff, resolveTariffs, loadPricingContext, enrichCandidates, enrichCandidate,
  ensureCatalogReady, getCatalogItem, validateConfig, validateTariff, tariffOverlaps, normalizeSource, isExcludedHonorariosService,
  discoverCandidates,dateOnly, CATALOG_SQL, REFERENCE_SQL, DISCOVERY_SQL };
