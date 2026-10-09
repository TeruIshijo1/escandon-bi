'use strict';
const { selectResources } = require('../services/assistantResourceSelection.service');
const manual = { id: 'inventory', fields: [] };
const resource = (id, title, labels) => ({ id, title, assistantOnly: true, resourceMetadata: true, fields: labels.map(label => ({ label })) });

test('financial wording retrieves internal resources and keeps existing reports and safe followup context', () => {
  const catalog = [manual, resource('price', 'PriceLists', ['Nombre de lista', 'Precio']),
    resource('partners', 'BusinessPartners', ['Socio de negocios']), resource('discount', 'DiscountGroups', ['Descuento']),
    ...Array.from({ length: 25 }, (_, i) => resource(`other${i}`, 'Clínico', ['Fecha']))];
  const selected = selectResources(catalog, 'Necesito socios de negocios con descuentos y listas de precios para contadores', { entity: 'other24' });
  expect(selected.map(entity => entity.id)).toEqual(expect.arrayContaining(['inventory', 'price', 'partners', 'discount', 'other24']));
  expect(selected.length).toBeLessThanOrEqual(17);
});

test('retrieval uses only the passed authorized registry and keeps pending questions without records', () => {
  const selected = selectResources([manual, resource('convenios', 'Acuerdos', ['Convenio'])], 'este mes', null, { request: 'Necesito acuerdos comerciales', answers: [] });
  expect(selected.map(entity => entity.id)).toContain('convenios');
  expect(JSON.stringify(selected)).not.toContain('rows');
  expect(selectResources([], 'socios')).toEqual([]);
});
