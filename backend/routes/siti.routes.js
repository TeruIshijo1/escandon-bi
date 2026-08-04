const express = require('express');
const router = express.Router();
const { querySiti } = require('../config/siti-api');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Middleware simple de logger
router.use((req, res, next) => {
  console.log(`[SITI Route] ${req.method} ${req.url}`);
  next();
});

/* ── Todas las rutas SITI requieren ADMIN o DIRECTOR ──────── */
router.use(authenticate, authorize(['ADMIN', 'DIRECTOR']));

/**
 * GET /api/siti/financiero
 * Obtiene métricas financieras (Ingresos, Costos, Utilidad) del historial SITI (2010 - 2017)
 */
router.get('/financiero', async (req, res) => {
  try {
    const sitiRes = await querySiti(`
      SELECT 
        EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Yr", 
        EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd",
        SUM(CAST(L."PrecioFinal" AS FLOAT)) as ingresos,
        SUM(CAST(L."Costo" AS FLOAT)) as costos,
        COUNT(DISTINCT H."NoAno" || '-' || H."NoCtaH") as volumen
      FROM "CtaH" H
      JOIN "CtaHLn" L ON H."NoAno" = L."NoAno" AND H."NoCtaH" = L."NoCtaH"
      WHERE H."FechaIng" != '' AND H."FechaIng" IS NOT NULL
        AND EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) <= 2026
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    
    let tendencia = [];
    if (sitiRes && sitiRes.data) {
      tendencia = sitiRes.data
        .filter(r => r.Yr && r.Prd)
        .map(row => {
          const mStr = row.Yr + '-' + String(row.Prd).padStart(2, '0');
          const ing = row.ingresos || 0;
          const cos = row.costos || 0;
          return {
            month: mStr,
            Ingresos: ing,
            Costos: cos,
            Utilidad: (ing - cos),
            VolumenCuentas: parseInt(row.volumen || 0)
          };
        });
    }

    res.json({
      success: true,
      tendenciaMensual: tendencia
    });

  } catch (error) {
    console.error("Error en /api/siti/financiero:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/siti/pacientes
 * Obtiene altas y demográficos históricos por año/mes
 */
router.get('/pacientes', async (req, res) => {
  try {
    const pRes = await querySiti(`
      SELECT 
        EXTRACT(YEAR FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) AS "Yr", 
        EXTRACT(MONTH FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) AS "Prd",
        "Sexo",
        COUNT(*) as conteo
      FROM "Paciente"
      WHERE "FechaRegistro" != '' AND "FechaRegistro" IS NOT NULL
      GROUP BY 1, 2, 3
      ORDER BY 1, 2
    `);

    let demograficos = {};
    if (pRes && pRes.data) {
      pRes.data.forEach(row => {
        if (!row.Yr || !row.Prd) return;
        const mStr = row.Yr + '-' + String(row.Prd).padStart(2, '0');
        if (!demograficos[mStr]) demograficos[mStr] = { month: mStr, hombres: 0, mujeres: 0, total: 0 };
        
        const count = parseInt(row.conteo || 0);
        demograficos[mStr].total += count;
        if (row.Sexo === 'True' || row.Sexo === true) {
          demograficos[mStr].hombres += count; // Suposición: True = Hombre
        } else {
          demograficos[mStr].mujeres += count;
        }
      });
    }

    res.json({
      success: true,
      tendenciaPacientes: Object.values(demograficos).sort((a,b) => a.month.localeCompare(b.month))
    });

  } catch(error) {
    console.error("Error en /api/siti/pacientes:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/siti/cirugias
 * Obtiene estadísticas de cirugías del historial SITI (2010 - 2026)
 */
router.get('/cirugias', async (req, res) => {
  try {
    // 1. Tendencia anual de volumen e ingresos de cirugías
    const tendenciaRes = await querySiti(`
      SELECT 
        EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Yr", 
        EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd",
        COUNT(DISTINCT H."NoAno" || '-' || H."NoCtaH") as "volumen",
        SUM(CAST(L."MontoLinea" AS FLOAT)) as "ingresos"
      FROM "CtaHLn" L
      JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
      JOIN "Producto" P ON L."NoProd" = P."NoProd"
      WHERE P."CodTipo" LIKE 'CX%'
        AND H."FechaIng" != '' AND H."FechaIng" IS NOT NULL
        AND H."Estatus" != 'C'
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    
    // 2. Top Cirugías (Procedimientos)
    const topCxRes = await querySiti(`
      SELECT 
        P."Descripcion" as "procedimiento",
        COUNT(L."NoLinea") as "cantidad",
        SUM(CAST(L."MontoLinea" AS FLOAT)) as "ingresos"
      FROM "CtaHLn" L
      JOIN "Producto" P ON L."NoProd" = P."NoProd"
      WHERE P."CodTipo" LIKE 'CX%'
      GROUP BY P."Descripcion"
      ORDER BY 2 DESC
      LIMIT 10
    `);

    // 3. Top Médicos (Cuentas x Médico)
    const topMedRes = await querySiti(`
      SELECT 
        COALESCE(M."Nombre" || ' ' || M."ApePat" || ' ' || M."ApeMat", H."MedicoTratante") as "medico",
        COUNT(H."NoCtaH") as "volumen",
        SUM(CAST(H."MontoCargos" AS FLOAT)) as "honorarios"
      FROM "CtaH" H
      LEFT JOIN "Medico" M ON TRIM(H."MedicoTratante") = TRIM(M."CodMedico")
      WHERE H."MedicoTratante" != '' AND H."Estatus" != 'C'
      GROUP BY M."Nombre", M."ApePat", M."ApeMat", H."MedicoTratante"
      ORDER BY 3 DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      tendenciaAnual: tendenciaRes.data || [],
      topCirugias: topCxRes.data || [],
      topMedicos: topMedRes.data || []
    });

  } catch(error) {
    console.error("Error en /api/siti/cirugias:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/siti/auxiliares/:tipo
 * Obtiene estadísticas de auxiliares de diagnóstico del historial SITI (2010 - 2026)
 * :tipo puede ser 'laboratorio' o 'imagenologia'
 */
router.get('/auxiliares/:tipo', async (req, res) => {
  try {
    const { tipo } = req.params;
    let typeFilter = '';
    
    if (tipo === 'laboratorio') {
      typeFilter = `(P."CodTipo" = 'ESTLAB' OR L."CodAlm" ILIKE '%LAB%')`;
    } else if (tipo === 'imagenologia') {
      typeFilter = `(P."CodTipo" = 'ESTIMA' OR L."CodAlm" ILIKE '%IMA%' OR L."CodAlm" ILIKE '%RAYO%')`;
    } else if (tipo === 'farmacia') {
      typeFilter = `(L."CodAlm" ILIKE '%FARM%' OR P."CodTipo" LIKE 'FAR%')`;
    } else if (tipo === 'urgencias') {
      typeFilter = `(L."CodAlm" ILIKE '%ADMCON%' OR L."CodAlm" ILIKE '%ADMON%' OR L."CodAlm" ILIKE '%ADMRES%')`;
    } else if (tipo === 'hospitalizacion') {
      typeFilter = `(L."CodAlm" ILIKE '%PPA%' OR L."CodAlm" ILIKE '%PPB%')`;
    } else if (tipo === 'terapia') {
      typeFilter = `(L."NoProd" IN ('SER501', 'SER600', 'SER710', 'SER730') OR L."CodAlm" ILIKE '%TERAPI%' OR L."CodAlm" ILIKE '%TERINT%')`;
    } else if (tipo === 'uso_qx') {
      typeFilter = `L."NoProd" = 'USOQX1HR'`;
    } else if (tipo === 'consultas') {
      typeFilter = `(P."CodTipo" ILIKE '%CONS%' OR L."CodAlm" ILIKE '%CONS%')`;
    } else if (tipo === 'endoscopia') {
      typeFilter = `(P."Descripcion" ILIKE '%ENDOSCOP%' OR P."Descripcion" ILIKE '%COLONOSCOP%' OR P."Descripcion" ILIKE '%BRONCOSCOP%')`;
    } else if (tipo === 'vidas_salvadas') {
      typeFilter = `L."NoProd" = 'USOSALCHO'`;
    } else if (tipo === 'nacimientos') {
      typeFilter = `(L."NoProd" LIKE 'CX-37%' OR L."NoProd" LIKE 'CX-34%')`;
    } else {
      return res.status(400).json({ success: false, error: 'Tipo inválido.' });
    }

    let countExpression = 'COUNT(DISTINCT H."NoAno" || \'-\' || H."NoCtaH")';
    if (['laboratorio', 'imagenologia', 'farmacia', 'consultas', 'nacimientos'].includes(tipo)) {
      countExpression = 'COUNT(L."NoLinea")';
    }

    let tendenciaAnualFinal = [];
    let topEstudiosFinal = [];

    if (tipo === 'imagenologia' || tipo === 'laboratorio') {
      let kdxFilter = tipo === 'laboratorio' ? "\"CodTransCaja\" = 'LAB100'" : "\"CodTransCaja\" = 'IMA100'";
      let hospFilter = tipo === 'laboratorio' 
        ? "(P.\"CodTipo\" = 'ESTLAB' OR L.\"CodAlm\" ILIKE '%LAB%')"
        : "(P.\"CodTipo\" = 'ESTIMA' OR L.\"CodAlm\" ILIKE '%IMA%' OR L.\"CodAlm\" ILIKE '%RAYO%')";

      // 1. AMBULATORIO (Cobros reales de Caja)
      const resAmb = await querySiti(`
        SELECT 
            EXTRACT(YEAR FROM TO_DATE(SUBSTRING("FechaTrans" FROM 1 FOR 10), 'DD/MM/YYYY')) AS "Yr",
            EXTRACT(MONTH FROM TO_DATE(SUBSTRING("FechaTrans" FROM 1 FOR 10), 'DD/MM/YYYY')) AS "Prd",
            COUNT(*) AS "volumen",
            SUM(CAST(NULLIF("MontoTotal", '') AS NUMERIC)) AS "ingresos"
        FROM "KdxCajaDet"
        WHERE ${kdxFilter}
          AND "FechaTrans" != '' AND "FechaTrans" IS NOT NULL
        GROUP BY 1, 2
      `);

      // 2. HOSPITALIZADOS (Cargos reales de Cuentas)
      const resHosp = await querySiti(`
        SELECT 
          EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Yr", 
          EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd",
          COUNT(L."NoLinea") as "volumen",
          SUM(CAST(NULLIF(L."MontoLinea", '') AS NUMERIC)) as "ingresos"
        FROM "CtaHLn" L
        JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
        LEFT JOIN "Producto" P ON L."NoProd" = P."NoProd"
        WHERE ${hospFilter}
          AND H."FechaIng" != '' AND H."FechaIng" IS NOT NULL
          AND H."Estatus" != 'C'
        GROUP BY 1, 2
      `);

      // Unir datos de ambas puertas (Caja + Hospital)
      let dict = {};
      const processRes = (res) => {
        if (res && res.data) {
          res.data.forEach(row => {
            if (!row.Yr || !row.Prd) return;
            const mStr = row.Yr + '-' + String(row.Prd).padStart(2, '0');
            if (!dict[mStr]) dict[mStr] = { month: mStr, Yr: parseInt(row.Yr), Prd: parseInt(row.Prd), volumen: 0, ingresos: 0 };
            dict[mStr].volumen += parseInt(row.volumen || 0);
            dict[mStr].ingresos += parseFloat(row.ingresos || 0);
          });
        }
      };

      processRes(resAmb);
      processRes(resHosp);
      tendenciaAnualFinal = Object.values(dict).sort((a,b) => a.month.localeCompare(b.month));

      // 3. Top Estudios Técnico (Este sí lo sacamos de OsMedEst para saber el nombre de los procedimientos más populares)
      const topEstudiosFilter = tipo === 'imagenologia' ? "EM.\"CodTipoEstuMed\" LIKE 'IM%'" : "EM.\"CodTipoEstuMed\" LIKE 'LAB%'";
      const topEstudiosRes = await querySiti(`
        SELECT 
          EM."Descripcion" as "procedimiento",
          COUNT(*) as "cantidad"
        FROM "OsMedEst" E
        JOIN "EstuMed" EM ON E."CodEstudio" = EM."CodEstudio"
        JOIN "OsMed" O ON E."NoOsMed" = O."NoOsMed" AND E."InEntity" = O."InEntity"
        WHERE ${topEstudiosFilter}
          AND E."Fecha" != '' AND E."Fecha" IS NOT NULL
        GROUP BY EM."Descripcion"
        ORDER BY 2 DESC
        LIMIT 10
      `);
      topEstudiosFinal = topEstudiosRes.data || [];

    } else {
      // Lógica para Farmacia, Consultas, etc.
      const tendenciaRes = await querySiti(`
        SELECT 
          EXTRACT(YEAR FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Yr", 
          EXTRACT(MONTH FROM TO_DATE(H."FechaIng", 'DD/MM/YYYY')) AS "Prd",
          ${countExpression} as "volumen",
          SUM(CAST(NULLIF(L."MontoLinea", '') AS NUMERIC)) as "ingresos"
        FROM "CtaHLn" L
        JOIN "CtaH" H ON L."NoAno" = H."NoAno" AND L."NoCtaH" = H."NoCtaH"
        LEFT JOIN "Producto" P ON L."NoProd" = P."NoProd"
        WHERE ${typeFilter}
          AND H."FechaIng" != '' AND H."FechaIng" IS NOT NULL
          AND H."Estatus" != 'C'
        GROUP BY 1, 2
        ORDER BY 1, 2
      `);
      
      if (tendenciaRes && tendenciaRes.data) {
        tendenciaAnualFinal = tendenciaRes.data
          .filter(r => r.Yr && r.Prd)
          .map(row => {
            return {
              month: row.Yr + '-' + String(row.Prd).padStart(2, '0'),
              Yr: parseInt(row.Yr),
              Prd: parseInt(row.Prd),
              volumen: parseInt(row.volumen || 0),
              ingresos: parseFloat(row.ingresos || 0)
            };
          });
      }

      const topEstudiosRes = await querySiti(`
        SELECT 
          COALESCE(P."Descripcion", L."NoProd") as "procedimiento",
          COUNT(L."NoLinea") as "cantidad",
          SUM(CAST(NULLIF(L."MontoLinea", '') AS NUMERIC)) as "ingresos"
        FROM "CtaHLn" L
        LEFT JOIN "Producto" P ON L."NoProd" = P."NoProd"
        WHERE ${typeFilter}
        GROUP BY COALESCE(P."Descripcion", L."NoProd")
        ORDER BY 2 DESC
        LIMIT 10
      `);
      topEstudiosFinal = topEstudiosRes.data || [];
    }

    res.json({
      success: true,
      tendenciaAnual: tendenciaAnualFinal,
      topEstudios: topEstudiosFinal
    });

  } catch(error) {
    console.error("Error en /api/siti/auxiliares:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/siti/pacientes
 * Obtiene demografía y epidemiología (Edades, Género, Motivos de Ingreso)
 */
router.get('/pacientes-demografia', async (req, res) => {
  try {
    // Top Motivos de Ingreso
    const topMotivos = await querySiti(`
      SELECT 
        "MotivoIng" as motivo,
        COUNT(*) as cantidad
      FROM "CtaH"
      WHERE "MotivoIng" IS NOT NULL AND "MotivoIng" != ''
      GROUP BY "MotivoIng"
      ORDER BY 2 DESC
      LIMIT 10
    `);

    // Distribución por Género
    const generoRes = await querySiti(`
      SELECT 
        UPPER(TRIM("Sexo")) as genero,
        COUNT(DISTINCT "NoPaciente") as cantidad
      FROM "Paciente"
      WHERE "Sexo" IS NOT NULL AND "Sexo" != ''
      GROUP BY 1
      ORDER BY 2 DESC
    `);

    // Resumen General
    const resumenRes = await querySiti(`
      SELECT 
        COUNT(DISTINCT "NoPaciente") as pacientes_unicos,
        COUNT("NoCtaH") as total_admisiones
      FROM "CtaH"
    `);

    // Nuevos vs Recurrentes
    const retencionRes = await querySiti(`
      WITH ConteoPacientes AS (
        SELECT "NoPaciente", COUNT("NoCtaH") as admisiones
        FROM "CtaH"
        WHERE "NoPaciente" IS NOT NULL AND "NoPaciente" != ''
        GROUP BY "NoPaciente"
      )
      SELECT 
        SUM(CASE WHEN admisiones = 1 THEN 1 ELSE 0 END) as pacientes_nuevos,
        SUM(CASE WHEN admisiones > 1 THEN 1 ELSE 0 END) as pacientes_recurrentes
      FROM ConteoPacientes
    `);

    res.json({
      success: true,
      topMotivos: topMotivos.data || [],
      genero: generoRes.data || [],
      resumen: (resumenRes.data && resumenRes.data[0]) || { pacientes_unicos: 0, total_admisiones: 0 },
      retencion: (retencionRes.data && retencionRes.data[0]) || { pacientes_nuevos: 0, pacientes_recurrentes: 0 }
    });
  } catch(error) {
    console.error("Error en /api/siti/pacientes:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/siti/medicos
 * Obtiene productividad por médico tratante
 */
router.get('/medicos', async (req, res) => {
  try {
    const { year } = req.query;
    let yearFilter = '';
    
    if (year && year !== 'Todos' && year !== 'Histórico' && year !== '') {
      yearFilter = `AND EXTRACT(YEAR FROM TO_DATE("FechaIng", 'DD/MM/YYYY')) = ${parseInt(year)}`;
    }

    const topMedicos = await querySiti(`
      SELECT 
        COALESCE("MedicoTratante", 'No Especificado') as medico,
        COUNT(DISTINCT "NoAno" || '-' || "NoCtaH") as pacientes_ingresados,
        SUM(CAST(COALESCE("MontoCargos", '0') AS FLOAT)) as ingresos_generados
      FROM "CtaH"
      WHERE "FechaIng" != '' AND "FechaIng" IS NOT NULL
        AND "MedicoTratante" != '' AND "MedicoTratante" IS NOT NULL
        ${yearFilter}
      GROUP BY 1
      ORDER BY 3 DESC
      LIMIT 15
    `);

    // Resumen General
    const resumenRes = await querySiti(`
      SELECT 
        COUNT(DISTINCT "MedicoTratante") as total_medicos,
        SUM(CAST(COALESCE("MontoCargos", '0') AS FLOAT)) / NULLIF(COUNT(DISTINCT "MedicoTratante"), 0) as promedio_ingreso_medico
      FROM "CtaH"
      WHERE "MedicoTratante" != '' AND "MedicoTratante" IS NOT NULL
        AND "FechaIng" != '' AND "FechaIng" IS NOT NULL
        ${yearFilter}
    `);

    res.json({
      success: true,
      topMedicos: topMedicos.data || [],
      resumen: (resumenRes.data && resumenRes.data[0]) || { total_medicos: 0, promedio_ingreso_medico: 0 }
    });
  } catch(error) {
    console.error("Error en /api/siti/medicos:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 8. Demografía / Geografía
// ==========================================
router.get(
  '/demografia',
  async (req, res, next) => {
    try {
      // Agrupar por Estado
      const estadosRes = await querySiti(`
        SELECT 
          "DomCodEstado" as estado,
          COUNT(*) as cantidad
        FROM "Paciente"
        WHERE "DomCodEstado" IS NOT NULL AND "DomCodEstado" != ''
        GROUP BY "DomCodEstado"
        ORDER BY cantidad DESC
        LIMIT 10
      `);

      // Agrupar por Alcaldía / Ciudad
      const ciudadesRes = await querySiti(`
        SELECT 
          "DomCodCiudad" as ciudad,
          COUNT(*) as cantidad
        FROM "Paciente"
        WHERE "DomCodCiudad" IS NOT NULL AND "DomCodCiudad" != ''
        GROUP BY "DomCodCiudad"
        ORDER BY cantidad DESC
        LIMIT 15
      `);

      res.json({
        success: true,
        estados: estadosRes.data || [],
        ciudades: ciudadesRes.data || []
      });
    } catch(error) {
      console.error("Error en /api/siti/demografia:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /api/siti/imagen-detalle
 * Query IMG SITI: Detalle de estudios de imagenología (precios, cantidades, totales)
 */
router.get('/imagen-detalle', async (req, res) => {
  try {
    const query = `
      SELECT 
          e."CodEstudio" AS codestudio,
          e."DescCorta" AS desccorta,
          e."Descripcion" AS descripcion,
          SPLIT_PART(p."Precio", ';', 1)::numeric AS precio,
          COALESCE(vent.cantidad, 0) AS estudiosreal,
          SPLIT_PART(p."Precio", ';', 1)::numeric * COALESCE(vent.cantidad, 0) AS mtototal,
          COALESCE(vent.total, 0) AS mtoventas
      FROM "EstuMed" e
      JOIN "EstuMedLn" el ON e."CodEstudio" = el."CodEstudio" AND el."NoLinea" = '1'
      JOIN "ProdAlmPrecio" p ON el."NoProd" = p."NoProd"
      LEFT JOIN (
          SELECT o."CodEstudio", 
                 SUM(NULLIF(l."Qty", '')::numeric) AS cantidad,
                 SUM(NULLIF(l."MontoLinea", '')::numeric) AS total
          FROM "OsMedEst" o
          JOIN "OsMedLn" l ON o."NoOsMed" = l."NoOsMed" AND o."NoLinea" = l."NoLinea"
          JOIN "OsMed" om ON o."NoOsMed" = om."NoOsMed"
          WHERE o."FechaCita" LIKE '%/2020%'
            AND om."Pagado" != 'N'
          GROUP BY o."CodEstudio"
      ) vent ON e."CodEstudio" = vent."CodEstudio"
      WHERE e."CodEstudio" LIKE 'IMA%'
        AND COALESCE(vent.cantidad, 0) > 0
      ORDER BY e."CodEstudio";
    `;
    const result = await querySiti(query);
    res.json({
      success: true,
      data: result.data || []
    });
  } catch (error) {
    console.error("Error en /api/siti/imagen-detalle:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
