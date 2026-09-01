/**
 * auditMovement.service.js
 * Servicio de Auditoría: Movimientos de Pacientes (Cargos y Reversas con Costos y Unidades de Servicio)
 * Hospital Escandón BI Platform v4.0
 */
'use strict';

const { getRemoteDb, sql } = require('../config/remote-db');
const sapInventoryService = require('./sapInventory.service');

function parseUserComment(comment, username) {
  if (!comment) return { name: username || 'No especificado', dept: '' };
  const parts = String(comment).split(/[-–—]/).map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return { name: username || 'No especificado', dept: '' };
  
  let name = parts[0];
  let dept = parts.length > 1 ? parts[1] : '';
  
  if (name === name.toUpperCase() && name.length > 3) {
    name = name.toLowerCase().replace(/(^|\s)\S/g, l => l.toUpperCase());
  }
  
  return { name, dept };
}

function parseDateStr(dateStr, isEndOfDay) {
  if (!dateStr) return null;
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3 && parts[2].length === 4) {
      dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }
  return new Date(`${dateStr}T${isEndOfDay ? '23:59:59' : '00:00:00'}`);
}

/**
 * Obtiene los movimientos de cuenta de pacientes (cargos y reversas) cruzados con costos de SAP.
 */
async function getMovimientosPaciente({
  fechaDesde,
  fechaHasta,
  tipoMovimiento, // 'TODOS' | 'CARGO' | 'REVERSA'
  unidadServicio,
  busqueda,
  limit = 5000
} = {}) {
  let pool;
  try {
    pool = await getRemoteDb();
  } catch (err) {
    throw new Error('No se pudo conectar a la base de datos KH_HE: ' + err.message);
  }

  const request = pool.request();
  request.input('limit', sql.Int, limit);

  let querySQL = `
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
    SELECT TOP (@limit)
      PCPR.PCPRNum AS OrdenId,
      PC.PCNum AS Cuenta,
      PC.PCType AS TipoCuenta,
      PT.FullName AS Paciente,
      PCIT.PCIT_ST AS StatusCodigo,
      CASE PCIT.PCIT_ST
        WHEN 'CH' THEN 'CARGO'
        WHEN 'RT' THEN 'REVERSA'
        WHEN 'RR' THEN 'SOLICITUD REVERSA'
        ELSE 'OTRO'
      END AS TipoMovimiento,
      CASE PCIT.PCIT_ST
        WHEN 'CH' THEN 'CARGADO'
        WHEN 'RT' THEN 'DEVUELTO / REVERSADO'
        WHEN 'RR' THEN 'SOLICITUD DEVOLUCIÓN'
        ELSE PCIT.PCIT_ST
      END AS EstadoLinea,
      PCPRIT.ItemCode AS Codigo,
      ISNULL(VIT.ItemDescription, PCPRIT.ItemCode) AS Insumo,
      VIT.ItemGroupCode AS GrupoArticulo,
      PCIT.Quantity AS Cantidad,
      PCIT.UnitPrice AS PrecioVentaUnitario,
      (PCIT.UnitPrice * PCIT.Quantity) AS PrecioVentaTotal,
      PCPRBT.BatchCode AS Lote,
      PCPRBT.ExpirationDate AS Caducidad,
      PCIT.CreatedOn AS FechaMovimiento,
      
      -- Unidad de Servicio & Almacén
      PCIT.SUCode AS CodigoUnidadServicio,
      ISNULL(SU_CARGO.SUName, 
        CASE 
          WHEN PCIT.FromWarehouseCode = 'QXCR' THEN 'CARRO ROJO (QXCR)'
          WHEN PCIT.FromWarehouseCode = 'QX' THEN 'QUIRÓFANO (QX)'
          WHEN PCIT.FromWarehouseCode = 'FAR' THEN 'FARMACIA CENTRAL'
          ELSE ISNULL(PCIT.SUCode, PCIT.FromWarehouseCode)
        END
      ) AS UnidadServicio,
      PCIT.FromWarehouseCode AS AlmacenOrigen,
      
      -- Destino
      ISNULL(VFR.FRName, ISNULL(CURR_FR.FRName, 'NO ESPECIFICADA')) AS AreaDestino,
      PCBL.FRCode AS CodigoCama,
      
      -- Usuarios & Médicos
      PCIT.CreatedBy AS UsuarioLogin,
      U_CARGO.comment AS CommentUsuarioCargo,
      PCPR.CreatedBy AS UsuarioSolicitaLogin,
      U_SOLICITA.comment AS CommentUsuarioSolicita,
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
    LEFT JOIN dbo.SU SU_CARGO ON PCIT.SUCode = SU_CARGO.SUCode
    LEFT JOIN dbo.Users U_CARGO ON PCIT.CreatedBy = U_CARGO.userName
    LEFT JOIN dbo.Users U_SOLICITA ON PCPR.CreatedBy = U_SOLICITA.userName
    OUTER APPLY (
      SELECT TOP 1 FR.FRName 
      FROM dbo.PCFR PCFR
      INNER JOIN dbo.V_FR FR ON PCFR.FRCode = FR.FRCode
      WHERE PCFR.PCNum = PC.PCNum 
      ORDER BY PCFR.EntryDate DESC
    ) CURR_FR
    WHERE 1=1
  `;

  // Filtro de estado / tipo de movimiento
  if (tipoMovimiento === 'CARGO') {
    querySQL += ` AND PCIT.PCIT_ST = 'CH'`;
  } else if (tipoMovimiento === 'REVERSA') {
    querySQL += ` AND PCIT.PCIT_ST IN ('RT', 'RR')`;
  } else {
    querySQL += ` AND PCIT.PCIT_ST IN ('CH', 'RT', 'RR')`;
  }

  // Filtro de fechas
  if (fechaDesde) {
    const dDesde = parseDateStr(fechaDesde, false);
    if (dDesde && !isNaN(dDesde.getTime())) {
      querySQL += ` AND PCIT.CreatedOn >= @fechaDesde`;
      request.input('fechaDesde', sql.DateTime, dDesde);
    }
  }
  if (fechaHasta) {
    const dHasta = parseDateStr(fechaHasta, true);
    if (dHasta && !isNaN(dHasta.getTime())) {
      querySQL += ` AND PCIT.CreatedOn <= @fechaHasta`;
      request.input('fechaHasta', sql.DateTime, dHasta);
    }
  }

  // Filtro de Unidad de Servicio
  if (unidadServicio && unidadServicio !== 'TODAS') {
    querySQL += ` AND (SU_CARGO.SUName LIKE @unidad OR PCIT.SUCode LIKE @unidad OR PCIT.FromWarehouseCode LIKE @unidad)`;
    request.input('unidad', sql.VarChar, `%${unidadServicio}%`);
  }

  // Filtro de búsqueda general
  if (busqueda && busqueda.trim()) {
    querySQL += ` AND (
      PT.FullName LIKE @busqueda OR 
      PC.PCNum LIKE @busqueda OR 
      PCPRIT.ItemCode LIKE @busqueda OR 
      VIT.ItemDescription LIKE @busqueda
    )`;
    request.input('busqueda', sql.VarChar, `%${busqueda.trim()}%`);
  }

  querySQL += ` ORDER BY PCIT.CreatedOn DESC`;

  const result = await request.query(querySQL);
  let rawRows = result.recordset || [];

  // Obtener catálogo de costos y lotes de SAP B1
  let sapInventoryMap = new Map();
  let sapBatches = [];
  try {
    await sapInventoryService.ensureInventoryData();
    sapInventoryMap = sapInventoryService.getInventoryMap() || new Map();
    sapBatches = sapInventoryService.getBatchesCache() || [];
  } catch (sapErr) {
    console.warn('[Audit Movements] Advertencia al sincronizar inventario SAP:', sapErr.message);
  }

  // Mapear filas y enriquecer con costos y usuarios
  const movimientos = rawRows.map(row => {
    const userCargoInfo = parseUserComment(row.CommentUsuarioCargo, row.UsuarioLogin);
    const userSolicitaInfo = parseUserComment(row.CommentUsuarioSolicita, row.UsuarioSolicitaLogin);

    const sapItem = sapInventoryMap.get(row.Codigo);
    const costoUnitario = Number(sapItem?.PurchaseCost || sapItem?.AvgCost || 0);
    const precioVentaUnitario = Number(row.PrecioVentaUnitario || 0);
    const cantidad = Number(row.Cantidad || 0);
    const isReversa = row.StatusCodigo === 'RT' || row.StatusCodigo === 'RR';

    const precioVentaTotal = Math.round(precioVentaUnitario * cantidad * 100) / 100;
    const costoCompraTotal = Math.round(costoUnitario * cantidad * 100) / 100;
    const margenMonto = Math.round((precioVentaTotal - costoCompraTotal) * 100) / 100;
    const margenPct = precioVentaTotal > 0 
      ? Math.round(((precioVentaTotal - costoCompraTotal) / precioVentaTotal) * 1000) / 10 
      : 0;

    // Normalizar Unidad de Servicio amigable
    let uServicio = row.UnidadServicio ? String(row.UnidadServicio).trim() : 'NO ESPECIFICADA';
    if (row.AlmacenOrigen === 'QXCR' || uServicio.toUpperCase().includes('CARRO ROJO')) {
      uServicio = 'Carro Rojo (QXCR)';
    } else if (row.AlmacenOrigen === 'QX' || uServicio.toUpperCase().includes('QUIROFANO') || uServicio.toUpperCase().includes('QUIRÓFANO')) {
      uServicio = 'Quirófano (QX)';
    } else if (row.AlmacenOrigen === 'FAR' || uServicio.toUpperCase().includes('FARMACIA')) {
      uServicio = 'Farmacia Central (FAR)';
    }

    // Normalizar caducidad si falta en Cirrus pero existe lote en SAP
    let lote = row.Lote;
    let caducidad = row.Caducidad;
    if ((!lote || !caducidad) && sapBatches.length > 0) {
      const matchBatch = sapBatches.find(b => b.ItemCode === row.Codigo && (!lote || b.Batch === lote));
      if (matchBatch) {
        if (!lote) lote = matchBatch.Batch;
        if (!caducidad && matchBatch.ExpirationDate) caducidad = new Date(matchBatch.ExpirationDate);
      }
    }

    return {
      ordenId: row.OrdenId,
      cuenta: row.Cuenta,
      tipoCuenta: row.TipoCuenta,
      paciente: row.Paciente,
      tipoMovimiento: row.TipoMovimiento,
      statusCodigo: row.StatusCodigo,
      estadoLinea: row.EstadoLinea,
      isReversa,
      codigo: row.Codigo,
      insumo: row.Insumo,
      cantidad,
      precioVentaUnitario,
      precioVentaTotal: isReversa ? -precioVentaTotal : precioVentaTotal,
      costoCompraUnitario: costoUnitario,
      costoCompraTotal: isReversa ? -costoCompraTotal : costoCompraTotal,
      margenMonto: isReversa ? -margenMonto : margenMonto,
      margenPct,
      unidadServicio: uServicio,
      almacenOrigen: row.AlmacenOrigen || 'N/A',
      areaDestino: row.AreaDestino,
      codigoCama: row.CodigoCama,
      lote: lote || 'N/A',
      caducidad: caducidad ? new Date(caducidad).toISOString().split('T')[0] : 'N/A',
      fechaMovimiento: row.FechaMovimiento,
      usuarioCargo: userCargoInfo.name,
      usuarioCargoLogin: row.UsuarioLogin,
      deptoUsuarioCargo: userCargoInfo.dept,
      usuarioSolicita: userSolicitaInfo.name,
      medicoTratante: row.MedicoTratante || 'NO ESPECIFICADO'
    };
  });

  // Calcular totales del resumen
  let totalCargos = 0;
  let totalReversas = 0;
  let totalPiezasCargadas = 0;
  let totalPiezasReversadas = 0;
  let montoTotalVentaCargado = 0;
  let montoTotalVentaReversado = 0;
  let costoTotalCompra = 0;

  for (const m of movimientos) {
    if (m.isReversa) {
      totalReversas++;
      totalPiezasReversadas += m.cantidad;
      montoTotalVentaReversado += Math.abs(m.precioVentaTotal);
    } else {
      totalCargos++;
      totalPiezasCargadas += m.cantidad;
      montoTotalVentaCargado += m.precioVentaTotal;
    }
    costoTotalCompra += m.costoCompraTotal;
  }

  const montoNetoCobrado = Math.round((montoTotalVentaCargado - montoTotalVentaReversado) * 100) / 100;
  const margenNetoMonto = Math.round((montoNetoCobrado - costoTotalCompra) * 100) / 100;
  const margenNetoPct = montoNetoCobrado > 0 
    ? Math.round((margenNetoMonto / montoNetoCobrado) * 1000) / 10 
    : 0;

  const resumen = {
    totalMovimientos: movimientos.length,
    totalCargos,
    totalReversas,
    totalPiezasCargadas,
    totalPiezasReversadas,
    montoTotalVentaCargado: Math.round(montoTotalVentaCargado * 100) / 100,
    montoTotalVentaReversado: Math.round(montoTotalVentaReversado * 100) / 100,
    montoNetoCobrado,
    costoTotalCompra: Math.round(costoTotalCompra * 100) / 100,
    margenNetoMonto,
    margenNetoPct
  };

  return {
    generadoEn: new Date().toISOString(),
    totalRegistros: movimientos.length,
    resumen,
    data: movimientos
  };
}

module.exports = {
  getMovimientosPaciente
};
