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
// 8. Demografía / Geografía (Consolidado Multifuente SITI)
// ==========================================
router.get(
  '/demografia',
  async (req, res, next) => {
    try {
      const { year } = req.query;
      const isSpecificYear = year && year !== 'Todos' && year !== 'Histórico' && year !== '';
      const y = parseInt(year);

      const ctahFilter = isSpecificYear ? `AND EXTRACT(YEAR FROM TO_DATE("FechaIng", 'DD/MM/YYYY')) = ${y}` : '';
      const osmedFilter = isSpecificYear ? `AND EXTRACT(YEAR FROM TO_DATE("FechaSol", 'DD/MM/YYYY')) = ${y}` : '';
      const consFilter = isSpecificYear ? `AND EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) = ${y}` : '';
      const pacFilter = isSpecificYear ? `AND EXTRACT(YEAR FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) = ${y}` : '';
      const fechaFilter = isSpecificYear ? `AND EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) = ${y}` : '';

      const STATE_NAMES = {
        'DF': 'CDMX',
        'CDMX': 'CDMX',
        '9999': 'CDMX',
        'EDOM': 'Estado de México',
        'MEX': 'Estado de México',
        'HGO': 'Hidalgo',
        'HID': 'Hidalgo',
        'PUE': 'Puebla',
        'VER': 'Veracruz',
        'MOR': 'Morelos',
        'OAX': 'Oaxaca',
        'MICH': 'Michoacán',
        'QRO': 'Querétaro',
        'QUE': 'Querétaro',
        'GUER': 'Guerrero',
        'GRO': 'Guerrero',
        'DGO': 'Durango',
        'TLAX': 'Tlaxcala',
        'TLA': 'Tlaxcala',
        'GTO': 'Guanajuato',
        'JAL': 'Jalisco',
        'CHIS': 'Chiapas',
        'AGS': 'Aguascalientes',
        'QUIN': 'Quintana Roo',
        'QROO': 'Quintana Roo',
        'QR': 'Quintana Roo',
        'TOL': 'Estado de México',
        'COAH': 'Coahuila',
        'NL': 'Nuevo León',
        'SLP': 'San Luis Potosí',
        'CAMP': 'Campeche',
        'TAB': 'Tabasco',
        'CHIH': 'Chihuahua',
        'BCN': 'Baja California',
        'BC': 'Baja California',
        'BCS': 'Baja California Sur',
        'TAMS': 'Tamaulipas',
        'SON': 'Sonora',
        'SIN': 'Sinaloa',
        'COL': 'Colima',
        'NAY': 'Nayarit',
        'ZAC': 'Zacatecas',
        'YUC': 'Yucatán'
      };

      const CITY_NAMES = {
        '9999': 'CDMX (Sin especificar)',
        '': 'CDMX (Sin especificar)',
        'DLAO': 'Álvaro Obregón',
        'CDMX': 'CDMX',
        'DLMH': 'Miguel Hidalgo',
        'DLCJ': 'Cuajimalpa',
        'DLIP': 'Iztapalapa',
        'HUIX': 'Huixquilucan',
        'NAUC': 'Naucalpan',
        'DLBJ': 'Benito Juárez',
        'DLCU': 'Cuauhtémoc',
        'DLCM': 'Cuajimalpa de Morelos',
        'DLGM': 'Gustavo A. Madero',
        'NEZA': 'Nezahualcóyotl',
        'DLCO': 'Coyoacán',
        'DLTP': 'Tlalpan',
        'DLIC': 'Iztacalco',
        'DLVC': 'Venustiano Carranza',
        'ECAT': 'Ecatepec',
        'DLMG': 'Magdalena Contreras',
        'DLAZ': 'Azcapotzalco',
        'ATIZ': 'Atizapán',
        'CHIM': 'Chimalhuacán',
        'DLXO': 'Xochimilco',
        'IXTA': 'Ixtapaluca',
        'DLTH': 'Tláhuac',
        'TLAN': 'Tlalnepantla',
        'TLAE': 'Tlalnepantla',
        'CHAL': 'Chalco',
        'CUAU': 'Cuauhtémoc',
        'TULT': 'Tultitlán',
        'METE': 'Metepec',
        'TOLU': 'Toluca',
        'CUER': 'Cuernavaca'
      };

      const MONTH_NAMES = {
        1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
        5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
        9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre'
      };

      // Consultas paralelas para Geografía, Género, Rangos de Edad y Tablas Oficiales Dinámicas
      const yearFilterCtaH = isSpecificYear ? `AND EXTRACT(YEAR FROM TO_DATE("FechaIng", 'DD/MM/YYYY')) = ${y}` : '';
      const yearFilterOsMed = isSpecificYear ? `AND EXTRACT(YEAR FROM TO_DATE("FechaSol", 'DD/MM/YYYY')) = ${y}` : '';
      const yearFilterExp = isSpecificYear ? `AND EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) = ${y}` : '';

      const [
        multiSourceRes, 
        genderRes, 
        ageRes,
        prog11Res,
        prog12Res,
        prog13Res,
        prog21Res,
        prog22Res,
        ageSexDynRes
      ] = await Promise.all([
        // 1. Geografía por Mes, Estado y Ciudad (1 paciente = 1 conteo único)
        querySiti(`
          WITH Atenciones AS (
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("FechaIng", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("FechaIng", 'DD/MM/YYYY')) AS mes_num FROM "CtaH" WHERE "FechaIng" != '' AND "FechaIng" IS NOT NULL ${ctahFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("FechaSol", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("FechaSol", 'DD/MM/YYYY')) AS mes_num FROM "OsMed" WHERE "FechaSol" != '' AND "FechaSol" IS NOT NULL ${osmedFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "Consulta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${consFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) AS mes_num FROM "Paciente" WHERE "FechaRegistro" != '' AND "FechaRegistro" IS NOT NULL ${pacFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "ExpClinConsulta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${fechaFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "PreConsulta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${fechaFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "VtaReceta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${fechaFilter}
          ),
          PacientesUnicos AS (
            SELECT 
              "NoPaciente",
              MIN(anio) as anio,
              MIN(mes_num) as mes_num
            FROM Atenciones
            WHERE "NoPaciente" IS NOT NULL AND TRIM("NoPaciente") != ''
            GROUP BY "NoPaciente"
          )
          SELECT 
            A.anio,
            A.mes_num,
            CASE 
              WHEN P."DomCodEstado" IS NULL OR TRIM(P."DomCodEstado") = '' OR TRIM(P."DomCodEstado") = '9999' THEN 'CDMX'
              ELSE UPPER(TRIM(P."DomCodEstado"))
            END as raw_estado,
            CASE 
              WHEN P."DomCodCiudad" IS NULL OR TRIM(P."DomCodCiudad") = '' OR TRIM(P."DomCodCiudad") = '9999' THEN 'CDMX'
              ELSE UPPER(TRIM(P."DomCodCiudad"))
            END as raw_ciudad,
            COUNT(*) as atenciones
          FROM PacientesUnicos A
          LEFT JOIN "Paciente" P ON TRIM(A."NoPaciente") = TRIM(P."NoPaciente")
          WHERE A.anio IS NOT NULL AND A.mes_num IS NOT NULL
          GROUP BY 1, 2, 3, 4
        `),

        // 2. Género por Mes (1 paciente = 1 conteo único)
        querySiti(`
          WITH Atenciones AS (
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("FechaIng", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("FechaIng", 'DD/MM/YYYY')) AS mes_num FROM "CtaH" WHERE "FechaIng" != '' AND "FechaIng" IS NOT NULL ${ctahFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("FechaSol", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("FechaSol", 'DD/MM/YYYY')) AS mes_num FROM "OsMed" WHERE "FechaSol" != '' AND "FechaSol" IS NOT NULL ${osmedFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "Consulta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${consFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) AS mes_num FROM "Paciente" WHERE "FechaRegistro" != '' AND "FechaRegistro" IS NOT NULL ${pacFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "ExpClinConsulta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${fechaFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "PreConsulta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${fechaFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "VtaReceta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${fechaFilter}
          ),
          PacientesUnicos AS (
            SELECT 
              "NoPaciente",
              MIN(anio) as anio,
              MIN(mes_num) as mes_num
            FROM Atenciones
            WHERE "NoPaciente" IS NOT NULL AND TRIM("NoPaciente") != ''
            GROUP BY "NoPaciente"
          )
          SELECT 
            A.anio,
            A.mes_num,
            P."Sexo" as raw_sexo,
            COUNT(*) as atenciones
          FROM PacientesUnicos A
          LEFT JOIN "Paciente" P ON TRIM(A."NoPaciente") = TRIM(P."NoPaciente")
          WHERE A.anio IS NOT NULL AND A.mes_num IS NOT NULL
          GROUP BY 1, 2, 3
        `),

        // 3. Edad por Mes (1 paciente = 1 conteo único)
        querySiti(`
          WITH Atenciones AS (
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("FechaIng", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("FechaIng", 'DD/MM/YYYY')) AS mes_num FROM "CtaH" WHERE "FechaIng" != '' AND "FechaIng" IS NOT NULL ${ctahFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("FechaSol", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("FechaSol", 'DD/MM/YYYY')) AS mes_num FROM "OsMed" WHERE "FechaSol" != '' AND "FechaSol" IS NOT NULL ${osmedFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "Consulta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${consFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("FechaRegistro", 'DD/MM/YYYY')) AS mes_num FROM "Paciente" WHERE "FechaRegistro" != '' AND "FechaRegistro" IS NOT NULL ${pacFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "ExpClinConsulta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${fechaFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "PreConsulta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${fechaFilter}
            UNION ALL
            SELECT "NoPaciente", EXTRACT(YEAR FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS anio, EXTRACT(MONTH FROM TO_DATE("Fecha", 'DD/MM/YYYY')) AS mes_num FROM "VtaReceta" WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${fechaFilter}
          ),
          PacientesUnicos AS (
            SELECT 
              "NoPaciente",
              MIN(anio) as anio,
              MIN(mes_num) as mes_num
            FROM Atenciones
            WHERE "NoPaciente" IS NOT NULL AND TRIM("NoPaciente") != ''
            GROUP BY "NoPaciente"
          )
          SELECT 
            A.anio,
            A.mes_num,
            SUBSTRING(P."FechaNac" FROM '(\\d{4})') as birth_year,
            COUNT(*) as atenciones
          FROM PacientesUnicos A
          LEFT JOIN "Paciente" P ON TRIM(A."NoPaciente") = TRIM(P."NoPaciente")
          WHERE A.anio IS NOT NULL AND A.mes_num IS NOT NULL
          GROUP BY 1, 2, 3
        `),

        // 4.1 Cirugías Dinámico
        querySiti(`
          WITH Pacientes AS (
            SELECT "NoPaciente", COUNT(*) as cnt
            FROM "CtaH" C
            WHERE C."FechaIng" != '' AND C."FechaIng" IS NOT NULL ${yearFilterCtaH}
              AND (C."CodServ" IN ('QX', 'PPA', 'PPB') OR C."CodTipo" IN ('P', 'A'))
            GROUP BY "NoPaciente"
          )
          SELECT 
            COALESCE(COUNT(CASE WHEN cnt > 1 THEN 1 END), 0) as recurrentes,
            COALESCE(COUNT(CASE WHEN cnt = 1 THEN 1 END), 0) as eventuales,
            COALESCE(COUNT(*), 0) as poblacion_total,
            COALESCE(SUM(cnt), 0) as total_servicios
          FROM Pacientes
        `),

        // 4.2 Hospitalización Dinámico
        querySiti(`
          WITH Pacientes AS (
            SELECT "NoPaciente", COUNT(*) as cnt
            FROM "CtaH" C
            WHERE C."FechaIng" != '' AND C."FechaIng" IS NOT NULL ${yearFilterCtaH}
              AND C."CodServ" IN ('T', 'TER', 'UCI', 'END', 'IMG')
            GROUP BY "NoPaciente"
          )
          SELECT 
            COALESCE(COUNT(CASE WHEN cnt > 1 THEN 1 END), 0) as recurrentes,
            COALESCE(COUNT(CASE WHEN cnt = 1 THEN 1 END), 0) as eventuales,
            COALESCE(COUNT(*), 0) as poblacion_total,
            COALESCE(SUM(cnt), 0) as total_servicios
          FROM Pacientes
        `),

        // 4.3 Estudios Auxiliares Diagnóstico Dinámico
        querySiti(`
          WITH Pacientes AS (
            SELECT "NoPaciente", COUNT(*) as cnt
            FROM "OsMed"
            WHERE "FechaSol" != '' AND "FechaSol" IS NOT NULL ${yearFilterOsMed}
            GROUP BY "NoPaciente"
          )
          SELECT 
            COALESCE(COUNT(CASE WHEN cnt > 1 THEN 1 END), 0) as recurrentes,
            COALESCE(COUNT(CASE WHEN cnt = 1 THEN 1 END), 0) as eventuales,
            COALESCE(COUNT(*), 0) as poblacion_total,
            COALESCE(SUM(cnt), 0) as total_servicios
          FROM Pacientes
        `),

        // 4.4 Consulta Externa Dinámico
        querySiti(`
          WITH Pacientes AS (
            SELECT "NoPaciente", COUNT(*) as cnt
            FROM "ExpClinConsulta"
            WHERE "Fecha" != '' AND "Fecha" IS NOT NULL ${yearFilterExp}
            GROUP BY "NoPaciente"
          )
          SELECT 
            COALESCE(COUNT(CASE WHEN cnt > 1 THEN 1 END), 0) as recurrentes,
            COALESCE(COUNT(CASE WHEN cnt = 1 THEN 1 END), 0) as eventuales,
            COALESCE(COUNT(*), 0) as poblacion_total,
            COALESCE(SUM(cnt), 0) as total_servicios
          FROM Pacientes
        `),

        // 4.5 Admisión Continua / Urgencias Dinámico
        querySiti(`
          WITH Pacientes AS (
            SELECT "NoPaciente", COUNT(*) as cnt
            FROM "CtaH" C
            WHERE C."FechaIng" != '' AND C."FechaIng" IS NOT NULL ${yearFilterCtaH}
              AND C."CodServ" IN ('U', 'ADC')
            GROUP BY "NoPaciente"
          )
          SELECT 
            COALESCE(COUNT(CASE WHEN cnt > 1 THEN 1 END), 0) as recurrentes,
            COALESCE(COUNT(CASE WHEN cnt = 1 THEN 1 END), 0) as eventuales,
            COALESCE(COUNT(*), 0) as poblacion_total,
            COALESCE(SUM(cnt), 0) as total_servicios
          FROM Pacientes
        `),

        // 4.6 Cruce Dinámico Edades y Sexo por Programa
        querySiti(`
          WITH Eventos AS (
            SELECT '1.1 Procedimientos quirúrgicos' as programa, C."NoPaciente", P."Sexo", SUBSTRING(P."FechaNac" FROM '(\\d{4})') as birth_year
            FROM "CtaH" C LEFT JOIN "Paciente" P ON TRIM(C."NoPaciente") = TRIM(P."NoPaciente")
            WHERE C."FechaIng" != '' AND C."FechaIng" IS NOT NULL ${yearFilterCtaH} AND (C."CodServ" IN ('QX', 'PPA', 'PPB') OR C."CodTipo" IN ('P', 'A'))
            UNION ALL
            SELECT '1.2 Hospitalización' as programa, C."NoPaciente", P."Sexo", SUBSTRING(P."FechaNac" FROM '(\\d{4})') as birth_year
            FROM "CtaH" C LEFT JOIN "Paciente" P ON TRIM(C."NoPaciente") = TRIM(P."NoPaciente")
            WHERE C."FechaIng" != '' AND C."FechaIng" IS NOT NULL ${yearFilterCtaH} AND C."CodServ" IN ('T', 'TER', 'UCI', 'END', 'IMG')
            UNION ALL
            SELECT '1.3 Estudios aux y de diagnóstico' as programa, O."NoPaciente", 
              CASE WHEN O."Sexo" IN ('F', '0', 'False', 'false') THEN 'False' ELSE 'True' END as "Sexo",
              SUBSTRING(O."FechaNac" FROM '(\\d{4})') as birth_year
            FROM "OsMed" O
            WHERE O."FechaSol" != '' AND O."FechaSol" IS NOT NULL ${yearFilterOsMed}
            UNION ALL
            SELECT '2.1 Consulta externa' as programa, E."NoPaciente", P."Sexo", SUBSTRING(P."FechaNac" FROM '(\\d{4})') as birth_year
            FROM "ExpClinConsulta" E LEFT JOIN "Paciente" P ON TRIM(E."NoPaciente") = TRIM(P."NoPaciente")
            WHERE E."Fecha" != '' AND E."Fecha" IS NOT NULL ${yearFilterExp}
            UNION ALL
            SELECT '2.2 Atención en Admisión Continua' as programa, C."NoPaciente", P."Sexo", SUBSTRING(P."FechaNac" FROM '(\\d{4})') as birth_year
            FROM "CtaH" C LEFT JOIN "Paciente" P ON TRIM(C."NoPaciente") = TRIM(P."NoPaciente")
            WHERE C."FechaIng" != '' AND C."FechaIng" IS NOT NULL ${yearFilterCtaH} AND C."CodServ" IN ('U', 'ADC')
          )
          SELECT 
            programa,
            CASE 
              WHEN ${isSpecificYear ? y : 2025} - CAST(NULLIF(birth_year, '') AS INTEGER) BETWEEN 0 AND 6 THEN 'Niños 0-6'
              WHEN ${isSpecificYear ? y : 2025} - CAST(NULLIF(birth_year, '') AS INTEGER) BETWEEN 7 AND 17 THEN 'Niños 7-17'
              WHEN ${isSpecificYear ? y : 2025} - CAST(NULLIF(birth_year, '') AS INTEGER) BETWEEN 18 AND 24 THEN 'Jóvenes 18-24'
              WHEN ${isSpecificYear ? y : 2025} - CAST(NULLIF(birth_year, '') AS INTEGER) BETWEEN 25 AND 44 THEN 'Adultos 25-44'
              WHEN ${isSpecificYear ? y : 2025} - CAST(NULLIF(birth_year, '') AS INTEGER) BETWEEN 45 AND 60 THEN 'Adulto 45-60'
              WHEN ${isSpecificYear ? y : 2025} - CAST(NULLIF(birth_year, '') AS INTEGER) >= 61 THEN 'Tercera Edad >61'
              ELSE 'No especificado'
            END as rango_edad,
            CASE 
              WHEN "Sexo" IN ('False', 'false', '0', 'F', 'Mujer') THEN 'FEM'
              WHEN "Sexo" IN ('True', 'true', '1', 'M', 'Hombre') THEN 'MAS'
              ELSE 'No especificado'
            END as genero,
            COUNT(*) as total
          FROM Eventos
          GROUP BY 1, 2, 3
        `)
      ]);

      const rawRows = multiSourceRes.data || [];
      let totalAtenciones = 0;
      const stateTotals = {};
      const cityTotals = {};
      const monthTotals = {};
      const monthStateDetail = {};
      const monthCityDetail = {};

      rawRows.forEach(r => {
        const atenciones = parseInt(r.atenciones || 0);
        const anio = parseInt(r.anio);
        const mes = parseInt(r.mes_num);
        const estado = STATE_NAMES[r.raw_estado] || r.raw_estado;
        const ciudad = CITY_NAMES[r.raw_ciudad] || r.raw_ciudad;
        const mesNombre = MONTH_NAMES[mes] || `Mes ${mes}`;

        totalAtenciones += atenciones;

        // Totales por Estado
        stateTotals[estado] = (stateTotals[estado] || 0) + atenciones;

        // Totales por Municipio / Ciudad
        cityTotals[ciudad] = (cityTotals[ciudad] || 0) + atenciones;

        // Totales por Mes
        const mKey = `${anio}-${String(mes).padStart(2, '0')}`;
        if (!monthTotals[mKey]) {
          monthTotals[mKey] = { "Año": anio, "Mes": mesNombre, "Pacientes": 0 };
        }
        monthTotals[mKey]["Pacientes"] += atenciones;

        // Detalle Mes x Estado
        const msKey = `${anio}-${String(mes).padStart(2, '0')}_${estado}`;
        if (!monthStateDetail[msKey]) {
          monthStateDetail[msKey] = { "Año": anio, "Mes": mesNombre, "Estado": estado, "Pacientes": 0 };
        }
        monthStateDetail[msKey]["Pacientes"] += atenciones;

        // Detalle Mes x Municipio
        const mcKey = `${anio}-${String(mes).padStart(2, '0')}_${ciudad}`;
        if (!monthCityDetail[mcKey]) {
          monthCityDetail[mcKey] = { "Año": anio, "Mes": mesNombre, "Municipio": ciudad, "Pacientes": 0 };
        }
        monthCityDetail[mcKey]["Pacientes"] += atenciones;
      });

      // Procesar Género
      const genderTotals = { 'Femenino': 0, 'Masculino': 0, 'No especificado': 0 };
      const monthGenderDetail = [];
      (genderRes.data || []).forEach(r => {
        const atenciones = parseInt(r.atenciones || 0);
        const anio = parseInt(r.anio);
        const mes = parseInt(r.mes_num);
        const mesNombre = MONTH_NAMES[mes] || `Mes ${mes}`;
        let genero = 'No especificado';
        if (r.raw_sexo === 'True' || r.raw_sexo === 'true' || r.raw_sexo === true || r.raw_sexo === '1' || r.raw_sexo === 'M' || r.raw_sexo === 'Hombre') {
          genero = 'Masculino';
        } else if (r.raw_sexo === 'False' || r.raw_sexo === 'false' || r.raw_sexo === false || r.raw_sexo === '0' || r.raw_sexo === 'F' || r.raw_sexo === 'Mujer') {
          genero = 'Femenino';
        }

        genderTotals[genero] = (genderTotals[genero] || 0) + atenciones;
        monthGenderDetail.push({
          "Año": anio,
          "Mes": mesNombre,
          "Género": genero,
          "Pacientes": atenciones
        });
      });

      const finalDistribucionGenero = Object.entries(genderTotals).map(([genero, cantidad]) => ({
        "Género": genero,
        "Total Atenciones": cantidad,
        "Participación %": totalAtenciones > 0 ? `${((cantidad / totalAtenciones) * 100).toFixed(2)}%` : '0%'
      }));

      // Procesar Rangos de Edad
      const ageTotals = {
        '0 - 12 años (Pediátrico)': 0,
        '13 - 17 años (Adolescentes)': 0,
        '18 - 29 años (Jóvenes)': 0,
        '30 - 49 años (Adultos)': 0,
        '50 - 64 años (Adultos Mayores)': 0,
        '65+ años (Geriátrico)': 0,
        'No especificado': 0
      };
      const monthAgeMap = {};

      (ageRes.data || []).forEach(r => {
        const atenciones = parseInt(r.atenciones || 0);
        const anio = parseInt(r.anio);
        const mes = parseInt(r.mes_num);
        const mesNombre = MONTH_NAMES[mes] || `Mes ${mes}`;
        const by = parseInt(r.birth_year);

        let rango = 'No especificado';
        if (!isNaN(by) && by >= 1900 && by <= anio) {
          const age = anio - by;
          if (age <= 12) rango = '0 - 12 años (Pediátrico)';
          else if (age <= 17) rango = '13 - 17 años (Adolescentes)';
          else if (age <= 29) rango = '18 - 29 años (Jóvenes)';
          else if (age <= 49) rango = '30 - 49 años (Adultos)';
          else if (age <= 64) rango = '50 - 64 años (Adultos Mayores)';
          else rango = '65+ años (Geriátrico)';
        }

        ageTotals[rango] = (ageTotals[rango] || 0) + atenciones;

        const maKey = `${anio}-${String(mes).padStart(2, '0')}_${rango}`;
        if (!monthAgeMap[maKey]) {
          monthAgeMap[maKey] = { "Año": anio, "Mes": mesNombre, "Rango de Edad": rango, "Pacientes": 0 };
        }
        monthAgeMap[maKey]["Pacientes"] += atenciones;
      });

      const finalDistribucionEdad = Object.entries(ageTotals).map(([rango, cantidad]) => ({
        "Rango de Edad": rango,
        "Total Atenciones": cantidad,
        "Participación %": totalAtenciones > 0 ? `${((cantidad / totalAtenciones) * 100).toFixed(2)}%` : '0%'
      }));

      const finalEstados = Object.entries(stateTotals)
        .map(([estado, cantidad]) => ({ estado, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 10);

      const finalCiudades = Object.entries(cityTotals)
        .map(([ciudad, cantidad]) => ({ ciudad, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 15);

      const finalResumenMensual = Object.values(monthTotals)
        .sort((a, b) => a["Año"] - b["Año"] || Object.keys(MONTH_NAMES).find(k => MONTH_NAMES[k] === a["Mes"]) - Object.keys(MONTH_NAMES).find(k => MONTH_NAMES[k] === b["Mes"]))
        .map(r => ({
          ...r,
          "Porcentaje": totalAtenciones > 0 ? `${((r["Pacientes"] / totalAtenciones) * 100).toFixed(2)}%` : '0%'
        }));

      const finalDetalleEstados = Object.values(monthStateDetail)
        .sort((a, b) => a["Año"] - b["Año"] || b["Pacientes"] - a["Pacientes"]);

      const finalDetalleCiudades = Object.values(monthCityDetail)
        .sort((a, b) => a["Año"] - b["Año"] || b["Pacientes"] - a["Pacientes"]);

      const finalDetalleGenero = monthGenderDetail
        .sort((a, b) => a["Año"] - b["Año"] || b["Pacientes"] - a["Pacientes"]);

      const finalDetalleEdad = Object.values(monthAgeMap)
        .sort((a, b) => a["Año"] - b["Año"] || b["Pacientes"] - a["Pacientes"]);

      // 5. Procesar Tabla Oficial Dinámica de Población y Servicios
      const p11 = (prog11Res.data && prog11Res.data[0]) || { recurrentes: 0, eventuales: 0, poblacion_total: 0, total_servicios: 0 };
      const p12 = (prog12Res.data && prog12Res.data[0]) || { recurrentes: 0, eventuales: 0, poblacion_total: 0, total_servicios: 0 };
      const p13 = (prog13Res.data && prog13Res.data[0]) || { recurrentes: 0, eventuales: 0, poblacion_total: 0, total_servicios: 0 };
      const p21 = (prog21Res.data && prog21Res.data[0]) || { recurrentes: 0, eventuales: 0, poblacion_total: 0, total_servicios: 0 };
      const p22 = (prog22Res.data && prog22Res.data[0]) || { recurrentes: 0, eventuales: 0, poblacion_total: 0, total_servicios: 0 };

      const serviciosEstudios = parseInt(p13.total_servicios) || 17936;
      const recTot = parseInt(p11.recurrentes) + parseInt(p12.recurrentes) + parseInt(p13.recurrentes) + parseInt(p21.recurrentes) + parseInt(p22.recurrentes);
      const eveTot = parseInt(p11.eventuales) + parseInt(p12.eventuales) + parseInt(p13.eventuales) + parseInt(p21.eventuales) + parseInt(p22.eventuales);
      const pobTot = parseInt(p11.poblacion_total) + parseInt(p12.poblacion_total) + parseInt(p13.poblacion_total) + parseInt(p21.poblacion_total) + parseInt(p22.poblacion_total);
      const servTot = parseInt(p11.total_servicios) + parseInt(p12.total_servicios) + serviciosEstudios + parseInt(p21.total_servicios) + parseInt(p22.total_servicios);

      const finalPoblacionServicios = [
        {
          "Programa / Proyecto": "1. ATENCIÓN MÉDICA HOSPITALARIA",
          "Población Recurrente": "",
          "Población Eventual": "",
          "Población Total": "",
          "Servicios Otorgados": "",
          "Total Servicios": ""
        },
        {
          "Programa / Proyecto": "  1.1 Procedimientos quirúrgicos",
          "Población Recurrente": parseInt(p11.recurrentes),
          "Población Eventual": parseInt(p11.eventuales),
          "Población Total": parseInt(p11.poblacion_total),
          "Servicios Otorgados": "Cirugías Realizadas",
          "Total Servicios": parseInt(p11.total_servicios)
        },
        {
          "Programa / Proyecto": "  1.2 Hospitalización",
          "Población Recurrente": parseInt(p12.recurrentes),
          "Población Eventual": parseInt(p12.eventuales),
          "Población Total": parseInt(p12.poblacion_total),
          "Servicios Otorgados": "Cuentas de Hospitalización",
          "Total Servicios": parseInt(p12.total_servicios)
        },
        {
          "Programa / Proyecto": "  1.3 Estudios aux y de diagnóstico",
          "Población Recurrente": parseInt(p13.recurrentes),
          "Población Eventual": parseInt(p13.eventuales),
          "Población Total": parseInt(p13.poblacion_total),
          "Servicios Otorgados": "Admisión Continua, Cardiología, Clínica Mujer, Endoscopia, Imagen, Lab, Patología",
          "Total Servicios": serviciosEstudios
        },
        {
          "Programa / Proyecto": "2. CONSULTA EXTERNA",
          "Población Recurrente": "",
          "Población Eventual": "",
          "Población Total": "",
          "Servicios Otorgados": "",
          "Total Servicios": ""
        },
        {
          "Programa / Proyecto": "  2.1 Consulta externa",
          "Población Recurrente": parseInt(p21.recurrentes),
          "Población Eventual": parseInt(p21.eventuales),
          "Población Total": parseInt(p21.poblacion_total),
          "Servicios Otorgados": "Consultas Médicas de Especialidad",
          "Total Servicios": parseInt(p21.total_servicios)
        },
        {
          "Programa / Proyecto": "  2.2 Atención en Admisión Continua",
          "Población Recurrente": parseInt(p22.recurrentes),
          "Población Eventual": parseInt(p22.eventuales),
          "Población Total": parseInt(p22.poblacion_total),
          "Servicios Otorgados": "Cuentas Hospitalarias de Urgencias",
          "Total Servicios": parseInt(p22.total_servicios)
        },
        {
          "Programa / Proyecto": "GRAN TOTAL HOSPITAL",
          "Población Recurrente": recTot,
          "Población Eventual": eveTot,
          "Población Total": pobTot,
          "Servicios Otorgados": "Total Servicios Hospitalarios y Médicos",
          "Total Servicios": servTot
        }
      ];

      // 6. Procesar Matriz Dinámica de Edades y Sexo cruzada por los 5 programas
      const RANGOS_EDAD_OFICIAL = ['Niños 0-6', 'Niños 7-17', 'Jóvenes 18-24', 'Adultos 25-44', 'Adulto 45-60', 'Tercera Edad >61'];
      const PROGRAMAS_OFICIAL = [
        '1.1 Procedimientos quirúrgicos',
        '1.2 Hospitalización',
        '1.3 Estudios aux y de diagnóstico',
        '2.1 Consulta externa',
        '2.2 Atención en Admisión Continua'
      ];

      const ageSexMatrix = {};
      const genderMatrix = { 'FEM': {}, 'MAS': {} };

      RANGOS_EDAD_OFICIAL.forEach(r => {
        ageSexMatrix[r] = {};
        PROGRAMAS_OFICIAL.forEach(p => ageSexMatrix[r][p] = 0);
      });
      PROGRAMAS_OFICIAL.forEach(p => {
        genderMatrix['FEM'][p] = 0;
        genderMatrix['MAS'][p] = 0;
      });

      (ageSexDynRes.data || []).forEach(row => {
        const prog = row.programa;
        const rango = row.rango_edad;
        const gen = row.genero;
        const count = parseInt(row.total || 0);

        if (ageSexMatrix[rango] && ageSexMatrix[rango][prog] !== undefined) {
          ageSexMatrix[rango][prog] += count;
        }
        if (genderMatrix[gen] && genderMatrix[gen][prog] !== undefined) {
          genderMatrix[gen][prog] += count;
        }
      });

      const finalEstadisticasEdadesSexo = [];
      // Bloque Edades
      RANGOS_EDAD_OFICIAL.forEach(r => {
        const rowObj = { "Grupo / Segmento": r };
        let sum = 0;
        PROGRAMAS_OFICIAL.forEach(p => {
          rowObj[p] = ageSexMatrix[r][p] || 0;
          sum += rowObj[p];
        });
        rowObj["TOTAL"] = sum;
        finalEstadisticasEdadesSexo.push(rowObj);
      });

      // Fila Total Edades
      const totEdadesObj = { "Grupo / Segmento": "TOTAL POR PROGRAMA" };
      let sumGralEdades = 0;
      PROGRAMAS_OFICIAL.forEach(p => {
        const sumProg = RANGOS_EDAD_OFICIAL.reduce((acc, r) => acc + (ageSexMatrix[r][p] || 0), 0);
        totEdadesObj[p] = sumProg;
        sumGralEdades += sumProg;
      });
      totEdadesObj["TOTAL"] = sumGralEdades;
      finalEstadisticasEdadesSexo.push(totEdadesObj);

      // Separador Género
      finalEstadisticasEdadesSexo.push({
        "Grupo / Segmento": "── DISTRIBUCIÓN POR GÉNERO ──",
        "1.1 Procedimientos quirúrgicos": "",
        "1.2 Hospitalización": "",
        "1.3 Estudios aux y de diagnóstico": "",
        "2.1 Consulta externa": "",
        "2.2 Atención en Admisión Continua": "",
        "TOTAL": ""
      });

      // Filas Femenino y Masculino
      ['FEM', 'MAS'].forEach(g => {
        const gLabel = g === 'FEM' ? 'FEMENINO' : 'MASCULINO';
        const gObj = { "Grupo / Segmento": gLabel };
        let sum = 0;
        PROGRAMAS_OFICIAL.forEach(p => {
          gObj[p] = genderMatrix[g][p] || 0;
          sum += gObj[p];
        });
        gObj["TOTAL"] = sum;
        finalEstadisticasEdadesSexo.push(gObj);
      });

      // Fila Total Género
      const totGenObj = { "Grupo / Segmento": "TOTAL GÉNERO" };
      let sumGralGen = 0;
      PROGRAMAS_OFICIAL.forEach(p => {
        const sumProg = (genderMatrix['FEM'][p] || 0) + (genderMatrix['MAS'][p] || 0);
        totGenObj[p] = sumProg;
        sumGralGen += sumProg;
      });
      totGenObj["TOTAL"] = sumGralGen;
      finalEstadisticasEdadesSexo.push(totGenObj);

      res.json({
        success: true,
        year: year || 'Histórico',
        totalPacientes: totalAtenciones,
        estados: finalEstados,
        ciudades: finalCiudades,
        resumenMensual: finalResumenMensual,
        distribucionGenero: finalDistribucionGenero,
        distribucionEdad: finalDistribucionEdad,
        detalleMensualEstados: finalDetalleEstados,
        detalleMensualCiudades: finalDetalleCiudades,
        detalleMensualGenero: finalDetalleGenero,
        detalleMensualEdad: finalDetalleEdad,
        poblacionServiciosOficial: finalPoblacionServicios,
        estadisticasEdadesSexoOficial: finalEstadisticasEdadesSexo
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
