const cron = require('node-cron');
const sapService = require('./sap.service');
const { pool } = require('../config/pg-db');

/**
 * Función para sincronizar IncomingPayments (Ingresos)
 */
async function syncIncomingPayments() {
  try {
    // Sincronizamos los últimos 15 días para capturar nuevos y modificaciones
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 15);
    const sapDate = dateLimit.toISOString().split('T')[0];

    let url = `/IncomingPayments?$select=DocEntry,DocNum,DocDate,CardCode,CardName,CashSum,TransferSum,PaymentCreditCards,PaymentChecks,CounterReference,Cancelled&$filter=DocDate ge '${sapDate}'&$orderby=DocEntry asc`;
    let count = 0;

    while (url) {
      const res = await sapService.get(url, { 'B1S-PageSize': 500, 'Prefer': 'odata.maxpagesize=500' });
      const records = res.data?.value || [];
      
      for (const p of records) {
        let creditCard = 0;
        if (p.PaymentCreditCards && Array.isArray(p.PaymentCreditCards)) {
          p.PaymentCreditCards.forEach(c => creditCard += (c.CreditSum || c.CreditCardSum || c.SumPaid || 0));
        }
        let check = 0;
        if (p.PaymentChecks && Array.isArray(p.PaymentChecks)) {
          p.PaymentChecks.forEach(c => check += (c.CheckSum || c.CheckAmount || 0));
        }
        
        const docTotal = (p.CashSum || 0) + (p.TransferSum || 0) + creditCard + check;

        await pool.query(`
          INSERT INTO sap_incoming_payments 
            (DocEntry, DocNum, DocDate, CardCode, CardName, CashSum, CreditSum, CheckSum, TrsfrSum, DocTotal, CounterReference, Canceled, SyncDate)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
          ON CONFLICT (DocEntry) DO UPDATE SET 
            CardCode = EXCLUDED.CardCode,
            CardName = EXCLUDED.CardName,
            CashSum = EXCLUDED.CashSum,
            CreditSum = EXCLUDED.CreditSum,
            CheckSum = EXCLUDED.CheckSum,
            TrsfrSum = EXCLUDED.TrsfrSum,
            DocTotal = EXCLUDED.DocTotal,
            CounterReference = EXCLUDED.CounterReference,
            Canceled = EXCLUDED.Canceled,
            SyncDate = CURRENT_TIMESTAMP;
        `, [
          p.DocEntry, p.DocNum, p.DocDate, p.CardCode, p.CardName, 
          p.CashSum || 0, creditCard, check, p.TransferSum || 0, docTotal,
          p.CounterReference, (p.Cancelled === 'tYES' ? 'Y' : 'N')
        ]);
        count++;
      }
      
      url = res.data?.['odata.nextLink'] ? `/${res.data['odata.nextLink']}` : null;
    }
    console.log(`✅ Sync DW: Sincronizados ${count} Ingresos (ORCT) desde ${sapDate}`);
  } catch (error) {
    console.error('❌ Error sincronizando IncomingPayments:', JSON.stringify(error));
  }
}

/**
 * Función para sincronizar PurchaseInvoices (Egresos)
 */
async function syncPurchaseInvoices() {
  try {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 15);
    const sapDate = dateLimit.toISOString().split('T')[0];

    let url = `/PurchaseInvoices?$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,DocumentStatus,Cancelled&$filter=DocDate ge '${sapDate}'&$orderby=DocEntry asc`;
    let count = 0;

    while (url) {
      const res = await sapService.get(url, { 'B1S-PageSize': 500, 'Prefer': 'odata.maxpagesize=500' });
      const records = res.data?.value || [];
      
      for (const p of records) {
        // En PurchaseInvoices, Cancelled viene como tYES o tNO.
        const canceled = p.Cancelled === 'tYES' ? 'Y' : 'N';

        await pool.query(`
          INSERT INTO sap_purchase_invoices 
            (DocEntry, DocNum, DocDate, CardCode, CardName, DocTotal, Canceled, SyncDate)
          VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
          ON CONFLICT (DocEntry) DO UPDATE SET 
            CardCode = EXCLUDED.CardCode,
            CardName = EXCLUDED.CardName,
            DocTotal = EXCLUDED.DocTotal,
            Canceled = EXCLUDED.Canceled,
            SyncDate = CURRENT_TIMESTAMP;
        `, [
          p.DocEntry, p.DocNum, p.DocDate, p.CardCode, p.CardName, 
          p.DocTotal || 0, canceled
        ]);
        count++;
      }
      
      url = res.data?.['odata.nextLink'] ? `/${res.data['odata.nextLink']}` : null;
    }
    console.log(`✅ Sync DW: Sincronizados ${count} Egresos (OPCH) desde ${sapDate}`);
  } catch (error) {
    console.error('❌ Error sincronizando PurchaseInvoices:', JSON.stringify(error));
  }
}

async function runFullSync() {
  console.log('🔄 Iniciando ciclo de sincronización ETL hacia Postgres DW...');
  await syncIncomingPayments();
  await syncPurchaseInvoices();
  
  try {
    console.log('🔄 Iniciando sincronización de traslados desde SAP...');
    const { syncTraslados } = require('./sapTrasladosSync.service');
    const count = await syncTraslados();
    console.log(`✅ Sincronizados ${count} traslados desde SAP.`);
  } catch (err) {
    console.error('❌ Error sincronizando traslados en ETL:', err.message);
  }

  console.log('✅ Ciclo de sincronización ETL finalizado.');
}

// Iniciar los Cron Jobs
function initCronJobs() {
  // Ejecutar cada 15 minutos
  cron.schedule('*/15 * * * *', () => {
    runFullSync();
  });
  console.log('⏰ Cron Jobs de ETL inicializados (Ejecución cada 15 min).');
}

module.exports = {
  initCronJobs,
  runFullSync
};
