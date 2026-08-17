-- ═══════════════════════════════════════════════════════════════════
-- 02_seed_roles.sql — Datos iniciales de Roles (PostgreSQL)
-- Hospital Escandón BI v1.0
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO Roles (NombreRol, Descripcion, Nivel) VALUES
('ADMIN', 'Acceso total al sistema. Gestión de usuarios, auditoría completa y configuración.', 1)
ON CONFLICT (NombreRol) DO NOTHING;
INSERT INTO Roles (NombreRol, Descripcion, Nivel) VALUES
('DIRECTOR', 'Dashboard de Mando con KPIs de Eficiencia, Eficacia y Macropanel Financiero.', 2)
ON CONFLICT (NombreRol) DO NOTHING;
INSERT INTO Roles (NombreRol, Descripcion, Nivel) VALUES
('JEFE_AREA', 'Acceso restringido a su área hospitalaria asignada.', 3)
ON CONFLICT (NombreRol) DO NOTHING;
INSERT INTO Roles (NombreRol, Descripcion, Nivel) VALUES
('USUARIO_OPERATIVO', 'Solo visualización y descarga básica de datos de su área.', 4)
ON CONFLICT (NombreRol) DO NOTHING;
INSERT INTO Roles (NombreRol, Descripcion, Nivel) VALUES
('ALMACEN_GENERAL', 'Acceso operativo a inventario general y traslados SAP.', 4)
ON CONFLICT (NombreRol) DO NOTHING;

-- El administrador inicial se crea desde backend/config/init-db.js únicamente
-- cuando SEED_ADMIN_PASSWORD está configurada en el archivo .env local.

-- Configuración BI
INSERT INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('directivo-main','Dashboard Directivo — KPIs Globales','workspace-escandon-001','["ADMIN","DIRECTOR"]',NULL)
ON CONFLICT (ReporteId) DO NOTHING;
INSERT INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('auditoria-inventarios','Auditoría — Inventarios vs. Cargos','workspace-escandon-001','["ADMIN","DIRECTOR"]',NULL)
ON CONFLICT (ReporteId) DO NOTHING;
INSERT INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('area-quirofano','Tablero Quirófano','workspace-escandon-001','["ADMIN","DIRECTOR","JEFE_AREA","USUARIO_OPERATIVO"]','QUIROFANO')
ON CONFLICT (ReporteId) DO NOTHING;
INSERT INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('area-uci','Tablero UCI','workspace-escandon-001','["ADMIN","DIRECTOR","JEFE_AREA","USUARIO_OPERATIVO"]','UCI')
ON CONFLICT (ReporteId) DO NOTHING;
INSERT INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('area-urgencias','Tablero Urgencias','workspace-escandon-001','["ADMIN","DIRECTOR","JEFE_AREA","USUARIO_OPERATIVO"]','URGENCIAS')
ON CONFLICT (ReporteId) DO NOTHING;
INSERT INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('area-cuneros','Tablero Cuneros','workspace-escandon-001','["ADMIN","DIRECTOR","JEFE_AREA","USUARIO_OPERATIVO"]','CUNEROS')
ON CONFLICT (ReporteId) DO NOTHING;
INSERT INTO ConfiguracionBI (ReporteId, Titulo, PowerBIWorkspace, RolesPermitidos, AreaRequerida) VALUES
('area-imagenologia','Tablero Imagenología','workspace-escandon-001','["ADMIN","DIRECTOR","JEFE_AREA","USUARIO_OPERATIVO"]','IMAGENOLOGIA')
ON CONFLICT (ReporteId) DO NOTHING;