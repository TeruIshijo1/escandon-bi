const text = value => String(value ?? '').trim();
const normalized = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
const dateOnly = value => {
  const date = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};

// La configuración del catálogo permite revisar una atención. La decisión de
// aprobarla para pago sigue siendo independiente (_reviewStatus).
export function isHonorarioReviewEligible(row) {
  if (row?.FixedMonthly) {
    const fixed = row.FixedMonthlySnapshot;
    const month = text(row.FeeMonth);
    return row.ModeBI === true && row.TipoCalculo === 'BI_FIJO_MENSUAL'
      && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
      && row.SourceIdentity === `FIXED|${row.MedicoId}|${month}`
      && Number.isSafeInteger(Number(row.MedicoId)) && Number(row.MedicoId) > 0
      && text(row.Medico) !== '' && row.Cantidad === 1
      && !!fixed && Number.isSafeInteger(Number(fixed.assignmentId)) && Number(fixed.assignmentId) > 0
      && Number.isSafeInteger(Number(fixed.revision)) && Number(fixed.revision) > 0
      && String(fixed.providerId) === String(row.MedicoId)
      && fixed.providerName === row.Medico
      && fixed.month === month
      && /^\d{4}-(0[1-9]|1[0-2])$/.test(fixed.validFromMonth || '') && fixed.validFromMonth <= month
      && (!fixed.validToMonth || (/^\d{4}-(0[1-9]|1[0-2])$/.test(fixed.validToMonth) && month <= fixed.validToMonth))
      && (!fixed.deactivatedFromMonth || (/^\d{4}-(0[1-9]|1[0-2])$/.test(fixed.deactivatedFromMonth) && month < fixed.deactivatedFromMonth))
      && fixed.amountBasis === 'BASE' && fixed.monthPolicy === 'FULL_MONTH'
      && Number.isFinite(Number(fixed.amount)) && Number(fixed.amount) > 0
      && Number.isSafeInteger(Math.round(Number(fixed.amount) * 100))
      && Math.abs(Number(fixed.amount) * 100 - Math.round(Number(fixed.amount) * 100)) < 1e-6
      && Number(fixed.amount) === Number(row.BaseImporte)
      && row.ReviewEligible !== false;
  }
  const beneficiary = row?.ReviewBeneficiary;
  const providerId = beneficiary?.providerId ?? row?.MedicoId;
  const providerName = beneficiary?.providerName ?? row?.Medico;
  const role = beneficiary?.role ?? row?.RolMedico ?? row?.ProviderRole;
  if (!row || row.TipoCalculo === 'SAP_DOCUMENTO' || !row.ModeBI
    || row.ReviewEligible === false || row.CatalogApproved === false
    || row.CatalogStatus !== 'INCLUIDO' || row.ScopeExcluded
    || row.CatalogSnapshot?.active === false || row.CatalogSnapshot?.scopeExcluded
    || !text(providerId) || !text(providerName)) return false;
  const tariff = row.ReviewEligibilityTariff || row.TariffSnapshot;
  if (!tariff || tariff.active === false || !Number.isFinite(Number(tariff.amount)) || Number(tariff.amount) <= 0) return false;
  const serviceCode = text(row.CodigoServicio || row.ItemCode || row.CatalogSnapshot?.itemCode);
  if (tariff.itemCode && text(tariff.itemCode) !== serviceCode) return false;
  if (text(tariff.providerId) && text(tariff.providerId) !== text(providerId)) return false;
  if (text(tariff.role) && normalized(tariff.role) !== normalized(role)) return false;
  const serviceDate = dateOnly(row.FechaAtencion || row.ServiceDate);
  if (!serviceDate || (tariff.validFrom && (!dateOnly(tariff.validFrom) || dateOnly(tariff.validFrom) > serviceDate))
    || (tariff.validTo && (!dateOnly(tariff.validTo) || dateOnly(tariff.validTo) < serviceDate))) return false;
  // La API resuelve prioridades y rechaza tarifas ambiguas. La comprobación
  // local protege también exportaciones de datos conservados en pantalla.
  return true;
}

export function filterDoctorReviewRows(doctorData) {
  const rows = (doctorData?.filasRevision || doctorData?.filas || []).filter(isHonorarioReviewEligible);
  const displayName = text(doctorData?.medico);
  const idFromLabel = displayName.match(/\s·\s#(.+)$/)?.[1];
  const providerName = text(doctorData?.providerName || displayName.replace(/\s·\s#.+$/, ''));
  const matching = rows.filter(row => normalized(row.Medico) === normalized(providerName));
  const providerIds = new Set(matching.map(row => text(row.MedicoId)));
  const providerId = text(doctorData?.providerId ?? doctorData?.MedicoId ?? idFromLabel)
    || (providerIds.size === 1 ? [...providerIds][0] : '');
  return providerId ? matching.filter(row => text(row.MedicoId) === providerId) : [];
}
