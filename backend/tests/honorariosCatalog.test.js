'use strict';

jest.mock('../config/db', () => ({ getDb: jest.fn() }));
const catalog = require('../services/honorariosCatalog.service');
const { classifyProfessionalCandidate } = require('../utils/honorariosScope');

const tariff = (overrides = {}) => ({ id: 1, itemCode: 'SER1471', providerId: null, role: null, amount: 250,
  validFrom: '2026-01-01', validTo: null, active: true, revision: 1, ...overrides });
const config = (overrides = {}) => ({ itemCode: 'SER1471', name: 'Cuota de recuperación Afirma Psicología',
  groupName: 'CONSULTA EXTERNA', active: true, status: 'INCLUIDO', modality: 'contact_center', paymentUnit: 'sesion',
  scopeExcluded: false, revision: 2, referencePrices: [{ amount: 1 }], ...overrides });
const candidate = (overrides = {}) => ({ CodigoServicio: 'SER1471', MedicoId: 77, Medico: 'Médico de la sesión',
  RolMedico: 'TRATANTE', FechaAtencion: '2026-04-15', Cantidad: 1, BaseImporte: 999,
  MedicoConfirmado: true, CantidadConfirmada: true, EjecucionConfirmada: true, ...overrides });

test('rejects impossible dates and amounts without silently normalizing them', () => {
  expect(catalog.dateOnly('2026-02-30')).toBeNull();
  expect(catalog.dateOnly('2024-02-29')).toBe('2024-02-29');
  const valid = { itemCode: 'SER1471', amount: 250, validFrom: '2026-01-01', expectedRevision: 0, reason: 'Convenio vigente' };
  expect(catalog.validateTariff(valid)).toMatchObject({ amount: 250, validTo: null, providerId: null, role: null });
  for (const change of [{ validFrom: '2026-02-30' }, { validTo: '2025-12-31' }, { amount: 0 }, { amount: 1.001 },
    { amount: '250' }, { expectedRevision: -1 }, { reason: {} }, { providerId: {} }]) {
    expect(() => catalog.validateTariff({ ...valid, ...change })).toThrow();
  }
});

test('simplified forms accept omitted reasons and payment unit without losing legacy values', () => {
  const input = { itemCode: 'SER1471', expectedRevision: 0, status: 'INCLUIDO', modality: 'presencial' };
  expect(catalog.validateConfig(input)).toMatchObject({ paymentUnit: null, reason: '' });
  expect(catalog.validateConfig({ ...input, paymentUnit: 'sesión', reason: 'Acuerdo' }))
    .toMatchObject({ paymentUnit: 'sesión', reason: 'Acuerdo' });
  expect(catalog.validateTariff({ itemCode: 'SER1471', expectedRevision: 0, amount: 250, validFrom: '2026-10-06' }))
    .toMatchObject({ validTo: null, role: null, reason: '' });
  for (const change of [{ paymentUnit: '' }, { paymentUnit: {} }, { reason: {} }]) {
    expect(() => catalog.validateConfig({ ...input, ...change })).toThrow();
  }
});

test('doctor functions with accents and the former example resolve to the clinical role codes', () => {
  const input = { itemCode: 'SER1471', expectedRevision: 0, amount: 250, validFrom: '2026-10-06', validTo: '2026-10-31' };
  for (const [role, expected] of [['AN (anestesiólogo)', 'AN'], ['Anestesiólogo', 'AN'], ['Cirujano', 'SURGEON'],
    ['Ayudante', 'AY'], ['Médico tratante', 'TRATANTE'], ['Tratante / consulta', 'TRATANTE']]) {
    const validated = catalog.validateTariff({ ...input, role });
    expect(validated).toMatchObject({ role: expected, validTo: '2026-10-31' });
    const rate = tariff({ ...validated, id: 5 });
    expect(catalog.resolveTariff({ itemCode: 'SER1471', role: expected, serviceDate: input.validTo }, [rate]).tariff.id).toBe(5);
    expect(catalog.resolveTariff({ itemCode: 'SER1471', role: expected, serviceDate: '2026-11-01' }, [rate]).status)
      .toBe('PENDIENTE_PRECIO');
  }
  expect(catalog.tariffOverlaps(tariff({ role: 'AN (anestesiólogo)' }), tariff({ role: 'AN' }))).toBe(true);
});

