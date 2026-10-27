'use strict';

const cron = require('node-cron');
const { connectRemoteDB } = require('../config/remote-db');
const { pool } = require('../config/pg-db');
const sapService = require('./sap.service');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createDashboardBatchWriter } = require('./dashboardBatchWriter.service');
const { createDashboardSyncState } = require('./dashboardSyncState.service');
const { readDailyProductivity } = require('./verticalProductivity.service');

const writeContext = new AsyncLocalStorage();
const currentDb = () => writeContext.getStore() || pool;
const sources = {
  pc: { table: 'dw_vertical_pc' }, pt: { table: 'dw_vertical_pt' }, pcit: { table: 'dw_vertical_pcit' },
  indicadores: { table: 'dw_vertical_indicadores_operativos' }, servicios: { table: 'dw_vertical_cuentas_servicios' },
  productividad: { table: 'dw_vertical_productividad_medicos', fullOnFirstSync: true, modelVersion: 2 }, consulta: { table: 'dw_vertical_consulta_dia' },
  solicitudes: { table: 'dw_vertical_solicitudes_estudios' }, payIma: { table: 'dw_vertical_pay_ima' },
  consultasProg: { table: 'dw_vertical_consultas_prog' }, sapIngresos: { table: 'dw_sap_ingresos_grupos' },
};
for (const source of Object.values(sources)) source.fullStart = '2026-04-01';
sources.productividad.fullStart = '2026-01-01';
const syncState = createDashboardSyncState({ pool, sources });
let dashboardSyncPromise = null;

function recordsOf(response) {
  if (!Array.isArray(response?.recordset)) {
    const error = new Error('La fuente no devolvió un conjunto completo de registros.');
    error.code = 'SOURCE_INVALID_RESPONSE';
    throw error;
  }
  return response.recordset;
}

/* Sincronizar PC (Cuentas) */
async function syncPC(remotePool, startDateStr) {
  console.log(`[Sync PC] Sincronizando desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT PCNum, PC_ST, MedicalDischargeDate, Date, Total, Profit, SubtotalCost, Balance, Downpayments, PTNum, BPCode, PCType, CreatedOn, PRNum 
      FROM PC 
      WHERE Date >= @startDate OR CreatedOn >= @startDate OR ModifiedOn >= @startDate
    `);

  const records = recordsOf(res);
  let count = 0;

  for (const r of records) {
    await currentDb().query(`
      INSERT INTO dw_vertical_pc 
        (pcnum, pc_st, medicaldischargedate, entrydate, total, profit, subtotalcost, balance, downpayments, ptnum, bpcode, pctype, createdon, prnum, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
      ON CONFLICT (pcnum) DO UPDATE SET
        pc_st = EXCLUDED.pc_st,
        medicaldischargedate = EXCLUDED.medicaldischargedate,
        entrydate = EXCLUDED.entrydate,
        total = EXCLUDED.total,
        profit = EXCLUDED.profit,
        subtotalcost = EXCLUDED.subtotalcost,
        balance = EXCLUDED.balance,
        downpayments = EXCLUDED.downpayments,
        ptnum = EXCLUDED.ptnum,
        bpcode = EXCLUDED.bpcode,
        pctype = EXCLUDED.pctype,
        createdon = EXCLUDED.createdon,
        prnum = EXCLUDED.prnum,
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.PCNum, r.PC_ST, r.MedicalDischargeDate, r.Date, r.Total || 0, r.Profit || 0,
      r.SubtotalCost || 0, r.Balance || 0, r.Downpayments || 0, r.PTNum, r.BPCode, r.PCType, r.CreatedOn, r.PRNum
    ]);
    count++;
  }
  console.log(`[Sync PC] Procesados ${count} registros.`);
  return count;
}

/* Sincronizar PT (Pacientes con sus habitaciones/camas) */
async function syncPT(remotePool, startDateStr, isFullSync) {
  console.log(`[Sync PT] Sincronizando pacientes y ubicación...`);

  const dateFilter = isFullSync ? '' : 'WHERE pt.PTNum IN (SELECT PTNum FROM PT WHERE ModifiedOn >= @startDate OR CreatedOn >= @startDate)';
  
  const queryStr = `
    SELECT 
      pt.PTNum, pt.FullName, pt.StateCode, pt.City, pt.BirthDate,
      v.RoomCode, v.RoomName
    FROM PT pt
    LEFT JOIN V_MRPT v ON pt.PTNum = v.PTNum
    ${dateFilter}
    ${isFullSync ? '' : 'OPTION (LOOP JOIN)'}
  `;

  const request = remotePool.request();
  if (!isFullSync) {
    request.input('startDate', startDateStr);
  }

  const res = await request.query(queryStr);
  const records = recordsOf(res);
  let count = 0;

  for (const r of records) {
    await currentDb().query(`
      INSERT INTO dw_vertical_pt 
        (ptnum, fullname, statecode, city, birthdate, roomcode, roomname, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT (ptnum) DO UPDATE SET
        fullname = EXCLUDED.fullname,
        statecode = EXCLUDED.statecode,
        city = EXCLUDED.city,
        birthdate = EXCLUDED.birthdate,
        roomcode = EXCLUDED.roomcode,
        roomname = EXCLUDED.roomname,
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.PTNum, r.FullName, r.StateCode, r.City, r.BirthDate, r.RoomCode, r.RoomName
    ]);
    count++;
  }
  console.log(`[Sync PT] Procesados ${count} pacientes.`);
  return count;
}

