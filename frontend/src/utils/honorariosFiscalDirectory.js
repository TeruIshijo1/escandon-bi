export const fiscalCategories = [
  { key: 'pending', label: 'Por completar' },
  { key: 'sap', label: 'Listos con SAP' },
  { key: 'internal', label: 'Configurados internamente' },
];
export function fiscalCategory(doctor, profile, date) {
  if (profile?.enabled) {
    const ready = profile.source === 'BI_INTERNO' && profile.confirmed === true
      && String(profile.providerId) === String(doctor.providerId)
      && Number.isSafeInteger(profile.revision) && profile.revision > 0
      && /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(profile.federalTaxId || '')
      && /^\d{3}$/.test(profile.fiscalRegime || '')
      && /^\d{4}-\d{2}-\d{2}$/.test(profile.validFrom || '') && profile.validFrom <= date
      && [0, .0125, .1].includes(profile.isrRate) && [0, 2 / 3].includes(profile.vatFraction)
      && [0, .08, .16].includes(profile.defaultVatRate);
    return ready ? { key: 'internal', detail: 'Ficha interna lista para esta fecha.' }
      : { key: 'pending', detail: profile.validFrom > date ? `La ficha interna aplica desde ${profile.validFrom}. Revisa la vigencia para este periodo.` : 'Revisa y completa la ficha interna.' };
  }
  if (doctor.sapReady) return { key: 'sap', detail: 'SAP permite calcular servicios con y sin IVA para esta fecha.' };
  return { key: 'pending', detail: doctor.reasons?.join(' ') || 'Consultando datos de SAP…' };
}
