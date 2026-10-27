'use strict';

const { connectRemoteDB, sql } = require('../config/remote-db');
const { SERVICE_CODES } = require('./statisticsCatalog');

const EMERGENCY_CONSULTATIONS = new Set(SERVICE_CODES.emergencyConsultations);
const STAY = new Set(SERVICE_CODES.stay);
const INTENSIVE = new Set(SERVICE_CODES.intensive);
const MAX_ROWS = 100000;

const BIRTHS_SQL = `
WITH FirstAdmission AS (
  SELECT 
    pc.PTNum,
    MIN(pc.CreatedOn) AS FirstPCCreatedOn,
    MIN(pc.Date) AS FirstPCDate,
    MIN(pc.BirthDate) AS FirstPCBirthDate,
    MAX(pc.Gender) AS PCGender
  FROM PC pc
  WHERE pc.PCType = 'IP'
  GROUP BY pc.PTNum
)
SELECT TOP (${MAX_ROWS + 1}) 
  pt.PTNum AS NoPaciente,
  COALESCE(fa.FirstPCBirthDate, pt.BirthDate) AS Fecha,
  COALESCE(fa.FirstPCBirthDate, pt.BirthDate) AS FechaNacimiento,
  DATEADD(hour, -6, COALESCE(
    CASE WHEN CONVERT(date, DATEADD(hour, -6, pt.CreatedOn)) = CONVERT(date, COALESCE(fa.FirstPCBirthDate, pt.BirthDate)) THEN pt.CreatedOn ELSE NULL END,
    fa.FirstPCCreatedOn,
    fa.FirstPCDate,
    pt.CreatedOn
  )) AS FechaCreacion,
  COALESCE(NULLIF(RTRIM(pt.FullName),''), 'RECIÉN NACIDO') AS Paciente,
  COALESCE(fa.PCGender, pt.Gender) AS Genero,
  pt.UDF_No_Expediente_Ant AS ExpedienteAnterior,
  pt.UDF_ORIGEN_IDENT AS OrigenIdentificacion,
  pt.IdType AS TipoIdentificacion,
  pt.Identification AS Identificacion,
  1 AS Cantidad
FROM PT pt
LEFT JOIN FirstAdmission fa ON fa.PTNum = pt.PTNum
WHERE 
  COALESCE(fa.FirstPCBirthDate, pt.BirthDate)>=@startDate 
  AND COALESCE(fa.FirstPCBirthDate, pt.BirthDate)<@endExclusive
  AND (
    pt.FullName LIKE 'RN %' 
    OR pt.FullName LIKE 'RECIEN NACID%' 
    OR pt.FullName LIKE 'RECIÉN NACID%'
    OR EXISTS (
      SELECT 1 FROM PC pc2 
      WHERE pc2.PTNum = pt.PTNum 
        AND (pc2.UDF_Diagnostico_presuntivo LIKE '%RECIEN NACID%' OR pc2.Notes LIKE '%RECI[EÉ]N NACID%')
    )
  )
ORDER BY FechaNacimiento, pt.PTNum`;

const SPECIALTY_CONSULTATIONS_SQL = `
SELECT TOP (${MAX_ROWS + 1}) Numero_Cita AS NumeroCita, Fecha,
 CONVERT(varchar(8),Hora,108) AS Hora, Numero_Paciente AS NoPaciente,
 Paciente, Folio_Medico AS NumeroMedico, Medico,
 MSDescription_ES AS Especialidad, Articulo AS Servicio,
 Estatus_Orden_Venta AS EstadoOrdenVenta, Edad_Anios AS Edad, 1 AS Cantidad
FROM V_UDR_CONSULTA_DIA
WHERE Fecha>=@startDate AND Fecha<@endExclusive
ORDER BY Fecha,Hora,Numero_Cita`;

