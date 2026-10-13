'use strict';

const { connectRemoteDB, sql } = require('../config/remote-db');

// Codes checked against the live Vertical catalogue on 2026-10-07.
const EMERGENCY_CONSULTATIONS = new Set(['SER0508', 'SER0509', 'SER0510', 'SER0511', 'SER0526', 'SER0527', 'SER0528', 'SER0529', 'SER1272', 'SER1278']);
const STAY = new Set(['SER0653', 'SER0654', 'SER0657', 'SER0658', 'SER0660', 'SER0661', 'SER0662', 'SER0663', 'SER1234', 'SER1286']);
const INTENSIVE = new Set(['SER0658', 'SER0660', 'SER0661', 'SER0662', 'SER0663']);
const MAX_ROWS = 100000;

const BIRTHS_SQL = `
SELECT TOP (${MAX_ROWS + 1}) pt.PTNum AS NoPaciente, pt.BirthDate AS Fecha,
 pt.BirthDate AS FechaNacimiento,
 pt.CreatedOn AS FechaCreacion,
 COALESCE(NULLIF(RTRIM(pt.FullName),''), 'RECIÉN NACIDO') AS Paciente,
 pt.Gender AS Genero,
 pt.UDF_No_Expediente_Ant AS ExpedienteAnterior,
 pt.UDF_ORIGEN_IDENT AS OrigenIdentificacion,
 pt.IdType AS TipoIdentificacion,
 pt.Identification AS Identificacion,
 1 AS Cantidad
FROM PT pt
WHERE pt.CreatedOn>=@startDate AND pt.CreatedOn<@endExclusive
 AND pt.BirthDate>=@startDate AND pt.BirthDate<@endExclusive
 AND CONVERT(date,pt.CreatedOn)=CONVERT(date,pt.BirthDate)
ORDER BY pt.CreatedOn,pt.PTNum`;

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

const SURGERIES_SQL = `
SELECT TOP (${MAX_ROWS + 1}) v.PCFRNum AS FolioEstancia,p.PCNum AS FolioAtencion,
 p.PTNum AS NoPaciente,
 COALESCE(NULLIF(RTRIM(v.Paciente),''), pt.FullName) AS Paciente,
 MIN(v.FechaInicio) AS Fecha,MAX(v.FechaFin) AS FechaFin,
 MAX(v.Quirofano) AS Quirofano,
 MAX(COALESCE(v.Medicos, pr.FullName)) AS Medico,
 MAX(COALESCE(v.Procedimientos, p.Notes)) AS Servicio,
 MAX(p.PCType) AS TipoAtencion,MAX(p.Date) AS FechaIngreso,MAX(p.MedicalDischargeDate) AS FechaEgreso,
 MAX(p.PC_ST) AS EstadoCuenta,1 AS Cantidad
FROM UDR_USOQX v INNER JOIN PCFR fr ON fr.PCFRNum=v.PCFRNum INNER JOIN PC p ON p.PCNum=fr.PCNum
LEFT JOIN PT pt ON pt.PTNum=p.PTNum
LEFT JOIN PR pr ON pr.PRNum=p.PRNum
WHERE v.FechaInicio>=@startDate AND v.FechaInicio<@endExclusive
 AND fr.PCFR_ST<>'CA' AND p.PC_ST IN ('OP','CL','PD')
GROUP BY v.PCFRNum,p.PCNum,p.PTNum,v.Paciente,pt.FullName ORDER BY MIN(v.FechaInicio),v.PCFRNum`;

