'use strict';

const assert = require('node:assert/strict');
jest.mock('../services/sap.service', () => ({ get: jest.fn() }));
jest.mock('../config/sap.config', () => ({ baseUrl: 'https://sap.example.test/b1s/v1' }));
const sap = require('../services/sap.service');
const { reconcileHonorariosWithSap } = require('../services/honorariosSapReconciliation.service');
const input = { startDate: '2026-09-01', endDate: '2026-09-25', doctors: ['ANA PRUEBA MEDINA'] };

test('reads beyond supplier 200 and preserves posted withholding amounts and missing regime', async () => {
  let supplierPages = 0;
  sap.get = async (endpoint, headers) => {
    assert.ok(!endpoint.includes('$top='), '$top truncates the entire SAP collection');
    assert.equal(headers.Prefer, 'odata.maxpagesize=200');
    if (endpoint.startsWith('/BusinessPartnerGroups')) return { data: { value: [{ Code: 108, Name: 'HONORARIOS' }] } };
    if (endpoint.startsWith('/WithholdingTaxCodes')) return { data: { value: [
      { WTCode: 'SER', WTName: 'Retención de ISR', Rate: 10, BaseType: 'wtcbt_Net', BaseAmount: 100, Category: 'wtcc_Invoice', EffectiveFrom: '2025-12-26', Inactive: 'tNO' },
      { WTCode: 'SERI', WTName: 'Retención de IVA', Rate: 10.66 }
    ] } };
    if (endpoint.startsWith('/BusinessPartners')) {
      supplierPages++;
      return { data: endpoint.includes('$skip=200') ? { value: [{
        CardCode: 'P00201', CardName: 'MEDINA ANA PRUEBA', GroupCode: 108,
        FederalTaxID: '', U_B1SYS_FiscRegime: null, SubjectToWithholdingTax: 'boYES', BPWithholdingTaxCollection: [{ WTCode: 'SER' }, { WTCode: 'NO_CONFIG' }]
      }] } : { value: Array.from({ length: 200 }, (_, i) => ({ CardCode: `P${i}`, CardName: `PROVEEDOR ${i}` })),
        'odata.nextLink': 'BusinessPartners?$skip=200' } };
    }
    if (endpoint.startsWith('/VendorPayments')) {
      assert.ok(decodeURIComponent(endpoint).includes("DocDate le '2026-10-25'"), 'payments include the automatic 30-day lookahead');
      return { data: { value: [] } };
    }
    if (endpoint.startsWith('/PurchaseInvoices')) {
      assert.ok(decodeURIComponent(endpoint).includes("DocDate le '2026-10-25'"), 'invoices include the automatic 30-day lookahead');
      assert.match(endpoint, /DocTotalFc/);
      assert.ok(!endpoint.includes('DocTotalFC'));
      return { data: { value: [{
        DocEntry: 1, DocNum: 1, CardCode: 'P00201', DocCurrency: 'MXN',
        DocTotal: 7769.66, VatSum: 0, PaidToDate: 0, Comments: 'Servicios de agosto',
        WithholdingTaxDataWTXCollection: [
          { WTCode: 'SER', WTAmount: 815, TaxableAmount: 0, Rate: 10 },
          { WTCode: 'SERI', WTAmount: 869.34, TaxableAmount: 9454, Rate: 10.66 }
        ]
      }] } };
    }
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  const result = await reconcileHonorariosWithSap(input);
  assert.deepEqual(result.period, {
    startDate: '2026-09-01', endDate: '2026-10-25', serviceStartDate: '2026-09-01',
    serviceEndDate: '2026-09-25', lookaheadDays: 30,
    dateBasis: 'fecha de contabilización de factura y fecha del pago'
  });
  assert.equal(supplierPages, 2);
  assert.deepEqual(result.supplierCoverage, { count: 201, withFiscalRegime: 0, complete: true });
  const provider = result.providers[input.doctors[0]];
  assert.equal(provider.linkStatus, 'candidato_unico');
  assert.equal(provider.candidates[0].fiscalRegime, null);
  assert.equal(provider.candidates[0].identityVerified, false);
  assert.equal(provider.candidates[0].groupName, 'HONORARIOS');
  assert.equal(provider.candidates[0].subjectToWithholding, true);
  assert.equal(provider.candidates[0].fiscalRegimeEffectiveDate, null);
  assert.deepEqual(provider.candidates[0].configuredWithholdings[0], {
    description: 'Retención de ISR', rate: 10, estimateRule: 'isr_on_fee', calculationBase: 'base neta definida en SAP',
    basePercentage: 100, appliesAt: 'factura', codeEffectiveFrom: '2025-12-26', inactive: false
  });
  assert.equal(provider.candidates[0].configuredWithholdings[1].rate, null);
  assert.equal(provider.candidates[0].configuredWithholdings[1].inactive, null);
  assert.equal(provider.invoices[0].comments, 'Servicios de agosto');
  assert.equal(provider.invoices[0].retentions[1].description, 'Retención de IVA');
  assert.equal(provider.invoices[0].retentions[1].amount, 869.34);
  assert.equal(provider.totalsByCurrency[0].documentTotal, 7769.66);
  assert.equal(provider.totalsByCurrency[0].withholdings[0].description, 'Retención de ISR');
});

test('fails explicitly if a later supplier page fails instead of reporting no match', async () => {
  sap.get = async endpoint => {
    if (!endpoint.startsWith('/BusinessPartners')) return { data: { value: [] } };
    if (endpoint.includes('$skip=')) throw new Error('Page unavailable');
    return { data: { value: [], '@odata.nextLink': '/b1s/v1/BusinessPartners?$skip=200' } };
  };
  await assert.rejects(reconcileHonorariosWithSap(input), /Page unavailable/);
});

test('rejects pagination outside the configured SAP origin', async () => {
  sap.get = async endpoint => ({ data: { value: [], ...(endpoint.startsWith('/BusinessPartners')
    ? { '@odata.nextLink': 'https://other.example.test/BusinessPartners' } : {}) } });
  await assert.rejects(reconcileHonorariosWithSap(input), /fuera de Service Layer/);
});

test('preserves a supplier exemption flag even when withholding codes remain assigned', async () => {
  sap.get = async endpoint => {
    if (endpoint.startsWith('/BusinessPartners')) return { data: { value: [{
      CardCode: 'P1', CardName: input.doctors[0], SubjectToWithholdingTax: 'boNO',
      BPWithholdingTaxCollection: [{ WTCode: 'W' }]
    }] } };
    if (endpoint.startsWith('/WithholdingTaxCodes')) return { data: { value: [{
      WTCode: 'W', WTName: 'Retención de IVA', Rate: 66.66, BaseType: 'wtcbt_VAT',
      BaseAmount: 100, Category: 'wtcc_Payment', Inactive: 'tYES'
    }] } };
    return { data: { value: [] } };
  };
  const result = await reconcileHonorariosWithSap(input);
  const candidate = result.providers[input.doctors[0]].candidates[0];
  assert.equal(candidate.subjectToWithholding, false);
  assert.equal(candidate.configuredWithholdings[0].inactive, true);
  assert.equal(candidate.configuredWithholdings[0].calculationBase, 'IVA definido en SAP');
  assert.equal(candidate.configuredWithholdings[0].appliesAt, 'pago');
});

test('only reviewed withholding configurations enable estimates, without changing catalog rates', async () => {
  sap.get = async endpoint => {
    if (endpoint.startsWith('/BusinessPartners')) return { data: { value: [{
      CardCode: 'P1', CardName: input.doctors[0], SubjectToWithholdingTax: 'boYES',
      BPWithholdingTaxCollection: ['SERI', '1V', 'IV', 'RES', 'OTHER'].map(WTCode => ({ WTCode }))
    }] } };
    if (endpoint.startsWith('/WithholdingTaxCodes')) return { data: { value: [
      { WTCode: 'SERI', WTName: 'Retención de IVA Servicios Profesionales', Rate: 10.66, BaseType: 'wtcbt_Net', BaseAmount: 100 },
      { WTCode: '1V', WTName: 'Retención de IVA, 2/3', Rate: 66.66, BaseType: 'wtcbt_VAT', BaseAmount: 100 },
      { WTCode: 'IV', WTName: 'Retención de IVA', Rate: 30, BaseType: 'wtcbt_Net', BaseAmount: 100 },
      { WTCode: 'RES', WTName: 'Retención de ISR RESICO', Rate: 1.25, BaseType: 'wtcbt_Net', BaseAmount: 100, WithholdingType: 'wt_VAT' },
      { WTCode: 'OTHER', WTName: 'Retención de IVA', Rate: 10.66, BaseType: 'wtcbt_Net', BaseAmount: 100 }
    ] } };
    return { data: { value: [] } };
  };
  const result = await reconcileHonorariosWithSap(input);
  const rows = result.providers[input.doctors[0]].candidates[0].configuredWithholdings;
  assert.deepEqual(rows.map(row => row.estimateRule), ['vat_two_thirds', 'vat_two_thirds', null, 'isr_on_fee', null]);
  assert.deepEqual(rows.map(row => row.rate), [10.66, 66.66, 30, 1.25, 10.66]);
});

test('discovers missing and generic honorarios suppliers and retrieves invoices paid outside the posting period once', async () => {
  const suppliers=[
    {CardCode:'M1',CardName:'DOCTORA NUEVA',GroupCode:104},
    {CardCode:'G1',CardName:'SERVICIO POR REVISAR',GroupCode:108},
    {CardCode:'X1',CardName:'OTRO GIRO',GroupCode:999}
  ];
  let outsideReads=0;
  sap.get=async endpoint=>{
    if(endpoint.startsWith('/BusinessPartners'))return {data:{value:suppliers}};
    if(endpoint.startsWith('/BusinessPartnerGroups'))return {data:{value:[{Code:104,Name:'HONMED'},{Code:108,Name:'HONORARIOS'}]}};
    if(endpoint.startsWith('/WithholdingTaxCodes'))return {data:{value:[]}};
    if(endpoint==='/PurchaseInvoices(30)'){
      outsideReads++;return {data:{DocEntry:30,DocNum:30,DocDate:'2026-08-01',CardCode:'G1',DocCurrency:'MXN',DocTotal:1234,PaidToDate:1234}};
    }
    if(endpoint.startsWith('/PurchaseInvoices?'))return {data:{value:[
      {DocEntry:10,DocNum:10,CardCode:'M1',DocCurrency:'MXN',DocTotal:1000,DocumentLines:[{LineNum:0,ItemDescription:'Guardias',Quantity:1,LineTotal:1000}]},
      {DocEntry:20,DocNum:20,CardCode:'X1',DocCurrency:'MXN',DocTotal:999}
    ]}};
    if(endpoint.startsWith('/VendorPayments'))return {data:{value:[{DocEntry:5,CardCode:'G1',DocDate:'2026-09-10',PaymentInvoices:[
      {DocEntry:30,InvoiceType:'it_PurchaseInvoice',SumApplied:1000},{DocEntry:30,InvoiceType:'it_PurchaseInvoice',SumApplied:234}
    ]}]}};
    throw new Error(endpoint);
  };
  const result=await reconcileHonorariosWithSap({...input,doctors:[],includeAdditional:true});
  expect(result.additionalProviders).toHaveLength(2);
  expect(result.additionalProviders[0].invoices[0].lines[0].description).toBe('Guardias');
  expect(result.additionalProviders[1].invoices[0]).toMatchObject({docEntry:30,documentTotal:1234,locatedByPayment:true});
  expect(result.additionalProviders[1].discoveryBasis).toMatch(/confirmar/);
  expect(outsideReads).toBe(1);
});
