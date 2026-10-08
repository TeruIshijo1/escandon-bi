'use strict';

const cents = value => Math.round(Number(value) * 100);
function fiscalProfile(provider, date, hasVat) {
  if (provider?.linkStatus !== 'candidato_unico' || provider.candidates?.length !== 1) return null;
  const candidate = provider.candidates[0];
  if (candidate.source === 'BI_INTERNO') {
    if (!candidate.enabled || candidate.confirmed !== true || !/^\d+$/.test(String(candidate.providerId || ''))
      || !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(candidate.federalTaxId || ''))
      || !/^\d{3}$/.test(String(candidate.fiscalRegime || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.validFrom || '')
      || !date || candidate.validFrom > date || ![0, 0.0125, 0.1].includes(candidate.isrRate)
      || ![0, 2 / 3].includes(candidate.vatFraction) || !Number.isSafeInteger(candidate.revision) || candidate.revision <= 0) return null;
    return { isrRate: candidate.isrRate, vatFraction: candidate.vatFraction };
  }

  const taxes = candidate.configuredWithholdings || [];
  if (candidate.subjectToWithholding === null || candidate.subjectToWithholding === undefined
    || taxes.some(tax => tax.inactive === null || tax.inactive === undefined)) return null;
  const active = taxes.filter(tax => tax.inactive === false);
  if (candidate.subjectToWithholding === false) return active.length ? null : { isrRate: 0, vatFraction: 0 };
  if (!/^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/.test(String(candidate.federalTaxId || '').trim().toUpperCase())) return null;
  if (active.some(tax => !tax.estimateRule || !['factura', 'pago'].includes(tax.appliesAt)
    || !tax.codeEffectiveFrom || String(tax.codeEffectiveFrom).slice(0, 10) > date)) return null;
  const isr = active.filter(tax => tax.estimateRule === 'isr_on_fee');
  const vat = active.filter(tax => tax.estimateRule === 'vat_two_thirds');
  if (isr.length !== 1 || ![10, 1.25].includes(isr[0].rate) || vat.length > 1 || (hasVat && vat.length !== 1)) return null;
  return { isrRate: isr[0].rate / 100, vatFraction: vat.length ? 2 / 3 : 0 };
}

function allocate(lines, key, rawValue) {
  const parts = lines.map(line => ({ line, raw: rawValue(line) }));
  let remainder = Math.round(parts.reduce((sum, part) => sum + part.raw, 0) + 1e-8)
    - parts.reduce((sum, part) => sum + Math.floor(part.raw + 1e-8), 0);
  parts.sort((a, b) => (b.raw - Math.floor(b.raw + 1e-8)) - (a.raw - Math.floor(a.raw + 1e-8))
    || a.line.rowId.localeCompare(b.line.rowId));
  parts.forEach(part => { part.line[key] = (Math.floor(part.raw + 1e-8) + (remainder-- > 0 ? 1 : 0)) / 100; });
}

function priceApprovedSnapshots(reviews, providers, internalProfiles = {}) {
  const lines = reviews.map(review => {
    const snapshot = review.snapshot;
    const rate = review.vatRate;
    if (!snapshot || ![0, 0.08, 0.16].includes(rate)) throw Object.assign(new Error('Confirma el IVA de todos los servicios antes de cerrar.'), { status: 400 });
    const base = snapshot.baseAmount;
    const vat = cents(base * rate) / 100;
    const internal = internalProfiles[snapshot.providerId];
    if (internal?.enabled && String(internal.providerId) !== String(snapshot.providerId)) throw Object.assign(new Error('La ficha fiscal corresponde a otro médico.'), { status: 400 });
    const provider = internal?.enabled ? { linkStatus: 'candidato_unico', candidates: [internal] } : providers[snapshot.providerName];
    const profile = fiscalProfile(provider, snapshot.serviceDate, vat !== 0);
    if (!profile) throw Object.assign(new Error(`Completa los datos fiscales de ${snapshot.providerName} para preparar su pago.`), { status: 400 });
    return { ...snapshot, reviewRevision: review.revision, reviewer: review.reviewer,
      reviewFingerprint: review.fingerprint, reason: review.motivo, vatRate: rate, vat,
      isrRate: profile.isrRate, vatFraction: profile.vatFraction,
      fiscalSource: provider.candidates[0].source === 'BI_INTERNO' ? 'Ficha fiscal interna confirmada al preparar el pago' : 'Estimación con configuración vigente de SAP al cierre',
      fiscalSnapshot: provider.candidates[0] };
  });
  const groups = new Map();
  for (const line of lines) {
    const key = `${line.providerId}|${line.isrRate}|${line.vatFraction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  for (const group of groups.values()) {
    allocate(group, 'isr', line => cents(line.baseAmount) * line.isrRate);
    allocate(group, 'vatWithholding', line => cents(line.vat) * line.vatFraction);
  }
  return lines.map(line => ({ ...line, netAmount: (cents(line.baseAmount) + cents(line.vat) - cents(line.isr) - cents(line.vatWithholding)) / 100 }));
}

module.exports = { fiscalProfile, priceApprovedSnapshots };