const SPECIALTY_APPOINTMENTS_SQL = `
SELECT TOP (${MAX_ROWS + 1}) No_Cita AS NumeroCita, DesdeFecha AS Fecha,
 HastaFecha AS FechaFin, NoPaciente, Paciente, No_Medico AS NumeroMedico,
 Medico, Especialidad, UDF_Ejecutada AS Ejecutada,
 PCAP_ST_Descripcion AS EstadoCita, 1 AS Cantidad
FROM UDR_CONSULTAS_PROG
WHERE DesdeFecha>=@startDate AND DesdeFecha<@endExclusive
ORDER BY DesdeFecha,No_Cita`;

const CHARGES_SQL = `
WITH Catalog AS (
 SELECT ItemCode, MAX(ItemDescription) AS ItemDescription, MAX(ItemGroupCode) AS ItemGroupCode,
 COUNT(DISTINCT ItemGroupCode) AS GroupCount
 FROM V_IT WHERE ItemType = 'S' GROUP BY ItemCode
)
SELECT TOP (${MAX_ROWS + 1}) c.PCITNum AS NumeroCargo, c.PCNum AS FolioAtencion,
 p.PTNum AS NoPaciente, pt.FullName AS Paciente, pr.FullName AS Medico,
 c.ChargeDate AS Fecha, c.ItemCode AS Codigo, COALESCE(NULLIF(c.ItemDescription,''),i.ItemDescription,c.ItemCode) AS Servicio,
 c.Quantity AS CantidadOriginal, ISNULL(c.Returned,0) AS Devuelto,
 c.Quantity-ISNULL(c.Returned,0) AS Cantidad, c.PCType AS TipoAtencion,
 c.PCFRNum AS FolioEstancia, c.SUCode AS UnidadServicio,
 i.ItemGroupCode AS GrupoCodigo, i.GroupCount AS ClasificacionesCatalogo
FROM PCIT c INNER JOIN PC p ON p.PCNum=c.PCNum
LEFT JOIN PT pt ON pt.PTNum=p.PTNum
LEFT JOIN PR pr ON pr.PRNum=p.PRNum
INNER JOIN Catalog i ON i.ItemCode=c.ItemCode
WHERE c.ChargeDate>=@startDate AND c.ChargeDate<@endExclusive
 AND c.PCIT_ST='CH' AND p.PC_ST IN ('OP','CL','PD')
 AND c.Quantity>ISNULL(c.Returned,0)
ORDER BY c.ChargeDate,c.PCITNum`;

const ACCOUNTS_SQL = `
SELECT TOP (${MAX_ROWS + 1}) p.PCNum AS FolioAtencion, p.PTNum AS NoPaciente,
 pt.FullName AS Paciente, pr.FullName AS Medico,
 p.MedicalDischargeDate AS Fecha, p.MedicalDischargeDate AS FechaEgreso, p.Date AS FechaIngreso, p.PCType AS TipoAtencion,
 p.PC_ST AS EstadoCuenta, p.Gender AS Genero,
 CASE WHEN p.BirthDate IS NOT NULL AND p.BirthDate<=p.MedicalDischargeDate THEN
 DATEDIFF(year,p.BirthDate,p.MedicalDischargeDate)-CASE WHEN DATEADD(year,DATEDIFF(year,p.BirthDate,p.MedicalDischargeDate),p.BirthDate)>p.MedicalDischargeDate THEN 1 ELSE 0 END END AS Edad,
 CASE WHEN p.Date IS NOT NULL AND p.Date<=p.MedicalDischargeDate THEN DATEDIFF(day,p.Date,p.MedicalDischargeDate) END AS DiasEstancia,
 CASE WHEN p.MedicalDischarge IN ('DEF','DEFUNCION','MD003') OR p.DateOfDeath IS NOT NULL THEN 1 ELSE 0 END AS Defuncion,
 CASE WHEN EXISTS (SELECT 1 FROM PCAG ag WHERE ag.PCNum=p.PCNum AND ag.AGCode='VAGSEG001' AND ag.PCAG_ST='AU') THEN 1 ELSE 0 END AS VaSeguro,
 1 AS Cantidad
FROM PC p
LEFT JOIN PT pt ON pt.PTNum=p.PTNum
LEFT JOIN PR pr ON pr.PRNum=p.PRNum
WHERE p.MedicalDischargeDate>=@startDate AND p.MedicalDischargeDate<@endExclusive AND p.PC_ST='CL'
ORDER BY p.MedicalDischargeDate,p.PCNum`;

