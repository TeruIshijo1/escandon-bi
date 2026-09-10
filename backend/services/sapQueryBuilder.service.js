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
  // ── INVENTARIOS Y STOCK ──
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
    requiresDateFilter: false,
    dateField: null,
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

  // ── COMPRAS Y PROVEEDORES ──
  purchase_invoices: {
    id: 'purchase_invoices',
    title: 'Facturas de Proveedores (Compras)',
    icon: '🧾',
    category: 'Compras y Proveedores',
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
    category: 'Compras y Proveedores',
    description: 'Pedidos emitidos a proveedores, cantidades solicitadas vs pendientes de entrega y estatus.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Emisión de Orden',
    defaultFields: ['DocNum', 'DocDate', 'CardName', 'ItemCode', 'Dscription', 'Quantity', 'OpenQty', 'Price', 'DocTotal', 'DocStatus'],
    fields: [
      { key: 'DocNum', label: 'No. Orden Compra', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Emisión', type: 'date', width: 120, align: 'center' },
      { key: 'DocDueDate', label: 'Fecha Entrega Prometida', type: 'date', width: 140, align: 'center' },
      { key: 'CardName', label: 'Proveedor', type: 'string', width: 250 },
      { key: 'DocStatus', label: 'Estatus Pedido', type: 'status', width: 120, align: 'center' },
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

  goods_receipts_po: {
    id: 'goods_receipts_po',
    title: 'Recepciones de Mercancía (Entradas)',
    icon: '📥',
    category: 'Compras y Proveedores',
    description: 'Insumos recibidos físicamente en almacén/farmacia de proveedores pendientes de facturar.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Recepción',
    defaultFields: ['DocNum', 'DocDate', 'CardName', 'ItemCode', 'Dscription', 'Quantity', 'Price', 'LineTotal', 'DocTotal', 'WhsCode'],
    fields: [
      { key: 'DocNum', label: 'Folio Entrada SAP', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Recepción', type: 'date', width: 130, align: 'center' },
      { key: 'DocDueDate', label: 'Fecha Vencimiento', type: 'date', width: 130, align: 'center' },
      { key: 'CardCode', label: 'Cód. Proveedor', type: 'string', width: 110 },
      { key: 'CardName', label: 'Proveedor / Razón Social', type: 'string', width: 260 },
      { key: 'ItemCode', label: 'Código Artículo', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Descripción del Insumo', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Recibida', type: 'number', width: 110, align: 'center' },
      { key: 'Price', label: 'Precio Unitario ($)', type: 'money', width: 140, align: 'right' },
      { key: 'LineTotal', label: 'Subtotal Línea ($)', type: 'money', width: 140, align: 'right' },
      { key: 'DocTotal', label: 'Total Recepción ($)', type: 'money', width: 140, align: 'right' },
      { key: 'WhsCode', label: 'Almacén Destino', type: 'string', width: 110, align: 'center' },
      { key: 'Comments', label: 'Observaciones / Remisión', type: 'string', width: 240 }
    ]
  },

  goods_returns: {
    id: 'goods_returns',
    title: 'Devoluciones a Proveedores',
    icon: '🔄',
    category: 'Compras y Proveedores',
    description: 'Medicamentos e insumos devueltos a laboratorios por caducidad, daño de empaque o sobre-stock.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Devolución',
    defaultFields: ['DocNum', 'DocDate', 'CardName', 'ItemCode', 'Dscription', 'Quantity', 'Price', 'LineTotal', 'DocTotal', 'Comments'],
    fields: [
      { key: 'DocNum', label: 'Folio Devolución', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Devolución', type: 'date', width: 130, align: 'center' },
      { key: 'CardCode', label: 'Cód. Proveedor', type: 'string', width: 110 },
      { key: 'CardName', label: 'Proveedor / Laboratorio', type: 'string', width: 260 },
      { key: 'ItemCode', label: 'Código Insumo', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Descripción del Insumo', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Devuelta', type: 'number', width: 110, align: 'center' },
      { key: 'Price', label: 'Costo Unitario ($)', type: 'money', width: 140, align: 'right' },
      { key: 'LineTotal', label: 'Importe Devolución ($)', type: 'money', width: 150, align: 'right' },
      { key: 'DocTotal', label: 'Total Devolución ($)', type: 'money', width: 150, align: 'right' },
      { key: 'WhsCode', label: 'Almacén Origen', type: 'string', width: 110, align: 'center' },
      { key: 'Comments', label: 'Motivo de Devolución', type: 'string', width: 240 }
    ]
  },

  // ── MOVIMIENTOS Y ALMACENES ──
  stock_transfers: {
    id: 'stock_transfers',
    title: 'Traslados entre Almacenes Realizados',
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

  transfer_requests: {
    id: 'transfer_requests',
    title: 'Solicitudes de Traslado entre Almacenes',
    icon: '⏳',
    category: 'Movimientos de Almacén',
    description: 'Solicitudes de reabastecimiento generadas por las áreas (Farmacia/Quirófano) hacia Almacén General.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Solicitud',
    defaultFields: ['DocNum', 'DocDate', 'Filler', 'ToWhsCode', 'DocStatus', 'ItemCode', 'Dscription', 'Quantity', 'OpenQty'],
    fields: [
      { key: 'DocNum', label: 'No. Solicitud', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Solicitud', type: 'date', width: 120, align: 'center' },
      { key: 'DueDate', label: 'Fecha Requerida', type: 'date', width: 120, align: 'center' },
      { key: 'Filler', label: 'Almacén Origen (De)', type: 'string', width: 140, align: 'center' },
      { key: 'ToWhsCode', label: 'Almacén Destino (A)', type: 'string', width: 140, align: 'center' },
      { key: 'DocStatus', label: 'Estatus', type: 'status', width: 110, align: 'center' },
      { key: 'ItemCode', label: 'Código Insumo', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Descripción Insumo', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Solicitada', type: 'number', width: 110, align: 'center' },
      { key: 'OpenQty', label: 'Cant. Pendiente', type: 'number', width: 110, align: 'center' },
      { key: 'Comments', label: 'Justificación / Área', type: 'string', width: 240 }
    ]
  },

  goods_issues: {
    id: 'goods_issues',
    title: 'Salidas de Inventario (Mermas / Bajas)',
    icon: '📉',
    category: 'Movimientos de Almacén',
    description: 'Bajas de caducados, mermas, consumos de centros de costos y ajustes negativos de inventario.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Salida',
    defaultFields: ['DocNum', 'DocDate', 'ItemCode', 'Dscription', 'Quantity', 'Price', 'LineTotal', 'WhsCode', 'Comments'],
    fields: [
      { key: 'DocNum', label: 'Folio Salida SAP', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Salida', type: 'date', width: 120, align: 'center' },
      { key: 'ItemCode', label: 'Código Insumo', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Descripción del Insumo', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Dada de Baja', type: 'number', width: 120, align: 'center' },
      { key: 'Price', label: 'Costo Unitario ($)', type: 'money', width: 130, align: 'right' },
      { key: 'LineTotal', label: 'Costo Total Baja ($)', type: 'money', width: 140, align: 'right' },
      { key: 'WhsCode', label: 'Almacén Origen', type: 'string', width: 110, align: 'center' },
      { key: 'Comments', label: 'Motivo / Justificación', type: 'string', width: 260 }
    ]
  },

  goods_receipts_inv: {
    id: 'goods_receipts_inv',
    title: 'Entradas Directas y Ajustes Positivos',
    icon: '📈',
    category: 'Movimientos de Almacén',
    description: 'Ajustes positivos de inventario físico, altas directas de material y donaciones.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Entrada',
    defaultFields: ['DocNum', 'DocDate', 'ItemCode', 'Dscription', 'Quantity', 'Price', 'LineTotal', 'WhsCode', 'Comments'],
    fields: [
      { key: 'DocNum', label: 'Folio Entrada SAP', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Entrada', type: 'date', width: 120, align: 'center' },
      { key: 'ItemCode', label: 'Código Insumo', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Descripción Insumo', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Ingresada', type: 'number', width: 110, align: 'center' },
      { key: 'Price', label: 'Costo Valuado ($)', type: 'money', width: 130, align: 'right' },
      { key: 'LineTotal', label: 'Valor Total ($)', type: 'money', width: 140, align: 'right' },
      { key: 'WhsCode', label: 'Almacén Destino', type: 'string', width: 110, align: 'center' },
      { key: 'Comments', label: 'Concepto / Justificación', type: 'string', width: 260 }
    ]
  },

  purchase_requests: {
    id: 'purchase_requests',
    title: 'Requisiciones y Solicitudes de Compra',
    icon: '📑',
    category: 'Compras y Proveedores',
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
      { key: 'DocStatus', label: 'Estatus', type: 'status', width: 110, align: 'center' },
      { key: 'ItemCode', label: 'Código Insumo', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Insumo Solicitado', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Solicitada', type: 'number', width: 110, align: 'center' },
      { key: 'Comments', label: 'Justificación', type: 'string', width: 240 }
    ]
  },

  // ── FACTURACIÓN Y CLIENTES ──
  sales_invoices: {
    id: 'sales_invoices',
    title: 'Facturación e Ingresos Hospitalarios',
    icon: '💰',
    category: 'Facturación e Ingresos',
    description: 'Facturación emitida a pacientes, aseguradoras y empresas por hospitalización, servicios y medicamentos.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Facturación',
    defaultFields: ['DocNum', 'DocDate', 'CardName', 'U_PRName', 'ItemCode', 'Dscription', 'Quantity', 'Price', 'LineTotal', 'DocTotal'],
    fields: [
      { key: 'DocNum', label: 'Folio Factura Venta', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Factura', type: 'date', width: 120, align: 'center' },
      { key: 'DocDueDate', label: 'Fecha Vencimiento', type: 'date', width: 130, align: 'center' },
      { key: 'CardCode', label: 'Cód. Cliente/Paciente', type: 'string', width: 120 },
      { key: 'CardName', label: 'Paciente / Aseguradora / Razón Social', type: 'string', width: 270 },
      { key: 'U_PRName', label: 'Médico Tratante / Especialista', type: 'string', width: 220 },
      { key: 'ItemCode', label: 'Código Concepto', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Concepto / Medicamento Facturado', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cantidad', type: 'number', width: 90, align: 'center' },
      { key: 'Price', label: 'Precio Unitario ($)', type: 'money', width: 140, align: 'right' },
      { key: 'LineTotal', label: 'Importe Línea ($)', type: 'money', width: 140, align: 'right' },
      { key: 'VatSum', label: 'IVA ($)', type: 'money', width: 120, align: 'right' },
      { key: 'DocTotal', label: 'Total Factura ($)', type: 'money', width: 140, align: 'right' },
      { key: 'WhsCode', label: 'Almacén Salida', type: 'string', width: 110, align: 'center' },
      { key: 'Comments', label: 'Observaciones / Cuenta', type: 'string', width: 240 }
    ]
  },

  credit_memos: {
    id: 'credit_memos',
    title: 'Notas de Crédito a Clientes (Devoluciones)',
    icon: '🧾',
    category: 'Facturación e Ingresos',
    description: 'Devoluciones, cancelaciones y notas de crédito aplicadas a cuentas hospitalarias y facturas de clientes.',
    requiresDateFilter: true,
    dateFieldLabel: 'Fecha de Nota de Crédito',
    defaultFields: ['DocNum', 'DocDate', 'CardName', 'ItemCode', 'Dscription', 'Quantity', 'Price', 'LineTotal', 'DocTotal', 'Comments'],
    fields: [
      { key: 'DocNum', label: 'Folio Nota Crédito', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: 'Fecha Emisión', type: 'date', width: 120, align: 'center' },
      { key: 'CardCode', label: 'Cód. Cliente', type: 'string', width: 110 },
      { key: 'CardName', label: 'Paciente / Aseguradora', type: 'string', width: 260 },
      { key: 'ItemCode', label: 'Código Concepto', type: 'string', width: 120 },
      { key: 'Dscription', label: 'Concepto Cancelado / Devuelto', type: 'string', width: 280 },
      { key: 'Quantity', label: 'Cant. Bonificada', type: 'number', width: 110, align: 'center' },
      { key: 'Price', label: 'Precio Unitario ($)', type: 'money', width: 140, align: 'right' },
      { key: 'LineTotal', label: 'Importe Cancelado ($)', type: 'money', width: 150, align: 'right' },
      { key: 'DocTotal', label: 'Total Nota Crédito ($)', type: 'money', width: 150, align: 'right' },
      { key: 'Comments', label: 'Motivo de Cancelación / Descuento', type: 'string', width: 240 }
    ]
  },

  // ── CATÁLOGOS MAESTROS ──
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
  },

  item_master_data: {
    id: 'item_master_data',
    title: 'Maestro de Artículos y Clasif. Sanitaria',
    icon: '🧬',
    category: 'Catálogos Maestros',
    description: 'Padrón integral de artículos con stock mínimo, stock máximo, punto de reorden y clasificación sanitaria.',
    requiresDateFilter: false,
    dateField: null,
    defaultFields: ['ItemCode', 'ItemName', 'ItemGroupName', 'ManufacturerName', 'MedicalClassification', 'PurchaseCost', 'PriceHos', 'MinStock', 'MaxStock'],
    fields: [
      { key: 'ItemCode', label: 'Código Artículo', type: 'string', width: 120 },
      { key: 'ItemName', label: 'Descripción Insumo / Medicamento', type: 'string', width: 280 },
      { key: 'ItemGroupName', label: 'Grupo / Familia SAP', type: 'string', width: 160 },
      { key: 'ManufacturerName', label: 'Laboratorio / Fabricante', type: 'string', width: 160 },
      { key: 'MedicalClassification', label: 'Clasif. Médica (CON/ANTI/REFRI)', type: 'string', width: 160, align: 'center' },
      { key: 'SecondaryClassification', label: 'Clasif. Secundaria', type: 'string', width: 140, align: 'center' },
      { key: 'PurchaseCost', label: 'Último Costo Compra ($)', type: 'money', width: 140, align: 'right' },
      { key: 'AvgCost', label: 'Costo Promedio ($)', type: 'money', width: 130, align: 'right' },
      { key: 'PriceHos', label: 'Precio Hospitalización ($)', type: 'money', width: 150, align: 'right' },
      { key: 'PricePG', label: 'Precio Público General ($)', type: 'money', width: 150, align: 'right' },
      { key: 'MinStock', label: 'Stock Mínimo', type: 'number', width: 100, align: 'center' },
      { key: 'MaxStock', label: 'Stock Máximo', type: 'number', width: 100, align: 'center' },
      { key: 'ValidFor', label: 'Estatus en SAP', type: 'status', width: 110, align: 'center' }
    ]
  }
};

const WAREHOUSE_NAMES = {
  'FAR': 'Farmacia Central',
  'QX': 'Quirófano General',
  'QXCR': 'Quirófano Carro Rojo',
  'ALM': 'Almacén General',
  'ALG': 'Almacén General',
  'URG': 'Urgencias',
  'CE': 'Consulta Externa',
  'QXRCR': 'Recuperación Carro Rojo',
  'TERACR': 'Terapia Intensiva Carro Rojo',
  'PPBCR': 'Privados PB Carro Rojo',
  'PPACR': 'Privados PA Carro Rojo',
  'IMAGCR': 'Imagen Carro Rojo',
  'CARDIOCR': 'Cardio Carro Rojo',
  'CUNACR': 'Cunas Carro Rojo',
  'QXCM': 'Quirófano Código Mater',
  'URG1CM': 'Urgencias 1 Código Mater'
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

/* ══════════════════════════════════════════════════════════════
   DEFINICIÓN DE CONSULTAS SQL PARAMETRIZADAS ESTÁTICAS (SAP SL v5)
══════════════════════════════════════════════════════════════ */
const STATIC_SQL_QUERIES = {
  sq_v6_batches: `SELECT TOP 5000 T0.ItemCode, T2.ItemName, T1.WhsCode, T0.DistNumber AS Batch, T0.InDate AS AdmissionDate, T0.ExpDate AS ExpirationDate, T1.Quantity FROM OBTN T0 INNER JOIN OBTQ T1 ON T0.ItemCode = T1.ItemCode AND T0.SysNumber = T1.SysNumber LEFT JOIN OITM T2 ON T0.ItemCode = T2.ItemCode WHERE T1.Quantity > 0 AND T0.ExpDate >= :startDate AND T0.ExpDate <= :endDate`,
  
  sq_v6_pinv: `SELECT TOP 5000 T0.DocNum, T0.DocDate, T0.DocDueDate, T0.CardCode, T0.CardName, T1.ItemCode, T1.Dscription, T1.Quantity, T1.Price, T1.LineTotal, T1.VatSum, T0.DocTotal, T1.WhsCode, T0.Comments FROM OPCH T0 INNER JOIN PCH1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= :startDate AND T0.DocDate <= :endDate ORDER BY T0.DocDate DESC`,
  
  sq_v6_por: `SELECT TOP 5000 T0.DocNum, T0.DocDate, T0.DocDueDate, T0.CardCode, T0.CardName, T0.DocStatus, T1.ItemCode, T1.Dscription, T1.Quantity, T1.OpenQty, T1.Price, T1.LineTotal, T0.DocTotal, T1.WhsCode, T0.Comments FROM OPOR T0 INNER JOIN POR1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= :startDate AND T0.DocDate <= :endDate ORDER BY T0.DocDate DESC`,
  
  sq_v6_grpo: `SELECT TOP 5000 T0.DocNum, T0.DocDate, T0.DocDueDate, T0.CardCode, T0.CardName, T1.ItemCode, T1.Dscription, T1.Quantity, T1.Price, T1.LineTotal, T0.DocTotal, T1.WhsCode, T0.Comments FROM OPDN T0 INNER JOIN PDN1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= :startDate AND T0.DocDate <= :endDate ORDER BY T0.DocDate DESC`,
  
  sq_v6_gret: `SELECT TOP 5000 T0.DocNum, T0.DocDate, T0.CardCode, T0.CardName, T1.ItemCode, T1.Dscription, T1.Quantity, T1.Price, T1.LineTotal, T0.DocTotal, T1.WhsCode, T0.Comments FROM ORPD T0 INNER JOIN RPD1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= :startDate AND T0.DocDate <= :endDate ORDER BY T0.DocDate DESC`,
  
  sq_v6_prq: `SELECT TOP 5000 T0.DocNum, T0.DocDate, T0.ReqDate, T0.Requester, T0.Department, T0.DocStatus, T1.ItemCode, T1.Dscription, T1.Quantity, T1.WhsCode, T0.Comments FROM OPRQ T0 INNER JOIN PRQ1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= :startDate AND T0.DocDate <= :endDate ORDER BY T0.DocDate DESC`,
  
  sq_v6_sinv: `SELECT TOP 5000 T0.DocNum, T0.DocDate, T0.DocDueDate, T0.CardCode, T0.CardName, T0.U_PRName, T1.ItemCode, T1.Dscription, T1.Quantity, T1.Price, T1.LineTotal, T1.VatSum, T0.DocTotal, T1.WhsCode, T0.Comments FROM OINV T0 INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= :startDate AND T0.DocDate <= :endDate ORDER BY T0.DocDate DESC`,
  
  sq_v6_scrm: `SELECT TOP 5000 T0.DocNum, T0.DocDate, T0.CardCode, T0.CardName, T1.ItemCode, T1.Dscription, T1.Quantity, T1.Price, T1.LineTotal, T0.DocTotal, T1.WhsCode, T0.Comments FROM ORIN T0 INNER JOIN RIN1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.DocDate >= :startDate AND T0.DocDate <= :endDate ORDER BY T0.DocDate DESC`,
  
  sq_v6_bp: `SELECT TOP 5000 T0.CardCode, T0.CardName, T0.CardType, T0.LicTradNum, T0.Phone1, T0.E_Mail, T0.Balance, T0.CreateDate FROM OCRD T0 WHERE T0.CardType IN ('S', 'C') ORDER BY T0.CardName ASC`
};

const registeredQueriesCache = new Set();
const queryResultsCache = new Map();
const QUERY_CACHE_TTL_MS = 60 * 1000; // 60 segundos de caché en memoria

/**
 * Asegura la creación de una SQLQuery en SAP Service Layer una sola vez.
 */
async function ensureSapQuery(sqlCode, sqlText) {
  if (registeredQueriesCache.has(sqlCode)) {
    return;
  }
  try {
    await sapService.post('/SQLQueries', {
      SqlCode: sqlCode,
      SqlName: sqlCode,
      SqlText: sqlText
    });
    registeredQueriesCache.add(sqlCode);
  } catch (e) {
    try {
      await sapService._request(`/SQLQueries('${sqlCode}')`, 'DELETE', null, { 'Cookie': sapService.sessionCookie });
      await sapService.post('/SQLQueries', {
        SqlCode: sqlCode,
        SqlName: sqlCode,
        SqlText: sqlText
      });
      registeredQueriesCache.add(sqlCode);
    } catch (err) {
      registeredQueriesCache.add(sqlCode);
    }
  }
}

/**
 * Registra todas las SQLQueries estáticas en segundo plano al iniciar
 */
async function initSapQueryBuilderQueries() {
  try {
    await sapService._ensureSession();
    for (const [code, sqlText] of Object.entries(STATIC_SQL_QUERIES)) {
      await ensureSapQuery(code, sqlText);
    }
    console.log('[SAP Query Builder] Consultas parametrizadas estáticas v5 registradas exitosamente.');
  } catch (err) {
    console.warn('[SAP Query Builder] Registro inicial de queries:', err.message);
  }
}

// Ejecutar inicialización no bloqueante
if (process.env.NODE_ENV !== 'test') {
  setTimeout(initSapQueryBuilderQueries, 6000);
}

/**
 * Ejecuta una consulta estática en SAP Service Layer pasando parámetros de fecha.
 * Si SAP devuelve 404 / -2028 (0 registros encontrados), retorna [] de forma silenciosa y segura.
 */
async function executeSapSqlList(sqlCode, queryParams = {}) {
  const sqlText = STATIC_SQL_QUERIES[sqlCode];
  if (sqlText) {
    await ensureSapQuery(sqlCode, sqlText);
  }

  let paramStr = '';
  const entries = Object.entries(queryParams);
  if (entries.length > 0) {
    paramStr = '?' + entries.map(([k, v]) => `${k}='${encodeURIComponent(v)}'`).join('&');
  }

  try {
    const res = await sapService.get(`/SQLQueries('${sqlCode}')/List${paramStr}`, { 'Prefer': 'odata.maxpagesize=5000' });
    return res.data?.value || [];
  } catch (err) {
    const errMsg = (err.message || '').toLowerCase();
    const isNoRecords = err.status === 404 || String(err.code) === '-2028' || errMsg.includes('no matching records') || errMsg.includes('-2028');
    if (isNoRecords) {
      return [];
    }
    throw err;
  }
}

/**
 * Recupera documentos OData paginados de SAP Service Layer siguiendo @odata.nextLink
 * y utilizando Prefer: odata.maxpagesize=500 para máximo rendimiento y volumen completo
 */
async function fetchAllODataDocs(endpoint, filterStr, selectFields = '', maxDocs = 1500) {
  let allDocs = [];
  const selectParam = selectFields ? `&$select=${selectFields}` : '';
  let nextUrl = `${endpoint}?$filter=${filterStr}${selectParam}&$orderby=DocDate desc`;
  
  while (nextUrl && allDocs.length < maxDocs) {
    const cleanUrl = nextUrl.startsWith('/') ? nextUrl : '/' + nextUrl.replace(/^.*\/b1s\/v1\//, '');
    try {
      const res = await sapService.get(cleanUrl, { 'Prefer': 'odata.maxpagesize=500' });
      const batch = res.data?.value || [];
      allDocs.push(...batch);
      nextUrl = res.data['@odata.nextLink'] || res.data['odata.nextLink'];
      if (!nextUrl || batch.length === 0) break;
      // Pausa cooperativa de 35ms para no saturar el Service Layer de otros usuarios concurrentes
      await new Promise(r => setTimeout(r, 35));
    } catch (err) {
      const errMsg = (err.message || '').toLowerCase();
      if (err.status === 404 || errMsg.includes('not found') || errMsg.includes('-2028')) {
        break;
      }
      throw err;
    }
  }
  return allDocs;
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
  estatusDoc,
  clasificacionMedica,
  limit = 10000
}) {
  const entityDef = ENTITY_CATALOG[entity];
  if (!entityDef) {
    throw new Error(`Entidad '${entity}' no reconocida en el catálogo.`);
  }

  // 1. Validar filtro obligatorio de fechas
  if (entityDef.requiresDateFilter) {
    if (!fechaDesde || !fechaHasta) {
      throw new Error(`Para evitar sobrecarga en SAP Service Layer, el módulo '${entityDef.title}' requiere obligatoriamente un rango de fechas (Fecha Desde y Fecha Hasta).`);
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

  // Clave de caché para evitar consultas idénticas concurrentes a SAP
  const fieldsKey = (selectedFields || []).slice().sort().join(',');
  const searchKey = (busqueda || '').trim().toLowerCase();
  const effectiveLimit = ['inventory', 'item_prices', 'item_master_data', 'batches'].includes(entity) ? 10000 : Math.max(limit || 5000, 10000);
  const cacheKey = `${entity}_${fechaDesde || ''}_${fechaHasta || ''}_${almacen || 'ALL'}_${estatusDoc || 'ALL'}_${clasificacionMedica || 'ALL'}_${fieldsKey}_${searchKey}_${effectiveLimit}`;
  const cached = queryResultsCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < QUERY_CACHE_TTL_MS)) {
    let data = cached.data;
    if (busqueda && busqueda.trim()) {
      const q = busqueda.toLowerCase().trim();
      data = data.filter(r => Object.values(r).some(val => val != null && String(val).toLowerCase().includes(q)));
    }
    return {
      ...cached.resultMeta,
      totalRegistros: data.length,
      data
    };
  }

  const dateParams = (fechaDesde && fechaHasta) ? { startDate: fechaDesde, endDate: fechaHasta } : {};

  let rawRows = [];

  // 2. Ejecutar según el módulo seleccionado
  switch (entity) {
    case 'inventory':
    case 'item_prices':
    case 'item_master_data': {
      await sapInventoryService.ensureInventoryData();
      let inv = sapInventoryService.getInventoryCache() || [];
      
      if (almacen && almacen !== 'ALL') {
        inv = inv.filter(i => i.WhsCode === almacen);
      }

      rawRows = inv.map(i => ({
        ...i,
        WhsName: WAREHOUSE_NAMES[i.WhsCode] || i.WhsCode,
        ProfitMargin: Math.round(Number(i.ProfitMargin || 0) * 10) / 10,
        MarginHos: i.PriceHos > 0 && i.PurchaseCost > 0 ? Math.round(((i.PriceHos - i.PurchaseCost) / i.PriceHos) * 1000) / 10 : 0,
        MarginPG: i.PricePG > 0 && i.PurchaseCost > 0 ? Math.round(((i.PricePG - i.PurchaseCost) / i.PricePG) * 1000) / 10 : 0,
        MinStock: Number(i.MinStock || 0),
        MaxStock: Number(i.MaxStock || 0),
        ValidFor: i.ValidFor === 'Y' || i.validFor === 't' ? 'Activo' : 'Inactivo'
      }));
      break;
    }

    case 'batches': {
      await sapInventoryService.ensureInventoryData();
      const allBatches = sapInventoryService.getBatchesCache() || [];
      const now = new Date();

      rawRows = allBatches.map(b => {
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
      const items = await executeSapSqlList('sq_v6_pinv', dateParams);
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
      const items = await executeSapSqlList('sq_v6_por', dateParams);
      rawRows = items.map(p => ({
        ...p,
        DocDate: formatSapDateStr(p.DocDate),
        DocDueDate: formatSapDateStr(p.DocDueDate),
        DocStatus: p.DocStatus === 'O' || p.DocStatus === 'bost_Open' ? 'Abierta' : 'Cerrada',
        Quantity: Number(p.Quantity || 0),
        OpenQty: Number(p.OpenQty || 0),
        Price: Number(p.Price || 0),
        LineTotal: Number(p.LineTotal || 0),
        DocTotal: Number(p.DocTotal || 0)
      }));
      break;
    }

    case 'goods_receipts_po': {
      const items = await executeSapSqlList('sq_v6_grpo', dateParams);
      rawRows = items.map(p => ({
        ...p,
        DocDate: formatSapDateStr(p.DocDate),
        DocDueDate: formatSapDateStr(p.DocDueDate),
        Quantity: Number(p.Quantity || 0),
        Price: Number(p.Price || 0),
        LineTotal: Number(p.LineTotal || 0),
        DocTotal: Number(p.DocTotal || 0)
      }));
      break;
    }

    case 'goods_returns': {
      const items = await executeSapSqlList('sq_v6_gret', dateParams);
      rawRows = items.map(p => ({
        ...p,
        DocDate: formatSapDateStr(p.DocDate),
        Quantity: Number(p.Quantity || 0),
        Price: Number(p.Price || 0),
        LineTotal: Number(p.LineTotal || 0),
        DocTotal: Number(p.DocTotal || 0)
      }));
      break;
    }

    case 'stock_transfers': {
      const filterStr = `DocDate ge '${fechaDesde}' and DocDate le '${fechaHasta}'`;
      const transfers = await fetchAllODataDocs(
        '/StockTransfers',
        filterStr,
        'DocEntry,DocNum,DocDate,FromWarehouse,ToWarehouse,Comments,StockTransferLines',
        1500
      );

      rawRows = [];
      for (const doc of transfers) {
        const lines = doc.StockTransferLines || [{}];
        for (const line of lines) {
          const fromCode = doc.FromWarehouse || line.FromWarehouse || '';
          const toCode = doc.ToWarehouse || line.WarehouseCode || '';
          rawRows.push({
            DocNum: doc.DocNum,
            DocDate: doc.DocDate ? doc.DocDate.slice(0, 10) : '',
            FillerCode: fromCode,
            ToWhsCodeRaw: toCode,
            Filler: WAREHOUSE_NAMES[fromCode] ? `${WAREHOUSE_NAMES[fromCode]} (${fromCode})` : fromCode,
            ToWhsCode: WAREHOUSE_NAMES[toCode] ? `${WAREHOUSE_NAMES[toCode]} (${toCode})` : toCode,
            ItemCode: line.ItemCode,
            Dscription: line.ItemDescription,
            Quantity: Number(line.Quantity || 0),
            Comments: doc.Comments
          });
        }
      }
      break;
    }

    case 'transfer_requests': {
      const filterStr = `DocDate ge '${fechaDesde}' and DocDate le '${fechaHasta}'`;
      const requests = await fetchAllODataDocs(
        '/InventoryTransferRequests',
        filterStr,
        'DocEntry,DocNum,DocDate,DueDate,FromWarehouse,ToWarehouse,DocumentStatus,Comments,StockTransferLines',
        1500
      );

      rawRows = [];
      for (const doc of requests) {
        const lines = doc.StockTransferLines || [{}];
        for (const line of lines) {
          const fromCode = doc.FromWarehouse || line.FromWarehouse || '';
          const toCode = doc.ToWarehouse || line.WarehouseCode || '';
          rawRows.push({
            DocNum: doc.DocNum,
            DocDate: doc.DocDate ? doc.DocDate.slice(0, 10) : '',
            DueDate: doc.DueDate ? doc.DueDate.slice(0, 10) : '',
            FillerCode: fromCode,
            ToWhsCodeRaw: toCode,
            Filler: WAREHOUSE_NAMES[fromCode] ? `${WAREHOUSE_NAMES[fromCode]} (${fromCode})` : fromCode,
            ToWhsCode: WAREHOUSE_NAMES[toCode] ? `${WAREHOUSE_NAMES[toCode]} (${toCode})` : toCode,
            DocStatus: doc.DocumentStatus === 'bost_Open' ? 'Abierta' : 'Cerrada',
            ItemCode: line.ItemCode,
            Dscription: line.ItemDescription,
            Quantity: Number(line.Quantity || 0),
            OpenQty: Number(line.RemainingOpenQuantity || 0),
            Comments: doc.Comments
          });
        }
      }
      break;
    }

    case 'goods_issues': {
      const filterStr = `DocDate ge '${fechaDesde}' and DocDate le '${fechaHasta}'`;
      const exits = await fetchAllODataDocs(
        '/InventoryGenExits',
        filterStr,
        'DocEntry,DocNum,DocDate,Comments,DocumentLines',
        1500
      );

      rawRows = [];
      for (const doc of exits) {
        const lines = doc.DocumentLines || [{}];
        for (const line of lines) {
          rawRows.push({
            DocNum: doc.DocNum,
            DocDate: doc.DocDate ? doc.DocDate.slice(0, 10) : '',
            ItemCode: line.ItemCode,
            Dscription: line.ItemDescription,
            Quantity: Number(line.Quantity || 0),
            Price: Number(line.Price || line.UnitPrice || 0),
            LineTotal: Number(line.LineTotal || (Number(line.Quantity || 0) * Number(line.Price || 0))),
            WhsCode: line.WarehouseCode,
            Comments: doc.Comments
          });
        }
      }
      break;
    }

    case 'goods_receipts_inv': {
      const filterStr = `DocDate ge '${fechaDesde}' and DocDate le '${fechaHasta}'`;
      const entries = await fetchAllODataDocs(
        '/InventoryGenEntries',
        filterStr,
        'DocEntry,DocNum,DocDate,Comments,DocumentLines',
        1500
      );

      rawRows = [];
      for (const doc of entries) {
        const lines = doc.DocumentLines || [{}];
        for (const line of lines) {
          rawRows.push({
            DocNum: doc.DocNum,
            DocDate: doc.DocDate ? doc.DocDate.slice(0, 10) : '',
            ItemCode: line.ItemCode,
            Dscription: line.ItemDescription,
            Quantity: Number(line.Quantity || 0),
            Price: Number(line.Price || line.UnitPrice || 0),
            LineTotal: Number(line.LineTotal || (Number(line.Quantity || 0) * Number(line.Price || 0))),
            WhsCode: line.WarehouseCode,
            Comments: doc.Comments
          });
        }
      }
      break;
    }

    case 'purchase_requests': {
      const items = await executeSapSqlList('sq_v6_prq', dateParams);
      rawRows = items.map(r => ({
        ...r,
        DocDate: formatSapDateStr(r.DocDate),
        ReqDate: formatSapDateStr(r.ReqDate),
        DocStatus: r.DocStatus === 'O' || r.DocStatus === 'bost_Open' ? 'Abierta' : 'Cerrada',
        Quantity: Number(r.Quantity || 0)
      }));
      break;
    }

    case 'sales_invoices': {
      const items = await executeSapSqlList('sq_v6_sinv', dateParams);
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

    case 'credit_memos': {
      const items = await executeSapSqlList('sq_v6_scrm', dateParams);
      rawRows = items.map(p => ({
        ...p,
        DocDate: formatSapDateStr(p.DocDate),
        Quantity: Number(p.Quantity || 0),
        Price: Number(p.Price || 0),
        LineTotal: Number(p.LineTotal || 0),
        DocTotal: Number(p.DocTotal || 0)
      }));
      break;
    }

    case 'business_partners': {
      const items = await executeSapSqlList('sq_v6_bp');
      rawRows = items.map(b => ({
        ...b,
        CardType: b.CardType === 'S' ? 'Proveedor' : 'Cliente',
        Balance: Number(b.Balance || 0),
        CreateDate: formatSapDateStr(b.CreateDate)
      }));
      break;
    }

    default:
      throw new Error(`Módulo '${entity}' no configurado.`);
  }

  // 3. Aplicar filtros en memoria de forma segura (sin descartar entidades que no tienen el campo)
  const hasWhsField = rawRows.length > 0 && ('WhsCode' in rawRows[0] || 'FillerCode' in rawRows[0] || 'Filler' in rawRows[0] || 'ToWhsCode' in rawRows[0]);
  if (almacen && almacen !== 'ALL' && hasWhsField) {
    rawRows = rawRows.filter(r => (
      r.WhsCode === almacen || 
      r.FillerCode === almacen || 
      r.ToWhsCodeRaw === almacen ||
      r.Filler === almacen || 
      r.ToWhsCode === almacen ||
      String(r.Filler || '').includes(`(${almacen})`) ||
      String(r.ToWhsCode || '').includes(`(${almacen})`) ||
      String(r.WhsName || '').includes(`(${almacen})`)
    ));
  }

  const hasStatusField = rawRows.length > 0 && ('DocStatus' in rawRows[0] || 'Status' in rawRows[0]);
  if (estatusDoc && estatusDoc !== 'ALL' && hasStatusField) {
    rawRows = rawRows.filter(r => {
      if (!r.DocStatus && !r.Status) return true;
      const s = String(r.DocStatus || r.Status).toUpperCase();
      if (estatusDoc === 'OPEN') {
        return s.includes('ABIERTA') || s.includes('ACTIVO') || s.includes('PRÓXIMO') || s === 'O' || s === 'OPEN' || s === 'BOST_OPEN' || s === 'Y';
      }
      if (estatusDoc === 'CLOSED') {
        return s.includes('CERRADA') || s.includes('VENCIDO') || s === 'C' || s === 'CLOSED' || s === 'BOST_CLOSE' || s === 'N';
      }
      return true;
    });
  }

  const hasMedClassField = rawRows.length > 0 && ('MedicalClassification' in rawRows[0]);
  if (clasificacionMedica && clasificacionMedica !== 'ALL' && hasMedClassField) {
    rawRows = rawRows.filter(r => {
      const c = String(r.MedicalClassification || '').toUpperCase();
      if (clasificacionMedica === 'CON') return c.includes('CON') || c.includes('CONTROL');
      if (clasificacionMedica === 'ANTI') return c.includes('ANTI') || c.includes('ANTIBIOT');
      if (clasificacionMedica === 'REFRI') return c.includes('REFRI') || c.includes('FRIO');
      return true;
    });
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

  // 4. Calcular KPIs dinámicos de resumen
  let totalImporte = 0;
  let totalPiezas = 0;
  let docAbiertosCount = 0;
  let lotesAlertaCount = 0;

  rawRows.forEach(r => {
    if (r.LineTotal != null) totalImporte += Number(r.LineTotal || 0);
    else if (r.DocTotal != null) totalImporte += Number(r.DocTotal || 0);
    else if (r.Balance != null) totalImporte += Number(r.Balance || 0);

    if (r.Quantity != null) totalPiezas += Number(r.Quantity || 0);
    else if (r.QuantityOnStock != null) totalPiezas += Number(r.QuantityOnStock || 0);

    if (r.DocStatus === 'Abierta' || r.DocStatus === 'O') docAbiertosCount++;
    if (r.Status === 'Vencido' || r.Status === 'Próximo a Vencer') lotesAlertaCount++;
  });

  const kpis = [
    { label: 'Total Registros', value: rawRows.length.toLocaleString('es-MX'), color: '#004687' }
  ];

  if (totalImporte > 0) {
    kpis.push({
      label: 'Importe Total ($)',
      value: `$${Math.round(totalImporte).toLocaleString('es-MX')}`,
      color: '#15803D'
    });
  }

  if (totalPiezas > 0) {
    kpis.push({
      label: 'Piezas / Cantidad Total',
      value: Math.round(totalPiezas).toLocaleString('es-MX'),
      color: '#0088C9'
    });
  }

  if (docAbiertosCount > 0) {
    kpis.push({
      label: 'Documentos Abiertos',
      value: docAbiertosCount.toLocaleString('es-MX'),
      color: '#D97706'
    });
  }

  if (lotesAlertaCount > 0) {
    kpis.push({
      label: 'Lotes en Alerta / Vencidos',
      value: lotesAlertaCount.toLocaleString('es-MX'),
      color: '#DC2626'
    });
  }

  // 5. Definición de columnas activas según selección (o default)
  const activeFields = (selectedFields.length > 0 ? selectedFields : entityDef.defaultFields);
  const activeColsDef = entityDef.fields.filter(f => activeFields.includes(f.key));

  // Preservar todos los campos del registro para que el frontend pueda activar/desactivar columnas al instante
  const projectedData = rawRows.slice(0, effectiveLimit).map(row => {
    return { ...row };
  });

  const finalResult = {
    entity: entityDef.id,
    entityTitle: entityDef.title,
    ejecutadoEn: new Date().toISOString(),
    totalRegistros: projectedData.length,
    kpis,
    columnas: activeColsDef,
    data: projectedData
  };

  // Guardar en caché en memoria por 60 segundos
  queryResultsCache.set(cacheKey, {
    timestamp: Date.now(),
    data: projectedData,
    resultMeta: {
      entity: entityDef.id,
      entityTitle: entityDef.title,
      ejecutadoEn: finalResult.ejecutadoEn,
      kpis,
      columnas: activeColsDef
    }
  });

  return finalResult;
}

/* ══════════════════════════════════════════════════════════════
   GESTIÓN DE CONSULTAS GUARDADAS (PLANTILLAS DE USUARIO)
══════════════════════════════════════════════════════════════ */

async function getSavedQueries(user) {
  const isAdmin = user.role === 'ADMIN' || user.role === 'DIRECTOR' || String(user.username).toLowerCase() === 'amendoza';
  
  let res;
  if (isAdmin) {
    res = await pool.query(`
      SELECT queryid, userid, username, titulo, descripcion, entidad, camposseleccionados, filtrosaplicados, espublico, fechacreacion, fechamodificacion
      FROM usersapqueries
      ORDER BY fechacreacion DESC
    `);
  } else {
    res = await pool.query(`
      SELECT queryid, userid, username, titulo, descripcion, entidad, camposseleccionados, filtrosaplicados, espublico, fechacreacion, fechamodificacion
      FROM usersapqueries
      WHERE username = $1 OR espublico = 1
      ORDER BY fechacreacion DESC
    `, [user.username]);
  }

  return (res.rows || []).map(r => ({
    id: r.queryid,
    userId: r.userid,
    username: r.username,
    title: r.titulo,
    description: r.descripcion,
    entity: r.entidad,
    selectedFields: typeof r.camposseleccionados === 'string' ? JSON.parse(r.camposseleccionados || '[]') : (r.camposseleccionados || []),
    filters: typeof r.filtrosaplicados === 'string' ? JSON.parse(r.filtrosaplicados || '{}') : (r.filtrosaplicados || {}),
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
    INSERT INTO usersapqueries (userid, username, titulo, descripcion, entidad, camposseleccionados, filtrosaplicados, espublico, fechacreacion)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
    RETURNING queryid, titulo, fechacreacion
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
    res = await pool.query(`DELETE FROM usersapqueries WHERE queryid = $1 RETURNING queryid`, [queryId]);
  } else {
    res = await pool.query(`DELETE FROM usersapqueries WHERE queryid = $1 AND username = $2 RETURNING queryid`, [queryId, user.username]);
  }

  if (res.rowCount === 0) {
    throw new Error('No se encontró la consulta o no cuenta con permisos para eliminarla.');
  }

  return { ok: true, queryId };
}

module.exports = {
  getEntityCatalog: () => Object.values(ENTITY_CATALOG),
  getEntityDefinition: (id) => ENTITY_CATALOG[id],
  initSapQueryBuilderQueries,
  executeQuery,
  getSavedQueries,
  saveQuery,
  deleteQuery
};