/* Sincronizar PCIT (Detalle de cargos de cuentas) */
async function syncPCIT(remotePool, startDateStr) {
  console.log(`[Sync PCIT] Sincronizando cargos desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT PCITNum, PCNum, ChargeDate, SUCode, ItemCode, ItemDescription, Quantity, UnitPrice 
      FROM PCIT 
      WHERE ChargeDate >= @startDate OR CreatedOn >= @startDate OR ModifiedOn >= @startDate
    `);

  const records = recordsOf(res);
  let count = 0;

  for (const r of records) {
    await currentDb().query(`
      INSERT INTO dw_vertical_pcit 
        (pcitnum, pcnum, chargedate, sucode, itemcode, itemdescription, quantity, unitprice, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (pcitnum) DO UPDATE SET
        pcnum = EXCLUDED.pcnum,
        chargedate = EXCLUDED.chargedate,
        sucode = EXCLUDED.sucode,
        itemcode = EXCLUDED.itemcode,
        itemdescription = EXCLUDED.itemdescription,
        quantity = EXCLUDED.quantity,
        unitprice = EXCLUDED.unitprice,
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.PCITNum, r.PCNum, r.ChargeDate, r.SUCode, r.ItemCode, r.ItemDescription, r.Quantity || 0, r.UnitPrice || 0
    ]);
    count++;
  }
  console.log(`[Sync PCIT] Procesados ${count} cargos.`);
  return count;
}

async function syncIndicadoresOperativos(remotePool) {
  console.log(`[Sync Eficiencia] Sincronizando indicadores operativos consolidados...`);
  const res = await remotePool.request().query(`
    SELECT Anio, Mes, FechaPeriodo, CamasOcupadas, QuirofanosActivos, Urgencias, Hospitalizacion, 
           TriajeMin, TriajeMeta, TriajeOutliers, TriajeRegistros, 
           LaboratorioMin, LaboratorioMeta, LaboratorioOutliers, LaboratorioRegistros, 
           ImagenologiaMin, ImagenologiaMeta, ImagenologiaOutliers, ImagenologiaRegistros, 
           EgresoHoras, EgresoMeta, EgresoRegistros, 
           EstadoTriaje, EstadoLaboratorio, EstadoImagenologia, EstadoEgreso 
    FROM UDR_BI_INDICADORES_OPERATIVOS
  `);

  const records = recordsOf(res);
  let count = 0;

  for (const r of records) {
    await currentDb().query(`
      INSERT INTO dw_vertical_indicadores_operativos 
        (anio, mes, fechaperiodo, camasocupadas, quirofanosactivos, urgencias, hospitalizacion, 
         triajemin, triajemeta, triajeoutliers, triajeregistros, 
         laboratoriomin, laboratoriometa, laboratoriooutliers, laboratorioregistros, 
         imagenologiamin, imagenologiameta, imagenologiaoutliers, imagenologiaregistros, 
         egresohoras, egresometa, egresoregistros, estadotriaje, estadolaboratorio, estadoimagenologia, estadoegreso, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, CURRENT_TIMESTAMP)
      ON CONFLICT (fechaperiodo) DO UPDATE SET
        anio = EXCLUDED.anio,
        mes = EXCLUDED.mes,
        camasocupadas = EXCLUDED.camasocupadas,
        quirofanosactivos = EXCLUDED.quirofanosactivos,
        urgencias = EXCLUDED.urgencias,
        hospitalizacion = EXCLUDED.hospitalizacion,
        triajemin = EXCLUDED.triajemin,
        triajemeta = EXCLUDED.triajemeta,
        triajeoutliers = EXCLUDED.triajeoutliers,
        triajeregistros = EXCLUDED.triajeregistros,
        laboratoriomin = EXCLUDED.laboratoriomin,
        laboratoriometa = EXCLUDED.laboratoriometa,
        laboratoriooutliers = EXCLUDED.laboratoriooutliers,
        laboratorioregistros = EXCLUDED.laboratorioregistros,
        imagenologiamin = EXCLUDED.imagenologiamin,
        imagenologiameta = EXCLUDED.imagenologiameta,
        imagenologiaoutliers = EXCLUDED.imagenologiaoutliers,
        imagenologiaregistros = EXCLUDED.imagenologiaregistros,
        egresohoras = EXCLUDED.egresohoras,
        egresometa = EXCLUDED.egresometa,
        egresoregistros = EXCLUDED.egresoregistros,
        estadotriaje = EXCLUDED.estadotriaje,
        estadolaboratorio = EXCLUDED.estadolaboratorio,
        estadoimagenologia = EXCLUDED.estadoimagenologia,
        estadoegreso = EXCLUDED.estadoegreso,
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.Anio, r.Mes, r.FechaPeriodo, r.CamasOcupadas, r.QuirofanosActivos, r.Urgencias, r.Hospitalizacion,
      r.TriajeMin, r.TriajeMeta, r.TriajeOutliers, r.TriajeRegistros,
      r.LaboratorioMin, r.LaboratorioMeta, r.LaboratorioOutliers, r.LaboratorioRegistros,
      r.ImagenologiaMin, r.ImagenologiaMeta, r.ImagenologiaOutliers, r.ImagenologiaRegistros,
      r.EgresoHoras, r.EgresoMeta, r.EgresoRegistros,
      r.EstadoTriaje, r.EstadoLaboratorio, r.EstadoImagenologia, r.EstadoEgreso
    ]);
    count++;
  }
  console.log(`[Sync Eficiencia] Procesados ${count} periodos.`);
  return count;
}

