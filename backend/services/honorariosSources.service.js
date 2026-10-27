'use strict';

const { createHash } = require('node:crypto');
const { isExcludedHonorariosService } = require('../utils/honorariosScope');

const CONTACT_CENTER_CODES = new Set(['SER1467', 'SER1470', 'SER1471']);
const ANESTHESIA_CODES = new Set(['SER1259', 'SER1260', 'SER1261', 'SER1262']);
const EXCLUDED_GROUP_SQL = "'ALMACEN GENERAL','FARMACIA','LABORATORIO','ESTUDIOS DE LABORATORIO','ALIAS','PAQUETE DE CIRUGIA','ARRENDAMIENTO','DONATIVOS','ESCUELA DE ENFERMERIA','INGRESOS ADMINISTRATIVOS','INSUMOS CONSULTA EXTERNA','SERVICIOS DE CEYE'";

const ORDER_CANDIDATES_SQL = `
  WITH Items AS (
    SELECT ItemCode,MIN(ItemDescription) ItemDescription,MIN(ItemGroupName) ItemGroupName,
      MIN(ItemType) ItemType FROM V_IT GROUP BY ItemCode
  ), AppointmentLinks AS (
    SELECT a.SONum,a.PCAPNum FROM PCAP a WHERE a.SONum>0
    UNION
    SELECT s.SONum,a.PCAPNum FROM SO s JOIN PCAP a ON a.PCAPNum=s.PCAPNum
      WHERE ISNULL(a.SONum,0)=0
  ), AppointmentCounts AS (
    SELECT SONum,COUNT(*) AppointmentCount FROM AppointmentLinks GROUP BY SONum
  ), ServiceLines AS (
    SELECT l.SONum,COUNT(*) ServiceLineCount FROM SOLN l
      LEFT JOIN Items i ON i.ItemCode=l.ItemCode
      WHERE i.ItemType='S' OR i.ItemType IS NULL GROUP BY l.SONum
  )
  SELECT s.SONum,l.SOLNNum,l.LineNum,l.ItemCode,l.Quantity,l.UnitPrice,
    CASE WHEN EXISTS (SELECT 1 FROM UT_Honorarios h WHERE h.ITEMCODE=l.ItemCode) THEN 1 ELSE 0 END SourceHonorariosReference,
    l.SOLN_ST,l.PCPRIT_ST,l.IsAssembly,l.IsComponent,l.SOLNRef,
    s.SO_ST,s.PCNum OrderPCNum,s.PTNum OrderPTNum,s.CreatedOn OrderCreatedOn,
    s.UDF_FromDate OrderServiceDate,s.UDF_ToDate OrderServiceEnd,s.UDF_Realizado,
    s.PR_RQ RequesterId,rq.FullName RequesterName,
    a.PCAPNum,a.PCNum AppointmentPCNum,a.FromDate AppointmentDate,a.PCAP_ST,
    a.UDF_Ejecutada,a.PRNum AppointmentDoctorId,a.ItemCode AppointmentItemCode,
    p.FullName AppointmentDoctorName,
    COALESCE(a.PTNum,s.PTNum) PTNum,pt.FullName Paciente,
    COALESCE(p.UDF_TIPO_MEDICO,rq.UDF_TIPO_MEDICO) UDF_TIPO_MEDICO,
    COALESCE(p.UDF_ISR,rq.UDF_ISR) UDF_ISR,COALESCE(p.UDF_IVA,rq.UDF_IVA) UDF_IVA,
    ms.MSDescription_ES Especialidad,s.BPCode,
    i.ItemDescription,i.ItemGroupName,i.ItemType,
    ISNULL(ac.AppointmentCount,0) AppointmentCount,ISNULL(sl.ServiceLineCount,0) ServiceLineCount,
    COALESCE(a.FromDate,s.UDF_FromDate,s.CreatedOn) ServiceDate,
    CASE WHEN a.FromDate IS NOT NULL THEN 'CITA_PROGRAMADA'
      WHEN s.UDF_FromDate IS NOT NULL THEN 'FECHA_SERVICIO_ORDEN'
      ELSE 'CREACION_ORDEN' END ServiceDateType
  FROM SO s JOIN SOLN l ON l.SONum=s.SONum
  LEFT JOIN Items i ON i.ItemCode=l.ItemCode
  LEFT JOIN AppointmentLinks al ON al.SONum=s.SONum
  LEFT JOIN PCAP a ON a.PCAPNum=al.PCAPNum
  LEFT JOIN AppointmentCounts ac ON ac.SONum=s.SONum
  LEFT JOIN ServiceLines sl ON sl.SONum=s.SONum
  LEFT JOIN PR p ON p.PRNum=a.PRNum
  LEFT JOIN PR rq ON rq.PRNum=s.PR_RQ
  LEFT JOIN MS ms ON ms.MSCode=COALESCE(p.MSCode,rq.MSCode)
  LEFT JOIN PT pt ON pt.PTNum=COALESCE(a.PTNum,s.PTNum)
  WHERE COALESCE(a.FromDate,s.UDF_FromDate,s.CreatedOn)>=CAST(@startDate AS date)
    AND COALESCE(a.FromDate,s.UDF_FromDate,s.CreatedOn)<DATEADD(day,1,CAST(@endDate AS date))
    AND (i.ItemType='S' OR i.ItemType IS NULL)
    AND NULLIF(LTRIM(RTRIM(l.ItemCode)),'') IS NOT NULL
    AND (i.ItemGroupName IS NULL OR LTRIM(RTRIM(i.ItemGroupName)) COLLATE Latin1_General_CI_AI
      NOT IN (${EXCLUDED_GROUP_SQL}))
  ORDER BY ServiceDate,l.SOLNNum,a.PCAPNum`;

