'use strict';
const { connectRemoteDB, sql } = require('../config/remote-db');
const sap = require('./sap.service');
const id = 'assistant_account_billing_collections';
const field = (key, label, type = 'string') => ({ key, label, type, width: type === 'string' ? 250 : 170 });
const catalog = { [id]: { id, title: 'Facturación y cobros de cuentas hospitalarias', source: 'SAP + Vertical', sources: ['SAP', 'Vertical'],
  assistantOnly: true, category: 'Cuentas, Facturación y Cobros',
  aliases: ['cuentas facturadas', 'cuentas sin facturar', 'cuentas pagadas al hospital', 'cuentas hospitalarias facturadas y pagadas',
    'cuentas ya facturadas y cuales ya las pagaron al hospital', 'cuentas ya estan facturadas y cuales ya las pagaron al hospital',
    'cuentas sin facturas', 'cuentas no facturadas', 'cuentas sin pagar', 'facturacion y cobros de cuentas', 'estatus de cuentas hospitalarias', 'cuentas hospitalarias con facturas y pagos'],
  description: 'Estado actual de la cuenta en Vertical y facturas/cobros recibidos relacionados por folio y documento en SAP. Una cuenta cerrada no acredita un pago. La existencia de factura no acredita que se hayan facturado todos los cargos.',
  grain: 'Una fila por cuenta hospitalaria. El período corresponde a la atención; facturas y cobros son actuales y pueden estar fuera de ese período. El pago acredita las facturas relacionadas; revisar saldo de Vertical y cargos aún sin facturar. Facturas compartidas requieren revisar el cobro por cuenta.',
  requiresDateFilter: true, pointLookupFields: ['PCNum', 'PTNum'], dateFieldLabel: 'Fecha de atención', filters: ['estatusDoc'], serverSideFilters: ['estatusDoc'], statusLabel: 'Cuenta, facturación o cobro',
  statusOptions: [['ALL','Todas las cuentas'], ['OPEN','Cuentas abiertas'], ['CLOSED','Cuentas cerradas'], ['CANCELED','Cuentas canceladas'],
    ['BILLED','Con facturas vigentes'], ['UNBILLED','Sin facturas vigentes'], ['COLLECTED','Con facturas cubiertas por cobros SAP'],
    ['UNPAID','Sin cobros recibidos'], ['PARTIAL','Con cobro parcial']].map(([value,label]) => ({ value,label })),
  requiredPermissions: ['vertical_accounts', 'sales_invoice_summary', 'incoming_payments'], summary: {},
  defaultFields: ['PCNum','PatientName','AttentionDate','AccountStatus','MedicalDischargeDate','ClosedOn','AccountBalance','BillingStatus','InvoiceFolios','CollectionStatus','PaymentFolios','Evidence'],
  fields: [field('PCNum','Folio de atención','number'), field('PTNum','Número de paciente','number'), field('PatientName','Paciente'), field('AttentionDate','Fecha de atención','datetime'),
    field('MedicalDischargeDate','Fecha de alta médica','datetime'), field('ClosedOn','Fecha de cierre de cuenta','datetime'),
    field('AccountStatus','Estado de cuenta hospitalaria'), field('AccountBalance','Saldo actual de cuenta en Vertical','money'),
    field('BillingStatus','Facturación en SAP'), field('InvoiceCount','Facturas vigentes relacionadas','number'), field('InvoiceFolios','Folios de facturas SAP'),
    field('CollectionStatus','Cobro al hospital según SAP'), field('PaymentFolios','Folios de cobros recibidos SAP'),
    field('InvoiceSettlement','Liquidación de facturas en SAP'), field('InvoiceTotal','Total de facturas relacionadas SAP','money'),
    field('InvoiceBalance','Saldo de facturas relacionadas SAP','money'), field('ReceivedAppliedAmount','Cobros aplicados a facturas SAP','money'),
    field('Currency','Moneda de facturas relacionadas'), field('Evidence','Observación de la verificación')]
} };
const int = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const cancelled = value => ['tYES','Y',true].includes(value) ? true : ['tNO','N',false].includes(value) ? false : null;
const endpoint = (name, params) => `/${name}?${Object.entries(params).map(([key,value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
function civilDate(value) {
  if (!(value instanceof Date)) return value;
  const pad = value => String(value).padStart(2,'0');
  return `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}
