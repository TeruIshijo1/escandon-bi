/**
 * test_quality_and_interop.js — Script de verificación automatizada para Opción 5 y Opción 10
 */
'use strict';

const { connectDB } = require('./config/db');
const dataQualityService = require('./services/dataQuality.service');
const interopService = require('./services/interoperability.service');

try {
  console.log('🧪 Iniciando prueba de backend (Calidad de Datos & Interoperabilidad)...');
  connectDB();

  // 1. Probar simulación HL7 limpia
  console.log('\n--- 1. Probando Ingesta HL7 Limpia ---');
  const resHl7Clean = interopService.simulateEvent('HL7v2', false);
  console.log('Resultado HL7 Limpio:', JSON.stringify(resHl7Clean, null, 2));

  // 2. Probar simulación FHIR con anomalía (Precio $0)
  console.log('\n--- 2. Probando Ingesta FHIR con Anomalía (Precio $0) ---');
  const resFhirAnomaly = interopService.simulateEvent('FHIR_R4', true);
  console.log('Resultado FHIR con Anomalía:', JSON.stringify(resFhirAnomaly, null, 2));

  // 3. Probar obtención de estadísticas de calidad
  console.log('\n--- 3. Probando Estadísticas de Calidad de Datos ---');
  const stats = dataQualityService.getQualityStats();
  console.log('Stats de Calidad:', stats);

  // 4. Probar obtención de lista de hallazgos
  console.log('\n--- 4. Probando Consulta de Hallazgos ---');
  const issues = dataQualityService.getQualityIssues({ limit: 10 });
  console.log(`Se encontraron ${issues.length} anomalías registradas.`);

  console.log('\n✅ ¡TODAS LAS PRUEBAS BACKEND PASARON SATISFACTORIAMENTE!');
  process.exit(0);
} catch (err) {
  console.error('\n❌ ERROR EN LA PRUEBA BACKEND:', err);
  process.exit(1);
}
