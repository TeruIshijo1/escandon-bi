'use strict';
// Build a structural allowlist. No connections and no hospital records.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const vertical = JSON.parse(fs.readFileSync(path.join(root, 'tmp/vertical-metadata-2026-10-06.json'), 'utf8'));
const xml = fs.readFileSync(path.join(root, 'tmp/sap-honorarios-metadata.xml'), 'utf8');
const availability = require('../config/assistant-sap-field-availability.json');
if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('La metadata XML no admite entidades externas.');
const unsafe = /password|passwd|token|login|credential|secret|privatekey|signature|firma|biometric|fingerprint|(^|_)pin($|_)/i;
const attrs = text => Object.fromEntries([...text.matchAll(/([\w:]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const primitive = new Set(['Edm.String', 'Edm.Int16', 'Edm.Int32', 'Edm.Int64', 'Edm.Decimal', 'Edm.Double', 'Edm.Single', 'Edm.Boolean', 'Edm.DateTime', 'Edm.DateTimeOffset', 'Edm.Guid']);
const labels = {
  PCNum: 'Folio de atención', PTNum: 'Número de paciente', PRNum: 'Número de médico', PCAGNum: 'Convenio de atención',
  PC_ST: 'Estado de cuenta hospitalaria', PCAG_ST: 'Estado del convenio de atención', AG_ST: 'Estado del convenio',
  AGCode: 'Código de convenio', AGName: 'Convenio', BPCode: 'Código del pagador', BPName: 'Pagador',
  FullName: 'Nombre completo', Date: 'Fecha de atención', CreatedOn: 'Fecha de registro', ClosedOn: 'Fecha de cierre',
  Balance: 'Saldo actual registrado', Downpayments: 'Anticipos registrados', Total: 'Total registrado', BillingDocuments: 'Documentos de facturación registrados',
  GlobalDiscount: 'Descuento global (%)', DiscountPercent: 'Descuento (%)', Discount: 'Descuento registrado',
  AdditionalDiscountPercentage: 'Descuento adicional (%)', CoinsurancePercentage: 'Coaseguro (%)', CopayPercentage: 'Copago (%)',
  Deductible: 'Deducible', Copay: 'Copago', CopayAmount: 'Importe de copago', AgreementTotal: 'Total del convenio',
  TotalDiscount: 'Importe de descuentos', TotalDeductible: 'Deducible aplicado', TotalCopay: 'Copago aplicado', TotalCoinsurance: 'Coaseguro aplicado',
  PriceFactor: 'Factor de precio', PriceListNum: 'Número de lista de precios', PriceListNo: 'Número de lista de precios', PriceListName: 'Lista de precios',
  PLCode: 'Código de tabulador', PLVersion: 'Versión de tabulador', ItemCode: 'Código de artículo', ItemName: 'Artículo / servicio', ItemDescription: 'Descripción del artículo',
  Price: 'Precio', UnitPrice: 'Precio unitario', LineTotal: 'Importe de línea', Quantity: 'Cantidad', DocEntry: 'Identificador del documento', DocNum: 'Folio del documento',
  DocDate: 'Fecha de emisión', DocDueDate: 'Fecha de vencimiento', DocCurrency: 'Moneda', DocTotal: 'Total del documento SAP',
  PaidToDate: 'Aplicaciones actuales al documento', DocumentStatus: 'Estado del documento SAP', Cancelled: 'Cancelado',
  CardCode: 'Código del socio de negocio', CardName: 'Socio de negocio', CardType: 'Tipo de socio de negocio',
  CurrentAccountBalance: 'Saldo actual del socio de negocio', FederalTaxID: 'RFC', Phone1: 'Teléfono', EmailAddress: 'Correo',
  CreditLimit: 'Límite de crédito', MaxCommitment: 'Límite de compromisos', PayTermsGrpCode: 'Condición de pago', PayTermsGrpName: 'Condición de pago',
  PaymentTermsGroupCode: 'Código de condición de pago', GroupCode: 'Código de grupo', Frozen: 'Bloqueado', Valid: 'Activo',
  FrozenFrom: 'Bloqueado desde', FrozenTo: 'Bloqueado hasta', ValidFrom: 'Vigente desde', ValidTo: 'Vigente hasta',
  DiscountBaseObject: 'Base del descuento', RoundingMethod: 'Método de redondeo', BasePriceList: 'Lista base de precios',
  Factor: 'Factor de precio', PriceList: 'Número de lista de precios', PaymentMethodCode: 'Forma de pago', BankCode: 'Código de banco',
  OpenDeliveryNotesBalance: 'Saldo de entregas abiertas', OpenOrdersBalance: 'Saldo de pedidos abiertos', DownPaymentAmountSC: 'Anticipo en moneda del sistema',
  TaxTotal: 'Total de impuestos', TaxDate: 'Fecha fiscal', VatSum: 'Total de IVA', PaidToDateFC: 'Aplicaciones en moneda extranjera',
  U_PCNum: 'Folio de atención registrado en SAP', U_PTNum: 'Número de paciente en SAP', U_PTName: 'Paciente registrado en SAP', U_PRName: 'Médico registrado en SAP', U_SONum: 'Orden Vertical de origen',
  Code: 'Código', Name: 'Nombre', Description: 'Descripción', StartDate: 'Fecha inicial', EndDate: 'Fecha final',
  Debit: 'Cargo contable', Credit: 'Abono contable', AccountCode: 'Código de cuenta contable', AccountName: 'Cuenta contable',
  CashSum: 'Efectivo registrado', TransferSum: 'Transferencia registrada', TaxRate: 'Impuesto (%)', TaxCode: 'Código de impuesto'
};
const names = {
  PC: 'Cuentas hospitalarias: datos administrativos', PCAG: 'Convenios aplicados a cuentas', AG: 'Condiciones de convenios comerciales',
  BP: 'Socios de negocio de Vertical', V_BP: 'Directorio de pagadores de Vertical', PL: 'Tabuladores y listas de Vertical', PT: 'Directorio de pacientes',
  PR: 'Directorio de médicos', PCBL: 'Renglones de facturación de cuentas', PCIT: 'Cargos de cuentas', SO: 'Órdenes de venta Vertical', SOLN: 'Líneas de órdenes Vertical',
  UDR_BI_CARTERA: 'Cartera: facturado, abonado y saldo de Vertical', Orders: 'Órdenes de venta SAP: datos administrativos', Invoices: 'Facturas SAP: datos administrativos',
  CreditNotes: 'Notas de crédito de clientes SAP', PurchaseInvoices: 'Facturas de proveedores SAP', PurchaseOrders: 'Órdenes de compra SAP',
  IncomingPayments: 'Cobros recibidos en SAP', VendorPayments: 'Pagos a proveedores en SAP', DownPayments: 'Anticipos de clientes SAP', PurchaseDownPayments: 'Anticipos a proveedores SAP',
  BusinessPartners: 'Socios de negocios y condiciones en SAP', Items: 'Artículos y condiciones comerciales SAP', PriceLists: 'Listas de precios SAP',
  BlanketAgreements: 'Acuerdos comerciales de SAP', SpecialPrices: 'Precios especiales por socio y artículo SAP', DiscountGroups: 'Grupos de descuentos SAP',
  JournalEntries: 'Asientos contables SAP: cabecera', ChartOfAccounts: 'Catálogo contable SAP', ProfitCenters: 'Centros de costo SAP', Projects: 'Proyectos administrativos SAP'
};
const words = value => value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
const fieldType = (name, original) => /date|time/i.test(original) ? 'datetime' : /bool|bit/i.test(original) ? 'boolean'
  : /int|decimal|double|single|float|numeric|money|real/i.test(original) ? /percent|percentage|^GlobalDiscount$/i.test(name) ? 'percent'
    : /price|amount|balance|total|debit|credit|sum|deductible|copay|cost|^PaidToDate|^MaxCommitment$/i.test(name) ? 'money' : 'number' : 'string';
const field = column => ({ key: column.column_name || column.Name, label: labels[column.column_name || column.Name] || words(column.column_name || column.Name),
  type: fieldType(column.column_name || column.Name, column.type_name || column.Type), sourceType: column.type_name || column.Type });
const resources = [];
for (const object of vertical.objects) {
  const name = object.object_name;
  if (!/^(PC|PT|PR|MS|IT|FR|SU|DX|AG|BP|PL|LB|IM|MR|UDR_|V_|SO|SOLN)/i.test(name) || unsafe.test(name) || /user|security|audit/i.test(name) || /^V_(?:US(?:_|$)|SYS_)/.test(name)) continue;
  const columns = vertical.columns.filter(column => column.object_name === name && column.schema_name === object.schema_name
    && !unsafe.test(column.column_name) && !/binary|image|xml|timestamp|rowversion|geometry|geography|hierarchyid|sql_variant/i.test(column.type_name));
  if (!columns.length) continue;
  const indexes = new Map();
  for (const index of vertical.indexes.filter(row => row.object_name === name && row.schema_name === object.schema_name
    && row.is_unique && !row.has_filter && !row.is_disabled && row.key_ordinal > 0 && !row.is_included_column)) {
    if (!indexes.has(index.index_name)) indexes.set(index.index_name, []);
    indexes.get(index.index_name).push(index);
  }
  const uniqueKeys = [...indexes.values()].map(rows => rows.sort((a, b) => a.key_ordinal - b.key_ordinal).map(row => row.column_name))
    .filter(keys => keys.every(key => columns.some(column => column.column_name === key)));
  const dateField = !/^(AG|BP|PL|PT|PR|MS|IT|FR|SU|DX|V_BP)$/.test(name)
    ? ['Date', 'DocDate', 'ChargeDate', 'FechaIngreso', 'Fecha', 'CreatedOn'].find(key => columns.some(column => column.column_name === key && /date/i.test(column.type_name))) : undefined;
  resources.push({ id: `assistant_resource_vertical__${object.schema_name}__${name}`, source: 'Vertical', schema: object.schema_name, object: name,
    title: names[name] || `Información de ${words(name.replace(/^(UDR_|V_)/, ''))} en Vertical`, fields: columns.map(field), uniqueKeys, dateField,
    aliases: [names[name] || words(name), words(name)], validatedZeroRows: vertical.validation.some(row => row.schema_name === object.schema_name && row.object_name === name && row.success) });
}
const enums = new Set([...xml.matchAll(/<EnumType\b([^>]*)>/g)].map(match => `SAPB1.${attrs(match[1]).Name}`));
const types = new Map();
for (const match of xml.matchAll(/<(EntityType|ComplexType)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
  const properties = [...match[3].matchAll(/<Property\b([^>]*)\/?>/g)].map(item => attrs(item[1]));
  const keys = [...(match[3].match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || '').matchAll(/<PropertyRef\b([^>]*)\/?\s*>/g)].map(item => attrs(item[1]).Name);
  types.set(`SAPB1.${attrs(match[2]).Name}`, { properties, keys });
}
const sapAllowed = /^(Orders|Invoices|CreditNotes|Quotations|DeliveryNotes|Returns|PurchaseInvoices|PurchaseOrders|PurchaseCreditNotes|PurchaseQuotations|PurchaseDeliveryNotes|PurchaseReturns|IncomingPayments|VendorPayments|DownPayments|PurchaseDownPayments|BusinessPartners|BusinessPartnerGroups|Items|ItemGroups|PriceLists|BlanketAgreements|SpecialPrices|DiscountGroups|JournalEntries|ChartOfAccounts|ProfitCenters|CostCenterTypes|Projects|Banks|PaymentTermsTypes|Currencies|SalesPersons|Warehouses)$/;
for (const match of xml.matchAll(/<EntitySet\b([^>]*)\/?\s*>/g)) {
  const set = attrs(match[1]), type = types.get(set.EntityType);
  if (!sapAllowed.test(set.Name) || !type) continue;
  const properties = type.properties.filter(property => property.Name && !unsafe.test(property.Name) && (primitive.has(property.Type) || enums.has(property.Type))
    && !(availability.unavailableFields[set.Name] || []).includes(property.Name));
  if (!properties.length) continue;
  const transactional = /Orders|Invoices|Notes|Returns|Quotations|Payments|Entries|Reconciliations/.test(set.Name);
  const dateField = transactional ? ['DocDate', 'ReferenceDate', 'ReconDate'].find(key => properties.some(property => property.Name === key)) : undefined;
  resources.push({ id: `assistant_resource_sap__${set.Name}`, source: 'SAP', endpoint: set.Name,
    title: names[set.Name] || `Información administrativa de ${words(set.Name)} en SAP`, fields: properties.map(field),
    uniqueKeys: type.keys.every(key => properties.some(property => property.Name === key)) && type.keys.length ? [type.keys] : [], dateField,
    aliases: [names[set.Name] || words(set.Name), words(set.Name)], validatedZeroRows: false });
}
const relationships = [];
const grouped = new Map();
for (const row of vertical.relations.filter(row => !row.is_disabled && row.source_object !== row.target_object)) {
  if (!grouped.has(row.foreign_key)) grouped.set(row.foreign_key, []);
  grouped.get(row.foreign_key).push(row);
}
for (const [name, rows] of grouped) {
  const first = rows[0];
  const source = resources.find(resource => resource.source === 'Vertical' && resource.schema === first.source_schema && resource.object === first.source_object);
  const target = resources.find(resource => resource.source === 'Vertical' && resource.schema === first.target_schema && resource.object === first.target_object);
  if (!source || !target) continue;
  const columns = rows.map(row => [row.source_column, row.target_column]);
  if (!columns.every(([key]) => source.fields.some(column => column.key === key))
    || !target.uniqueKeys.some(keys => keys.length === columns.length && keys.every(key => columns.some(pair => pair[1] === key)))) continue;
  relationships.push({ name, source: source.id, target: target.id, columns, integrityVerified: !rows.some(row => row.is_not_trusted) });
}
const output = path.join(root, 'backend/config/assistant-report-resources.json');
fs.writeFileSync(output, `${JSON.stringify({ metadataDate: '2026-10-06', sapFieldVerificationDate: availability.checkedOn, scope: 'Schema only; no hospital records; all execution is read-only', resources, relationships })}\n`);
console.log(JSON.stringify({ resources: resources.length, vertical: resources.filter(item => item.source === 'Vertical').length,
  sap: resources.filter(item => item.source === 'SAP').length, relationships: relationships.length, fields: resources.reduce((sum, item) => sum + item.fields.length, 0) }));
