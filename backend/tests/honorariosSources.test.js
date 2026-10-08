'use strict';
const {buildCandidates,normalizeOrderCandidate,normalizeChargeCandidate,validatePeriod,getHonorariosCandidates,
  ORDER_CANDIDATES_SQL,CHARGE_CANDIDATES_SQL,normalizeProcedureCandidate,PROCEDURE_CANDIDATES_SQL}=require('../services/honorariosSources.service');

const order=(changes={})=>({SONum:80,SOLNNum:90,ItemCode:'SER0616',ItemDescription:'Consulta Psicología',
  ItemGroupName:'CONSULTA EXTERNA',Quantity:1,UnitPrice:1000,ServiceDate:'2026-09-02',ServiceDateType:'CITA_PROGRAMADA',
  PCAPNum:100,AppointmentPCNum:null,OrderPCNum:null,AppointmentDate:'2026-09-02',AppointmentCount:1,ServiceLineCount:1,
  AppointmentDoctorId:7,AppointmentDoctorName:'Médico de cita',RequesterId:8,RequesterName:'Solicitante',
  PCAP_ST:'SH',UDF_Ejecutada:true,SO_ST:'PR',SOLN_ST:'PR',...changes});

test('late clinical timestamps retain their hospital calendar date for tariff and review cuts',()=>{
  const late = new Date(2026,8,2,23,30,0);
  expect(normalizeOrderCandidate(order({ServiceDate:late})).FechaAtencion).toBe('2026-09-02T23:30:00');
});
const charge=(changes={})=>({PCBLNum:200,PCNum:300,PCFRNum:400,ChargeDate:'2026-09-03',ItemCode:'SER1260',
  ItemDescription:'Anestesia',ItemGroupName:'CIRUGIA',Quantity:1,UnitPrice:30000,PC_ST:'CL',
  PR_TX:8,PR_PC:9,ExecutingDoctorName:'Médico de cargo',AttendingDoctorName:'Médico de atención',
  ProviderCount:1,ProviderId:10,RoleDoctorName:'Anestesiólogo',ProcedureCount:1,...changes});

test('source identity stays stable when a physician name changes and an actual change invalidates its fingerprint',()=>{
  const original=normalizeOrderCandidate(order());
  const renamed=normalizeOrderCandidate(order({AppointmentDoctorName:'Nombre actualizado'}));
  const changed=normalizeOrderCandidate(order({UDF_Ejecutada:false}));
  expect(original.SourceIdentity).toBe('BI|SOLN|90|CITA:100');
  expect(renamed.SourceIdentity).toBe(original.SourceIdentity);
  expect(renamed.SourceFingerprint).toBe(original.SourceFingerprint);
  expect(changed.SourceFingerprint).not.toBe(original.SourceFingerprint);
  expect(original).toMatchObject({MedicoId:7,MedicoSolicitanteId:8,MedicoOrigen:'MEDICO_CITA',FolioAtencion:null,
    FolioCita:100,FolioOrdenVenta:80,ElegiblePago:0,BaseImporte:null,PrecioCobradoPaciente:1000});
});

test('an order reused by appointments across periods exposes shared maximum and never repeats its full quantity',()=>{
  const result=buildCandidates([order({AppointmentCount:2,Quantity:3}),order({PCAPNum:101,AppointmentCount:2,Quantity:3})]);
  expect(result.rows).toHaveLength(2);
  expect(new Set(result.rows.map(row=>row.SourceIdentity)).size).toBe(2);
  for(const row of result.rows) expect(row).toMatchObject({SourceAllocationKey:'SOLN:90',CantidadMaxima:3,
    Cantidad:null,CantidadConfirmada:false,AllocationShared:true});
  expect(result.coverage.quantityPending).toBe(2);
});

