'use strict';

const { pool } = require('../../../config/pg-db');
const sapInventoryService = require('../../sapInventory.service');

/**
 * Handler 1: Inventario Exclusivo de Almacén General ('ALG', '01')
 */
async function queryInventarioAlmacenGeneral() {
  try {
    if (sapInventoryService.getInventoryCache().length === 0) {
      try {
        await Promise.race([
          sapInventoryService.syncInventoryCache(),
          new Promise(resolve => setTimeout(resolve, 3000))
        ]);
      } catch (e) {
        console.warn('[Almacén ARIA] SAP sync timeout/error:', e.message);
      }
    }

    const items = sapInventoryService.getInventoryCache().filter(i => i.WhsCode === 'ALG' || i.WhsCode === '01');

    if (items.length === 0) {
      return {
        topic: 'Almacén General: Inventario',
        answer: 'No se encontraron artículos con existencia activa en el Almacén General (ALG / 01).',
      };
    }

    let totalStock = 0;
    let valorTotal = 0;

    items.forEach(i => {
      const qty = Number(i.QuantityOnStock || 0);
      const price = Number(i.SalesPrice || 0);
      totalStock += qty;
      valorTotal += qty * price;
    });

    const sorted = [...items].sort((a, b) => (b.QuantityOnStock || 0) - (a.QuantityOnStock || 0));

    const tableRows = sorted.slice(0, 10).map(i => [
      i.ItemCode || '',
      i.ItemName || 'Articulo',
      i.WhsCode || 'ALG',
      Number(i.QuantityOnStock || 0).toLocaleString('es-MX'),
      `$${Number(i.SalesPrice || 0).toLocaleString('es-MX')}`
    ]);

    return {
      topic: 'Almacén General: Inventario Físico',
      answer: `El **Almacén General (ALG/01)** registra **${items.length} tipos de artículos**, con un total de **${totalStock.toLocaleString('es-MX')} unidades en existencia** y un valor total estimado de **$${Math.round(valorTotal).toLocaleString('es-MX')} MXN**.`,
      kpis: [
        { label: 'Tipos de Artículos', value: items.length, color: '#004687' },
        { label: 'Stock Total (Unidades)', value: totalStock.toLocaleString('es-MX'), color: '#0088C9' },
        { label: 'Valor Estimado', value: `$${Math.round(valorTotal).toLocaleString('es-MX')}`, color: '#16A34A' }
      ],
      table: {
        headers: ['Código', 'Descripción', 'Almacén', 'Stock Actual', 'Precio Unitario'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryInventarioAlmacenGeneral:', err);
    return {
      topic: 'Almacén General: Inventario',
      answer: 'Error al consultar el inventario del Almacén General: ' + err.message
    };
  }
}

/**
 * Handler 2: Solicitudes de Traslado de Almacén
 */
async function queryTrasladosAlmacen() {
  try {
    const pgRes = await pool.query(`
      SELECT 
        docnum AS "DocNum", docdate AS "DocDate", fromwarehouse AS "FromWarehouse", towarehouse AS "ToWarehouse", documentstatus AS "DocumentStatus", comments AS "Comments", requestername AS "RequesterName"
      FROM dw_sap_traslados
      ORDER BY docentry DESC
      LIMIT 15
    `);
    const rows = pgRes.rows;

    if (!rows || rows.length === 0) {
      return {
        topic: 'Almacén General: Traslados',
        answer: 'No hay registros de solicitudes de traslado en la base de datos local.',
      };
    }

    let cerrados = 0;
    let abiertos = 0;

    const tableRows = rows.map(r => {
      let fechaStr = r.DocDate ? new Date(r.DocDate).toISOString().slice(0, 10) : 'N/A';
      const status = String(r.DocumentStatus || 'bost_Open');
      const isClosed = status.toLowerCase().includes('close');

      if (isClosed) cerrados++;
      else abiertos++;

      return [
        r.DocNum || 'S/N',
        fechaStr,
        r.FromWarehouse || 'Almacén General',
        r.ToWarehouse || 'Servicio Hospitalario',
        r.RequesterName || 'Sistema',
        r.Comments || 'Traslado de insumos',
        isClosed ? 'COMPLETADO' : 'PENDIENTE'
      ];
    });

    return {
      topic: 'Almacén General: Solicitudes de Traslado',
      answer: `Se consultaron las últimas **${rows.length} solicitudes de traslado** registradas entre Almacén General y las sub-farmacias / servicios del hospital:`,
      kpis: [
        { label: 'Traslados Consultados', value: rows.length, color: '#004687' },
        { label: 'Completados / Cerrados', value: cerrados, color: '#16A34A' },
        { label: 'Pendientes / Abiertos', value: abiertos, color: '#DC2626' }
      ],
      table: {
        headers: ['Folio / DocNum', 'Fecha', 'Almacén Origen', 'Almacén Destino', 'Solicitante', 'Observaciones', 'Estado'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryTrasladosAlmacen:', err);
    return {
      topic: 'Almacén General: Traslados',
      answer: 'No se pudo consultar el historial de traslados: ' + err.message
    };
  }
}

/**
 * Handler 3: Entradas de Almacén / Facturas de Proveedores
 */
async function queryEntradasAlmacen() {
  try {
    const pgRes = await pool.query(`
      SELECT 
        fecha AS "Fecha", numeroentrada AS "NumeroEntrada", numerofactura AS "NumeroFactura", nombreproveedor AS "NombreProveedor",
        COUNT(DISTINCT codigo) AS "TiposArticulos",
        SUM(cantidadarticulos) AS "CantidadTotal",
        SUM(importefactura) AS "ImporteTotal"
      FROM dw_sap_entradas
      GROUP BY numeroentrada, numerofactura, nombreproveedor, fecha
      ORDER BY fecha DESC
      LIMIT 10
    `);
    const rows = pgRes.rows;

    if (!rows || rows.length === 0) {
      return {
        topic: 'Almacén General: Entradas',
        answer: 'No hay entradas de almacén registradas recientemente.',
      };
    }

    let sumaMonto = 0;
    let sumaCant = 0;

    const tableRows = rows.map(r => {
      const monto = Number(r.ImporteTotal || 0);
      const cant = Number(r.CantidadTotal || 0);
      sumaMonto += monto;
      sumaCant += cant;

      return [
        r.Fecha ? new Date(r.Fecha).toISOString().slice(0, 10) : 'N/A',
        r.NumeroEntrada || 'S/N',
        r.NumeroFactura || 'S/N',
        r.NombreProveedor || 'Proveedor',
        cant.toLocaleString('es-MX'),
        `$${monto.toLocaleString('es-MX')}`
      ];
    });

    return {
      topic: 'Almacén General: Entradas de Mercancía / Proveedores',
      answer: `Se registran **${rows.length} recepciones de facturas de compra** recientes en el Almacén General por un importe acumulado de **$${Math.round(sumaMonto).toLocaleString('es-MX')} MXN**:`,
      kpis: [
        { label: 'Entradas Registradas', value: rows.length, color: '#004687' },
        { label: 'Artículos Recibidos', value: sumaCant.toLocaleString('es-MX'), color: '#0088C9' },
        { label: 'Monto Total Facturado', value: `$${Math.round(sumaMonto).toLocaleString('es-MX')}`, color: '#16A34A' }
      ],
      table: {
        headers: ['Fecha', 'Nº Entrada', 'Nº Factura', 'Proveedor', 'Cantidad Recibida', 'Importe Factura'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryEntradasAlmacen:', err);
    return {
      topic: 'Almacén General: Entradas',
      answer: 'Error al consultar las entradas de mercancía: ' + err.message
    };
  }
}

/**
 * Handler 4: Kardex de Almacén
 */
async function queryKardexAlmacen() {
  try {
    const pgRes = await pool.query(`
      SELECT 
        codigo AS "Codigo", descripcion AS "Descripcion", almacenorigen AS "AlmacenOrigen", almacendestino AS "AlmacenDestino", documentoref AS "DocumentoRef", existencias AS "Existencias", fecha AS "Fecha", servicio AS "Servicio", usuario AS "Usuario", movimiento AS "Movimiento", valoracumulado AS "ValorAcumulado"
      FROM dw_sap_kardex
      ORDER BY fecha DESC
      LIMIT 15
    `);
    const rows = pgRes.rows;

    if (!rows || rows.length === 0) {
      return {
        topic: 'Almacén General: Kardex',
        answer: 'No hay movimientos registrados en el Kardex de inventario.',
      };
    }

    const tableRows = rows.map(r => [
      r.Fecha ? new Date(r.Fecha).toISOString().slice(0, 16).replace('T', ' ') : 'N/A',
      r.Codigo || '',
      r.Descripcion || 'Movimiento',
      r.AlmacenOrigen || 'Origen',
      r.AlmacenDestino || 'Destino',
      Number(r.Movimiento || 0).toLocaleString('es-MX'),
      r.DocumentoRef || ''
    ]);

    return {
      topic: 'Kardex de Inventario Unificado',
      answer: `El Kardex unificado de Almacén reporta los **últimos ${rows.length} movimientos de entradas, traslados y salidas a servicio**:`,
      kpis: [
        { label: 'Movimientos Recientes', value: rows.length, color: '#004687' },
      ],
      table: {
        headers: ['Fecha y Hora', 'Código', 'Insumo / Concepto', 'Origen', 'Destino', 'Piezas Movidas', 'Documento Ref'],
        rows: tableRows
      }
    };
  } catch (err) {
    console.error('Error en queryKardexAlmacen:', err);
    return {
      topic: 'Kardex de Almacén',
      answer: 'No se pudo consultar el Kardex de inventario: ' + err.message
    };
  }
}

module.exports = {
  queryInventarioAlmacenGeneral,
  queryTrasladosAlmacen,
  queryEntradasAlmacen,
  queryKardexAlmacen
};
