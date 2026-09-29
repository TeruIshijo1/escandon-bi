'use strict';
const { mergeRecoveredAppointments } = require('../services/honorariosCoverage.service');
const candidate = changes => ({ PCAPNum:1,PCAP_ST:'SH',UDF_Ejecutada:true,SO_ST:null,TariffCount:1,Fee:225,
  Medico:'PRUEBA',PRNum:1,ItemCode:'C1',MissingPatient:0,OtherAppointments:0,OtherOrders:0,OtherCharges:0,
  UDF_IVA:16,UDF_ISR:0.1,FechaAtencion:'2026-08-01',...changes });

test('fills an audit placeholder with the appointment tariff but never approves it', () => {
  const source=[{UDRKey:'CITA-1',PrecioCobradoPaciente:999,ElegiblePago:0}];
  const result=mergeRecoveredAppointments(source,[candidate()]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({BaseImporte:225,IvaLinea:36,ElegiblePago:0,PrecioCobradoPaciente:null});
  expect(source[0].BaseImporte).toBeUndefined();
  expect(result.coverage.recoveredAppointments).toBe(1);
});

test('keeps possible duplicates and unperformed appointments visible for a human decision', () => {
  const result=mergeRecoveredAppointments([], [candidate({OtherCharges:1}),candidate({PCAPNum:2,UDF_Ejecutada:false})]);
  expect(result.rows).toHaveLength(2);
  expect(result.rows.every(row=>row.ElegiblePago===0 && row.BaseImporte===225)).toBe(true);
  expect(result.rows[0].MensajeAuditoria).toMatch(/Existe un cargo/);
  expect(result.rows[1].MensajeAuditoria).toMatch(/no está marcada como realizada/);
});

test('never duplicates a represented source or invents missing tariffs and VAT', () => {
  const result=mergeRecoveredAppointments([{UDRKey:'CITA-1',CodigoServicio:'C1',BaseImporte:225}],
    [candidate(),candidate({PCAPNum:2,TariffCount:2}),candidate({PCAPNum:3,UDF_IVA:null,MinVatRate:null,MaxVatRate:null})]);
  expect(result.rows).toHaveLength(3);
  expect(result.rows[1].BaseImporte).toBeNull();
  expect(result.rows[2].IvaLinea).toBeNull();
  expect(result.coverage.duplicateCandidates).toBe(1);
});
