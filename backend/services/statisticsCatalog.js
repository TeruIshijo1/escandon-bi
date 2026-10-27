'use strict';

const SECTIONS = [
  ['01_VIDAS SALVADAS', 'shock', '01 Sala de choque', 'Vidas salvadas (Sala de choque)', 'atenciones'],
  ['02_NACIMIENTOS', 'births', '02 Nacimientos', 'Nacimientos con registro el mismo día', 'recién nacidos'],
  ['03_CUENTAS HOSPITALARIAS (HOSPITALIZACIÓN)', 'hospital', '03 Hospitalización', 'Egresos de hospitalización', 'cuentas'],
  ['03_CUENTAS HOSPITALARIAS DE URGENCIAS', 'emergencyAccounts', '03 Urgencias', 'Cuentas de urgencias', 'cuentas'],
  ['03_CUENTAS HOSPITALARIAS DE VA - SEGURO', 'vasSeguro', '03 VaSeguro', 'Cuentas de VaSeguro', 'cuentas'],
  ['04_ADMISIÓN CONTINUA (CONSULTAS DE URGENCIAS)', 'emergencyConsultations', '04 Consultas urgencias', 'Consultas de urgencias por servicio', 'servicios'],
  ['05_ESTANCIA', 'stay', '05 Estancia', 'Servicios de estancia sin terapia', 'servicios'],
  ['06_TERAPIA INTENSIVA (SER501, SER600, SER710, SER730)', 'intensive', '06 Terapia', 'Servicios de terapia', 'servicios'],
  ['07_PERSONAS EN QX (USOQX1HR)', 'operatingRoom', '07 Quirófano', 'Personas con uso de quirófano', 'atenciones'],
  ['08_CX ENDOSCOPIA, COLONOSCOPIA, BRONCOSCOPIA, PANENDOSCOPIA', 'ambulatory', '08 Ambulatorios', 'Procedimientos ambulatorios', 'procedimientos'],
  ['09_CONSULTAS DE ESPECIALIDAD', 'specialty', '09 Especialidad', 'Consultas de especialidad', 'consultas'],
  ['10_ESTADISTICO DE EST. IMAGEN', 'image', '10 Estudios imagen', 'Estudios de imagenología', 'estudios'],
  ['10_INGRESOS_IMAGEN', 'imageIncome', '10 Ingresos imagen', 'Ingresos de imagenología', 'MXN'],
  ['11_ESTADISTICO EST. LABORA', 'lab', '11 Estudios laboratorio', 'Estudios de laboratorio', 'estudios'],
  ['11_INGRESOS_LABORATORIO', 'labIncome', '12 Ingresos laboratorio', 'Ingresos de laboratorio', 'MXN'],
  ['13_ESTADÍSTICO DE CIRUGÍAS', 'surgeries', '13 Cirugías', 'Cirugías realizadas', 'cirugías'],
  ['14_MEDICOS_HOSPITALIZACION', 'hospitalDoctors', 'Médicos hospitalización', 'Top 10 médicos por ingreso en hospitalización', 'MXN'],
  ['15_MEDICOS_URGENCIAS', 'emergencyDoctors', 'Médicos urgencias', 'Top 10 médicos por ingreso en urgencias', 'MXN']
].map(([id, key, sheet, label, unit]) => ({ id, key, sheet, label, unit }));

const SERVICE_CODES = Object.freeze({
  emergencyConsultations: ['SER0508', 'SER0509', 'SER0510', 'SER0511', 'SER0526', 'SER0527', 'SER0528', 'SER0529', 'SER1272', 'SER1278'],
  stay: ['SER0653', 'SER0654', 'SER0657', 'SER1234', 'SER1286'],
  intensive: ['SER0658', 'SER0660', 'SER0661', 'SER0662', 'SER0663']
});

module.exports = { SECTIONS, SERVICE_CODES, BY_ID: Object.fromEntries(SECTIONS.map(s => [s.id, s])) };
