'use strict';

// Campos contrastados con $metadata del Service Layer del hospital.
// Las consultas nuevas usan GET; no crean ni modifican documentos de SAP.
const sapService = require('./sap.service');
const field = (key, label, type = 'string', width = 160) => ({ key, label, type, width,
  ...(type === 'money' ? { align: 'right' } : {}) });
const num = value => value == null ? null : Number(value);
const date = value => value ? String(value).slice(0, 10) : null;
const yes = value => value === 'tYES' || value === 'Y' || value === true;
const state = value => value === 'bost_Open' ? 'Abierta' : value === 'bost_Close' ? 'Cerrada' : value;
const catalog = Object.create(null);
const definitions = Object.create(null);
function add(id, title, icon, category, description, fields, options) {
  const { endpoint, select, order, map, sourceFilter, ...metadata } = options;
  catalog[id] = { id, title, icon, category, description, source: 'SAP',
    requiresDateFilter: false, filters: [], defaultFields: fields.slice(0, 8).map(f => f.key),
    fields, ...metadata };
  definitions[id] = { endpoint, select, order, map, sourceFilter };
}

const headerFields = [field('DocEntry', 'Identificador del documento'), field('DocNum', 'Folio SAP'),
  field('DocDate', 'Fecha de emisión', 'date'), field('DocDueDate', 'Fecha de vencimiento', 'date'),
  field('CardCode', 'Código del socio'), field('CardName', 'Cliente / proveedor', 'string', 260),
  field('DocCurrency', 'Moneda del documento'), field('DocTotal', 'Total en moneda local', 'money'),
  field('PaidToDate', 'Aplicado en moneda local', 'money'), field('Balance', 'Saldo actual en moneda local', 'money'),
  field('DocStatus', 'Estado del documento', 'status'), field('Comments', 'Observaciones', 'string', 240)];
const headerSelect = 'DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocCurrency,DocTotal,PaidToDate,DocumentStatus,Comments';
function header(doc) {
  return { DocEntry: doc.DocEntry, DocNum: doc.DocNum, DocDate: date(doc.DocDate),
    DocDueDate: date(doc.DocDueDate), CardCode: doc.CardCode, CardName: doc.CardName,
    DocCurrency: doc.DocCurrency, DocTotal: num(doc.DocTotal), PaidToDate: num(doc.PaidToDate),
    Balance: doc.DocTotal == null || doc.PaidToDate == null ? null : Number(doc.DocTotal) - Number(doc.PaidToDate),
    DocStatus: state(doc.DocumentStatus), Comments: doc.Comments };
}
for (const [id, title, endpoint, category, outstanding] of [
  ['sales_invoice_summary', 'Facturas de clientes · resumen por documento', 'Invoices', 'Facturación e Ingresos'],
  ['purchase_invoice_summary', 'Facturas de proveedores · resumen por documento', 'PurchaseInvoices', 'Compras y Proveedores'],
  ['accounts_receivable', 'Cuentas por cobrar · facturas abiertas', 'Invoices', 'Cartera y Saldos', true],
  ['accounts_payable', 'Cuentas por pagar · facturas abiertas', 'PurchaseInvoices', 'Cartera y Saldos', true],
  ['sales_down_payments', 'Anticipos de clientes', 'DownPayments', 'Tesorería y Pagos'],
  ['purchase_down_payments', 'Anticipos a proveedores', 'PurchaseDownPayments', 'Tesorería y Pagos']
]) {
  add(id, title, '🧾', category, outstanding
    ? 'Saldo actual de facturas abiertas emitidas en el periodo. El saldo refleja las aplicaciones actuales, no un corte histórico.'
    : 'Una fila por documento vigente, con total, importe aplicado y saldo actual; excluye documentos cancelados.', headerFields,
  { endpoint, select: headerSelect, order: 'DocDate desc,DocEntry desc', map: doc => [header(doc)],
    sourceFilter: `Cancelled eq 'tNO'${outstanding ? " and DocumentStatus eq 'bost_Open'" : ''}`,
    requiresDateFilter: true, dateFieldLabel: 'Fecha de emisión', filters: outstanding ? [] : ['estatusDoc'],
    grain: 'Una fila por documento. Los saldos son actuales.',
    summary: { amountField: outstanding ? 'Balance' : 'DocTotal', amountLabel: outstanding ? 'Saldo actual en moneda local' : 'Total en moneda local' } });
}

