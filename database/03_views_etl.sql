-- ═══════════════════════════════════════════════════════════════════
-- 03_views_etl.sql — Vistas para el módulo ETL de Auditoría (PostgreSQL)
-- Hospital Escandón BI v1.0
-- ═══════════════════════════════════════════════════════════════════

-- VISTA 1: Conciliación completa Inventarios vs. Cargos
CREATE OR REPLACE VIEW VW_ConciliacionInventarioCargos AS
SELECT
    ao.OrdenId,
    ao.PacienteId,
    p.NumeroExpediente,
    p.NombreCompleto                AS NombrePaciente,
    ao.AreaHospitalaria,
    ao.InsumoId,
    i.Descripcion                   AS Insumo,
    i.Categoria                     AS CategoriaInsumo,
    i.CodigoBarras,
    ao.CantidadSurtida              AS CantAlmacen,
    COALESCE(ce.CantidadCargada, 0) AS CantCargo,
    COALESCE(ce.CantidadCargada, 0) - ao.CantidadSurtida AS Diferencia,
    ao.PrecioUnitario,
    ABS(COALESCE(ce.CantidadCargada, 0) - ao.CantidadSurtida)
        * ao.PrecioUnitario         AS MontoDisputa,
    CASE
        WHEN ce.CantidadCargada IS NULL
            THEN 'FALTANTE'
        WHEN ce.CantidadCargada = ao.CantidadSurtida
            THEN 'COINCIDE'
        WHEN ce.CantidadCargada > ao.CantidadSurtida
            THEN 'EXCEDENTE'
        ELSE 'DIFERENCIA'
    END                             AS EstadoConciliacion,
    ao.EnfermeraReceptora,
    u.NombreCompleto                AS NombreEnfermera,
    ao.FechaSurtido
FROM AlmacenOrdenes ao
JOIN Pacientes p  ON p.PacienteId = ao.PacienteId
JOIN Insumos   i  ON i.InsumoId   = ao.InsumoId
LEFT JOIN CargosEnfermeria ce ON ce.OrdenAlmacenId = ao.OrdenId
LEFT JOIN Usuarios         u  ON u.UsuarioId       = ce.EnfermerId
WHERE ao.Estado = 'SURTIDA';

-- VISTA 2: KPIs de Ocupación en tiempo real
CREATE OR REPLACE VIEW VW_OcupacionCamasActual AS
SELECT
    c.Area,
    COUNT(*)                                                    AS TotalCamas,
    SUM(CASE WHEN c.Estado = 'OCUPADA'       THEN 1 ELSE 0 END) AS CamasOcupadas,
    SUM(CASE WHEN c.Estado = 'DISPONIBLE'    THEN 1 ELSE 0 END) AS CamasDisponibles,
    SUM(CASE WHEN c.Estado = 'MANTENIMIENTO' THEN 1 ELSE 0 END) AS CamasMantenimiento,
    ROUND(
        CAST(SUM(CASE WHEN c.Estado = 'OCUPADA' THEN 1 ELSE 0 END) AS NUMERIC)
        * 100.0 / GREATEST(COUNT(*), 1)
    , 2)                                                        AS PorcentajeOcupacion
FROM Camas c
WHERE c.Activo = 1
GROUP BY c.Area;

-- VISTA 3: Productividad por Área (Rotación + Estancia)
CREATE OR REPLACE VIEW VW_ProductividadPorArea AS
SELECT
    e.AreaEgreso                                            AS Area,
    COUNT(e.EgresoId)                                       AS EgresosMes,
    AVG((EXTRACT(EPOCH FROM e.FechaEgreso) - EXTRACT(EPOCH FROM a.FechaIngreso)) / 86400.0) AS EstanciaPromedioDias,
    (SELECT COUNT(*) FROM Camas cb WHERE cb.Area = e.AreaEgreso AND cb.Activo = 1) AS TotalCamas,
    ROUND(
        CAST(COUNT(e.EgresoId) AS NUMERIC)
        / GREATEST((SELECT COUNT(*) FROM Camas cb WHERE cb.Area = e.AreaEgreso AND cb.Activo = 1), 1)
    , 2)                                                    AS RotacionCamas
FROM Egresos e
JOIN Admisiones a ON a.AdmisionId = e.AdmisionId
WHERE e.FechaEgreso >= CURRENT_TIMESTAMP - INTERVAL '1 month'
GROUP BY e.AreaEgreso;

-- VISTA 4: Resumen de Discrepancias para Dashboard de Auditoría
CREATE OR REPLACE VIEW VW_ResumenDiscrepancias AS
SELECT
    AreaHospitalaria,
    COUNT(*)                                                            AS TotalPartidas,
    SUM(CASE WHEN EstadoConciliacion = 'COINCIDE'   THEN 1 ELSE 0 END) AS Coincidencias,
    SUM(CASE WHEN EstadoConciliacion != 'COINCIDE'  THEN 1 ELSE 0 END) AS Discrepancias,
    SUM(CASE WHEN EstadoConciliacion = 'FALTANTE'   THEN 1 ELSE 0 END) AS Faltantes,
    SUM(CASE WHEN EstadoConciliacion = 'EXCEDENTE'  THEN 1 ELSE 0 END) AS Excedentes,
    SUM(CASE WHEN EstadoConciliacion = 'DIFERENCIA' THEN 1 ELSE 0 END) AS Diferencias,
    COALESCE(SUM(MontoDisputa), 0)                                      AS MontoTotalDisputa,
    ROUND(
        CAST(SUM(CASE WHEN EstadoConciliacion = 'COINCIDE' THEN 1 ELSE 0 END) AS NUMERIC)
        * 100.0 / GREATEST(COUNT(*), 1)
    , 2)                                                                AS PorcentajeConciliado,
    MIN(FechaSurtido::date)                                             AS FechaDesde,
    MAX(FechaSurtido::date)                                             AS FechaHasta
FROM VW_ConciliacionInventarioCargos
WHERE FechaSurtido >= CURRENT_TIMESTAMP - INTERVAL '1 month'
GROUP BY AreaHospitalaria;