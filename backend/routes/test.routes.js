const express = require('express');
const router = express.Router();
const { getRemoteDb } = require('../config/remote-db');

/**
 * GET /api/test/remote-db
 * Ruta de diagnóstico para comprobar la conexión a SQL Server
 */
router.get('/remote-db', async (req, res) => {
  try {
    const pool = await getRemoteDb();
    
    // Consulta simple para obtener la versión del SQL Server remoto y el nombre de la BD actual
    const result = await pool.request().query('SELECT @@VERSION AS version, DB_NAME() AS current_db');
    
    res.status(200).json({
      success: true,
      message: 'Conexión a SQL Server remoto exitosa',
      data: {
        serverVersion: result.recordset[0].version,
        connectedDatabase: result.recordset[0].current_db
      }
    });
  } catch (error) {
    console.error('Error en ruta test remote-db:', error);
    res.status(500).json({
      success: false,
      message: 'Error al conectar con la base de datos remota',
      error: error.message
    });
  }
});

module.exports = router;