const OPERATING_ROOM_ACTIVITY_SQL = `
WITH ChargedAccounts AS (
 SELECT FOLIO_DE_ATENCION AS FolioAtencion,CONVERT(date,FECHA_DE_CARGO) AS DiaCargo,
 MIN(FECHA_DE_CARGO) AS Fecha,MAX(FECHA_DE_CARGO) AS FechaUltimoCargo,
 MAX(NOMBRE_DEL_PACIENTE) AS Paciente,MAX(Medico_Tratante) AS MedicoCargo,
 COUNT(*) AS CargosCQX,SUM(TRY_CONVERT(decimal(19,4),CANTIDAD)) AS UnidadesCargo,
 STRING_AGG(CAST(DESCRIPCION_DEL_ARTICULO AS nvarchar(max)), ', ') AS Servicio
 FROM UDR_CUENTAS_SERVICIOS
 WHERE UNIDAD_DE_SERVICIO='CQX' AND FECHA_DE_CARGO>=@startDate AND FECHA_DE_CARGO<@endExclusive
 GROUP BY FOLIO_DE_ATENCION,CONVERT(date,FECHA_DE_CARGO)
)
SELECT TOP (${MAX_ROWS + 1}) a.FolioAtencion,a.Fecha,a.FechaUltimoCargo,a.Paciente,
 COALESCE(u.Quirofano,'CQX') AS Quirofano,COALESCE(u.Medicos,a.MedicoCargo) AS Medico,
 a.Servicio,u.Procedimientos AS ProcedimientoBitacora,u.PCFRNum AS FolioEstancia,
 u.FechaInicio AS FechaInicioBitacora,u.FechaFin AS FechaFinBitacora,
 CASE WHEN u.PCFRNum IS NULL THEN 'Facturado sin registro en Quirófano (Consultorio/Omisión)' ELSE 'Cirugía Registrada' END AS EstadoRegistro,
 a.CargosCQX,a.UnidadesCargo,'CQX' AS UnidadServicio,1 AS Cantidad
FROM ChargedAccounts a
OUTER APPLY (
 SELECT TOP 1 PCFRNum,FechaInicio,FechaFin,Quirofano,Procedimientos,Medicos
 FROM UDR_USOQX
 WHERE Paciente=a.Paciente AND FechaInicio>=DATEADD(day,-3,a.Fecha) AND FechaInicio<=DATEADD(day,3,a.Fecha)
 ORDER BY FechaInicio DESC,PCFRNum DESC
) u
ORDER BY a.Fecha,a.FolioAtencion`;

