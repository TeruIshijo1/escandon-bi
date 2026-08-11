const fs = require('fs');
const path = 'd:/Escritorio/escandon-bi/backend/routes/dashboard.routes.js';
let code = fs.readFileSync(path, 'utf8');

const routeStart = code.indexOf('/quirofano-nativo');
if (routeStart === -1) {
  console.log("Could not find route /quirofano-nativo");
  process.exit(1);
}

const targetStr = `    let whereClauses = ["1=1"];

    if (startDate) {
      whereClauses.push("FechaInicio >= @startDate");
      request.input('startDate', startDate);
    }
    if (endDate) {
      whereClauses.push("FechaInicio <= @endDate");
      request.input('endDate', endDate);
    }
    if (search) {
      whereClauses.push("(Procedimientos LIKE @search OR Paciente LIKE @search OR Medicos LIKE @search)");
      request.input('search', \`%\${search}%\`);
    }

    const queryStr = \`
      SELECT 
        Quirofano,
        FechaInicio,
        FechaFin,
        Medicos,
        Procedimientos
      FROM UDR_USOQX
      WHERE \${whereClauses.join(' AND ')}
      ORDER BY FechaInicio DESC
    \`;`;

const replacementStr = `    let whereClauses = ["UNIDAD_DE_SERVICIO = 'CQX'"];

    if (startDate) {
      whereClauses.push("FECHA_DE_CARGO >= @startDate");
      request.input('startDate', startDate);
    }
    if (endDate) {
      whereClauses.push("FECHA_DE_CARGO <= @endDate");
      request.input('endDate', endDate);
    }
    if (search) {
      whereClauses.push("(NOMBRE_DEL_PACIENTE LIKE @search OR Medico_Tratante LIKE @search OR DESCRIPCION_DEL_ARTICULO LIKE @search)");
      request.input('search', \`%\${search}%\`);
    }

    const queryStr = \`
      WITH Agrupado AS (
        SELECT 
          FOLIO_DE_ATENCION,
          MIN(FECHA_DE_CARGO) as FechaInicio,
          MAX(FECHA_DE_CARGO) as FechaFin,
          MAX(NOMBRE_DEL_PACIENTE) as Paciente,
          MAX(Medico_Tratante) as Medicos,
          STRING_AGG(CAST(DESCRIPCION_DEL_ARTICULO AS NVARCHAR(MAX)), ', ') as Procedimientos
        FROM UDR_CUENTAS_SERVICIOS
        WHERE \${whereClauses.join(' AND ')}
        GROUP BY FOLIO_DE_ATENCION
      )
      SELECT 
        A.FOLIO_DE_ATENCION,
        COALESCE(U.UDR_Inicio, A.FechaInicio) as FechaInicio,
        COALESCE(U.UDR_Fin, A.FechaInicio) as FechaFin,
        A.Paciente,
        COALESCE(U.Quirofano, 'CQX') as Quirofano,
        A.Medicos,
        A.Procedimientos,
        CASE WHEN U.PCFRNum IS NULL THEN 'Facturado sin registro en Quirófano (Consultorio/Omisión)' ELSE 'Cirugía Registrada' END as Notas
      FROM Agrupado A
      OUTER APPLY (
        SELECT TOP 1 PCFRNum, FechaInicio as UDR_Inicio, FechaFin as UDR_Fin, Quirofano
        FROM UDR_USOQX 
        WHERE Paciente = A.Paciente 
          AND FechaInicio >= DATEADD(day, -3, A.FechaInicio)
          AND FechaInicio <= DATEADD(day, 3, A.FechaInicio)
      ) U
      ORDER BY A.FechaInicio DESC
    \`;`;

const idx = code.indexOf('FROM UDR_USOQX', routeStart);
if (idx !== -1) {
  code = code.replace(targetStr, replacementStr);
  fs.writeFileSync(path, code);
  console.log('Backend routes replaced successfully!');
} else {
  console.log('Backend target not found after routeStart');
}
