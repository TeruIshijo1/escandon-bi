-- ═══════════════════════════════════════════════════════════════════
-- 01_schema.sql — Esquema inicial de la Plataforma BI
-- Hospital Escandón v1.0
-- SQLite 3
-- ═══════════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ───────────────────────────────────────────────────────────────────
-- MÓDULO 1: RBAC — Roles y Usuarios
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS Roles (
    RolId           INTEGER       PRIMARY KEY AUTOINCREMENT,
    NombreRol       TEXT          NOT NULL UNIQUE,
    Descripcion     TEXT,
    Nivel           INTEGER       NOT NULL  -- 1=Admin, 2=Director, 3=JefeArea, 4=Operativo
        CHECK (Nivel BETWEEN 1 AND 4),
    Activo          INTEGER       NOT NULL DEFAULT 1,
    FechaCreacion   TEXT          NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS Usuarios (
    UsuarioId       INTEGER       PRIMARY KEY AUTOINCREMENT,
    Username        TEXT          NOT NULL UNIQUE,
    NombreCompleto  TEXT          NOT NULL,
    Email           TEXT          NOT NULL UNIQUE,
    PasswordHash    TEXT          NOT NULL,
    RolId           INTEGER       NOT NULL REFERENCES Roles(RolId),
    AreaAsignada    TEXT          NULL,  -- NULL para ADMIN y DIRECTOR
    Activo          INTEGER       NOT NULL DEFAULT 1,
    RefreshToken    TEXT          NULL,
    UltimoAcceso    TEXT          NULL,
    UltimaIP        TEXT          NULL,
    FechaCreacion   TEXT          NOT NULL DEFAULT (datetime('now','localtime')),
    FechaModificacion TEXT        NULL,
    CreadoPor       INTEGER       NULL REFERENCES Usuarios(UsuarioId),
    CHECK (
        AreaAsignada IS NULL OR AreaAsignada IN (
            'QUIROFANO','IMAGENOLOGIA','URGENCIAS','CUNEROS',
            'UCI','CONSULTA_EXTERNA','CARDIOLOGIA','LABORATORIO'
        )
    )
);

CREATE INDEX IF NOT EXISTS IX_Usuarios_RolId      ON Usuarios(RolId);
CREATE INDEX IF NOT EXISTS IX_Usuarios_Username   ON Usuarios(Username);
CREATE INDEX IF NOT EXISTS IX_Usuarios_Area       ON Usuarios(AreaAsignada);

-- ───────────────────────────────────────────────────────────────────
-- MÓDULO 2: AUDITORÍA — AuditLog de acciones del sistema
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS AuditLog (
    LogId           INTEGER       PRIMARY KEY AUTOINCREMENT,
    UsuarioId       INTEGER       NULL REFERENCES Usuarios(UsuarioId),
    Username        TEXT          NOT NULL,
    Rol             TEXT,
    Metodo          TEXT          NOT NULL,  -- GET, POST, etc.
    Ruta            TEXT          NOT NULL,
    EstadoHTTP      INTEGER       NOT NULL,
    DuracionMs      INTEGER,
    IP              TEXT,
    CuerpoRequest   TEXT          NULL,      -- JSON sanitizado
    FechaHora       TEXT          NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS IX_AuditLog_UsuarioId ON AuditLog(UsuarioId);
CREATE INDEX IF NOT EXISTS IX_AuditLog_FechaHora ON AuditLog(FechaHora);
CREATE INDEX IF NOT EXISTS IX_AuditLog_Ruta      ON AuditLog(Ruta);

-- ───────────────────────────────────────────────────────────────────
-- MÓDULO 3: CATÁLOGOS CLÍNICOS
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS Pacientes (
    PacienteId      INTEGER       PRIMARY KEY AUTOINCREMENT,
    NumeroExpediente TEXT          NOT NULL UNIQUE,
    NombreCompleto  TEXT          NOT NULL,
    FechaNacimiento TEXT          NOT NULL,
    Sexo            TEXT          NOT NULL CHECK (Sexo IN ('M','F')),
    CURP            TEXT          NULL UNIQUE,
    NSS             TEXT          NULL,
    Activo          INTEGER       NOT NULL DEFAULT 1,
    FechaRegistro   TEXT          NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS IX_Pacientes_Expediente ON Pacientes(NumeroExpediente);

CREATE TABLE IF NOT EXISTS Admisiones (
    AdmisionId      INTEGER       PRIMARY KEY AUTOINCREMENT,
    PacienteId      INTEGER       NOT NULL REFERENCES Pacientes(PacienteId),
    NumeroAdmision  TEXT          NOT NULL UNIQUE,
    FechaIngreso    TEXT          NOT NULL,
    AreaActual      TEXT          NOT NULL,
    CamaId          INTEGER       NULL,
    DiagnosticoIngreso TEXT,
    MedicoTratante  TEXT,
    Estado          TEXT          NOT NULL DEFAULT 'ACTIVA'
        CHECK (Estado IN ('ACTIVA','EGRESADA','TRANSFERIDA')),
    FechaCreacion   TEXT          NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS IX_Admisiones_PacienteId ON Admisiones(PacienteId);
CREATE INDEX IF NOT EXISTS IX_Admisiones_Estado     ON Admisiones(Estado);
CREATE INDEX IF NOT EXISTS IX_Admisiones_AreaActual ON Admisiones(AreaActual);

CREATE TABLE IF NOT EXISTS Egresos (
    EgresoId        INTEGER       PRIMARY KEY AUTOINCREMENT,
    AdmisionId      INTEGER       NOT NULL REFERENCES Admisiones(AdmisionId),
    PacienteId      INTEGER       NOT NULL REFERENCES Pacientes(PacienteId),
    FechaEgreso     TEXT          NOT NULL,
    AreaEgreso      TEXT          NOT NULL,
    TipoEgreso      TEXT          NOT NULL
        CHECK (TipoEgreso IN ('ALTA_VOLUNTARIA','ALTA_MEDICA','TRANSFERENCIA','DEFUNCION','FUGA')),
    DiagnosticoEgreso TEXT,
    FechaCreacion   TEXT          NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS IX_Egresos_PacienteId  ON Egresos(PacienteId);
CREATE INDEX IF NOT EXISTS IX_Egresos_FechaEgreso ON Egresos(FechaEgreso);
CREATE INDEX IF NOT EXISTS IX_Egresos_TipoEgreso  ON Egresos(TipoEgreso);

-- ───────────────────────────────────────────────────────────────────
-- MÓDULO 4: INFRAESTRUCTURA — Camas
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS Camas (
    CamaId          INTEGER       PRIMARY KEY AUTOINCREMENT,
    NumeroCama      TEXT          NOT NULL,
    Area            TEXT          NOT NULL,
    Piso            TEXT,
    Estado          TEXT          NOT NULL DEFAULT 'DISPONIBLE'
        CHECK (Estado IN ('DISPONIBLE','OCUPADA','MANTENIMIENTO','BLOQUEADA')),
    AdmisionActual  INTEGER       NULL REFERENCES Admisiones(AdmisionId),
    Activo          INTEGER       NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS IX_Camas_NumeroArea ON Camas(NumeroCama, Area);
CREATE       INDEX IF NOT EXISTS IX_Camas_Area       ON Camas(Area);
CREATE       INDEX IF NOT EXISTS IX_Camas_Estado     ON Camas(Estado);

-- ───────────────────────────────────────────────────────────────────
-- MÓDULO 5: AUDITORÍA — Inventarios vs. Cargos (PRIORIDAD 1)
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS Insumos (
    InsumoId        INTEGER       PRIMARY KEY AUTOINCREMENT,
    Descripcion     TEXT          NOT NULL,
    CodigoBarras    TEXT          NULL UNIQUE,
    ClaveCBCBSS     TEXT          NULL,
    Categoria       TEXT,  -- MEDICAMENTO, MATERIAL, EQUIPO
    PrecioUnitario  REAL          NOT NULL DEFAULT 0,
    UnidadMedida    TEXT          NOT NULL DEFAULT 'PZA',
    Activo          INTEGER       NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS AlmacenOrdenes (
    OrdenId         TEXT          PRIMARY KEY,
    PacienteId      INTEGER       NOT NULL REFERENCES Pacientes(PacienteId),
    AdmisionId      INTEGER       NOT NULL REFERENCES Admisiones(AdmisionId),
    InsumoId        INTEGER       NOT NULL REFERENCES Insumos(InsumoId),
    AreaHospitalaria TEXT          NOT NULL,
    CantidadSurtida INTEGER       NOT NULL,
    PrecioUnitario  REAL          NOT NULL,
    Estado          TEXT          NOT NULL DEFAULT 'PENDIENTE'
        CHECK (Estado IN ('PENDIENTE','SURTIDA','CANCELADA','PARCIAL')),
    EnfermeraReceptora TEXT       NULL,
    FechaSurtido    TEXT          NOT NULL DEFAULT (datetime('now','localtime')),
    FechaCreacion   TEXT          NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS IX_AlmacenOrdenes_PacienteId ON AlmacenOrdenes(PacienteId);
CREATE INDEX IF NOT EXISTS IX_AlmacenOrdenes_Fecha      ON AlmacenOrdenes(FechaSurtido);
CREATE INDEX IF NOT EXISTS IX_AlmacenOrdenes_Area       ON AlmacenOrdenes(AreaHospitalaria);
CREATE INDEX IF NOT EXISTS IX_AlmacenOrdenes_Estado     ON AlmacenOrdenes(Estado);

CREATE TABLE IF NOT EXISTS CargosEnfermeria (
    CargoId         INTEGER       PRIMARY KEY AUTOINCREMENT,
    OrdenAlmacenId  TEXT          NOT NULL REFERENCES AlmacenOrdenes(OrdenId),
    PacienteId      INTEGER       NOT NULL REFERENCES Pacientes(PacienteId),
    EnfermerId      INTEGER       NOT NULL REFERENCES Usuarios(UsuarioId),
    CantidadCargada INTEGER       NOT NULL,
    FechaCargo      TEXT          NOT NULL DEFAULT (datetime('now','localtime')),
    Observaciones   TEXT          NULL,
    FechaCreacion   TEXT          NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS IX_CargosEnfermeria_OrdenId    ON CargosEnfermeria(OrdenAlmacenId);
CREATE INDEX IF NOT EXISTS IX_CargosEnfermeria_PacienteId ON CargosEnfermeria(PacienteId);
CREATE INDEX IF NOT EXISTS IX_CargosEnfermeria_Fecha      ON CargosEnfermeria(FechaCargo);

-- Tabla de resultados de auditoría conciliada
CREATE TABLE IF NOT EXISTS AuditoriaInventarioCargos (
    AuditoriaId     INTEGER       PRIMARY KEY AUTOINCREMENT,
    OrdenId         TEXT          NOT NULL,
    EstadoConciliacion TEXT       NOT NULL
        CHECK (EstadoConciliacion IN ('COINCIDE','DIFERENCIA','FALTANTE','EXCEDENTE')),
    Diferencia      INTEGER       NOT NULL DEFAULT 0,
    MontoDisputa    REAL          NOT NULL DEFAULT 0,
    FechaAuditoria  TEXT          NOT NULL DEFAULT (datetime('now','localtime')),
    RevisadoPor     INTEGER       NULL REFERENCES Usuarios(UsuarioId),
    Comentario      TEXT          NULL
);

CREATE INDEX IF NOT EXISTS IX_AuditoriaIC_OrdenId   ON AuditoriaInventarioCargos(OrdenId);
CREATE INDEX IF NOT EXISTS IX_AuditoriaIC_Estado    ON AuditoriaInventarioCargos(EstadoConciliacion);
CREATE INDEX IF NOT EXISTS IX_AuditoriaIC_Fecha     ON AuditoriaInventarioCargos(FechaAuditoria);

-- ───────────────────────────────────────────────────────────────────
-- MÓDULO 6: QUIRÓFANO
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ProgramacionQuirofano (
    CirugiaId       INTEGER       PRIMARY KEY AUTOINCREMENT,
    PacienteId      INTEGER       NOT NULL REFERENCES Pacientes(PacienteId),
    AdmisionId      INTEGER       NULL  REFERENCES Admisiones(AdmisionId),
    FechaCirugia    TEXT          NOT NULL,
    HoraInicio      TEXT          NULL,
    HoraFin         TEXT          NULL,
    QuirofanoNumero TEXT          NOT NULL,
    TipoCirugia     TEXT          NOT NULL,
    Cirujano        TEXT,
    Estado          TEXT          NOT NULL DEFAULT 'PROGRAMADA'
        CHECK (Estado IN ('PROGRAMADA','EN_CURSO','REALIZADA','CANCELADA','SUSPENDIDA')),
    Observaciones   TEXT          NULL,
    FechaCreacion   TEXT          NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS IX_ProgramacionQX_Fecha     ON ProgramacionQuirofano(FechaCirugia);
CREATE INDEX IF NOT EXISTS IX_ProgramacionQX_PacienteId ON ProgramacionQuirofano(PacienteId);

-- ───────────────────────────────────────────────────────────────────
-- MÓDULO 7: CONFIGURACIÓN DE REPORTES BI
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ConfiguracionBI (
    ConfigId        INTEGER       PRIMARY KEY AUTOINCREMENT,
    ReporteId       TEXT          NOT NULL UNIQUE,
    Titulo          TEXT          NOT NULL,
    PowerBIWorkspace TEXT         NULL,
    PowerBIReportId TEXT          NULL,
    LookerDashboard TEXT          NULL,
    LookerDashboard2 TEXT         NULL,
    LookerDashboard3 TEXT         NULL,
    RolesPermitidos TEXT          NOT NULL,  -- JSON array de roles
    AreaRequerida   TEXT          NULL,
    Activo          INTEGER       NOT NULL DEFAULT 1,
    FechaCreacion   TEXT          NOT NULL DEFAULT (datetime('now','localtime')),
    PbixPath        TEXT          NULL,
    ExcelPath       TEXT          NULL,
    ThumbnailPath   TEXT          NULL
);
