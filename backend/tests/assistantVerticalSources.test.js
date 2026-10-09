'use strict';

jest.mock('../config/remote-db', () => ({ connectRemoteDB: jest.fn(), sql: require('mssql') }));
const { connectRemoteDB, sql } = require('../config/remote-db');
const { catalog, execute } = require('../services/assistantVerticalSources.service');
const fs = require('fs');
const path = require('path');

let request;
const period = { fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', limit: 2 };
beforeEach(() => {
  jest.clearAllMocks();
  request = { input: jest.fn().mockReturnThis(), query: jest.fn().mockResolvedValue({ recordset: [] }) };
  connectRemoteDB.mockResolvedValue({ request: () => request });
});

test('sources are assistant-only and retain independent permissions and nonadditive account totals', () => {
  expect(catalog.assistant_commercial_agreements).toMatchObject({ assistantOnly: true, requiresDateFilter: false,
    requiredPermissions: ['assistant_commercial_agreements'], summary: {} });
  expect(catalog.assistant_patient_accounts).toMatchObject({ assistantOnly: true, requiresDateFilter: true,
    requiredPermissions: ['vertical_accounts', 'assistant_commercial_agreements'], summary: {},
    nonAdditiveFields: ['AccountTotal', 'AccountBalance', 'AccountDownpayments'] });
});

test('account joins preserve accounts without an agreement and use the agreement payer rather than its code', async () => {
  await execute('assistant_patient_accounts', period);
  const query = request.query.mock.calls[0][0];
  expect(query).toContain('LEFT JOIN dbo.PCAG pa ON pa.PCNum = pc.PCNum');
  expect(query).toContain('LEFT JOIN dbo.AG ag ON ag.AGCode = pa.AGCode');
  expect(query).toContain('COALESCE(pa.BPCode, ag.BPCode, pc.BPCode) AS [BPCode]');
  expect(query).toContain('GROUP BY FCCode, BPCode');
  expect(query).toContain('COUNT(DISTINCT BPName) = 1');
  expect(query).not.toMatch(/bp\.BPCode\s*=\s*(pa|ag)\.AGCode/);
  expect(query).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|EXEC|CREATE)\b/i);
  expect(query).not.toMatch(/SUM\((pc\.)?(Total|Balance|Downpayments)/i);
});

test('every source expression uses columns present in independently captured schema metadata', async () => {
  const evidencePath = path.resolve(__dirname, 'fixtures/assistantVerticalSources.schema.json');
  const metadata = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const tables = { ag: 'AG', pc: 'PC', pa: 'PCAG', pt: 'PT', pr: 'PR', bp: 'V_BP', conceptItem: 'V_IT' };
  for (const [object_name, column_name] of [['AG', 'AGCode'], ['PC', 'PCNum'], ['PCAG', 'PCAGNum'], ['PT', 'PTNum'], ['PR', 'PRNum']]) {
    expect(metadata.unique_keys).toContainEqual(expect.objectContaining({ object_name, column_name, key_ordinal: 1 }));
  }
  for (const id of Object.keys(catalog)) {
    await execute(id, period);
    const query = request.query.mock.calls.at(-1)[0];
    for (const [, alias, column] of query.matchAll(/\b(ag|pc|pa|pt|pr|bp|conceptItem)\.\[?(\w+)\]?/g)) {
      expect(metadata.columns.some(item => item.object_name === tables[alias] && item.column_name === column)).toBe(true);
    }
  }
});

