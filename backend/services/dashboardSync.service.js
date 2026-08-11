'use strict';

const cron = require('node-cron');
const { connectRemoteDB } = require('../config/remote-db');
const { pool } = require('../config/pg-db');
const sapService = require('./sap.service');

let isSyncing = false;

/**
 * Helper to format Dates to YYYY-MM-DD
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * 1. Sincronizar PC (Cuentas)
 */
async function syncPC(remotePool, startDateStr) {
  console.log(`[Sync PC] Sincronizando desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT PCNum, PC_ST, MedicalDischargeDate, Date, Total, Profit, SubtotalCost, Balance, PTNum, BPCode, PCType, CreatedOn, PRNum 
      FROM PC 
      WHERE Date >= @startDate OR CreatedOn >= @startDate
    `);

  const records = res.recordset || [];
  let count = 0;

  for (const r of records) {
    await pool.query(`
      INSERT INTO dw_vertical_pc 
        (pcnum, pc_st, medicaldischargedate, entrydate, total, profit, subtotalcost, balance, ptnum, bpcode, pctype, createdon, prnum, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
      ON CONFLICT (pcnum) DO UPDATE SET
        pc_st = EXCLUDED.pc_st,
        medicaldischargedate = EXCLUDED.medicaldischargedate,
        entrydate = EXCLUDED.entrydate,
        total = EXCLUDED.total,
        profit = EXCLUDED.profit,
        subtotalcost = EXCLUDED.subtotalcost,
        balance = EXCLUDED.balance,
        ptnum = EXCLUDED.ptnum,
        bpcode = EXCLUDED.bpcode,
        pctype = EXCLUDED.pctype,
        createdon = EXCLUDED.createdon,
        prnum = EXCLUDED.prnum,
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.PCNum, r.PC_ST, r.MedicalDischargeDate, r.Date, r.Total || 0, r.Profit || 0,
      r.SubtotalCost || 0, r.Balance || 0, r.PTNum, r.BPCode, r.PCType, r.CreatedOn, r.PRNum
    ]);
    count++;
  }
  console.log(`[Sync PC] Sincronizados ${count} registros.`);
}

/**
 * 2. Sincronizar PT (Pacientes con sus habitaciones/camas)
 */
async function syncPT(remotePool, startDateStr, isFullSync) {
  console.log(`[Sync PT] Sincronizando pacientes y ubicación...`);
  
  // Si no es full sync, solo traemos los modificados recientemente
  const dateFilter = isFullSync ? "" : "WHERE pt.ModifiedOn >= @startDate OR pt.CreatedOn >= @startDate";
  
  const queryStr = `
    SELECT 
      pt.PTNum, pt.FullName, pt.StateCode, pt.City, pt.BirthDate,
      v.RoomCode, v.RoomName
    FROM PT pt
    LEFT JOIN V_MRPT v ON pt.PTNum = v.PTNum
    ${dateFilter}
  `;

  const request = remotePool.request();
  if (!isFullSync) {
    request.input('startDate', startDateStr);
  }

  const res = await request.query(queryStr);
  const records = res.recordset || [];
  let count = 0;

  for (const r of records) {
    await pool.query(`
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
  console.log(`[Sync PT] Sincronizados ${count} pacientes.`);
}

/**
 * 3. Sincronizar PCIT (Detalle de cargos de cuentas)
 */
async function syncPCIT(remotePool, startDateStr) {
  console.log(`[Sync PCIT] Sincronizando cargos desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT PCITNum, PCNum, ChargeDate, SUCode, ItemCode, ItemDescription, Quantity, UnitPrice 
      FROM PCIT 
      WHERE ChargeDate >= @startDate OR CreatedOn >= @startDate
    `);

  const records = res.recordset || [];
  let count = 0;

  for (const r of records) {
    await pool.query(`
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
  console.log(`[Sync PCIT] Sincronizados ${count} cargos.`);
}

/**
 * 4. Sincronizar Indicadores Operativos (Eficiencia)
 */
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

  const records = res.recordset || [];
  let count = 0;

  for (const r of records) {
    await pool.query(`
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
  console.log(`[Sync Eficiencia] Sincronizados ${count} periodos.`);
}

/**
 * 5. Sincronizar Cuentas Servicios (Urgencias, QX, CEX, UCIN)
 * Método: Delete-and-reload de la ventana de tiempo para robustez y velocidad sin PK.
 */
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

  const records = res.recordset || [];
  
  // Limpiar la ventana en Postgres
  await pool.query(`DELETE FROM dw_vertical_cuentas_servicios WHERE fecha_de_cargo >= $1`, [startDateStr]);

  let count = 0;
  for (const r of records) {
    await pool.query(`
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
  console.log(`[Sync Servicios] Sincronizados ${count} cargos.`);
}

/**
 * 6. Sincronizar Productividad Médicos (Eficacia)
 */
async function syncProductividadMedicos(remotePool, startDateStr) {
  console.log(`[Sync Productividad] Sincronizando productividad médica desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT Medico, Especialidad, Fecha, Primeras, Subsecuentes, TotalAtenciones 
      FROM UDR_BI_PRODUCTIVIDAD_MEDICOS 
      WHERE Fecha >= @startDate
    `);

  const records = res.recordset || [];
  
  // Limpiar ventana en Postgres
  await pool.query(`DELETE FROM dw_vertical_productividad_medicos WHERE fecha >= $1`, [startDateStr]);

  let count = 0;
  for (const r of records) {
    await pool.query(`
      INSERT INTO dw_vertical_productividad_medicos 
        (medico, especialidad, fecha, primeras, subsecuentes, totalatenciones, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [
      r.Medico, r.Especialidad, r.Fecha, r.Primeras || 0, r.Subsecuentes || 0, r.TotalAtenciones || 0
    ]);
    count++;
  }
  console.log(`[Sync Productividad] Sincronizados ${count} registros.`);
}

/**
 * 7. Sincronizar Consulta del Día
 */
async function syncConsultaDia(remotePool, startDateStr) {
  console.log(`[Sync Consulta] Sincronizando consultas del día desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT Numero_Cita, Folio_Medico, Medico, MSDescription_ES, Fecha, Hora, Numero_Paciente, Paciente, Edad_Anios, Telefono_1, Celular_2, Estatus_Orden_Venta, Articulo 
      FROM V_UDR_CONSULTA_DIA 
      WHERE Fecha >= @startDate
    `);

  const records = res.recordset || [];
  let count = 0;

  for (const r of records) {
    // Formatear la hora
    let horaStr = '';
    if (r.Hora instanceof Date) {
      horaStr = r.Hora.toTimeString().split(' ')[0];
    } else if (r.Hora) {
      horaStr = String(r.Hora);
    }

    await pool.query(`
      INSERT INTO dw_vertical_consulta_dia 
        (numero_cita, folio_medico, medico, msdescription_es, fecha, hora, numero_paciente, paciente, edad_anios, telefono_1, celular_2, estatus_orden_venta, articulo, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
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
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.Numero_Cita, r.Folio_Medico, r.Medico, r.MSDescription_ES, r.Fecha, horaStr,
      r.Numero_Paciente, r.Paciente, r.Edad_Anios, r.Telefono_1, r.Celular_2, r.Estatus_Orden_Venta, r.Articulo
    ]);
    count++;
  }
  console.log(`[Sync Consulta] Sincronizados ${count} consultas.`);
}

/**
 * 8. Sincronizar Solicitudes Estudios (Auxiliares)
 */
async function syncSolicitudesEstudios(remotePool, startDateStr) {
  console.log(`[Sync Solicitudes] Sincronizando solicitudes de estudios desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT PCPRITNum, Estudio, SUCode, AreaNombre, Medico, TipoAtencion, Fecha, Cantidad 
      FROM UDR_BI_SOLICITUDES_ESTUDIOS 
      WHERE Fecha >= @startDate
    `);

  const records = res.recordset || [];
  let count = 0;

  for (const r of records) {
    await pool.query(`
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
  console.log(`[Sync Solicitudes] Sincronizados ${count} estudios.`);
}

/**
 * 9. Sincronizar Pay IMA (Auxiliares / Cuneros)
 * Se filtra usando un JOIN con PCIT por ChargeDate
 */
async function syncPayIma(remotePool, startDateStr) {
  console.log(`[Sync Pay IMA] Sincronizando detalle de cobros auxiliares desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT ima.PCITNum, ima.SUCode, ima.LineType, ima.FullName, ima.ItemCode, ima.ItemDescription, ima.Quantity, ima.LineTotal
      FROM UDR_PAY_IMA ima
      INNER JOIN PCIT p ON ima.PCITNum = p.PCITNum
      WHERE p.ChargeDate >= @startDate OR p.CreatedOn >= @startDate
    `);

  const records = res.recordset || [];
  let count = 0;

  for (const r of records) {
    await pool.query(`
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
  console.log(`[Sync Pay IMA] Sincronizados ${count} cargos auxiliares.`);
}

/**
 * 10. Sincronizar Consultas Programadas (CEX)
 */
async function syncConsultasProg(remotePool, startDateStr) {
  console.log(`[Sync CEX Prog] Sincronizando agenda programada desde ${startDateStr}...`);
  const res = await remotePool.request()
    .input('startDate', startDateStr)
    .query(`
      SELECT No_Cita, No_Medico, Medico, Especialidad, NoPaciente, Paciente, DesdeFecha, HastaFecha, PCAP_ST_Descripcion 
      FROM UDR_CONSULTAS_PROG 
      WHERE DesdeFecha >= @startDate
    `);

  const records = res.recordset || [];
  let count = 0;

  for (const r of records) {
    await pool.query(`
      INSERT INTO dw_vertical_consultas_prog 
        (no_cita, no_medico, medico, especialidad, nopaciente, paciente, desdefecha, hastafecha, pcap_st_descripcion, sync_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (no_cita) DO UPDATE SET
        no_medico = EXCLUDED.no_medico,
        medico = EXCLUDED.medico,
        especialidad = EXCLUDED.especialidad,
        nopaciente = EXCLUDED.nopaciente,
        paciente = EXCLUDED.paciente,
        desdefecha = EXCLUDED.desdefecha,
        hastafecha = EXCLUDED.hastafecha,
        pcap_st_descripcion = EXCLUDED.pcap_st_descripcion,
        sync_date = CURRENT_TIMESTAMP;
    `, [
      r.No_Cita, r.No_Medico, r.Medico, r.Especialidad, r.NoPaciente, r.Paciente, r.DesdeFecha, r.HastaFecha, r.PCAP_ST_Descripcion
    ]);
    count++;
  }
  console.log(`[Sync CEX Prog] Sincronizados ${count} citas programadas.`);
}

/**
 * 11. Sincronizar SAP Ingresos por Grupos
 */
async function syncSapIngresosGrupos(startDateStr, endDateStr) {
  try {
    console.log(`[Sync SAP Grupos] Consultando ingresos de SAP desde ${startDateStr} hasta ${endDateStr}...`);
    await sapService._ensureSession();
    
    const records = await sapService.fetchAllPages(`/SQLQueries('sq_ingresos_grupos')/List?startDate='${startDateStr}'&endDate='${endDateStr}'`);
    let count = 0;

    for (const r of records) {
      if (!r.DocDate) continue;
      
      // Formatear DocDate (de YYYYMMDD a YYYY-MM-DD)
      let docDateFormatted = r.DocDate;
      if (r.DocDate.length === 8) {
        docDateFormatted = `${r.DocDate.substring(0,4)}-${r.DocDate.substring(4,6)}-${r.DocDate.substring(6,8)}`;
      }

      await pool.query(`
        INSERT INTO dw_sap_ingresos_grupos (itmsgrpcod, docdate, total, sync_date)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (itmsgrpcod, docdate) DO UPDATE SET
          total = EXCLUDED.total,
          sync_date = CURRENT_TIMESTAMP;
      `, [r.ItmsGrpCod, docDateFormatted, r.Total || 0]);
      count++;
    }
    console.log(`[Sync SAP Grupos] Sincronizados ${count} registros de ingresos por grupos.`);
  } catch (err) {
    console.error(`[Sync SAP Grupos] Error al sincronizar ingresos SAP por grupos:`, err.message);
  }
}

/**
 * Función principal para ejecutar la sincronización de todos los tableros
 */
async function syncAllDashboards(options = { fullSync: false }) {
  if (isSyncing) {
    console.log('⏳ Sincronización de tableros ya en progreso. Omitiendo ciclo...');
    return;
  }
  isSyncing = true;

  const tStart = Date.now();
  console.log(`\n🔄 [Sync DW Dashboards] Iniciando ciclo de sincronización (${options.fullSync ? 'Completo' : 'Incremental'})...`);

  try {
    const remotePool = await connectRemoteDB();
    
    // Calcular fecha límite
    let startDate;
    if (options.fullSync) {
      startDate = new Date('2026-04-01T00:00:00'); // Hard cutoff de la migración
    } else {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 15); // Ventana incremental de 15 días
    }
    const startDateStr = formatDate(startDate);
    const todayStr = formatDate(new Date());

    // Ejecutar cada sincronización secuencialmente para no saturar los pools
    await syncPC(remotePool, startDateStr).catch(e => console.error('❌ Error en Sync PC:', e.message));
    await syncPT(remotePool, startDateStr, options.fullSync).catch(e => console.error('❌ Error en Sync PT:', e.message));
    await syncPCIT(remotePool, startDateStr).catch(e => console.error('❌ Error en Sync PCIT:', e.message));
    await syncIndicadoresOperativos(remotePool).catch(e => console.error('❌ Error en Sync Indicadores:', e.message));
    await syncCuentasServicios(remotePool, startDateStr).catch(e => console.error('❌ Error en Sync CuentasServicios:', e.message));
    await syncProductividadMedicos(remotePool, startDateStr).catch(e => console.error('❌ Error en Sync Productividad:', e.message));
    await syncConsultaDia(remotePool, startDateStr).catch(e => console.error('❌ Error en Sync ConsultaDia:', e.message));
    await syncSolicitudesEstudios(remotePool, startDateStr).catch(e => console.error('❌ Error en Sync SolicitudesEstudios:', e.message));
    await syncPayIma(remotePool, startDateStr).catch(e => console.error('❌ Error en Sync PayIma:', e.message));
    await syncConsultasProg(remotePool, startDateStr).catch(e => console.error('❌ Error en Sync ConsultasProg:', e.message));
    
    // Sincronizar ingresos de SAP Service Layer
    await syncSapIngresosGrupos(startDateStr, todayStr);

    const duration = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`\n✅ [Sync DW Dashboards] Ciclo de sincronización completado exitosamente en ${duration}s.\n`);
  } catch (err) {
    console.error('❌ Error fatal en sincronización de DW Dashboards:', err.message);
  } finally {
    isSyncing = false;
  }
}

/**
 * Inicializador de cron jobs
 */
function initDashboardCron() {
  // Ejecutar sincronización incremental cada 15 minutos
  cron.schedule('*/15 * * * *', () => {
    syncAllDashboards({ fullSync: false });
  });
  console.log('⏰ Cron Job de DW Dashboards inicializado (Ejecución cada 15 min).');
}

module.exports = {
  syncAllDashboards,
  initDashboardCron
};
