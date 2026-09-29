const percent = value => typeof value === 'number' && Number.isFinite(value)
  ? `${new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value)}%`
  : 'porcentaje no informado';

export const formatHonorariosRate = rate => rate === null || rate === undefined || !Number.isFinite(Number(rate))
  ? 'Pendiente' : `${(Number(rate) * 100).toFixed(2)}%`;

export const formatHonorariosRates = group => group.tasaISR !== null && group.tasaISR !== undefined
  ? formatHonorariosRate(group.tasaISR)
  : group.tasasISR?.length ? group.tasasISR.map(formatHonorariosRate).join(' / ') : 'Pendiente';

// Presenta la configuración actual, sin convertirla en una regla fiscal validada
// ni recalcular los importes que ya están contabilizados en las facturas.
export function formatConfiguredWithholdings(candidate) {
  if (!candidate) return 'No se encontró la información de retenciones en SAP.';
  const subject = candidate.subjectToWithholding === true ? 'sí'
    : candidate.subjectToWithholding === false ? 'no' : 'sin información';
  const rows = candidate.configuredWithholdings || [];
  const detail = rows.length ? rows.map(item => {
    const status = item.inactive === true ? ' (no está activa)' : item.inactive === null || item.inactive === undefined ? ' (no se sabe si está activa)' : '';
    const portion = item.basePercentage !== null && item.basePercentage !== undefined && item.basePercentage !== 100
      ? `; ${percent(item.basePercentage)} del importe considerado` : '';
    const base = ({
      'base neta definida en SAP': 'importe neto registrado en SAP',
      'IVA definido en SAP': 'IVA registrado en SAP',
      'importe bruto definido en SAP': 'importe bruto de la factura',
      'base no informada': 'importe no informado'
    })[item.calculationBase] || item.calculationBase || 'importe no informado';
    const appliesAt = item.appliesAt === 'factura' ? 'al registrar la factura'
      : item.appliesAt === 'pago' ? 'al realizar el pago' : 'en un momento no informado';
    return `${item.description || 'Impuesto sin nombre'}: ${percent(item.rate)} del ${base}${portion}; se descuenta ${appliesAt}${status}`;
  }).join(' / ') : 'SAP no muestra retenciones registradas';
  return `SAP indica que se aplican retenciones: ${subject}. Retenciones registradas: ${detail}.`;
}