test('financial display types follow the captured AG and PCAG schema independently', async () => {
  const metadata = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/assistantVerticalSources.schema.json'), 'utf8'));
  const tables = { ag: 'AG', pa: 'PCAG' };
  for (const id of Object.keys(catalog)) {
    await execute(id, period);
    const query = request.query.mock.calls.at(-1)[0];
    for (const [, alias, column, key] of query.matchAll(/\b(ag|pa)\.(\w+) AS \[(\w+)\]/g)) {
      const field = catalog[id].fields.find(item => item.key === key);
      const schema = metadata.columns.find(item => item.object_name === tables[alias] && item.column_name === column);
      if (['money', 'percent', 'number'].includes(field.type)) expect(schema.type_name).toMatch(/^(decimal|int)$/);
      if (id === 'assistant_commercial_agreements' && ['Deductible', 'CopayAmount', 'CopayPercentage', 'Coinsurance', 'CoinsurancePercentage'].includes(key)) {
        expect(schema.type_name).toBe('nvarchar');
        expect(field.type).toBe('string');
      }
    }
  }
});

test('concept codes retain prior label aliases and distinct descriptions and numeric defaults', () => {
  const master = catalog.assistant_commercial_agreements;
  expect(master.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'Deductible', label: 'Código de concepto de deducible del convenio', type: 'string', aliases: ['Deducible del convenio'] }),
    expect.objectContaining({ key: 'CopayAmount', label: 'Código de concepto de copago del convenio', type: 'string', aliases: ['Copago del convenio'] }),
    expect.objectContaining({ key: 'CopayPercentage', label: 'Código de concepto de copago del convenio (%)', type: 'string', unit: 'percent', aliases: ['Copago del convenio (%)'] }),
    expect.objectContaining({ key: 'CoinsurancePercentage', label: 'Código de concepto de coaseguro del convenio (%)', type: 'string', unit: 'percent', aliases: ['Coaseguro del convenio (%)'] }),
    expect.objectContaining({ key: 'Coinsurance', label: 'Código de concepto de coaseguro del convenio', type: 'string' }),
    expect.objectContaining({ key: 'DefaultDeductible', label: 'Deducible predeterminado del convenio', type: 'money' }),
    expect.objectContaining({ key: 'DefaultCopayAmount', label: 'Copago predeterminado del convenio', type: 'money' }),
    expect.objectContaining({ key: 'DefaultCopayPercentage', label: 'Copago predeterminado del convenio (%)', type: 'percent' }),
    expect.objectContaining({ key: 'DefaultCoinsurancePercentage', label: 'Coaseguro predeterminado del convenio (%)', type: 'percent' })
  ]));
  expect(master.conditionFields).toEqual(['Deductible', 'CopayAmount', 'CopayPercentage', 'Coinsurance', 'CoinsurancePercentage']);
  expect(master.relatedFields).toEqual({
    Deductible: ['DeductibleItemName', 'DefaultDeductible'],
    CopayAmount: ['CopayAmountItemName', 'DefaultCopayAmount'],
    CopayPercentage: ['CopayPercentageItemName', 'DefaultCopayPercentage'],
    Coinsurance: ['CoinsuranceItemName'],
    CoinsurancePercentage: ['CoinsurancePercentageItemName', 'DefaultCoinsurancePercentage']
  });
  expect(master.defaultFields).toEqual(expect.arrayContaining([
    'DeductibleItemName', 'CopayAmountItemName', 'CopayPercentageItemName', 'Coinsurance', 'CoinsuranceItemName', 'CoinsurancePercentageItemName',
    'DefaultDeductible', 'DefaultCopayAmount', 'DefaultCopayPercentage', 'DefaultCoinsurancePercentage'
  ]));
  expect(catalog.assistant_patient_accounts.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'Deductible', type: 'money' }),
    expect.objectContaining({ key: 'Copay', type: 'money' }),
    expect.objectContaining({ key: 'CopayPercentage', type: 'percent' }),
    expect.objectContaining({ key: 'CoinsurancePercentage', type: 'percent' })
  ]));
});

