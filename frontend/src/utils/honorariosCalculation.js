// Una sola fuente para pantalla, ficha, PDF y Excel. Los importes de facturas
// SAP nunca entran en este cálculo de servicios ni se recalculan.
export const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const numberOrNull = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export const doctorKey = row => String(row.Medico || 'Médico No Asignado').trim();

const GENERIC_CONCEPT_WORDS = new Set(['CUOTA', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'RECUPERACION',
  'CONSULTA', 'CONSULTAS', 'EXTERNA', 'SERVICIO', 'SERVICIOS', 'HONORARIO', 'HONORARIOS', 'MEDICO', 'MEDICOS']);
const normalizedConcept = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/)
  .filter(token => token && !GENERIC_CONCEPT_WORDS.has(token)).sort().join(' ');
const normalizedDoctor = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

// Comparación orientativa por concepto. No vincula facturas con atenciones ni
// modifica importes o estados; la decisión permanece en manos del revisor.
export function classifySapConcept(description, verticalRows = []) {
  const signature = normalizedConcept(description);
  if (!signature) return 'SIN_CONCEPTO';
  return verticalRows.some(row => row.TipoCalculo !== 'SAP_DOCUMENTO'
    && normalizedConcept(row.Servicio || row.ItemDescription) === signature)
    ? 'POSIBLE_COINCIDENCIA' : 'NO_LOCALIZADO';
}

const coverageText = status => ({
  POSIBLE_COINCIDENCIA: 'Puede ser una atención ya registrada',
  NO_LOCALIZADO: 'No aparece entre las atenciones',
  SIN_CONCEPTO: 'No hay información para comparar'
})[status] || 'No hay información para comparar';

export function annotateSapInvoiceCoverage(invoice, doctor, verticalRows = []) {
  const doctorRows = verticalRows.filter(row => normalizedDoctor(row.Medico) === normalizedDoctor(doctor)
    && row.TipoCalculo !== 'SAP_DOCUMENTO');
  return {
    ...invoice,
    verticalLineCoverage: (invoice.lines || []).map((line, index) => {
      const status = classifySapConcept(line.description, doctorRows);
      return { lineNumber: line.lineNumber ?? index, status, label: coverageText(status) };
    })
  };
}
export function honorarioRowId(row, index = 0) {
  if (row.TipoCalculo === 'SAP_DOCUMENTO') return `SAP_FACTURA|${row.SapDocumento?.docEntry}`;
  return row.UDRKey
    ? [row.UDRKey, row.RenglonAuditoria, row.FolioAtencion, row.CodigoServicio, row.OrigenRenglon, row.Medico].map(v => String(v ?? '').trim()).join('|')
    : `${row.FolioAtencion || '0'}_${row.CodigoServicio || '0'}_${row.FechaAtencion || '0'}_${index}`;
}

// La decisión pierde vigencia si cambian los datos que se revisaron.
export function reviewFingerprint(row) {
  return JSON.stringify([row.UDRKey, row.RenglonAuditoria, row.Medico, row.FechaAtencion,
    row.Paciente, row.Cliente, row.FolioOrdenVenta, row.MedicoId, row.Servicio,
    row.CodigoServicio, row.Cantidad, row.BaseImporte, row.BasePropuesta, row.IvaLinea,
    row.TasaISR, row.ElegiblePago, row.EstadoVertical, row.FuenteHonorario, row.OrigenRenglon,
    row.MensajeAuditoria, row.MotivoExclusionOriginal, row.SapDocumento?.documentTotal,
    row.SapDocumento?.currency, row.SapDocumento?.cancelled, row.SapDocumento?.cfdiUuid,
    row.SapDocumento?.retentions, row.SapDocumento?.lines]);
}

function sourceReviewStatus(row) {
  if (row.TipoCalculo === 'SAP_DOCUMENTO' || row.FuenteHonorario !== 'Liquidación clínica'
    || row.OrigenRenglon === 'CITA_REALIZADA_SIN_ORDEN') return 'PENDIENTE';
  const status = String(row.EstadoVertical || '').toUpperCase();
  return status === 'APROBADO' || status === 'RECHAZADO' ? status : 'PENDIENTE';
}

