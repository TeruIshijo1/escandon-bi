-- ═══════════════════════════════════════════════════════════════════
-- 02_seed_roles.sql — Datos iniciales de Roles
-- Hospital Escandón BI v1.0 — SQLite 3
-- ═══════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO Roles (NombreRol, Descripcion, Nivel) VALUES
('ADMIN', 'Acceso total al sistema. Gestión de usuarios, auditoría completa y configuración.', 1);
INSERT OR IGNORE INTO Roles (NombreRol, Descripcion, Nivel) VALUES
('DIRECTOR', 'Dashboard de Mando con KPIs de Eficiencia, Eficacia y Macropanel Financiero.', 2);
INSERT OR IGNORE INTO Roles (NombreRol, Descripcion, Nivel) VALUES
('JEFE_AREA', 'Acceso restringido a su área hospitalaria asignada.', 3);
INSERT OR IGNORE INTO Roles (NombreRol, Descripcion, Nivel) VALUES
('USUARIO_OPERATIVO', 'Solo visualización y descarga básica de datos de su área.', 4);

-- El administrador inicial se crea desde backend/config/init-db.js únicamente
-- cuando SEED_ADMIN_PASSWORD está configurada en el archivo .env local.

-- Configuración BI
INSERT OR IGNORE INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('directivo-main','Dashboard Directivo — KPIs Globales','workspace-escandon-001','["ADMIN","DIRECTOR"]',NULL);
INSERT OR IGNORE INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('auditoria-inventarios','Auditoría — Inventarios vs. Cargos','workspace-escandon-001','["ADMIN","DIRECTOR"]',NULL);
INSERT OR IGNORE INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('area-quirofano','Tablero Quirófano','workspace-escandon-001','["ADMIN","DIRECTOR","JEFE_AREA","USUARIO_OPERATIVO"]','QUIROFANO');
INSERT OR IGNORE INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('area-uci','Tablero UCI','workspace-escandon-001','["ADMIN","DIRECTOR","JEFE_AREA","USUARIO_OPERATIVO"]','UCI');
INSERT OR IGNORE INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('area-urgencias','Tablero Urgencias','workspace-escandon-001','["ADMIN","DIRECTOR","JEFE_AREA","USUARIO_OPERATIVO"]','URGENCIAS');
INSERT OR IGNORE INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('area-cuneros','Tablero Cuneros','workspace-escandon-001','["ADMIN","DIRECTOR","JEFE_AREA","USUARIO_OPERATIVO"]','CUNEROS');
INSERT OR IGNORE INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('area-imagenologia','Tablero Imagenología','workspace-escandon-001','["ADMIN","DIRECTOR","JEFE_AREA","USUARIO_OPERATIVO"]','IMAGENOLOGIA');