const SURGERIES_SQL = `
WITH SurgeryAnchors AS (
 SELECT DISTINCT candidate.PCFRNum FROM UDR_USOQX candidate
 WHERE candidate.FechaInicio>=@startDate AND candidate.FechaInicio<@endExclusive
 AND NOT EXISTS (SELECT 1 FROM UDR_USOQX earlier WHERE earlier.PCFRNum=candidate.PCFRNum AND earlier.FechaInicio<@startDate)
)
SELECT TOP (${MAX_ROWS + 1}) v.PCFRNum AS FolioEstancia,p.PCNum AS FolioAtencion,
 p.PTNum AS NoPaciente,
 MAX(COALESCE(NULLIF(RTRIM(v.Paciente),''), pt.FullName)) AS Paciente,
 MIN(v.FechaInicio) AS Fecha,MAX(v.FechaFin) AS FechaFin,
 MAX(v.Quirofano) AS Quirofano,
 MAX(COALESCE(v.Medicos, pr.FullName)) AS Medico,
 MAX(COALESCE(v.Procedimientos, p.Notes)) AS Servicio,
 MAX(CASE WHEN v.Procedimientos COLLATE Latin1_General_CI_AI LIKE '%ENDOSCOPIA%'
   OR v.Procedimientos COLLATE Latin1_General_CI_AI LIKE '%PANENDOSCOPIA%'
   OR v.Procedimientos COLLATE Latin1_General_CI_AI LIKE '%COLONOSCOPIA%'
   OR v.Procedimientos COLLATE Latin1_General_CI_AI LIKE '%BRONCOSCOPIA%' THEN 1 ELSE 0 END) AS ProcedimientoEndoscopico,
 MAX(CASE WHEN NULLIF(LTRIM(RTRIM(v.Procedimientos)),'') IS NULL THEN 1 ELSE 0 END) AS ProcedimientoSinClasificar,
 COUNT(*) AS TecnicasRegistradas,
 MAX(p.PCType) AS TipoAtencion,MAX(p.Date) AS FechaIngreso,MAX(p.MedicalDischargeDate) AS FechaEgreso,
 MAX(p.PC_ST) AS EstadoCuenta,1 AS Cantidad
FROM UDR_USOQX v INNER JOIN SurgeryAnchors anchor ON anchor.PCFRNum=v.PCFRNum
INNER JOIN PCFR fr ON fr.PCFRNum=v.PCFRNum INNER JOIN PC p ON p.PCNum=fr.PCNum
LEFT JOIN PT pt ON pt.PTNum=p.PTNum
LEFT JOIN PR pr ON pr.PRNum=p.PRNum
WHERE fr.PCFR_ST<>'CA' AND p.PC_ST IN ('OP','CL','PD')
GROUP BY v.PCFRNum,p.PCNum,p.PTNum ORDER BY MIN(v.FechaInicio),v.PCFRNum`;