function section(rows, unit, criterion, warnings = []) {
  return { rows, quantity: rows.reduce((sum,row) => sum + Number(row.Cantidad || 0),0), unit, criterion, warnings,
    rowCount: rows.length, attentionCount: new Set(rows.map(r=>r.FolioAtencion).filter(v=>v!=null)).size };
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
function buildClinicalStatistics({ charges, accounts, surgeries, births = [] }) {
  const charged = uniqueBy(charges,'NumeroCargo').filter(r=>Number(r.Cantidad)>0);
  const discharge = uniqueBy(accounts,'FolioAtencion');
  const operations = uniqueBy(surgeries,'FolioEstancia');
  const newborns = uniqueBy(births.filter(row => calendarDate(row.FechaNacimiento) !== null
    && calendarDate(row.FechaNacimiento) === calendarDate(row.FechaCreacion)), 'NoPaciente');
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
    emergencyConsultations: section(charged.filter(r=>EMERGENCY_CONSULTATIONS.has(r.Codigo)),'servicios de consulta',`${serviceCriterion} Consultas de adulto, pediatría y especialidad en urgencias; excluye interconsultas.`),
    stay: section(charged.filter(r=>STAY.has(r.Codigo)),'servicios de estancia',`${serviceCriterion} Incluye privados, cuneros, cuidados intensivos, intermedios y estancia ambulatoria; excluye estancia por hora de urgencias.`,['La cantidad suma las unidades de los servicios. El número de cargos y las atenciones son métricas distintas; no equivale a días calendario de hospitalización.']),
    intensive: section(charged.filter(r=>INTENSIVE.has(r.Codigo)),'servicios de terapia',`${serviceCriterion} Estancia en cuidados intensivos, intermedios y neonatales; excluye ambulancias, insumos e interconsultas.`),
    operatingRoom: section(uniqueBy(operations,'FolioAtencion').map(row=>({...row,EstanciasQuirofano:operations.filter(event=>event.FolioAtencion===row.FolioAtencion).length})),'atenciones','Atenciones con estancia de quirófano registrada en el periodo; excluye cuentas y estancias canceladas.'),
    ambulatory: section(operations.filter(isSameDayDischarge),'estancias de procedimiento ambulatorio','Procedimientos registrados en quirófano cuya cuenta cerrada tiene ingreso y alta médica en la misma fecha calendario. Se filtra por fecha de inicio del procedimiento, con una fila por estancia.', ['El detalle conserva todas las técnicas registradas en cada estancia. Varias técnicas en una misma estancia cuentan como una estancia; los procedimientos sin registro de quirófano no están acreditados en esta fuente.']),
    specialty: unavailable('consultas','Registro de consulta y estado de prestación confirmado.','La vista de consultas puede contener citas pendientes. Falta comprobar el estado de realización; no se presenta la agenda como consultas realizadas.'),
    image: section(charged.filter(r=>r.GrupoCodigo==='117'&&Number(r.ClasificacionesCatalogo)===1),'estudios cargados',`${serviceCriterion} Catálogo de imagenología.`,studyWarnings),
    lab: section(charged.filter(r=>r.GrupoCodigo==='101'&&Number(r.ClasificacionesCatalogo)===1),'estudios cargados',`${serviceCriterion} Catálogo de laboratorio.`,studyWarnings),
    surgeries: section(operations,'estancias de quirófano','Una estancia de quirófano registrada, por fecha de inicio; varias técnicas en la misma estancia no se cuentan como cirugías independientes.', ['El registro identifica estancias de quirófano; se requiere validar los procedimientos ejecutados para certificar el número de cirugías.']),
    shock: unavailable('atenciones','Servicios de sala de choque registrados en SAP.','Pendiente de la consulta financiera de SAP.'),
    covid: unavailable('casos','Diagnóstico confirmado de COVID-19.','No se encontró una fuente validada para contabilizar casos confirmados de COVID-19.')
  };
  return { sections, general: {
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
async function getClinicalStatistics(range) {
  validateRange(range);
  const pool=await connectRemoteDB();
  const read=async(query)=>{
    const request=pool.request(); request.timeout=60000;
    // Passing an ISO string as sql.Date with useUTC:false moves midnight back
    // one day in Mexico. ISO date-only text is converted by SQL Server itself.
    request.input('startDate',sql.VarChar(10),range.startDate); request.input('endExclusive',sql.VarChar(10),range.endExclusive);
    const result=await request.query(query);
    if(result.recordset.length>MAX_ROWS)throw new Error('El periodo supera el límite de registros. Selecciona un periodo menor.');
    return result.recordset;
  };
  const [charges,accounts,surgeries,births]=await Promise.all([read(CHARGES_SQL),read(ACCOUNTS_SQL),read(SURGERIES_SQL),read(BIRTHS_SQL)]);
  return buildClinicalStatistics({charges,accounts,surgeries,births});
}

async function getAccountClassifications(folios) {
  const ids=[...new Set((folios||[]).map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))];
  const result={};
  if(!ids.length)return result;
  const pool=await connectRemoteDB();
  for(let offset=0;offset<ids.length;offset+=1000){
    const request=pool.request();request.timeout=30000;
    const batch=ids.slice(offset,offset+1000);
    batch.forEach((id,index)=>request.input(`folio${index}`,sql.Int,id));
    const rows=await request.query(`SELECT p.PCNum AS FolioAtencion,p.PTNum AS NoPaciente,pt.FullName AS Paciente,p.PCType AS TipoAtencion,p.PRNum AS NumeroMedico,pr.FullName AS Medico FROM PC p LEFT JOIN PT pt ON pt.PTNum=p.PTNum LEFT JOIN PR pr ON pr.PRNum=p.PRNum WHERE p.PCNum IN (${batch.map((_,index)=>`@folio${index}`).join(',')})`);
    for(const row of rows.recordset)result[String(row.FolioAtencion)]={TipoAtencion:row.TipoAtencion,NumeroMedico:row.NumeroMedico,Medico:row.Medico,NoPaciente:row.NoPaciente,Paciente:row.Paciente};
  }
  return result;
}

module.exports={ getClinicalStatistics, getAccountClassifications, buildClinicalStatistics,
  EMERGENCY_CONSULTATIONS,STAY,INTENSIVE,BIRTHS_SQL,CHARGES_SQL,ACCOUNTS_SQL,SURGERIES_SQL };
