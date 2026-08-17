const {pool} = require('./backend/config/pg-db'); 
const today = new Date().toISOString().split('T')[0]; 
const q = 'SELECT count(*) FROM cex_citas WHERE FechaHoraCita >= $1 AND FechaHoraCita <= $2'; 
pool.query(q, [today, today + ' 23:59:59']).then(res => console.log(res.rows)).catch(console.error).finally(() => pool.end());