async function pages(first, collection, deadline) {
  let path = first;
  const rows = [], seen = new Set();
  while (path) {
    if (Date.now() >= deadline || seen.size >= 100 || rows.length >= 20000 || seen.has(path)) throw new Error('No se pudo completar la verificación de facturas y cobros. Reduce el período.');
    seen.add(path);
    const response = await sap.get(path, { Prefer: 'odata.maxpagesize=200' }, { timeoutMs: Math.min(30000,deadline-Date.now()) });
    if (!Array.isArray(response.data?.value)) throw new Error('SAP no entregó la evidencia completa de facturas o cobros.');
    rows.push(...response.data.value);
    const link = response.data['@odata.nextLink'] || response.data['odata.nextLink'];
    if (!link) break;
    path = String(link).replace(/^https?:\/\/[^/]+\/b1s\/v[12]\//,'/').replace(/^\/?b1s\/v[12]\//,'/');
    if (!path.startsWith('/')) path = `/${path}`;
    if (!path.startsWith(`/${collection}?`)) throw new Error('SAP devolvió una página fuera de la consulta de verificación.');
  }
  return rows;
}
async function documents(keys, collection, deadline) {
  const result = [];
  for (let offset = 0; offset < keys.length; offset += 40) {
    const chunk = keys.slice(offset,offset+40);
    result.push(...await pages(endpoint(collection, { $filter: chunk.map(key=>`DocEntry eq ${key}`).join(' or '),
      $select: collection === 'Invoices' ? 'DocEntry,DocNum,DocCurrency,DocTotal,PaidToDate,Cancelled,U_PCNum,DocumentLines'
        : 'DocEntry,DocNum,Cancelled,PaymentInvoices' }),collection,deadline));
  }
  if (result.length !== keys.length || new Set(result.map(doc=>int(doc.DocEntry))).size !== keys.length || result.some(doc=>!keys.includes(int(doc.DocEntry)))) throw new Error('No se pudieron verificar todos los documentos relacionados.');
  return result;
}
async function execute(entity, options = {}) {
  if (entity !== id) throw new Error('El reporte financiero no está disponible.');
  const { fechaDesde, fechaHasta, pointLookup, busqueda = '', estatusDoc = 'ALL', limit = 10000 } = options;
  const exact = pointLookup != null;
  if (exact && (!pointLookup || typeof pointLookup !== 'object' || Array.isArray(pointLookup)
    || Object.keys(pointLookup).some(key => !['field', 'value'].includes(key))
    || !catalog[id].pointLookupFields.includes(pointLookup.field) || !Number.isInteger(pointLookup.value)
    || pointLookup.value < 1 || pointLookup.value > 2147483647)) throw new Error('El identificador de cuenta o paciente no es válido.');
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
  const useDates = !exact || fechaDesde != null && fechaDesde !== '' || fechaHasta != null && fechaHasta !== '';
  if (useDates && (!date(fechaDesde) || !date(fechaHasta) || fechaDesde>fechaHasta || (Date.parse(fechaHasta)-Date.parse(fechaDesde))/86400000>366)) throw new Error('Indica un período válido de hasta 366 días.');
  if (!Number.isInteger(limit) || limit<1 || limit>10000 || typeof busqueda!=='string' || busqueda.length>200
    || !catalog[id].statusOptions.some(option=>option.value===estatusDoc)) throw new Error('Los filtros del reporte financiero no son válidos.');
  const pool = await connectRemoteDB();
  const request = pool.request().input('rowLimit',sql.Int,10001);
  const conditions = [];
  if (useDates) {
    request.input('fechaDesde',sql.VarChar(10),fechaDesde).input('fechaHasta',sql.VarChar(10),fechaHasta);
    conditions.push('pc.[Date]>=CAST(@fechaDesde AS date)', 'pc.[Date]<DATEADD(day,1,CAST(@fechaHasta AS date))');
  }
  if (exact) {
    request.input('pointLookupValue', sql.Int, pointLookup.value);
    conditions.push(`pc.${pointLookup.field}=@pointLookupValue`);
  }
  const states = { OPEN:'OP', CLOSED:'CL', CANCELED:'CA' };
  if (states[estatusDoc]) request.input('estadoCuenta',sql.NVarChar(2),states[estatusDoc]);
  const source = await request.query(`SELECT TOP (@rowLimit) pc.PCNum,pc.PTNum,pt.FullName PatientName,pc.[Date] AttentionDate,pc.MedicalDischargeDate,pc.ClosedOn,pc.PC_ST AccountStatus,pc.Balance AccountBalance
    FROM dbo.PC pc LEFT JOIN dbo.PT pt ON pt.PTNum=pc.PTNum
    WHERE ${conditions.join(' AND ')} ${states[estatusDoc]?'AND pc.PC_ST=@estadoCuenta':''}
    ORDER BY pc.[Date] DESC,pc.PCNum DESC`);
  const accounts = (source.recordset || []).slice(0,10000);
  if (accounts.some(account=>!int(account.PCNum))) throw new Error('Vertical no entregó folios válidos para la verificación.');
  if (exact && accounts.some(account => Number(account[pointLookup.field]) !== pointLookup.value)) throw new Error('Vertical devolvió cuentas fuera del identificador solicitado. No se consultó SAP.');
  if (!accounts.length) return { rows: [],truncated: false };
  const deadline = Date.now()+180000;
  const keys = new Set();
  for (let offset=0;offset<accounts.length;offset+=20) {
    const chunk = accounts.slice(offset,offset+20).map(account=>int(account.PCNum));
    const headers = await pages(endpoint('Invoices',{ $select:'DocEntry', $filter:chunk.map(key=>`U_PCNum eq ${key}`).join(' or ') }), 'Invoices',deadline);
    headers.forEach(doc=>{ if (!int(doc.DocEntry)) throw new Error('SAP no entregó identificadores de factura válidos.'); keys.add(int(doc.DocEntry)); });
    // Consolidated invoices can reference the account only in their lines.
    const collection = '$crossjoin(Invoices,Invoices/DocumentLines)';
    const lines = await pages(endpoint(collection,{ $expand:'Invoices($select=DocEntry),Invoices/DocumentLines($select=U_PCNum)',
      $filter:`Invoices/DocEntry eq Invoices/DocumentLines/DocEntry and (${chunk.map(key=>`Invoices/DocumentLines/U_PCNum eq ${key}`).join(' or ')})` }),collection,deadline);
    lines.forEach(row=>{ if (!int(row.Invoices?.DocEntry)) throw new Error('No se pudo verificar el vínculo de todas las facturas consolidadas.'); keys.add(int(row.Invoices.DocEntry)); });
  }
  if (keys.size>20000) throw new Error('Hay demasiadas facturas relacionadas para una verificación completa. Reduce el período.');
  const invoices = await documents([...keys],'Invoices',deadline);
  const invoiceAccounts = new Map(), accountInvoices = new Map();
  for (const invoice of invoices) {
    if (!Array.isArray(invoice.DocumentLines)) throw new Error('SAP no entregó las cuentas de todos los renglones de factura.');
    invoiceAccounts.set(int(invoice.DocEntry),new Set([int(invoice.U_PCNum),...invoice.DocumentLines.map(line=>int(line.U_PCNum))].filter(Boolean)));
    for (const account of invoiceAccounts.get(int(invoice.DocEntry))) {
      if (!accountInvoices.has(account)) accountInvoices.set(account,[]);
      accountInvoices.get(account).push(invoice);
    }
  }
  const paymentIds = new Set();
  for (let offset=0;offset<invoices.length;offset+=20) {
    const chunk=invoices.slice(offset,offset+20);
    const collection='$crossjoin(IncomingPayments,IncomingPayments/PaymentInvoices)';
    const linked = await pages(endpoint(collection,{ $expand:'IncomingPayments($select=DocEntry),IncomingPayments/PaymentInvoices($select=DocEntry,InvoiceType)',
      $filter:`IncomingPayments/DocEntry eq IncomingPayments/PaymentInvoices/DocNum and IncomingPayments/PaymentInvoices/InvoiceType eq 'it_Invoice' and (${chunk.map(doc=>`IncomingPayments/PaymentInvoices/DocEntry eq ${int(doc.DocEntry)}`).join(' or ')})` }),collection,deadline);
    linked.forEach(row=>{ if (!int(row.IncomingPayments?.DocEntry)) throw new Error('No se pudieron identificar todos los cobros relacionados.'); paymentIds.add(int(row.IncomingPayments.DocEntry)); });
  }
  if (paymentIds.size>20000) throw new Error('Hay demasiados cobros relacionados. Reduce el período para verificarlos.');
  const payments = await documents([...paymentIds],'IncomingPayments',deadline);
  // This service operation reads company metadata; it does not update SAP.
  const admin = invoices.length ? await sap.post('/CompanyService_GetAdminInfo',{}, {}, {timeoutMs:Math.max(1,Math.min(30000,deadline-Date.now()))}) : { data:{} };
  const localCurrency = admin.data?.LocalCurrency;
  const paid = new Map();
  for (const payment of payments) {
    if (!Array.isArray(payment.PaymentInvoices)) throw new Error('SAP no entregó las aplicaciones completas del cobro.');
    for (const application of payment.PaymentInvoices) {
      if (application.InvoiceType!=='it_Invoice' || !keys.has(int(application.DocEntry))) continue;
      const key=int(application.DocEntry), current=paid.get(key)||{ amount:0,folios:new Set(),uncertain:false };
      if (cancelled(payment.Cancelled)===true) continue;
      if (cancelled(payment.Cancelled)===null) current.uncertain=true;
      else {
        const amount=number(application.SumApplied);
        if (amount==null || amount<0 || [application.TotalDiscount,application.WitholdingTaxApplied].some(value=>number(value)>0)) current.uncertain=true;
        if (amount>0) { current.amount+=amount;current.folios.add(String(payment.DocNum)); }
      }
      paid.set(key,current);
    }
  }
  const rows=accounts.map(account=> {
    const own=accountInvoices.get(int(account.PCNum)) || [];
    const active=own.filter(invoice=>cancelled(invoice.Cancelled)===false);
    const unknown=own.some(invoice=>cancelled(invoice.Cancelled)===null);
    const shared=active.some(invoice=>invoiceAccounts.get(int(invoice.DocEntry)).size!==1);
    const folios=new Set(active.flatMap(invoice=>[...(paid.get(int(invoice.DocEntry))?.folios||[])]));
    const doubtful=unknown || active.some(invoice=>paid.get(int(invoice.DocEntry))?.uncertain || !localCurrency || invoice.DocCurrency!==localCurrency
      || number(invoice.DocTotal)==null || number(invoice.PaidToDate)==null);
    const fullyCash=active.length>0 && active.every(invoice=>number(invoice.DocTotal)>0 && (paid.get(int(invoice.DocEntry))?.amount||0)>=number(invoice.DocTotal)-0.01);
    const settled=active.length>0 && active.every(invoice=>number(invoice.PaidToDate)!=null && number(invoice.DocTotal)!=null && number(invoice.PaidToDate)>=number(invoice.DocTotal)-0.01);
    const state=unknown?'unknown':!active.length?'unbilled':shared?'shared':doubtful?'unknown':fullyCash&&settled?'collected':folios.size?'partial':settled?'other':'unpaid';
    return { ...account, AttentionDate:civilDate(account.AttentionDate), MedicalDischargeDate:civilDate(account.MedicalDischargeDate ?? null),
      ClosedOn:civilDate(account.ClosedOn ?? null), AccountStatus:{ OP:'Abierta',CL:'Cerrada',CA:'Cancelada' }[account.AccountStatus]||'Sin información',
      BillingStatus:unknown?'Por verificar':active.length?'Con facturas vigentes en SAP':'Sin facturas vigentes en SAP', InvoiceCount:active.length,
      InvoiceFolios:active.map(invoice=>String(invoice.DocNum)).join(', '), PaymentFolios:[...folios].join(', '),
      CollectionStatus:{ unbilled:'Sin facturación vigente',shared:'Factura compartida; revisar cobro por cuenta',unknown:'Cobro por verificar',
        collected:'Facturas relacionadas pagadas mediante cobros SAP',partial:'Cobro parcial registrado',other:'Liquidada con otras aplicaciones; sin cobro recibido',unpaid:'Sin cobros recibidos registrados' }[state],
      InvoiceSettlement:!active.length?'Sin facturación vigente':doubtful?'Por verificar':settled?'Sin saldo en facturas SAP':'Con saldo en facturas SAP',
      InvoiceTotal:!active.length || shared || doubtful ? null : active.reduce((sum,invoice)=>sum+number(invoice.DocTotal),0),
      InvoiceBalance:!active.length || shared || doubtful ? null : active.reduce((sum,invoice)=>sum+number(invoice.DocTotal)-number(invoice.PaidToDate),0),
      ReceivedAppliedAmount:!active.length || shared || doubtful ? null : active.reduce((sum,invoice)=>sum+(paid.get(int(invoice.DocEntry))?.amount||0),0),
      Currency:active.length && !shared && !doubtful ? localCurrency : null,
      Evidence:shared?'La factura incluye varias cuentas; su cobro no se asigna completo a cada paciente.':doubtful?'Revisar moneda, aplicaciones, descuentos, retenciones o datos incompletos.':state==='collected'?'Cobros registrados en SAP para estas facturas. Verifica el saldo de Vertical y cargos pendientes de facturar.':'Facturas por folio de atención; cobros por aplicaciones a sus facturas.', _state:state };
  }).filter(row=> estatusDoc==='BILLED'?row.InvoiceCount>0:estatusDoc==='UNBILLED'?row._state==='unbilled':estatusDoc==='COLLECTED'?row._state==='collected'
    :estatusDoc==='UNPAID'?['unpaid','other'].includes(row._state):estatusDoc==='PARTIAL'?row._state==='partial':true)
    .filter(row=>!busqueda.trim() || catalog[id].fields.some(field=>row[field.key]!=null && String(row[field.key]).toLocaleLowerCase('es-MX').includes(busqueda.trim().toLocaleLowerCase('es-MX'))));
  return { rows:rows.slice(0,limit).map(({_state:_removed,...row})=>row),truncated:(source.recordset||[]).length>10000 || rows.length>limit,
    message:(source.recordset||[]).length>10000?'Se alcanzó el límite de 10000 cuentas del período. Reduce las fechas para revisar las demás cuentas.':null };
}
module.exports={catalog,execute};