function section(rows, unit, criterion, warnings = []) {
  return { rows, quantity: rows.reduce((sum,row) => sum + Number(row.Cantidad || 0),0), unit, criterion, warnings,
    rowCount: rows.length, attentionCount: new Set(rows.map(r=>r.FolioAtencion).filter(v=>v!=null)).size };
}
function countedServices(rows, criterion, warnings = []) {
  const result = section(rows, 'registros de servicio', criterion, warnings);
  result.unitQuantity = result.quantity;
  result.quantity = result.rowCount;
  result.measure = 'rowCount';
  return result;
}
function unavailable(unit, criterion, warning) {
  return { rows: [], quantity: null, unit, criterion, warnings: [warning], status: 'pending_validation' };
}
function uniqueBy(rows,key) {
  const seen=new Set();
  return rows.filter(row=>{const value=row[key];if(seen.has(value))return false;seen.add(value);return true;});
}
function calendarDate(value) {
  if(value instanceof Date)return Number.isFinite(value.getTime())?`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`:null;
  return /^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10):null;
}
function isSameDayDischarge(row) {
  const admission=calendarDate(row.FechaIngreso),discharge=calendarDate(row.FechaEgreso);
  return row.EstadoCuenta==='CL'&&admission!==null&&admission===discharge
    &&new Date(row.FechaIngreso).getTime()<=new Date(row.FechaEgreso).getTime();
}
function operatingRoomActivityRows(rows) {
  if (!Array.isArray(rows)) return null;
  const anchors = new Map();
  for (const row of rows) {
    const day = calendarDate(row.Fecha);
    if (row.FolioAtencion == null || String(row.FolioAtencion).trim() === '' || day === null) {
      throw new Error('La actividad de quirófano no conserva el folio y la fecha de cargo de cada atención.');
    }
    const identifier = `${String(row.FolioAtencion)}:${day}`;
    if (!anchors.has(identifier)) anchors.set(identifier, row);
  }
  const accounts = new Map();
  for (const row of [...anchors.values()].sort((a,b) => new Date(a.Fecha) - new Date(b.Fecha))) {
    const identifier = String(row.FolioAtencion), current = accounts.get(identifier);
    if (!current) {
      accounts.set(identifier, { ...row, FechaCargo: row.Fecha, Cantidad: 1 });
      continue;
    }
    for (const key of ['CargosCQX', 'UnidadesCargo']) {
      current[key] = current[key] == null || row[key] == null ? undefined : Number(current[key]) + Number(row[key]);
    }
    if (row.Servicio) current.Servicio = [current.Servicio, row.Servicio].filter(Boolean).join(', ');
    if (row.FechaUltimoCargo && (!current.FechaUltimoCargo || new Date(row.FechaUltimoCargo) > new Date(current.FechaUltimoCargo))) {
      current.FechaUltimoCargo = row.FechaUltimoCargo;
    }
  }
  return [...accounts.values()];
}
function endoscopicClassification(row) {
  const flag = row.ProcedimientoEndoscopico;
  if (flag === 1 || flag === '1' || flag === true) return true;
  if (flag === 0 || flag === '0' || flag === false) {
    return [1,'1',true].includes(row.ProcedimientoSinClasificar) ? null : false;
  }
  if (typeof row.Servicio !== 'string' || !row.Servicio.trim()) return null;
  const description = row.Servicio.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return /\b(?:ENDOSCOPIAS?|PANENDOSCOPIAS?|COLONOSCOPIAS?|BRONCOSCOPIAS?)\b/.test(description);
}
function buildClinicalStatistics({ charges, accounts, surgeries, births = [], specialtyConsultations, specialtyAppointments, operatingRoomActivity }) {
  const charged = uniqueBy(charges,'NumeroCargo').filter(r=>Number(r.Cantidad)>0);
  const discharge = uniqueBy(accounts,'FolioAtencion');
  const operations = uniqueBy(surgeries,'FolioEstancia');
  const operatingActivity = operatingRoomActivityRows(operatingRoomActivity);
  const endoscopic = operations.filter(row => endoscopicClassification(row) === true);
  const unclassifiedProcedures = operations.filter(row => endoscopicClassification(row) === null).length;
  const newborns = uniqueBy(births.filter(row => calendarDate(row.FechaNacimiento) !== null
    && calendarDate(row.FechaNacimiento) === calendarDate(row.FechaCreacion)), 'NoPaciente');
  for (const source of [specialtyConsultations, specialtyAppointments]) {
    if (Array.isArray(source) && source.some(row => row.NumeroCita == null || String(row.NumeroCita).trim() === '')) {
      throw new Error('La consulta de especialidad no conserva el identificador de cada cita.');
    }
  }
  const consultations = Array.isArray(specialtyConsultations)
    ? uniqueBy(specialtyConsultations, 'NumeroCita').map(row => ({ ...row, Cantidad: 1 })) : null;
  const programmed = Array.isArray(specialtyAppointments)
    ? uniqueBy(specialtyAppointments, 'NumeroCita').map(row => ({ ...row, Cantidad: 1 })) : null;
  const catalogAmbiguities = charged.filter(r=>Number(r.ClasificacionesCatalogo)>1).length;
  const serviceCriterion = 'Fecha de cargo; cargos vigentes; cantidad original menos devoluciones; una fila por cargo.';
  const hospital = discharge.filter(r=>r.TipoAtencion==='IP');
  const emergency = discharge.filter(r=>r.TipoAtencion==='ER');
  const relevantDischarges = discharge.filter(r=>r.TipoAtencion==='IP'||r.TipoAtencion==='ER');
  const ages = relevantDischarges.map(r=>r.Edad).filter(n=>n!==null&&n!==undefined&&Number.isFinite(Number(n)));
  const knownGender = relevantDischarges.filter(r=>['F','M','FEMENINO','MASCULINO'].includes(r.Genero));
  const hospitalDays = hospital.map(r=>r.DiasEstancia).filter(n=>n!==null&&n!==undefined&&Number.isFinite(Number(n)));
  const studyWarnings = ['Incluye servicios cargados a hospitalización y urgencias. Los estudios externos vendidos por órdenes se concilian por separado en SAP. Un cargo no acredita por sí mismo la realización del estudio.'];
  if(catalogAmbiguities)studyWarnings.push(`${catalogAmbiguities} cargos tienen clasificación de catálogo ambigua y se excluyeron de los grupos de estudios.`);
  const sections = {
    births: section(newborns,'recién nacidos','Pacientes cuyo expediente fue creado en la misma fecha calendario que su fecha de nacimiento; ambas fechas deben estar dentro del periodo seleccionado. Se cuenta una vez por paciente.'),
    hospital: section(hospital,'cuentas','Alta médica dentro del periodo, cuenta cerrada y tipo hospitalización.'),
    emergencyAccounts: section(emergency,'cuentas','Alta médica dentro del periodo, cuenta cerrada y tipo urgencias.'),
    vasSeguro: section(discharge.filter(r=>Number(r.VaSeguro)===1),'cuentas','Alta médica dentro del periodo, cuenta cerrada y convenio VASEGURO PAQUETE autorizado; excluye convenios cancelados.'),
    emergencyConsultations: countedServices(charged.filter(r=>EMERGENCY_CONSULTATIONS.has(r.Codigo)),`${serviceCriterion} Se cuenta una fila por servicio, como Cuenta de Servicio en el pivote base; la suma de unidades se conserva por separado. Consultas de adulto, pediatría y especialidad en urgencias; excluye interconsultas.`),
    stay: countedServices(charged.filter(r=>STAY.has(r.Codigo)),`${serviceCriterion} Se cuenta una fila por servicio de estancia hospitalaria, ambulatoria o cunero. Excluye terapia intensiva, intermedia y neonatal, que se presenta por separado, y estancia por hora de urgencias.`,['El recuento de registros, la suma de unidades y las atenciones son métricas distintas; ninguna equivale automáticamente a días calendario de hospitalización.']),
    intensive: countedServices(charged.filter(r=>INTENSIVE.has(r.Codigo)),`${serviceCriterion} Se cuenta una fila por servicio de terapia, como el pivote base. Incluye cuidados intensivos, intermedios y neonatales; la suma de unidades se conserva por separado.`),
    operatingRoom: operatingActivity === null
      ? unavailable('atenciones','Una atención con cargos en CQX por fecha de cargo, con su registro de bitácora cuando existe.','No se consultó el conjunto institucional de actividad en CQX para este periodo.')
      : section(operatingActivity,'atenciones','Una atención distinta con al menos un registro de cargo en CQX durante el periodo. La fecha de selección es la fecha del cargo; la bitácora se vincula por paciente dentro de tres días y sus fechas se conservan por separado. Incluye los estados y devoluciones de la vista institucional, como el reporte de actividad de quirófano.', ['Una atención con cargos en CQX no acredita por sí sola presencia física en quirófano ni un procedimiento ejecutado. Los meses originales anteriores a septiembre usaron recuentos de líneas SAP y requieren su alcance propio de conciliación.']),
    ambulatory: { ...(unclassifiedProcedures
      ? unavailable('registros de procedimiento','Asignaciones de quirófano que incluyen endoscopía, panendoscopía, colonoscopía o broncoscopía, una vez por asignación y fecha de inicio.',`No se pudo clasificar el procedimiento de ${unclassifiedProcedures} asignaciones; no se publica un total completo con esa información pendiente.`)
      : section(endoscopic,'registros de procedimiento','Asignaciones de quirófano con endoscopía, panendoscopía, colonoscopía o broncoscopía en cualquiera de sus técnicas. Se cuenta una vez cada asignación por su fecha de inicio, aunque incluya dos técnicas. CPRE no se incluye por sí sola. El criterio corresponde al listado y los filtros de procedimientos del registro institucional.', ['El recuento identifica registros de procedimientos; no certifica su ejecución clínica ni que la cuenta haya sido ambulatoria.'])),
      sourceRows: operations, sourceQuantity: operations.length, unclassifiedQuantity: unclassifiedProcedures },
    specialty: consultations === null
      ? unavailable('consultas','Consultas registradas en V_UDR_CONSULTA_DIA por fecha de consulta y número de cita; conserva todos los estados de orden.','No se consultó el registro de consultas de especialidad para este periodo.')
      : section(consultations,'consultas','Una consulta por número de cita y fecha de consulta en V_UDR_CONSULTA_DIA. Incluye todos los estados de orden, aun cuando la cita esté cancelada en la agenda; no exige ejecución ni pago confirmado. Las reprogramaciones en la fuente pueden modificar la distribución mensual.'),
    specialtyScheduled: programmed === null
      ? unavailable('consultas programadas','Citas de UDR_CONSULTAS_PROG por fecha programada; ejecutadas y no ejecutadas.','No se consultó el registro de consultas programadas para este periodo.')
      : section(programmed,'consultas programadas','Complemento de agenda: una cita por identificador y fecha programada en UDR_CONSULTAS_PROG, conservando ejecución y estado. Su población es distinta del indicador institucional de consultas de especialidad.'),
    image: section(charged.filter(r=>r.GrupoCodigo==='117'&&Number(r.ClasificacionesCatalogo)===1),'estudios cargados',`${serviceCriterion} Catálogo de imagenología.`,studyWarnings),
    lab: section(charged.filter(r=>r.GrupoCodigo==='101'&&Number(r.ClasificacionesCatalogo)===1),'estudios cargados',`${serviceCriterion} Catálogo de laboratorio.`,studyWarnings),
    surgeries: { ...section(operations,'registros de cirugía','Asignaciones de quirófano vigentes por fecha de inicio; una fila por estancia, incluidos los procedimientos endoscópicos. No se excluyen registros por el texto de su procedimiento.', ['El registro identifica asignaciones de quirófano; se requiere validar los procedimientos ejecutados para certificar clínicamente el número de cirugías.']),
      sourceRows: operations, sourceQuantity: operations.length, excludedQuantity: 0 },
    shock: unavailable('atenciones','Servicios de sala de choque registrados en SAP.','Pendiente de la consulta financiera de SAP.'),
    covid: unavailable('casos','Diagnóstico confirmado de COVID-19.','No se encontró una fuente validada para contabilizar casos confirmados de COVID-19.')
  };
  const operatingRoomAccounts = section(uniqueBy(operations,'FolioAtencion').map(row=>({...row,EstanciasQuirofano:operations.filter(event=>event.FolioAtencion===row.FolioAtencion).length})),'atenciones','Atenciones con asignación de quirófano vigente por fecha de inicio; una vez por atención. Es un complemento, no el indicador institucional de personas con uso de quirófano.');
  const operatingRoomChargeAccounts = section(uniqueBy(charged.filter(row=>row.UnidadServicio==='CQX'&&row.FolioAtencion!=null),'FolioAtencion').map(row=>({...row,Cantidad:1})),'atenciones','Atenciones con al menos un cargo vigente en CQX por fecha de cargo. Es un complemento de actividad facturada, no acredita presencia física ni sustituye el indicador institucional.');
  const sameDayProcedures = section(operations.filter(isSameDayDischarge),'asignaciones','Asignaciones de quirófano cuya cuenta cerrada tiene ingreso y alta en la misma fecha calendario; una fila por estancia. Es un complemento y no identifica los conceptos de UCAMB.');
  return { sections, complements: { operatingRoomAccounts, operatingRoomChargeAccounts, sameDayProcedures }, general: {
    TotalEgresos: relevantDischarges.length,
    PromedioEdad: ages.length?Math.round(ages.reduce((s,n)=>s+Number(n),0)/ages.length*10)/10:null,
    pctFemenino: knownGender.length?Math.round(knownGender.filter(r=>r.Genero==='F'||r.Genero==='FEMENINO').length/knownGender.length*1000)/10:null,
    Defunciones: relevantDischarges.reduce((s,r)=>s+Number(r.Defuncion||0),0),
    EstanciaPromedio: hospitalDays.length?Math.round(hospitalDays.reduce((s,n)=>s+Number(n),0)/hospitalDays.length*10)/10:null
  }, warnings: catalogAmbiguities?[`${catalogAmbiguities} cargos requieren revisar su clasificación de servicio.`]:[] };
}