const CHARGE_CANDIDATES_SQL = `
  WITH Items AS (
    SELECT ItemCode,MIN(ItemDescription) ItemDescription,MIN(ItemGroupName) ItemGroupName,
      MIN(ItemType) ItemType FROM V_IT GROUP BY ItemCode
  ), Participants AS (
    SELECT PCFRNum,SurgeryRole,COUNT(DISTINCT PRNum) ProviderCount,MIN(PRNum) ProviderId
      FROM PCFRPR WHERE PRNum>0 AND SurgeryRole IN ('AN','SURGEON','AY')
      GROUP BY PCFRNum,SurgeryRole
  ), Procedures AS (
    SELECT PCFRNum,COUNT(*) ProcedureCount FROM PCFRCP GROUP BY PCFRNum
  )
  SELECT b.PCBLNum,b.PCNum,b.LineNum,b.[Partition],b.ChargeDate,b.PC_ST,b.LineType,
    CASE WHEN EXISTS (SELECT 1 FROM UT_Honorarios h WHERE h.ITEMCODE=b.ItemCode) THEN 1 ELSE 0 END SourceHonorariosReference,
    b.ItemCode,COALESCE(b.ItemDescription,i.ItemDescription) ItemDescription,
    COALESCE(b.ItemGroupName,i.ItemGroupName) ItemGroupName,b.ItemType,
    b.Quantity,b.UnitPrice,b.SONum,b.SOLNNum,b.PCITNum,b.PCPRNum,b.PCPRITNum,b.PCFRNum,
    b.PR_TX,b.PR_PC,b.PR_MP,CONVERT(nvarchar(30),b.ProcedureRole) ProcedureRole,b.IsAssembly,b.IsComponent,
    tx.FullName ExecutingDoctorName,pcpr.FullName AttendingDoctorName,
    roleProvider.FullName RoleDoctorName,participants.ProviderCount,participants.ProviderId,
    participants.SurgeryRole,pc.Date AttentionDate,pc.ClosedOn,
    fr.EntryDate ProcedureDate,fr.PCFR_ST,ISNULL(procedures.ProcedureCount,0) ProcedureCount,
    it.PCIT_ST,it.Returned,req.PCPR_ST,rit.PCPRIT_ST,
    b.PTNum,pt.FullName Paciente,b.BPCode,
    COALESCE(roleProvider.UDF_TIPO_MEDICO,tx.UDF_TIPO_MEDICO,pcpr.UDF_TIPO_MEDICO) UDF_TIPO_MEDICO,
    COALESCE(roleProvider.UDF_ISR,tx.UDF_ISR,pcpr.UDF_ISR) UDF_ISR,
    COALESCE(roleProvider.UDF_IVA,tx.UDF_IVA,pcpr.UDF_IVA) UDF_IVA,
    ms.MSDescription_ES Especialidad
  FROM PCBL b
  LEFT JOIN Items i ON i.ItemCode=b.ItemCode
  LEFT JOIN PC pc ON pc.PCNum=b.PCNum
  LEFT JOIN PCFR fr ON fr.PCFRNum=b.PCFRNum
  LEFT JOIN Procedures procedures ON procedures.PCFRNum=b.PCFRNum
  LEFT JOIN Participants participants ON participants.PCFRNum=b.PCFRNum
    AND participants.SurgeryRole=CASE WHEN b.ItemCode IN ('SER1259','SER1260','SER1261','SER1262') THEN 'AN'
      WHEN CONVERT(nvarchar(30),b.ProcedureRole) IN ('AN','SURGEON','AY')
        THEN CONVERT(nvarchar(30),b.ProcedureRole) ELSE NULL END
  LEFT JOIN PR roleProvider ON roleProvider.PRNum=CASE WHEN participants.ProviderCount=1 THEN participants.ProviderId ELSE NULL END
  LEFT JOIN PR tx ON tx.PRNum=b.PR_TX
  LEFT JOIN PR pcpr ON pcpr.PRNum=b.PR_PC
  LEFT JOIN MS ms ON ms.MSCode=COALESCE(roleProvider.MSCode,tx.MSCode,pcpr.MSCode)
  LEFT JOIN PT pt ON pt.PTNum=b.PTNum
  LEFT JOIN PCIT it ON it.PCITNum=b.PCITNum
  LEFT JOIN PCPR req ON req.PCPRNum=b.PCPRNum
  LEFT JOIN PCPRIT rit ON rit.PCPRITNum=b.PCPRITNum
  WHERE b.ChargeDate>=CAST(@startDate AS date)
    AND b.ChargeDate<DATEADD(day,1,CAST(@endDate AS date))
    AND b.LineType='CH' AND (b.ItemType='S' OR i.ItemType='S')
    AND (COALESCE(b.ItemGroupName,i.ItemGroupName) IS NULL
      OR LTRIM(RTRIM(COALESCE(b.ItemGroupName,i.ItemGroupName))) COLLATE Latin1_General_CI_AI
        NOT IN (${EXCLUDED_GROUP_SQL}))
  ORDER BY b.ChargeDate,b.PCBLNum`;

