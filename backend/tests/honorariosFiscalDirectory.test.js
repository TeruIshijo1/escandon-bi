'use strict';
jest.mock('../services/sap.service', () => ({ get: jest.fn() }));
jest.mock('../config/sap.config', () => ({ baseUrl: 'https://sap.example.test/b1s/v1' }));
const sap = require('../services/sap.service');
const { buildFiscalDirectory, getFiscalDirectory } = require('../services/honorariosFiscalDirectory.service');
const date = '2026-10-01';
const doctor = { id: 1, name: 'ANA PRUEBA MEDINA' };
const codes = [
  { WTCode: 'SER', WTName: 'ISR', Rate: 10, BaseType: 'wtcbt_Net', BaseAmount: 100, Category: 'wtcc_Invoice', EffectiveFrom: '2025-01-01', Inactive: 'tNO' },
  { WTCode: '1V', WTName: 'IVA', Rate: 66.667, BaseType: 'wtcbt_VAT', BaseAmount: 100, Category: 'wtcc_Payment', EffectiveFrom: '2025-01-01', Inactive: 'tNO' },
  { WTCode: 'IV', WTName: 'IVA', Rate: 30, BaseType: 'wtcbt_Net', BaseAmount: 100, Category: 'wtcc_Payment', EffectiveFrom: '2025-01-01', Inactive: 'tNO' }
];
const supplier = (changes = {}) => ({ CardCode: 'P1', CardName: 'DRA MEDINA ANA PRUEBA', FederalTaxID: 'AAAA800101AAA',
  U_B1SYS_FiscRegime: '', SubjectToWithholdingTax: 'boYES', BPWithholdingTaxCollection: [{ WTCode: 'SER' }, { WTCode: '1V' }], ...changes });
const entry = (row = supplier(), taxes = codes, doctors = [doctor]) => buildFiscalDirectory(doctors, [row], taxes, date)[0];

test('complete SAP configuration is ready even if optional SAP regime is blank, without inventing missing fields', () => {
  expect(entry()).toMatchObject({ providerId: '1', sapReady: true, canCalculateWithoutVat: true, canCalculateWithVat: true,
    suggestedProfile: { federalTaxId: 'AAAA800101AAA', fiscalRegime: '', isrRate: .1, vatFraction: 2 / 3 } });
  expect(entry().suggestedProfile.defaultVatRate).toBeUndefined();
  expect(entry().suggestedProfile.validFrom).toBeUndefined();
  expect(entry(supplier({ U_B1SYS_FiscRegime: '612' })).suggestedProfile.fiscalRegime).toBe('612');
});
test('an ISR-only supplier remains pending for VAT and never suggests VAT withholding zero', () => {
  expect(entry(supplier({ BPWithholdingTaxCollection: [{ WTCode: 'SER' }] }))).toMatchObject({ sapReady: false,
    canCalculateWithoutVat: true, canCalculateWithVat: false, suggestedProfile: { isrRate: .1, vatFraction: '' } });
});
test('ambiguous suppliers and shared clinical names cannot seed someone else\'s fiscal identity', () => {
  expect(buildFiscalDirectory([doctor], [supplier(), supplier({ CardCode: 'P2' })], codes, date)[0])
    .toMatchObject({ sapReady: false, sap: { linkStatus: 'ambiguo', candidates: [] }, suggestedProfile: {} });
  for (const row of buildFiscalDirectory([doctor, { id: 2, name: 'MEDINA ANA PRUEBA' }], [supplier()], codes, date))
    expect(row).toMatchObject({ sapReady: false, sap: { linkStatus: 'ambiguo', candidates: [] }, suggestedProfile: {} });
  expect(entry(supplier({ CardName: 'ANA OTRA MEDINA' }))).toMatchObject({ sapReady: false, sap: { linkStatus: 'sin_coincidencia' } });
});
test('unsupported, future, unknown inactive or missing RFC configurations are not marked ready', () => {
  for (const row of [supplier({ FederalTaxID: '' }), supplier({ SubjectToWithholdingTax: null }),
    supplier({ BPWithholdingTaxCollection: [{ WTCode: 'SER' }, { WTCode: 'IV' }] })]) expect(entry(row).sapReady).toBe(false);
  expect(entry(supplier(), codes.map(code => ({ ...code, EffectiveFrom: '2026-10-02' }))).sapReady).toBe(false);
  expect(entry(supplier(), codes.map(code => ({ ...code, Inactive: null }))).sapReady).toBe(false);
});
test('explicit non-withholding with no active codes is ready and retains zeros', () => {
  expect(entry(supplier({ SubjectToWithholdingTax: 'boNO', BPWithholdingTaxCollection: [] }))).toMatchObject({
    sapReady: true, suggestedProfile: { isrRate: 0, vatFraction: 0 } });
  expect(entry(supplier({ SubjectToWithholdingTax: 'boNO' })).sapReady).toBe(false);
});
test('rejects impossible dates before any remote SAP request', async () => {
  await expect(getFiscalDirectory([doctor], { date: '2026-02-30' })).rejects.toThrow();
  expect(sap.get).not.toHaveBeenCalled();
});
test('master-only paginated read, cached reuse, refresh and unavailable SAP cannot claim readiness', async () => {
  let calls = 0;
  sap.get.mockImplementation(async endpoint => {
    calls++; expect(endpoint).not.toContain('$top');
    if (endpoint.startsWith('/WithholdingTaxCodes')) return { data: { value: codes } };
    if (endpoint === '/BusinessPartners?$skip=200') return { data: { value: [supplier()] } };
    expect(endpoint.startsWith('/BusinessPartners?')).toBe(true);
    return { data: { value: Array.from({ length: 200 }, (_, i) => supplier({ CardCode: `OTHER${i}`, CardName: `OTRO ${i}` })), 'odata.nextLink': 'BusinessPartners?$skip=200' } };
  });
  expect((await getFiscalDirectory([doctor], { date })).doctors[0].sapReady).toBe(true);
  expect(calls).toBe(3);
  await getFiscalDirectory([doctor], { date }); expect(calls).toBe(3);
  await getFiscalDirectory([doctor], { date, refresh: true }); expect(calls).toBe(6);
  sap.get.mockRejectedValue(new Error('offline'));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await getFiscalDirectory([doctor], { date, refresh: true })).toMatchObject({ sapAvailable: false, asOf: null,
    doctors: [{ sapReady: false, sap: { linkStatus: 'sin_consultar' } }] });
  expect((await getFiscalDirectory([doctor], { date })).sapAvailable).toBe(false);
  warning.mockRestore();
});
