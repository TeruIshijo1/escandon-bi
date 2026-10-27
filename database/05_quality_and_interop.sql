



CREATE TABLE IF NOT EXISTS data_quality_issues (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,                  
  rule_failed TEXT NOT NULL,             
  severity TEXT CHECK (severity IN ('ALTA', 'MEDIA', 'BAJA')) DEFAULT 'MEDIA',
  item_code TEXT,
  description TEXT,
  patient_id TEXT,
  row_data TEXT,                         
  status TEXT CHECK (status IN ('PENDIENTE', 'RESUELTO', 'IGNORADO')) DEFAULT 'PENDIENTE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  resolved_by TEXT,
  resolution_notes TEXT
);

CREATE TABLE IF NOT EXISTS interop_event_logs (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,              
  protocol TEXT NOT NULL,                
  patient_id TEXT,
  raw_payload TEXT NOT NULL,
  status TEXT CHECK (status IN ('PROCESADO', 'ALERTA_CALIDAD', 'ERROR')) DEFAULT 'PROCESADO',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE INDEX IF NOT EXISTS idx_dq_status ON data_quality_issues(status);
CREATE INDEX IF NOT EXISTS idx_dq_severity ON data_quality_issues(severity);
CREATE INDEX IF NOT EXISTS idx_interop_created ON interop_event_logs(created_at);