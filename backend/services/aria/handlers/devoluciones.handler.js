'use strict';

const etlService = require('../../etl.service');

async function queryDevolucionesFarmacia(normalizedQuery) {
  try {
    let fecha = null;
    if (normalizedQuery.includes('hoy')) {
      // Usar fecha local
      fecha = new Date().toLocaleDateString('en-GB'); // Formato DD/MM/YYYY que parsea etl.service.js
    }
    
    const data = await etlService.getDevolucionesFarmacia(fecha, fecha);
    const res = data.resumen;

    if (!res || res.totalPartidas === 0) {
      return {
        topic: 'Devoluciones de Farmacia',
        answer: fecha 
          ? `No encontré ninguna devolución procesada en Farmacia el día de hoy.`
          : `No encontré devoluciones procesadas en el histórico reciente.`,
      };
    }

    return {
      topic: 'Devoluciones de Farmacia',
      answer: fecha 
        ? `Al día de hoy, se han procesado **${res.totalPartidas} devoluciones** en Farmacia, sumando **${res.totalArticulos} artículos físicos** retornados al inventario, equivalentes a **$${res.montoTotalDevuelto.toLocaleString('es-MX')} MXN**.`
        : `En el histórico, se han procesado **${res.totalPartidas} devoluciones** en Farmacia, sumando **${res.totalArticulos} artículos físicos** retornados, equivalentes a **$${res.montoTotalDevuelto.toLocaleString('es-MX')} MXN**.`,
      kpis: [
        { label: 'Total Devoluciones', value: res.totalPartidas },
        { label: 'Artículos Físicos', value: res.totalArticulos, color: '#D97706' },
        { label: 'Monto a Favor', value: `$${res.montoTotalDevuelto.toLocaleString('es-MX')}`, color: '#16A34A' },
      ],
      table: {
        headers: ['Orden', 'Paciente', 'Insumo', 'Devuelto', 'Lote', 'Estado'],
        rows: data.data.slice(0, 10).map(p => [
          p.Orden,
          p.Paciente || 'N/A',
          p.Insumo,
          p.CantidadDevuelta,
          p.Lote || 'N/A',
          p.EstadoLinea || p.Estado,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Farmacia',
      answer: 'Error al consultar devoluciones de farmacia: ' + err.message,
    };
  }
}

module.exports = queryDevolucionesFarmacia;