test('Contact Center performed flag can confirm a single line without physical arrival',()=>{
  const online=normalizeOrderCandidate(order({ItemCode:'SER1471',PCAP_ST:'RS',UDF_Ejecutada:false,UDF_Realizado:true}));
  expect(online).toMatchObject({ContactCenter:true,RequiereLlegada:false,EjecucionConfirmada:true,ElegiblePago:0});
  const missing=normalizeOrderCandidate(order({ItemCode:'SER1470',PCAPNum:null,AppointmentDoctorId:null,
    AppointmentCount:0,PCAP_ST:null,UDF_Ejecutada:null,UDF_Realizado:null}));
  expect(missing).toMatchObject({MedicoId:8,MedicoConfirmado:false,EjecucionConfirmada:false,ElegiblePago:0});
  expect(missing.SourceIdentity).toBe('BI|SOLN|90|ORDEN');
});

test('episode execution does not silently confirm every service on a multi-line order or override cancellation',()=>{
  expect(normalizeOrderCandidate(order({ServiceLineCount:2}))).toMatchObject({EvidenciaEjecucion:'CITA_REALIZADA',
    EjecucionConfirmada:false,RequiereConfirmacionLinea:true});
  expect(normalizeOrderCandidate(order({ItemCode:'SER1471',SO_ST:'CA',UDF_Realizado:true})))
    .toMatchObject({Cancelado:true,EjecucionConfirmada:false});
});

test('anesthesia chooses its unique role participant instead of executing or attending doctor',()=>{
  const result=normalizeChargeCandidate(charge());
  expect(result).toMatchObject({SourceIdentity:'BI|PCBL|200|AN',MedicoId:10,Medico:'Anestesiólogo',RolMedico:'AN',
    MedicoConfirmado:true,MedicoOrigen:'PARTICIPANTE_ROL',EjecucionConfirmada:false,EvidenciaEjecucion:'PROCEDIMIENTO_REGISTRADO'});
  for(const ProviderCount of [0,2]) expect(normalizeChargeCandidate(charge({ProviderCount})))
    .toMatchObject({MedicoId:null,MedicoConfirmado:false,RolMedico:'AN',MedicoOrigen:'ROL_PENDIENTE'});
});

test('returns and cancellations preserve charge candidate but block recognition of its original quantity',()=>{
  const returned=normalizeChargeCandidate(charge({Quantity:3,Returned:1}));
  expect(returned).toMatchObject({CantidadOriginal:3,Cantidad:null,CantidadMaxima:2,CantidadDevuelta:1,Devuelto:true,CantidadConfirmada:false,ElegiblePago:0});
  expect(normalizeChargeCandidate(charge({PCIT_ST:'RT'}))).toMatchObject({Cancelado:true,ElegiblePago:0});
});

test('duplicate joins do not add candidates; cross-source coincidence stays visible for explicit reconciliation',()=>{
  const result=buildCandidates([order(),order()],[charge({SONum:80,SOLNNum:90,ItemCode:'SER0616'})]);
  expect(result.rows).toHaveLength(2);
  expect(result.coverage.duplicateSourceRows).toBe(1);
  expect(result.rows.every(row=>row.PosibleDuplicado&&row.CoincidenciaTipo==='VINCULO_SOLN')).toBe(true);
  expect(result.rows.every(row=>row.ElegiblePago===0)).toBe(true);
  expect(result.rows[0].SourceFingerprint).not.toBe(normalizeOrderCandidate(order()).SourceFingerprint);
});

test('excluded groups and known ultrasound concepts cannot reappear through either source',()=>{
  const groups=[' Farmacia ', 'Laboratorio', ' Estudios de Laboratorio ', 'imagenología', ' Almacén   General ', 'ALIAS', 'PAQUETE DE CIRUGIA'];
  const result=buildCandidates([...groups.map(ItemGroupName=>order({ItemGroupName})),order({ItemCode:'SER0649'})],
    [...groups.map(ItemGroupName=>charge({ItemGroupName})),charge({ItemCode:'SER0647'})]);
  expect(result.rows).toEqual([]);
  expect(result.coverage.excludedSourceRows).toBe(16);
});