export function sapDocumentsToRows(reconciliation, verticalRows = []) {
  const rows = new Map();
  const verticalRowsByDoctor = new Map();
  for (const row of verticalRows) {
    const key = normalizedDoctor(row.Medico);
    if (!verticalRowsByDoctor.has(key)) verticalRowsByDoctor.set(key, []);
    verticalRowsByDoctor.get(key).push(row);
  }
  const sources = [...Object.entries(reconciliation?.providers || {}).map(([medico, provider]) => ({ ...provider, medico })),
    ...(reconciliation?.additionalProviders || [])];
  for (const provider of sources) for (const invoice of provider.invoices || []) {
    const key = String(invoice.docEntry);
    if (rows.has(key)) continue;
    const invoiceWithCoverage = annotateSapInvoiceCoverage(invoice, provider.medico,
      verticalRowsByDoctor.get(normalizedDoctor(provider.medico)) || []);
    rows.set(key, {
      UDRKey: `SAP-${key}`, RenglonAuditoria: 1, TipoCalculo: 'SAP_DOCUMENTO', SapDocumento: invoiceWithCoverage,
      FuenteHonorario: 'Factura SAP', OrigenRenglon: 'SAP_DOCUMENTO', Medico: provider.medico,
      FolioAtencion: invoice.docNum, FechaAtencion: String(invoice.postingDate || '').slice(0, 10),
      GrupoServicio: 'Documentos SAP', Especialidad: 'Honorarios por revisar',
      Servicio: `Factura ${invoice.docNum}: ${(invoice.lines || []).map(line => line.description).filter(Boolean).join(' / ') || invoice.comments || 'Honorarios por revisar'}`,
      Paciente: 'Factura sin paciente asignado', Cliente: invoice.cardName,
      Cantidad: 1, BaseImporte: null, IvaLinea: null, TasaISR: null, ElegiblePago: 0,
      MensajeAuditoria: `${provider.discoveryBasis || 'Proveedor candidato por nombre'}. ${invoice.cancelled ? 'Documento cancelado. ' : ''}${invoice.locatedByPayment ? 'Factura fuera del periodo contable, localizada por un pago aplicado en el rango. ' : ''}Revisar periodo de servicios y duplicidad con atenciones. Total y retenciones conservados de SAP; no se recalculan.`,
      ObservacionCobertura: invoice.comments || '', PrecioCobradoPaciente: null
    });
  }
  return [...rows.values()];
}

