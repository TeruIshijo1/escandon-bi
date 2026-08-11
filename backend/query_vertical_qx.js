require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db.js');

async function test() {
  try {
    const pool = await connectRemoteDB();
    const res = await pool.request().query(`
      WITH Agrupado AS (
        SELECT 
          FOLIO_DE_ATENCION,
          MIN(FECHA_DE_CARGO) as FechaInicio,
          MAX(FECHA_DE_CARGO) as FechaFin,
          MAX(NOMBRE_DEL_PACIENTE) as Paciente,
          MAX(Medico_Tratante) as Medicos,
          STRING_AGG(CAST(DESCRIPCION_DEL_ARTICULO AS NVARCHAR(MAX)), ', ') as Procedimientos
        FROM UDR_CUENTAS_SERVICIOS
        WHERE UNIDAD_DE_SERVICIO = 'CQX'
          AND FECHA_DE_CARGO >= '2026-07-01' 
          AND FECHA_DE_CARGO <= '2026-07-31'
        GROUP BY FOLIO_DE_ATENCION
      )
      SELECT 
        A.FOLIO_DE_ATENCION,
        A.FechaInicio,
        A.FechaFin,
        A.Paciente,
        'CQX' as Quirofano,
        A.Medicos,
        A.Procedimientos,
        CASE WHEN U.PCFRNum IS NULL THEN 'Facturado sin registro en Quirófano' ELSE 'Cirugía Registrada' END as Notas
      FROM Agrupado A
      OUTER APPLY (
        SELECT TOP 1 PCFRNum 
        FROM UDR_USOQX 
        WHERE Paciente = A.Paciente 
          AND FechaInicio >= DATEADD(day, -3, A.FechaInicio)
          AND FechaInicio <= DATEADD(day, 3, A.FechaInicio)
      ) U
    `);
    
    const cirugias = res.recordset.filter(r => r.Notas === 'Cirugía Registrada');
    const sinRegistro = res.recordset.filter(r => r.Notas !== 'Cirugía Registrada');
    
    console.log("Total cirugias:", cirugias.length);
    console.log("Sin registro (Consultorio):", sinRegistro.length);
    console.log("Ejemplo sin registro:", sinRegistro.slice(0, 5));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

test();
