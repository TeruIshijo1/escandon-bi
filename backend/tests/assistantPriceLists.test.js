'use strict';
jest.mock('../services/sap.service', () => ({ get: jest.fn() }));
const sap = require('../services/sap.service');
const { execute } = require('../services/assistantPriceLists.service');
const id = 'assistant_public_hospital_prices';
const item = (code, prices) => ({ ItemCode: code, ItemName: `Servicio ${code}`, ItemsGroupCode: 7, ItemPrices: prices });
beforeEach(() => { jest.clearAllMocks(); sap.get.mockResolvedValueOnce({ data: { value: [{ Number: 7, GroupName: 'Servicios' }] } }); });
test('joins groups and maps only lists 1/2, preserving zero prices, currency and absent prices', async () => {
  sap.get.mockResolvedValueOnce({ data: { value: [item('A', [{ PriceList: 2, Price: 250, Currency: 'MXN' }, { PriceList: 1, Price: 0, Currency: 'MXN' }, { PriceList: 3, Price: 900 }]), item('B', [])] } });
  const result = await execute(id);
  expect(result.rows).toEqual([
    { ItemCode: 'A', ItemName: 'Servicio A', ItemGroupName: 'Servicios', PricePublic: 0, PriceHospital: 250, CurrencyPublic: 'MXN', CurrencyHospital: 'MXN' },
    { ItemCode: 'B', ItemName: 'Servicio B', ItemGroupName: 'Servicios', PricePublic: null, PriceHospital: null, CurrencyPublic: null, CurrencyHospital: null },
  ]);
  expect(sap.get.mock.calls[1][0]).toContain('ItemPrices');
});
test('searches before applying the output limit and follows pages', async () => {
  sap.get.mockResolvedValueOnce({ data: { value: [item('A', [])], 'odata.nextLink': 'Items?$skip=1' } });
  sap.get.mockResolvedValueOnce({ data: { value: [item('B', []), item('C', [])] } });
  expect((await execute(id, { limit: 1, busqueda: 'servicio b' })).rows[0].ItemCode).toBe('B');
});
test('reports truncation instead of dropping records silently', async () => {
  sap.get.mockResolvedValueOnce({ data: { value: [item('A', []), item('B', [])] } });
  expect(await execute(id, { limit: 1 })).toMatchObject({ rows: [expect.objectContaining({ ItemCode: 'A' })], truncated: true });
});
test('refuses missing collections, duplicate prices and a continuation outside Items', async () => {
  sap.get.mockResolvedValueOnce({ data: { value: [item('A', [{ PriceList: 1, Price: 1 }, { PriceList: 1, Price: 2 }])] } });
  await expect(execute(id)).rejects.toThrow(/duplicados/);
  sap.get.mockResolvedValueOnce({ data: { value: [] } }).mockResolvedValueOnce({ data: { value: [], 'odata.nextLink': 'Invoices?$skip=1' } });
  await expect(execute(id)).rejects.toThrow(/página no válida/);
  sap.get.mockResolvedValueOnce({ data: { value: [] } }).mockResolvedValueOnce({ data: {} });
  await expect(execute(id)).rejects.toThrow(/No se pudo consultar/);
});
test('orders the displayed price list by group name and item code, as in the supplied query', async () => {
  sap.get.mockReset();
  sap.get.mockResolvedValueOnce({data:{value:[{Number:7,GroupName:'Servicios'},{Number:8,GroupName:'Anestesia'}]}});
  sap.get.mockResolvedValueOnce({data:{value:[item('A',[]),{...item('B',[]),ItemsGroupCode:8},item('C',[])]}});
  expect((await execute(id)).rows.map(row=>row.ItemCode)).toEqual(['B','A','C']);
});