function fiscalProfile(provider, date, hasVat) {
  const pending = note => ({ isrRate: null, vatFraction: null, note, ready: false });
  if (provider?.linkStatus !== 'candidato_unico' || provider.candidates?.length !== 1) {
    return pending('Cálculo pendiente: no se pudo identificar al médico en SAP o falta revisar sus retenciones.');
  }
  const candidate = provider.candidates[0];
  const taxes = candidate.configuredWithholdings || [];
  if (candidate.subjectToWithholding === null || candidate.subjectToWithholding === undefined
    || taxes.some(t => t.inactive === null || t.inactive === undefined)) {
    return pending('Cálculo pendiente: SAP no indica si al médico se le aplican retenciones.');
  }
  const active = taxes.filter(t => t.inactive === false);
  if (candidate.subjectToWithholding === false) {
    return active.length ? pending('Cálculo pendiente: SAP indica que no se aplican retenciones, pero también muestra retenciones activas. Requiere revisión.')
      : { isrRate: 0, vatFraction: 0, ready: true, note: 'Estimación con los datos actuales de SAP: no aparecen retenciones para el médico. Confirma que sus datos estén actualizados.' };
  }
  // El RFC sólo permite verificar la forma de persona física del candidato;
  // no confirma por sí solo identidad, régimen ni vigencia histórica.
  if (!/^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/.test(String(candidate.federalTaxId || '').trim().toUpperCase())) {
    return pending('Cálculo pendiente: falta confirmar en SAP el RFC del médico.');
  }
  if (active.some(t => !t.estimateRule || !['factura', 'pago'].includes(t.appliesAt)
    || !t.codeEffectiveFrom || !date || String(t.codeEffectiveFrom).slice(0, 10) > date)) {
    return pending('Cálculo pendiente: la información de retenciones en SAP necesita revisión para la fecha del servicio.');
  }
  const isr = active.filter(t => t.estimateRule === 'isr_on_fee');
  const vat = active.filter(t => t.estimateRule === 'vat_two_thirds');
  if (isr.length !== 1 || ![10, 1.25].includes(isr[0].rate) || vat.length > 1) {
    return pending('Cálculo pendiente: falta confirmar cuánto ISR se debe retener al médico.');
  }
  const isrRate = isr[0].rate / 100;
  if (hasVat && vat.length !== 1) {
    return { ...pending('Cálculo pendiente: hay IVA registrado, pero falta confirmar en SAP cuánto se retiene.'), isrRate };
  }
  return {
    isrRate, vatFraction: vat.length ? 2 / 3 : 0, ready: true,
    note: `Estimación con los datos actuales de SAP: ISR (impuesto sobre la renta) de ${isr[0].rate}% sobre el honorario, sin IVA.${hasVat ? ' La retención de IVA se calcula con el IVA registrado y la regla fiscal vigente.' : ''} Confirma que los datos del médico y la factura sean correctos. Se conservan los importes que aparecen en la factura.`
  };
}

// Redondear el impuesto del conjunto una sola vez y distribuir sus centavos
// evita que 23 renglones, filtros o exportaciones produzcan totales distintos.
function allocateTax(rows, field, unroundedCents) {
  const parts = rows.map(row => ({ row, raw: unroundedCents(row) }));
  const total = Math.round(parts.reduce((sum, p) => sum + p.raw, 0) + 1e-8);
  let remainder = total - parts.reduce((sum, p) => sum + Math.floor(p.raw + 1e-8), 0);
  parts.sort((a, b) => (b.raw - Math.floor(b.raw + 1e-8)) - (a.raw - Math.floor(a.raw + 1e-8)) || a.row._rowId.localeCompare(b.row._rowId));
  parts.forEach(p => {
    const cents = Math.floor(p.raw + 1e-8) + (remainder-- > 0 ? 1 : 0);
    p.row[field] = cents / 100;
  });
}

