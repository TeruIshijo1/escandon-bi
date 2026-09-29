'use strict';
jest.mock('../config/db',()=>({getDb:jest.fn()}));
const { canReview, validateDecision } = require('../services/honorariosReview.service');
const input = () => ({rowId:'CITA-1|1',serviceDate:'2026-08-01',expectedRevision:0,
  decision:{action:'APROBAR',customAmount:225,fingerprint:'observed-source',motivo:'Tabulador revisado',vatRate:null}});

test('uses the existing Honorarios module permission, not a new role or unrelated permission',()=>{
  expect(canReview({role:'USUARIO_OPERATIVO',permisos:['interconsultas-jornadas']})).toBe(true);
  expect(canReview({role:'ADMIN',permisos:[]})).toBe(false);
  expect(canReview({role:'ADMIN',permisos:['consulta-externa']})).toBe(false);
  expect(canReview({username:'amendoza'})).toBe(true);
});
test('rejects invalid amounts, missing rationale, unsupported VAT and revision values',()=>{
  for (const modify of [x=>x.decision.customAmount=-1,x=>x.decision.customAmount=NaN,
    x=>x.decision.motivo='',x=>x.decision.vatRate=0.5,x=>x.expectedRevision=-1]) {
    const value=input();modify(value);expect(()=>validateDecision(value)).toThrow();
  }
  expect(validateDecision(input()).decision).toMatchObject({customAmount:225,vatRate:null});
});
test('SAP approval preserves posted amounts instead of accepting a replacement fee',()=>{
  const value=input();value.decision.sourceType='SAP_DOCUMENTO';value.decision.customAmount=99999;
  expect(validateDecision(value).decision.customAmount).toBeNull();
});
