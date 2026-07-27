/**
 * sap.routes.js
 * Rutas de monitoreo y diagnóstico para la integración SAP
 */
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const sapService = require('../services/sap.service');

/**
 * GET /api/sap/ping
 * Realiza una consulta básica a SAP (ej: buscar el nombre de la compañía) 
 * para verificar que el autopiloto de sesión funciona correctamente.
 * Solo administradores pueden correr esta prueba.
 */
router.get('/ping', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    // Consultamos la tabla CompanyService_GetCompanyTime como una prueba inofensiva y rápida
    // O si preferimos algo más estándar: buscar Top 1 item
    const response = await sapService.get('/Items?$top=1&$select=ItemCode,ItemName');
    
    res.status(200).json({
      success: true,
      message: 'Conexión exitosa con SAP Business One',
      data: response.data
    });
  } catch (error) {
    console.error('Error en /api/sap/ping:', error);
    res.status(500).json({
      success: false,
      message: 'Error al comunicarse con SAP',
      error: error.error || error.message || String(error)
    });
  }
});

/**
 * GET /api/sap/warehouses
 * Obtiene el catálogo de almacenes activos de SAP
 */
router.get('/warehouses', authenticate, async (req, res) => {
  try {
    const response = await sapService.get("/Warehouses?$select=WarehouseCode,WarehouseName");
    res.status(200).json({
      success: true,
      data: response.data.value || []
    });
  } catch (error) {
    console.error('Error en /api/sap/warehouses:', error);
    res.status(500).json({
      success: false,
      error: error.error || error.message || String(error)
    });
  }
});

module.exports = router;
