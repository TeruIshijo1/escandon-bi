/**
 * sap.config.js
 * Configuración estricta de credenciales SAP.
 * Nunca exponer estas variables al frontend.
 */

'use strict';

// Validate required environment variables for SAP Integration
const requiredEnvVars = ['SAP_COMPANY_DB', 'SAP_USERNAME', 'SAP_PASSWORD', 'SAP_BASE_URL'];

const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingVars.length > 0) {
  console.warn(`[WARNING] Faltan variables de entorno para SAP: ${missingVars.join(', ')}`);
  console.warn(`[WARNING] La integración automatizada con SAP no funcionará hasta que se definan en el .env`);
}

const sapConfig = {
  baseUrl: process.env.SAP_BASE_URL || 'https://sl.hospesc.com:50000/b1s/v2',
  companyDb: process.env.SAP_COMPANY_DB,
  username: process.env.SAP_USERNAME,
  password: process.env.SAP_PASSWORD,
  rejectUnauthorized: process.env.SAP_REJECT_UNAUTHORIZED === 'true'
};

module.exports = sapConfig;
