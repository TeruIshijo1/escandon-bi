'use strict';

const MAX_BIGINT = '9223372036854775807';
const quote = identifier => `"${String(identifier).replace(/"/g, '""')}"`;
const invalid = () => Object.assign(new Error('La identidad operativa de Almacén no tiene una columna y secuencia propias compatibles.'), { code: 'DW_IDENTITY_INVALID' });
const IDENTITIES = [
  { table: 'dw_sap_kardex',column: 'idkardex' },
  { table: 'dw_cirrus_consumo',column: 'idcargo' },
  { table: 'dw_sap_entradas',column: 'identrada' },
];

async function migrateIdentity(pool, target, { lockTimeoutMs = 15000, statementTimeoutMs = 600000 } = {}) {
  if (!pool?.connect || !Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 1 || lockTimeoutMs > 60000
    || !Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1 || statementTimeoutMs > 900000) throw new TypeError('Configuración inválida de migración del Kardex.');
  const client = await pool.connect();
  let transaction = false, releaseError;
  try {
    const describe = () => client.query(`SELECT c.oid::text AS table_oid,n.nspname AS schema_name,c.relname AS table_name,
      a.attnum,a.atttypid::regtype::text AS column_type,
      pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname) AS sequence_name
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=$2 AND NOT a.attisdropped
      WHERE c.oid=to_regclass($1) AND c.relkind IN ('r','p')`, [target.table,target.column]);
    const inspect = async () => {
      const column = (await describe()).rows[0];
      if (!column?.sequence_name || !['smallint','integer','bigint'].includes(column.column_type)) throw invalid();
      const sequence = (await client.query(`SELECT n.nspname AS schema_name,c.relname AS sequence_name,
      s.seqtypid::regtype::text AS sequence_type,s.seqmax::text AS maximum,s.seqincrement::text AS increment,s.seqcycle AS cycling,
      EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid
        AND d.refclassid='pg_class'::regclass AND d.refobjid=$2::oid AND d.refobjsubid=$3 AND d.deptype IN ('a','i')) AS owned
      FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE s.seqrelid=$1::regclass`, [column.sequence_name, column.table_oid, column.attnum])).rows[0];
      if (!sequence?.owned || !['smallint','integer','bigint'].includes(sequence.sequence_type) || BigInt(sequence.increment) < 1n) throw invalid();
      return { column,sequence,widenColumn: column.column_type !== 'bigint',
        widenSequence: sequence.sequence_type !== 'bigint' || sequence.maximum !== MAX_BIGINT || sequence.cycling };
    };
    let metadata = await inspect();
    if (!metadata.widenColumn && !metadata.widenSequence) return { migrated: false,table: target.table,column: target.column,type: 'bigint' };
    await client.query('BEGIN'); transaction = true;
    await client.query("SELECT set_config('lock_timeout',$1,true), set_config('statement_timeout',$2,true)", [`${lockTimeoutMs}ms`, `${statementTimeoutMs}ms`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext(current_database()),hashtext($1))', [`bi:warehouse-identity-bigint:${metadata.column.table_oid}`]);
    const originalOid = metadata.column.table_oid;
    metadata = await inspect();
    if (metadata.column.table_oid !== originalOid) throw invalid();
    const table = `${quote(metadata.column.schema_name)}.${quote(metadata.column.table_name)}`;
    if (metadata.widenColumn || metadata.widenSequence) {
      await client.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
      metadata = await inspect();
      if (metadata.column.table_oid !== originalOid) throw invalid();
    }
    const { sequence,widenColumn,widenSequence } = metadata;
    // Amplía la capacidad sin consumir ni reiniciar identificadores existentes.
    if (widenColumn) await client.query(`ALTER TABLE ${table} ALTER COLUMN ${quote(target.column)} TYPE BIGINT`);
    if (widenSequence) await client.query(`ALTER SEQUENCE ${quote(sequence.schema_name)}.${quote(sequence.sequence_name)} AS BIGINT MAXVALUE ${MAX_BIGINT} NO CYCLE`);
    await client.query('COMMIT'); transaction = false;
    return { migrated: Boolean(widenColumn || widenSequence),table: target.table,column: target.column,type: 'bigint' };
  } catch (error) {
    if (transaction) { try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; } }
    throw error;
  } finally { client.release(releaseError); }
}

const ensureKardexBigint = (pool, options) => migrateIdentity(pool, IDENTITIES[0], options);
async function ensureWarehouseBigintIdentities(pool, options) {
  const tables = [];
  for (const target of IDENTITIES) tables.push(await migrateIdentity(pool, target, options));
  return { migrated: tables.some(table => table.migrated),tables };
}

module.exports = { ensureKardexBigint,ensureWarehouseBigintIdentities };
