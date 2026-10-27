





-- Orígenes de Datos
CREATE TABLE IF NOT EXISTS DataConnectors (
    ConnectorId     SERIAL        PRIMARY KEY,
    Nombre          TEXT          NOT NULL,
    Tipo            TEXT          NOT NULL CHECK (Tipo IN ('SQLITE', 'MSSQL', 'POSTGRES', 'EXCEL', 'CSV', 'POWERBI_API')),
    Configuracion   TEXT          NOT NULL, 
    Estado          TEXT          NOT NULL DEFAULT 'ACTIVO',
    UltimaSincronizacion TEXT     NULL,
    FechaCreacion   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Entidades de Datos
CREATE TABLE IF NOT EXISTS DataEntities (
    EntityId        SERIAL        PRIMARY KEY,
    ConnectorId     INTEGER       NOT NULL REFERENCES DataConnectors(ConnectorId),
    NombreEntidad   TEXT          NOT NULL, 
    Esquema         TEXT          NULL,     
    Activo          INTEGER       NOT NULL DEFAULT 1,
    UNIQUE (ConnectorId, NombreEntidad)
);

-- Mapeo de Métricas
CREATE TABLE IF NOT EXISTS MetricMappings (
    MappingId       SERIAL        PRIMARY KEY,
    SeccionUI       TEXT          NOT NULL UNIQUE, 
    EntityId        INTEGER       REFERENCES DataEntities(EntityId),
    CampoValor      TEXT          NOT NULL, 
    CampoDelta      TEXT          NULL,     
    CampoFiltro     TEXT          NULL,     
    MetodoCalculo   TEXT          NOT NULL DEFAULT 'SUM'
        CHECK (MetodoCalculo IN ('SUM', 'AVG', 'COUNT', 'LAST', 'FORMULA')),
    Periodicidad    TEXT          NOT NULL DEFAULT 'DIARIO',
    FechaActualizacion TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Inserción de Configuración Inicial


INSERT INTO DataConnectors (Nombre, Tipo, Configuracion)
VALUES ('Base de Datos Interna (Local)', 'SQLITE', '{"database": "escandon_bi.db"}')
ON CONFLICT DO NOTHING;

-- Mapeos iniciales para el Dashboard Directivo

INSERT INTO MetricMappings (SeccionUI, CampoValor, MetodoCalculo, Periodicidad)
VALUES
('dir_ocupacion', 'PctOcupacion', 'LAST', 'TIEMPO_REAL'),
('dir_mortalidad', 'TasaMortalidad', 'LAST', 'MENSUAL'),
('dir_cirugias', 'TotalCirugias', 'COUNT', 'DIARIO')
ON CONFLICT (SeccionUI) DO NOTHING;