const lineFields = [field('DocEntry', 'Identificador del documento'), field('DocNum', 'Folio SAP'),
  field('DocDate', 'Fecha de emisión', 'date'), field('CardCode', 'Código del socio'),
  field('CardName', 'Cliente / proveedor', 'string', 260), field('LineNum', 'Número de línea', 'number'),
  field('ItemCode', 'Código del artículo'), field('Dscription', 'Artículo / servicio', 'string', 280),
  field('Quantity', 'Cantidad', 'number'), field('OpenQty', 'Cantidad pendiente', 'number'),
  field('Price', 'Precio unitario del documento', 'money'), field('LineTotal', 'Subtotal en moneda local', 'money'),
  field('DocCurrency', 'Moneda del documento'), field('WhsCode', 'Almacén'),
  field('DocStatus', 'Estado del documento', 'status'), field('Comments', 'Observaciones', 'string', 240)];

add('sales_order_summary', 'Órdenes de venta SAP · resumen por orden', '📋', 'Ventas y Servicios',
  'Todas las órdenes de venta SAP emitidas en el periodo, con paciente registrado, cliente o aseguradora e importe de cabecera; incluye canceladas y órdenes sin líneas.',
  [field('DocEntry', 'Identificador de orden', 'number'), field('DocNum', 'Folio SAP', 'number'),
    field('DocDate', 'Fecha de emisión', 'date'), field('DocStatus', 'Estado de orden SAP', 'status'),
    field('Cancelled', 'Cancelada'), field('PatientName', 'Paciente', 'string', 260),
    field('PTNum', 'Número de paciente', 'number'), field('PCNum', 'Folio de atención', 'number'),
    field('CardCode', 'Código del cliente'), field('CardName', 'Cliente / aseguradora', 'string', 260),
    field('DocCurrency', 'Moneda del documento'), field('DocTotal', 'Total en moneda local', 'money'),
    field('VerticalOrderNum', 'Orden Vertical de origen', 'number')],
  { endpoint: 'Orders', select: 'DocEntry,DocNum,DocDate,DocumentStatus,Cancelled,U_PTName,U_PTNum,U_PCNum,CardCode,CardName,DocCurrency,DocTotal,U_SONum',
    order: 'DocDate desc,DocEntry desc', requiresDateFilter: true, dateFieldLabel: 'Fecha de emisión', filters: ['estatusDoc'],
    defaultFields: ['DocNum', 'DocDate', 'PatientName', 'PCNum', 'DocStatus', 'Cancelled', 'CardName', 'DocTotal'],
    grain: 'Una fila por orden de venta SAP (DocEntry). Los importes corresponden a la cabecera e incluyen órdenes canceladas.',
    summary: { amountField: 'DocTotal', amountLabel: 'Total de órdenes en moneda local' },
    map: doc => [{ DocEntry: doc.DocEntry, DocNum: doc.DocNum, DocDate: date(doc.DocDate),
      DocStatus: state(doc.DocumentStatus), Cancelled: doc.Cancelled == null ? null : yes(doc.Cancelled) ? 'Sí' : 'No',
      PatientName: String(doc.U_PTName || '').trim() || null, PTNum: num(doc.U_PTNum), PCNum: num(doc.U_PCNum),
      CardCode: doc.CardCode, CardName: doc.CardName, DocCurrency: doc.DocCurrency, DocTotal: num(doc.DocTotal),
      VerticalOrderNum: num(doc.U_SONum) }] });