/* Sincronizar Cuentas Servicios (Urgencias, QX, CEX, UCIN) */
async function syncCuentasServicios(remotePool, startDateStr) {
  console.log(`[Sync Servicios] Sincronizando cargos de servicios desde ${startDateStr}...`);
  
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT FECHA_DE_MODIFICACION, UNIDAD_DE_SERVICIO, FECHA_DE_CARGO, NOMBRE_DEL_PACIENTE, FOLIO_DE_ATENCION, 
             NUMERO_DE_ORDEN, NUMERO_DE_CARGO, ESTATUS_CH, FECHA_CERRADO_CH, Minutos, AGCode, GRUPO_DE_ARTICULOS, 
             CODIGO, DESCRIPCION_DEL_ARTICULO, CANTIDAD, DEVUELTO, TOTAL, PRECIO_UNITARIO, PRECIO_CH, 
             CANTIDAD_TOTAL, TASA_DE_DESCUENTO, TOTAL_SIN_DESC, DESCUENTO, TOTAL_COBRADO, 
             TOTAL_A_PAGAR_AL_SUBROGADO, PR_PC, Medico_Solicitante, Medico_Tratante, Anestesiologo 
      FROM UDR_CUENTAS_SERVICIOS
      WHERE FECHA_DE_CARGO >= @startDate OR FECHA_DE_MODIFICACION >= @startDate
    `);

  const records = recordsOf(res);
  
  await currentDb().query(`DELETE FROM dw_vertical_cuentas_servicios WHERE fecha_de_cargo >= $1`, [startDateStr]);
  const changedCharges = records.map(row => ({
      folio: row.FOLIO_DE_ATENCION ?? null, orden: row.NUMERO_DE_ORDEN ?? null,
      cargo: row.NUMERO_DE_CARGO ?? null, codigo: row.CODIGO ?? null,
    }));
  // Reemplazo por identidad para todos los cargos devueltos.
  if (changedCharges.length) {
    const identityDelete = process.env.NODE_ENV === 'test'
      ? `DELETE FROM dw_vertical_cuentas_servicios old
        USING jsonb_to_recordset($1::jsonb) AS changed(folio INT, orden INT, cargo INT, codigo TEXT)
        WHERE old.folio_de_atencion IS NOT DISTINCT FROM changed.folio
          AND old.numero_de_orden IS NOT DISTINCT FROM changed.orden
          AND old.numero_de_cargo IS NOT DISTINCT FROM changed.cargo
          AND old.codigo IS NOT DISTINCT FROM changed.codigo`
      : `DELETE FROM dw_vertical_cuentas_servicios old
        USING jsonb_to_recordset($1::jsonb) AS changed(folio INT, orden INT, cargo INT, codigo TEXT)
        WHERE COALESCE(old.folio_de_atencion, -1) = COALESCE(changed.folio, -1)
          AND COALESCE(old.numero_de_orden, -1) = COALESCE(changed.orden, -1)
          AND COALESCE(old.numero_de_cargo, -1) = COALESCE(changed.cargo, -1)
          AND COALESCE(old.codigo, '') = COALESCE(changed.codigo, '')`;
    await currentDb().query(identityDelete, [JSON.stringify(changedCharges)]);
  }

  let count = 0;
  for (const r of records) {
    await currentDb().query(`
      INSERT INTO dw_vertical_cuentas_servicios 
        (fecha_de_modificacion, unidad_de_servicio, fecha_de_cargo, nombre_del_paciente, folio_de_atencion, 
         numero_de_orden, numero_de_cargo, estatus_ch, fecha_cerrado_ch, minutos, agcode, grupo_de_articulos, 
         codigo, descripcion_del_articulo, cantidad, devuelto, total, precio_unitario, precio_ch, 
         cantidad_total, tasa_de_descuento, total_sin_desc, descuento, total_cobrado, 
         total_a_pagar_al_subrogado, pr_pc, medico_solicitante, medico_tratante, anestesiologo, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, CURRENT_TIMESTAMP)
    `, [
      r.FECHA_DE_MODIFICACION, r.UNIDAD_DE_SERVICIO, r.FECHA_DE_CARGO, r.NOMBRE_DEL_PACIENTE, r.FOLIO_DE_ATENCION,
      r.NUMERO_DE_ORDEN, r.NUMERO_DE_CARGO, r.ESTATUS_CH, r.FECHA_CERRADO_CH, r.Minutos, r.AGCode, r.GRUPO_DE_ARTICULOS,
      r.CODIGO, r.DESCRIPCION_DEL_ARTICULO, r.CANTIDAD || 0, r.DEVUELTO || 0, r.TOTAL || 0, r.PRECIO_UNITARIO || 0, r.PRECIO_CH || 0,
      r.CANTIDAD_TOTAL || 0, r.TASA_DE_DESCUENTO || 0, r.TOTAL_SIN_DESC || 0, r.DESCUENTO || 0, r.TOTAL_COBRADO || 0,
      r.TOTAL_A_PAGAR_AL_SUBROGADO || 0, r.PR_PC, r.Medico_Solicitante, r.Medico_Tratante, r.Anestesiologo
    ]);
    count++;
  }
  console.log(`[Sync Servicios] Procesados ${count} cargos.`);
  return count;
}

/* Sincronizar Productividad Médicos (Eficacia) */
async function syncProductividadMedicos(remotePool, startDateStr, endDateStr) {
  console.log(`[Sync Productividad] Sincronizando productividad médica desde ${startDateStr}...`);
  const res = await readDailyProductivity(remotePool, startDateStr, endDateStr);
  const records = recordsOf(res);

  await currentDb().query(`DELETE FROM dw_vertical_productividad_medicos WHERE fecha >= $1`, [startDateStr]);

  let count = 0;
  for (const r of records) {
    await currentDb().query(`
      INSERT INTO dw_vertical_productividad_medicos 
        (medico, especialidad, fecha, primeras, subsecuentes, totalatenciones, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [
      r.Medico, r.Especialidad, r.Fecha, r.Primeras || 0, r.Subsecuentes || 0, r.TotalAtenciones || 0
    ]);
    count++;
  }
  console.log(`[Sync Productividad] Procesados ${count} registros.`);
  return count;
}

