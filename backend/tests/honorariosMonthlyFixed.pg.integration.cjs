'use strict';
// Sólo un esquema aleatorio de prueba en BI; el médico y su directorio son
// sintéticos. No conecta SAP ni clínica, ni modifica datos de negocio.
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const schema = `test_honorarios_fixed_${Date.now()}_${process.pid}`;
const connection = { user: process.env.PGUSER || 'postgres', host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'escandon_bi', port: Number(process.env.PGPORT || 5432), password: process.env.PGPASSWORD };
const admin = new Pool(connection), pool = new Pool({ ...connection, options: `-c search_path=${schema}` });
const id = require.resolve('../config/db');
require.cache[id] = { id, filename: id, loaded: true, exports: { getDb: () => ({ pool }) } };
const monthly = require('../services/honorariosMonthlyFixed.service');
const { reviewFingerprint } = require('../utils/honorariosReviewSource');
const user = { id: 71, nombre: 'REVISOR FICTICIO', permisos: ['interconsultas-jornadas'] };
const remote = { request() { return { async query(sql) {
  assert.match(sql, /SELECT PRNum,FullName,Role FROM PR WHERE Role='P'/);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
  return { recordset: [9001, 9002, 9003].map(PRNum => ({ PRNum, FullName: `MÉDICO FICTICIO ${PRNum}`, Role: 'P' })) };
} }; } };
const input = changes => ({ expectedRevision: 0, providerId: 9001, area: 'Área de prueba', amount: 5000,
  amountBasis: 'BASE', monthPolicy: 'FULL_MONTH', validFromMonth: '2026-09', ...changes });
const rowFor = async (providerId = 9001, feeMonth = '2026-09') => (await monthly.getPeriodRows(`${feeMonth}-15`, `${feeMonth}-20`))
  .find(row => row.SourceIdentity === `FIXED|${providerId}|${feeMonth}`);
const decide = (row, action, expectedRevision = 0, changes = {}) => monthly.saveMonthlyReview(remote, {
  rowId: row.SourceIdentity, serviceDate: row.FechaAtencion, expectedRevision,
  decision: { action, fingerprint: reviewFingerprint(row), motivo: 'Decisión mensual de prueba', vatRate: 0,
    customAmount: 1, quantity: 99, providerId: 999999, ...changes }
}, user);