for (const [id, title, endpoint, category] of [
  ['sales_orders', 'Pedidos de clientes y aseguradoras', 'Orders', 'Ventas y Servicios'],
  ['sales_quotations', 'Cotizaciones de servicios y ventas', 'Quotations', 'Ventas y Servicios'],
  ['sales_deliveries', 'Entregas a clientes', 'DeliveryNotes', 'Ventas y Servicios'],
  ['sales_returns', 'Devoluciones de clientes', 'Returns', 'Ventas y Servicios'],
  ['purchase_credit_memos', 'Notas de crédito de proveedores', 'PurchaseCreditNotes', 'Compras y Proveedores'],
  ['purchase_quotations', 'Cotizaciones de proveedores', 'PurchaseQuotations', 'Compras y Proveedores']
]) {
  const patientOrder = id === 'sales_orders';
  const fields = patientOrder ? [...lineFields, field('PatientName', 'Paciente', 'string', 260),
    field('PTNum', 'Número de paciente', 'number'), field('PCNum', 'Folio de atención', 'number')] : lineFields;
  add(id, title, '📑', category, patientOrder
    ? 'Órdenes de venta por artículo o servicio, con paciente registrado, cantidades, importes y estado. Excluye documentos cancelados.'
    : 'Detalle por artículo o servicio, con cantidades, importes y estado. Excluye documentos cancelados.', fields,
  { endpoint, select: `DocEntry,DocNum,DocDate,CardCode,CardName,DocCurrency,DocumentStatus,Comments,DocumentLines${patientOrder ? ',U_PTName,U_PTNum,U_PCNum' : ''}`,
    ...(patientOrder ? { defaultFields: ['DocNum', 'DocDate', 'PatientName', 'PCNum', 'Dscription', 'Quantity', 'Price', 'LineTotal'] } : {}),
    order: 'DocDate desc,DocEntry desc', sourceFilter: "Cancelled eq 'tNO'", requiresDateFilter: true,
    dateFieldLabel: 'Fecha de emisión', filters: ['almacen', 'estatusDoc'], grain: 'Una fila por línea del documento. El importe corresponde al subtotal de cada línea.',
    summary: { amountField: 'LineTotal', amountLabel: 'Subtotal en moneda local', quantityField: 'Quantity' },
    map: doc => (doc.DocumentLines || []).map(line => ({ DocEntry: doc.DocEntry, DocNum: doc.DocNum,
      DocDate: date(doc.DocDate), CardCode: doc.CardCode, CardName: doc.CardName, DocCurrency: doc.DocCurrency,
      DocStatus: state(doc.DocumentStatus), Comments: doc.Comments, LineNum: line.LineNum,
      ItemCode: line.ItemCode, Dscription: line.ItemDescription, Quantity: num(line.Quantity),
      OpenQty: num(line.RemainingOpenQuantity), Price: num(line.Price), LineTotal: num(line.LineTotal), WhsCode: line.WarehouseCode,
      ...(patientOrder ? { PatientName: String(doc.U_PTName || '').trim() || null,
        PTNum: num(doc.U_PTNum), PCNum: num(doc.U_PCNum) } : {}) })) });
}

const paymentFields = [field('DocEntry', 'Identificador del pago'), field('DocNum', 'Folio del pago'),
  field('DocDate', 'Fecha del pago', 'date'), field('CardCode', 'Código del socio'),
  field('CardName', 'Cliente / proveedor', 'string', 260), field('DocCurrency', 'Moneda'),
  field('CashSum', 'Efectivo en moneda local', 'money'), field('TransferSum', 'Transferencia en moneda local', 'money'),
  field('CreditSum', 'Tarjetas', 'money'), field('CheckSum', 'Cheques', 'money'),
  field('PaymentTotal', 'Total de medios en moneda local', 'money'), field('PaymentTotalNote', 'Observación del total'), field('CounterReference', 'Referencia'),
  field('TransferDate', 'Fecha de transferencia', 'date'), field('Remarks', 'Observaciones', 'string', 240)];
