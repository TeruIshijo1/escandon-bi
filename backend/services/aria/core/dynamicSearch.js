'use strict';

const { getRemoteDb } = require('../../../config/remote-db');
const { normalizeText } = require('../utils/nlp');
const { hasIAPermission, hasIASectionAccess, buildAccessDeniedResponse } = require('./permissions');
const { getSuggestionsForUser, IA_PERMISSION_CATALOG } = require('../config/intents');
const queryResumenEjecutivoGeneral = require('../handlers/resumen.handler');

const { queryCirugiasDelMomento } = require('../handlers/quirofano.handler');
const { queryTrasladosAlmacen, queryKardexAlmacen } = require('../handlers/almacen.handler');
const { queryRecetasPendientes, queryLibroControlados } = require('../handlers/recetas.handler');

async function searchDatabaseDynamically(userQuery, user = null) {
  try {
    const normalized = normalizeText(userQuery);

    const redirects = [
      { pattern: /cirug|quirofan|operac|procedim/, permission: 'ia-quirofano', sections: ['quirofano', 'quirofano-agenda'], handler: queryCirugiasDelMomento },
      { pattern: /traslad|solicitud.*almacen|envio.*almacen/, permission: 'ia-almacen', sections: ['almacen-traslados'], handler: queryTrasladosAlmacen },
      { pattern: /kardex|trazabilidad/, permission: 'ia-almacen', sections: ['almacen-reportes'], handler: queryKardexAlmacen },
      { pattern: /receta|surtir|despacho/, permission: 'ia-farmacia', sections: ['farmacia-inventario', 'area-farmacia'], handler: queryRecetasPendientes },
      { pattern: /controlado|psicotrop|salida.*farmacia|dispensacion/, permission: 'ia-farmacia', sections: ['farmacia-inventario', 'area-farmacia'], handler: queryLibroControlados },
    ];
    const redirect = redirects.find(item => item.pattern.test(normalized));
    if (redirect) {
      if (!hasIASectionAccess(user, redirect.permission, redirect.sections)) return buildAccessDeniedResponse(redirect.permission, IA_PERMISSION_CATALOG);
      return await redirect.handler(normalized);
    }

    // Palabras de relleno / ruido a ignorar en la extracción de términos
    const FILLER_WORDS = new Set([
      'busca', 'buscar', 'quien', 'como', 'cuanto', 'donde',
      'muestrame', 'dame', 'sobre', 'para', 'este', 'esta', 'estos', 'estas', 'del',
      'los', 'las', 'con', 'por', 'que', 'una', 'uno', 'unos', 'unas', 'doctor',
      'medico', 'paciente', 'insumo', 'servicio', 'gastado', 'consumido', 'precio', 'costo',
      'hospital', 'cuenta', 'registros', 'datos', 'puedes', 'decirme', 'saber', 'ver', 'dime', 'nombre',
      'ultima', 'ultimo', 'reciente', 'recientes', 'consulta', 'consultas', 'atencion',
      'devolucion', 'devoluciones', 'cargo', 'cargos', 'historial', 'expediente', 'momento'
    ]);

    const rawTokens = normalized.split(/\s+/);
    const searchTerms = rawTokens.filter(w => w.length >= 3 && !FILLER_WORDS.has(w));
    const finalTerms = searchTerms.length > 0 ? searchTerms : rawTokens.filter(w => w.length >= 3);

    if (finalTerms.length === 0) {
      return await queryResumenEjecutivoGeneral(user);
    }

    // Verificar permisos IA para la búsqueda dinámica
    const canSearchPatients = hasIAPermission(user, 'ia-busqueda-pacientes');
    const canSearchDoctors = hasIAPermission(user, 'ia-busqueda-medicos');
    const canSearchSupplies = hasIAPermission(user, 'ia-busqueda-insumos');
    const canSearchFinancial = hasIAPermission(user, 'ia-busqueda-financiera');

    if (!canSearchPatients && !canSearchDoctors && !canSearchSupplies && !canSearchFinancial) {
      return buildAccessDeniedResponse('ia-busqueda-pacientes', IA_PERMISSION_CATALOG);
    }

    const pool = await getRemoteDb();

    // Construir columnas de búsqueda según permisos
    const searchColumns = [];
    if (canSearchPatients) searchColumns.push('NOMBRE_DEL_PACIENTE');
    if (canSearchSupplies) {
      searchColumns.push('DESCRIPCION_DEL_ARTICULO');
      searchColumns.push('CODIGO');
      searchColumns.push('GRUPO_DE_ARTICULOS');
    }
    if (canSearchDoctors) searchColumns.push('Medico_Solicitante');
    searchColumns.push('UNIDAD_DE_SERVICIO');

    const whereClauses = finalTerms.map((_, idx) => {
      const colConditions = searchColumns.map(col => `${col} LIKE @kw${idx}`).join(' OR ');
      return `(${colConditions})`;
    }).join(' AND ');

    const request = pool.request();
    finalTerms.forEach((term, idx) => {
      request.input(`kw${idx}`, `%${term}%`);
    });

    const montoExpression = canSearchFinancial
      ? 'ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0))'
      : '0';

    const querySQL = `
      SELECT TOP 25
        NUMERO_DE_ORDEN          AS OrdenId,
        ${canSearchPatients ? 'NOMBRE_DEL_PACIENTE' : 'NULL'} AS Paciente,
        UNIDAD_DE_SERVICIO       AS Area,
        ${canSearchSupplies ? 'DESCRIPCION_DEL_ARTICULO' : 'NULL'} AS Insumo,
        ${canSearchSupplies ? 'CODIGO' : 'NULL'} AS Codigo,
        CANTIDAD                 AS Cantidad,
        ${montoExpression}       AS Monto,
        FECHA_DE_CARGO           AS Fecha,
        ${canSearchDoctors ? 'Medico_Solicitante' : 'NULL'} AS Medico
      FROM UDR_CUENTAS_SERVICIOS
      WHERE ${whereClauses}
      ORDER BY FECHA_DE_CARGO DESC
    `;

    const res = await request.query(querySQL);
    const rows = res.recordset || [];

    if (rows.length === 0) {
      return {
        topic: `Búsqueda: ${userQuery}`,
        answer: `No encontré registros en la base de datos en vivo que coincidan con la búsqueda "**${userQuery}**". Prueba buscando por el apellido del paciente, nombre del médico, descripción del servicio o usando las preguntas sugeridas de Quirófano, Almacén y Farmacia.`,
        suggestions: getSuggestionsForUser(user),
      };
    }

    const isUltimoIntent = /ultim|reciente/.test(normalizeText(userQuery));

    const totalMonto = canSearchFinancial
      ? rows.reduce((acc, r) => acc + Math.abs(parseFloat(r.Monto || 0)), 0)
      : null;
    const totalCantidad = rows.reduce((acc, r) => acc + parseFloat(r.Cantidad || 0), 0);

    let answerText = '';
    if (isUltimoIntent && rows.length > 0) {
      const topRow = rows[0];
      let topFecha = '';
      if (topRow.Fecha) {
        try { topFecha = new Date(topRow.Fecha).toISOString().split('T')[0]; } catch { topFecha = String(topRow.Fecha).slice(0, 10); }
      }
      const medicoText = canSearchDoctors && topRow.Medico ? ` por el **Dr. ${topRow.Medico}**` : '';
      const patientText = canSearchPatients ? ` para el paciente **${topRow.Paciente || 'General'}**` : '';
      const supplyText = canSearchSupplies ? ` con el servicio **"${topRow.Insumo || 'Sin especificar'}"**` : '';
      const montoText = canSearchFinancial
        ? ` por un monto de **$${Math.abs(parseFloat(topRow.Monto || 0)).toLocaleString('es-MX')} MXN**`
        : '';
      answerText = `La **última atención/consulta** registrada para **"${finalTerms.join(' ')}"** fue el **${topFecha}**${medicoText}${patientText} en el área **${topRow.Area}**${supplyText}${montoText}.`;
    } else {
      const montoText = canSearchFinancial
        ? ` acumulando un monto total de **$${totalMonto.toLocaleString('es-MX')} MXN**`
        : '';
      answerText = `Analicé la base de datos en tiempo real para "**${userQuery}**". Encontré **${rows.length} registros en vivo**${montoText} (${totalCantidad} unidades/atenciones).`;
    }

    const kpis = [
      { label: 'Registros Encontrados', value: rows.length },
    ];
    if (canSearchFinancial) {
      kpis.push({ label: 'Monto Total Sumado', value: `$${totalMonto.toLocaleString('es-MX')}`, color: '#16A34A' });
    }
    kpis.push({ label: 'Unidades/Servicios', value: totalCantidad, color: '#004687' });

    const headers = ['Fecha'];
    if (canSearchPatients) headers.push('Paciente');
    headers.push('Área');
    if (canSearchSupplies) headers.push('Insumo / Servicio');
    if (canSearchDoctors) headers.push('Médico');
    if (canSearchFinancial) headers.push('Monto ($)');

    const tableRows = rows.slice(0, 7).map(r => {
      let fechaStr = '';
      if (r.Fecha) {
        try { fechaStr = new Date(r.Fecha).toISOString().split('T')[0]; } catch { fechaStr = String(r.Fecha).slice(0, 10); }
      }
      const row = [fechaStr];
      if (canSearchPatients) row.push(r.Paciente || 'Sin Nombre');
      row.push(r.Area || 'General');
      if (canSearchSupplies) row.push(r.Insumo || 'Servicio');
      if (canSearchDoctors) row.push(r.Medico || 'Sin Asignar');
      if (canSearchFinancial) {
        row.push(`$${Math.abs(parseFloat(r.Monto || 0)).toLocaleString('es-MX')}`);
      }
      return row;
    });

    return {
      topic: `Búsqueda: "${finalTerms.join(', ')}"`,
      answer: answerText,
      kpis,
      table: { headers, rows: tableRows },
    };
  } catch (err) {
    console.error('Error en búsqueda dinámica:', err);
    return {
      topic: 'Búsqueda Dinámica',
      answer: 'No pude consultar la información del hospital en este momento. Intenta de nuevo o elige una pregunta sugerida.',
    };
  }
}

module.exports = searchDatabaseDynamically;