function validateRange({startDate,endExclusive}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(endExclusive||'')||startDate>=endExclusive)throw new Error('Periodo estadístico inválido.');
  for(const value of [startDate,endExclusive]){
    const parsed=new Date(`${value}T00:00:00.000Z`);
    if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw new Error('Periodo estadístico inválido.');
  }
}
async function getClinicalStatistics(range, options = {}) {
  validateRange(range);
  const pool=await connectRemoteDB();
  const read=async(query)=>{
    const request=pool.request(); request.timeout=60000;
    if(options.signal?.aborted)throw new Error('Extracción clínica cancelada.');

    request.input('startDate',sql.VarChar(10),range.startDate); request.input('endExclusive',sql.VarChar(10),range.endExclusive);
    const cancel=()=>request.cancel();
    options.signal?.addEventListener('abort',cancel,{once:true});
    let result;
    try{result=await request.query(query);if(options.signal?.aborted)throw new Error('Extracción clínica cancelada.');}
    finally{options.signal?.removeEventListener('abort',cancel);}
    if(result.recordset.length>MAX_ROWS)throw new Error('El periodo supera el límite de registros. Selecciona un periodo menor.');
    return result.recordset;
  };
  const [charges,accounts,surgeries,births,specialtyConsultations,specialtyAppointments,operatingRoomActivity]=await Promise.all([read(CHARGES_SQL),read(ACCOUNTS_SQL),read(SURGERIES_SQL),read(BIRTHS_SQL),read(SPECIALTY_CONSULTATIONS_SQL),read(SPECIALTY_APPOINTMENTS_SQL),read(OPERATING_ROOM_ACTIVITY_SQL)]);
  const raw={charges,accounts,surgeries,births,specialtyConsultations,specialtyAppointments,operatingRoomActivity};
  return {...buildClinicalStatistics(raw),...(options.includeRaw?{_raw:raw}:{})};
}