const APPOINTMENT_CANDIDATES_SQL = `
  SELECT a.PCAPNum,a.PCNum,a.SONum,a.FromDate ServiceDate,a.PCAP_ST,a.UDF_Ejecutada,
    CASE WHEN EXISTS (SELECT 1 FROM UT_Honorarios h WHERE h.ITEMCODE=a.ItemCode) THEN 1 ELSE 0 END SourceHonorariosReference,
    a.ItemCode,a.PRNum,p.FullName AppointmentDoctorName,a.PTNum,pt.FullName Paciente,
    p.UDF_TIPO_MEDICO,p.UDF_ISR,p.UDF_IVA,ms.MSDescription_ES Especialidad,
    i.ItemDescription,i.ItemGroupName,s.SO_ST,s.BPCode,s.CreatedOn OrderCreatedOn
  FROM PCAP a
  LEFT JOIN PR p ON p.PRNum=a.PRNum
  LEFT JOIN PT pt ON pt.PTNum=a.PTNum
  LEFT JOIN MS ms ON ms.MSCode=p.MSCode
  LEFT JOIN SO s ON s.SONum=a.SONum
  OUTER APPLY (SELECT MIN(v.ItemDescription) ItemDescription,MIN(v.ItemGroupName) ItemGroupName
    FROM V_IT v WHERE v.ItemCode=a.ItemCode AND v.ItemType='S') i
  WHERE a.FromDate>=CAST(@startDate AS date) AND a.FromDate<DATEADD(day,1,CAST(@endDate AS date))
    AND NULLIF(LTRIM(RTRIM(a.ItemCode)),'') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM SOLN l JOIN SO linked ON linked.SONum=l.SONum
      WHERE (l.SONum=a.SONum OR linked.PCAPNum=a.PCAPNum) AND l.ItemCode=a.ItemCode)
    AND (i.ItemGroupName IS NULL OR LTRIM(RTRIM(i.ItemGroupName)) COLLATE Latin1_General_CI_AI
      NOT IN (${EXCLUDED_GROUP_SQL}))`;

const PROCEDURE_CANDIDATES_SQL = `
  WITH ProcedureLines AS (
    SELECT PCFRNum,CPCode,COUNT(*) SourceProcedureCount,MIN(NULLIF(PRNum,0)) ProcedureDoctorId,
      COUNT(DISTINCT NULLIF(PRNum,0)) ProcedureProviderCount FROM PCFRCP
    GROUP BY PCFRNum,CPCode
  )
  SELECT f.PCFRNum,f.CPCode,f.SourceProcedureCount,f.ProcedureProviderCount,
    fr.PCNum,fr.PTNum,fr.EntryDate ServiceDate,fr.PCFR_ST,pc.PC_ST,pc.Date AttentionDate,
    f.CPCode ItemCode,COALESCE(c.CPTName_ES,f.CPCode) ItemDescription,
    'PROCEDIMIENTO EN QUIROFANO' ItemGroupName,roles.SurgeryRole,
    participants.ProviderCount,provider.PRNum ProviderId,provider.FullName ProviderName,
    provider.UDF_TIPO_MEDICO,provider.UDF_ISR,provider.UDF_IVA,
    ms.MSDescription_ES Especialidad,pt.FullName Paciente
  FROM ProcedureLines f JOIN PCFR fr ON fr.PCFRNum=f.PCFRNum
  LEFT JOIN PC pc ON pc.PCNum=fr.PCNum LEFT JOIN CP c ON c.CPTCode=f.CPCode
  CROSS APPLY (SELECT 'SURGEON' SurgeryRole UNION SELECT DISTINCT p.SurgeryRole
    FROM PCFRPR p WHERE p.PCFRNum=f.PCFRNum AND p.SurgeryRole IN ('AN','AY')) roles
  OUTER APPLY (SELECT COUNT(DISTINCT PRNum) ProviderCount,MIN(PRNum) ProviderId
    FROM PCFRPR WHERE PCFRNum=f.PCFRNum AND SurgeryRole=roles.SurgeryRole AND PRNum>0) participants
  LEFT JOIN PR provider ON provider.PRNum=CASE
    WHEN roles.SurgeryRole='SURGEON' AND f.ProcedureProviderCount=1 THEN f.ProcedureDoctorId
    WHEN roles.SurgeryRole='SURGEON' AND f.ProcedureProviderCount>1 THEN NULL
    WHEN participants.ProviderCount=1 THEN participants.ProviderId ELSE NULL END
  LEFT JOIN MS ms ON ms.MSCode=provider.MSCode LEFT JOIN PT pt ON pt.PTNum=fr.PTNum
  WHERE fr.EntryDate>=CAST(@startDate AS date) AND fr.EntryDate<DATEADD(day,1,CAST(@endDate AS date))
    AND NULLIF(LTRIM(RTRIM(f.CPCode)),'') IS NOT NULL
  ORDER BY fr.EntryDate,f.PCFRNum,f.CPCode,roles.SurgeryRole`;