export function calculateHonorarios(data = [], overrides = {}, providers = {}, periodStart = '') {
  const legacyCounts = new Map();
  data.forEach(r => { if (r.UDRKey) legacyCounts.set(String(r.UDRKey), (legacyCounts.get(String(r.UDRKey)) || 0) + 1); });
  const rows = data.map((row, index) => {
    const id = honorarioRowId(row, index);
    const legacy = legacyCounts.get(String(row.UDRKey)) === 1 ? overrides[String(row.UDRKey)] : null;
    const saved = overrides[id] || legacy;
    const stale = !!saved && saved.fingerprint !== reviewFingerprint(row);
    const override = stale ? null : saved;
    const verticalStatus = sourceReviewStatus(row);
    const reviewStatus = stale ? 'PENDIENTE'
      : override?.action === 'APROBAR' ? 'APROBADO'
        : override?.action === 'EXCLUIR' ? 'RECHAZADO'
          : override?.action === 'PENDIENTE' ? 'PENDIENTE' : verticalStatus;
    const eligible = reviewStatus === 'APROBADO';
    const reviewSource = stale ? 'PENDIENTE' : override ? 'BI' : verticalStatus !== 'PENDIENTE' ? 'VERTICAL' : 'PENDIENTE';
    const reviewMeta = { _reviewStatus: reviewStatus, _reviewSource: reviewSource, _reviewStale: stale, _reviewer: saved?.reviewer,
      _revision: saved?.revision || 0, _separateServicesConfirmed: override?.separateServicesConfirmed === true };
    if (row.TipoCalculo === 'SAP_DOCUMENTO') {
      const invoice = row.SapDocumento;
      const ready = !invoice.cancelled && invoice.currency === 'MXN' && numberOrNull(invoice.documentTotal) !== null;
      const recordedTax = kind => {
        const taxes = (invoice.retentions || []).filter(item => new RegExp(`\\b${kind}\\b`, 'i').test(item.description || ''));
        return !taxes.length || taxes.some(item => numberOrNull(item.amount) === null) ? null
          : taxes.reduce((sum,item) => sum + Math.round(item.amount * 100),0) / 100;
      };
      const isrTax = (invoice.retentions || []).filter(item => /\bISR\b/i.test(item.description || ''));
      const recordedIsrRate = isrTax.length === 1 && numberOrNull(isrTax[0].rate) !== null ? Number(isrTax[0].rate) / 100 : null;
      return { ...row, ...reviewMeta, _rowId: id, _isOverridden: !!override,
        _overrideAction: override?.action, _overrideMotivo: override?.motivo, _overrideTimestamp: override?.timestamp,
        _effectiveMotivo: override?.motivo || row.MensajeAuditoria,
        _effectiveElegible: eligible, _effectiveBase: eligible ? null : 0, _effectiveIVA: eligible ? numberOrNull(invoice.vatRecorded) : 0,
        _effectiveISRRate: recordedIsrRate, _effectiveISR: eligible ? recordedTax('ISR') : 0, _effectiveRetIVA: eligible ? recordedTax('IVA') : 0,
        _effectiveNeto: eligible ? ready ? roundMoney(invoice.documentTotal) : null : 0,
        _fiscalReady: !eligible || ready,
        _fiscalNote: !eligible ? 'Factura pendiente o rechazada: no se incluye en el total.' : !ready
          ? 'La factura está cancelada o tiene datos incompletos; requiere revisión y no se suma al total en pesos mexicanos.'
          : 'Se usa el total neto que aparece en SAP, sin volver a calcular impuestos. Incluye pagos ya realizados, por lo que no indica cuánto falta por pagar.' };
    }
    const originalBase = numberOrNull(row.BaseImporte);
    const originalVat = numberOrNull(row.IvaLinea);
    const custom = numberOrNull(override?.customAmount);
    const base = eligible ? (custom ?? originalBase) : 0;
    const explicitVat = numberOrNull(override?.vatRate);
    const rawIva = !eligible ? 0 : explicitVat !== null && [0,0.08,0.16].includes(explicitVat) && base !== null ? roundMoney(base * explicitVat)
      : base === originalBase ? originalVat
      : originalBase > 0 && originalVat !== null ? roundMoney(base * originalVat / originalBase) : null;
    const iva = rawIva === null ? null : roundMoney(rawIva);
    const profile = fiscalProfile(providers[doctorKey(row)], String(row.FechaAtencion || periodStart).slice(0, 10), iva !== 0);
    const isrRate = profile.isrRate ?? numberOrNull(row.TasaISR);
    const validAmounts = base !== null && base > 0 && iva !== null && iva >= 0 && !!String(row.Medico || '').trim();
    const ready = !eligible || (validAmounts && profile.ready);
    return {
      ...row, ...reviewMeta, _rowId: id, _isOverridden: !!override,
      _overrideAction: override?.action || null, _overrideMotivo: override?.motivo || null,
      _overrideTimestamp: override?.timestamp || null,
      _effectiveMotivo: override?.motivo || row.MensajeAuditoria || row.MotivoExclusionOriginal || '',
      _effectiveElegible: eligible, _effectiveBase: base === null ? null : roundMoney(base), _effectiveIVA: iva,
      _effectiveISRRate: isrRate, _effectiveISR: eligible ? null : 0,
      _effectiveRetIVA: !eligible || iva === 0 ? 0 : null,
      _effectiveNeto: eligible ? null : 0, _fiscalReady: ready,
      _fiscalNote: !eligible ? 'No se incluye en el total.' : !validAmounts ? 'Cálculo pendiente: falta el importe del honorario o el IVA para calcular el total.' : profile.note,
      _vatFraction: profile.vatFraction
    };
  });
  const isrGroups = new Map();
  const vatGroups = new Map();
  for (const row of rows.filter(r => r._effectiveElegible && r.TipoCalculo !== 'SAP_DOCUMENTO')) {
    if (row._effectiveBase !== null && row._effectiveISRRate !== null && row._effectiveISRRate >= 0 && row._effectiveISRRate <= 1) {
      const key = `${doctorKey(row)}|${row._effectiveISRRate}`;
      if (!isrGroups.has(key)) isrGroups.set(key, []);
      isrGroups.get(key).push(row);
    }
    if (row._fiscalReady && row._effectiveIVA !== null) {
      const key = `${doctorKey(row)}|${row._vatFraction}`;
      if (!vatGroups.has(key)) vatGroups.set(key, []);
      vatGroups.get(key).push(row);
    }
  }
  for (const group of isrGroups.values()) allocateTax(group, '_effectiveISR', r => Math.round(r._effectiveBase * 100) * r._effectiveISRRate);
  for (const group of vatGroups.values()) allocateTax(group, '_effectiveRetIVA', r => Math.round(r._effectiveIVA * 100) * r._vatFraction);
  for (const row of rows) {
    if (row.TipoCalculo !== 'SAP_DOCUMENTO' && row._effectiveElegible && row._fiscalReady && row._effectiveISR !== null && row._effectiveRetIVA !== null) {
      row._effectiveNeto = roundMoney(row._effectiveBase + row._effectiveIVA - row._effectiveISR - row._effectiveRetIVA);
    }
  }
  const duplicateKey = row => String(row.SapDocumento?.cardCode ||
    (providers[doctorKey(row)]?.candidates?.length === 1 ? providers[doctorKey(row)].candidates[0].cardCode : '') || doctorKey(row));
  const clinicalDoctors = new Set(rows.filter(row => row._effectiveElegible && row.TipoCalculo !== 'SAP_DOCUMENTO').map(duplicateKey));
  for (const row of rows) {
    if (row._effectiveElegible && row.TipoCalculo === 'SAP_DOCUMENTO' && clinicalDoctors.has(duplicateKey(row)) && !row._separateServicesConfirmed) {
      row._effectiveNeto = null;
      row._fiscalReady = false;
      row._fiscalNote = 'Puede ser el mismo servicio registrado como atención y como factura. Confirma que sean servicios distintos o rechaza uno para evitar contar el servicio dos veces.';
    }
  }
  return rows;
}

export function summarizeHonorarios(rows = []) {
  const included = rows.filter(r => r._effectiveElegible);
  const clinical = included.filter(row => row.TipoCalculo !== 'SAP_DOCUMENTO');
  const documents = included.filter(row => row.TipoCalculo === 'SAP_DOCUMENTO');
  const sum = (field, list = clinical) => list.some(r => numberOrNull(r[field]) === null) ? null
    : list.reduce((total, row) => total + Math.round(row[field] * 100), 0) / 100;
  return {
    totalBase: sum('_effectiveBase'), totalIVA: sum('_effectiveIVA'),
    totalISR: sum('_effectiveISR'), totalRetIVA: sum('_effectiveRetIVA'), totalNeto: sum('_effectiveNeto', included),
    clinicalNet: sum('_effectiveNeto'), sapDocumentNet: sum('_effectiveNeto', documents), approvedDocuments: documents.length,
    pendingCount: included.filter(r => r._effectiveNeto === null).length,
    fiscalNotes: [...new Set(included.map(r => r._fiscalNote).filter(Boolean))]
  };
}