async function getAccountClassifications(folios, options = {}) {
  const ids=[...new Set((folios||[]).map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))];
  const result={};
  if(!ids.length)return result;
  const pool=await connectRemoteDB();
  for(let offset=0;offset<ids.length;offset+=1000){
    const request=pool.request();request.timeout=30000;
    if(options.signal?.aborted)throw new Error('Clasificación de cuentas cancelada.');
    const batch=ids.slice(offset,offset+1000);
    batch.forEach((id,index)=>request.input(`folio${index}`,sql.Int,id));
    const cancel=()=>request.cancel();options.signal?.addEventListener('abort',cancel,{once:true});
    let rows;
    try{rows=await request.query(`SELECT p.PCNum AS FolioAtencion,p.PTNum AS NoPaciente,pt.FullName AS Paciente,p.PCType AS TipoAtencion,p.PRNum AS NumeroMedico,pr.FullName AS Medico FROM PC p LEFT JOIN PT pt ON pt.PTNum=p.PTNum LEFT JOIN PR pr ON pr.PRNum=p.PRNum WHERE p.PCNum IN (${batch.map((_,index)=>`@folio${index}`).join(',')})`);}
    finally{options.signal?.removeEventListener('abort',cancel);}
    for(const row of rows.recordset)result[String(row.FolioAtencion)]={TipoAtencion:row.TipoAtencion,NumeroMedico:row.NumeroMedico,Medico:row.Medico,NoPaciente:row.NoPaciente,Paciente:row.Paciente};
  }
  return result;
}

module.exports={ getClinicalStatistics, getAccountClassifications, buildClinicalStatistics,
  EMERGENCY_CONSULTATIONS,STAY,INTENSIVE,BIRTHS_SQL,SPECIALTY_CONSULTATIONS_SQL,SPECIALTY_APPOINTMENTS_SQL,CHARGES_SQL,ACCOUNTS_SQL,OPERATING_ROOM_ACTIVITY_SQL,SURGERIES_SQL };
