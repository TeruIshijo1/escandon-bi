






-- RBAC — Roles y Usuarios


CREATE TABLE IF NOT EXISTS Roles (
    RolId           SERIAL        PRIMARY KEY,
    NombreRol       TEXT          NOT NULL UNIQUE,
    Descripcion     TEXT,
    Nivel           INTEGER       NOT NULL  
        CHECK (Nivel BETWEEN 1 AND 4),
    Activo          INTEGER       NOT NULL DEFAULT 1,
    FechaCreacion   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Usuarios (
    UsuarioId       SERIAL        PRIMARY KEY,
    Username        TEXT          NOT NULL UNIQUE,
    NombreCompleto  TEXT          NOT NULL,
    Email           TEXT          NOT NULL UNIQUE,
    PasswordHash    TEXT          NOT NULL,
    RolId           INTEGER       NOT NULL REFERENCES Roles(RolId),
    AreaAsignada    TEXT          NULL,  
    Activo          INTEGER       NOT NULL DEFAULT 1,
    RefreshToken    TEXT          NULL,
    UltimoAcceso    TIMESTAMP     NULL,
    UltimaIP        TEXT          NULL,
    FechaCreacion   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FechaModificacion TIMESTAMP   NULL,
    CreadoPor       INTEGER       NULL REFERENCES Usuarios(UsuarioId),
    ReportesPermitidos TEXT       NULL
);

CREATE INDEX IF NOT EXISTS IX_Usuarios_RolId      ON Usuarios(RolId);
CREATE INDEX IF NOT EXISTS IX_Usuarios_Username   ON Usuarios(Username);
CREATE INDEX IF NOT EXISTS IX_Usuarios_Area       ON Usuarios(AreaAsignada);


-- AUDITORÍA — AuditLog de acciones del sistema


CREATE TABLE IF NOT EXISTS AuditLog (
    LogId           SERIAL        PRIMARY KEY,
    UsuarioId       INTEGER       NULL REFERENCES Usuarios(UsuarioId),
    Username        TEXT          NOT NULL,
    Rol             TEXT,
    Metodo          TEXT          NOT NULL,  
    Ruta            TEXT          NOT NULL,
    EstadoHTTP      INTEGER       NOT NULL,
    DuracionMs      INTEGER,
    IP              TEXT,
    CuerpoRequest   TEXT          NULL,      
    FechaHora       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS IX_AuditLog_UsuarioId ON AuditLog(UsuarioId);
CREATE INDEX IF NOT EXISTS IX_AuditLog_FechaHora ON AuditLog(FechaHora);
CREATE INDEX IF NOT EXISTS IX_AuditLog_Ruta      ON AuditLog(Ruta);


-- CATÁLOGOS CLÍNICOS


CREATE TABLE IF NOT EXISTS Pacientes (
    PacienteId      SERIAL        PRIMARY KEY,
    NumeroExpediente TEXT         NOT NULL UNIQUE,
    NombreCompleto  TEXT          NOT NULL,
    FechaNacimiento TIMESTAMP     NOT NULL,
    Sexo            TEXT          NOT NULL CHECK (Sexo IN ('M','F')),
    CURP            TEXT          NULL UNIQUE,
    NSS             TEXT          NULL,
    Activo          INTEGER       NOT NULL DEFAULT 1,
    FechaRegistro   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CodigoPostal    TEXT,
    Estado          TEXT,
    Municipio       TEXT
);

CREATE INDEX IF NOT EXISTS IX_Pacientes_Expediente ON Pacientes(NumeroExpediente);

CREATE TABLE IF NOT EXISTS Admisiones (
    AdmisionId      SERIAL        PRIMARY KEY,
    PacienteId      INTEGER       NOT NULL REFERENCES Pacientes(PacienteId),
    NumeroAdmision  TEXT          NOT NULL UNIQUE,
    FechaIngreso    TIMESTAMP     NOT NULL,
    AreaActual      TEXT          NOT NULL,
    CamaId          INTEGER       NULL,
    DiagnosticoIngreso TEXT,
    MedicoTratante  TEXT,
    Estado          TEXT          NOT NULL DEFAULT 'ACTIVA'
        CHECK (Estado IN ('ACTIVA','EGRESADA','TRANSFERIDA')),
    FechaCreacion   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS IX_Admisiones_PacienteId ON Admisiones(PacienteId);
CREATE INDEX IF NOT EXISTS IX_Admisiones_Estado     ON Admisiones(Estado);
CREATE INDEX IF NOT EXISTS IX_Admisiones_AreaActual ON Admisiones(AreaActual);

CREATE TABLE IF NOT EXISTS Egresos (
    EgresoId        SERIAL        PRIMARY KEY,
    AdmisionId      INTEGER       NOT NULL REFERENCES Admisiones(AdmisionId),
    PacienteId      INTEGER       NOT NULL REFERENCES Pacientes(PacienteId),
    FechaEgreso     TIMESTAMP     NOT NULL,
    AreaEgreso      TEXT          NOT NULL,
    TipoEgreso      TEXT          NOT NULL
        CHECK (TipoEgreso IN ('ALTA_VOLUNTARIA','ALTA_MEDICA','TRANSFERENCIA','DEFUNCION','FUGA')),
    DiagnosticoEgreso TEXT,
    FechaCreacion   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS IX_Egresos_PacienteId  ON Egresos(PacienteId);
CREATE INDEX IF NOT EXISTS IX_Egresos_FechaEgreso ON Egresos(FechaEgreso);
CREATE INDEX IF NOT EXISTS IX_Egresos_TipoEgreso  ON Egresos(TipoEgreso);


-- INFRAESTRUCTURA — Camas


CREATE TABLE IF NOT EXISTS Camas (
    CamaId          SERIAL        PRIMARY KEY,
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


-- AUDITORÍA — Inventarios vs. Cargos


CREATE TABLE IF NOT EXISTS Insumos (
    InsumoId        SERIAL        PRIMARY KEY,
    Descripcion     TEXT          NOT NULL,
    CodigoBarras    TEXT          NULL UNIQUE,
    ClaveCBCBSS     TEXT          NULL,
    Categoria       TEXT,  
    PrecioUnitario  DOUBLE PRECISION NOT NULL DEFAULT 0,
    UnidadMedida    TEXT          NOT NULL DEFAULT 'PZA',
    Activo          INTEGER       NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS AlmacenOrdenes (
    OrdenId         TEXT          PRIMARY KEY,
    PacienteId      INTEGER       NOT NULL REFERENCES Pacientes(PacienteId),
    AdmisionId      INTEGER       NOT NULL REFERENCES Admisiones(AdmisionId),
    InsumoId        INTEGER       NOT NULL REFERENCES Insumos(InsumoId),
    AreaHospitalaria TEXT         NOT NULL,
    CantidadSurtida INTEGER       NOT NULL,
    PrecioUnitario  DOUBLE PRECISION NOT NULL,
    Estado          TEXT          NOT NULL DEFAULT 'PENDIENTE'
        CHECK (Estado IN ('PENDIENTE','SURTIDA','CANCELADA','PARCIAL')),
    EnfermeraReceptora TEXT       NULL,
    FechaSurtido    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FechaCreacion   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS IX_AlmacenOrdenes_PacienteId ON AlmacenOrdenes(PacienteId);
CREATE INDEX IF NOT EXISTS IX_AlmacenOrdenes_Fecha      ON AlmacenOrdenes(FechaSurtido);
CREATE INDEX IF NOT EXISTS IX_AlmacenOrdenes_Area       ON AlmacenOrdenes(AreaHospitalaria);
CREATE INDEX IF NOT EXISTS IX_AlmacenOrdenes_Estado     ON AlmacenOrdenes(Estado);

CREATE TABLE IF NOT EXISTS CargosEnfermeria (
    CargoId         SERIAL        PRIMARY KEY,
    OrdenAlmacenId  TEXT          NOT NULL REFERENCES AlmacenOrdenes(OrdenId),
    PacienteId      INTEGER       NOT NULL REFERENCES Pacientes(PacienteId),
    EnfermerId      INTEGER       NOT NULL REFERENCES Usuarios(UsuarioId),
    CantidadCargada INTEGER       NOT NULL,
    FechaCargo      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Observaciones   TEXT          NULL,
    FechaCreacion   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS IX_CargosEnfermeria_OrdenId    ON CargosEnfermeria(OrdenAlmacenId);
CREATE INDEX IF NOT EXISTS IX_CargosEnfermeria_PacienteId ON CargosEnfermeria(PacienteId);
CREATE INDEX IF NOT EXISTS IX_CargosEnfermeria_Fecha      ON CargosEnfermeria(FechaCargo);


CREATE TABLE IF NOT EXISTS AuditoriaInventarioCargos (
    AuditoriaId     SERIAL        PRIMARY KEY,
    OrdenId         TEXT          NOT NULL,
    EstadoConciliacion TEXT       NOT NULL
        CHECK (EstadoConciliacion IN ('COINCIDE','DIFERENCIA','FALTANTE','EXCEDENTE')),
    Diferencia      INTEGER       NOT NULL DEFAULT 0,
    MontoDisputa    DOUBLE PRECISION NOT NULL DEFAULT 0,
    FechaAuditoria  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    RevisadoPor     INTEGER       NULL REFERENCES Usuarios(UsuarioId),
    Comentario      TEXT          NULL
);

CREATE INDEX IF NOT EXISTS IX_AuditoriaIC_OrdenId   ON AuditoriaInventarioCargos(OrdenId);
CREATE INDEX IF NOT EXISTS IX_AuditoriaIC_Estado    ON AuditoriaInventarioCargos(EstadoConciliacion);
CREATE INDEX IF NOT EXISTS IX_AuditoriaIC_Fecha     ON AuditoriaInventarioCargos(FechaAuditoria);


-- QUIRÓFANO


CREATE TABLE IF NOT EXISTS ProgramacionQuirofano (
    CirugiaId       SERIAL        PRIMARY KEY,
    PacienteId      INTEGER       NOT NULL REFERENCES Pacientes(PacienteId),
    AdmisionId      INTEGER       NULL  REFERENCES Admisiones(AdmisionId),
    FechaCirugia    TIMESTAMP     NOT NULL,
    HoraInicio      TEXT          NULL,
    HoraFin         TEXT          NULL,
    QuirofanoNumero TEXT          NOT NULL,
    TipoCirugia     TEXT          NOT NULL,
    Cirujano        TEXT,
    Estado          TEXT          NOT NULL DEFAULT 'PROGRAMADA'
        CHECK (Estado IN ('PROGRAMADA','EN_CURSO','REALIZADA','CANCELADA','SUSPENDIDA')),
    Observaciones   TEXT          NULL,
    FechaCreacion   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS IX_ProgramacionQX_Fecha     ON ProgramacionQuirofano(FechaCirugia);
CREATE INDEX IF NOT EXISTS IX_ProgramacionQX_PacienteId ON ProgramacionQuirofano(PacienteId);


-- CONFIGURACIÓN DE REPORTES BI


CREATE TABLE IF NOT EXISTS ConfiguracionBI (
    ConfigId        SERIAL        PRIMARY KEY,
    ReporteId       TEXT          NOT NULL UNIQUE,
    Titulo          TEXT          NOT NULL,
    PowerBIWorkspace TEXT         NULL,
    PowerBIReportId TEXT          NULL,
    LookerDashboard TEXT          NULL,
    LookerDashboard2 TEXT         NULL,
    LookerDashboard3 TEXT         NULL,
    RolesPermitidos TEXT          NOT NULL,  
    AreaRequerida   TEXT          NULL,
    Activo          INTEGER       NOT NULL DEFAULT 1,
    FechaCreacion   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PbixPath        TEXT          NULL,
    ExcelPath       TEXT          NULL,
    ThumbnailPath   TEXT          NULL,
    MultiPagina     INTEGER       DEFAULT 0,
    JsonApiUrl      TEXT          NULL,
    JsonFilePath    TEXT          NULL
);


-- CONSULTAS PERSONALIZADAS SAP


CREATE TABLE IF NOT EXISTS UserSapQueries (
    QueryId           SERIAL        PRIMARY KEY,
    UserId            INTEGER       NULL REFERENCES Usuarios(UsuarioId) ON DELETE CASCADE,
    Username          TEXT          NOT NULL,
    Titulo            TEXT          NOT NULL,
    Descripcion       TEXT          NULL,
    Entidad           TEXT          NOT NULL,
    CamposSeleccionados TEXT        NOT NULL,  
    FiltrosAplicados  TEXT          NOT NULL,  
    EsPublico         INTEGER       NOT NULL DEFAULT 0,
    FechaCreacion     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FechaModificacion TIMESTAMP     NULL
);

CREATE INDEX IF NOT EXISTS IX_UserSapQueries_User    ON UserSapQueries(Username);
CREATE INDEX IF NOT EXISTS IX_UserSapQueries_Entidad ON UserSapQueries(Entidad);