test('invalid end dates give a precise message and same-day validity is accepted', () => {
  const input = { itemCode: 'SER1471', expectedRevision: 0, amount: 250, validFrom: '2026-10-06' };
  expect(catalog.validateTariff({ ...input, validTo: '2026-10-06' }).validTo).toBe('2026-10-06');
  expect(() => catalog.validateTariff({ ...input, validTo: '2026-10-05' })).toThrow(/igual o posterior/);
  expect(() => catalog.validateTariff({ ...input, validTo: '2026-02-30' })).toThrow(/Se aplica hasta/);
});

test('tariffs honor inclusive vigency and prioritize physician plus role over other exceptions', () => {
  const tariffs = [tariff(), tariff({ id: 2, providerId: '77', amount: 300 }),
    tariff({ id: 3, role: 'TRATANTE', amount: 280 }),
    tariff({ id: 4, providerId: '77', role: 'TRATANTE', amount: 350, validFrom: '2026-04-01', validTo: '2026-04-30' })];
  expect(catalog.resolveTariff({ itemCode: 'SER1471', providerId: 77, role: 'TRATANTE', serviceDate: '2026-04-30' }, tariffs).tariff.id).toBe(4);
  expect(catalog.resolveTariff({ itemCode: 'SER1471', providerId: 77, role: 'TRATANTE', serviceDate: '2026-05-01' }, tariffs).tariff.id).toBe(2);
  expect(catalog.resolveTariff({ itemCode: 'SER1471', providerId: 99, role: 'TRATANTE', serviceDate: '2026-05-01' }, tariffs).tariff.id).toBe(3);
  expect(catalog.resolveTariff({ itemCode: 'SER1471', providerId: 99, role: 'AN', serviceDate: '2026-05-01' }, tariffs).tariff.id).toBe(1);
  expect(catalog.resolveTariff({ itemCode: 'SER1471', providerId: 99, serviceDate: '2025-12-31' }, tariffs).status).toBe('PENDIENTE_PRECIO');
});

test('ambiguous authorized rates block calculation instead of picking a fee', () => {
  const result = catalog.resolveTariff({ itemCode: 'SER1471', serviceDate: '2026-04-15' }, [tariff(), tariff({ id: 2, amount: 300 })]);
  expect(result).toMatchObject({ status: 'TARIFA_AMBIGUA', tariff: null });
});

test('overlap allows adjacent periods and distinct physician or role exceptions', () => {
  expect(catalog.tariffOverlaps(tariff({ validTo: '2026-04-30' }), tariff({ validFrom: '2026-04-30' }))).toBe(true);
  expect(catalog.tariffOverlaps(tariff({ validTo: '2026-04-30' }), tariff({ validFrom: '2026-05-01' }))).toBe(false);
  expect(catalog.tariffOverlaps(tariff(), tariff({ providerId: '77' }))).toBe(false);
  expect(catalog.tariffOverlaps(tariff(), tariff({ role: 'AN' }))).toBe(false);
  expect(catalog.tariffOverlaps(tariff(), tariff({ active: false }))).toBe(false);
});