for (const [id, title, endpoint] of [['incoming_payments', 'Cobros recibidos · medios de pago', 'IncomingPayments'],
  ['outgoing_payments', 'Pagos efectuados a proveedores', 'VendorPayments']]) {
  add(id, title, '💳', 'Tesorería y Pagos', 'Una fila por pago vigente, con efectivo, transferencias, tarjetas y cheques. El total suma estos medios de pago.', paymentFields,
  { endpoint, select: 'DocEntry,DocNum,DocDate,CardCode,CardName,DocCurrency,CurrencyIsLocal,CashSum,TransferSum,PaymentCreditCards,PaymentChecks,CounterReference,TransferDate,Remarks',
    order: 'DocDate desc,DocEntry desc', sourceFilter: "Cancelled eq 'tNO'", requiresDateFilter: true,
    dateFieldLabel: 'Fecha del pago', grain: 'Una fila por pago; el total corresponde a los medios de pago registrados.',
    summary: { amountField: 'PaymentTotal', amountLabel: 'Total de medios en moneda local' },
    map: doc => { const CreditSum = (doc.PaymentCreditCards || []).reduce((sum, card) => sum + Number(card.CreditSum || 0), 0);
      const CheckSum = (doc.PaymentChecks || []).reduce((sum, check) => sum + Number(check.CheckSum || 0), 0);
      const comparable = (doc.CurrencyIsLocal == null ? doc.DocCurrency === 'MXN' : yes(doc.CurrencyIsLocal))
        && (doc.PaymentCreditCards || []).every(card => !card.CreditCur || card.CreditCur === doc.DocCurrency)
        && (doc.PaymentChecks || []).every(check => !check.Currency || check.Currency === doc.DocCurrency);
      return [{ DocEntry: doc.DocEntry, DocNum: doc.DocNum, DocDate: date(doc.DocDate), CardCode: doc.CardCode,
        CardName: doc.CardName, DocCurrency: doc.DocCurrency, CashSum: num(doc.CashSum), TransferSum: num(doc.TransferSum),
        CreditSum: comparable ? CreditSum : null, CheckSum: comparable ? CheckSum : null,
        PaymentTotal: comparable ? Number(doc.CashSum || 0) + Number(doc.TransferSum || 0) + CreditSum + CheckSum : null,
        PaymentTotalNote: comparable ? null : 'Medios con moneda extranjera: requiere revisar sus importes por moneda.',
        CounterReference: doc.CounterReference, TransferDate: date(doc.TransferDate), Remarks: doc.Remarks }]; } });
}

add('journal_entries', 'Asientos y movimientos contables', '📒', 'Contabilidad y Centros de Costo',
  'Cargos y abonos por línea contable, cuenta, referencia y centro de costo.',
  [field('JdtNum', 'Asiento'), field('ReferenceDate', 'Fecha contable', 'date'), field('Line_ID', 'Línea', 'number'),
    field('AccountCode', 'Cuenta contable'), field('ShortName', 'Socio / cuenta auxiliar'),
    field('Debit', 'Cargo en moneda local', 'money'), field('Credit', 'Abono en moneda local', 'money'),
    field('CostingCode', 'Centro de costo'), field('ProjectCode', 'Proyecto'), field('LineMemo', 'Concepto', 'string', 280),
    field('Reference1', 'Referencia 1'), field('Reference2', 'Referencia 2')],
  { endpoint: 'JournalEntries', select: 'JdtNum,ReferenceDate,JournalEntryLines', order: 'ReferenceDate desc,JdtNum desc',
    requiresDateFilter: true, dateFieldLabel: 'Fecha contable', dateKey: 'ReferenceDate',
    grain: 'Una fila por línea contable. Los cargos y abonos se presentan por separado.',
    map: doc => (doc.JournalEntryLines || []).map(line => ({ JdtNum: doc.JdtNum, ReferenceDate: date(doc.ReferenceDate),
      Line_ID: line.Line_ID, AccountCode: line.AccountCode, ShortName: line.ShortName, Debit: num(line.Debit), Credit: num(line.Credit),
      CostingCode: line.CostingCode, ProjectCode: line.ProjectCode, LineMemo: line.LineMemo,
      Reference1: line.Reference1, Reference2: line.Reference2 })) });