const VERTICAL_RECONCILIATION_SQL = `
  WITH AuditRows AS (SELECT a.UDRKey,a.ItemCode,COUNT(*) AuditCount,
    MAX(CONVERT(int,a.Elegible_V_HON_PAGO)) AuditEligible,MIN(a.MotivoExclusion) AuditReason
    FROM UDR_HON_PAGO_Audit a
    WHERE a.PCDate>=CAST(@startDate AS date) AND a.PCDate<DATEADD(day,1,CAST(@endDate AS date))
    GROUP BY a.UDRKey,a.ItemCode),
  PaymentRows AS (SELECT p.UDRKey,p.ItemCode,COUNT(*) PayCount,SUM(p.BaseImporte) PayBase
    FROM UDR_HON_PAGO p
    WHERE p.PCDate>=CAST(@startDate AS date) AND p.PCDate<DATEADD(day,1,CAST(@endDate AS date))
    GROUP BY p.UDRKey,p.ItemCode)
  SELECT COALESCE(a.UDRKey,p.UDRKey) UDRKey,COALESCE(a.ItemCode,p.ItemCode) ItemCode,
    ISNULL(a.AuditCount,0) AuditCount,a.AuditEligible,a.AuditReason,
    ISNULL(p.PayCount,0) PayCount,p.PayBase FROM AuditRows a
    FULL JOIN PaymentRows p ON p.UDRKey=a.UDRKey AND p.ItemCode=a.ItemCode`;

const numberOrNull = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const positiveId = value => numberOrNull(value) > 0 ? Number(value) : null;
const flag = value => value === true || value === 1;
const normalizeCode = value => String(value || '').trim().toUpperCase();

const normalizeDate = value => {
  if (!(value instanceof Date)) return value == null ? null : String(value);
  const pad = number => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10) === value;
function validatePeriod(startDate,endDate) {
  if (!validDate(startDate) || !validDate(endDate) || startDate>endDate) {
    throw Object.assign(new Error('Periodo de honorarios inválido.'),{status:400});
  }
}

function commonCandidate(raw,sourceType,id,occurrenceId) {
  const sourceIdentity=`BI|${sourceType}|${id}|${occurrenceId}`;
  const registeredVat=numberOrNull(raw.UDF_IVA),registeredIsr=numberOrNull(raw.UDF_ISR);
  return {
    SourceType:sourceType,SourceLineId:id,OccurrenceId:occurrenceId,SourceIdentity:sourceIdentity,
    SourceAllocationKey:`${sourceType}:${id}`,UDRKey:sourceIdentity,RenglonAuditoria:1,
    FolioReferenciaOrigen:id,FechaAtencion:normalizeDate(raw.ServiceDate || raw.ChargeDate),
    CodigoServicio:normalizeCode(raw.ItemCode),Servicio:raw.ItemDescription || raw.ItemCode,
    GrupoServicio:raw.ItemGroupName || 'Servicio sin grupo',Paciente:raw.Paciente || 'Paciente no especificado',
    PacienteId:positiveId(raw.PTNum),Cliente:raw.BPCode || 'Sin pagador vinculado',
    TipoMedico:raw.UDF_TIPO_MEDICO || null,Especialidad:raw.Especialidad || null,
    PrecioCobradoPaciente:numberOrNull(raw.UnitPrice),CantidadOriginal:numberOrNull(raw.Quantity),
    CantidadMaxima:numberOrNull(raw.Quantity),Cantidad:numberOrNull(raw.Quantity),
    BaseImporte:null,BasePropuesta:null,IvaLinea:null,IntegridadBaseValida:0,SinTabulador:1,
    TasaIVAPropuesta:[0,8,16].includes(registeredVat)?registeredVat/100:null,
    TasaISR:[0,0.1,0.0125].includes(registeredIsr)?registeredIsr:[10,1.25].includes(registeredIsr)?registeredIsr/100:null,
    EstadoVertical:null,ElegiblePago:0,RequiereRevision:true,PosibleDuplicado:false,
    SourceHonorariosReference:flag(raw.SourceHonorariosReference),
    DuplicadoConSourceIds:[],PasaTipoServicio:true,FuenteHonorario:sourceType==='SOLN'?'Línea de orden de venta':'Cargo clínico',
    OrigenRenglon:sourceType==='SOLN'?'ORDEN_SERVICIO_BI':'CARGO_CLINICO_BI',
    PasaCatalogoHonorarios:false,PasaIncluidoHonorarios:false
  };
}