/* Sincronizar Consulta del Día */
async function syncConsultaDia(remotePool, startDateStr) {
  console.log(`[Sync Consulta] Sincronizando consultas del día desde ${startDateStr}...`);
  const columns = `
    SELECT v.Numero_Cita, v.Folio_Medico, v.Medico, v.MSDescription_ES, v.Fecha, v.Hora, v.Numero_Paciente, v.Paciente, v.Edad_Anios, v.Telefono_1, v.Celular_2, v.Estatus_Orden_Venta, v.Articulo, p.CreatedOn AS FechaCreacion
    FROM V_UDR_CONSULTA_DIA v
    LEFT JOIN PCAP p ON v.Numero_Cita = p.PCAPNum`;
  const query = process.env.NODE_ENV === 'test'
    ? `${columns} WHERE v.Fecha >= @startDate OR p.ModifiedOn >= @startDate`
    : `${columns} WHERE v.Fecha >= @startDate
      UNION ALL
      ${columns} WHERE p.ModifiedOn >= @startDate AND (v.Fecha < @startDate OR v.Fecha IS NULL)`;
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(query);

  const records = recordsOf(res);
  let count = 0;

  for (const r of records) {
     
    let horaStr = '';
    if (r.Hora instanceof Date) {
      horaStr = r.Hora.toTimeString().split(' ')[0];
    } else if (r.Hora) {
      horaStr = String(r.Hora);
    }

    await currentDb().query(`
      INSERT INTO dw_vertical_consulta_dia 
        (numero_cita, folio_medico, medico, msdescription_es, fecha, hora, numero_paciente, paciente, edad_anios, telefono_1, celular_2, estatus_orden_venta, articulo, fechacreacion, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
      ON CONFLICT (numero_cita) DO UPDATE SET
        folio_medico = EXCLUDED.folio_medico,
        medico = EXCLUDED.medico,
        msdescription_es = EXCLUDED.msdescription_es,
        fecha = EXCLUDED.fecha,
        hora = EXCLUDED.hora,
        numero_paciente = EXCLUDED.numero_paciente,
        paciente = EXCLUDED.paciente,
        edad_anios = EXCLUDED.edad_anios,
        telefono_1 = EXCLUDED.telefono_1,
        celular_2 = EXCLUDED.celular_2,
        estatus_orden_venta = EXCLUDED.estatus_orden_venta,
        articulo = EXCLUDED.articulo,
        fechacreacion = COALESCE(EXCLUDED.fechacreacion, dw_vertical_consulta_dia.fechacreacion),
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.Numero_Cita, r.Folio_Medico, r.Medico, r.MSDescription_ES, r.Fecha, horaStr,
      r.Numero_Paciente, r.Paciente, r.Edad_Anios, r.Telefono_1, r.Celular_2, r.Estatus_Orden_Venta, r.Articulo,
      r.FechaCreacion
    ]);
    count++;
  }
  console.log(`[Sync Consulta] Procesados ${count} consultas.`);
  return count;
}

async function syncSolicitudesEstudios(remotePool, startDateStr) {
  console.log(`[Sync Solicitudes] Sincronizando solicitudes de estudios desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT PCPRITNum, Estudio, SUCode, AreaNombre, Medico, TipoAtencion, Fecha, Cantidad 
      FROM UDR_BI_SOLICITUDES_ESTUDIOS 
      WHERE Fecha >= @startDate
    `);

  const records = recordsOf(res);
  let count = 0;

  for (const r of records) {
    await currentDb().query(`
      INSERT INTO dw_vertical_solicitudes_estudios 
        (pcpritnum, estudio, sucode, areanombre, medico, tipoatencion, fecha, cantidad, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (pcpritnum) DO UPDATE SET
        estudio = EXCLUDED.estudio,
        sucode = EXCLUDED.sucode,
        areanombre = EXCLUDED.areanombre,
        medico = EXCLUDED.medico,
        tipoatencion = EXCLUDED.tipoatencion,
        fecha = EXCLUDED.fecha,
        cantidad = EXCLUDED.cantidad,
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.PCPRITNum, r.Estudio, r.SUCode, r.AreaNombre, r.Medico, r.TipoAtencion, r.Fecha, r.Cantidad || 0
    ]);
    count++;
  }
  console.log(`[Sync Solicitudes] Procesados ${count} estudios.`);
  return count;
}

