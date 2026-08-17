-- ═══════════════════════════════════════════════════════════════════
-- 06_cex.sql — Esquema para Módulo Consulta Externa
-- Hospital Escandón BI v2.0
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cex_pacientes (
    NoExpediente VARCHAR(50) PRIMARY KEY,
    NombreCompleto VARCHAR(200) NOT NULL,
    FechaNacimiento DATE,
    Sexo VARCHAR(20),
    Telefonos VARCHAR(100),
    Email VARCHAR(100),
    Alergias TEXT,
    NotasClinicas TEXT,
    Origen VARCHAR(20) DEFAULT 'LOCAL', -- 'VERTICAL' o 'LOCAL'
    ModificadoPor VARCHAR(100),
    UltimaModificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cex_medicos (
    MedicoId SERIAL PRIMARY KEY,
    NombreCompleto VARCHAR(200) NOT NULL,
    Especialidad VARCHAR(150),
    Consultorio VARCHAR(50),
    Activo BOOLEAN DEFAULT TRUE,
    ModificadoPor VARCHAR(100),
    FechaModificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cex_citas (
    CitaId SERIAL PRIMARY KEY,
    CitaOrigenId VARCHAR(100) UNIQUE, -- ID o No. de cita proveniente de VERTICAL
    NoExpediente VARCHAR(50) REFERENCES cex_pacientes(NoExpediente) ON DELETE RESTRICT,
    FechaHoraCita TIMESTAMP NOT NULL,
    Medico VARCHAR(200),
    Especialidad VARCHAR(150),
    Consultorio VARCHAR(50),
    Estado VARCHAR(50) DEFAULT 'PROGRAMADA', -- 'PROGRAMADA', 'ASISTIDA', 'CANCELADA', 'NO_ASISTIO'
    Origen VARCHAR(20) DEFAULT 'LOCAL', -- 'VERTICAL' o 'LOCAL'
    Notas TEXT,
    ModificadoPor VARCHAR(100),
    FechaModificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cex_consultas (
    ConsultaId SERIAL PRIMARY KEY,
    CitaId INTEGER REFERENCES cex_citas(CitaId) ON DELETE CASCADE,
    NoExpediente VARCHAR(50) REFERENCES cex_pacientes(NoExpediente),
    SignosVitales JSONB,
    MotivoConsulta TEXT,
    Diagnostico TEXT,
    NotasAtencion TEXT,
    ProximaCita TIMESTAMP,
    Medico VARCHAR(200),
    RegistradoPor VARCHAR(100),
    FechaRegistro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cex_bitacora (
    BitacoraId SERIAL PRIMARY KEY,
    CitaId INTEGER REFERENCES cex_citas(CitaId) ON DELETE CASCADE,
    Accion VARCHAR(50) NOT NULL, -- 'CREACION', 'CAMBIO_ESTADO', 'EDICION', 'CANCELACION'
    EstadoAnterior VARCHAR(50),
    EstadoNuevo VARCHAR(50),
    Detalles TEXT,
    Usuario VARCHAR(100) NOT NULL,
    Fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices de búsqueda
CREATE INDEX IF NOT EXISTS idx_cex_citas_fecha ON cex_citas(FechaHoraCita);
CREATE INDEX IF NOT EXISTS idx_cex_citas_estado ON cex_citas(Estado);
CREATE INDEX IF NOT EXISTS idx_cex_citas_medico ON cex_citas(Medico);
CREATE INDEX IF NOT EXISTS idx_cex_pacientes_nombre ON cex_pacientes(NombreCompleto);
