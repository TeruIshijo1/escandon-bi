'use strict';

const { getRemoteDb } = require('../../../config/remote-db');
const { normalizeText } = require('../utils/nlp');
const { hasIAPermission, buildAccessDeniedResponse } = require('./permissions');
const { getSuggestionsForUser, IA_PERMISSION_CATALOG } = require('../config/intents');
const queryResumenEjecutivoGeneral = require('../handlers/resumen.handler');

async function searchDatabaseDynamically(userQuery, user = null) {
  try {
    const pool = await getRemoteDb();

    // Palabras de relleno / ruido a ignorar en la extracción de términos
    const FILLER_WORDS = new Set([
      'busca', 'buscar', 'quien', 'como', 'cuanto', 'donde',
      'muestrame', 'dame', 'sobre', 'para', 'este', 'esta', 'estos', 'estas', 'del',
      'los', 'las', 'con', 'por', 'que', 'una', 'uno', 'unos', 'unas', 'doctor',
      'medico', 'paciente', 'insumo', 'servicio', 'gastado', 'consumido', 'precio', 'costo',
      'hospital', 'cuenta', 'registros', 'datos', 'puedes', 'decirme', 'saber', 'ver', 'dime', 'nombre',
      'ultima', 'ultimo', 'reciente', 'recientes', 'consulta', 'consultas', 'atencion',
      'devolucion', 'devoluciones', 'cargo', 'cargos', 'historial', 'expediente',
    ]);

    const normalized = normalizeText(userQuery);
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

    // Si el usuario no tiene ningún permiso de búsqueda, denegar
    if (!canSearchPatients && !canSearchDoctors && !canSearchSupplies && !canSearchFinancial) {
      return buildAccessDeniedResponse('ia-busqueda-pacientes', IA_PERMISSION_CATALOG);
    }

    // Construir columnas de búsqueda según permisos
    const searchColumns = [];
    if (canSearchPatients) searchColumns.push('NOMBRE_DEL_PACIENTE');
    if (canSearchSupplies) {
      searchColumns.push('DESCRIPCION_DEL_ARTICULO');
      searchColumns.push('CODIGO');
      searchColumns.push('GRUPO_DE_ARTICULOS');
    }
    if (canSearchDoctors) searchColumns.push('Medico_Solicitante');
    // UNIDAD_DE_SERVICIO es siempre visible (no es dato sensible)
    searchColumns.push('UNIDAD_DE_SERVICIO');

    const whereClauses = finalTerms.map((_, idx) => {
      const colConditions = searchColumns.map(col => `${col} LIKE @kw${idx}`).join(' OR ');
      return `(${colConditions})`;
    }).join(' AND ');

    const request = pool.request();
    finalTerms.forEach((term, idx) => {
      request.input(`kw${idx}`, `%${term}%`);
    });

    // Seleccionar columnas según permisos financieros
    const montoExpression = canSearchFinancial
      ? 'ISNULL(TOTAL_COBRADO, ISNULL(TOTAL_SIN_DESC, 0))'
      : '0';

    const querySQL = `
      SELECT TOP 25
        NUMERO_DE_ORDEN          AS OrdenId,
        NOMBRE_DEL_PACIENTE      AS Paciente,
        UNIDAD_DE_SERVICIO       AS Area,
        DESCRIPCION_DEL_ARTICULO AS Insumo,
        CODIGO                   AS Codigo,
        CANTIDAD                 AS Cantidad,
        ${montoExpression}       AS Monto,
        FECHA_DE_CARGO           AS Fecha,
        Medico_Solicitante       AS Medico
      FROM UDR_CUENTAS_SERVICIOS
      WHERE ${whereClauses}
      ORDER BY FECHA_DE_CARGO DESC
    `;

    const res = await request.query(querySQL);
    const rows = res.recordset || [];

    if (rows.length === 0) {
      return {
        topic: `Búsqueda: ${userQuery}`,
        answer: `No encontré registros en la base de datos en vivo que coincidan con la búsqueda "**${userQuery}**". Prueba buscando por el apellido del paciente, nombre del médico o descripción del servicio.`,
        suggestions: getSuggestionsForUser(user),
      };
    }

    // Detectar intención de "Último / Reciente"
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
        try { topFecha = new Date(topRow.Fecha).toISOString().split('T')[0]; } catch (e) { topFecha = String(topRow.Fecha).slice(0, 10); }
      }
      const medicoName = topRow.Medico ? `el **Dr. ${topRow.Medico}**` : 'el personal de salud';
      const montoText = canSearchFinancial
        ? ` por un monto de **$${Math.abs(parseFloat(topRow.Monto || 0)).toLocaleString('es-MX')} MXN**`
        : '';
      answerText = `La **última atención/consulta** registrada para **"${finalTerms.join(' ')}"** fue el **${topFecha}** por ${medicoName} para el paciente **${topRow.Paciente || 'General'}** en el área **${topRow.Area}** con el servicio **"${topRow.Insumo}"**${montoText}.`;
    } else {
      const montoText = canSearchFinancial
        ? ` acumulando un monto total de **$${totalMonto.toLocaleString('es-MX')} MXN**`
        : '';
      answerText = `Analicé la base de datos en tiempo real para "**${userQuery}**". Encontré **${rows.length} registros en vivo**${montoText} (${totalCantidad} unidades/atenciones).`;
    }

    // KPIs
    const kpis = [
      { label: 'Registros Encontrados', value: rows.length },
    ];
    if (canSearchFinancial) {
      kpis.push({ label: 'Monto Total Sumado', value: `$${totalMonto.toLocaleString('es-MX')}`, color: '#16A34A' });
    }
    kpis.push({ label: 'Unidades/Servicios', value: totalCantidad, color: '#004687' });

    // Tabla — filtrar columnas financieras según permiso
    const headers = ['Fecha', 'Paciente', 'Área', 'Insumo / Servicio', 'Médico'];
    if (canSearchFinancial) headers.push('Monto ($)');

    const tableRows = rows.slice(0, 7).map(r => {
      let fechaStr = '';
      if (r.Fecha) {
        try { fechaStr = new Date(r.Fecha).toISOString().split('T')[0]; } catch (e) { fechaStr = String(r.Fecha).slice(0, 10); }
      }
      const row = [
        fechaStr,
        r.Paciente || 'Sin Nombre',
        r.Area || 'General',
        r.Insumo || 'Servicio',
        r.Medico || 'Sin Asignar',
      ];
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
      answer: 'No se pudo realizar la búsqueda en tiempo real: ' + err.message,
    };
  }
}

module.exports = searchDatabaseDynamically;
