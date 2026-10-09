'use strict';
jest.mock('../services/sap.service', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../services/sapInventory.service', () => ({}));
jest.mock('../config/pg-db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn(), sql: {} }));
const { getEntityCatalog, getAssistantCatalog } = require('../services/sapQueryBuilder.service');
const { selectResources } = require('../services/assistantResourceSelection.service');
const { prepareReport } = require('../services/reportAssistant.service');
const catalog = getAssistantCatalog();
const keys = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'];
let environment;
beforeEach(() => { environment = keys.map(key => process.env[key]); keys.forEach(key => delete process.env[key]); });
afterEach(() => { keys.forEach((key,index) => { if (environment[index] == null) delete process.env[key]; else process.env[key] = environment[index]; }); });
const prepare = (message, extra = {}) => prepareReport({ message, catalog: selectResources(catalog, message, extra.context, extra.pending), now: new Date('2026-10-08T15:00:00Z'), ...extra });
test('all expanded sources remain outside the manual picker', () => {
  expect(getEntityCatalog().some(entity => entity.assistantOnly)).toBe(false);
  expect(catalog.filter(entity => entity.assistantOnly).length).toBeGreaterThan(400);
});
test.each([
  ['Necesito ver acuerdos comerciales y estados de cuenta del paciente del mes pasado', 'assistant_patient_accounts'],
  ['Acuerdos comerciales con descuento global registrado', 'assistant_commercial_agreements'],
  ['Estatus de cuentas hospitalarias del mes pasado', 'assistant_account_billing_collections'],
  ['Cuáles cuentas ya están facturadas y cuáles ya las pagaron al hospital del mes pasado', 'assistant_account_billing_collections'],
  ['Listas de precios público general y hospitalización', 'assistant_public_hospital_prices'],
  ['Socios de negocios en SAP con RFC y lista de precios', 'assistant_resource_sap__BusinessPartners'],
  ['Socios de negocios en SAP con RFC y límite de crédito', 'assistant_resource_sap__BusinessPartners'],
])('completes the entire requested financial resource: %s', async (message, entity) => {
  const result = await prepare(message);
  expect(result).toMatchObject({ status: 'ready', plan: { entity } });
});
test.each([['Solo cuentas sin facturar del mes pasado','UNBILLED'],['Solo cuentas pagadas al hospital del mes pasado','COLLECTED']])('uses supported financial conditions: %s', async (message,state) => {
  const result = await prepare(message);
  expect(result).toMatchObject({ status: 'ready', plan: { entity:'assistant_account_billing_collections', filters: { estatusDoc: state } } });
});
test('keeps agreements and accounts while asking only for the required dates', async () => {
  const first = await prepare('Necesito ver acuerdos comerciales y estados de cuenta del paciente');
  expect(first).toMatchObject({ status: 'clarification', plan: { entity:'assistant_patient_accounts' } });
  const next = await prepare('Septiembre de 2026', { context:first.plan, pending:first.pending });
  expect(next).toMatchObject({ status:'ready', plan:{ entity:'assistant_patient_accounts', filters:{ fechaDesde:'2026-09-01',fechaHasta:'2026-09-30' } } });
});
test('financial condition choices resolve without dropping a condition silently or asking again', async () => {
  const first = await prepare('Solo cuentas facturadas y pagadas al hospital del mes pasado');
  expect(first.status).toBe('clarification');
  const choice = first.options.find(option=>option.label==='Con facturas cubiertas por cobros SAP');
  expect(choice).toBeDefined();
  const next = await prepare(choice.message,{context:first.plan,pending:first.pending});
  expect(next).toMatchObject({status:'ready',plan:{entity:'assistant_account_billing_collections',filters:{estatusDoc:'COLLECTED'}}});
});

test.each([
  ['deducibles', 'Copago del convenio', 'CopayAmount'],
  ['dedicibles', 'Copago del convenio (%)', 'CopayPercentage'],
])('agreement conditions retain each chosen measure without repeating questions: %s / %s', async (deductible, copayLabel, copayKey) => {
  const first = await prepare(`Necesito los acuerdos con descuentos, ${deductible}, copagos y coaseguros`);
  expect(first).toMatchObject({ status: 'clarification', plan: { entity: 'assistant_commercial_agreements' } });
  const discount = first.options.find(option => option.label === 'Descuento global registrado (%)');
  expect(discount).toBeDefined();
  const second = await prepare(discount.message, { context: first.plan, pending: first.pending });
  expect(second.status).toBe('clarification');
  expect(second.options.map(option => option.label)).toEqual(['Copago del convenio', 'Copago del convenio (%)']);
  const copay = second.options.find(option => option.label === copayLabel);
  const final = await prepare(copay.message, { context: second.plan, pending: second.pending });
  expect(final).toMatchObject({ status: 'ready', pending: null, plan: { entity: 'assistant_commercial_agreements' } });
  expect(final.plan.selectedFields).toEqual(expect.arrayContaining(['AgreementCode', 'AgreementName', 'GlobalDiscount', 'Deductible', copayKey, 'CoinsurancePercentage']));
  expect(final.plan.selectedFields).toEqual(expect.arrayContaining(['DeductibleItemName', 'DefaultDeductible', 'Coinsurance', 'CoinsuranceItemName', 'DefaultCoinsurancePercentage', copayKey === 'CopayAmount' ? 'CopayAmountItemName' : 'CopayPercentageItemName', copayKey === 'CopayAmount' ? 'DefaultCopayAmount' : 'DefaultCopayPercentage']));
  expect(final.plan.selectedFields).not.toContain(copayKey === 'CopayAmount' ? 'CopayPercentage' : 'CopayAmount');
});

test('an exact amount or percentage label distinguishes identically worded financial measures', async () => {
  for (const [label, key] of [['Copago del convenio', 'CopayAmount'], ['Copago del convenio (%)', 'CopayPercentage']]) {
    const result = await prepare(`Acuerdos comerciales con ${label}`);
    expect(result).toMatchObject({ status: 'ready', plan: { entity: 'assistant_commercial_agreements' } });
    expect(result.plan.selectedFields).toContain(key);
    expect(result.plan.selectedFields).not.toContain(key === 'CopayAmount' ? 'CopayPercentage' : 'CopayAmount');
  }
});

test('answering financial clarifications in a different order preserves both selections', async () => {
  const first = await prepare('Necesito los convenios con descuentos, deducibles, copagos y coaseguros');
  const copay = await prepare('Me refiero a «Copago del convenio (%)».', { context: first.plan, pending: first.pending });
  expect(copay.status).toBe('clarification');
  expect(copay.options.some(option => option.label.includes('Copago'))).toBe(false);
  const discount = copay.options.find(option => option.label === 'Descuento global registrado (%)');
  expect(discount).toBeDefined();
  const final = await prepare(discount.message, { context: copay.plan, pending: copay.pending });
  expect(final.status).toBe('ready');
  expect(final.plan.selectedFields).toEqual(expect.arrayContaining(['GlobalDiscount', 'Deductible', 'CopayPercentage', 'CoinsurancePercentage']));
  expect(final.plan.selectedFields).not.toContain('CopayAmount');
});

test('agreement identity defaults still honor an explicit request for only a chosen condition', async () => {
  const plain = await prepare('Necesito los acuerdos');
  expect(plain.status).toBe('ready');
  expect(plain.plan.selectedFields).toEqual(catalog.find(entity => entity.id === 'assistant_commercial_agreements').defaultFields);
  const withDiscount = await prepare('Acuerdos comerciales con descuento global registrado (%)');
  expect(withDiscount.plan.selectedFields).toEqual(['AgreementCode', 'AgreementName', 'GlobalDiscount']);
  const only = await prepare('Solo descuento global registrado (%)', { context: withDiscount.plan });
  expect(only).toMatchObject({ status: 'ready', plan: { selectedFields: ['GlobalDiscount'] } });
});

test.each([
  ['Cargo administrativo del convenio', 'AdministrativeChargeAmount'],
  ['Cargo administrativo del convenio (%)', 'AdministrativeChargePercent'],
  ['Descripción del cargo administrativo', 'AdministrativeChargeDescription'],
])('an exact schema column resolves an administrative clarification without a vocabulary rule: %s', async (label, key) => {
  const first = await prepare('Acuerdos comerciales con cargos administrativos');
  expect(first.status).toBe('clarification');
  const choice = first.options.find(option => option.label === label);
  expect(choice).toBeDefined();
  const final = await prepare(choice.message, { context: first.plan, pending: first.pending });
  expect(final).toMatchObject({ status: 'ready', pending: null, plan: { selectedFields: ['AgreementCode', 'AgreementName', key] } });
});

test('a generic administrative choice and financial choices remain resolved across consecutive answers', async () => {
  let result = await prepare('Necesito los acuerdos con descuentos, cargos administrativos y copagos');
  for (const label of ['Descuento global registrado (%)', 'Cargo administrativo del convenio (%)', 'Copago del convenio']) {
    const choice = result.options.find(option => option.label === label);
    expect(choice).toBeDefined();
    result = await prepare(choice.message, { context: result.plan, pending: result.pending });
  }
  expect(result.status).toBe('ready');
  expect(result.plan.selectedFields).toEqual(expect.arrayContaining(['AgreementCode', 'AgreementName', 'GlobalDiscount', 'AdministrativeChargePercent', 'CopayAmount']));
  expect(result.plan.selectedFields).not.toContain('AdministrativeChargeAmount');
  expect(result.plan.selectedFields).not.toContain('CopayPercentage');
});

test('a percentage concept includes its description and separately labeled numeric default', async () => {
  const condition = await prepare('Acuerdos comerciales con porcentaje de copago');
  expect(condition).toMatchObject({ status: 'ready', plan: { selectedFields: ['AgreementCode', 'AgreementName', 'CopayPercentage', 'CopayPercentageItemName', 'DefaultCopayPercentage'] } });
  const defaults = await prepare('Acuerdos comerciales con deducible predeterminado, copago predeterminado (%) y coaseguro predeterminado (%)');
  expect(defaults).toMatchObject({ status: 'ready', plan: { selectedFields: ['AgreementCode', 'AgreementName', 'DefaultDeductible', 'DefaultCopayPercentage', 'DefaultCoinsurancePercentage'] } });
});
test('AI can resolve a new administrative phrase through the authorized richer schema while retaining known columns', async () => {
  process.env.OPENAI_API_KEY='synthetic-schema-test-key';
  const fetchImpl=jest.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({status:'ready',plan:{entity:'assistant_resource_sap__BusinessPartners',selectedFields:['FederalTaxID','MaxCommitment'],filters:{}},missingFields:[]})}}]})});
  const message='Socios de negocios en SAP con RFC y tope de compromiso autorizado';
  const result=await prepare(message,{fetchImpl});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({status:'ready',engine:'ai',plan:{entity:'assistant_resource_sap__BusinessPartners',selectedFields:['FederalTaxID','MaxCommitment']}});
  fetchImpl.mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({status:'ready',plan:{entity:'assistant_resource_sap__BusinessPartners',selectedFields:['MaxCommitment'],filters:{}},missingFields:[]})}}]})});
  expect((await prepare(message,{fetchImpl})).status).toBe('unsupported');
});
test('an AI resolving novel schema wording cannot switch the explicitly requested origin', async () => {
  process.env.OPENAI_API_KEY='synthetic-schema-test-key';
  const fetchImpl=jest.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({status:'ready',plan:{entity:'assistant_resource_vertical__dbo__AG',selectedFields:['PriceFactor'],filters:{}},missingFields:[]})}}]})});
  const result=await prepare('Socios de negocios en SAP con tope de compromiso autorizado',{catalog,fetchImpl});
  expect(result.status).not.toBe('ready');
});