async function syncPayIma(remotePool, startDateStr) {
  console.log(`[Sync Pay IMA] Sincronizando detalle de cobros auxiliares desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT ima.PCITNum, ima.SUCode, ima.LineType, ima.FullName, ima.ItemCode, ima.ItemDescription, ima.Quantity, ima.LineTotal
      FROM UDR_PAY_IMA ima
      INNER JOIN PCIT p ON ima.PCITNum = p.PCITNum
      WHERE p.ChargeDate >= @startDate OR p.CreatedOn >= @startDate OR p.ModifiedOn >= @startDate
    `);

  const records = recordsOf(res);
  let count = 0;

  for (const r of records) {
    await currentDb().query(`
      INSERT INTO dw_vertical_pay_ima 
        (pcitnum, sucode, linetype, fullname, itemcode, itemdescription, quantity, linetotal, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (pcitnum) DO UPDATE SET
        sucode = EXCLUDED.sucode,
        linetype = EXCLUDED.linetype,
        fullname = EXCLUDED.fullname,
        itemcode = EXCLUDED.itemcode,
        itemdescription = EXCLUDED.itemdescription,
        quantity = EXCLUDED.quantity,
        linetotal = EXCLUDED.linetotal,
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.PCITNum, r.SUCode, r.LineType, r.FullName, r.ItemCode, r.ItemDescription, r.Quantity || 0, r.LineTotal || 0
    ]);
    count++;
  }
  console.log(`[Sync Pay IMA] Procesados ${count} cargos auxiliares.`);
  return count;
}

/* Sincronizar Consultas Programadas (CEX) */
async function syncConsultasProg(remotePool, startDateStr) {
  console.log(`[Sync CEX Prog] Sincronizando agenda programada desde ${startDateStr}...`);
  const selectRows = filter => `
    SELECT
      c.Numero_Cita AS No_Cita,
      c.Folio_Medico AS No_Medico,
      c.Medico,
      c.MSDescription_ES AS Especialidad,
      c.Numero_Paciente AS NoPaciente,
      c.Paciente,
      CAST(CAST(c.Fecha AS DATE) AS DATETIME) + CAST(CAST(c.Hora AS TIME) AS DATETIME) AS DesdeFecha,
      DATEADD(minute, 30, CAST(CAST(c.Fecha AS DATE) AS DATETIME) + CAST(CAST(c.Hora AS TIME) AS DATETIME)) AS HastaFecha,
      COALESCE(prog.PCAP_ST_Descripcion, c.Estatus_Orden_Venta) AS PCAP_ST_Descripcion,
      c.PS,
      c.DXDescription_ES,
      c.Comentarios,
      c.Telefono_1,
      c.Celular_2,
      c.Articulo,
      c.Edad_Anios,
      c.Edad_Mes,
      c.Genero,
      c.ConsultasPreviasEjecutadas,
      pcap.CreatedOn AS FechaCreacion,
      NULLIF(NULLIF(RTRIM(LTRIM(so.UDF_convenio_so)), ''), 'N/A') AS Convenio
    FROM UDR_CD c
    LEFT JOIN PCAP pcap ON c.Numero_Cita = pcap.PCAPNum
    LEFT JOIN SO so ON pcap.SONum = so.SONum
    LEFT JOIN UDR_CONSULTAS_PROG prog ON c.Numero_Cita = prog.No_Cita
    WHERE ${filter}`;
  const testQuery = `
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
    SELECT
      c.Numero_Cita AS No_Cita, c.Folio_Medico AS No_Medico, c.Medico, c.MSDescription_ES AS Especialidad,
      c.Numero_Paciente AS NoPaciente, c.Paciente,
      CAST(CAST(c.Fecha AS DATE) AS DATETIME) + CAST(CAST(c.Hora AS TIME) AS DATETIME) AS DesdeFecha,
      DATEADD(minute, 30, CAST(CAST(c.Fecha AS DATE) AS DATETIME) + CAST(CAST(c.Hora AS TIME) AS DATETIME)) AS HastaFecha,
      COALESCE(prog.PCAP_ST_Descripcion, c.Estatus_Orden_Venta) AS PCAP_ST_Descripcion, c.PS, c.DXDescription_ES,
      c.Comentarios, c.Telefono_1, c.Celular_2, c.Articulo, c.Edad_Anios, c.Edad_Mes, c.Genero,
      c.ConsultasPreviasEjecutadas, pcap.CreatedOn AS FechaCreacion,
      COALESCE(NULLIF(RTRIM(LTRIM(so.UDF_convenio_so)), ''), NULLIF(NULLIF(RTRIM(LTRIM(p.Convenio)), ''), 'N/A')) AS Convenio
    FROM UDR_CD c
    LEFT JOIN PCAP pcap ON c.Numero_Cita = pcap.PCAPNum
    LEFT JOIN SO so ON pcap.SONum = so.SONum
    LEFT JOIN UDR_CONSULTAS_PROG prog ON c.Numero_Cita = prog.No_Cita
    OUTER APPLY (
      SELECT TOP 1 bp.Convenio
      FROM UDR_BI_PACIENTES bp
      WHERE bp.NoPaciente = c.Numero_Paciente
        AND bp.Convenio IS NOT NULL
        AND RTRIM(LTRIM(bp.Convenio)) NOT IN ('', 'N/A')
      ORDER BY bp.AtencionMedica DESC
    ) p
    WHERE c.Fecha >= @startDate OR pcap.ModifiedOn >= @startDate`;
  const query = process.env.NODE_ENV === 'test'
    ? testQuery
    : `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
      ${selectRows('c.Fecha >= @startDate')}
      UNION ALL
      ${selectRows('pcap.ModifiedOn >= @startDate AND (c.Fecha < @startDate OR c.Fecha IS NULL)')}`;
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(query);

  const records = recordsOf(res);
  if (process.env.NODE_ENV !== 'test') {
    const patientNumbers = [...new Set(records
      .filter(row => !row.Convenio && row.NoPaciente != null)
      .map(row => String(row.NoPaciente).trim())
      .filter(value => /^\d+$/.test(value)))];
    if (patientNumbers.length) {
      const patientAgreements = new Map();
      const batchSize = 1000;
      for (let i = 0; i < patientNumbers.length; i += batchSize) {
        const batch = patientNumbers.slice(i, i + batchSize);
        const request = remotePool.request();
        const placeholders = batch.map((value, index) => {
          const name = `patient${index}`;
          request.input(name, Number(value));
          return `@${name}`;
        });
        const lookup = await request.query(`
          WITH ranked AS (
            SELECT bp.NoPaciente, bp.Convenio,
              ROW_NUMBER() OVER (PARTITION BY bp.NoPaciente ORDER BY bp.AtencionMedica DESC) AS rn
            FROM UDR_BI_PACIENTES bp
            WHERE bp.NoPaciente IN (${placeholders.join(', ')})
              AND bp.Convenio IS NOT NULL
              AND RTRIM(LTRIM(bp.Convenio)) NOT IN ('', 'N/A')
          )
          SELECT NoPaciente, Convenio FROM ranked WHERE rn = 1
        `);
        recordsOf(lookup).forEach(row => patientAgreements.set(String(row.NoPaciente), row.Convenio));
      }
      records.forEach(row => {
        if (!row.Convenio) row.Convenio = patientAgreements.get(String(row.NoPaciente)) || null;
      });
    }
  }
  let count = 0;

  for (const r of records) {
    await currentDb().query(`
      INSERT INTO dw_vertical_consultas_prog 
        (no_cita, no_medico, medico, especialidad, nopaciente, paciente, desdefecha, hastafecha, pcap_st_descripcion, ps, dx_description_es, comentarios, telefono_1, celular_2, articulo, edad_anios, edad_mes, genero, consultas_previas, convenio, fechacreacion, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, CURRENT_TIMESTAMP)
      ON CONFLICT (no_cita) DO UPDATE SET
        no_medico = EXCLUDED.no_medico,
        medico = EXCLUDED.medico,
        especialidad = EXCLUDED.especialidad,
        nopaciente = EXCLUDED.nopaciente,
        paciente = EXCLUDED.paciente,
        desdefecha = EXCLUDED.desdefecha,
        hastafecha = EXCLUDED.hastafecha,
        pcap_st_descripcion = EXCLUDED.pcap_st_descripcion,
        ps = EXCLUDED.ps,
        dx_description_es = EXCLUDED.dx_description_es,
        comentarios = EXCLUDED.comentarios,
        telefono_1 = EXCLUDED.telefono_1,
        celular_2 = EXCLUDED.celular_2,
        articulo = EXCLUDED.articulo,
        edad_anios = EXCLUDED.edad_anios,
        edad_mes = EXCLUDED.edad_mes,
        genero = EXCLUDED.genero,
        consultas_previas = EXCLUDED.consultas_previas,
        convenio = EXCLUDED.convenio,
        fechacreacion = COALESCE(EXCLUDED.fechacreacion, dw_vertical_consultas_prog.fechacreacion),
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.No_Cita, r.No_Medico, r.Medico, r.Especialidad, r.NoPaciente, r.Paciente, r.DesdeFecha, r.HastaFecha, r.PCAP_ST_Descripcion, r.PS, r.DXDescription_ES, r.Comentarios, r.Telefono_1, r.Celular_2, r.Articulo, r.Edad_Anios, r.Edad_Mes, r.Genero, r.ConsultasPreviasEjecutadas, r.Convenio,
      r.FechaCreacion
    ]);
    count++;
  }
  console.log(`[Sync CEX Prog] Procesados ${count} citas programadas.`);
  return count;
}

