'use strict';

const { connectRemoteDB, sql } = require('../config/remote-db');

// Fuentes disponibles para preparar reportes conversacionales. Las expresiones
// y relaciones son cerradas: el asistente nunca aporta SQL ni nombres de tabla.
// Columnas, tipos y claves: tmp/vertical-metadata-2026-10-06.json.
const catalog = Object.create(null);
const definitions = Object.create(null);
const field = (key, label, type, expression, unit) => ({
  key, label, type: type || 'string', expression,
  ...(unit ? { unit } : {}),
  width: type === 'datetime' ? 180 : type === 'money' || type === 'number' || type === 'percent' ? 150 : 220,
  ...(['money', 'number', 'percent'].includes(type) ? { align: 'right' } : {})
});

// V_BP puede tener varias filas por pagador. Reducir por empresa y código evita
// multiplicar convenios o cuentas. Un nombre discrepante queda sin resolver.
const partnerNames = `(SELECT FCCode, BPCode,
  CASE WHEN COUNT(DISTINCT BPName) = 1 THEN MAX(BPName) END AS BPName
  FROM dbo.V_BP GROUP BY FCCode, BPCode)`;

// AG's concept references match V_IT.ItemCode (verified against the live
// masters on 2026-10-08; no declared FK). AG.FCCode may be null. The aggregate
// produces at most one description and leaves conflicting names unknown.
const agreementConcept = (column, alias) => `OUTER APPLY (SELECT
  CASE WHEN COUNT(DISTINCT conceptItem.ItemName) = 1 THEN MAX(conceptItem.ItemName) END AS ItemName
  FROM dbo.V_IT conceptItem WHERE conceptItem.ItemCode = ag.${column}) ${alias}`;

function define(id, config, fields) {
  const { from, date, order, status, ...metadata } = config;
  definitions[id] = { from, date, order, status, fields };
  catalog[id] = {
    id, source: 'Vertical', assistantOnly: true, requiresDateFilter: Boolean(date),
    filters: [], summary: {}, ...metadata,
    fields: fields.map(({ expression: _expression, ...column }) => column)
  };
}

