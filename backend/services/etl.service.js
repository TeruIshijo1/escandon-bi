/**
 * etl.service.js
 * Servicio ETL para Auditoría: Inventarios vs Cargos de Enfermería
 * Hospital Escandón BI Platform v1.0
 *
 * Proceso ETL Real desde SQL Server KH_HE (UDR_CUENTAS_SERVICIOS)
 */
const { getDb } = require('../config/db');
const { getRemoteDb, sql } = require('../config/remote-db');
const sapInventoryService = require('./sapInventory.service');
const sapService = require('./sap.service');

/* ══════════════════════════════════════════════════════════════
   ENDPOINT PRINCIPAL — /api/audit/inventarios-vs-cargos
   Devuelve datos reales de conciliación cruzando la base KH_HE
══════════════════════════════════════════════════════════════ */

  async function getDevolucionesFarmacia(fechaDesde, fechaHasta) {
    try {
      const pool = await getRemoteDb();
      let querySQL = `
        WITH STLG AS
        (
            SELECT
                S.ControllerKey,
                S.Status,
                S.UserName,
                S.[Date],
                ROW_NUMBER() OVER
                (
                    PARTITION BY S.ControllerKey, S.Status
                    ORDER BY S.[Date] DESC, S.STNum DESC
                ) AS RN
            FROM dbo.V_STLG S
            WHERE S.ControllerName = N'PCPR'
              AND S.Status IN (N'OP', N'CM', N'PR')
        ),
        DevolucionesFarmacia AS (
            SELECT
                PCPR.PCPRNum AS Orden,
                PC.PCNum AS Cuenta,
                PT.FullName AS Paciente,
                VFR.FRName AS Cama,
                PCPRIT.ItemCode AS Codigo,
                VIT.ItemDescription AS Insumo,
                PCIT.Quantity AS CantidadDevuelta,
                PCPRIT.Quantity AS CantidadOriginal,
                PCIT.UnitPrice AS PrecioUnitario,
                PCIT.UnitPrice * PCIT.Quantity AS Monto,
                (PCPRIT.Quantity - PCIT.Quantity) * PCIT.UnitPrice AS MontoCobrado,
                PCPR.CreatedBy AS UsuarioDevuelve,
                PCIT.CreatedOn AS CreatedOn, -- Used for filtering
                PCIT.CreatedOn AS FechaDevolucion,
                
                -- Extra fields from user query
                CASE PCPR.PCPR_ST
                    WHEN 'CM' THEN 'CONFIRMADO'
                    WHEN 'DR' THEN 'BORRADOR'
                    WHEN 'OP' THEN 'ABIERTO'
                    WHEN 'PR' THEN 'PROCESADA'
                    ELSE 'CANCELADO'
                END AS Estado,
                
                CASE PCIT.PCIT_ST
                    WHEN 'RT' THEN 'DEVUELTO'
                    WHEN 'CH' THEN 'CARGADO'
                    WHEN 'RR' THEN 'SOLICITUD DEVOLUCION'
                    ELSE 'PENDIENTE'
                END AS EstadoLinea,
                
                PR.FullName AS Medico,
                
                SP.Status   AS EProcesa,
                SP.UserName AS UsuarioProceso,
                SA.Status   AS EAbierto,
                SA.UserName AS UAbierto,
                SC.Status   AS EConfirma,
                SC.UserName AS UConfirma,

                SP.[Date] AS FechaProceso,
                PCPRBT.BatchCode AS Lote,
                PCPRBT.ExpirationDate AS Caducidad,
                PC.BirthDate AS FechaNacimiento,
                (PCIT.UnitPrice * PCIT.Quantity) * (ISNULL((
                    SELECT TOP 1 TX.TaxRate 
                    FROM dbo.CERP_TX TX
                    WHERE TX.TaxCode = (
                        SELECT TOP 1 A.TaxCodeSales 
                        FROM dbo.V_ITPR A 
                        WHERE A.ItemCode = PCPRIT.ItemCode
                    )
                ), 0) / 100.0) AS IVA,
                (PCIT.UnitPrice * PCIT.Quantity) * ((ISNULL((
                    SELECT TOP 1 TX.TaxRate 
                    FROM dbo.CERP_TX TX
                    WHERE TX.TaxCode = (
                        SELECT TOP 1 A.TaxCodeSales 
                        FROM dbo.V_ITPR A 
                        WHERE A.ItemCode = PCPRIT.ItemCode
                    )
                ), 0) / 100.0) + 1) AS TotalLinea
            FROM dbo.PCIT PCIT
            INNER JOIN dbo.PCPRIT PCPRIT ON PCIT.PCPRITNum = PCPRIT.PCPRITNum AND PCIT.ItemCode  = PCPRIT.ItemCode
            INNER JOIN dbo.PCPR PCPR ON PCPRIT.PCPRNum = PCPR.PCPRNum
            INNER JOIN dbo.PC PC ON PCPR.PCNum = PC.PCNum
            INNER JOIN dbo.PT PT ON PC.PTNum = PT.PTNum
            INNER JOIN dbo.PR PR ON PCPR.PR_PC = PR.PRNum
            LEFT JOIN dbo.PCPRBT PCPRBT ON PCPRBT.PCPRNum = PCPR.PCPRNum AND PCPRBT.PCPRITNum = PCPRIT.PCPRITNum
            LEFT JOIN dbo.V_IT VIT ON PCPRIT.ItemCode = VIT.ItemCode
            LEFT JOIN dbo.PCBL PCBL ON PCPRIT.PCPRITNum = PCBL.PCPRITNum
            LEFT JOIN dbo.V_FR VFR ON PCBL.FRCode = VFR.FRCode
            LEFT JOIN STLG SA ON SA.ControllerKey = PCPR.PCPRNum AND SA.Status = N'OP' AND SA.RN = 1
            LEFT JOIN STLG SC ON SC.ControllerKey = PCPR.PCPRNum AND SC.Status = N'CM' AND SC.RN = 1
            LEFT JOIN STLG SP ON SP.ControllerKey = PCPR.PCPRNum AND SP.Status = N'PR' AND SP.RN = 1
            WHERE PCIT.PCIT_ST IN (N'RT', N'RR')
        )
        SELECT *
        FROM DevolucionesFarmacia
        WHERE 1=1
      `;
      const request = pool.request();

      const parseDateStr = (dateStr, isEndOfDay) => {
        if (dateStr.includes('/')) {
          const parts = dateStr.split('/');
          if (parts.length === 3) {
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}T${isEndOfDay ? '23:59:59' : '00:00:00'}`;
          }
        }
        return `${dateStr}T${isEndOfDay ? '23:59:59' : '00:00:00'}`;
      };

      if (fechaDesde) {
        const dateDesdeStr = parseDateStr(fechaDesde, false);
        const dateDesde = new Date(dateDesdeStr);
        if (!isNaN(dateDesde.getTime()) && dateDesde.getFullYear() >= 1753) {
          querySQL += ` AND CreatedOn >= @fechaDesde`;
          request.input('fechaDesde', sql.DateTime, dateDesde);
        }
      }
      if (fechaHasta) {
        const dateHastaStr = parseDateStr(fechaHasta, true);
        const dateHasta = new Date(dateHastaStr);
        if (!isNaN(dateHasta.getTime()) && dateHasta.getFullYear() >= 1753) {
          querySQL += ` AND CreatedOn <= @fechaHasta`;
          request.input('fechaHasta', sql.DateTime, dateHasta);
        }
      }

      // Si no hay filtro de fechas, limitamos los resultados para evitar colapsar la memoria y la BD
      if (!fechaDesde && !fechaHasta) {
        querySQL = querySQL.replace("SELECT *", "SELECT TOP 3000 *");
      }

      querySQL += ` ORDER BY CreatedOn DESC`;

      const result = await request.query(querySQL);
      
      const resumen = {
        totalPartidas: result.recordset.length,
        totalArticulos: result.recordset.reduce((acc, curr) => acc + (curr.CantidadDevuelta || 0), 0),
        montoTotalDevuelto: result.recordset.reduce((acc, curr) => acc + (curr.Monto || 0), 0)
      };

      return {
        data: result.recordset,
        resumen
      };
    } catch (error) {
      console.error('[ETL getDevolucionesFarmacia Error]', error);
      throw error;
    }
  }

async function getInventariosVsCargos({ area, estado, fechaDesde, fechaHasta, limit = 5000 }) {
  const db = getDb();
  let pool;
  try {
    pool = await getRemoteDb();
  } catch (err) {
    throw new Error('No se pudo conectar a la base de datos KH_HE: ' + err.message);
  }

  const request = pool.request();
  request.input('limit', sql.Int, limit);

  let querySQL = `
    WITH SalidasFarmacia AS (
      SELECT PCPR.PCPRNum AS PCPRNum, PCPRIT.ItemCode AS ItemCode, ISNULL(SUM(PCPRIT.Quantity), 0) AS TotalSalidaFisica
      FROM dbo.PCIT PCIT
      INNER JOIN dbo.PCPRIT PCPRIT ON PCIT.PCPRITNum = PCPRIT.PCPRITNum AND PCIT.ItemCode = PCPRIT.ItemCode
      INNER JOIN dbo.PCPR PCPR ON PCPRIT.PCPRNum = PCPR.PCPRNum
      WHERE PCIT.PCIT_ST = N'CH'
      GROUP BY PCPR.PCPRNum, PCPRIT.ItemCode
    ),
    DevolucionesFarmacia AS (
      SELECT PCPR.PCPRNum AS PCPRNum, PCPRIT.ItemCode AS ItemCode, ISNULL(SUM(PCPRIT.Quantity), 0) AS TotalDevolucionFisica
      FROM dbo.PCIT PCIT
      INNER JOIN dbo.PCPRIT PCPRIT ON PCIT.PCPRITNum = PCPRIT.PCPRITNum AND PCIT.ItemCode = PCPRIT.ItemCode
      INNER JOIN dbo.PCPR PCPR ON PCPRIT.PCPRNum = PCPR.PCPRNum
      WHERE PCIT.PCIT_ST IN (N'RT', N'RR')
      GROUP BY PCPR.PCPRNum, PCPRIT.ItemCode
    )
    SELECT TOP (@limit)
      c.NUMERO_DE_ORDEN              AS OrdenId,
      c.FOLIO_DE_ATENCION            AS FolioAtencion,
      c.NOMBRE_DEL_PACIENTE          AS NombrePaciente,
      c.UNIDAD_DE_SERVICIO           AS AreaHospitalaria,
      c.GRUPO_DE_ARTICULOS           AS Categoria,
      c.DESCRIPCION_DEL_ARTICULO     AS Insumo,
      c.CODIGO                       AS CodigoBarras,
      c.PRECIO_UNITARIO              AS PrecioUnitario,
      c.CANTIDAD                     AS CantAlmacen,
      (c.CANTIDAD - ISNULL(c.DEVUELTO, 0)) AS CantCargo,
      ISNULL(c.DEVUELTO, 0)          AS Devuelto,
      ISNULL(c.TOTAL_COBRADO, ISNULL(c.TOTAL_SIN_DESC, 0)) AS Monto,
      ISNULL(c.DESCUENTO, 0)         AS Descuento,
      c.ESTATUS_DEVOLUCION           AS EstatusDevolucion,
      c.FECHA_DE_DEVOLUCION          AS FechaDevolucion,
      c.FECHA_DE_CARGO               AS Fecha,
      c.Medico_Solicitante           AS EnfermeraReceptora,
      c.Medico_Tratante              AS MedicoTratante,
      ISNULL(s.TotalSalidaFisica, 0) AS SalidaFisica,
      ISNULL(d.TotalDevolucionFisica, 0) AS DevolucionFisica
    FROM UDR_CUENTAS_SERVICIOS c
    LEFT JOIN SalidasFarmacia s ON c.NUMERO_DE_ORDEN = s.PCPRNum AND c.CODIGO = s.ItemCode
    LEFT JOIN DevolucionesFarmacia d ON c.NUMERO_DE_ORDEN = d.PCPRNum AND c.CODIGO = d.ItemCode
    WHERE 1=1
  `;

  if (area) {
    querySQL += ` AND c.UNIDAD_DE_SERVICIO LIKE @area`;
    request.input('area', sql.VarChar, `%${area}%`);
  }
  const parseDateStr = (dateStr, isEndOfDay) => {
    // Si viene como DD/MM/YYYY, convertirlo a YYYY-MM-DD
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3 && parts[2].length === 4) {
        dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }
    return new Date(`${dateStr}T${isEndOfDay ? '23:59:59' : '00:00:00'}`);
  };

  if (fechaDesde) {
    querySQL += ` AND c.FECHA_DE_CARGO >= @fechaDesde`;
    request.input('fechaDesde', sql.DateTime, parseDateStr(fechaDesde, false));
  }
  if (fechaHasta) {
    querySQL += ` AND c.FECHA_DE_CARGO <= @fechaHasta`;
    request.input('fechaHasta', sql.DateTime, parseDateStr(fechaHasta, true));
  }

  querySQL += ` ORDER BY c.FECHA_DE_CARGO DESC`;

  const result = await request.query(querySQL);
  const rows = result.recordset || [];

  // Mapear registros reales de la base KH_HE
  const partidas = rows.map(r => {
    const cantSolicitada = r.CantAlmacen ?? 0; // CANTIDAD (Financiero)
    const devuelto = parseFloat(r.Devuelto || 0); // DEVUELTO (Financiero)
    const cantCargo = r.CantCargo ?? 0; // TOTAL (Consumo real financiero)
    
    // Movimientos físicos
    const salidaFisica = parseFloat(r.SalidaFisica || 0);
    const devolucionFisica = parseFloat(r.DevolucionFisica || 0);
    const fisicoNeto = salidaFisica - devolucionFisica;
    
    const baseMonto = Math.abs(parseFloat(r.Monto || 0));
    const monto = cantSolicitada > 0 ? (baseMonto / cantSolicitada) * Math.max(0, cantCargo) : baseMonto;

    // Lógica de Auditoría Nivel 2
    let estadoConciliacion = 'CONSUMO TOTAL';
    if (fisicoNeto > cantCargo) {
        estadoConciliacion = 'FALTANTE / NO COBRADO';
    } else if (cantCargo > fisicoNeto && cantCargo > 0) {
        estadoConciliacion = 'SOBRECARGO / NO SURTIDO';
    } else if (devuelto > 0) {
        estadoConciliacion = (cantCargo <= 0) ? 'DEVUELTO TOTAL' : 'DEVUELTO PARCIAL';
    }

    let fechaStr = '';
    if (r.Fecha) {
      try {
        fechaStr = new Date(r.Fecha).toISOString().split('T')[0];
      } catch (e) {
        fechaStr = String(r.Fecha).slice(0, 10);
      }
    }

    let fechaDevStr = 'N/A';
    if (r.FechaDevolucion) {
      try {
        fechaDevStr = new Date(r.FechaDevolucion).toISOString().split('T')[0];
      } catch (e) {
        fechaDevStr = String(r.FechaDevolucion).slice(0, 10);
      }
    }

    return {
      orden: 'ORD-' + (r.OrdenId || '000'),
      folio: r.FolioAtencion || 'N/A',
      paciente: r.NombrePaciente || 'PACIENTE NO REGISTRADO',
      area: r.AreaHospitalaria || 'GENERAL',
      categoria: r.Categoria || 'GENERAL',
      insumo: r.Insumo || 'PRODUCTO SIN DESCRIPCION',
      codigo: r.CodigoBarras || 'N/A',
      precioUnitario: parseFloat(r.PrecioUnitario || 0),
      cantSolicitada,
      cantCargo,
      devuelto,
      salidaFisica,
      devolucionFisica,
      fisicoNeto,
      monto,
      descuento: parseFloat(r.Descuento || 0),
      estado: estadoConciliacion,
      estatusDevolucion: r.EstatusDevolucion || 'N/A',
      fechaDevolucion: fechaDevStr,
      medicoTratante: r.MedicoTratante || 'NO ESPECIFICADO',
      enfermera: r.EnfermeraReceptora || 'PERSONAL NO ASIGNADO',
      fecha: fechaStr,
    };
  });

  // Filtro por estado
  const filtradas = estado
    ? partidas.filter(p => p.estado === estado)
    : partidas;

  // Métricas de resumen reales
  const resumen = calcularResumen(filtradas);

  return {
    generadoEn: new Date().toISOString(),
    totalRegistros: filtradas.length,
    resumen,
    partidas: filtradas,
  };
}

/* ── Cálculo de métricas ─────────────────────────────────── */
function calcularResumen(partidas) {
  const totales = {
    totalPartidas:  partidas.length,
    articulosSolicitados: 0,
    articulosDevueltos: 0,
    articulosConsumidos: 0,
    montoCobrado: 0,
    coincidencias: 0,
    diferencias: 0,
    montoDisputa: 0,
    montoFuga: 0, // Nuevo: Monto no cobrado
    porcentajeConciliado: 0
  };

  for (const p of partidas) {
    totales.articulosSolicitados += p.salidaFisica; // Usar el dato físico para resumen
    totales.articulosDevueltos += p.devolucionFisica;
    totales.articulosConsumidos += p.cantCargo;
    totales.montoCobrado += p.monto;

    // Lógica para detectar diferencias / faltantes Nivel 2
    if (p.estado === 'FALTANTE / NO COBRADO') {
        totales.diferencias++;
        // Fuga = Diferencia entre lo que salió y lo que se cobró, multiplicado por el precio.
        let diff = p.fisicoNeto - p.cantCargo;
        totales.montoFuga += (p.precioUnitario > 0 ? p.precioUnitario * diff : 0);
        totales.montoDisputa += (p.precioUnitario > 0 ? p.precioUnitario * diff : 0);
    } else if (p.estado === 'SOBRECARGO / NO SURTIDO') {
        totales.diferencias++;
        let diff = p.cantCargo - p.fisicoNeto;
        totales.montoDisputa += (p.precioUnitario > 0 ? p.precioUnitario * diff : 0);
    } else if (p.devuelto > 0 && p.estado.includes('DEVUELTO')) {
        // Asumimos que los devueltos parciales financieros requieren revisión normal
        totales.diferencias++;
        totales.montoDisputa += (p.precioUnitario > 0 ? p.precioUnitario * p.devuelto : Math.abs(p.monto));
    } else {
        totales.coincidencias++;
    }
  }

  totales.montoCobrado = Math.round(totales.montoCobrado * 100) / 100;
  totales.montoDisputa = Math.round(totales.montoDisputa * 100) / 100;
  totales.montoFuga = Math.round(totales.montoFuga * 100) / 100;
  totales.porcentajeConciliado = totales.totalPartidas > 0 ? Math.round((totales.coincidencias / totales.totalPartidas) * 100) : 100;

  return totales;
}



/* ══════════════════════════════════════════════════════════════
   SERVICIO AUXILIAR — KPIs de Productividad (para Dashboard)
══════════════════════════════════════════════════════════════ */
async function getKPIsProductividad({ area } = {}) {
  const db = getDb();
  let sql = `
    SELECT
      COUNT(DISTINCT e.EgresoId)                                                      AS TotalEgresos,
      AVG(CAST(julianday(e.FechaEgreso) - julianday(a.FechaIngreso) AS INTEGER))      AS EstanciaPromedioHospDias,
      ROUND(
        CAST(COUNT(DISTINCT a.AdmisionId) AS REAL) * 100.0 /
        MAX((SELECT COUNT(*) FROM Camas WHERE (? IS NULL OR Area = ?)), 1)
      , 1)                                                                             AS OcupacionPorcentaje,
      ROUND(
        CAST(COUNT(DISTINCT e.EgresoId) AS REAL) /
        MAX((SELECT COUNT(*) FROM Camas WHERE (? IS NULL OR Area = ?)), 1)
      , 2)                                                                             AS RotacionCamas
    FROM Egresos e
    JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
    WHERE e.FechaEgreso >= datetime('now', '-1 month')
      AND (? IS NULL OR e.AreaEgreso = ?)
  `;

  const areaParam = area || null;
  const row = db.prepare(sql).get(areaParam, areaParam, areaParam, areaParam, areaParam, areaParam);

  return {
    totalEgresos:     row?.TotalEgresos || 0,
    estanciaPromedio: row?.EstanciaPromedioHospDias || 0,
    ocupacion:        row?.OcupacionPorcentaje || 0,
    rotacionCamas:    row?.RotacionCamas || 0,
  };
}

/* ── Tasa de Mortalidad ──────────────────────────────────── */
async function getTasaMortalidad({ periodo = 'mes' } = {}) {
  const db = getDb();
  const dias = periodo === 'semana' ? 7 : periodo === 'año' ? 365 : 30;

  const row = db.prepare(`
    SELECT
      COUNT(*) AS TotalEgresos,
      SUM(CASE WHEN e.TipoEgreso = 'DEFUNCION' THEN 1 ELSE 0 END) AS Defunciones,
      ROUND(
        CAST(SUM(CASE WHEN e.TipoEgreso = 'DEFUNCION' THEN 1 ELSE 0 END) AS REAL)
        * 100.0 / MAX(COUNT(*), 1)
      , 2) AS TasaMortalidad
    FROM Egresos e
    WHERE e.FechaEgreso >= datetime('now', '-' || ? || ' days')
  `).get(dias);

  return {
    periodo,
    totalEgresos: row?.TotalEgresos  || 0,
    defunciones:  row?.Defunciones   || 0,
    tasa:         row?.TasaMortalidad || 0,
  };
}

async function getCargosFarmaciaSAP({ area, fechaDesde, fechaHasta, limit = 5000 }) {
  let pool;
  try {
    pool = await getRemoteDb();
  } catch (err) {
    throw new Error('No se pudo conectar a la base de datos KH_HE: ' + err.message);
  }

  const request = pool.request();
  request.input('limit', sql.Int, limit);

  let querySQL = `
    SELECT TOP (@limit)
        PCPR.PCPRNum AS OrdenId,
        PC.PCNum AS Cuenta,
        PT.FullName AS NombrePaciente,
        ISNULL(VFR.FRName, 'NO ESPECIFICADA') AS AreaHospitalaria,
        PCPRIT.ItemCode AS Codigo,
        ISNULL(VIT.ItemDescription, PCIT.ItemCode) AS Insumo,
        PCIT.Quantity AS CantidadCargada,
        PCIT.UnitPrice AS PrecioUnitario,
        (PCIT.UnitPrice * PCIT.Quantity) AS MontoCobrado,
        PCPRBT.BatchCode AS Lote,
        PCPRBT.ExpirationDate AS Caducidad,
        PCIT.CreatedOn AS FechaCargo,
        PCPR.CreatedBy AS UsuarioCargo,
        PR.FullName AS MedicoTratante
    FROM dbo.PCIT PCIT
    INNER JOIN dbo.PCPRIT PCPRIT ON PCIT.PCPRITNum = PCPRIT.PCPRITNum AND PCIT.ItemCode = PCPRIT.ItemCode
    INNER JOIN dbo.PCPR PCPR ON PCPRIT.PCPRNum = PCPR.PCPRNum
    INNER JOIN dbo.PC PC ON PCPR.PCNum = PC.PCNum
    INNER JOIN dbo.PT PT ON PC.PTNum = PT.PTNum
    LEFT JOIN dbo.PR PR ON PCPR.PR_PC = PR.PRNum
    LEFT JOIN dbo.PCPRBT PCPRBT ON PCPRBT.PCPRNum = PCPR.PCPRNum AND PCPRBT.PCPRITNum = PCPRIT.PCPRITNum
    LEFT JOIN dbo.V_IT VIT ON PCPRIT.ItemCode = VIT.ItemCode
    LEFT JOIN dbo.PCBL PCBL ON PCPRIT.PCPRITNum = PCBL.PCPRITNum
    LEFT JOIN dbo.V_FR VFR ON PCBL.FRCode = VFR.FRCode
    WHERE PCIT.PCIT_ST = N'CH'
  `;

  const parseDateStr = (dateStr, isEndOfDay) => {
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3 && parts[2].length === 4) {
        dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }
    return new Date(`${dateStr}T${isEndOfDay ? '23:59:59' : '00:00:00'}`);
  };

  if (fechaDesde) {
    querySQL += ` AND PCIT.CreatedOn >= @fechaDesde`;
    request.input('fechaDesde', sql.DateTime, parseDateStr(fechaDesde, false));
  }
  if (fechaHasta) {
    querySQL += ` AND PCIT.CreatedOn <= @fechaHasta`;
    request.input('fechaHasta', sql.DateTime, parseDateStr(fechaHasta, true));
  }

  if (area) {
    querySQL += ` AND VFR.FRName LIKE @area`;
    request.input('area', sql.VarChar, `%${area}%`);
  }

  querySQL += ` ORDER BY PCIT.CreatedOn DESC`;

  const result = await request.query(querySQL);
  let records = result.recordset || [];

  // Enriquecer con caducidad/lotes de SAP (cruzando Vertical y SAP)
  try {
    const sapInventoryService = require('./sapInventory.service');
    await sapInventoryService.syncInventoryCache();
    const sapBatches = sapInventoryService.getBatchesCache() || [];

    records = records.map(row => {
      let lote = row.Lote;
      let caducidad = row.Caducidad;

      if (!lote || !caducidad) {
        const itemBatches = sapBatches.filter(b => b.ItemCode === row.Codigo);
        
        if (itemBatches.length > 0) {
          if (lote) {
            // Tenemos lote de Vertical, buscar su caducidad exacta en SAP
            const exactBatch = itemBatches.find(b => b.Batch === lote);
            if (exactBatch && exactBatch.ExpirationDate) {
              caducidad = new Date(exactBatch.ExpirationDate);
            } else {
              // El lote de Vertical NO está en SAP, aplicar FIFO
              const fifoBatch = itemBatches.sort((a, b) => new Date(a.ExpirationDate) - new Date(b.ExpirationDate))[0];
              if (fifoBatch) {
                lote = `${fifoBatch.Batch} (Auto-asignado SAP)`;
                caducidad = new Date(fifoBatch.ExpirationDate);
              } else {
                lote = `${lote} (No en SAP)`;
              }
            }
          } else {
            // No hay lote en Vertical, tomar el FIFO de SAP
            const fifoBatch = itemBatches.sort((a, b) => new Date(a.ExpirationDate) - new Date(b.ExpirationDate))[0];
            if (fifoBatch) {
              lote = `${fifoBatch.Batch} (Auto-asignado SAP)`;
              caducidad = new Date(fifoBatch.ExpirationDate);
            }
          }
        }
      }

      return {
        ...row,
        Lote: lote,
        Caducidad: caducidad
      };
    });
  } catch (err) {
    console.error('[ETL Service] Error al enriquecer Cargos con lotes de SAP:', err.message);
  }

  return records;
}

async function getMasterOutputs({ fechaDesde, fechaHasta, almacen, limit = 5000 }) {
  let pool;
  try {
    pool = await getRemoteDb();
  } catch (err) {
    throw new Error('No se pudo conectar a la base de datos KH_HE: ' + err.message);
  }

  const request = pool.request();
  request.input('limit', sql.Int, limit);

  const parseDateStr = (dateStr, isEndOfDay) => {
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3 && parts[2].length === 4) {
        dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }
    return new Date(`${dateStr}T${isEndOfDay ? '23:59:59' : '00:00:00'}`);
  };

  let sqlCond = '';
  if (fechaDesde) {
    sqlCond += ` AND PCIT.CreatedOn >= @fechaDesde`;
    request.input('fechaDesde', sql.DateTime, parseDateStr(fechaDesde, false));
  }
  if (fechaHasta) {
    sqlCond += ` AND PCIT.CreatedOn <= @fechaHasta`;
    request.input('fechaHasta', sql.DateTime, parseDateStr(fechaHasta, true));
  }

  // Por ahora, como no tenemos las tablas de POS y Traspasos confirmadas,
  // extraeremos los Cargos de Hospitalización y dejaremos la estructura preparada.
  const querySQL = `
    SELECT TOP (@limit)
        'Hospitalización' AS TipoMovimiento,
        PCPR.PCPRNum AS Folio,
        PT.FullName AS Referencia,
        ISNULL(VFR.FRName, 'NO ESPECIFICADA') AS AreaDestino,
        PCPRIT.ItemCode AS Codigo,
        ISNULL(VIT.ItemDescription, PCIT.ItemCode) AS Insumo,
        PCIT.Quantity AS Cantidad,
        PCIT.UnitPrice AS PrecioUnitario,
        (PCIT.UnitPrice * PCIT.Quantity) AS MontoTotal,
        PCPRBT.BatchCode AS Lote,
        PCPRBT.ExpirationDate AS Caducidad,
        PCIT.CreatedOn AS FechaMovimiento
    FROM dbo.PCIT PCIT
    INNER JOIN dbo.PCPRIT PCPRIT ON PCIT.PCPRITNum = PCPRIT.PCPRITNum AND PCIT.ItemCode = PCPRIT.ItemCode
    INNER JOIN dbo.PCPR PCPR ON PCPRIT.PCPRNum = PCPR.PCPRNum
    INNER JOIN dbo.PC PC ON PCPR.PCNum = PC.PCNum
    INNER JOIN dbo.PT PT ON PC.PTNum = PT.PTNum
    LEFT JOIN dbo.PCPRBT PCPRBT ON PCPRBT.PCPRNum = PCPR.PCPRNum AND PCPRBT.PCPRITNum = PCPRIT.PCPRITNum
    LEFT JOIN dbo.V_IT VIT ON PCPRIT.ItemCode = VIT.ItemCode
    LEFT JOIN dbo.PCBL PCBL ON PCPRIT.PCPRITNum = PCBL.PCPRITNum
    LEFT JOIN dbo.V_FR VFR ON PCBL.FRCode = VFR.FRCode
    WHERE PCIT.PCIT_ST = N'CH'
    ${sqlCond}
    ORDER BY PCIT.CreatedOn DESC
  `;

  const querySQL_POS = `
    SELECT TOP (@limit)
        'Punto de Venta (POS)' AS TipoMovimiento,
        T0.SONum AS Folio,
        ISNULL(PT.FullName, 'PUNTO DE VENTA') AS Referencia,
        T0.SUCode AS AreaDestino,
        T1.ItemCode AS Codigo,
        ISNULL(VIT.ItemDescription, T1.ItemCode) AS Insumo,
        T1.Quantity AS Cantidad,
        T1.UnitPrice AS PrecioUnitario,
        (T1.UnitPrice * T1.Quantity) AS MontoTotal,
        T1.BatchCode AS Lote,
        NULL AS Caducidad,
        T0.CreatedOn AS FechaMovimiento
    FROM dbo.SO T0
    INNER JOIN dbo.SOLN T1 ON T0.SONum = T1.SONum
    LEFT JOIN dbo.PT PT ON T0.PTNum = PT.PTNum
    LEFT JOIN dbo.V_IT VIT ON T1.ItemCode = VIT.ItemCode
    WHERE T1.ItemCode NOT LIKE 'SER%'
    ${sqlCond.replace(/PCIT\./g, 'T0.')}
    ORDER BY T0.CreatedOn DESC
  `;

  const resultCH = await request.query(querySQL);
  const resultPOS = await request.query(querySQL_POS);
  let records = [...(resultCH.recordset || []), ...(resultPOS.recordset || [])];

  // Obtener Transferencias (Traspasos) desde SAP Service Layer
  try {
    await sapService._ensureSession();
    let sapFilter = "";
    if (fechaDesde && fechaHasta) {
      const fd = parseDateStr(fechaDesde, false).toISOString().split('T')[0];
      const fh = parseDateStr(fechaHasta, true).toISOString().split('T')[0];
      sapFilter = `&$filter=DocDate ge '${fd}' and DocDate le '${fh}'`;
    }
    const endpoint = `/StockTransfers?$select=DocNum,DocDate,CardCode,CardName,StockTransferLines${sapFilter}`;
    const transfersRes = await sapService._request(endpoint, 'GET', null, { 'Cookie': sapService.sessionCookie });
    
    if (transfersRes && transfersRes.data && transfersRes.data.value) {
      let sapTransfers = [];
      transfersRes.data.value.forEach(t => {
        if (t.StockTransferLines) {
          t.StockTransferLines.forEach(line => {
            let lote = null;
            if (line.BatchNumbers && line.BatchNumbers.length > 0) {
              lote = line.BatchNumbers[0].BatchNumber;
            }
            sapTransfers.push({
              TipoMovimiento: 'Traspaso de Stock',
              Folio: t.DocNum,
              Referencia: t.CardName || 'Traspaso Interno',
              AreaDestino: line.WarehouseCode || 'NO ESPECIFICADA',
              Codigo: line.ItemCode,
              Insumo: line.ItemDescription || line.ItemCode,
              Cantidad: line.Quantity,
              PrecioUnitario: line.Price || 0,
              MontoTotal: (line.Price || 0) * line.Quantity,
              Lote: lote,
              Caducidad: null,
              FechaMovimiento: new Date(t.DocDate)
            });
          });
        }
      });
      records = records.concat(sapTransfers);
      
      // Ordenar todo nuevamente por FechaMovimiento descendente
      records.sort((a, b) => b.FechaMovimiento - a.FechaMovimiento);
    }
  } catch (err) {
    console.error('[ETL Service] Error al obtener traspasos de SAP SL:', err.message);
  }

  // Enriquecer con caducidad/lotes de SAP para garantizar que esté respaldado
  try {
    await sapInventoryService.syncInventoryCache();
    const sapBatches = sapInventoryService.getBatchesCache() || [];

    records = records.map(row => {
      let lote = row.Lote;
      let caducidad = row.Caducidad;

      if (!lote || !caducidad) {
        // Si no hay lote en Cirrus, buscar el lote más antiguo (FIFO) de este ItemCode en SAP
        // O si hay lote pero no hay caducidad, buscar esa caducidad.
        const itemBatches = sapBatches.filter(b => b.ItemCode === row.Codigo);
        
        if (itemBatches.length > 0) {
          if (lote) {
            // Tenemos lote, buscar su caducidad en SAP
            const exactBatch = itemBatches.find(b => b.Batch === lote);
            if (exactBatch && exactBatch.ExpirationDate) {
              caducidad = new Date(exactBatch.ExpirationDate);
            } else {
              // El lote de Vertical NO está en SAP, aplicar FIFO
              const fifoBatch = itemBatches.sort((a, b) => new Date(a.ExpirationDate) - new Date(b.ExpirationDate))[0];
              if (fifoBatch) {
                lote = `${fifoBatch.Batch} (Auto-asignado SAP)`;
                caducidad = new Date(fifoBatch.ExpirationDate);
              } else {
                lote = `${lote} (No en SAP)`;
              }
            }
          } else {
            // No tenemos lote (ej. enfermería no lo registró), tomar el más próximo a caducar (FIFO)
            const fifoBatch = itemBatches.sort((a, b) => new Date(a.ExpirationDate) - new Date(b.ExpirationDate))[0];
            if (fifoBatch) {
              lote = `${fifoBatch.Batch} (Auto-asignado SAP)`;
              caducidad = new Date(fifoBatch.ExpirationDate);
            }
          }
        }
      }

      return {
        ...row,
        Lote: lote,
        Caducidad: caducidad
      };
    });
  } catch (err) {
    console.error('[ETL Service] Error al enriquecer con lotes de SAP:', err.message);
  }

  return records;
}

module.exports = {
  getDevolucionesFarmacia,
  getInventariosVsCargos,
  getKPIsProductividad,
  getTasaMortalidad,
  getCargosFarmaciaSAP,
  getMasterOutputs,
};