test('aliases, hospital packages and material cannot return through sources with missing or mixed groups',()=>{
  const result=buildCandidates([order({ItemCode:'A-QUI',ItemGroupName:null}),order({ItemDescription:'RENTA DE EQUIPO PARA CIRUGIA'})],
    [charge({ItemCode:'PQX0002',ItemGroupName:null}),charge({ItemDescription:'CONSULTA EXTERNA MATERIAL DE CURACION'})],
    [{PCAPNum:333,ItemCode:'A-ITEM',ItemGroupName:null}]);
  expect(result.rows).toEqual([]);
  expect(result.coverage.excludedSourceRows).toBe(5);
});

test('validates calendar dates before queries and requests only parameterized read statements',async()=>{
  for(const dates of [['2026-02-30','2026-09-30'],['2026-13-01','2026-09-30'],['2026-10-01','2026-09-30']]) {
    expect(()=>validatePeriod(...dates)).toThrow(/inválido/);
  }
  const calls=[];
  const pool={request(){const params={};return {input(key,value){params[key]=value;return this;},
    async query(sql){calls.push({sql,params});return {recordset:sql===ORDER_CANDIDATES_SQL?[order()]:sql===CHARGE_CANDIDATES_SQL?[charge()]:[]};}};}};
  const result=await getHonorariosCandidates(pool,'2026-09-01','2026-09-30');
  expect(result.rows).toHaveLength(2);
  expect(calls).toHaveLength(5);
  expect(calls.slice(0,4).every(call=>call.params.startDate==='2026-09-01'&&call.params.endDate==='2026-09-30')).toBe(true);
  for(const call of calls) expect(call.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|EXEC|INTO)\b/i);
});

test('procedure coverage preserves surgeon, anesthetist and assistant obligations pending authorization',()=>{
  const source={PCFRNum:400,CPCode:'CXQ175',PCNum:300,PTNum:100,ServiceDate:'2026-09-03',
    ItemDescription:'CESAREA',ItemGroupName:'PROCEDIMIENTO EN QUIROFANO',SourceProcedureCount:1,
    ProviderCount:1,ProviderId:10,ProviderName:'Profesional quirúrgico',PCFR_ST:'CL',PC_ST:'CL'};
  const roles=['SURGEON','AN','AY'].map(SurgeryRole=>({...source,SurgeryRole}));
  const result=buildCandidates([],[],[],roles);
  expect(result.rows).toHaveLength(3);expect(result.coverage.surgicalProcedures).toBe(3);
  expect(new Set(result.rows.map(row=>row.SourceIdentity)).size).toBe(3);
  for(const row of result.rows)expect(row).toMatchObject({MedicoId:10,Cantidad:1,BaseImporte:null,ElegiblePago:0,
    EjecucionConfirmada:false,FuenteHonorario:'Procedimiento quirúrgico por rol'});
  expect(normalizeProcedureCandidate({...source,SurgeryRole:'SURGEON',ProviderId:null,ProviderName:null}))
    .toMatchObject({MedicoId:null,MedicoConfirmado:false});
  expect(normalizeProcedureCandidate({...source,SurgeryRole:'SURGEON',SourceProcedureCount:2}))
    .toMatchObject({Cantidad:null,CantidadMaxima:2,CantidadConfirmada:false});
  expect(normalizeProcedureCandidate({...source,SurgeryRole:'SURGEON',PCFR_ST:'CA'}).Cancelado).toBe(true);
  const overlap=buildCandidates([], [charge()], [], [{...source,SurgeryRole:'AN'}]);
  expect(overlap.rows.every(row=>row.PosibleDuplicado)).toBe(true);
  expect(overlap.rows[0].CoincidenciaTipo).toBe('MISMO_PROCEDIMIENTO_ROL');
  expect(PROCEDURE_CANDIDATES_SQL).toContain('FROM PCFRCP');
});
