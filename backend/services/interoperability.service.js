/**
 * interoperability.service.js — Servicio de Interoperabilidad HL7 / FHIR (Opción 5)
 * Hospital Escandón BI Platform
 */
'use strict';

const { getDb } = require('../config/db');
const { inspectRecord } = require('./dataQuality.service');

/**
 * Parsea un mensaje básico HL7 v2 (DFT^P03)
 */
function parseHL7Message(rawHL7) {
  const lines = rawHL7.trim().split(/\r?\n/);
  let patientId = 'EXP-99999';
  let itemCode = 'INS-000';
  let description = 'Insumo Médico HL7';
  let price = 150.0;
  let quantity = 1;
  let date = new Date().toISOString();

  for (const line of lines) {
    const fields = line.split('|');
    const segment = fields[0];

    if (segment === 'PID') {
      patientId = fields[3] || fields[2] || patientId;
    } else if (segment === 'FT1') {
      itemCode = fields[6] || fields[7] || itemCode;
      description = fields[8] || fields[7] || description;
      quantity = parseFloat(fields[10] || 1);
      price = parseFloat(fields[11] || 150.0);
      if (fields[4]) {
        date = fields[4];
      }
    }
  }

  return {
    patient_id: patientId,
    item_code: itemCode,
    description: description,
    price: price,
    quantity: quantity,
    date: date,
  };
}

/**
 * Parsea un recurso FHIR R4 (ChargeItem)
 */
function parseFHIRResource(fhirJson) {
  const payload = typeof fhirJson === 'string' ? JSON.parse(fhirJson) : fhirJson;

  const patientRef = payload.subject?.reference || payload.subject?.display || 'EXP-88888';
  const patientId = patientRef.replace(/^Patient\//, '');
  
  const coding = payload.code?.coding?.[0] || {};
  const itemCode = coding.code || 'FHIR-ITEM';
  const description = coding.display || payload.code?.text || 'Insumo FHIR';

  const quantity = payload.quantity?.value ?? payload.quantity ?? 1;
  const priceRaw = payload.priceOverride?.value ?? payload.priceOverride;
  const price = typeof priceRaw === 'number' ? priceRaw : parseFloat(priceRaw || 200.0);
  const date = payload.occurrenceDateTimeField || payload.enteredDate || new Date().toISOString();

  return {
    patient_id: patientId,
    item_code: itemCode,
    description: description,
    price: price,
    quantity: quantity,
    date: date,
  };
}

/**
 * Procesa e ingesta un evento HL7 o FHIR en tiempo real
 */
function ingestEvent(protocol, eventType, rawPayload) {
  const db = getDb();
  let parsedRecord = null;

  try {
    if (protocol === 'HL7v2') {
      parsedRecord = parseHL7Message(rawPayload);
    } else if (protocol === 'FHIR_R4') {
      parsedRecord = parseFHIRResource(rawPayload);
    } else {
      throw new Error(`Protocolo no soportado: ${protocol}`);
    }

    // 1. Correr por el Motor de Calidad de Datos (Opción 10)
    const qualityIssues = inspectRecord(parsedRecord, `${protocol}_INGESTION`);
    const hasQualityIssues = qualityIssues.length > 0;
    const eventStatus = hasQualityIssues ? 'ALERTA_CALIDAD' : 'PROCESADO';

    // 2. Registrar en la bitácora de interoperabilidad
    db.prepare(`
      INSERT INTO interop_event_logs (event_type, protocol, patient_id, raw_payload, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      eventType,
      protocol,
      parsedRecord.patient_id,
      typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload),
      eventStatus
    );

    // 3. Registrar consumo de enfermería en BD relacional si es válido
    try {
      db.prepare(`
        INSERT INTO ConsumosEnfermeria (NoExpediente, CodigoInsumo, Cantidad, FechaConsumo)
        VALUES (?, ?, ?, ?)
      `).run(
        parsedRecord.patient_id,
        parsedRecord.item_code,
        parsedRecord.quantity,
        parsedRecord.date
      );
    } catch (dbErr) {
      console.warn('ℹ️ Aviso al insertar en ConsumosEnfermeria:', dbErr.message);
    }

    return {
      success: true,
      protocol,
      eventType,
      status: eventStatus,
      parsedRecord,
      qualityIssues,
    };
  } catch (err) {
    db.prepare(`
      INSERT INTO interop_event_logs (event_type, protocol, patient_id, raw_payload, status)
      VALUES (?, ?, ?, ?, 'ERROR')
    `).run(eventType, protocol, 'UNKNOWN', String(rawPayload), 'ERROR');

    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Obtener bitácora de eventos de interoperabilidad
 */
function getInteropLogs(limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM interop_event_logs ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

/**
 * Simular evento HL7 / FHIR para pruebas en vivo
 */
function simulateEvent(protocol = 'HL7v2', withAnomaly = false) {
  const randomId = Math.floor(1000 + Math.random() * 9000);
  const patientId = `EXP-${randomId}`;

  if (protocol === 'HL7v2') {
    const price = withAnomaly ? 0.0 : 450.0;
    const qty = withAnomaly ? 100 : 2;
    const rawHL7 = `MSH|^~\\&|HIS_ESCANDON|FARMACIA|BI_PLATFORM|AUDITORIA|20260722110000||DFT^P03|MSG${randomId}|P|2.5\r\n` +
      `PID|1||${patientId}^^^HOSPITAL||GONZALEZ^MARIA||19850512|F\r\n` +
      `FT1|1|||20260722110000||MED-${randomId}|Paracetamol 500mg Inyectable|||${qty}|${price}||FARMACIA`;

    return ingestEvent('HL7v2', 'DFT^P03', rawHL7);
  } else {
    const price = withAnomaly ? 0.0 : 850.0;
    const fhirResource = {
      resourceType: "ChargeItem",
      id: `charge-${randomId}`,
      status: "billable",
      code: {
        coding: [
          {
            system: "http://hospital-escandon.org/codes",
            code: `FHIR-INS-${randomId}`,
            display: "Kit de Anestesia Quirúrgica"
          }
        ]
      },
      subject: {
        reference: `Patient/${patientId}`
      },
      quantity: {
        value: withAnomaly ? 80 : 1
      },
      priceOverride: {
        value: price,
        currency: "MXN"
      },
      enteredDate: new Date().toISOString()
    };

    return ingestEvent('FHIR_R4', 'ChargeItem', fhirResource);
  }
}

module.exports = {
  parseHL7Message,
  parseFHIRResource,
  ingestEvent,
  getInteropLogs,
  simulateEvent,
};
