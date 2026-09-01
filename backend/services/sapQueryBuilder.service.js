/**
 * sapQueryBuilder.service.js
 * Servicio Constructor de Consultas SAP Business One (Service Layer & SQL Engine)
 * Hospital Escandón BI Platform v4.0
 */
'use strict';

const sapService = require('./sap.service');
const sapInventoryService = require('./sapInventory.service');
const { pool } = require('../config/pg-db');

/* ══════════════════════════════════════════════════════════════
   DICCIONARIO DE ENTIDADES Y CAMPOS (LENGUAJE HOSPITALARIO)
══════════════════════════════════════════════════════════════ */
const ENTITY_CATALOG = {
  inventory: {
    id: 'inventory',
    title: 'Inventario y Stock por Almacén',
    icon: '📦',
    category: 'Inventarios y Stock',
    description: 'Existencias actuales, costos y precios en Farmacia, Quirófano, Carro Rojo y Almacén General.',
    requiresDateFilter: false,
    dateField: null,
    defaultFields: ['ItemCode', 'ItemName', 'WhsCode', 'WhsName', 'QuantityOnStock', 'PurchaseCost', 'PriceHos', 'PricePG'],
    fields: [
      { key: 'ItemCode', label: 'Código del Artículo', type: 'string', width: 120 },
      { key: 'ItemName', label: 'Descripción del Insumo / Medicamento', type: 'string', width: 280 },
      { key: 'WhsCode', label: 'Cód. Almacén', type: 'string', width: 90 },
      { key: 'WhsName', label: 'Nombre del Almacén', type: 'string', width: 180 },
      { key: 'QuantityOnStock', label: 'Stock en Existencia', type: 'number', width: 110, align: 'center' },
      { key: 'PurchaseCost', label: 'Último Costo Compra ($)', type: 'money', width: 140, align: 'right' },
      { key: 'AvgCost', label: 'Costo Promedio ($)', type: 'money', width: 130, align: 'right' },
      { key: 'PriceHos', label: 'Precio Hospitalización ($)', type: 'money', width: 150, align: 'right' },
      { key: 'PricePG', label: 'Precio Público General ($)', type: 'money', width: 150, align: 'right' },
      { key: 'ProfitMargin', label: 'Margen Teórico (%)', type: 'percent', width: 120, align: 'right' },
      { key: 'ItemGroupName', label: 'Grupo de Artículos', type: 'string', width: 160 },
      { key: 'ManufacturerName', label: 'Laboratorio / Tipo', type: 'string', width: 160 },
      { key: 'MedicalClassification', label: 'Clasif. Médica (CON/ANTI/REFRI)', type: 'string', width: 150, align: 'center' },
      { key: 'SecondaryClassification', label: 'Clasif. Secundaria', type: 'string', width: 130, align: 'center' }
    ]
  },

  batches: {
    id: 'batches',
    title: 'Lotes y Caducidades de Insumos',
    icon: '⏳',
    category: 'Control de Caducidades',
    description: 'Números de lote activos, fechas de caducidad, días restantes para vencimiento y almacén.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Caducidad / Vencimiento',
    defaultFields: ['ItemCode', 'ItemName', 'Batch', 'WhsCode', 'Quantity', 'ExpirationDate', 'DaysToExpiry', 'Status'],
    fields: [
      { key: 'ItemCode', label: 'Código del Artículo', type: 'string', width: 120 },
      { key: 'ItemName', label: 'Medicamento / Insumo', type: 'string', width: 280 },
      { key: 'Batch', label: 'Número de Lote', type: 'string', width: 130, align: 'center' },
      { key: 'WhsCode', label: 'Almacén', type: 'string', width: 100, align: 'center' },
      { key: 'Quantity', label: 'Cantidad en Lote', type: 'number', width: 110, align: 'center' },
      { key: 'AdmissionDate', label: 'Fecha Ingreso', type: 'date', width: 120, align: 'center' },
      { key: 'ExpirationDate', label: 'Fecha Caducidad', type: 'date', width: 120, align: 'center' },
      { key: 'DaysToExpiry', label: 'Días por Vencer', type: 'number', width: 110, align: 'center' },
      { key: 'Status', label: 'Estatus del Lote', type: 'status', width: 130, align: 'center' }
    ]
  },

  purchase_invoices: {
    id: 'purchase_invoices',
    title: 'Facturas de Proveedores (Compras)',
    icon: '🧾',
    category: 'Adquisiciones y Finanzas',
    description: 'Facturas recibidas de proveedores, precios unitarios de compra, IVA, totales y fechas de contabilización.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Contabilización',
    defaultFields: ['DocNum', 'DocDate', 'CardName', 'ItemCode', 'Dscription', 'Quantity', 'Price', 'LineTotal', 'DocTotal'],
    fields: [
      { key: 'DocNum', label: 'Folio Factura SAP', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Contabilización', type: 'date', width: 130, align: 'center' },
      { key: 'DocDueDate', label: 'Fecha Vencimiento', type: 'date', width: 130, align: 'center' },
      { key: 'CardCode', label: 'Cód. Proveedor', type: 'string', width: 110 },
      { key: 'CardName', label: 'Proveedor / Razón Social', type: 'string', width: 260 },
      { key: 'ItemCode', label: 'Código Artículo', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Descripción Insumo Facturado', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Comprada', type: 'number', width: 110, align: 'center' },
      { key: 'Price', label: 'Precio Unitario Compra ($)', type: 'money', width: 150, align: 'right' },
      { key: 'LineTotal', label: 'Subtotal Línea ($)', type: 'money', width: 140, align: 'right' },
      { key: 'VatSum', label: 'IVA / Impuesto ($)', type: 'money', width: 130, align: 'right' },
      { key: 'DocTotal', label: 'Total Factura ($)', type: 'money', width: 140, align: 'right' },
      { key: 'WhsCode', label: 'Almacén Entrada', type: 'string', width: 110, align: 'center' },
      { key: 'Comments', label: 'Observaciones / Folio Fiscal', type: 'string', width: 240 }
    ]
  },

  purchase_orders: {
    id: 'purchase_orders',
    title: 'Órdenes de Compra a Proveedores',
    icon: '📋',
    category: 'Adquisiciones y Finanzas',
    description: 'Pedidos emitidos a proveedores, cantidades solicitadas vs pendientes de entrega y estatus.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Emisión de Orden',
    defaultFields: ['DocNum', 'DocDate', 'CardName', 'ItemCode', 'Dscription', 'Quantity', 'OpenQty', 'Price', 'DocTotal', 'DocStatus'],
    fields: [
      { key: 'DocNum', label: 'No. Orden Compra', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Emisión', type: 'date', width: 120, align: 'center' },
      { key: 'DocDueDate', label: 'Fecha Entrega Prometida', type: 'date', width: 140, align: 'center' },
      { key: 'CardName', label: 'Proveedor', type: 'string', width: 250 },
      { key: 'DocStatus', label: 'Estatus Pedido', type: 'string', width: 120, align: 'center' },
      { key: 'ItemCode', label: 'Código Insumo', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Descripción del Insumo', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Pedida', type: 'number', width: 100, align: 'center' },
      { key: 'OpenQty', label: 'Cant. Pendiente', type: 'number', width: 110, align: 'center' },
      { key: 'Price', label: 'Precio Pactado ($)', type: 'money', width: 130, align: 'right' },
      { key: 'LineTotal', label: 'Importe Línea ($)', type: 'money', width: 130, align: 'right' },
      { key: 'DocTotal', label: 'Total Pedido ($)', type: 'money', width: 140, align: 'right' },
      { key: 'Comments', label: 'Observaciones', type: 'string', width: 220 }
    ]
  },

  stock_transfers: {
    id: 'stock_transfers',
    title: 'Traslados entre Almacenes',
    icon: '🚚',
    category: 'Movimientos de Almacén',
    description: 'Movimientos de insumos entre Almacén General, Farmacia, Quirófano y Carro Rojo con fechas y cantidades.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Traslado',
    defaultFields: ['DocNum', 'DocDate', 'Filler', 'ToWhsCode', 'ItemCode', 'Dscription', 'Quantity', 'Comments'],
    fields: [
      { key: 'DocNum', label: 'Folio Traslado', type: 'string', width: 110, align: 'center' },
      { key: 'DocDate', label: 'Fecha Traslado', type: 'date', width: 120, align: 'center' },
      { key: 'Filler', label: 'Almacén Origen (De)', type: 'string', width: 140, align: 'center' },
      { key: 'ToWhsCode', label: 'Almacén Destino (A)', type: 'string', width: 140, align: 'center' },
      { key: 'ItemCode', label: 'Código Insumo', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Descripción Insumo', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Trasladada', type: 'number', width: 120, align: 'center' },
      { key: 'Comments', label: 'Motivo / Comentarios', type: 'string', width: 240 }
    ]
  },

  purchase_requests: {
    id: 'purchase_requests',
    title: 'Requisiciones y Solicitudes de Compra',
    icon: '📑',
    category: 'Adquisiciones y Finanzas',
    description: 'Solicitudes internas de material y medicamentos generadas por las distintas áreas hospitalarias.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Requisición',
    defaultFields: ['DocNum', 'DocDate', 'Requester', 'Department', 'ItemCode', 'Dscription', 'Quantity', 'DocStatus'],
    fields: [
      { key: 'DocNum', label: 'No. Requisición', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Solicitud', type: 'date', width: 120, align: 'center' },
      { key: 'ReqDate', label: 'Fecha Requerida', type: 'date', width: 120, align: 'center' },
      { key: 'Requester', label: 'Usuario Solicitante', type: 'string', width: 180 },
      { key: 'Department', label: 'Área / Departamento', type: 'string', width: 160 },
      { key: 'DocStatus', label: 'Estatus', type: 'string', width: 110, align: 'center' },
      { key: 'ItemCode', label: 'Código Insumo', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Insumo Solicitado', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Solicitada', type: 'number', width: 110, align: 'center' },
      { key: 'Comments', label: 'Justificación', type: 'string', width: 240 }
    ]
  },

  business_partners: {
    id: 'business_partners',
    title: 'Directorio de Proveedores y Socios',
    icon: '👥',
    category: 'Catálogos Maestros',
    description: 'Padrón de proveedores activos en SAP, RFC, teléfonos, correos y saldos contables.',
    requiresDateFilter: false,
    dateField: null,
    defaultFields: ['CardCode', 'CardName', 'CardType', 'LicTradNum', 'Phone1', 'E_Mail', 'Balance', 'GroupName'],
    fields: [
      { key: 'CardCode', label: 'Código SAP', type: 'string', width: 110 },
      { key: 'CardName', label: 'Razón Social / Proveedor', type: 'string', width: 280 },
      { key: 'CardType', label: 'Tipo (Proveedor / Cliente)', type: 'string', width: 150, align: 'center' },
      { key: 'LicTradNum', label: 'RFC', type: 'string', width: 140, align: 'center' },
      { key: 'Phone1', label: 'Teléfono', type: 'string', width: 130 },
      { key: 'E_Mail', label: 'Correo Electrónico', type: 'string', width: 200 },
      { key: 'Balance', label: 'Saldo de Cuenta ($)', type: 'money', width: 140, align: 'right' },
      { key: 'GroupName', label: 'Grupo Proveedor', type: 'string', width: 160 },
      { key: 'CreateDate', label: 'Fecha Alta SAP', type: 'date', width: 120, align: 'center' }
    ]
  },

  item_prices: {
    id: 'item_prices',
    title: 'Listas de Precios y Costos',
    icon: '🏷️',
    category: 'Catálogos Maestros',
    description: 'Catálogo de precios de venta Hospitalización y Público General comparados con el costo de adquisición.',
    requiresDateFilter: false,
    dateField: null,
    defaultFields: ['ItemCode', 'ItemName', 'PurchaseCost', 'PriceHos', 'PricePG', 'ProfitMargin', 'ItemGroupName'],
    fields: [
      { key: 'ItemCode', label: 'Código Artículo', type: 'string', width: 120 },
      { key: 'ItemName', label: 'Descripción Insumo / Medicamento', type: 'string', width: 280 },
      { key: 'PurchaseCost', label: 'Último Costo Compra ($)', type: 'money', width: 140, align: 'right' },
      { key: 'AvgCost', label: 'Costo Promedio ($)', type: 'money', width: 130, align: 'right' },
      { key: 'PriceHos', label: 'Precio Hospitalización ($)', type: 'money', width: 150, align: 'right' },
      { key: 'PricePG', label: 'Precio Público General ($)', type: 'money', width: 150, align: 'right' },
      { key: 'ProfitMargin', label: 'Margen PG (%)', type: 'percent', width: 110, align: 'right' },
      { key: 'ItemGroupName', label: 'Grupo de Artículos', type: 'string', width: 160 },
      { key: 'ManufacturerName', label: 'Laboratorio', type: 'string', width: 160 }
    ]
  }
};

const WAREHOUSE_NAMES = {
  'FAR': 'Farmacia Central',
  'QX': 'Quirófano General',
  'QXCR': 'Quirófano Carro Rojo',
  'ALM': 'Almacén General',
  'URG': 'Urgencias',
  'CE': 'Consulta Externa'
};

function formatSapDateStr(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (s.length === 8 && /^\d{8}$/.test(s)) {
    return `${s.substring(0,4)}-${s.substring(4,6)}-${s.substring(6,8)}`;
  }
  try {
    return new Date(val).toISOString().split('T')[0];
  } catch (e) {
    return s.slice(0, 10);
  }
}

/**
 * Asegura la creación de una SQLQuery en SAP Service Layer
 */
async function ensureSapQuery(sqlCode, sqlText) {
  try {
    await sapService.post('/SQLQueries', {
      SqlCode: sqlCode,
      SqlName: sqlCode,
      SqlText: sqlText
    });
  } catch (e) {
    try {
      await sapService.patch(`/SQLQueries('${sqlCode}')`, {
        SqlName: sqlCode,
        SqlText: sqlText
      });
    } catch (err) {
      // Ya existe o sin cambios
    }
  }
}

/**
 * Ejecuta una consulta dinámica en Service Layer validando filtros obligatorios
 */
async function executeQuery({
  entity,
  selectedFields = [],
  fechaDesde,
  fechaHasta,
  almacen,
  proveedor,
  busqueda,
  limit = 2000
}) {
  const entityDef = ENTITY_CATALOG[entity];
  if (!entityDef) {
    throw new Error(`Entidad '${entity}' no reconocida en el catálogo.`);
  }

  // 1. Validar filtro obligatorio de fechas
  if (entityDef.requiresDateFilter) {
    if (!fechaDesde || !fechaHasta) {
      throw new Error(`Para evitar sobrecarga en SAP Service Layer, la entidad '${entityDef.title}' requiere obligatoriamente un rango de fechas (Fecha Desde y Fecha Hasta).`);
    }

    const d1 = new Date(fechaDesde);
    const d2 = new Date(fechaHasta);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      throw new Error('El formato de fechas es inválido. Use YYYY-MM-DD.');
    }
    if (d1 > d2) {
      throw new Error('La Fecha Desde no puede ser posterior a la Fecha Hasta.');
    }

    // Limitar rango máximo a 366 días para proteger el servidor
    const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
    if (diffDays > 366) {
      throw new Error('El rango de fechas no puede exceder 366 días consecutivos por consulta.');
    }
  }

  // Formato fechas para SAP SQL (YYYYMMDD o YYYY-MM-DD)
  const dDesdeSap = fechaDesde ? fechaDesde.replace(/-/g, '') : '';
  const dHastaSap = fechaHasta ? fechaHasta.replace(/-/g, '') : '';
  const dDesdeSql = fechaDesde ? `${fechaDesde} 00:00:00` : '';
  const dHastaSql = fechaHasta ? `${fechaHasta} 23:59:59` : '';

  let rawRows = [];

  // 2. Ejecutar según el módulo seleccionado
  switch (entity) {
    case 'inventory':
    case 'item_prices': {
      await sapInventoryService.ensureInventoryData();
      let inv = sapInventoryService.getInventoryCache() || [];
      
      if (almacen && almacen !== 'ALL') {
        inv = inv.filter(i => i.WhsCode === almacen);
      }
      if (busqueda && busqueda.trim()) {
        const q = busqueda.toLowerCase().trim();
        inv = inv.filter(i => 
          String(i.ItemCode || '').toLowerCase().includes(q) ||
          String(i.ItemName || '').toLowerCase().includes(q) ||
          String(i.ItemGroupName || '').toLowerCase().includes(q)
        );
      }

      rawRows = inv.map(i => ({
        ...i,
        WhsName: WAREHOUSE_NAMES[i.WhsCode] || i.WhsCode,
        ProfitMargin: Math.round(Number(i.ProfitMargin || 0) * 10) / 10,
        MarginHos: i.PriceHos > 0 && i.PurchaseCost > 0 ? Math.round(((i.PriceHos - i.PurchaseCost) / i.PriceHos) * 1000) / 10 : 0,
        MarginPG: i.PricePG > 0 && i.PurchaseCost > 0 ? Math.round(((i.PricePG - i.PurchaseCost) / i.PricePG) * 1000) / 10 : 0
      }));
      break;
    }

    case 'batches': {
      const sqlCode = 'sq_qb_batches';
      const sqlText = `SELECT T0.ItemCode, T2.ItemName, T1.WhsCode, T0.DistNumber AS Batch, T0.InDate AS AdmissionDate, T0.ExpDate AS ExpirationDate, T1.Quantity FROM OBTN T0 INNER JOIN OBTQ T1 ON T0.ItemCode = T1.ItemCode AND T0.SysNumber = T1.SysNumber LEFT JOIN OITM T2 ON T0.ItemCode = T2.ItemCode WHERE T1.Quantity > 0 AND T0.ExpDate >= '${dDesdeSap}' AND T0.ExpDate <= '${dHastaSap}'`;
      
      await ensureSapQuery(sqlCode, sqlText);
      const res = await sapService.get(`/SQLQueries('${sqlCode}')/List`, { 'Prefer': 'odata.maxpagesize=5000' });
      const items = res.data?.value || [];
      const now = new Date();

      rawRows = items.map(b => {
        const exp = formatSapDateStr(b.ExpirationDate);
        const adm = formatSapDateStr(b.AdmissionDate);
        let daysToExpiry = null;
        let status = 'Activo';
        if (exp) {
          const expD = new Date(exp);
          daysToExpiry = Math.ceil((expD - now) / (1000 * 60 * 60 * 24));
          if (daysToExpiry < 0) status = 'Vencido';
          else if (daysToExpiry <= 90) status = 'Próximo a Vencer';
        }

        return {
          ItemCode: b.ItemCode,
          ItemName: b.ItemName || b.ItemCode,
          Batch: b.Batch,
          WhsCode: b.WhsCode,
          Quantity: Number(b.Quantity || 0),
          AdmissionDate: adm,
          ExpirationDate: exp,
          DaysToExpiry: daysToExpiry,
          Status: status
        };
      });
      break;
    }

    case 'purchase_invoices': {
      const sqlCode = 'sq_qb_pinv';
      const sqlText = `SELECT TOP ${limit} T0.DocNum, T0.DocDate, T0.DocDueDate, T0.CardCode, T0.CardName, T1.ItemCode, T1.Dscription, T1.Quantity, T1.Price, T1.LineTotal, T1.VatSum, T0.DocTotal, T1.WhsCode, T0.Comments FROM OPCH T0 INNER JOIN PCH1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= '${dDesdeSap}' AND T0.DocDate <= '${dHastaSap}' ORDER BY T0.DocDate DESC`;
      
      await ensureSapQuery(sqlCode, sqlText);
      const res = await sapService.get(`/SQLQueries('${sqlCode}')/List`, { 'Prefer': 'odata.maxpagesize=5000' });
      const items = res.data?.value || [];

      rawRows = items.map(p => ({
        ...p,
        DocDate: formatSapDateStr(p.DocDate),
        DocDueDate: formatSapDateStr(p.DocDueDate),
        Quantity: Number(p.Quantity || 0),
        Price: Number(p.Price || 0),
        LineTotal: Number(p.LineTotal || 0),
        VatSum: Number(p.VatSum || 0),
        DocTotal: Number(p.DocTotal || 0)
      }));
      break;
    }

    case 'purchase_orders': {
      const sqlCode = 'sq_qb_por';
      const sqlText = `SELECT TOP ${limit} T0.DocNum, T0.DocDate, T0.DocDueDate, T0.CardCode, T0.CardName, T0.DocStatus, T1.ItemCode, T1.Dscription, T1.Quantity, T1.OpenQty, T1.Price, T1.LineTotal, T0.DocTotal, T0.Comments FROM OPOR T0 INNER JOIN POR1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= '${dDesdeSap}' AND T0.DocDate <= '${dHastaSap}' ORDER BY T0.DocDate DESC`;
      
      await ensureSapQuery(sqlCode, sqlText);
      const res = await sapService.get(`/SQLQueries('${sqlCode}')/List`, { 'Prefer': 'odata.maxpagesize=5000' });
      const items = res.data?.value || [];

      rawRows = items.map(p => ({
        ...p,
        DocDate: formatSapDateStr(p.DocDate),
        DocDueDate: formatSapDateStr(p.DocDueDate),
        DocStatus: p.DocStatus === 'O' ? 'Abierta' : p.DocStatus === 'C' ? 'Cerrada' : p.DocStatus,
        Quantity: Number(p.Quantity || 0),
        OpenQty: Number(p.OpenQty || 0),
        Price: Number(p.Price || 0),
        LineTotal: Number(p.LineTotal || 0),
        DocTotal: Number(p.DocTotal || 0)
      }));
      break;
    }

    case 'stock_transfers': {
      const sqlCode = 'sq_qb_transfers';
      const sqlText = `SELECT TOP ${limit} T0.DocNum, T0.DocDate, T0.Filler, T0.ToWhsCode, T1.ItemCode, T1.Dscription, T1.Quantity, T0.Comments FROM OWTR T0 INNER JOIN WTR1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= '${dDesdeSap}' AND T0.DocDate <= '${dHastaSap}' ORDER BY T0.DocDate DESC`;
      
      await ensureSapQuery(sqlCode, sqlText);
      const res = await sapService.get(`/SQLQueries('${sqlCode}')/List`, { 'Prefer': 'odata.maxpagesize=5000' });
      const items = res.data?.value || [];

      rawRows = items.map(t => ({
        ...t,
        DocDate: formatSapDateStr(t.DocDate),
        Filler: WAREHOUSE_NAMES[t.Filler] || t.Filler,
        ToWhsCode: WAREHOUSE_NAMES[t.ToWhsCode] || t.ToWhsCode,
        Quantity: Number(t.Quantity || 0)
      }));
      break;
    }

    case 'purchase_requests': {
      const sqlCode = 'sq_qb_prq';
      const sqlText = `SELECT TOP ${limit} T0.DocNum, T0.DocDate, T0.ReqDate, T0.Requester, T0.Department, T0.DocStatus, T1.ItemCode, T1.Dscription, T1.Quantity, T0.Comments FROM OPRQ T0 INNER JOIN PRQ1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= '${dDesdeSap}' AND T0.DocDate <= '${dHastaSap}' ORDER BY T0.DocDate DESC`;
      
      await ensureSapQuery(sqlCode, sqlText);
      const res = await sapService.get(`/SQLQueries('${sqlCode}')/List`, { 'Prefer': 'odata.maxpagesize=5000' });
      const items = res.data?.value || [];

      rawRows = items.map(r => ({
        ...r,
        DocDate: formatSapDateStr(r.DocDate),
        ReqDate: formatSapDateStr(r.ReqDate),
        DocStatus: r.DocStatus === 'O' ? 'Abierta' : r.DocStatus === 'C' ? 'Cerrada' : r.DocStatus,
        Quantity: Number(r.Quantity || 0)
      }));
      break;
    }

    case 'business_partners': {
      const sqlCode = 'sq_qb_bp';
      const sqlText = `SELECT TOP ${limit} T0.CardCode, T0.CardName, T0.CardType, T0.LicTradNum, T0.Phone1, T0.E_Mail, T0.Balance, T1.GroupName, T0.CreateDate FROM OCRD T0 LEFT JOIN OCRG T1 ON T0.GroupCode = T1.GroupCode WHERE T0.CardType IN ('S', 'C') ORDER BY T0.CardName ASC`;
      
      await ensureSapQuery(sqlCode, sqlText);
      const res = await sapService.get(`/SQLQueries('${sqlCode}')/List`, { 'Prefer': 'odata.maxpagesize=5000' });
      const items = res.data?.value || [];

      rawRows = items.map(b => ({
        ...b,
        CardType: b.CardType === 'S' ? 'Proveedor' : 'Cliente',
        Balance: Number(b.Balance || 0),
        CreateDate: formatSapDateStr(b.CreateDate)
      }));
      break;
    }

    default:
      throw new Error(`Módulo '${entity}' en proceso de configuración.`);
  }

  // 3. Aplicar filtros rápidos de texto y almacén en memoria
  if (almacen && almacen !== 'ALL') {
    rawRows = rawRows.filter(r => (r.WhsCode === almacen || r.Filler === almacen || r.ToWhsCode === almacen));
  }
  if (proveedor && proveedor.trim()) {
    const p = proveedor.toLowerCase().trim();
    rawRows = rawRows.filter(r => 
      String(r.CardName || '').toLowerCase().includes(p) || 
      String(r.CardCode || '').toLowerCase().includes(p)
    );
  }
  if (busqueda && busqueda.trim()) {
    const q = busqueda.toLowerCase().trim();
    rawRows = rawRows.filter(row => {
      return Object.values(row).some(val => 
        val != null && String(val).toLowerCase().includes(q)
      );
    });
  }

  // 4. Filtrar únicamente las columnas seleccionadas
  const activeFields = (selectedFields.length > 0 ? selectedFields : entityDef.defaultFields);
  const activeColsDef = entityDef.fields.filter(f => activeFields.includes(f.key));

  const projectedData = rawRows.map(row => {
    const out = {};
    for (const f of activeColsDef) {
      out[f.key] = row[f.key] ?? null;
    }
    return out;
  });

  return {
    entity: entityDef.id,
    entityTitle: entityDef.title,
    ejecutadoEn: new Date().toISOString(),
    totalRegistros: projectedData.length,
    columnas: activeColsDef,
    data: projectedData
  };
}

/* ══════════════════════════════════════════════════════════════
   GESTIÓN DE CONSULTAS GUARDADAS (PLANTILLAS DE USUARIO)
══════════════════════════════════════════════════════════════ */

async function getSavedQueries(user) {
  const isAdmin = user.role === 'ADMIN' || user.role === 'DIRECTOR' || String(user.username).toLowerCase() === 'amendoza';
  
  let res;
  if (isAdmin) {
    res = await pool.query(`
      SELECT QueryId, UserId, Username, Titulo, Descripcion, Entidad, CamposSeleccionados, FiltrosAplicados, EsPublico, FechaCreacion, FechaModificacion
      FROM UserSapQueries
      ORDER BY FechaCreacion DESC
    `);
  } else {
    res = await pool.query(`
      SELECT QueryId, UserId, Username, Titulo, Descripcion, Entidad, CamposSeleccionados, FiltrosAplicados, EsPublico, FechaCreacion, FechaModificacion
      FROM UserSapQueries
      WHERE Username = $1 OR EsPublico = 1
      ORDER BY FechaCreacion DESC
    `, [user.username]);
  }

  return (res.rows || []).map(r => ({
    id: r.queryid,
    userId: r.userid,
    username: r.username,
    title: r.titulo,
    description: r.descripcion,
    entity: r.entidad,
    selectedFields: JSON.parse(r.camposseleccionados || '[]'),
    filters: JSON.parse(r.filtrosaplicados || '{}'),
    isPublic: Boolean(r.espublico),
    createdAt: r.fechacreacion,
    isOwner: r.username === user.username
  }));
}

async function saveQuery(user, { title, description, entity, selectedFields, filters, isPublic }) {
  if (!title || !entity) {
    throw new Error('El título y la entidad son obligatorios para guardar la consulta.');
  }

  const res = await pool.query(`
    INSERT INTO UserSapQueries (UserId, Username, Titulo, Descripcion, Entidad, CamposSeleccionados, FiltrosAplicados, EsPublico, FechaCreacion)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
    RETURNING QueryId, Titulo, FechaCreacion
  `, [
    user.id || null,
    user.username,
    title.trim(),
    description ? description.trim() : null,
    entity,
    JSON.stringify(selectedFields || []),
    JSON.stringify(filters || {}),
    isPublic ? 1 : 0
  ]);

  return res.rows[0];
}

async function deleteQuery(user, queryId) {
  const isAdmin = user.role === 'ADMIN' || user.role === 'DIRECTOR' || String(user.username).toLowerCase() === 'amendoza';
  
  let res;
  if (isAdmin) {
    res = await pool.query(`DELETE FROM UserSapQueries WHERE QueryId = $1 RETURNING QueryId`, [queryId]);
  } else {
    res = await pool.query(`DELETE FROM UserSapQueries WHERE QueryId = $1 AND Username = $2 RETURNING QueryId`, [queryId, user.username]);
  }

  if (res.rowCount === 0) {
    throw new Error('No se encontró la consulta o no cuenta con permisos para eliminarla.');
  }

  return { ok: true, queryId };
}

module.exports = {
  getEntityCatalog: () => Object.values(ENTITY_CATALOG),
  getEntityDefinition: (id) => ENTITY_CATALOG[id],
  executeQuery,
  getSavedQueries,
  saveQuery,
  deleteQuery
};
