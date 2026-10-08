'use strict';

const { fetchAllPagesStrict, normalizeProviderName, configuredWithholding, optionalSapBoolean } = require('./honorariosSapReconciliation.service');
const { fiscalProfile } = require('../utils/honorariosFiscal');
const { validatePeriod } = require('./honorariosSources.service');
const TTL = 5 * 60 * 1000;
let cached, loading;

async function readMasters(refresh = false) {
  if (loading) return loading;
  if (!refresh && cached && Date.now() - cached.loadedAt < TTL) return cached;
  loading = (async () => {
    // Solo maestros: no consulta facturas/pagos y no escribe en SAP.
    const suppliers = await fetchAllPagesStrict('/BusinessPartners?$select=CardCode,CardName,FederalTaxID,U_B1SYS_FiscRegime,SubjectToWithholdingTax,BPWithholdingTaxCollection&$filter=CardType eq \'cSupplier\'&$orderby=CardCode asc');
    const codes = await fetchAllPagesStrict('/WithholdingTaxCodes?$select=WTCode,WTName,Rate,BaseType,BaseAmount,Category,EffectiveFrom,Inactive');
    cached = { suppliers, codes, loadedAt: Date.now(), asOf: new Date().toISOString() };
    return cached;
  })();
  try { return await loading; }
  catch (error) { cached = undefined; throw error; }
  finally { loading = undefined; }
}

function buildFiscalDirectory(directory, suppliers, codes, date) {
  validatePeriod(date, date);
  const taxCodes = new Map(codes.map(code => [String(code.WTCode), code]));
  const index = new Map();
  for (const supplier of suppliers) {
    const key = normalizeProviderName(supplier.CardName);
    if (!key) continue;
    index.set(key, [...(index.get(key) || []), supplier]);
  }
  const matches = directory.map(doctor => index.get(normalizeProviderName(doctor.name)) || []);
  const owners = new Map();
  matches.forEach((rows, position) => {
    if (rows.length === 1) {
      const code = String(rows[0].CardCode);
      owners.set(code, [...(owners.get(code) || []), String(directory[position].id)]);
    }
  });
  return directory.map((doctor, position) => {
    const rows = matches[position];
    const ambiguous = rows.length > 1 || (rows.length === 1 && owners.get(String(rows[0].CardCode)).length > 1);
    const linkStatus = ambiguous ? 'ambiguo' : rows.length === 1 ? 'candidato_unico' : 'sin_coincidencia';
    const candidate = linkStatus === 'candidato_unico' ? {
      cardCode: rows[0].CardCode, cardName: rows[0].CardName,
      federalTaxId: String(rows[0].FederalTaxID || '').trim().toUpperCase(),
      fiscalRegime: String(rows[0].U_B1SYS_FiscRegime || '').trim(),
      subjectToWithholding: optionalSapBoolean(rows[0].SubjectToWithholdingTax),
      configuredWithholdings: (Array.isArray(rows[0].BPWithholdingTaxCollection) ? rows[0].BPWithholdingTaxCollection : [])
        .map(item => configuredWithholding(item, taxCodes))
    } : null;
    const sap = { linkStatus, candidates: candidate ? [candidate] : [] };
    const withoutVat = fiscalProfile(sap, date, false), withVat = fiscalProfile(sap, date, true);
    const reasons = [];
    if (ambiguous) reasons.push('Hay coincidencias entre médicos o proveedores. Completa la ficha interna del médico correcto.');
    else if (!candidate) reasons.push('No se encontró una coincidencia única en SAP. Completa su ficha interna.');
    else if (!withoutVat) reasons.push('La configuración fiscal de SAP no permite calcular las retenciones para esta fecha. Revisa y completa la ficha interna.');
    else if (!withVat) reasons.push('SAP permite servicios sin IVA. Falta confirmar la retención para servicios con IVA.');
    // Sin código de IVA no significa retención cero. No se infieren régimen,
    // IVA habitual ni vigencia del médico a partir de un código fiscal global.
    const suggestedProfile = candidate ? {
      federalTaxId: candidate.federalTaxId, fiscalRegime: /^\d{3}$/.test(candidate.fiscalRegime) ? candidate.fiscalRegime : '',
      isrRate: withoutVat?.isrRate ?? '', vatFraction: withVat?.vatFraction ?? ''
    } : {};
    return { providerId: String(doctor.id), name: doctor.name, sapReady: Boolean(withoutVat && withVat),
      canCalculateWithoutVat: Boolean(withoutVat), canCalculateWithVat: Boolean(withVat),
      sap, suggestedProfile, reasons };
  });
}

async function getFiscalDirectory(directory, { date, refresh = false }) {
  validatePeriod(date, date);
  try {
    const masters = await readMasters(refresh);
    return { doctors: buildFiscalDirectory(directory, masters.suppliers, masters.codes, date), date, asOf: masters.asOf,
      sapAvailable: true, readOnly: true, supplierCount: masters.suppliers.length };
  } catch (error) {
    // La indisponibilidad se distingue de una ficha incompleta. No se presenta
    // una copia antigua como lista ni se impide editar fichas internas.
    console.warn('[Honorarios] Directorio fiscal SAP:', error.message);
    return { doctors: directory.map(doctor => ({ providerId: String(doctor.id), name: doctor.name,
      sapReady: false, sap: { linkStatus: 'sin_consultar', candidates: [] }, suggestedProfile: {}, reasons: ['SAP no está disponible para verificar sus datos.'] })),
      date, asOf: null, sapAvailable: false, readOnly: true,
      warning: 'No se pudo consultar SAP. Puedes completar las fichas internas o pulsar Actualizar SAP para volver a intentar.' };
  }
}

module.exports = { buildFiscalDirectory, getFiscalDirectory };
