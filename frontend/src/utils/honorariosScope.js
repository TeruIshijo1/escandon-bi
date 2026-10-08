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

function isExcludedHonorariosService(itemCode, groupName, description) {
  const { code, group, name } = fields(itemCode, groupName, description);
  return isExcludedHonorariosGroup(group) || /^(A-|PQX\d)/.test(normalize(code))
    || ['SER0647', 'SER0649'].includes(normalize(code)) || imaging.test(normalize(name)) || hospitalCharge.test(normalize(name));
}

function classifyProfessionalCandidate(row) {
  if (isExcludedHonorariosService(row)) return { professionalCandidate: false, scopeReason: 'Cargo de hospital, artículo, paquete o área excluida; no es un honorario profesional.' };
  const { code, group, name } = fields(row);
  const known = ['SER1467', 'SER1470', 'SER1471', 'SER1259', 'SER1260', 'SER1261', 'SER1262'].includes(normalize(code))
    || professionalAct.test(normalize(name)) || clinicalGroups.has(normalize(group)) || row.referencePrices?.length > 0;
  return { professionalCandidate: Boolean(known), scopeReason: known
    ? 'Antes de preparar el pago, incluye este servicio y registra su tarifa autorizada.'
    : 'Confirmar si este concepto corresponde a un servicio profesional antes de incluirlo para pago.' };
}

export { isExcludedHonorariosGroup, isExcludedHonorariosService, classifyProfessionalCandidate };