add('chart_accounts', 'Catálogo de cuentas contables', '📚', 'Contabilidad y Centros de Costo',
  'Plan contable, niveles, cuenta superior y saldos actuales por moneda de cuenta.',
  [field('Code', 'Código de cuenta'), field('Name', 'Nombre de cuenta', 'string', 260), field('AccountLevel', 'Nivel', 'number'),
    field('FatherAccountKey', 'Cuenta superior'), field('AcctCurrency', 'Moneda de cuenta'), field('Balance', 'Saldo actual en moneda local', 'money'), field('FormatCode', 'Código de presentación')],
  { endpoint: 'ChartOfAccounts', select: 'Code,Name,AccountLevel,FatherAccountKey,AcctCurrency,Balance,FormatCode', order: 'Code asc',
    grain: 'Una fila por cuenta contable. Los saldos de distintos niveles no se suman.', map: doc => [doc] });
add('cost_centers', 'Centros de costo y dimensiones', '🏷️', 'Contabilidad y Centros de Costo',
  'Centros de costo con su dimensión, vigencia y estado.',
  [field('CenterCode', 'Código'), field('CenterName', 'Centro de costo', 'string', 260), field('InWhichDimension', 'Dimensión', 'number'),
    field('Active', 'Activo'), field('EffectiveFrom', 'Vigencia desde', 'date'), field('EffectiveTo', 'Vigencia hasta', 'date')],
  { endpoint: 'ProfitCenters', select: 'CenterCode,CenterName,InWhichDimension,Active,EffectiveFrom,EffectiveTo', order: 'CenterCode asc',
    grain: 'Una fila por centro de costo.', map: doc => [{ ...doc, Active: yes(doc.Active) ? 'Sí' : 'No', EffectiveFrom: date(doc.EffectiveFrom), EffectiveTo: date(doc.EffectiveTo) }] });
add('warehouses', 'Catálogo de almacenes', '🏬', 'Catálogos Maestros', 'Almacenes configurados, ubicación y estado.',
  [field('WhsCode', 'Código de almacén'), field('WhsName', 'Nombre', 'string', 260), field('City', 'Ciudad'), field('Street', 'Dirección', 'string', 240), field('Inactive', 'Inactivo')],
  { endpoint: 'Warehouses', select: 'WarehouseCode,WarehouseName,City,Street,Inactive', order: 'WarehouseCode asc',
    grain: 'Una fila por almacén.', map: doc => [{ WhsCode: doc.WarehouseCode, WhsName: doc.WarehouseName, City: doc.City, Street: doc.Street, Inactive: yes(doc.Inactive) ? 'Sí' : 'No' }] });
add('item_groups', 'Grupos de artículos y servicios', '🗂️', 'Catálogos Maestros', 'Clasificación comercial de artículos y servicios en SAP.',
  [field('Number', 'Código del grupo', 'number'), field('GroupName', 'Grupo de artículos', 'string', 260)],
  { endpoint: 'ItemGroups', select: 'Number,GroupName', order: 'Number asc', grain: 'Una fila por grupo de artículos.', map: doc => [doc] });
