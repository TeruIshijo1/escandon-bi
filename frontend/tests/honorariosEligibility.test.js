import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDoctorReviewRows, isHonorarioReviewEligible } from '../src/utils/honorariosEligibility.js';

const service = (changes = {}) => ({ ModeBI: true, CatalogStatus: 'INCLUIDO', CatalogApproved: true,
  ReviewEligible: true, MedicoId: 7, Medico: 'MÉDICO PRUEBA', CodigoServicio: 'SER1',
  RolMedico: 'TRATANTE', FechaAtencion: '2026-10-02', CatalogSnapshot: { active: true },
  TariffSnapshot: { id: 1, itemCode: 'SER1', amount: 250, active: true,
    validFrom: '2026-10-01', validTo: '2026-10-31', providerId: 7, role: 'TRATANTE' }, ...changes });

test('configurar el catálogo habilita revisión sin aprobar la atención', () => {
  for (const status of ['PENDIENTE', 'APROBADO', 'RECHAZADO']) {
    const row = service({ _reviewStatus: status, MedicoConfirmado: false, Cantidad: null, EjecucionConfirmada: false });
    assert.equal(isHonorarioReviewEligible(row), true);
    assert.equal(row._reviewStatus, status);
  }
});

test('ningún estado humano abre un servicio pendiente, inactivo o excluido del catálogo', () => {
  for (const change of [{ ReviewEligible: false }, { CatalogApproved: false }, { CatalogStatus: 'PENDIENTE' },
    { CatalogStatus: 'EXCLUIDO' }, { ScopeExcluded: true }, { CatalogSnapshot: { active: false } },
    { CatalogSnapshot: { scopeExcluded: true } }, { TariffSnapshot: null }, { ModeBI: false },
    { TipoCalculo: 'SAP_DOCUMENTO' }, { MedicoId: null }, { Medico: '' }]) {
    assert.equal(isHonorarioReviewEligible(service({ _reviewStatus: 'APROBADO', _effectiveElegible: true, ...change })), false, JSON.stringify(change));
  }
});

test('tarifas deben aplicar al servicio, médico, función y fecha con importe positivo', () => {
  for (const change of [{ providerId: 9 }, { itemCode: 'OTRO' }, { role: 'ANESTESIOLOGO' }, { amount: null },
    { amount: 0 }, { amount: -10 }, { amount: 'incorrecto' }, { active: false },
    { validFrom: '2026-10-03' }, { validTo: '2026-10-01' }, { validFrom: 'inválida' }]) {
    assert.equal(isHonorarioReviewEligible(service({ TariffSnapshot: { ...service().TariffSnapshot, ...change } })), false, JSON.stringify(change));
  }
  assert.equal(isHonorarioReviewEligible(service({ TariffSnapshot: { ...service().TariffSnapshot, providerId: null, role: null } })), true);
});

test('los dos extremos de vigencia son inclusivos y los datos sin fecha no se exportan', () => {
  assert.equal(isHonorarioReviewEligible(service({ FechaAtencion: '2026-10-01' })), true);
  assert.equal(isHonorarioReviewEligible(service({ FechaAtencion: '2026-10-31' })), true);
  assert.equal(isHonorarioReviewEligible(service({ FechaAtencion: null })), false);
});

test('una decisión guardada puede conservar al médico beneficiario y su tarifa aplicable', () => {
  const reassigned = service({ MedicoId: 8, Medico: 'MÉDICO SOLICITANTE', TariffSnapshot: null,
    ReviewBeneficiary: { providerId: 7, providerName: 'MÉDICO PRUEBA', role: 'TRATANTE', origin: 'saved_approval' },
    ReviewEligibilityTariff: service().TariffSnapshot });
  assert.equal(isHonorarioReviewEligible(reassigned), true);
  assert.equal(isHonorarioReviewEligible({ ...reassigned, ReviewEligibilityTariff: { ...service().TariffSnapshot, providerId: 8 } }), false);
  assert.equal(isHonorarioReviewEligible({ ...reassigned, ReviewEligible: false }), false);
});

test('el PDF de un médico no incorpora otros médicos ni homónimos con diferente ID', () => {
  const own = service();
  const another = service({ Medico: 'OTRO MÉDICO', MedicoId: 9, TariffSnapshot: { ...own.TariffSnapshot, providerId: null } });
  const namesake = { ...another, Medico: own.Medico };
  const invalid = service({ ReviewEligible: false });
  const filasRevision = [own, another, namesake, invalid];
  assert.deepEqual(filterDoctorReviewRows({ medico: 'MÉDICO PRUEBA · #7', filasRevision }), [own]);
  assert.deepEqual(filterDoctorReviewRows({ medico: 'MÉDICO PRUEBA', providerId: 7, filasRevision }), [own]);
  assert.deepEqual(filterDoctorReviewRows({ medico: 'MÉDICO PRUEBA', filasRevision }), []);
  assert.deepEqual(filterDoctorReviewRows({ medico: 'MÉDICO PRUEBA', filas: [own] }), [own]);
});