define('assistant_commercial_agreements', {
  title: 'Acuerdos comerciales y convenios', icon: '🤝', category: 'Convenios y Cuentas',
  aliases: ['acuerdos', 'convenios', 'acuerdos comerciales', 'convenios comerciales', 'convenios con aseguradoras', 'condiciones comerciales', 'descuentos de convenios'],
  description: 'Convenios maestros de Vertical con conceptos por código de artículo, sus descripciones, valores predeterminados, pagador, lista de precios, descuentos y estado registrados.',
  grain: 'Una fila por convenio maestro (AGCode). Conceptos por código exacto de artículo; las descripciones discrepantes quedan desconocidas. Los valores predeterminados, descuentos y factores son referencias del maestro, no importes aplicados a una cuenta.',
  requiredPermissions: ['assistant_commercial_agreements'],
  identityFields: ['AgreementCode', 'AgreementName'],
  conditionFields: ['Deductible', 'CopayAmount', 'CopayPercentage', 'Coinsurance', 'CoinsurancePercentage'],
  relatedFields: {
    Deductible: ['DeductibleItemName', 'DefaultDeductible'],
    CopayAmount: ['CopayAmountItemName', 'DefaultCopayAmount'],
    CopayPercentage: ['CopayPercentageItemName', 'DefaultCopayPercentage'],
    Coinsurance: ['CoinsuranceItemName'],
    CoinsurancePercentage: ['CoinsurancePercentageItemName', 'DefaultCoinsurancePercentage']
  },
  defaultFields: ['AgreementCode', 'AgreementName', 'BPCode', 'BPName', 'PriceListNum', 'GlobalDiscount', 'PriceFactor',
    'Deductible', 'DeductibleItemName', 'DefaultDeductible', 'CopayAmount', 'CopayAmountItemName', 'DefaultCopayAmount',
    'CopayPercentage', 'CopayPercentageItemName', 'DefaultCopayPercentage', 'Coinsurance', 'CoinsuranceItemName',
    'CoinsurancePercentage', 'CoinsurancePercentageItemName', 'DefaultCoinsurancePercentage', 'AgreementStatus'],
  from: `dbo.AG ag LEFT JOIN ${partnerNames} bp ON bp.BPCode = ag.BPCode AND bp.FCCode = ag.FCCode
    ${agreementConcept('Deductible', 'deductibleItem')}
    ${agreementConcept('CopayAmount', 'copayAmountItem')}
    ${agreementConcept('CopayPercentage', 'copayPercentageItem')}
    ${agreementConcept('Coinsurance', 'coinsuranceItem')}
    ${agreementConcept('CoinsurancePercentage', 'coinsurancePercentageItem')}`,
  order: 'ag.AGCode'
}, [
  field('AgreementCode', 'Código de convenio', 'string', 'ag.AGCode'),
  field('AgreementName', 'Convenio', 'string', 'ag.AGName'),
  field('BPCode', 'Código del pagador', 'string', 'ag.BPCode'),
  field('BPName', 'Pagador registrado en Vertical', 'string', 'bp.BPName'),
  field('PriceListNum', 'Número de lista de precios', 'number', 'ag.PriceListNum'),
  field('GlobalDiscount', 'Descuento global registrado (%)', 'percent', 'ag.GlobalDiscount'),
  field('PriceFactor', 'Factor de precio registrado', 'number', 'ag.PriceFactor'),
  field('AgreementStatus', 'Estado del convenio en Vertical', 'string', 'ag.AG_ST'),
  field('PLCode', 'Código de tabulador', 'string', 'ag.PLCode'),
  field('PLVersion', 'Versión de tabulador', 'string', 'ag.PLVersion'),
  // These strings are registered concept item codes. Keep codes, descriptions
  // and numeric defaults independent, including missing or unexpected links.
  { ...field('Deductible', 'Código de concepto de deducible del convenio', 'string', 'ag.Deductible'), aliases: ['Deducible del convenio'] },
  field('DeductibleItemName', 'Concepto de deducible del convenio', 'string', 'deductibleItem.ItemName'),
  { ...field('CopayAmount', 'Código de concepto de copago del convenio', 'string', 'ag.CopayAmount'), aliases: ['Copago del convenio'] },
  field('CopayAmountItemName', 'Concepto de copago del convenio', 'string', 'copayAmountItem.ItemName'),
  { ...field('CopayPercentage', 'Código de concepto de copago del convenio (%)', 'string', 'ag.CopayPercentage', 'percent'), aliases: ['Copago del convenio (%)'] },
  field('CopayPercentageItemName', 'Concepto de copago del convenio (%)', 'string', 'copayPercentageItem.ItemName'),
  field('Coinsurance', 'Código de concepto de coaseguro del convenio', 'string', 'ag.Coinsurance'),
  field('CoinsuranceItemName', 'Concepto de coaseguro del convenio', 'string', 'coinsuranceItem.ItemName'),
  { ...field('CoinsurancePercentage', 'Código de concepto de coaseguro del convenio (%)', 'string', 'ag.CoinsurancePercentage', 'percent'), aliases: ['Coaseguro del convenio (%)'] },
  field('CoinsurancePercentageItemName', 'Concepto de coaseguro del convenio (%)', 'string', 'coinsurancePercentageItem.ItemName'),
  field('DefaultDeductible', 'Deducible predeterminado del convenio', 'money', 'ag.DefaultDeductible'),
  field('DefaultCopayAmount', 'Copago predeterminado del convenio', 'money', 'ag.DefaultCopayAmount'),
  field('DefaultCopayPercentage', 'Copago predeterminado del convenio (%)', 'percent', 'ag.DefaultCopayPercentage'),
  field('DefaultCoinsurancePercentage', 'Coaseguro predeterminado del convenio (%)', 'percent', 'ag.DefaultCoinsurancePercentage'),
  field('AdministrativeChargeAmount', 'Cargo administrativo del convenio', 'money', 'ag.AdministrativeChargeAmount'),
  field('AdministrativeChargePercent', 'Cargo administrativo del convenio (%)', 'percent', 'ag.AdministrativeChargePercent'),
  field('AdministrativeChargeDescription', 'Descripción del cargo administrativo', 'string', 'ag.AdministrativeChargeDescription'),
  field('AdditionalDiscount01', 'Descuento adicional 1 del convenio', 'number', 'ag.AdditionalDiscount01'),
  field('AdditionalDiscount02', 'Descuento adicional 2 del convenio', 'number', 'ag.AdditionalDiscount02'),
  field('AdditionalDiscount03', 'Descuento adicional 3 del convenio', 'number', 'ag.AdditionalDiscount03'),
  field('PLFactor', 'Factor del tabulador', 'number', 'ag.PLFactor'),
  field('PLSurcharge', 'Recargo del tabulador', 'number', 'ag.PLSurcharge'),
  field('TaxRate', 'Impuesto del convenio (%)', 'percent', 'ag.TaxRate'),
  field('TaxCode', 'Código de impuesto del convenio', 'string', 'ag.TaxCode'),
  field('PatientCareAgreement', 'Aplicable a cuentas de pacientes', 'boolean', 'ag.PatientCareAgreement'),
  field('SalesOrderAgreement', 'Aplicable a órdenes de venta', 'boolean', 'ag.SalesOrderAgreement'),
  field('CreatedOn', 'Fecha de registro', 'datetime', 'ag.CreatedOn')
]);