for (const [id, title, type] of [['customers', 'Directorio de clientes y aseguradoras', 'cCustomer'], ['suppliers', 'Directorio de proveedores', 'cSupplier']]) {
  add(id, title, '👥', 'Catálogos Maestros', 'Socios de negocio con RFC, contacto, moneda, lista de precios y saldo actual.',
    [field('CardCode', 'Código'), field('CardName', 'Razón social', 'string', 260), field('FederalTaxID', 'RFC'),
      field('Phone1', 'Teléfono'), field('EmailAddress', 'Correo', 'string', 240), field('Currency', 'Moneda'),
      field('CurrentAccountBalance', 'Saldo actual', 'money'), field('PriceListNum', 'Lista de precios', 'number')],
    { endpoint: 'BusinessPartners', select: 'CardCode,CardName,FederalTaxID,Phone1,EmailAddress,Currency,CurrentAccountBalance,PriceListNum',
      sourceFilter: `CardType eq '${type}'`, order: 'CardCode asc', grain: 'Una fila por socio de negocio.', map: doc => [doc] });
}

add('item_master_data', 'Maestro de artículos y clasificación sanitaria', '🧬', 'Catálogos Maestros',
  'Catálogo completo de artículos y servicios, incluso sin existencias, con clasificación, mínimos, máximos y estado.',
  [field('ItemCode', 'Código del artículo'), field('ItemName', 'Artículo / servicio', 'string', 280), field('ItemsGroupCode', 'Código del grupo', 'number'),
    field('InventoryItem', 'Maneja inventario'), field('PurchaseItem', 'Se compra'), field('SalesItem', 'Se vende'),
    field('MinStock', 'Mínimo general', 'number'), field('MaxStock', 'Máximo general', 'number'), field('ValidFor', 'Estado'), field('AvgCost', 'Costo promedio general', 'money'),
    field('MedicalClassification', 'Clasificación sanitaria'), field('SecondaryClassification', 'Clasificación adicional'), field('DefaultWarehouse', 'Almacén predeterminado')],
  { endpoint: 'Items', select: 'ItemCode,ItemName,ItemsGroupCode,InventoryItem,PurchaseItem,SalesItem,MinInventory,MaxInventory,MovingAveragePrice,Valid,Frozen,U_CLASI_MED_1,U_CLASI_MED_2,DefaultWarehouse',
    order: 'ItemCode asc', filters: ['clasificacionMedica'], grain: 'Una fila por artículo o servicio. Mínimos y máximos generales del catálogo.',
    map: doc => [{ ItemCode: doc.ItemCode, ItemName: doc.ItemName, ItemsGroupCode: doc.ItemsGroupCode,
      InventoryItem: yes(doc.InventoryItem) ? 'Sí' : 'No', PurchaseItem: yes(doc.PurchaseItem) ? 'Sí' : 'No', SalesItem: yes(doc.SalesItem) ? 'Sí' : 'No',
      MinStock: num(doc.MinInventory), MaxStock: num(doc.MaxInventory), AvgCost: num(doc.MovingAveragePrice), ValidFor: yes(doc.Valid) && !yes(doc.Frozen) ? 'Activo' : 'Inactivo',
      MedicalClassification: doc.U_CLASI_MED_1, SecondaryClassification: doc.U_CLASI_MED_2, DefaultWarehouse: doc.DefaultWarehouse }] });
