-- 05_quality_and_interop.sql (PostgreSQL)
-- Tablas para Motor de Calidad de Datos (Opción 10) e Interoperabilidad HL7/FHIR (Opción 5)
-- Hospital Escandón BI

CREATE TABLE IF NOT EXISTS data_quality_issues (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,                  -- 'CARGA_EXCEL', 'HL7_INGESTION', 'FHIR_WEBHOOK'
  rule_failed TEXT NOT NULL,             -- 'PRECIO_ZERO', 'CARGO_DUPLICADO', 'CANTIDAD_ANOMALA', 'FECHA_INVALIDA'
  severity TEXT CHECK (severity IN ('ALTA', 'MEDIA', 'BAJA')) DEFAULT 'MEDIA',
  item_code TEXT,
  description TEXT,
  patient_id TEXT,
  row_data TEXT,                         -- Contenido completo en JSON
  status TEXT CHECK (status IN ('PENDIENTE', 'RESUELTO', 'IGNORADO')) DEFAULT 'PENDIENTE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  resolved_by TEXT,
  resolution_notes TEXT
);

CREATE TABLE IF NOT EXISTS interop_event_logs (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,              -- 'DFT^P03', 'ChargeItem', 'ADT^A08'
  protocol TEXT NOT NULL,                -- 'HL7v2', 'FHIR_R4'
  patient_id TEXT,
  raw_payload TEXT NOT NULL,
  status TEXT CHECK (status IN ('PROCESADO', 'ALERTA_CALIDAD', 'ERROR')) DEFAULT 'PROCESADO',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_dq_status ON data_quality_issues(status);
CREATE INDEX IF NOT EXISTS idx_dq_severity ON data_quality_issues(severity);
CREATE INDEX IF NOT EXISTS idx_interop_created ON interop_event_logs(created_at);