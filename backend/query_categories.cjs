require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');
async function run() {
    try {
        const pool = await connectRemoteDB();
        console.log('Connected to remote DB!');
        
        const r1 = await pool.query(`
            SELECT UNIDAD_DE_SERVICIO, COUNT(DISTINCT FOLIO_DE_ATENCION) as folios
            FROM UDR_CUENTAS_SERVICIOS
            WHERE FECHA_DE_CARGO >= '2026-07-01' AND FECHA_DE_CARGO <= '2026-07-31'
            GROUP BY UNIDAD_DE_SERVICIO
            ORDER BY folios DESC
        `);
        console.log('Unidades SAP:', r1.recordset.slice(0, 10));

        const r2 = await pool.query(`
            SELECT TOP 20 DESCRIPCION_DEL_ARTICULO, COUNT(*) as qty
            FROM UDR_CUENTAS_SERVICIOS
            WHERE FECHA_DE_CARGO >= '2026-07-01' AND FECHA_DE_CARGO <= '2026-07-31'
              AND (UNIDAD_DE_SERVICIO = 'CQX' OR UNIDAD_DE_SERVICIO = 'CEN' OR UNIDAD_DE_SERVICIO = 'TCO' OR UNIDAD_DE_SERVICIO = 'LTO')
            GROUP BY DESCRIPCION_DEL_ARTICULO
            ORDER BY qty DESC
        `);
        console.log('Articulos relacionados:', r2.recordset);

        const r3 = await pool.query(`
            SELECT Procedimientos, COUNT(*) as qty
            FROM UDR_USOQX
            WHERE FechaInicio >= '2026-07-01' AND FechaInicio <= '2026-07-31'
            GROUP BY Procedimientos
            ORDER BY qty DESC
        `);
        console.log('Procedimientos Vertical (Top 20):', r3.recordset.slice(0, 20));
        
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