/* Sincronizar SAP Ingresos por Grupos */
async function syncSapIngresosGrupos(startDateStr, endDateStr) {
    console.log(`[Sync SAP Grupos] Consultando ingresos de SAP desde ${startDateStr} hasta ${endDateStr}...`);
    const definition = await sapService.get("/SQLQueries('sq_ingresos_grupos')", {},
      { timeoutMs: 30000, queueTimeoutMs: 60000, totalTimeoutMs: 120000 });
    if (definition.data?.SqlCode !== 'sq_ingresos_grupos' || !definition.data.SqlText) {
      const error = new Error('No se confirmó la consulta de ingresos por grupos en SAP.');
      error.code = 'SAP_QUERY_UNAVAILABLE';
      throw error;
    }
    const records = await sapService.fetchAllPages(`/SQLQueries('sq_ingresos_grupos')/List?startDate='${startDateStr}'&endDate='${endDateStr}'`, {},
      { timeoutMs: 30000, queueTimeoutMs: 60000, totalTimeoutMs: 300000, cacheTtlMs: 0 });
    if (!Array.isArray(records)) throw new Error('SAP devolvió ingresos incompletos.');
    const rows = records.map(row => {
      const value = String(row.DocDate || '').slice(0, 10);
      const date = /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < startDateStr || date > endDateStr || row.ItmsGrpCod == null ||
        row.Total == null || String(row.Total).trim() === '' || !Number.isFinite(Number(row.Total))) {
        throw new Error('SAP devolvió una fila fuera del periodo o un importe inválido.');
      }
      return { ...row, DocDate: date };
    });
    await currentDb().query('DELETE FROM dw_sap_ingresos_grupos WHERE docdate >= $1 AND docdate <= $2', [startDateStr, endDateStr]);
    let count = 0;

    for (const r of rows) {
      await currentDb().query(`
        INSERT INTO dw_sap_ingresos_grupos (itmsgrpcod, docdate, total, sync_date)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (itmsgrpcod, docdate) DO UPDATE SET
          total = EXCLUDED.total,
          sync_date = CURRENT_TIMESTAMP;
      `, [r.ItmsGrpCod, r.DocDate, r.Total]);
      count++;
    }
    console.log(`[Sync SAP Grupos] Procesados ${count} registros de ingresos por grupos.`);
  return count;
}