function normalizeOrderCandidate(raw) {
  const id=positiveId(raw.SOLNNum),appointmentId=positiveId(raw.PCAPNum),orderId=positiveId(raw.SONum);
  if (!id || !orderId) throw new Error('Línea de orden sin identidad de Vertical.');
  const row=commonCandidate(raw,'SOLN',id,appointmentId?`CITA:${appointmentId}`:'ORDEN');
  const physicianId=positiveId(raw.AppointmentDoctorId) || positiveId(raw.RequesterId);
  const appointmentPhysician=positiveId(raw.AppointmentDoctorId) !== null;
  const shared=numberOrNull(raw.AppointmentCount)>1;
  const canceled=raw.SO_ST==='CA' || raw.SOLN_ST==='CA' || raw.PCAP_ST==='CA' || raw.PCPRIT_ST==='CA';
  const contactCenter=CONTACT_CENTER_CODES.has(row.CodigoServicio);
  const appointmentPerformed=flag(raw.UDF_Ejecutada) && (contactCenter || raw.PCAP_ST==='SH');
  const orderPerformed=flag(raw.UDF_Realizado);
  const evidence=appointmentPerformed?'CITA_REALIZADA':orderPerformed?'ORDEN_MARCADA_REALIZADA':'SIN_CONFIRMACION';

  const executionConfirmed=!canceled && (appointmentPerformed || orderPerformed)
    && Number(raw.ServiceLineCount)===1;
  Object.assign(row,{
    FolioOrdenVenta:orderId,FolioCita:appointmentId,
    FolioAtencion:positiveId(raw.AppointmentPCNum) || positiveId(raw.OrderPCNum),
    MedicoId:physicianId,Medico:appointmentPhysician?raw.AppointmentDoctorName:raw.RequesterName,
    MedicoOrigen:appointmentPhysician?'MEDICO_CITA':physicianId?'SOLICITANTE_ORDEN':'SIN_MEDICO',
    MedicoConfirmado:appointmentPhysician && !!String(raw.AppointmentDoctorName || '').trim(),
    MedicoSolicitanteId:positiveId(raw.RequesterId),RolMedico:'TRATANTE',
    FechaReferenciaTipo:raw.ServiceDateType || (appointmentId?'CITA_PROGRAMADA':'FECHA_SERVICIO_ORDEN'),
    FechaCreacionOrden:normalizeDate(raw.OrderCreatedOn),FechaProgramadaCita:normalizeDate(raw.AppointmentDate),
    FechaServicioOrden:normalizeDate(raw.OrderServiceDate),Cantidad:shared?null:row.CantidadOriginal,
    CantidadConfirmada:!shared && row.CantidadOriginal>0,AllocationShared:shared,
    NumeroCitasRelacionadas:Number(raw.AppointmentCount) || 0,NumeroServiciosOrden:Number(raw.ServiceLineCount) || 0,
    ContactCenter:contactCenter,RequiereLlegada:!contactCenter,
    EjecucionConfirmada:executionConfirmed,EvidenciaEjecucion:evidence,AlcanceEvidencia:'EPISODIO',
    RequiereConfirmacionLinea:!executionConfirmed,Cancelado:canceled,
    EstadoOrden:raw.SO_ST || null,EstadoLinea:raw.SOLN_ST || null,EstadoCita:raw.PCAP_ST || null,
    CitaEjecutada:flag(raw.UDF_Ejecutada),OrdenRealizada:orderPerformed,
    ArticuloCita:raw.AppointmentItemCode || null,EsPaquete:flag(raw.IsAssembly),EsComponente:flag(raw.IsComponent),
    TieneSO:1,TieneCita:appointmentId?1:0,MatchMedico:appointmentPhysician && physicianId===positiveId(raw.RequesterId)?1:0
  });
  row.VerticalKeys=[appointmentId?`CITA-${appointmentId}`:`SO-${orderId}`];
  return finishCandidate(row);
}

function normalizeChargeCandidate(raw) {
  const id=positiveId(raw.PCBLNum);
  if (!id) throw new Error('Cargo clínico sin identidad de Vertical.');
  const anesthesia=ANESTHESIA_CODES.has(normalizeCode(raw.ItemCode));
  const explicitRole=['AN','SURGEON','AY'].includes(raw.ProcedureRole)?raw.ProcedureRole:null;
  const clinicalRole=anesthesia?'AN':explicitRole;
  const row=commonCandidate(raw,'PCBL',id,clinicalRole || 'TRATANTE');
  const uniqueParticipant=Number(raw.ProviderCount)===1 && positiveId(raw.ProviderId)!==null;

  const physicianId=clinicalRole?(uniqueParticipant?positiveId(raw.ProviderId):null)
    :positiveId(raw.PR_TX) || positiveId(raw.PR_PC);
  const returned=numberOrNull(raw.Returned)>0;
  const canceled=[raw.PC_ST,raw.PCIT_ST,raw.PCPR_ST,raw.PCPRIT_ST,raw.PCFR_ST].includes('CA')
    || ['RT','RR'].includes(raw.PCIT_ST) || row.CantidadOriginal<=0;
  Object.assign(row,{
    FolioAtencion:positiveId(raw.PCNum),FolioCita:null,FolioOrdenVenta:positiveId(raw.SONum),
    FolioEstancia:positiveId(raw.PCFRNum),LinkedSOLNNum:positiveId(raw.SOLNNum),
    MedicoId:physicianId,Medico:clinicalRole?(uniqueParticipant?raw.RoleDoctorName:null)
      :positiveId(raw.PR_TX)?raw.ExecutingDoctorName:raw.AttendingDoctorName,
    RolMedico:clinicalRole || 'TRATANTE',MedicoOrigen:clinicalRole?uniqueParticipant?'PARTICIPANTE_ROL':'ROL_PENDIENTE'
      :positiveId(raw.PR_TX)?'MEDICO_CARGO':'MEDICO_ATENCION',
    MedicoConfirmado:clinicalRole?uniqueParticipant && !!String(raw.RoleDoctorName || '').trim():false,
    NumeroMedicosRol:Number(raw.ProviderCount) || 0,MedicoCargoId:positiveId(raw.PR_TX),MedicoAtencionId:positiveId(raw.PR_PC),
    FechaReferenciaTipo:'FECHA_CARGO',FechaCargo:normalizeDate(raw.ChargeDate),FechaAtencionOriginal:normalizeDate(raw.AttentionDate),
    FechaProcedimiento:normalizeDate(raw.ProcedureDate),NumeroProcedimientos:Number(raw.ProcedureCount) || 0,

    EjecucionConfirmada:false,EvidenciaEjecucion:positiveId(raw.PCFRNum) && Number(raw.ProcedureCount)>0
      ?'PROCEDIMIENTO_REGISTRADO':'CARGO_REGISTRADO',AlcanceEvidencia:'REGISTRO_CLINICO',RequiereConfirmacionLinea:true,
    Cantidad:returned?null:row.CantidadOriginal,
    CantidadMaxima:returned?Math.max(0,(row.CantidadOriginal || 0)-Number(raw.Returned)):row.CantidadOriginal,
    CantidadConfirmada:row.CantidadOriginal>0 && !returned,AllocationShared:false,
    CantidadDevuelta:numberOrNull(raw.Returned),Devuelto:returned,Cancelado:canceled,
    EstadoAtencion:raw.PC_ST || null,EstadoArticulo:raw.PCIT_ST || null,
    EstadoProcedimiento:raw.PCPR_ST || null,EstadoEstancia:raw.PCFR_ST || null,
    EsPaquete:flag(raw.IsAssembly),EsComponente:flag(raw.IsComponent),
    TieneSO:positiveId(raw.SONum)?1:0,TieneCita:0,PasaAtencionCerrada:raw.PC_ST==='CL',
    ContactCenter:CONTACT_CENTER_CODES.has(row.CodigoServicio),RequiereLlegada:false
  });
  row.VerticalKeys=row.FolioAtencion?[`PC-${row.FolioAtencion}`]:[];
  return finishCandidate(row);
}

