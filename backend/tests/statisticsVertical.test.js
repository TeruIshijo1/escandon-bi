'use strict';
jest.mock('../config/remote-db',()=>({connectRemoteDB:jest.fn(),sql:{VarChar:jest.fn(n=>({type:'varchar',length:n})),Int:'int'}}));
const {connectRemoteDB}=require('../config/remote-db');
const {buildClinicalStatistics,getClinicalStatistics,getAccountClassifications}=require('../services/statisticsVertical.service');

describe('clinical statistics reconciliation',()=>{
  const build=(data={})=>buildClinicalStatistics({charges:[],accounts:[],surgeries:[],...data});
  test('counts net service units once per charge and excludes interconsultations',()=>{
    const consultation={NumeroCargo:1,FolioAtencion:20,Codigo:'SER0508',Cantidad:2};
    const result=build({charges:[consultation,{...consultation},{NumeroCargo:2,Codigo:'SER0507',Cantidad:3},{NumeroCargo:3,Codigo:'SER0509',Cantidad:0}]});
    expect(result.sections.emergencyConsultations.quantity).toBe(2);
    expect(result.sections.emergencyConsultations.rowCount).toBe(1);
    expect(result.sections.emergencyConsultations.attentionCount).toBe(1);
  });
  test('stay includes neonatal, intermediate and ambulatory services but excludes emergency hours',()=>{
    const result=build({charges:['SER0653','SER0658','SER0661','SER1234','SER0505'].map((Codigo,i)=>({NumeroCargo:i,Codigo,Cantidad:2}))});
    expect(result.sections.stay.quantity).toBe(8);
    expect(result.sections.intensive.quantity).toBe(4);
  });
  test('VaSeguro uses the verified agreement flag and births stay unknown',()=>{
    const result=build({accounts:[{FolioAtencion:1,VaSeguro:1,Cantidad:1,TipoAtencion:'ER'},{FolioAtencion:2,VaSeguro:0,Cantidad:1,TipoAtencion:'IP'}]});
    expect(result.sections.vasSeguro.quantity).toBe(1);
    expect(result.sections.births.quantity).toBeNull();
    expect(result.general.TotalEgresos).toBe(2);
  });
  test('separates surgical stays from distinct account volume',()=>{
    const row={FolioAtencion:20,Cantidad:1,EstadoCuenta:'CL',FechaIngreso:'2026-09-02T08:00:00',FechaEgreso:'2026-09-02T18:00:00'};
    const result=build({surgeries:[{...row,FolioEstancia:1,EstanciaAmbulatoria:1},{...row,FolioEstancia:1,EstanciaAmbulatoria:1},{...row,FolioEstancia:2,EstanciaAmbulatoria:0}]});
    expect(result.sections.surgeries.quantity).toBe(2);
    expect(result.sections.operatingRoom.quantity).toBe(1);
    expect(result.sections.operatingRoom.rows[0].EstanciasQuirofano).toBe(2);
    expect(result.sections.ambulatory.quantity).toBe(2);
  });
  test('ambulatory requires admission and discharge on the same calendar day, regardless of service code',()=>{
    const base={Cantidad:1,FolioAtencion:1,EstadoCuenta:'CL',FechaIngreso:'2026-09-02T08:00:00'};
    const result=build({surgeries:[
      {...base,FolioEstancia:1,FechaEgreso:'2026-09-02T18:00:00',EstanciaAmbulatoria:0},
      {...base,FolioEstancia:2,FechaEgreso:'2026-09-03T01:00:00',EstanciaAmbulatoria:1},
      {...base,FolioEstancia:3,FechaEgreso:null,EstadoCuenta:'OP',EstanciaAmbulatoria:1},
      {...base,FolioEstancia:4,FechaEgreso:'2026-09-02T07:00:00'}
    ]});
    expect(result.sections.ambulatory.quantity).toBe(1);
    expect(result.sections.ambulatory.rows[0].FolioEstancia).toBe(1);
  });
  test('ambiguous study groups are visible as a warning rather than assigned',()=>{
    const result=build({charges:[{NumeroCargo:1,Cantidad:1,GrupoCodigo:'101',ClasificacionesCatalogo:2},{NumeroCargo:2,Cantidad:3,GrupoCodigo:'117',ClasificacionesCatalogo:1}]});
    expect(result.sections.lab.quantity).toBe(0);
    expect(result.sections.image.quantity).toBe(3);
    expect(result.warnings.length).toBe(1);
  });
  test('preserves date-only boundaries without timezone conversion and limits every query',async()=>{
    const input=jest.fn();const query=jest.fn().mockResolvedValue({recordset:[]});
    connectRemoteDB.mockResolvedValue({request:()=>({input,query})});
    await getClinicalStatistics({startDate:'2026-09-01',endExclusive:'2026-10-01'});
    expect(input).toHaveBeenCalledWith('startDate',{type:'varchar',length:10},'2026-09-01');
    expect(input).toHaveBeenCalledWith('endExclusive',{type:'varchar',length:10},'2026-10-01');
    for(const [statement] of query.mock.calls){expect(statement).toContain('TOP (100001)');expect(statement).toContain('<@endExclusive');}
  });
  test('invalid dates and incomplete result sets fail instead of returning zero',async()=>{
    await expect(getClinicalStatistics({startDate:'2026-02-30',endExclusive:'2026-03-05'})).rejects.toThrow('inválido');
    connectRemoteDB.mockResolvedValue({request:()=>({input:jest.fn(),query:jest.fn().mockResolvedValue({recordset:new Array(100001).fill({})})})});
    await expect(getClinicalStatistics({startDate:'2026-09-01',endExclusive:'2026-10-01'})).rejects.toThrow('límite');
  });
  test('classification parameters are validated and deduplicated',async()=>{
    const input=jest.fn();const query=jest.fn().mockResolvedValue({recordset:[{FolioAtencion:10,TipoAtencion:'IP',NumeroMedico:5,Medico:'Médico de prueba'}]});
    connectRemoteDB.mockResolvedValue({request:()=>({input,query})});
    const result=await getAccountClassifications(['10',10,'1 OR 1=1',0,-1]);
    expect(input).toHaveBeenCalledTimes(1);expect(input).toHaveBeenCalledWith('folio0','int',10);
    expect(result['10'].TipoAtencion).toBe('IP');
  });
});
