'use strict';

const queryCensoCamas = require('./censo.handler');
const etlService = require('../../etl.service');
const { getSuggestionsForUser } = require('../config/intents');

async function queryResumenEjecutivoGeneral(user = null) {
  const censo = await queryCensoCamas();
  const auditoria = await etlService.getInventariosVsCargos({ limit: 50 });
  const resAud = auditoria.resumen;

  // Sugerencias filtradas por perfil IA del usuario
  const suggestions = getSuggestionsForUser(user);

  return {
    topic: 'Resumen Ejecutivo Hospital Escandón',
    answer: `¡Hola! Soy **MAR-IA**, tu copiloto de Inteligencia Analítica. 
    
Hoy en el **Hospital Escandón**:
- **Censo de Camas Físicas**: ${censo.kpis?.find(k => k.label === '% Ocupación')?.value || 'N/A'} de ocupación (${censo.kpis?.find(k => k.label === 'Ocupadas')?.value || 0} ocupadas de ${censo.kpis?.find(k => k.label === 'Total Camas Físicas')?.value || 40} reales).
- **Auditoría de Inventarios**: ${resAud.diferencias} discrepancias pendientes acumulando $${resAud.montoDisputa.toLocaleString('es-MX')} en disputa.
- **Control de Calidad de Datos**: Monitoreo continuo de anomalías pre-facturación y auditoría automática activa.`,
    kpis: [
      { label: 'Ocupación Camas Físicas', value: censo.kpis?.find(k => k.label === '% Ocupación')?.value || '0%' },
      { label: 'Discrepancias Auditadas', value: resAud.diferencias },
      { label: 'Monto en Disputa', value: `$${resAud.montoDisputa.toLocaleString('es-MX')}` },
    ],
    suggestions,
  };
}

module.exports = queryResumenEjecutivoGeneral;
