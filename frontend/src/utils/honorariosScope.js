const excludedGroups = new Set(['ALMACEN GENERAL', 'FARMACIA', 'LABORATORIO', 'ESTUDIOS DE LABORATORIO', 'IMAGENOLOGIA',
  'ALIAS', 'PAQUETE DE CIRUGIA', 'ARRENDAMIENTO', 'DONATIVOS', 'ESCUELA DE ENFERMERIA',
  'INGRESOS ADMINISTRATIVOS', 'INSUMOS CONSULTA EXTERNA', 'SERVICIOS DE CEYE']);
const clinicalGroups = new Set(['CONSULTA EXTERNA', 'DENTAL', 'CLINICA DE LA MUJER', 'ESTUDIO EN CLINICA DE LA MUJER',
  'GABINETE DE CARDIOLOGIA', 'GASTROFISIOLOGIA', 'NEUROFISIOLOGIA']);
const imaging = /\b(ULTRASONIDO|ULTRASONOGRAFIA|ECOGRAFIA|RADIOGRAFIA|TOMOGRAFIA|MAMOGRAFIA)\b|RESONANCIA MAGNETICA/;
const hospitalCharge = /\b(ARTICULOS?|INSUMOS?|MEDICAMENTOS?|MATERIAL(?:ES)?|CONSUMIBLES?|INSTRUMENTAL|DESCORCHE|ESTANCIA|ALIMENTOS?|DIETAS?|COASEGURO|DEDUCIBLE|COPAGO|DONATIVOS?|RENTAS?|ARRENDAMIENTO)\b|\bSERVICIOS? (ADMINISTRATIVOS?|HOSPITALARIOS?|DE ENFERMERIA)\b|^USO\b|^OXIGENO\b|^ENDOBAG\b|^CIRCUITO\b|^ESTERILIZACION\b|\bDISPARO DE ENGRAPADORA\b|\bTOMA DE GLUCOSA\b|\bTRASLADO.*AMBULANCIA|\bAMBULANCIA.*TRASLADO|\bKILOMETRO.*AMBULANCIA|^COSTO POR.*(ESPERA|HORA)|^UNIDAD DE (CONCENTRADO|CRIOPRECIPITADO|PLASMA)|^POOL DE PLAQUETAS|^COOMBS\b|^BUSQUEDA DE ANTICUERPOS|^PRUEBA CRUZADA\b/;
const professionalAct = /\b(HONORARIOS?|HM|INTERCONSULTAS?|CONSULTAS?|PRECONSULTA|ANESTESIOLOGIA|ANESTESIOLOGO|ANESTESIA)\b|\bJORNADAS?\b.*\b(MEDICAS?|ESPECIALIDAD)\b|\b(VALORACION|RESPONSIVA|CERTIFICADO|RESUMEN)\b.*\b(MEDIC[AO]|PREQUIRURGICA|PRE ?OPERATORIA)\b|\bVISITA (MEDICA|POR MEDICO)\b|\bATENCION MEDICA\b/;

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function isExcludedHonorariosGroup(group) {
  return excludedGroups.has(normalize(group));
}

function fields(itemCode, groupName, description) {
  if (itemCode && typeof itemCode === 'object') {
    const row = itemCode;
    return { code: row.itemCode || row.CodigoServicio || row.ItemCode || row.item_code,
      group: row.groupName || row.GrupoServicio || row.ItemGroupName || row.group_name,
      name: row.name || row.Servicio || row.ItemDescription || row.ItemName || row.Description || row.description };
  }
  return { code: itemCode, group: groupName, name: description };
}

function hasHonorariosReference(row) {
  if (!row || typeof row !== 'object') return false;
  const references = row.referencePrices || row.reference_prices || row.PrecioReferenciaVertical;
  return (Array.isArray(references) && references.length > 0)
    || [row.SourceHonorariosReference, row.PasaCatalogoHonorarios, row.Pasa_UT_Honorarios].some(value => value === true || value === 1)
    || Number(row.TariffCount) > 0;
}

function isImagingConcept(row, groupName, description) {
  const { code, group, name } = fields(row, groupName, description);
  return normalize(group) === 'IMAGENOLOGIA' || ['SER0647', 'SER0649'].includes(normalize(code))
    || imaging.test(normalize(name));
}

function isExcludedHonorariosService(itemCode, groupName, description) {
  const { code, group, name } = fields(itemCode, groupName, description);
  const groupExcluded = isExcludedHonorariosGroup(group) && normalize(group) !== 'IMAGENOLOGIA';
  const isPackage = itemCode && typeof itemCode === 'object'
    && [itemCode.IsAssembly, itemCode.EsPaquete].some(value => value === true || value === 1);
  const isArticle = itemCode && typeof itemCode === 'object'
    && [itemCode.ItemType, itemCode.itemType, itemCode.sourceMetadata?.itemType, itemCode.source_metadata?.itemType]
      .some(value => normalize(value) === 'I');
  return groupExcluded || /^(A-|PQX\d)/.test(normalize(code)) || hospitalCharge.test(normalize(name)) || Boolean(isPackage || isArticle)
    || (isImagingConcept(itemCode, groupName, description) && !hasHonorariosReference(itemCode));
}

function isHonorariosScopeExcluded(row) {
  const storedExcluded = row?.scopeExcluded || row?.scope_excluded || row?.ScopeExcluded;

  return isExcludedHonorariosService(row)
    || Boolean(storedExcluded && !(isImagingConcept(row) && hasHonorariosReference(row)));
}

function classifyProfessionalCandidate(row) {
  if (isExcludedHonorariosService(row)) return { professionalCandidate: false, scopeReason: 'Cargo de hospital, artículo, paquete o área excluida; no es un honorario profesional.' };
  const { code, group, name } = fields(row);
  const known = /^CXQ/.test(normalize(code)) || ['SER1467', 'SER1470', 'SER1471', 'SER1259', 'SER1260', 'SER1261', 'SER1262'].includes(normalize(code))
    || professionalAct.test(normalize(name)) || clinicalGroups.has(normalize(group)) || hasHonorariosReference(row);
  return { professionalCandidate: Boolean(known), scopeReason: known
    ? "Antes de preparar el pago, incluye este servicio y registra su tarifa autorizada."
    : 'Confirmar si este concepto corresponde a un servicio profesional antes de incluirlo para pago.' };
}

export { isExcludedHonorariosGroup, isExcludedHonorariosService, isHonorariosScopeExcluded,
  hasHonorariosReference, classifyProfessionalCandidate };
