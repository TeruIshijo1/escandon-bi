-- ═══════════════════════════════════════════════════════════════════
-- 04_kpi_config.sql — Configuración de Indicadores KPI
-- Hospital Escandón BI Platform v4.0
-- Cada fila = un cuadro/indicador en la plataforma
-- ═══════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS KPIConfig;

CREATE TABLE IF NOT EXISTS KPIConfig (
  KPIId         INTEGER PRIMARY KEY AUTOINCREMENT,
  ElementoId    TEXT    NOT NULL UNIQUE,   -- 'directivo.ocupacion'
  Seccion       TEXT    NOT NULL,          -- 'directivo' | 'mando' | 'area' | 'stats' | 'audit' | 'home'
  NombreDefault TEXT    NOT NULL,          -- Nombre original del sistema (no cambia)
  NombreCustom  TEXT    NULL,              -- Lo que escribe el Admin (NULL = usa NombreDefault)
  Icono         TEXT    NOT NULL DEFAULT '📊',
  PBIUrl        TEXT    NULL,              -- URL completa del reporte Power BI al que navega al hacer click
  PBIUrl2       TEXT    NULL,              -- URL de la página 2 (opcional)
  PBIUrl3       TEXT    NULL,              -- URL de la página 3 (opcional)
  Activo        INTEGER NOT NULL DEFAULT 1,
  FechaModif    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);



-- ── Seed: Estadísticas Demográficas (8) ──────────────────────────
INSERT INTO KPIConfig (ElementoId, Seccion, NombreDefault, Icono) VALUES
  ('stats.egresos_total',   'stats', 'Total Egresos',          '📋'),
  ('stats.promedio_edad',   'stats', 'Promedio de Edad',       '👤'),
  ('stats.genero_femenino', 'stats', '% Género Femenino',      '♀️'),
  ('stats.defunciones',     'stats', 'Defunciones',            '📉'),
  ('stats.nacimientos',     'stats', 'Nacimientos',            '👶'),
  ('stats.estancia_global', 'stats', 'Estancia Promedio Global','📅'),
  ('stats.top_diagnosticos', 'stats', 'Top Diagnósticos del Período', '📊'),
  ('stats.egresos_servicio', 'stats', 'Egresos por Servicio', '📊');

-- ── Seed: Dashboard por Área (36 para las 9 áreas) ──────────────────
INSERT INTO KPIConfig (ElementoId, Seccion, NombreDefault, Icono) VALUES
  ('area.quirofano.ocupacion', 'area', 'Ocupación - Quirófano', '🏥'),
  ('area.quirofano.egresos', 'area', 'Egresos Mes - Quirófano', '🚪'),
  ('area.quirofano.estancia', 'area', 'Estancia Promedio - Quirófano', '📅'),
  ('area.quirofano.rotacion_camas', 'area', 'Rotación de Camas - Quirófano', '🔄'),

  ('area.uci.ocupacion', 'area', 'Ocupación - UCI', '🏥'),
  ('area.uci.egresos', 'area', 'Egresos Mes - UCI', '🚪'),
  ('area.uci.estancia', 'area', 'Estancia Promedio - UCI', '📅'),
  ('area.uci.rotacion_camas', 'area', 'Rotación de Camas - UCI', '🔄'),

  ('area.urgencias.ocupacion', 'area', 'Ocupación - Urgencias', '🏥'),
  ('area.urgencias.egresos', 'area', 'Egresos Mes - Urgencias', '🚪'),
  ('area.urgencias.estancia', 'area', 'Estancia Promedio - Urgencias', '📅'),
  ('area.urgencias.rotacion_camas', 'area', 'Rotación de Camas - Urgencias', '🔄'),

  ('area.cuneros.ocupacion', 'area', 'Ocupación - Cuneros', '🏥'),
  ('area.cuneros.egresos', 'area', 'Egresos Mes - Cuneros', '🚪'),
  ('area.cuneros.estancia', 'area', 'Estancia Promedio - Cuneros', '📅'),
  ('area.cuneros.rotacion_camas', 'area', 'Rotación de Camas - Cuneros', '🔄'),

  ('area.imagenologia.ocupacion', 'area', 'Ocupación - Imagenología', '🏥'),
  ('area.imagenologia.egresos', 'area', 'Egresos Mes - Imagenología', '🚪'),
  ('area.imagenologia.estancia', 'area', 'Estancia Promedio - Imagenología', '📅'),
  ('area.imagenologia.rotacion_camas', 'area', 'Rotación de Camas - Imagenología', '🔄'),

  ('area.laboratorio.ocupacion', 'area', 'Ocupación - Laboratorio', '🏥'),
  ('area.laboratorio.egresos', 'area', 'Egresos Mes - Laboratorio', '🚪'),
  ('area.laboratorio.estancia', 'area', 'Estancia Promedio - Laboratorio', '📅'),
  ('area.laboratorio.rotacion_camas', 'area', 'Rotación de Camas - Laboratorio', '🔄'),

  ('area.consulta_externa.ocupacion', 'area', 'Ocupación - Consulta Externa', '🏥'),
  ('area.consulta_externa.egresos', 'area', 'Egresos Mes - Consulta Externa', '🚪'),
  ('area.consulta_externa.estancia', 'area', 'Estancia Promedio - Consulta Externa', '📅'),
  ('area.consulta_externa.rotacion_camas', 'area', 'Rotación de Camas - Consulta Externa', '🔄'),

  ('area.cardiologia.ocupacion', 'area', 'Ocupación - Cardiología', '🏥'),
  ('area.cardiologia.egresos', 'area', 'Egresos Mes - Cardiología', '🚪'),
  ('area.cardiologia.estancia', 'area', 'Estancia Promedio - Cardiología', '📅'),
  ('area.cardiologia.rotacion_camas', 'area', 'Rotación de Camas - Cardiología', '🔄'),

  ('area.hospitalizacion.ocupacion', 'area', 'Ocupación - Hospitalización', '🏥'),
  ('area.hospitalizacion.egresos', 'area', 'Egresos Mes - Hospitalización', '🚪'),
  ('area.hospitalizacion.estancia', 'area', 'Estancia Promedio - Hospitalización', '📅'),
  ('area.hospitalizacion.rotacion_camas', 'area', 'Rotación de Camas - Hospitalización', '🔄');