function normalizeAppointmentCandidate(raw) {
  const id = positiveId(raw.PCAPNum);
  if (!id) throw new Error('Cita sin identidad de Vertical.');
  const row = commonCandidate({ ...raw, Quantity: 1 }, 'PCAP', id, normalizeCode(raw.ItemCode));
  const contactCenter = CONTACT_CENTER_CODES.has(row.CodigoServicio);
  const cancelled = raw.PCAP_ST === 'CA' || raw.SO_ST === 'CA';
  Object.assign(row, { FolioAtencion: positiveId(raw.PCNum), FolioCita: id,
    FolioOrdenVenta: positiveId(raw.SONum), MedicoId: positiveId(raw.PRNum),
    Medico: raw.AppointmentDoctorName, MedicoOrigen: 'MEDICO_CITA',
    MedicoConfirmado: positiveId(raw.PRNum) !== null && !!String(raw.AppointmentDoctorName || '').trim(),
    RolMedico: 'TRATANTE', CantidadConfirmada: true, AllocationShared: false, FechaReferenciaTipo: 'CITA_PROGRAMADA',
    FechaProgramadaCita: row.FechaAtencion, Cancelado: cancelled, EstadoCita: raw.PCAP_ST,
    CitaEjecutada: flag(raw.UDF_Ejecutada), ContactCenter: contactCenter, RequiereLlegada: !contactCenter,
    EjecucionConfirmada: !cancelled && flag(raw.UDF_Ejecutada) && (contactCenter || raw.PCAP_ST === 'SH'),
    EvidenciaEjecucion: flag(raw.UDF_Ejecutada) ? 'CITA_REALIZADA' : 'CITA_PROGRAMADA',
    FuenteHonorario: 'Cita sin línea de orden', OrigenRenglon: 'CITA_SIN_LINEA_BI',
    TieneCita: 1, TieneSO: raw.SONum > 0 ? 1 : 0, VerticalKeys: [`CITA-${id}`] });
  return finishCandidate(row);
}

function normalizeProcedureCandidate(raw) {
  const procedureId=positiveId(raw.PCFRNum),code=normalizeCode(raw.CPCode || raw.ItemCode);
  const role=raw.SurgeryRole;
  if (!procedureId || !code || !['SURGEON','AN','AY'].includes(role)) throw new Error('Procedimiento sin identidad o rol de Vertical.');
  const quantity=Number(raw.SourceProcedureCount) || 1;
  const row=commonCandidate({...raw,ItemCode:code,Quantity:quantity},'PCFRCP',`${procedureId}:${code}`,role);
  const providerId=positiveId(raw.ProviderId),cancelled=raw.PCFR_ST==='CA' || raw.PC_ST==='CA';
  Object.assign(row,{FolioAtencion:positiveId(raw.PCNum),FolioCita:null,FolioOrdenVenta:null,
    FolioEstancia:procedureId,MedicoId:providerId,Medico:raw.ProviderName,RolMedico:role,
    MedicoOrigen:'PARTICIPANTE_PROCEDIMIENTO',MedicoConfirmado:!!providerId && !!String(raw.ProviderName || '').trim(),
    NumeroMedicosRol:Number(raw.ProviderCount) || 0,FechaReferenciaTipo:'FECHA_PROCEDIMIENTO',
    FechaProcedimiento:normalizeDate(raw.ServiceDate),FechaAtencionOriginal:normalizeDate(raw.AttentionDate),
    EjecucionConfirmada:false,EvidenciaEjecucion:'PROCEDIMIENTO_REGISTRADO',AlcanceEvidencia:'REGISTRO_CLINICO',
    RequiereConfirmacionLinea:true,Cantidad:quantity===1?1:null,CantidadConfirmada:quantity===1,
    AllocationShared:quantity>1,Cancelado:cancelled,EstadoEstancia:raw.PCFR_ST || null,
    EstadoAtencion:raw.PC_ST || null,ContactCenter:false,RequiereLlegada:false,TieneSO:0,TieneCita:0,
    FuenteHonorario:'Procedimiento quirúrgico por rol',OrigenRenglon:'PROCEDIMIENTO_PCFRCP_BI'});
  row.VerticalKeys=row.FolioAtencion?[`PC-${row.FolioAtencion}`]:[];
  return finishCandidate(row);
}

