import { classifyProfessionalCandidate, isExcludedHonorariosService } from './honorariosScope';

export const CATALOG_STATUS_LABELS = { PENDIENTE: 'Por configurar', INCLUIDO: 'Incluido para pago', EXCLUIDO: 'Excluido' };
export const CATALOG_ROLE_LABELS = { TRATANTE: 'Tratante / consulta', AN: 'Anestesiólogo', SURGEON: 'Cirujano', AY: 'Ayudante' };
export const isCatalogApproved = item => item?.approvalStatus === 'APROBADO' || (!item?.approvalStatus
  && item?.status === 'INCLUIDO' && item.active !== false && !item.scopeExcluded
  && Number(item.approvedTariffCount ?? item.tariffCount) > 0);
export const catalogStateLabel = item => isCatalogApproved(item) ? 'Configurados' : item.status === 'EXCLUIDO'
  ? 'Excluido' : item.active === false ? 'Inactivo' : item.status === 'INCLUIDO' ? 'Falta tarifa' : 'Por configurar';
export const withCatalogScope = item => {
  const scope = classifyProfessionalCandidate(item);
  return { ...scope, ...item, professionalCandidate: item.professionalCandidate ?? scope.professionalCandidate };
};
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function catalogItemsForView(items, { view = 'TODOS', reviewOtherConcepts = false } = {}) {
  const working = items.filter(item => !item.scopeExcluded && !isExcludedHonorariosService(item)
    && (reviewOtherConcepts || item.professionalCandidate !== false || item.status === 'INCLUIDO'));
  if (view === 'APROBADOS') return working.filter(isCatalogApproved);
  if (view === 'RECOMENDADOS') return working.filter(item => !isCatalogApproved(item) && item.status !== 'EXCLUIDO'
    && Array.isArray(item.referencePrices) && item.referencePrices.length > 0);
  return working;
}

export function filterCatalogItems(items, { search = '', status = 'TODOS' } = {}) {
  const term = normalize(search);
  return items.filter(item => (status === 'TODOS' || item.status === status)
    && (!term || normalize(`${item.itemCode} ${item.name || ''} ${item.description || ''} ${item.groupName || ''}`).includes(term)));
}

const amount = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const money = value => amount(value) === null ? 'Sin importe' : amount(value).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const date = value => value ? String(value).slice(0, 10) : '';
const STATUS_STYLES = {
  Configurados: { background: 'FFD1FAE5', color: 'FF065F46' },
  'Por configurar': { background: 'FFFEF3C7', color: 'FF92400E' },
  'Falta tarifa': { background: 'FFFEF3C7', color: 'FF92400E' },
  Excluido: { background: 'FFF1F5F9', color: 'FF475569' },
  Inactivo: { background: 'FFF1F5F9', color: 'FF475569' }
};
const priceFormat = '"$"#,##0.00;[Red]("$"#,##0.00);"$"0.00';
const stateColumn = { header: 'Estado', key: 'estadoCatalogo', width: 20, statusStyles: STATUS_STYLES };
const priceColumn = { header: 'Importe ($)', key: 'amount', width: 18, type: 'currency', numFmt: priceFormat };
const serviceColumns = [{ header: 'Código', key: 'itemCode', width: 18 }, { header: 'Servicio', key: 'service', width: 48 }, stateColumn];