(async () => {
  try {
    assert.match(schema, /^test_honorarios_fixed_\d+_\d+$/);
    await admin.query(`CREATE SCHEMA ${schema}`);
    assert.deepEqual(await monthly.getPeriodRows('9999-12-15', '9999-12-20'), []);
    await assert.rejects(monthly.saveAssignment(remote, input(), { id: 72, permisos: [] }), { status: 403 });
    await assert.rejects(monthly.saveAssignment(remote, input({ providerId: 999999 }), user), { status: 400 });
    const config = await monthly.saveAssignment(remote, input(), user);
    assert.equal(config.providerName, 'MÉDICO FICTICIO 9001');
    let row = await rowFor();
    assert.equal(row.BaseImporte, 5000); assert.equal(row.Cantidad, 1); assert.equal(row.FechaAtencion, '2026-09-01');
    assert.equal(row.ElegiblePago, 0); assert.equal(row.ReviewEligible, true);
    assert.deepEqual(await monthly.readMonthlyReviews('2026-09-15', '2026-09-20'), {});
    await assert.rejects(decide(row, 'APROBAR', 0, { vatRate: undefined }), { status: 400 });
    const approved = await decide(row, 'APROBAR');
    assert.equal(approved.customAmount, 5000); assert.equal(approved.snapshot.quantity, 1);
    assert.equal(approved.snapshot.providerId, '9001'); assert.equal(approved.sourceType, 'BI_FIJO_MENSUAL');
    const reread = await monthly.readMonthlyReviews('2026-09-15', '2026-09-20');
    assert.equal(reread[row.SourceIdentity].action, 'APROBAR');
    assert.equal(reread[row.SourceIdentity].fingerprint, reviewFingerprint(await rowFor()));
    assert.equal(reread[row.SourceIdentity].snapshot.fixed.amount, 5000);
    await assert.rejects(decide(row, 'EXCLUIR'), { status: 409 });
    await decide(row, 'EXCLUIR', 1); await decide(row, 'PENDIENTE', 2);
    assert.equal((await monthly.readMonthlyReviews('2026-09-20', '2026-09-20'))[row.SourceIdentity].action, 'PENDIENTE');
    const approvedAgain = await decide(row, 'APROBAR', 3);
    console.log('PASS: permiso, médico exacto, mensual completo opcional, aprobación/omisión/revisión persistidas y corte parcial.');

    await assert.rejects(monthly.saveAssignment(remote, input({ validFromMonth: '2026-10' }), user), { status: 409 });
    const changed = await monthly.saveAssignment(remote, input({ id: config.id, expectedRevision: config.revision,
      validFromMonth: '2026-10', amount: 6000 }), user);
    assert.notEqual(changed.id, config.id);
    assert.equal((await monthly.listAssignments()).find(item => item.id === config.id).validToMonth, '2026-09');
    assert.equal((await rowFor()).BaseImporte, 5000); assert.equal((await rowFor(9001, '2026-10')).BaseImporte, 6000);
    await assert.rejects(decide(row, 'APROBAR', 4), { status: 409 });
    // La firma preparada antes de editar no puede pasar el bloqueo de cierre.
    const staleClient = await pool.connect();
    try { await staleClient.query('BEGIN'); await assert.rejects(monthly.lockAndValidateRows(staleClient, [row]), { status: 409 }); }
    finally { await staleClient.query('ROLLBACK'); staleClient.release(); }
    await assert.rejects(monthly.saveAssignment(remote, input({ id: changed.id, expectedRevision: 0, validFromMonth: '2026-10' }), user), { status: 409 });
    const withdrawn = await monthly.deactivateAssignment(remote, { id: changed.id, expectedRevision: changed.revision,
      deactivatedFromMonth: '2026-11', reason: 'Baja prospectiva de prueba' }, user);
    assert.equal((await rowFor(9001, '2026-10')).BaseImporte, 6000); assert.equal(await rowFor(9001, '2026-11'), undefined);
    await assert.rejects(monthly.deactivateAssignment(remote, { id: withdrawn.id, expectedRevision: withdrawn.revision,
      deactivatedFromMonth: '2026-12' }, user), { status: 409 });
    await assert.rejects(monthly.saveAssignment(remote, input({ validFromMonth: '2026-10', validToMonth: '2026-10' }), user), { status: 409 });
    await monthly.saveAssignment(remote, input({ id: withdrawn.id, expectedRevision: withdrawn.revision,
      validFromMonth: '2026-10', amount: 6000, active: true }), user);
    assert.equal((await rowFor(9001, '2026-11')).BaseImporte, 6000);
    const inactive = await monthly.saveAssignment(remote, input({ providerId: 9003, active: false,
      deactivatedFromMonth: '2026-11' }), user);
    assert.equal(inactive.deactivatedFromMonth, null); assert.equal(await rowFor(9003), undefined);
    console.log('PASS: vigencias sin duplicados, edición temporal conserva meses previos, firmas obsoletas rechazadas, baja prospectiva y reactivación.');

    // Dos sesiones que intentan crear el mismo total mensual se serializan.
    const raced = await Promise.allSettled([monthly.saveAssignment(remote, input({ providerId: 9002 }), user),
      monthly.saveAssignment(remote, input({ providerId: 9002 }), user)]);
    assert.equal(raced.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(raced.find(item => item.status === 'rejected').reason.status, 409);
    row = await rowFor(9002);
    const paidReview = await decide(row, 'APROBAR');
    // Dos cierres usan el mismo bloqueo proveedor-mes y sólo uno conserva la fila.
    const close = async liquidationId => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); await monthly.lockAndValidateRows(client, [row]);
        await client.query('INSERT INTO bi_honorarios_finalized_rows(row_id,liquidation_id,snapshot) VALUES($1,$2,$3)',
          [row.SourceIdentity, liquidationId, { ...paidReview.snapshot, netAmount: 4500, isr: 500, vat: 0 }]);
        await client.query('COMMIT'); return liquidationId;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    };
    const closes = await Promise.allSettled([close(101), close(102)]);
    assert.equal(closes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(closes.find(item => item.status === 'rejected').reason.status, 409);
    await assert.rejects(decide(row, 'PENDIENTE', 1), { status: 409 });
    const fixedConfig = (await monthly.listAssignments()).find(item => item.providerId === '9002');
    await monthly.saveAssignment(remote, input({ id: fixedConfig.id, providerId: 9002, expectedRevision: fixedConfig.revision, amount: 9999 }), user);
    let restored = await rowFor(9002);
    assert.equal(restored.BaseImporte, 5000); assert.equal(restored.SnapshotCierre.netAmount, 4500);
    await monthly.deactivateAssignment(remote, { id: fixedConfig.id, expectedRevision: fixedConfig.revision + 1,
      deactivatedFromMonth: '2026-09' }, user);
    restored = await rowFor(9002);
    assert.equal(restored.BaseImporte, 5000); assert.equal(restored.SourceIdentity, row.SourceIdentity);
    assert.equal(monthly.fixedFingerprint(restored.FixedMonthlySnapshot), row.SourceFingerprint);
    assert.equal(Number((await pool.query('SELECT count(*) n FROM bi_honorarios_finalized_rows')).rows[0].n), 1);
    assert.ok(Number((await pool.query('SELECT count(*) n FROM bi_honorarios_monthly_fixed_history')).rows[0].n) >= 8);
    assert.equal(approvedAgain.snapshot.fixed.month, '2026-09');
    console.log('PASS: alta concurrente sin traslapes, cierre único por médico-mes, bloqueo de decisiones cerradas e importes históricos inmutables.');
  } finally {
    await pool.end();
    if (!/^test_honorarios_fixed_\d+_\d+$/.test(schema)) throw new Error('Unsafe test schema');
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
})().catch(error => { console.error('FAIL: monthly fixed isolated integration:', error.message); process.exitCode = 1; });