test('source execution preserves registered codes, unexpected text, zero and null without default substitutions', async () => {
  const rows = [
    { Deductible: 'SER0719', DeductibleItemName: 'DEDUCIBLE', CopayAmount: 'SER_UNKNOWN', CopayAmountItemName: null, CopayPercentage: 'SER0718',
      CopayPercentageItemName: 'COASEGURO MEDICO', Coinsurance: 'SER_COINSURANCE', CoinsuranceItemName: 'COASEGURO', CoinsurancePercentage: null,
      DefaultDeductible: 0, DefaultCopayAmount: 125, DefaultCopayPercentage: 0, DefaultCoinsurancePercentage: 20 },
    { Deductible: 'Subtotal * 0.10', DeductibleItemName: null, CopayAmount: '0', CopayAmountItemName: null, CopayPercentage: null,
      Coinsurance: null, CoinsurancePercentage: '0', CoinsurancePercentageItemName: null,
      DefaultDeductible: 100, DefaultCopayAmount: 0, DefaultCopayPercentage: 5, DefaultCoinsurancePercentage: 0 }
  ];
  request.query.mockResolvedValue({ recordset: rows });
  const result = await execute('assistant_commercial_agreements', { limit: 2 });
  expect(result.rows).toEqual(rows.map(row => expect.objectContaining(row)));
  for (const key of ['Deductible', 'CopayAmount', 'CopayPercentage', 'CoinsurancePercentage']) {
    const query = request.query.mock.calls[0][0];
    expect(query).toContain(`ag.${key} AS [${key}]`);
    expect(query).toContain(`ag.Default${key} AS [Default${key}]`);
    expect(query).not.toContain(`COALESCE(ag.${key}`);
  }
});

test('exact-code concept lookups return one description only and preserve missing or ambiguous references', async () => {
  await execute('assistant_commercial_agreements', { limit: 56 });
  const query = request.query.mock.calls[0][0];
  expect(query.match(/OUTER APPLY/g)).toHaveLength(5);
  expect(query.match(/COUNT\(DISTINCT conceptItem\.ItemName\) = 1/g)).toHaveLength(5);
  for (const key of ['Deductible', 'CopayAmount', 'CopayPercentage', 'Coinsurance', 'CoinsurancePercentage']) {
    expect(query).toContain(`FROM dbo.V_IT conceptItem WHERE conceptItem.ItemCode = ag.${key}`);
  }
  expect(query).not.toMatch(/JOIN dbo\.V_IT/);
  expect(query).not.toMatch(/(?:ItemName\s*=\s*ag\.|ag\.\w+\s*=\s*conceptItem\.ItemName)/);
  expect(query).not.toContain('COALESCE(ag.CoinsurancePercentage');

  const rows = Array.from({ length: 56 }, (_, index) => ({
    AgreementCode: `SYNTHETIC_${index + 1}`, Deductible: index === 0 ? 'MISSING_CODE' : index === 1 ? 'CONFLICTING_CODE' : index === 2 ? null : 'DUPLICATE_SAME_NAME_CODE',
    DeductibleItemName: index < 3 ? null : 'Consistent concept name', DefaultDeductible: 0
  }));
  request.query.mockResolvedValue({ recordset: rows });
  const result = await execute('assistant_commercial_agreements', { limit: 56 });
  expect(result.truncated).toBe(false);
  expect(result.rows).toHaveLength(56);
  expect(new Set(result.rows.map(row => row.AgreementCode)).size).toBe(56);
  expect(result.rows.slice(0, 3)).toEqual(rows.slice(0, 3).map(row => expect.objectContaining(row)));
  expect(result.rows[3]).toMatchObject({ Deductible: 'DUPLICATE_SAME_NAME_CODE', DeductibleItemName: 'Consistent concept name' });
});