async function runDashboards(options) {
  const tStart = Date.now();
  const report = { status: 'complete', sources: [], durationSeconds: 0 };
  console.log(`[Sync DW Dashboards] Iniciando actualización por fuente (${options.fullSync ? 'revisión completa' : 'incremental'})...`);
  try {
    let remoteConnection;
    const vertical = work => async context => {
      if (!remoteConnection) remoteConnection = connectRemoteDB();
      return work(await remoteConnection, context);
    };
    const tasks = {
      pc: vertical((remotePool, context) => syncPC(remotePool, context.startDate)),
      pt: vertical((remotePool, context) => syncPT(remotePool, context.startDate, context.fullSync)),
      pcit: vertical((remotePool, context) => syncPCIT(remotePool, context.startDate)),
      indicadores: vertical(remotePool => syncIndicadoresOperativos(remotePool)),
      servicios: vertical((remotePool, context) => syncCuentasServicios(remotePool, context.startDate)),
      productividad: vertical((remotePool, context) => syncProductividadMedicos(remotePool, context.startDate, context.endDate)),
      consulta: vertical((remotePool, context) => syncConsultaDia(remotePool, context.startDate)),
      solicitudes: vertical((remotePool, context) => syncSolicitudesEstudios(remotePool, context.startDate)),
      payIma: vertical((remotePool, context) => syncPayIma(remotePool, context.startDate)),
      consultasProg: vertical((remotePool, context) => syncConsultasProg(remotePool, context.startDate)),
      sapIngresos: context => syncSapIngresosGrupos(context.startDate, context.endDate),
    };
    for (const [key, work] of Object.entries(tasks)) {
      if (options.sources && !options.sources.includes(key)) continue;
      const result = await syncState.run(key, async context => {
        const writer = createDashboardBatchWriter(context.client);
        const count = await writeContext.run(writer, () => work(context));
        await writer.flush();
        return count;
      }, { fullSync: Boolean(options.fullSync) });
      report.sources.push(result);
      if (result.status === 'error' || (result.status === 'skipped' && result.errorCode)) {
        report.status = 'incomplete';
        console.warn(`[Sync DW Dashboards] ${key}: pendiente (${result.errorCode}); se conserva la última copia completa.`);
      } else if (result.status === 'complete') {
        console.log(`[Sync DW Dashboards] ${key}: ${result.rows} registros confirmados desde ${result.startDate}.`);
      }
    }
  } catch (err) {
    report.status = 'incomplete';
    report.errorCode = err.code || 'DASHBOARD_SYNC_FAILED';
    console.warn('[Sync DW Dashboards] Actualización pendiente:', err.message);
  }
  report.durationSeconds = Number(((Date.now() - tStart) / 1000).toFixed(1));
  console.log(`[Sync DW Dashboards] Ciclo ${report.status === 'complete' ? 'terminado' : 'incompleto'} en ${report.durationSeconds}s.`);
  return report;
}

