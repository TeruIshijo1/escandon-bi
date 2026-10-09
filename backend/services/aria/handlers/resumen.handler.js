'use strict';

const queryCensoCamas = require('./censo.handler');
const etlService = require('../../etl.service');
const { getSuggestionsForUser } = require('../config/intents');
const { hasIASectionAccess } = require('../core/permissions');

async function queryResumenEjecutivoGeneral(user = null) {
  const suggestions = getSuggestionsForUser(user);
  const canSeeCensus = hasIASectionAccess(user, 'ia-ocupacion-camas', 'dashboard-ocupacion');
  const canSeeAudit = hasIASectionAccess(user, 'ia-auditoria-inventarios', 'auditoria-inventarios');
  const canSeeFinancial = hasIASectionAccess(user, 'ia-busqueda-financiera', 'dashboard-directivo');
  const blocks = [];
  const kpis = [];

  const [censusResult, auditResult] = await Promise.allSettled([
    canSeeCensus ? queryCensoCamas() : Promise.resolve(null),
    canSeeAudit ? etlService.getInventariosVsCargos({ limit: 50 }) : Promise.resolve(null),
  ]);
  if (canSeeCensus) {
    const censusKpis = censusResult.status === 'fulfilled' ? censusResult.value?.kpis || [] : [];
    const occupancy = censusKpis.find(kpi => kpi.label === '% Ocupación')?.value;
    const occupied = censusKpis.find(kpi => kpi.label === 'Ocupadas')?.value;
    const total = censusKpis.find(kpi => kpi.label === 'Total Camas Físicas')?.value;
    if (occupancy != null && occupied != null && total != null) {
      blocks.push(`- **Censo de Camas Físicas**: ${occupancy} de ocupación (${occupied} ocupadas de ${total} camas).`);
      kpis.push({ label: 'Ocupación Camas Físicas', value: occupancy });
    } else {
      blocks.push('- No pude consultar la ocupación de camas en este momento. Intenta de nuevo.');
    }
  }
  if (canSeeAudit) {
    const audit = auditResult.status === 'fulfilled' ? auditResult.value?.resumen : null;
    if (audit && audit.diferencias != null && Number.isFinite(Number(audit.diferencias))) {
      const amount = canSeeFinancial && audit.montoDisputa != null && Number.isFinite(Number(audit.montoDisputa)) ? Number(audit.montoDisputa) : null;
      blocks.push(`- **Auditoría de Inventarios**: ${Number(audit.diferencias)} discrepancias pendientes${amount != null ? ` acumulando $${amount.toLocaleString('es-MX')} en disputa` : ''}.`);
      kpis.push({ label: 'Discrepancias Auditadas', value: Number(audit.diferencias) });
      if (amount != null) kpis.push({ label: 'Monto en Disputa', value: `$${amount.toLocaleString('es-MX')}` });
    } else {
      blocks.push('- No pude consultar la auditoría de inventarios en este momento. Intenta de nuevo.');
    }
  }

  return {
    topic: 'Resumen Ejecutivo Hospital Escandón',
    answer: `¡Hola! Soy **MAR-IA**, tu copiloto de Inteligencia Analítica.\n\n${blocks.length ? `Información disponible para tu perfil:\n${blocks.join('\n')}` : 'Puedo ayudarte con los temas habilitados para tu perfil. Elige una pregunta sugerida o solicita acceso al área de Sistemas si necesitas otro tema.'}`,
    kpis,
    suggestions,
  };
}

module.exports = queryResumenEjecutivoGeneral;