test('inclusive dates, account status and literal search are parameters before the row cap', async () => {
  const search = "x%' OR 1=1; --_[\\";
  await execute('assistant_patient_accounts', { ...period, estatusDoc: 'CLOSED', busqueda: search });
  expect(request.input).toHaveBeenCalledWith('rowLimit', sql.Int, 3);
  expect(request.input).toHaveBeenCalledWith('fechaDesde', sql.VarChar(10), period.fechaDesde);
  expect(request.input).toHaveBeenCalledWith('fechaHasta', sql.VarChar(10), period.fechaHasta);
  expect(request.input).toHaveBeenCalledWith('estadoCuenta', sql.NVarChar(2), 'CL');
  expect(request.input).toHaveBeenCalledWith('busqueda', sql.NVarChar(1002), `%${search.replace(/[\\%_[]/g, '\\$&')}%`);
  const query = request.query.mock.calls[0][0];
  expect(query).toContain('pc.[Date] < DATEADD(day, 1, CAST(@fechaHasta AS date))');
  expect(query).toContain("CONVERT(nvarchar(4000), pc.[Date], 126) LIKE @busqueda ESCAPE '\\'");
  expect(query).not.toContain(search);
  expect(query).not.toContain(period.fechaDesde);
});

test('master agreements are bounded without requiring dates or treating state as account state', async () => {
  await execute('assistant_commercial_agreements', { limit: 3 });
  expect(request.input.mock.calls).toEqual([['rowLimit', sql.Int, 4]]);
  expect(request.query.mock.calls[0][0]).not.toContain('@fechaDesde');
  await expect(execute('assistant_commercial_agreements', { estatusDoc: 'CLOSED' })).rejects.toMatchObject({ status: 400 });
});

test('multiple agreements and missing links retain separate rows without collapsing names or null amounts', async () => {
  request.query.mockResolvedValue({ recordset: [
    { PCNum: 1, PCAGNum: 4, AgreementCode: 'CONV1', AccountTotal: 1200, BPCode: 'PAYER1', BPName: null },
    { PCNum: 1, PCAGNum: 5, AgreementCode: 'CONV2', AccountTotal: 1200, BPCode: 'PAYER2', BPName: null },
    { PCNum: 2, PCAGNum: null, AgreementCode: null, AccountTotal: null, PatientName: null }
  ] });
  const result = await execute('assistant_patient_accounts', { ...period, limit: 3 });
  expect(result.truncated).toBe(false);
  expect(result.rows).toHaveLength(3);
  expect(result.rows[0]).toMatchObject({ PCNum: 1, PCAGNum: 4, BPCode: 'PAYER1', BPName: null });
  expect(result.rows[1]).toMatchObject({ PCNum: 1, PCAGNum: 5, BPCode: 'PAYER2' });
  expect(result.rows[2]).toMatchObject({ PCNum: 2, PCAGNum: null, AgreementCode: null, AccountTotal: null });
});

test('one additional row marks truncation and civil dates preserve late hospital times', async () => {
  request.query.mockResolvedValue({ recordset: [
    { PCNum: 1, AttentionDate: new Date(2026, 8, 30, 23, 59, 12) }, { PCNum: 2 }, { PCNum: 3 }
  ] });
  const result = await execute('assistant_patient_accounts', period);
  expect(result.truncated).toBe(true);
  expect(result.rows.map(row => row.PCNum)).toEqual([1, 2]);
  expect(result.rows[0].AttentionDate).toBe('2026-09-30T23:59:12');
});

test.each([
  { fechaDesde: '2026-02-30', fechaHasta: '2026-09-30' },
  { fechaDesde: '2026-10-01', fechaHasta: '2026-09-30' },
  { fechaHasta: undefined }, { limit: 0 }, { limit: 10001 }, { limit: 1.1 },
  { busqueda: {} }, { busqueda: 'x'.repeat(501) }, { estatusDoc: 'FAKE' }
])('invalid options fail before connecting to the source (%j)', async options => {
  await expect(execute('assistant_patient_accounts', { ...period, ...options })).rejects.toMatchObject({ status: 400 });
  expect(connectRemoteDB).not.toHaveBeenCalled();
});

test('unknown source fails before a connection', async () => {
  await expect(execute('injected_table', period)).rejects.toMatchObject({ status: 400 });
  expect(connectRemoteDB).not.toHaveBeenCalled();
});
