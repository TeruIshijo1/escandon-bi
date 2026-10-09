'use strict';

const finance = require('./assistantAccountFinance.service');
const vertical = require('./verticalReportCatalog.service');
const id = 'assistant_account_case';
const financeId = 'assistant_account_billing_collections';
const chargeId = 'vertical_account_charges';
const chargeKeys = ['ChargeDate', 'ItemCode', 'ItemDescription', 'Quantity', 'UnitPrice'];
const catalog = { [id]: {
  ...finance.catalog[financeId], id, title: 'Cuenta hospitalaria con facturación, cobros e insumos',
  aliases: ['cuenta con facturación e insumos', 'estado de cuenta con cargos y facturas', 'cuenta con facturas pagos e insumos', 'cuenta con servicios consumidos'],
  description: 'Consulta una atención por su folio exacto con el estado de cuenta, sus facturas y cobros actuales, y el detalle de sus artículos y servicios. El período opcional limita las fechas de atención y cargo.',
  grain: 'Una fila por cargo de una sola atención. El saldo y los importes de facturas se repiten en sus cargos; no deben sumarse. Una atención sin cargos conserva una fila con los datos de cuenta.',
  pointLookupFields: ['PCNum'], pointLookupRequired: true,
  requiredPermissions: ['vertical_accounts', 'sales_invoice_summary', 'incoming_payments', 'vertical_account_charges'],
  defaultFields: ['PCNum', 'PatientName', 'AccountStatus', 'MedicalDischargeDate', 'ClosedOn', 'AccountBalance', 'BillingStatus', 'InvoiceFolios', 'CollectionStatus', 'PaymentFolios',
    'ChargeNum', 'ChargeDate', 'ItemCode', 'ItemDescription', 'Quantity', 'UnitPrice'],
  fields: [...finance.catalog[financeId].fields, { ...vertical.catalog[chargeId].fields.find(field => field.key === 'PCITNum'), key: 'ChargeNum' },
    ...chargeKeys.map(key => ({ ...vertical.catalog[chargeId].fields.find(field => field.key === key) }))],
  nonAdditiveFields: ['AccountBalance', 'InvoiceTotal', 'InvoiceBalance', 'ReceivedAppliedAmount', 'InvoiceCount', 'UnitPrice'],
  summary: {}
} };

const failure = message => Object.assign(new Error(message), { status: 400 });
const positiveId = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647;

async function execute(entity, options = {}) {
  if (entity !== id) throw failure('La consulta de esta cuenta no está disponible.');
  const { pointLookup, limit = 10000, busqueda = '', searchFields } = options;
  if (!pointLookup || pointLookup.field !== 'PCNum' || !Number.isInteger(pointLookup.value) || !positiveId(pointLookup.value)
    || Object.keys(pointLookup).some(key => !['field', 'value'].includes(key))) throw failure('Indica el folio exacto de atención para consultar su cuenta, facturas e insumos.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000 || typeof busqueda !== 'string' || busqueda.length > 200) throw failure('Los filtros de la consulta de cuenta no son válidos.');
  const searched = searchFields || catalog[id].fields.map(field => field.key);
  if (!Array.isArray(searched) || !searched.length || searched.some(key => !catalog[id].fields.some(field => field.key === key))) throw failure('Los campos de búsqueda no son válidos.');
  const period = { fechaDesde: options.fechaDesde, fechaHasta: options.fechaHasta, pointLookup, limit: 10000 };
  const accountResult = await finance.execute(financeId, { ...period, estatusDoc: options.estatusDoc || 'ALL', busqueda: '' });
  if (accountResult.truncated || accountResult.complete === false || accountResult.analysisScope?.complete === false || !Array.isArray(accountResult.rows)) throw failure('No se pudo verificar la cuenta completa. Intenta nuevamente.');
  if (!accountResult.rows.length) return { rows: [], truncated: false };
  if (accountResult.rows.length !== 1 || !positiveId(accountResult.rows[0].PCNum) || Number(accountResult.rows[0].PCNum) !== pointLookup.value) throw failure('Los datos recibidos no corresponden a una única atención. No se consultaron sus cargos.');
  const charges = await vertical.execute(chargeId, { ...period, busqueda: '' });
  if (charges.truncated || charges.complete === false || charges.analysisScope?.complete === false || !Array.isArray(charges.rows)) throw failure('La cuenta tiene más cargos de los que se pudieron verificar. Consulta un período más corto.');
  const seen = new Set();
  for (const charge of charges.rows) {
    if (!positiveId(charge.PCNum) || Number(charge.PCNum) !== pointLookup.value || !positiveId(charge.PCITNum)
      || seen.has(Number(charge.PCITNum))) throw failure('No se pudo verificar que todos los cargos correspondan una sola vez a esta atención.');
    seen.add(Number(charge.PCITNum));
  }
  const account = accountResult.rows[0];
  const search = busqueda.trim().toLocaleLowerCase('es-MX');
  const rows = (charges.rows.length ? charges.rows : [null]).map(charge => ({
    ...Object.fromEntries(finance.catalog[financeId].fields.map(field => [field.key, account[field.key] ?? null])),
    ChargeNum: charge?.PCITNum ?? null, ...Object.fromEntries(chargeKeys.map(key => [key, charge?.[key] ?? null]))
  })).filter(row => !search || searched.some(key => row[key] != null && String(row[key]).toLocaleLowerCase('es-MX').includes(search)));
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

module.exports = { catalog, execute };
