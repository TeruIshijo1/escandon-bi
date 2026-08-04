'use strict';

const etlService = require('../../etl.service');

async function queryAuditoriaInventarios(normalizedQuery) {
  try {
    const estado = normalizedQuery.includes('faltante') ? 'FALTANTE' : normalizedQuery.includes('excedente') ? 'EXCEDENTE' : null;
    const data = await etlService.getInventariosVsCargos({ estado, limit: 100 });
    const res = data.resumen;

    return {
      topic: 'Auditoria de Inventarios y Consumos',
      answer: `Se analizaron **${res.totalPartidas} partidas en vivo** del Hospital Escandón. Se detectaron **${res.diferencias} partidas con discrepancia/faltante** acumulando un monto en disputa de **$${res.montoDisputa.toLocaleString('es-MX')} MXN** (Tasa de Conciliación: **${res.porcentajeConciliado}%**).`,
      kpis: [
        { label: 'Partidas Auditadas', value: res.totalPartidas },
        { label: 'Coinciden', value: res.coincidencias, color: '#16A34A' },
        { label: 'Discrepancias', value: res.diferencias, color: '#DC2626' },
        { label: 'Monto en Disputa', value: `$${res.montoDisputa.toLocaleString('es-MX')}`, color: '#D97706' },
      ],
      table: {
        headers: ['# Orden', 'Paciente', 'Área', 'Insumo', 'Diferencia', 'Estado', 'Monto'],
        rows: data.partidas.filter(p => p.estado !== 'COINCIDE').slice(0, 7).map(p => [
          p.orden,
          p.paciente,
          p.area,
          p.insumo,
          p.diferencia,
          p.estado,
          `$${p.monto.toLocaleString('es-MX')}`,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Auditoría',
      answer: 'Consulta de auditoría de inventarios: ' + err.message,
    };
  }
}

module.exports = queryAuditoriaInventarios;