add('stock_availability', 'Disponibilidad, comprometido y en pedido', '📦', 'Inventarios y Stock',
  'Existencias por almacén incluyendo stock cero, cantidades comprometidas, pedidos, mínimos y máximos.',
  [field('ItemCode', 'Código del artículo'), field('ItemName', 'Artículo', 'string', 280), field('WhsCode', 'Almacén'),
    field('QuantityOnStock', 'Existencias', 'number'), field('Committed', 'Comprometido', 'number'), field('Ordered', 'En pedido', 'number'),
    field('Available', 'Disponible proyectado', 'number'), field('MinStock', 'Mínimo del almacén', 'number'), field('MaxStock', 'Máximo del almacén', 'number')],
  { endpoint: 'Items', select: 'ItemCode,ItemName,ItemWarehouseInfoCollection', sourceFilter: "InventoryItem eq 'tYES'", order: 'ItemCode asc',
    filters: ['almacen'], grain: 'Una fila por artículo y almacén. Disponible proyectado = existencias − comprometido + en pedido.', summary: { quantityField: 'QuantityOnStock', quantityLabel: 'Existencias' },
    map: doc => (doc.ItemWarehouseInfoCollection || []).map(whs => ({ ItemCode: doc.ItemCode, ItemName: doc.ItemName,
      WhsCode: whs.WarehouseCode, QuantityOnStock: num(whs.InStock), Committed: num(whs.Committed), Ordered: num(whs.Ordered),
      Available: Number(whs.InStock || 0) - Number(whs.Committed || 0) + Number(whs.Ordered || 0), MinStock: num(whs.MinimalStock), MaxStock: num(whs.MaximalStock) })) });
add('item_prices', 'Precios y costos por artículo y lista', '🏷️', 'Catálogos Maestros',
  'Todas las listas de precios y el costo promedio de artículos y servicios, incluyendo precios en cero y artículos sin stock.',
  [field('ItemCode', 'Código del artículo'), field('ItemName', 'Artículo / servicio', 'string', 280),
    field('PriceList', 'Número de lista', 'number'), field('PriceListName', 'Lista de precios', 'string', 220), field('Price', 'Precio', 'money'), field('Currency', 'Moneda'), field('AvgCost', 'Costo promedio general en moneda local', 'money')],
  { endpoint: 'Items', select: 'ItemCode,ItemName,MovingAveragePrice,ItemPrices', order: 'ItemCode asc', grain: 'Una fila por artículo y lista de precios. El costo promedio se repite por lista; precios y costos son unitarios.',
    map: doc => (doc.ItemPrices || []).map(price => ({ ItemCode: doc.ItemCode, ItemName: doc.ItemName, PriceList: price.PriceList, Price: num(price.Price), Currency: price.Currency, AvgCost: num(doc.MovingAveragePrice) })) });