test('new catalog entries and conflicting reference fees remain pending; Contact Center defaults its modality', () => {
  const [entry] = catalog.normalizeSource([{ ItemCode: 'SER1471', ItemName: 'Afirma Psicología', ItemType: 'S', Enabled: true }],
    [{ ITEMCODE: 'SER1471', Id_UT: 1, IMPORTE: 1 }, { ITEMCODE: 'SER1471', Id_UT: 2, IMPORTE: 250, NOTAS: 'Según médico' }]);
  expect(entry).toMatchObject({ modality: 'contact_center', scopeExcluded: false });
  expect(entry.referencePrices).toHaveLength(2);
  expect(entry.referenceWarnings.join(' ')).toMatch(/más de un precio.*\$1 o menos.*notas/);
  const row = catalog.enrichCandidate(candidate(), undefined, []);
  expect(row).toMatchObject({ ModeBI: true, CatalogStatus: 'PENDIENTE', CatalogApproved: false,
    ReviewEligible: false, BaseImporte: null, ElegiblePago: 0, SinTabulador: 1 });
  expect(row.BIStatusReasons).toContain('Servicio nuevo, pendiente de configurar');
});

test('excludes requested groups and imaging concepts even when classified as consultation', () => {
  expect(catalog.isExcludedHonorariosService('SER0647', 'CONSULTA EXTERNA', 'Control de crecimiento')).toBe(true);
  expect(catalog.isExcludedHonorariosService('OTHER', 'CONSULTA EXTERNA', 'Ultrasonido obstétrico')).toBe(true);
  for (const groupName of [' farmacia ', 'Laboratorio', ' Estudios de Laboratorio ', 'IMAGENOLOGÍA', ' Almacén   General ']) {
    expect(catalog.isExcludedHonorariosService('OTHER', groupName, 'Servicio')).toBe(true);
    const row = catalog.enrichCandidate(candidate({ GrupoServicio: groupName }), config({ groupName }), [tariff()]);
    expect(row).toMatchObject({ ScopeExcluded: true, CatalogStatus: 'EXCLUIDO', ElegiblePago: 0 });
  }
  expect(catalog.isExcludedHonorariosService('SER1471', 'CONSULTA EXTERNA', 'Consulta Afirma Psicología')).toBe(false);
});

test('confirmed online session uses the BI fee and does not require physical arrival or automatically approve', () => {
  const row = catalog.enrichCandidate(candidate({ PCAP_ST: 'RS' }), config(), [tariff()]);
  expect(row).toMatchObject({ ModalidadServicio: 'contact_center', BaseImporteVertical: 999, BaseImporte: 250,
    PrecioUnitarioBI: 250, TariffId: 1, TariffRevision: 1, CatalogRevision: 2, ElegiblePago: 0,
    CatalogApproved: true, ReviewEligible: true, RealizacionConfirmada: true });
  expect(row.BIStatusReasons).toEqual([]);
  expect(row.TariffSnapshot.amount).toBe(250);
  expect(row.CatalogSnapshot.status).toBe('INCLUIDO');
  expect(catalog.enrichCandidate(candidate({ EjecucionConfirmada: false }), config(), [tariff()]).BIStatusReasons).toContain('Falta confirmar que el servicio se realizó');
});

test('hospital items and complete packages never become fees, even with a stale included configuration and reference rate', () => {
  for (const [itemCode, groupName, name] of [
    ['A-CEYE', 'ALIAS', 'ARTICULO CEYE'], ['A-FAR', '', 'ARTICULO FARMACIA'],
    ['A-ITEM', 'ALIAS', 'ARTICULOS GENERAL'], ['A-QUI', 'ALIAS', 'ARTICULO QUIROFANO'],
    ['PQX0002', '', 'FISTULECTOMIA PAQUETE QX'], ['SER1234', 'CIRUGIA QUIROFANO', 'ESTANCIA AMBULATORIA'],
    ['SER1236', 'CIRUGIA QUIROFANO', 'RENTA DE EQUIPO PARA CIRUGIA'],
    ['SER0628', 'CONSULTA EXTERNA', 'CONSULTA EXTERNA MATERIAL DE CURACION'],
    ['SER0633', 'CONSULTA EXTERNA', 'CONSULTA EXTERNA MEDICAMENTOS'],
    ['SER0713', 'ANALISIS DE CUENTAS', 'SERVICIOS ADMINISTRATIVOS'],
    ['SER0718', 'ANALISIS DE CUENTAS', 'COASEGURO MEDICO']
  ]) {
    const entry = config({ itemCode, groupName, name, scopeExcluded: false });
    expect(catalog.isExcludedHonorariosService(entry)).toBe(true);
    expect(classifyProfessionalCandidate(entry).professionalCandidate).toBe(false);
    const row = catalog.enrichCandidate(candidate({ CodigoServicio: itemCode, GrupoServicio: groupName, Servicio: name }), entry, [tariff({ itemCode })]);
    expect(row).toMatchObject({ ScopeExcluded: true, CatalogStatus: 'EXCLUIDO', BaseImporte: null, TariffSnapshot: null });
  }
});

