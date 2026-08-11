require('dotenv').config();
const { connectRemoteDB } = require('./config/remote-db');

async function run() {
    try {
        const pool = await connectRemoteDB();
        
        const r1 = await pool.query(`
            SELECT Procedimientos, COUNT(*) as qty
            FROM UDR_USOQX
            WHERE FechaInicio >= '2026-07-01' AND FechaInicio <= '2026-07-31'
            GROUP BY Procedimientos
            ORDER BY qty DESC
        `);
        
        let sum = 0;
        r1.recordset.forEach(r => sum += r.qty);
        
        console.log('Total procedures in Vertical (July):', sum);
        console.log(r1.recordset);
        
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
