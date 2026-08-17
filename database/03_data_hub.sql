-- ═══════════════════════════════════════════════════════════════════
-- 03_data_hub.sql — Sistema de Conectores y Mapeo Dinámico de Datos (PostgreSQL)
-- Hospital Escandón v2.0
-- Permite al administrador definir de dónde se nutre cada KPI
-- ═══════════════════════════════════════════════════════════════════

-- 1. Orígenes de Datos (Connectors)
CREATE TABLE IF NOT EXISTS DataConnectors (
    ConnectorId     SERIAL        PRIMARY KEY,
    Nombre          TEXT          NOT NULL,
    Tipo            TEXT          NOT NULL CHECK (Tipo IN ('SQLITE', 'MSSQL', 'POSTGRES', 'EXCEL', 'CSV', 'POWERBI_API')),
    Configuracion   TEXT          NOT NULL, -- JSON con host, user, pass, filePath, etc.
    Estado          TEXT          NOT NULL DEFAULT 'ACTIVO',
    UltimaSincronizacion TEXT     NULL,
    FechaCreacion   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Entidades de Datos (Tablas o Hojas de Excel detectadas)
CREATE TABLE IF NOT EXISTS DataEntities (
    EntityId        SERIAL        PRIMARY KEY,
    ConnectorId     INTEGER       NOT NULL REFERENCES DataConnectors(ConnectorId),
    NombreEntidad   TEXT          NOT NULL, -- Nombre de tabla o Hoja de Excel
    Esquema         TEXT          NULL,     -- JSON con la lista de columnas y tipos detectados
    Activo          INTEGER       NOT NULL DEFAULT 1,
    UNIQUE (ConnectorId, NombreEntidad)
);

-- 3. Mapeo de Métricas (Configuración de qué alimenta a qué en la UI)
CREATE TABLE IF NOT EXISTS MetricMappings (
    MappingId       SERIAL        PRIMARY KEY,
    SeccionUI       TEXT          NOT NULL UNIQUE, -- ID de la tarjeta en el dashboard (ej: 'dir_ocupacion')
    EntityId        INTEGER       REFERENCES DataEntities(EntityId),
    CampoValor      TEXT          NOT NULL, -- Columna o expresión para el valor principal
    CampoDelta      TEXT          NULL,     -- Columna o expresión para la variación
    CampoFiltro     TEXT          NULL,     -- Clausula WHERE o filtro opcional
    MetodoCalculo   TEXT          NOT NULL DEFAULT 'SUM'
        CHECK (MetodoCalculo IN ('SUM', 'AVG', 'COUNT', 'LAST', 'FORMULA')),
    Periodicidad    TEXT          NOT NULL DEFAULT 'DIARIO',
    FechaActualizacion TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Inserción de Configuración Inicial (Mapeo a la Base Local por defecto)
-- Esto asegura que la plataforma siga funcionando con lo que ya tiene, pero sea editable.

INSERT INTO DataConnectors (Nombre, Tipo, Configuracion)
VALUES ('Base de Datos Interna (Local)', 'SQLITE', '{"database": "escandon_bi.db"}')
ON CONFLICT DO NOTHING;

-- Mapeos iniciales para el Dashboard Directivo
-- Nota: Usamos IDs que coincidan con lo que el frontend espera o el backend procesa.
INSERT INTO MetricMappings (SeccionUI, CampoValor, MetodoCalculo, Periodicidad)
VALUES
('dir_ocupacion', 'PctOcupacion', 'LAST', 'TIEMPO_REAL'),
('dir_mortalidad', 'TasaMortalidad', 'LAST', 'MENSUAL'),
('dir_cirugias', 'TotalCirugias', 'COUNT', 'DIARIO')
ON CONFLICT (SeccionUI) DO NOTHING;