test('medical services remain discoverable without UT fees while unclear concepts require classification', () => {
  for (const [itemCode, groupName, name] of [
    ['SER0715', 'ANALISIS DE CUENTAS', 'JORNADA VIGILANCIA ESPECIALIDAD MEDICA PROYECTO HSBC'],
    ['SER0680', 'AMBULANCIAS', 'RESPONSIVA MEDICA FUNDACION'],
    ['SER2354', 'TERAPIA NEONATAL', 'INTERCONSULTA DE ESPECIALIDAD TERAPIA NEONATAL'],
    ['SER1537', 'PRIVADOS PB y PA', 'HM RETIRO DE PUNTOS'],
    ['SER2361', 'TERAPIA INTENSIVA E INTERMEDIA', 'VISITA MEDICA PSICOLOGIA'],
    ['SER0665', 'TERAPIA INTENSIVA E INTERMEDIA', 'VISITA POR MEDICO ESPECIALISTA'],
    ['SER0666', 'TERAPIA INTENSIVA E INTERMEDIA', 'ATENCION MEDICA TERAPIA'],
    ['SER2383', 'URGENCIAS 2', 'VALORACION PREOPERATORIA'],
    ['SER1259', 'CIRUGIA QUIROFANO', 'SERVICIO DE ANESTESIOLOGIA GENERAL DE PACIENTES'],
    ['SER1471', 'CONSULTA EXTERNA', 'CUOTA DE RECUPERACION AFIRMA PSICOLOGIA']
  ]) {
    const entry = { itemCode, groupName, name, referencePrices: [] };
    expect(catalog.isExcludedHonorariosService(entry)).toBe(false);
    expect(classifyProfessionalCandidate(entry).professionalCandidate).toBe(true);
  }
  const unclear = { itemCode: 'SER_NUEVO', groupName: '', name: 'CONCEPTO NUEVO', referencePrices: [] };
  expect(catalog.isExcludedHonorariosService(unclear)).toBe(false);
  expect(classifyProfessionalCandidate(unclear).professionalCandidate).toBe(false);
});

test('missing physician, uncertain allocation and cancellation remain pending with visible explanations', () => {
  const row = catalog.enrichCandidate(candidate({ MedicoId: null, Medico: 'Solicitante', CantidadConfirmada: false,
    AllocationShared: true, Cancelado: true }), config(), [tariff()]);
  expect(row.Medico).toBe('');
  expect(row.ReviewEligible).toBe(false);
  expect(row.BIStatusReasons).toEqual(expect.arrayContaining(['Pendiente de médico', 'Falta confirmar cuántos servicios se pagarán',
    'Hay una cancelación o devolución. Revisa si corresponde pagar este servicio.', 'Posible duplicado o cantidad compartida; requiere revisión']));
});

test('review requires an approved catalog entry and an applicable positive tariff for the physician, role and date', () => {
  for (const entry of [undefined, config({ status: 'PENDIENTE' }), config({ status: 'EXCLUIDO' }), config({ active: false })]) {
    expect(catalog.enrichCandidate(candidate(), entry, [tariff()])).toMatchObject({ CatalogApproved: false, ReviewEligible: false });
  }
  for (const rate of [tariff({ active: false }), tariff({ amount: 0 }), tariff({ amount: -1 }), tariff({ amount: Infinity })]) {
    expect(catalog.enrichCandidate(candidate(), config(), [rate])).toMatchObject({ CatalogApproved: false, ReviewEligible: false, TariffSnapshot: null });
  }
  for (const rate of [tariff({ providerId: '88' }), tariff({ role: 'AN' }),
    tariff({ validFrom: '2026-05-01' }), tariff({ validTo: '2026-04-14' })]) {
    expect(catalog.enrichCandidate(candidate(), config(), [rate])).toMatchObject({ CatalogApproved: true, ReviewEligible: false, TariffSnapshot: null });
  }
  expect(catalog.enrichCandidate(candidate(), config(), [tariff(), tariff({ id: 2 })]))
    .toMatchObject({ CatalogApproved: true, ReviewEligible: false, TariffSnapshot: null });
});