function matches(row, options, metadata) {
  if (metadata.filters.includes('almacen') && options.almacen && options.almacen !== 'ALL' && row.WhsCode !== options.almacen) return false;
  if (metadata.filters.includes('estatusDoc') && options.estatusDoc && options.estatusDoc !== 'ALL') {
    if (options.estatusDoc === 'OPEN' && row.DocStatus !== 'Abierta') return false;
    if (options.estatusDoc === 'CLOSED' && row.DocStatus !== 'Cerrada') return false;
  }
  if (metadata.filters.includes('clasificacionMedica') && options.clasificacionMedica && options.clasificacionMedica !== 'ALL') {
    const text = `${row.MedicalClassification || ''} ${row.SecondaryClassification || ''}`.toUpperCase();
    const terms = { CON: ['CON'], ANTI: ['ANTI'], REFRI: ['REFRI', 'FRIO', 'FRÍO'] }[options.clasificacionMedica];
    if (terms && !terms.some(term => text.includes(term))) return false;
  }
  for (const value of [options.busqueda, options.proveedor]) {
    if (value && !Object.values(row).some(v => v != null && String(v).toLocaleLowerCase('es-MX').includes(String(value).trim().toLocaleLowerCase('es-MX')))) return false;
  }
  return true;
}
function nextPath(link, endpoint) {
  const path = String(link).replace(/^https?:\/\/[^/]+\/b1s\/v[12]\//, '/').replace(/^\/?b1s\/v[12]\//, '/');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (!normalized.startsWith(`/${endpoint}?`)) throw new Error('SAP devolvió una página no válida para el reporte.');
  return normalized;
}
async function fetchPages(def, metadata, options) {
  const filters = [];
  if (def.sourceFilter) filters.push(def.sourceFilter);
  if (metadata.requiresDateFilter) {
    const dateKey = metadata.dateKey || 'DocDate';
    filters.push(`${dateKey} ge '${options.fechaDesde}' and ${dateKey} le '${options.fechaHasta}'`);
  }
  const params = [`$select=${encodeURIComponent(def.select)}`, `$orderby=${encodeURIComponent(def.order)}`];
  if (filters.length) params.push(`$filter=${encodeURIComponent(filters.join(' and '))}`);
  let path = `/${def.endpoint}?${params.join('&')}`;
  const rows = [], seen = new Set();
  let documents = 0;
  while (path) {
    if (seen.has(path)) throw new Error('SAP repitió una página del reporte.');
    if (seen.size >= 100) return { rows, truncated: true };
    seen.add(path);
    const response = await sapService.get(path, { Prefer: 'odata.maxpagesize=500' });
    const batch = response.data?.value;
    if (!Array.isArray(batch)) throw new Error('No se pudo leer la respuesta de SAP para el reporte.');
    for (const doc of batch) {
      documents++;
      for (const row of def.map(doc)) {
        if (matches(row, options, metadata)) rows.push(row);
        if (rows.length > options.limit) return { rows: rows.slice(0, options.limit), truncated: true };
      }
    }
    const link = response.data['@odata.nextLink'] || response.data['odata.nextLink'];
    if (!link) break;
    // Protege SAP también cuando los filtros de detalle no encuentran coincidencias.
    if (documents >= 20000) return { rows, truncated: true };
    path = nextPath(link, def.endpoint);
  }
  return { rows, truncated: false };
}
async function execute(entity, options) {
  const metadata = catalog[entity], def = definitions[entity];
  if (!metadata || !def) throw new Error('Reporte SAP no reconocido.');
  if (entity === 'item_prices') {
    const lists = await fetchPages({ endpoint: 'PriceLists', select: 'PriceListNo,PriceListName', order: 'PriceListNo asc', map: doc => [doc] },
      { filters: [] }, { limit: 10000 });
    const names = new Map(lists.rows.map(row => [row.PriceListNo, row.PriceListName]));
    return fetchPages({ ...def, map: doc => def.map(doc).map(row => ({ ...row,
      PriceListName: names.get(row.PriceList) || String(row.PriceList) })) }, metadata, options);
  }
  return fetchPages(def, metadata, options);
}
// Server-owned exact-key lookups used by cross-system relationships. Neither
// endpoint nor expression is supplied by the user or the language model.
async function lookup(entity, key, values) {
  if (!({ customers: 'CardCode', item_master_data: 'ItemCode' }[entity] === key)
    || !Array.isArray(values) || values.length > 10000 || values.some(value => typeof value !== 'string' || value.length > 100)) {
    throw new Error('La relación solicitada con SAP no es válida.');
  }
  const unique = [...new Set(values)];
  const rows = [];
  const def = definitions[entity], chunks = [[]];
  const predicate = chunk => chunk.map(value => `${key} eq '${value.replace(/'/g, "''")}'`).join(' or ');
  for (const value of unique) {
    const next = [...chunks.at(-1), value];
    if (chunks.at(-1).length && (next.length > 50 || encodeURIComponent(predicate(next)).length + encodeURIComponent(def.select).length > 1450)) chunks.push([]);
    chunks.at(-1).push(value);
  }
  for (const chunk of chunks.filter(chunk => chunk.length)) {
    const filter = predicate(chunk);
    const result = await fetchPages({ ...def, sourceFilter: `${def.sourceFilter ? `(${def.sourceFilter}) and ` : ''}(${filter})` },
      catalog[entity], { limit: 10000 });
    rows.push(...result.rows);
    if (result.truncated) return { rows, truncated: true };
  }
  return { rows, truncated: false };
}
module.exports = { catalog, execute, lookup };
