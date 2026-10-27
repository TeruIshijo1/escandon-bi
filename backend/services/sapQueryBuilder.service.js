

'use strict';

const sapService = require('./sap.service');
const sapConfig = require('../config/sap.config');
const { ensureSapQuery, withSapQuery } = require('./sapQueryRegistration.service');
const sapInventoryService = require('./sapInventory.service');
const { pool } = require('../config/pg-db');
const sapReportCatalog = require('./sapReportCatalog.service');
const verticalReportCatalog = require('./verticalReportCatalog.service');
const assistantComposition = require('./assistantReportComposition.service');
const savedReportAccess = require('./savedReportAccess.service');
const reportAnalysis = require('./reportAnalysis.service');

/* DICCIONARIO DE ENTIDADES Y CAMPOS (LENGUAJE HOSPITALARIO) */
const ENTITY_CATALOG = {
  // INVENTARIOS Y STOCK
  inventory: {
    id: 'inventory',
    title: "Inventario por almacén",
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
      { key: 'QuantityOnStock', label: "Existencias disponibles", type: 'number', width: 110, align: 'center' },
      { key: 'PurchaseCost', label: 'Último Costo Compra ($)', type: 'money', width: 140, align: 'right' },
      { key: 'AvgCost', label: 'Costo Promedio ($)', type: 'money', width: 130, align: 'right' },
      { key: 'PriceHos', label: 'Precio Hospitalización ($)', type: 'money', width: 150, align: 'right' },
      { key: 'PricePG', label: 'Precio Público General ($)', type: 'money', width: 150, align: 'right' },
      { key: 'ProfitMargin', label: 'Margen Teórico (%)', type: 'percent', width: 120, align: 'right' },
      { key: 'ItemGroupName', label: 'Grupo de Artículos', type: 'string', width: 160 },
      { key: 'ManufacturerName', label: 'Laboratorio / Tipo', type: 'string', width: 160 },
      { key: 'MedicalClassification', label: "Tipo de medicamento", type: 'string', width: 150, align: 'center' },
      { key: 'SecondaryClassification', label: "Clasificación adicional", type: 'string', width: 130, align: 'center' }
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

  // COMPRAS Y PROVEEDORES
  purchase_invoices: {
    id: 'purchase_invoices',
    title: 'Facturas de Proveedores (Compras)',
    icon: '🧾',
    category: 'Compras y Proveedores',
    description: "Consulta las facturas de proveedores, los precios de compra, los impuestos y las fechas de registro.",
    requiresDateFilter: true,
    dateFieldLabel: "Fecha de registro",
    defaultFields: ['DocNum', 'DocDate', 'CardName', 'ItemCode', 'Dscription', 'Quantity', 'Price', 'LineTotal', 'DocTotal'],
    fields: [
      { key: 'DocNum', label: 'Folio Factura SAP', type: 'string', width: 120, align: 'center' },
      { key: 'DocDate', label: "Fecha de registro", type: 'date', width: 130, align: 'center' },
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
    description: "Consulta los productos devueltos a proveedores por caducidad, daño o exceso de existencias.",
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

  // MOVIMIENTOS Y ALMACENES
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

  // FACTURACIÓN Y CLIENTES
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

  // CATÁLOGOS MAESTROS
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
      { key: 'MedicalClassification', label: "Tipo de medicamento", type: 'string', width: 160, align: 'center' },
      { key: 'SecondaryClassification', label: "Clasificación adicional", type: 'string', width: 140, align: 'center' },
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

// Conserva los identificadores existentes para las plantillas y permisos
for (const definition of Object.values(ENTITY_CATALOG)) {
  definition.source = 'SAP';
  definition.grain = definition.id === 'inventory' ? 'Una fila por artículo y almacén.'
    : definition.id === 'batches' ? 'Una fila por lote, artículo y almacén.'
    : definition.id === 'business_partners' ? 'Una fila por socio de negocio.'
    : 'Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.';
  definition.filters = [];
  if (definition.fields.some(f => ['WhsCode', 'Filler', 'ToWhsCode'].includes(f.key))) definition.filters.push('almacen');
  if (definition.fields.some(f => ['DocStatus', 'Status'].includes(f.key))) definition.filters.push('estatusDoc');
  if (definition.fields.some(f => f.key === 'MedicalClassification')) definition.filters.push('clasificacionMedica');
}
Object.assign(ENTITY_CATALOG, sapReportCatalog.catalog, verticalReportCatalog.catalog);
const ASSISTANT_CAPABILITIES = assistantComposition.createCatalog(ENTITY_CATALOG);

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

const queryResultsCache = new Map();
const QUERY_CACHE_TTL_MS = 60 * 1000;  

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

async function executeSapSqlList(sqlCode, queryParams = {}) {
  const sqlText = STATIC_SQL_QUERIES[sqlCode];

  let paramStr = '';
  const entries = Object.entries(queryParams);
  if (entries.length > 0) {
    paramStr = '?' + entries.map(([k, v]) => `${k}='${encodeURIComponent(v)}'`).join('&');
  }

  const read = async () => {
    const res = await sapService.get(`/SQLQueries('${sqlCode}')/List${paramStr}`, { 'Prefer': 'odata.maxpagesize=5000' });
    const rows = res.data?.value;
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw Object.assign(new Error('SAP no confirmó una colección válida para el reporte.'), { status: 502, code: 'SAP_PAGE_INVALID' });
    }
    rows.truncated = rows.length >= 5000 || Boolean(res.data?.['@odata.nextLink'] || res.data?.['odata.nextLink']);
    return rows;
  };
  return sqlText ? withSapQuery(sqlCode, sqlText, read) : read();
}

async function fetchAllODataDocs(endpoint, filterStr, selectFields = '', maxDocs = 1500) {
  const allDocs = [], visited = new Set();
  const base = new URL(sapConfig.baseUrl), apiPath = base.pathname.replace(/\/$/, '');
  const selectParam = selectFields ? `&$select=${selectFields}` : '';
  let nextUrl = new URL(`${apiPath}${endpoint}?$filter=${filterStr}${selectParam}&$orderby=DocDate desc`, base.origin);
  const collection = nextUrl.pathname.replace(/^\/b1s\/v[12]/, ''), deadline = Date.now() + 300000;
  let excess = false;
  while (nextUrl && allDocs.length < maxDocs) {
    const identity = new URL(nextUrl); identity.searchParams.sort();
    if (visited.has(identity.href) || visited.size >= 100 || Date.now() >= deadline) throw Object.assign(new Error('SAP no completó una paginación verificable.'), { status: 502, code: 'SAP_PAGE_LIMIT' });
    visited.add(identity.href);
    const res = await sapService.get(nextUrl.pathname + nextUrl.search, { Prefer: 'odata.maxpagesize=500' }, { timeoutMs: Math.min(30000, deadline - Date.now()), allowMissing: false });
    const batch = res.data?.value;
    if (!Array.isArray(batch) || batch.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Object.assign(new Error('SAP no confirmó una colección válida para el reporte.'), { status: 502, code: 'SAP_PAGE_INVALID' });
    for (const row of batch) { if (allDocs.length < maxDocs) allDocs.push(row); else excess = true; }
    const first = res.data['@odata.nextLink'], second = res.data['odata.nextLink'];
    if ([first, second].some(link => link != null && typeof link !== 'string') || (first && second && first !== second)) throw Object.assign(new Error('SAP devolvió una continuación inválida.'), { status: 502, code: 'SAP_PAGE_INVALID' });
    const link = first || second;
    if (!link) { nextUrl = null; continue; }
    const resolved = link.startsWith('/') && !link.startsWith('//') && !/^\/b1s\/v[12](?:\/|$)/.test(link)
      ? new URL(apiPath + link, base.origin) : new URL(link, nextUrl);
    if (resolved.origin !== base.origin || resolved.username || resolved.password || resolved.hash || !/^\/b1s\/v[12]\//.test(resolved.pathname) || resolved.pathname.replace(/^\/b1s\/v[12]/, '') !== collection) throw Object.assign(new Error('La paginación debe permanecer en la misma colección SAP.'), { status: 502, code: 'SAP_PAGE_INVALID' });
    nextUrl = resolved;
  }
  allDocs.truncated = Boolean(nextUrl) || excess;
  return allDocs;
}

async function executeQuery(options = {}) {
  const publicOptions = { ...options };
  delete publicOptions.pointLookup;
  delete publicOptions.searchFields;
  options = publicOptions;
  const definition = getEntityDefinition(options.entity);
  if (!definition || options.analysis == null) return executeDetailedQuery(options);
  const analysis = reportAnalysis.validateAnalysis(definition, options.analysis);
  const selectedFields = options.selectedFields?.length ? options.selectedFields : definition.defaultFields;
  if (!Array.isArray(selectedFields) || selectedFields.some(key => typeof key !== 'string' || !definition.fields.some(field => field.key === key))) {
    throw Object.assign(new Error('La selección de columnas no es válida.'), { status: 400 });
  }
  const limit = Number.isFinite(Number(options.limit)) ? Math.min(10000, Math.max(1, Math.floor(Number(options.limit)))) : 10000;
  const detailOptions = { ...options };
  delete detailOptions.analysis;
  const pointLookup = reportAnalysis.getPointLookup(definition, analysis);
  const result = await executeDetailedQuery({ ...detailOptions, selectedFields: [...new Set([
    ...selectedFields, ...reportAnalysis.requiredAnalysisFields(definition, analysis)
  ])], searchFields: [...new Set(selectedFields)], ...(pointLookup ? { pointLookup } : {}), limit: 10000 });
  return reportAnalysis.applyAnalysis(definition, result, analysis, { selectedFields, limit });
}

async function executeDetailedQuery({
  entity,
  selectedFields = [],
  searchFields,
  pointLookup,
  fechaDesde,
  fechaHasta,
  almacen,
  proveedor,
  busqueda,
  estatusDoc,
  clasificacionMedica,
  limit = 10000
}) {
  const entityDef = typeof entity === 'string' && Object.hasOwn(ENTITY_CATALOG, entity) ? ENTITY_CATALOG[entity]
    : typeof entity === 'string' && Object.hasOwn(ASSISTANT_CAPABILITIES, entity) ? ASSISTANT_CAPABILITIES[entity] : null;
  if (!entityDef) {
    throw new Error(`Entidad '${entity}' no reconocida en el catálogo.`);
  }
  if (entityDef.pointLookupRequired && !pointLookup) {
    throw Object.assign(new Error('Indica el folio exacto de atención para consultar su cuenta, facturas e insumos.'), { status: 400 });
  }

  if (!Array.isArray(selectedFields) || selectedFields.some(key => typeof key !== 'string')) {
    throw new Error('La selección de columnas no es válida.');
  }
  if (searchFields != null && (!Array.isArray(searchFields) || !searchFields.length
    || searchFields.some(key => typeof key !== 'string' || !entityDef.fields.some(field => field.key === key)))) {
    throw new Error('Los campos de búsqueda no son válidos.');
  }
  for (const value of [almacen, proveedor, busqueda, estatusDoc, clasificacionMedica]) {
    if (value != null && typeof value !== 'string') throw new Error('Los filtros deben ser texto.');
  }
  if (estatusDoc && estatusDoc !== 'ALL' && (!entityDef.filters.includes('estatusDoc') || !(entityDef.statusOptions?.map(option => option.value) || ['ALL', 'OPEN', 'CLOSED']).includes(estatusDoc))) throw new Error('El estado elegido no está disponible para este reporte.');
  const isCalendarDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if ((fechaDesde && !isCalendarDate(fechaDesde)) || (fechaHasta && !isCalendarDate(fechaHasta))) {
    throw new Error('El formato de fechas es inválido. Use YYYY-MM-DD y fechas existentes.');
  }
  // Validar filtro obligatorio de fechas
  if (entityDef.requiresDateFilter && (!pointLookup || fechaDesde || fechaHasta)) {
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

    const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
    if (diffDays > 366) {
      throw new Error('El rango de fechas no puede exceder 366 días consecutivos por consulta.');
    }
  }

  const fieldsKey = JSON.stringify([...new Set(selectedFields)]);
  const searchFieldsKey = searchFields == null ? null : JSON.stringify([...new Set(searchFields)]);
  const searchKey = (busqueda || '').trim().toLowerCase();
  const effectiveLimit = Number.isFinite(Number(limit)) ? Math.min(10000, Math.max(1, Math.floor(Number(limit)))) : 10000;
  if (entityDef.assistantOnly) {
    return assistantComposition.execute(entity, { selectedFields, ...(searchFields ? { searchFields } : {}), ...(pointLookup ? { pointLookup } : {}), fechaDesde, fechaHasta, almacen, proveedor, busqueda,
      estatusDoc, clasificacionMedica, limit: effectiveLimit }, ASSISTANT_CAPABILITIES, executeDetailedQuery);
  }
  const cacheKey = JSON.stringify([entity, fechaDesde, fechaHasta, almacen, proveedor, estatusDoc, clasificacionMedica, fieldsKey, searchFieldsKey, searchKey, pointLookup, effectiveLimit]);
  const cached = queryResultsCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < QUERY_CACHE_TTL_MS)) {
    const data = cached.data;
    return {
      ...cached.resultMeta,
      totalRegistros: data.length,
      data
    };
  }

  const dateParams = (fechaDesde && fechaHasta) ? { startDate: fechaDesde, endDate: fechaHasta } : {};

  let rawRows = [];
  let sourceTruncated = false;

  // Ejecutar según el módulo seleccionado
  switch (entity) {
    case 'inventory':
    {
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
      sourceTruncated = items.truncated;
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
      sourceTruncated = items.truncated;
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
      sourceTruncated = items.truncated;
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
      sourceTruncated = items.truncated;
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
      sourceTruncated = transfers.truncated;
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
      sourceTruncated = requests.truncated;
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
      sourceTruncated = exits.truncated;
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
      sourceTruncated = entries.truncated;
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
      sourceTruncated = items.truncated;
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
      sourceTruncated = items.truncated;
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
      sourceTruncated = items.truncated;
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
      sourceTruncated = items.truncated;
      rawRows = items.map(b => ({
        ...b,
        CardType: b.CardType === 'S' ? 'Proveedor' : 'Cliente',
        Balance: Number(b.Balance || 0),
        CreateDate: formatSapDateStr(b.CreateDate)
      }));
      break;
    }

    default: {
      const service = entityDef.source === 'Vertical' ? verticalReportCatalog : sapReportCatalog;
      const result = await service.execute(entity, { fechaDesde, fechaHasta, almacen, proveedor, busqueda,
        estatusDoc, clasificacionMedica, ...(pointLookup ? { pointLookup } : {}), limit: effectiveLimit });
      rawRows = result.rows;
      sourceTruncated = Boolean(result.truncated || result.complete === false || result.analysisScope?.complete === false);
    }
  }

  const hasWhsField = rawRows.length > 0 && ('WhsCode' in rawRows[0] || 'FillerCode' in rawRows[0] || 'Filler' in rawRows[0] || 'ToWhsCode' in rawRows[0]);
  if (almacen && almacen !== 'ALL' && hasWhsField && entityDef.filters.includes('almacen')) {
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
  if (estatusDoc && estatusDoc !== 'ALL' && hasStatusField && entityDef.filters.includes('estatusDoc')) {
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
  if (clasificacionMedica && clasificacionMedica !== 'ALL' && hasMedClassField && entityDef.filters.includes('clasificacionMedica')) {
    rawRows = rawRows.filter(r => {
      const c = `${r.MedicalClassification || ''} ${r.SecondaryClassification || ''}`.toUpperCase();
      if (clasificacionMedica === 'CON') return c.includes('CON') || c.includes('CONTROL');
      if (clasificacionMedica === 'ANTI') return c.includes('ANTI') || c.includes('ANTIBIOT');
      if (clasificacionMedica === 'REFRI') return c.includes('REFRI') || c.includes('FRIO');
      return true;
    });
  }
  if (proveedor && proveedor.trim() && !sapReportCatalog.catalog[entity] && entityDef.source !== 'Vertical') {
    const p = proveedor.toLowerCase().trim();
    rawRows = rawRows.filter(r => 
      String(r.CardName || '').toLowerCase().includes(p) || 
      String(r.CardCode || '').toLowerCase().includes(p)
    );
  }
  if (busqueda && busqueda.trim() && !sapReportCatalog.catalog[entity] && entityDef.source !== 'Vertical') {
    const q = busqueda.toLowerCase().trim();
    rawRows = rawRows.filter(row => {
      return (searchFields ? searchFields.map(key => row[key]) : Object.values(row)).some(val =>
        val != null && String(val).toLowerCase().includes(q)
      );
    });
  }

  const truncated = Boolean(sourceTruncated || rawRows.length > effectiveLimit);
  rawRows = rawRows.slice(0, effectiveLimit);
   
  let totalImporte = 0;
  let totalPiezas = 0;
  let docAbiertosCount = 0;
  const openDocuments = new Set();
  let lotesAlertaCount = 0;

  rawRows.forEach(r => {
    if (entityDef.summary?.amountField) totalImporte += Number(r[entityDef.summary.amountField] || 0);
    else if (!sapReportCatalog.catalog[entity] && entityDef.source !== 'Vertical') {
      if (r.LineTotal != null) totalImporte += Number(r.LineTotal || 0);
      else if (r.Balance != null) totalImporte += Number(r.Balance || 0);
    }
    if (entityDef.summary?.quantityField) totalPiezas += Number(r[entityDef.summary.quantityField] || 0);
    else if (!sapReportCatalog.catalog[entity] && entityDef.source !== 'Vertical') {
      if (r.Quantity != null) totalPiezas += Number(r.Quantity || 0);
      else if (r.QuantityOnStock != null) totalPiezas += Number(r.QuantityOnStock || 0);
    }

    if (r.DocStatus === 'Abierta' || r.DocStatus === 'O') {
      openDocuments.add(r.DocEntry ?? JSON.stringify([r.DocNum, r.DocDate, r.CardCode || r.CardName]));
    }
    if (r.Status === 'Vencido' || r.Status === 'Próximo a Vencer') lotesAlertaCount++;
  });
  docAbiertosCount = openDocuments.size;

  const kpis = [
    { label: 'Total Registros', value: rawRows.length.toLocaleString('es-MX'), color: '#004687' }
  ];

  const currencies = entityDef.summary?.currencyField
    ? [...new Set(rawRows.map(row => row[entityDef.summary.currencyField]).filter(Boolean))] : [];
  const hasIncompleteAmounts = entityDef.summary?.amountField
    && rawRows.some(row => row[entityDef.summary.amountField] == null);
  if (totalImporte !== 0 && currencies.length <= 1 && !hasIncompleteAmounts) {
    kpis.push({
      label: `${entityDef.summary?.amountLabel || 'Importe Total'}${currencies.length ? ` (${currencies[0]})` : ' ($)'}`,
      value: totalImporte.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      color: '#15803D'
    });
  }

  if (totalPiezas !== 0) {
    kpis.push({
      label: entityDef.summary?.quantityLabel || 'Piezas / Cantidad Total',
      value: totalPiezas.toLocaleString('es-MX', { maximumFractionDigits: 4 }),
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

  // Definición de columnas activas según selección (o default)
  const validSelected = [...new Set(selectedFields.filter(key => entityDef.fields.some(field => field.key === key)))];
  const activeFields = validSelected.length ? validSelected : entityDef.defaultFields;
  const activeColsDef = activeFields.map(key => entityDef.fields.find(field => field.key === key));

  const projectedData = rawRows.slice(0, effectiveLimit).map(row => {
    return Object.fromEntries(entityDef.fields.map(field => [field.key, row[field.key] ?? null]));
  });

  const finalResult = {
    entity: entityDef.id,
    entityTitle: entityDef.title,
    ejecutadoEn: new Date().toISOString(),
    totalRegistros: projectedData.length,
    source: entityDef.source,
    grain: entityDef.grain,
    limit: effectiveLimit,
    truncated,
    message: truncated ? 'El reporte alcanzó el límite de consulta. Reduce el periodo o ajusta los filtros para revisar el resto.' : null,
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
      source: finalResult.source,
      grain: finalResult.grain,
      limit: finalResult.limit,
      truncated: finalResult.truncated,
      message: finalResult.message,
      kpis,
      columnas: activeColsDef
    }
  });
  // Evita crecimiento indefinido con periodos y filtros distintos
  while (queryResultsCache.size > 100) queryResultsCache.delete(queryResultsCache.keys().next().value);

  return finalResult;
}

/* GESTIÓN DE CONSULTAS GUARDADAS (PLANTILLAS DE USUARIO) */

function getEntityDefinition(id) {
  const definition = typeof id === 'string' && Object.hasOwn(ENTITY_CATALOG, id) ? ENTITY_CATALOG[id]
    : typeof id === 'string' && Object.hasOwn(ASSISTANT_CAPABILITIES, id) ? ASSISTANT_CAPABILITIES[id] : undefined;
  return definition ? { ...definition, analysisCapabilities: reportAnalysis.getAnalysisCapabilities(definition) } : undefined;
}

async function getSavedQueries(user) {
  return savedReportAccess.getSavedQueries(user, getEntityDefinition);
}

async function saveQuery(user, { title, description, entity, selectedFields, filters, isPublic }) {
  const definition = typeof entity === 'string' && Object.hasOwn(ENTITY_CATALOG, entity) ? ENTITY_CATALOG[entity]
    : typeof entity === 'string' && Object.hasOwn(ASSISTANT_CAPABILITIES, entity) ? ASSISTANT_CAPABILITIES[entity] : null;
  if (typeof title !== 'string' || !title.trim() || !definition) {
    throw new Error('El título y la entidad son obligatorios para guardar la consulta.');
  }
  if (!Array.isArray(selectedFields) || (description != null && typeof description !== 'string')
    || (filters != null && (typeof filters !== 'object' || Array.isArray(filters)))) {
    throw new Error('La configuración del reporte no es válida.');
  }
  const fields = selectedFields.filter(key => definition.fields.some(field => field.key === key));
  const savedFilters = { ...(filters || {}) };
  if (savedFilters.analysis != null) savedFilters.analysis = reportAnalysis.validateAnalysis(definition, savedFilters.analysis);

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
    JSON.stringify(fields.length ? fields : definition.defaultFields),
    JSON.stringify(savedFilters),
    isPublic ? 1 : 0
  ]);

  return { ...res.rows[0], id: res.rows[0].queryid };
}

async function deleteQuery(user, queryId) {
  return savedReportAccess.deleteQuery(user, queryId);
}

module.exports = {
  getEntityCatalog: () => Object.keys(ENTITY_CATALOG).map(getEntityDefinition),
  getAssistantCatalog: () => [...Object.keys(ENTITY_CATALOG), ...Object.keys(ASSISTANT_CAPABILITIES)].map(getEntityDefinition),
  getEntityDefinition,
  initSapQueryBuilderQueries,
  executeQuery,
  getSavedQueries,
  saveQuery,
  deleteQuery,
  canAssignSavedReports: savedReportAccess.canAssign,
  getSavedReportRecipients: savedReportAccess.getRecipients,
  hasAssignedReports: savedReportAccess.hasAssignedReports,
  setSavedReportAssignments: (user, id, userIds) => savedReportAccess.setAssignments(user, id, userIds, getEntityDefinition),
  executeSavedQuery: (user, input) => savedReportAccess.executeSavedQuery(user, input, getEntityDefinition, executeQuery)
};