function finishCandidate(row) {
  row.Medico=row.Medico || 'Médico pendiente de confirmar';
  const pending=[row.Cancelado && 'Fuente cancelada; revisar ajuste',row.Devuelto && 'Hay unidades devueltas; confirmar cantidad vigente',
    !row.EjecucionConfirmada && 'Pendiente de confirmar realización de esta prestación',
    !row.MedicoConfirmado && 'Pendiente de confirmar médico beneficiario',
    !row.CantidadConfirmada && (row.AllocationShared?'Cantidad de orden compartida entre varias citas; asignar unidades':'Pendiente de confirmar cantidad'),
    'Pendiente de tarifa vigente y decisión en BI'].filter(Boolean);
  row.PendientesFuente=pending;
  row.MensajeAuditoria=pending.join('. ');
  row.ObservacionCobertura=row.MensajeAuditoria;
  row.MotivoExclusionOriginal=row.Cancelado?'Fuente cancelada':'';
  row.SourceFingerprint=sourceFingerprint(row);
  return row;
}

function sourceFingerprint(row) {
  return createHash('sha256').update(JSON.stringify([
    row.SourceIdentity,row.CodigoServicio,row.FechaAtencion,row.FechaReferenciaTipo,row.PacienteId,
    row.FolioAtencion,row.FolioCita,row.FolioOrdenVenta,row.MedicoId,row.RolMedico,row.MedicoOrigen,
    row.CantidadOriginal,row.CantidadMaxima,row.AllocationShared,row.NumeroCitasRelacionadas,
    row.Cancelado,row.Devuelto,row.CantidadDevuelta,row.EstadoOrden,row.EstadoLinea,row.EstadoCita,
    row.CitaEjecutada,row.OrdenRealizada,row.EstadoAtencion,row.EstadoArticulo,row.EstadoProcedimiento,
    row.EstadoEstancia,row.NumeroMedicosRol,row.NumeroServiciosOrden,row.EvidenciaEjecucion,row.EjecucionConfirmada,
    row.LinkedSOLNNum,row.EsPaquete,row.EsComponente,row.PosibleDuplicado,
    [...(row.DuplicadoConSourceIds || [])].sort()
  ])).digest('hex');
}

function inScope(raw) {
  return !isExcludedHonorariosService(raw);
}

