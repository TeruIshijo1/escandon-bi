-- ═══════════════════════════════════════════════════════════════════
-- 04_kpi_config.sql — Configuración de Indicadores KPI
-- Hospital Escandón BI Platform v4.0
-- Cada fila = un cuadro/indicador en la plataforma
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS KPIConfig (
  KPIId         INTEGER PRIMARY KEY AUTOINCREMENT,
  ElementoId    TEXT    NOT NULL UNIQUE,   -- 'directivo.ocupacion'
  Seccion       TEXT    NOT NULL,          -- 'directivo' | 'mando' | 'area' | 'stats' | 'audit' | 'home'
  NombreDefault TEXT    NOT NULL,          -- Nombre original del sistema (no cambia)
  NombreCustom  TEXT    NULL,              -- Lo que escribe el Admin (NULL = usa NombreDefault)
  Icono         TEXT    NOT NULL DEFAULT '📊',
  PBIUrl        TEXT    NULL,              -- URL completa del reporte Power BI al que navega al hacer click
  Activo        INTEGER NOT NULL DEFAULT 1,
  FechaModif    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── Seed: Dashboard Directivo (9) ─────────────────────────────────
INSERT OR IGNORE INTO KPIConfig (ElementoId, Seccion, NombreDefault, Icono) VALUES
  ('directivo.ocupacion',       'directivo', 'Ocupación Hospitalaria',  '🏥'),
  ('directivo.quirofanos',      'directivo', 'Quirófanos Activos',      '🔪'),
  ('directivo.censo',           'directivo', 'Censo Actual',            '📊'),
  ('directivo.mortalidad',      'directivo', 'Tasa de Mortalidad',      '❤️'),
  ('directivo.estancia',        'directivo', 'Estancia Promedio',       '📅'),
  ('directivo.egresos',         'directivo', 'Egresos Mes',             '🚪'),
  ('directivo.costo_insumos',   'directivo', 'Costo de Insumos',        '📦'),
  ('directivo.margen_operativo','directivo', 'Margen Operativo',        '💼'),
  ('directivo.atencion_activa', 'directivo', 'Atención Real Activa',    '❤️');

-- ── Seed: Panel de Mando (4) ──────────────────────────────────────
INSERT OR IGNORE INTO KPIConfig (ElementoId, Seccion, NombreDefault, Icono) VALUES
  ('mando.eficiencia_global',   'mando', 'Eficiencia Global',       '⚙️'),
  ('mando.eficacia_clinica',    'mando', 'Eficacia Clínica',        '🎯'),
  ('mando.satisfaccion',        'mando', 'Satisfacción del Paciente','⭐'),
  ('mando.presupuesto_ejec',    'mando', 'Presupuesto Ejecutado',    '💼');

-- ── Seed: Dashboard por Área (4 genéricos) ────────────────────────
INSERT OR IGNORE INTO KPIConfig (ElementoId, Seccion, NombreDefault, Icono) VALUES
  ('area.ocupacion',       'area', 'Ocupación',         '🏥'),
  ('area.egresos',         'area', 'Egresos Mes',        '🚪'),
  ('area.estancia',        'area', 'Estancia Promedio',  '📅'),
  ('area.rotacion_camas',  'area', 'Rotación de Camas',  '🔄');

-- ── Seed: Estadísticas Demográficas (6) ──────────────────────────
INSERT OR IGNORE INTO KPIConfig (ElementoId, Seccion, NombreDefault, Icono) VALUES
  ('stats.egresos_total',   'stats', 'Total Egresos',          '📋'),
  ('stats.promedio_edad',   'stats', 'Promedio de Edad',       '👤'),
  ('stats.genero_femenino', 'stats', '% Género Femenino',      '♀️'),
  ('stats.defunciones',     'stats', 'Defunciones',            '📉'),
  ('stats.nacimientos',     'stats', 'Nacimientos',            '👶'),
  ('stats.estancia_global', 'stats', 'Estancia Promedio Global','📅');

-- ── Seed: Auditoría Inventarios (4) ──────────────────────────────
INSERT OR IGNORE INTO KPIConfig (ElementoId, Seccion, NombreDefault, Icono) VALUES
  ('audit.total_partidas',  'audit', 'Total Partidas Auditadas','📋'),
  ('audit.coincidencias',   'audit', 'Coincidencias',          '✅'),
  ('audit.diferencias',     'audit', 'Con Diferencia',         '⚠️'),
  ('audit.monto_disputa',   'audit', 'Monto en Disputa',       '💰');

-- ── Seed: Home Mini-Stats (6) ────────────────────────────────────
INSERT OR IGNORE INTO KPIConfig (ElementoId, Seccion, NombreDefault, Icono) VALUES
  ('home.censo_actual',    'home', 'Censo Actual',        '🏥'),
  ('home.camas_ocupadas',  'home', 'Camas Ocupadas',      '🛏️'),
  ('home.cirugias_hoy',    'home', 'Cirugías Hoy',        '🔪'),
  ('home.estancia_prom',   'home', 'Estancia Promedio',   '📅'),
  ('home.mortalidad',      'home', 'Mortalidad',          '❤️'),
  ('home.egresos_mes',     'home', 'Egresos Mes',         '🚪');