test('requester and performance confirmations remain human decisions after catalog approval', () => {
  const row = catalog.enrichCandidate(candidate({ MedicoConfirmado: false, EjecucionConfirmada: false,
    Cantidad: null, CantidadConfirmada: false }), config(), [tariff()]);
  expect(row).toMatchObject({ CatalogApproved: true, ReviewEligible: true, ElegiblePago: 0,
    RequiereRevision: true, RealizacionConfirmada: false, BaseImporte: null });
  expect(row.BIStatusReasons).toEqual(expect.arrayContaining(['Pendiente de médico', 'Falta confirmar que el servicio se realizó']));
});

test('fractional quantities preserve decimal half cents in the preview calculation', () => {
  for (const [unit, quantity, expected] of [[33.5, 0.03, 1.01], [2.3, 0.95, 2.19], [2.5, 0.87, 2.18], [2.65, 0.9, 2.39]]) {
    const row = catalog.enrichCandidate(candidate({ Cantidad: quantity }), config(), [tariff({ amount: unit })]);
    expect(row.BaseImporte).toBe(expected);
  }
});

test('catalog exposes derived approval independently of dates and supports the approved list filter', async () => {
  const { getDb } = require('../config/db');
  const entries = [
    { item_code: 'SER1471', name: 'Consulta', status: 'INCLUIDO', source_active: true, tariff_count: '2', approved_tariff_count: '2' },
    { item_code: 'SER1472', name: 'Consulta', status: 'INCLUIDO', source_active: true, tariff_count: '0', approved_tariff_count: '0' },
    { item_code: 'SER1473', name: 'Consulta', status: 'PENDIENTE', source_active: true, tariff_count: '1', approved_tariff_count: '1' },
    { item_code: 'SER1474', name: 'Consulta', status: 'EXCLUIDO', source_active: true, tariff_count: '1', approved_tariff_count: '1' },
    { item_code: 'SER1475', name: 'Consulta', status: 'INCLUIDO', source_active: false, tariff_count: '1', approved_tariff_count: '1' }
  ];
  getDb.mockReturnValue({ pool: { query: jest.fn(async sql => ({ rows: /FROM bi_honorarios_catalog c/.test(sql) ? entries : [] })) } });
  const result = await catalog.listCatalog({ autoSync: false });
  expect(result.items.map(item => item.approvalStatus)).toEqual(['APROBADO', 'PENDIENTE', 'PENDIENTE', 'EXCLUIDO', 'PENDIENTE']);
  expect(result.items[0]).toMatchObject({ status: 'INCLUIDO', approvedTariffCount: 2 });
  const approved = await catalog.listCatalog({ autoSync: false, approvalStatus: 'APROBADO' });
  expect(approved.items.map(item => item.itemCode)).toEqual(['SER1471']);
});

test('a saved catalog is immediately available without another Vertical connection or sync', async () => {
  const { getDb } = require('../config/db');
  const query = jest.fn(async () => ({ rows: [{ last_success: new Date(), source_count: 3000 }] }));
  getDb.mockReturnValue({ pool: { query } });
  const remote = { request: jest.fn(() => { throw new Error('Vertical slow or unavailable'); }) };
  const state = await catalog.ensureCatalogReady(remote);
  expect(state.sourceCount).toBe(3000);
  expect(remote.request).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledTimes(1);
});