function buildCandidates(orderRows=[],chargeRows=[],appointmentRows=[],procedureRows=[]) {
  const rows=[],seen=new Set(),ordersByLine=new Map(),attentionConcepts=new Map();
  let duplicateSourceRows=0,excludedSourceRows=0;
  for (const [sourceType,rawRows] of [['SOLN',orderRows],['PCBL',chargeRows],['PCAP',appointmentRows],['PCFRCP',procedureRows]]) {
    for (const raw of rawRows) {
      if (!inScope(raw)) { excludedSourceRows++;continue; }
      const row=sourceType==='SOLN'?normalizeOrderCandidate(raw):sourceType==='PCBL'?normalizeChargeCandidate(raw):sourceType==='PCAP'?normalizeAppointmentCandidate(raw):normalizeProcedureCandidate(raw);
      if (seen.has(row.SourceIdentity)) { duplicateSourceRows++;continue; }
      seen.add(row.SourceIdentity);rows.push(row);
      if (sourceType==='SOLN') {
        const matches=ordersByLine.get(row.SourceLineId) || [];matches.push(row);ordersByLine.set(row.SourceLineId,matches);
      }
      if (row.FolioAtencion) {
        const key=`${row.FolioAtencion}:${row.CodigoServicio}`,matches=attentionConcepts.get(key) || [];
        matches.push(row);attentionConcepts.set(key,matches);
      }
    }
  }
  function notePotentialDuplicate(first,second,kind) {
    for (const [row,other] of [[first,second],[second,first]]) {
      if (!row.DuplicadoConSourceIds.includes(other.SourceIdentity)) row.DuplicadoConSourceIds.push(other.SourceIdentity);
      row.PosibleDuplicado=true;row.CoincidenciaTipo=kind;
      row.MensajeAuditoria=`${row.PendientesFuente.join('. ')}. Posible coincidencia entre fuentes clínicas; revisar vínculo, rol y cantidades.`;
      row.ObservacionCobertura=row.MensajeAuditoria;
    }
  }
  for (const row of rows.filter(candidate=>candidate.SourceType==='PCBL')) {
    const exact=row.LinkedSOLNNum?ordersByLine.get(row.LinkedSOLNNum) || []:[];
    if (exact.length) for (const order of exact) notePotentialDuplicate(row,order,'VINCULO_SOLN');
    else if (row.FolioAtencion) {
      for (const candidate of attentionConcepts.get(`${row.FolioAtencion}:${row.CodigoServicio}`) || []) {
        if (candidate.SourceType!=='PCBL') notePotentialDuplicate(row,candidate,'MISMA_ATENCION_CONCEPTO');
      }
    }
  }
  for (const procedure of rows.filter(row=>row.SourceType==='PCFRCP')) {
    for (const charge of rows.filter(row=>row.SourceType==='PCBL' && row.FolioEstancia===procedure.FolioEstancia
      && row.RolMedico===procedure.RolMedico)) notePotentialDuplicate(procedure,charge,'MISMO_PROCEDIMIENTO_ROL');
  }
  for (const row of rows) row.SourceFingerprint=sourceFingerprint(row);
  return {rows,coverage:{
    source:'SERVICIOS_ORDENES_CARGOS',candidates:rows.length,
    orderLines:new Set(rows.filter(row=>row.SourceType==='SOLN').map(row=>row.SourceLineId)).size,
    orderOccurrences:rows.filter(row=>row.SourceType==='SOLN').length,
    clinicalCharges:rows.filter(row=>row.SourceType==='PCBL').length,
    standaloneAppointments:rows.filter(row=>row.SourceType==='PCAP').length,
    surgicalProcedures:rows.filter(row=>row.SourceType==='PCFRCP').length,
    contactCenter:rows.filter(row=>row.ContactCenter).length,
    quantityPending:rows.filter(row=>!row.CantidadConfirmada).length,
    physicianPending:rows.filter(row=>!row.MedicoConfirmado).length,
    executionPending:rows.filter(row=>!row.EjecucionConfirmada).length,
    duplicateCandidates:rows.filter(row=>row.PosibleDuplicado).length,
    duplicateSourceRows,excludedSourceRows,recoveredAppointments:0,recoveredBase:0,pendingAppointments:0
  }};
}

async function getHonorariosCandidates(pool,startDate,endDate) {
  validatePeriod(startDate,endDate);
  const results=await Promise.all([
    pool.request().input('startDate',startDate).input('endDate',endDate).query(ORDER_CANDIDATES_SQL),
    pool.request().input('startDate',startDate).input('endDate',endDate).query(CHARGE_CANDIDATES_SQL),
    pool.request().input('startDate',startDate).input('endDate',endDate).query(APPOINTMENT_CANDIDATES_SQL),
    pool.request().input('startDate',startDate).input('endDate',endDate).query(PROCEDURE_CANDIDATES_SQL)
  ]);
  const result = buildCandidates(results[0].recordset,results[1].recordset,results[2].recordset,results[3].recordset);
  const keys = result.rows.flatMap(row => row.VerticalKeys.map(key => ({ key, code: row.CodigoServicio })));
  if (keys.length) {
    const reconciliation = await pool.request().input('startDate',startDate).input('endDate',endDate).query(VERTICAL_RECONCILIATION_SQL);
    const matches = new Map(reconciliation.recordset.map(row => [`${row.UDRKey}|${row.ItemCode}`, row]));
    result.rows = result.rows.map(row => {
      const found = row.VerticalKeys.map(key => matches.get(`${key}|${row.CodigoServicio}`)).filter(Boolean);
      return { ...row, EnVistaAuditoria: found.some(item => item.AuditCount > 0),
        EnVistaPago: found.some(item => item.PayCount > 0),
        BaseImporteVertical: found.reduce((sum, item) => sum + (Number(item.PayBase) || 0), 0),
        ReferenciaVerticalAgregada: true, MotivoAuditoriaVertical: [...new Set(found.map(item => item.AuditReason).filter(Boolean))].join(' · ') };
    });
  }
  result.coverage.absentInAudit = result.rows.filter(row => !row.EnVistaAuditoria).length;
  result.coverage.absentInPayment = result.rows.filter(row => !row.EnVistaPago).length;
  return result;
}

async function getProviderDirectory(pool) {
  const result=await pool.request().query(`SELECT PRNum,FullName,Role FROM PR WHERE Role='P'
    AND NULLIF(LTRIM(RTRIM(FullName)),'') IS NOT NULL ORDER BY FullName,PRNum`);
  return result.recordset.map(row=>({id:Number(row.PRNum),name:row.FullName,role:row.Role}));
}

module.exports={getHonorariosCandidates,getProviderDirectory,buildCandidates,normalizeOrderCandidate,normalizeChargeCandidate,sourceFingerprint,
  normalizeAppointmentCandidate,validatePeriod,ORDER_CANDIDATES_SQL,CHARGE_CANDIDATES_SQL,
  APPOINTMENT_CANDIDATES_SQL,PROCEDURE_CANDIDATES_SQL,normalizeProcedureCandidate,VERTICAL_RECONCILIATION_SQL};