define('assistant_patient_accounts', {
  title: 'Cuentas de pacientes con convenios', icon: '🏥', category: 'Convenios y Cuentas',
  aliases: ['acuerdos comerciales y estados de cuenta del paciente', 'estados de cuenta con convenios', 'estado de cuenta con convenio', 'cuentas con acuerdos comerciales', 'estado de cuenta del paciente'],
  description: 'Cuentas y atenciones con paciente, médico, pagador y convenios aplicados en Vertical; conserva cuentas sin convenio.',
  grain: 'Una fila por convenio de atención (PCNum y PCAGNum); las cuentas sin convenio conservan una fila. Los importes de cuenta se repiten por convenio y no se suman.',
  requiredPermissions: ['vertical_accounts', 'assistant_commercial_agreements'],
  pointLookupFields: ['PCNum', 'PTNum'],
  defaultFields: ['PCNum', 'AttentionDate', 'PatientName', 'DoctorName', 'AgreementName', 'BPName', 'AccountStatus', 'AccountTotal', 'AccountBalance', 'AccountDownpayments',
    'PriceListNum', 'AgreementGlobalDiscount', 'GlobalDiscount', 'TotalDiscount', 'Deductible', 'Copay', 'CoinsurancePercentage'],
  nonAdditiveFields: ['AccountTotal', 'AccountBalance', 'AccountDownpayments'],
  filters: ['estatusDoc'],
  statusOptions: [
    { value: 'ALL', label: 'Todas las cuentas' }, { value: 'OPEN', label: 'Abiertas' },
    { value: 'CLOSED', label: 'Cerradas' }, { value: 'CANCELED', label: 'Canceladas' }
  ],
  dateFieldLabel: 'Fecha de atención', date: 'pc.[Date]', status: 'pc.PC_ST',
  from: `dbo.PC pc
    LEFT JOIN dbo.PT pt ON pt.PTNum = pc.PTNum
    LEFT JOIN dbo.PR pr ON pr.PRNum = pc.PRNum
    LEFT JOIN dbo.PCAG pa ON pa.PCNum = pc.PCNum
    LEFT JOIN dbo.AG ag ON ag.AGCode = pa.AGCode
    LEFT JOIN ${partnerNames} bp
      ON bp.BPCode = COALESCE(pa.BPCode, ag.BPCode, pc.BPCode)
      AND bp.FCCode = COALESCE(ag.FCCode, pc.FCCode)`,
  order: 'pc.[Date] DESC, pc.PCNum DESC, pa.PCAGNum'
}, [
  field('PCNum', 'Folio de atención', 'number', 'pc.PCNum'),
  field('PTNum', 'Número de paciente', 'number', 'pc.PTNum'),
  field('PatientName', 'Paciente', 'string', 'pt.FullName'),
  field('PRNum', 'Número de médico', 'number', 'pc.PRNum'),
  field('DoctorName', 'Médico', 'string', 'pr.FullName'),
  field('AttentionDate', 'Fecha de atención', 'datetime', 'pc.[Date]'),
  field('AccountStatus', 'Estado de cuenta en Vertical', 'string', 'pc.PC_ST'),
  field('AccountType', 'Tipo de atención', 'string', 'pc.PCType'),
  field('AccountTotal', 'Total registrado de cuenta', 'money', 'pc.Total'),
  field('AccountBalance', 'Saldo registrado de cuenta', 'money', 'pc.Balance'),
  field('AccountDownpayments', 'Anticipos de cuenta', 'money', 'pc.Downpayments'),
  field('MedicalDischargeDate', 'Fecha de alta médica', 'datetime', 'pc.MedicalDischargeDate'),
  field('ClosedOn', 'Fecha de cierre', 'datetime', 'pc.ClosedOn'),
  field('PCAGNum', 'Número de convenio de atención', 'number', 'pa.PCAGNum'),
  field('AgreementCode', 'Código de convenio', 'string', 'pa.AGCode'),
  field('AgreementName', 'Convenio', 'string', 'ag.AGName'),
  field('AgreementStatus', 'Estado del convenio de atención', 'string', 'pa.PCAG_ST'),
  field('BPCode', 'Código del pagador', 'string', 'COALESCE(pa.BPCode, ag.BPCode, pc.BPCode)'),
  field('BPName', 'Pagador registrado en Vertical', 'string', 'bp.BPName'),
  field('PriceListNum', 'Número de lista de precios aplicada', 'number', 'COALESCE(pa.PriceListNum, ag.PriceListNum)'),
  field('GlobalDiscount', 'Descuento global del convenio de atención', 'percent', 'pa.GlobalDiscount'),
  field('AgreementGlobalDiscount', 'Descuento global del convenio maestro (%)', 'percent', 'ag.GlobalDiscount'),
  field('Deductible', 'Deducible registrado', 'money', 'pa.Deductible'),
  field('Copay', 'Copago registrado', 'money', 'pa.Copay'),
  field('CoinsurancePercentage', 'Porcentaje de coaseguro registrado', 'percent', 'pa.CoinsurancePercentage'),
  field('AgreementTotal', 'Importe registrado del convenio', 'money', 'pa.AgreementTotal'),
  field('AdditionalDiscountPercentage', 'Descuento adicional de atención (%)', 'percent', 'pa.AdditionalDiscountPercentage'),
  field('TotalDiscount', 'Descuento aplicado a la atención', 'money', 'pa.TotalDiscount'),
  field('TotalDeductible', 'Deducible aplicado a la atención', 'money', 'pa.TotalDeductible'),
  field('TotalCopay', 'Copago aplicado a la atención', 'money', 'pa.TotalCopay'),
  field('TotalCoinsurance', 'Coaseguro aplicado a la atención', 'money', 'pa.TotalCoinsurance'),
  field('CopayPercentage', 'Copago de la atención (%)', 'percent', 'pa.CopayPercentage'),
  field('CoinsuranceAmount', 'Coaseguro registrado de atención', 'money', 'pa.CoinsuranceAmount'),
  field('PolicyNumber', 'Póliza del convenio de atención', 'string', 'pa.PolicyNumber'),
  field('ClaimAuthorizationNumber', 'Autorización del convenio de atención', 'string', 'pa.ClaimAuthorizationNumber')
]);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function civilDate(value) {
  if (!(value instanceof Date)) return value;
  if (!Number.isFinite(value.getTime())) return null;
  const pad = number => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

async function execute(entityId, options = {}) {
  const id = typeof entityId === 'string' ? entityId : entityId?.id;
  const definition = definitions[id];
  if (!definition) throw Object.assign(new Error('La fuente solicitada no está disponible.'), { status: 400 });
  const { fechaDesde, fechaHasta, busqueda, estatusDoc = 'ALL', pointLookup } = options;
  if (pointLookup && (!(catalog[id].pointLookupFields || []).includes(pointLookup.field)
    || !Number.isInteger(pointLookup.value) || pointLookup.value < 1 || pointLookup.value > 2147483647)) {
    throw Object.assign(new Error('La identificación de la cuenta o paciente no es válida.'), { status: 400 });
  }
  const limit = options.limit === undefined ? 10000 : Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw Object.assign(new Error('El límite debe estar entre 1 y 10000 registros.'), { status: 400 });
  }
  const hasPeriod = Boolean(fechaDesde || fechaHasta);
  if (definition.date && (!pointLookup || hasPeriod) && (!validDate(fechaDesde) || !validDate(fechaHasta) || fechaDesde > fechaHasta
    || (Date.parse(fechaHasta) - Date.parse(fechaDesde)) / 86400000 > 366)) {
    throw Object.assign(new Error('El periodo de consulta no es válido.'), { status: 400 });
  }
  if (busqueda != null && (typeof busqueda !== 'string' || busqueda.length > 500)) {
    throw Object.assign(new Error('El texto de búsqueda no es válido.'), { status: 400 });
  }
  const allowedStatuses = catalog[id].statusOptions?.map(option => option.value) || ['ALL'];
  if (typeof estatusDoc !== 'string' || !allowedStatuses.includes(estatusDoc)) {
    throw Object.assign(new Error('El estado elegido no está disponible para este reporte.'), { status: 400 });
  }

  const pool = await connectRemoteDB();
  const request = pool.request().input('rowLimit', sql.Int, limit + 1);
  const conditions = [];
  if (pointLookup) {
    request.input('pointIdentity', sql.Int, pointLookup.value);
    conditions.push(`${definition.fields.find(field => field.key === pointLookup.field).expression} = @pointIdentity`);
  }
  if (definition.date && hasPeriod) {
    request.input('fechaDesde', sql.VarChar(10), fechaDesde).input('fechaHasta', sql.VarChar(10), fechaHasta);
    conditions.push(`${definition.date} >= CAST(@fechaDesde AS date)`, `${definition.date} < DATEADD(day, 1, CAST(@fechaHasta AS date))`);
  }
  if (estatusDoc !== 'ALL') {
    request.input('estadoCuenta', sql.NVarChar(2), { OPEN: 'OP', CLOSED: 'CL', CANCELED: 'CA' }[estatusDoc]);
    conditions.push(`${definition.status} = @estadoCuenta`);
  }
  const search = busqueda?.trim();
  if (search) {
    request.input('busqueda', sql.NVarChar(1002), `%${search.replace(/[\\%_[]/g, '\\$&')}%`);
    conditions.push(`(${definition.fields.map(column => {
      const style = column.type === 'datetime' ? ', 126' : '';
      return `CONVERT(nvarchar(4000), ${column.expression}${style}) LIKE @busqueda ESCAPE '\\'`;
    }).join(' OR ')})`);
  }
  const response = await request.query(`SELECT TOP (@rowLimit)
    ${definition.fields.map(column => `${column.expression} AS [${column.key}]`).join(',\n    ')}
    FROM ${definition.from}
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY ${definition.order}`);
  const records = response.recordset || [];
  if (pointLookup && records.some(row => Number(row[pointLookup.field]) !== pointLookup.value)) {
    throw new Error('No se pudo verificar la identidad de todos los registros de la cuenta o paciente.');
  }
  return {
    rows: records.slice(0, limit).map(row => Object.fromEntries(definition.fields.map(column => [column.key, civilDate(row[column.key])]))),
    truncated: records.length > limit
  };
}

module.exports = { catalog, execute };