export function createCatalogExportSheets(items, filters = {}, providerNames = new Map(), snapshotAt) {
  const selected = filterCatalogItems(catalogItemsForView(items.map(withCatalogScope), filters), filters);
  const viewLabel = { TODOS: 'Todos los servicios', APROBADOS: 'Aprobados', RECOMENDADOS: 'Recomendados' }[filters.view] || 'Todos los servicios';
  const filterLabel = `${viewLabel} · Estado: ${CATALOG_STATUS_LABELS[filters.status] || 'Todos'}${filters.search ? ` · Búsqueda: ${filters.search}` : ''} · Otros conceptos: ${filters.reviewOtherConcepts ? 'Sí' : 'No'}`;
  const snapshotLabel = snapshotAt ? new Date(snapshotAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : '';
  const base = item => ({ itemCode: item.itemCode, service: item.description || item.name || item.itemCode, estadoCatalogo: catalogStateLabel(item) });
  const catalogRows = selected.map(item => ({ ...base(item), group: item.groupName || '',
    referencePrices: (item.referencePrices || []).map(reference => money(reference.amount)).join(' / '),
    tariffPrices: (item.tariffs || []).map(tariff => `${money(tariff.amount)}${tariff.active === false ? ' (inactiva)' : ''}`).join(' / '),
    referenceCount: item.referencePrices?.length || 0, activeTariffCount: (item.tariffs || []).filter(tariff => tariff.active !== false).length,
    active: item.active === false ? 'No' : 'Sí', modality: item.modality === 'contact_center' ? 'Contact Center' : 'Presencial',
    referenceChange: item.referenceChanged ? 'Cambió el precio de referencia en Vertical' : '' }));
  const referenceRows = selected.flatMap(item => (item.referencePrices || []).map(reference => ({ ...base(item),
    id: reference.id, amount: amount(reference.amount), description: reference.description || '', notes: reference.notes || '',
    changedBy: reference.changeAudit?.available && reference.changeAudit.source === 'Vertical' ? reference.changeAudit.changedBy || '' : '',
    changedAt: reference.changeAudit?.available && reference.changeAudit.source === 'Vertical' && reference.changeAudit.changedBy ? reference.changeAudit.changedAt || '' : '' })));
  const tariffRows = selected.flatMap(item => (item.tariffs || []).map(tariff => ({ ...base(item), id: tariff.id,
    amount: amount(tariff.amount), providerId: tariff.providerId || '', doctor: tariff.providerId ? providerNames.get(String(tariff.providerId)) || `Médico #${tariff.providerId}` : 'Tarifa general',
    role: CATALOG_ROLE_LABELS[tariff.role] || tariff.role || 'Todas las funciones', validFrom: date(tariff.validFrom), validTo: date(tariff.validTo),
    active: tariff.active === false ? 'No' : 'Sí', updatedBy: tariff.updatedBy || '' })));
  const common = { titulo: 'HOSPITAL ESCANDÓN · CATÁLOGO DE HONORARIOS', freezeHeaders: true,
    resumen: { Servicios: selected.length, Referencias: referenceRows.length, Tarifas: tariffRows.length, Filtros: filterLabel,
      ...(snapshotLabel ? { 'Datos consultados': snapshotLabel } : {}) } };
  return { servicesCount: selected.length, sheets: [
    { ...common, name: 'Catálogo', subtitulo: 'Lista de precios y estados. Los precios de Vertical son referencias; las tarifas autorizadas conservan su médico, función y vigencia en la hoja de detalle.',
      columnas: [serviceColumns[0], serviceColumns[1], { header: 'Grupo', key: 'group', width: 30 }, stateColumn,
        { header: 'Precios de referencia ($)', key: 'referencePrices', width: 30 }, { header: 'Tarifas registradas ($)', key: 'tariffPrices', width: 34 },
        { header: 'Referencias', key: 'referenceCount', width: 14, type: 'number' }, { header: 'Tarifas activas', key: 'activeTariffCount', width: 16, type: 'number' },
        { header: 'Servicio activo', key: 'active', width: 16 }, { header: 'Tipo de atención', key: 'modality', width: 22 }, { header: 'Cambio desde Vertical', key: 'referenceChange', width: 42 }], filas: catalogRows },
    { ...common, name: 'Referencias Vertical', subtitulo: 'Precios de referencia consultados desde Vertical. No autorizan por sí solos el pago al médico.',
      columnas: [...serviceColumns, { header: 'Referencia', key: 'id', width: 16 }, priceColumn,
        { header: 'Descripción de referencia', key: 'description', width: 48 }, { header: 'Notas', key: 'notes', width: 54 },
        ...(referenceRows.some(row => row.changedBy) ? [{ header: 'Responsable en Vertical', key: 'changedBy', width: 32 },
          { header: 'Modificación en Vertical', key: 'changedAt', width: 28 }] : [])], filas: referenceRows },
    { ...common, name: 'Tarifas autorizadas', subtitulo: 'Tarifas registradas por servicio, médico, función y vigencia. Las tarifas inactivas se identifican en su propia columna.',
      columnas: [...serviceColumns, { header: 'Tarifa', key: 'id', width: 14 }, priceColumn,
        { header: 'Código de médico', key: 'providerId', width: 18 }, { header: 'Médico', key: 'doctor', width: 34 },
        { header: 'Función', key: 'role', width: 26 }, { header: 'Se aplica desde', key: 'validFrom', width: 18 }, { header: 'Se aplica hasta', key: 'validTo', width: 18 },
        { header: 'Tarifa activa', key: 'active', width: 16 }, { header: 'Responsable de tarifa', key: 'updatedBy', width: 32 }], filas: tariffRows }
  ] };
}
