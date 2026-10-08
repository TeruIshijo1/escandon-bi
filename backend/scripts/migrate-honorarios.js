'use strict';
// Optional preparation of BI-only schemas. No reads/writes to SAP or Vertical.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { connectDB, closeDB } = require('../config/db');
const catalog = require('../services/honorariosCatalog.service');
const review = require('../services/honorariosReview.service');
const liquidation = require('../services/honorariosLiquidation.service');
(async () => {
  try {
    await connectDB();
    await catalog.ensureSchema();
    await review.ensureTables();
    await require('../services/honorariosMonthlyFixed.service').ensureSchema();
    await liquidation.ensureSchema();
    await require('../services/honorariosFiscalProfile.service').ensureSchema();
    console.log('Esquema de honorarios preparado en PostgreSQL de BI. Se conservaron los datos existentes.');
  } catch (error) {
    console.error('No se pudo preparar el esquema de honorarios:', error.message);
    process.exitCode = 1;
  } finally { await closeDB(); }
})();