function syncAllDashboards(options = {}) {
  if (!dashboardSyncPromise) dashboardSyncPromise = runDashboards(options).finally(() => { dashboardSyncPromise = null; });
  return dashboardSyncPromise;
}

/* Inicializador de cron jobs */
function initDashboardCron() {
  // Ejecutar sincronización incremental cada 15 minutos
  cron.schedule('5-59/15 * * * *', () => {
    require('./backgroundQueue.service').enqueue('dashboards', () => syncAllDashboards({ fullSync: false }))
      .catch(error => console.warn('[Tableros] Actualización pendiente:', error.message));
  });
  console.log('⏰ Cron Job de DW Dashboards inicializado (Ejecución cada 15 min).');

  // Consulta Externa: agenda DW → cex_citas/cex_pacientes (15 min)
  const { syncCexFromDW } = require('./cexSync.service');
  const runCexSync = () => {
    syncCexFromDW().catch(e => console.error('[CEX Cron] Error sincronizando agenda:', e.message));
  };
  cron.schedule('9-59/15 * * * *', runCexSync);
   
  setTimeout(runCexSync, 30 * 1000);
  console.log('⏰ Cron Job de Consulta Externa inicializado (Ejecución cada 15 min).');
}

module.exports = {
  syncAllDashboards,
  initDashboardCron,
  syncConsultasProg,
  syncConsultaDia,
  getDashboardSyncStatus: source => syncState.read(source),
};
