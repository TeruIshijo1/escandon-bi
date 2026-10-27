'use strict';

const sql = require('mssql');
const { getRemoteDb, connectRemoteDB, resetRemoteDB } = require('../config/remote-db');

const TRANSIENT_DB_ERROR = /ECONNRESET|ECONNCLOSED|ECONNREFUSED|ESOCKET|ETIMEOUT|ENOTOPEN|EINSTLOOKUP|ConnectionError|connection lost|socket hang up|not connected|connection is closed|connection was closed|pool is closed|failed to connect|login failed|timeout/i;

async function ensureRemotePool() {
  try {
    return await getRemoteDb();
  } catch {
    return connectRemoteDB();
  }
}

async function withRemotePool(operation) {
  let pool = await ensureRemotePool();
  try {
    return await operation(pool);
  } catch (error) {
    if (!TRANSIENT_DB_ERROR.test(String(error && error.message || ''))) throw error;
    await resetRemoteDB();
    pool = await connectRemoteDB();
    return operation(pool);
  }
}

// Catálogo estándar de los 37 grupos hospitalarios de Vertical
const STANDARD_ITEM_GROUPS = [
  '100', '101', '102', '103', '104', '105', '106', '107', '108', '109',
  '110', '111', '112', '113', '114', '115', '116', '117', '118', '119',
  '120', '121', '122', '123', '124', '125', '126', '127', '128', '129',
  '130', '131', '132', '133', '134', '135', '136', '137'
];

/**
 * Obtiene el catálogo completo auditado de convenios y acuerdos en Vertical
 */
async function getAgreementsAudit() {
  const query = `
    WITH agitgr_agg AS (
      SELECT AGCode, COUNT(*) AS AGITGR_Count
      FROM dbo.AGITGR
      GROUP BY AGCode
    ), pcag_agg AS (
      SELECT AGCode,
        COUNT(*) AS PCAG_TotalAttempts,
        SUM(CASE WHEN PCAG_ST = 'AU' THEN 1 ELSE 0 END) AS PCAG_Authorized,
        SUM(CASE WHEN PCAG_ST = 'CA' THEN 1 ELSE 0 END) AS PCAG_Cancelled
      FROM dbo.PCAG
      GROUP BY AGCode
    ), pcit_agg AS (
      SELECT AGCode, COUNT(*) AS PCIT_ItemsLinked
      FROM dbo.PCIT
      GROUP BY AGCode
    )
    SELECT 
      a.AGCode, 
      a.AGName, 
      a.AG_ST, 
      a.PatientCareAgreement, 
      a.SalesOrderAgreement,
      a.BPCode, 
      bp.BPName as RealBPNameInSAP,
      a.PriceListNum, 
      a.SUCode, 
      a.ChargeMode, 
      a.PriceFactor, 
      a.GlobalDiscount,
      a.Deductible,
      a.CopayAmount,
      a.Coinsurance,
      COALESCE(agitgr_agg.AGITGR_Count, 0) AS AGITGR_Count,
      COALESCE(pcag_agg.PCAG_TotalAttempts, 0) AS PCAG_TotalAttempts,
      COALESCE(pcag_agg.PCAG_Authorized, 0) AS PCAG_Authorized,
      COALESCE(pcag_agg.PCAG_Cancelled, 0) AS PCAG_Cancelled,
      COALESCE(pcit_agg.PCIT_ItemsLinked, 0) AS PCIT_ItemsLinked,
      a.CreatedBy,
      a.CreatedOn,
      a.ModifiedBy,
      a.ModifiedOn
    FROM dbo.AG a
    LEFT JOIN dbo.V_BP bp ON a.BPCode = bp.BPCode
    LEFT JOIN agitgr_agg ON agitgr_agg.AGCode = a.AGCode
    LEFT JOIN pcag_agg ON pcag_agg.AGCode = a.AGCode
    LEFT JOIN pcit_agg ON pcit_agg.AGCode = a.AGCode
    ORDER BY a.AGCode ASC
  `;

  const result = await withRemotePool(pool => pool.request().query(query));

  const audited = result.recordset.map(r => {
    const issues = [];
    let health = 'healthy'; // 'healthy', 'critical', 'inactive', 'special'

    if (r.AG_ST !== 'AC') {
      health = 'inactive';
      issues.push(`Estatus inactivo (${r.AG_ST})`);
    }

    if (r.ChargeMode === 'NL') {
      health = 'critical';
      issues.push("Modo 'NL' (Neto): bloquea el cálculo de descuentos en líneas de cargos");
    }

    if (r.AGITGR_Count === 0) {
      health = 'critical';
      issues.push("Sin reglas por grupo de artículos (AGITGR = 0)");
    }

    if (!r.SUCode) {
      health = 'critical';
      issues.push("Sin Unidad de Servicio (SUCode es NULL; no se despliega en Admisión)");
    }

    if (!r.PatientCareAgreement) {
      health = 'critical';
      issues.push("Deshabilitado para pacientes hospitalizados (PatientCareAgreement = false)");
    }

    if (!r.PriceListNum) {
      health = 'critical';
      issues.push("Sin Lista de Precios base asociada (PriceListNum es NULL)");
    }

    if (!r.BPCode) {
      health = 'critical';
      issues.push("Sin Socio de Negocios de SAP vinculado (BPCode es NULL)");
    }

    // Comprobación de incongruencias detectadas en SAP
    if (r.AGCode === 'CTE00037' && r.RealBPNameInSAP && r.RealBPNameInSAP.includes('VILLA')) {
      issues.push("Código de cliente CTE00037 en SAP es 'Villa de los Niños', no La Latinoamericana");
    }

    if (r.PCIT_ItemsLinked === 0 && r.PCAG_TotalAttempts > 0) {
      if (health !== 'critical') health = 'critical';
      issues.push(`Se intentó ${r.PCAG_TotalAttempts} veces en cuentas de pacientes pero NUNCA aplicó a cargos`);
    }

    const canRepair = (
      r.ChargeMode === 'NL' || 
      r.AGITGR_Count === 0 || 
      !r.SUCode || 
      !r.PatientCareAgreement || 
      !r.PriceListNum
    );

    return {
      ...r,
      health,
      issues,
      canRepair,
      PriceFactor: r.PriceFactor !== null ? parseFloat(r.PriceFactor) : 1.0,
      GlobalDiscount: r.GlobalDiscount !== null ? parseFloat(r.GlobalDiscount) : 0.0
    };
  });

  // Métricas globales
  const total = audited.length;
  const critical = audited.filter(a => a.health === 'critical').length;
  const healthy = audited.filter(a => a.health === 'healthy').length;
  const inactive = audited.filter(a => a.health === 'inactive').length;
  const totalAttempts = audited.reduce((sum, a) => sum + (a.PCAG_TotalAttempts || 0), 0);
  const totalCancelled = audited.reduce((sum, a) => sum + (a.PCAG_Cancelled || 0), 0);

  return {
    metrics: {
      total,
      critical,
      healthy,
      inactive,
      totalAttempts,
      totalCancelled,
      successRate: totalAttempts > 0 ? (((totalAttempts - totalCancelled) / totalAttempts) * 100).toFixed(1) : 0
    },
    agreements: audited
  };
}

/**
 * Obtiene el historial de intentos de aplicación de convenios (exitosos y fallidos)
 */
async function getAgreementAttempts({ agCode = null, status = 'ALL', limit = 100 } = {}) {
  const whereClauses = [];

  if (agCode) {
    whereClauses.push('pa.AGCode = @agCode');
  }

  if (status === 'CA') {
    whereClauses.push("pa.PCAG_ST = 'CA'");
  } else if (status === 'AU') {
    whereClauses.push("pa.PCAG_ST = 'AU'");
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

  const query = `
    WITH top_pa AS (
      SELECT TOP (@limit)
        pa.PCNum, pa.PCAGNum, pa.AGCode, pa.BPCode, pa.PriceListNum,
        pa.PCAG_ST, pa.CreatedBy, pa.CreatedOn
      FROM dbo.PCAG pa
      ${whereSql}
      ORDER BY pa.CreatedOn DESC
    ), pcbl_agg AS (
      SELECT b.PCNum, b.PCAGNum,
        COUNT(*) AS BilledLinesCount,
        ISNULL(SUM(b.LineTotal), 0) AS BilledTotalAmount
      FROM dbo.PCBL b
      INNER JOIN top_pa pa ON pa.PCNum = b.PCNum AND pa.PCAGNum = b.PCAGNum
      GROUP BY b.PCNum, b.PCAGNum
    )
    SELECT
      pa.PCNum,
      pa.PCAGNum,
      pa.AGCode,
      a.AGName,
      pa.BPCode,
      bp.BPName,
      pa.PriceListNum,
      pa.PCAG_ST,
      pa.CreatedBy,
      pa.CreatedOn,
      pc.PC_ST AS AccountStatus,
      pc.Date AS AccountDate,
      pc.Total AS AccountTotal,
      pc.Balance AS AccountBalance,
      COALESCE(pcbl_agg.BilledLinesCount, 0) AS BilledLinesCount,
      COALESCE(pcbl_agg.BilledTotalAmount, 0) AS BilledTotalAmount
    FROM top_pa pa
    LEFT JOIN dbo.AG a ON pa.AGCode = a.AGCode
    LEFT JOIN dbo.PC pc ON pa.PCNum = pc.PCNum
    LEFT JOIN dbo.V_BP bp ON pa.BPCode = bp.BPCode
    LEFT JOIN pcbl_agg ON pcbl_agg.PCNum = pa.PCNum AND pcbl_agg.PCAGNum = pa.PCAGNum
    ORDER BY pa.CreatedOn DESC
  `;

  const result = await withRemotePool(pool => {
    const request = pool.request();
    if (agCode) request.input('agCode', sql.NVarChar(20), agCode);
    request.input('limit', sql.Int, safeLimit);
    return request.query(query);
  });

  const attempts = result.recordset.map(r => {
    const dUtc = new Date(r.CreatedOn);
    // Convertir a hora local México (UTC-6)
    const dLocal = new Date(dUtc.getTime() - (6 * 3600 * 1000));
    
    return {
      ...r,
      localDateString: dLocal.toISOString().replace('T', ' ').slice(0, 19),
      isSuccess: r.PCAG_ST === 'AU' && (r.BilledLinesCount > 0 || r.AccountStatus === 'CL'),
      isFailure: r.PCAG_ST === 'CA'
    };
  });

  return {
    totalReturned: attempts.length,
    attempts
  };
}

/**
 * Busca socios de negocio (BP / Clientes / Aseguradoras) en SAP
 */
async function searchBusinessPartners(search = '') {
  const term = `%${String(search).trim()}%`;

  const query = `
    SELECT TOP 25
      BPCode,
      BPName,
      BPType
    FROM dbo.V_BP
    WHERE (BPCode LIKE @term OR BPName LIKE @term)
      AND BPType = 'C'
      AND Enabled = 1
    ORDER BY BPName ASC
  `;

  const result = await withRemotePool(pool => {
    const request = pool.request();
    request.input('term', sql.NVarChar(100), term);
    return request.query(query);
  });
  return result.recordset;
}

/**
 * Repara automáticamente un convenio con fallas de configuración
 */
async function repairAgreement(agCode, username = 'SISTEMAS') {
  return withRemotePool(async pool => {
  // 1. Obtener datos actuales del convenio
  const checkReq = pool.request();
  checkReq.input('agCode', sql.NVarChar(20), agCode);
  const currentRes = await checkReq.query("SELECT * FROM dbo.AG WHERE AGCode = @agCode");

  if (currentRes.recordset.length === 0) {
    throw new Error(`El convenio '${agCode}' no existe.`);
  }

  const ag = currentRes.recordset[0];
  const targetFactor = ag.PriceFactor && ag.PriceFactor > 0 ? ag.PriceFactor : 1.0;
  const targetDiscount = ag.GlobalDiscount !== null ? ag.GlobalDiscount : 0.0;
  const targetSU = ag.SUCode || 'ADM';
  const targetPL = ag.PriceListNum || 2;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // A. Actualizar cabecera en dbo.AG
    const updateReq = new sql.Request(transaction);
    updateReq.input('agCode', sql.NVarChar(20), agCode);
    updateReq.input('suCode', sql.NVarChar(20), targetSU);
    updateReq.input('priceListNum', sql.Int, targetPL);
    updateReq.input('user', sql.NVarChar(256), username);

    await updateReq.query(`
      UPDATE dbo.AG
      SET 
        ChargeMode = 'LD',
        AG_ST = 'AC',
        PatientCareAgreement = 1,
        SalesOrderAgreement = 1,
        SUCode = @suCode,
        PriceListNum = @priceListNum,
        ApplyPriceFactorToCustomPrices = 1,
        ModifiedBy = @user,
        ModifiedOn = GETDATE()
      WHERE AGCode = @agCode
    `);

    // B. Revisar registros en dbo.AGITGR
    const grReq = new sql.Request(transaction);
    grReq.input('agCode', sql.NVarChar(20), agCode);
    const grRes = await grReq.query("SELECT COUNT(*) as cnt FROM dbo.AGITGR WHERE AGCode = @agCode");
    const existingCount = grRes.recordset[0].cnt;

    let groupsRepaired = 0;

    if (existingCount === 0) {
      // Insertar los 37 grupos hospitalarios estándar
      for (const groupCode of STANDARD_ITEM_GROUPS) {
        const insReq = new sql.Request(transaction);
        insReq.input('agCode', sql.NVarChar(20), agCode);
        insReq.input('groupCode', sql.NVarChar(20), groupCode);
        insReq.input('factor', sql.Decimal(18, 4), targetFactor);
        insReq.input('discount', sql.Decimal(18, 4), targetDiscount);
        insReq.input('user', sql.NVarChar(256), username);

        await insReq.query(`
          INSERT INTO dbo.AGITGR (
            AGCode, ItemGroupCode, AgreementGroupName, ServiceAlias, ServiceDescription,
            Coverage, Deductible, Copay, CopayPercentage, Discount, CausesAdministrativeCharge,
            TaxCode, PriceFactor, ChargeCode, PLPercentage, PLSurcharge, CreatedBy, CreatedOn,
            ModifiedBy, ModifiedOn, ApplyPriceFactorToCustomPrices
          ) VALUES (
            @agCode, @groupCode, NULL, NULL, NULL,
            100.0, 0.0, 0.0, NULL, @discount, 0,
            NULL, @factor, NULL, NULL, NULL, @user, GETDATE(),
            @user, GETDATE(), 1
          )
        `);
        groupsRepaired++;
      }
    } else {
      // Actualizar los grupos existentes para aplicar el factor y descuento de cabecera si estaban en ceros
      const updGrReq = new sql.Request(transaction);
      updGrReq.input('agCode', sql.NVarChar(20), agCode);
      updGrReq.input('factor', sql.Decimal(18, 4), targetFactor);
      updGrReq.input('discount', sql.Decimal(18, 4), targetDiscount);
      updGrReq.input('user', sql.NVarChar(256), username);

      await updGrReq.query(`
        UPDATE dbo.AGITGR
        SET 
          Coverage = 100.0,
          PriceFactor = @factor,
          Discount = @discount,
          ModifiedBy = @user,
          ModifiedOn = GETDATE()
        WHERE AGCode = @agCode
      `);
      groupsRepaired = existingCount;
    }

    await transaction.commit();

    return {
      success: true,
      message: `Convenio '${agCode}' reparado con éxito. Se configuró ChargeMode='LD', SUCode='${targetSU}', PatientCareAgreement=1 y se sincronizaron ${groupsRepaired} grupos en AGITGR (Factor: ${targetFactor}, Descuento: ${targetDiscount}%).`,
      agCode,
      groupsRepaired
    };

  } catch (err) {
    await transaction.rollback();
    throw new Error(`Error durante la reparación del convenio: ${err.message}`);
  }
  });
}

/**
 * Crea un convenio o acuerdo nuevo de forma atómica y completa en Vertical
 */
async function createAgreement(data, username = 'SISTEMAS') {
  const {
    agCode,
    agName,
    bpCode,
    priceListNum = 2,
    priceFactor = 1.0,
    globalDiscount = 0.0,
    suCode = 'ADM',
    deductible = 'SER0719',
    copayAmount = 'SER0717',
    patientCareAgreement = true,
    salesOrderAgreement = true
  } = data;

  if (!agCode || !agCode.trim()) throw new Error('El código del convenio (AGCode) es obligatorio.');
  if (!agName || !agName.trim()) throw new Error('El nombre del convenio (AGName) es obligatorio.');
  if (!bpCode || !bpCode.trim()) throw new Error('El socio de negocios SAP (BPCode) es obligatorio.');

  const cleanCode = agCode.trim().toUpperCase();

  return withRemotePool(async pool => {
  // 1. Validar que no exista
  const checkReq = pool.request();
  checkReq.input('agCode', sql.NVarChar(20), cleanCode);
  const exists = await checkReq.query("SELECT 1 FROM dbo.AG WHERE AGCode = @agCode");
  if (exists.recordset.length > 0) {
    throw new Error(`Ya existe un convenio registrado con el código '${cleanCode}'.`);
  }

  // 2. Validar socio en V_BP
  const bpReq = pool.request();
  bpReq.input('bpCode', sql.NVarChar(20), bpCode.trim());
  const bpExists = await bpReq.query("SELECT BPCode, BPName FROM dbo.V_BP WHERE BPCode = @bpCode");
  if (bpExists.recordset.length === 0) {
    throw new Error(`El socio de negocios '${bpCode}' no existe en el catálogo de SAP (V_BP).`);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // Insertar en dbo.AG
    const insAgReq = new sql.Request(transaction);
    insAgReq.input('agCode', sql.NVarChar(20), cleanCode);
    insAgReq.input('agName', sql.NVarChar(128), agName.trim());
    insAgReq.input('bpCode', sql.NVarChar(20), bpCode.trim());
    insAgReq.input('priceListNum', sql.Int, parseInt(priceListNum, 10) || 2);
    insAgReq.input('priceFactor', sql.Decimal(18, 4), parseFloat(priceFactor) || 1.0);
    insAgReq.input('globalDiscount', sql.Decimal(18, 4), parseFloat(globalDiscount) || 0.0);
    insAgReq.input('suCode', sql.NVarChar(20), suCode ? suCode.trim() : 'ADM');
    insAgReq.input('deductible', sql.NVarChar(64), deductible || null);
    insAgReq.input('copayAmount', sql.NVarChar(64), copayAmount || null);
    insAgReq.input('patientCare', sql.Bit, patientCareAgreement ? 1 : 0);
    insAgReq.input('salesOrder', sql.Bit, salesOrderAgreement ? 1 : 0);
    insAgReq.input('user', sql.NVarChar(256), username);

    await insAgReq.query(`
      INSERT INTO dbo.AG (
        FCCode, AGCode, AGName, SUCode, PatientAgreement, BPCode, PLBPCode,
        PriceListNum, TaxCode, TaxRate, ChargeMode, AGPRCode, ContractorName,
        Deductible, CopayAmount, CopayPercentage, Coinsurance, CoinsurancePercentage,
        AdministrativeCharge, AdministrativeChargeAmount, AdministrativeChargePercent,
        AdministrativeChargeMin, AdministrativeChargeMax, GlobalDiscount,
        AdditionalDiscount01, AdditionalDiscount02, AdditionalDiscount03,
        PriceFactor, PatientCareAgreement, SalesOrderAgreement, AllowExpressAuthorization,
        PLCode, PLVersion, PLFactor, PLSurcharge, DefaultMinimumBase, DefaultDeductible,
        DefaultCopayAmount, DefaultCopayPercentage, DefaultCoinsurancePercentage,
        DocType, AG_ST, CreatedBy, CreatedOn, ModifiedBy, ModifiedOn,
        AdministrativeChargeDescription, ApplyPriceFactorToCustomPrices
      ) VALUES (
        NULL, @agCode, @agName, @suCode, 0, @bpCode, NULL,
        @priceListNum, NULL, 0, 'LD', NULL, NULL,
        @deductible, @copayAmount, NULL, NULL, NULL,
        NULL, 0, 0,
        NULL, NULL, @globalDiscount,
        NULL, NULL, NULL,
        @priceFactor, @patientCare, @salesOrder, 0,
        NULL, NULL, NULL, NULL, 0, 0,
        0, 0, 0,
        'SalesOrder', 'AC', @user, GETDATE(), @user, GETDATE(),
        NULL, 1
      )
    `);

    // Insertar automáticamente los 37 grupos en dbo.AGITGR
    for (const groupCode of STANDARD_ITEM_GROUPS) {
      const insGrReq = new sql.Request(transaction);
      insGrReq.input('agCode', sql.NVarChar(20), cleanCode);
      insGrReq.input('groupCode', sql.NVarChar(20), groupCode);
      insGrReq.input('factor', sql.Decimal(18, 4), parseFloat(priceFactor) || 1.0);
      insGrReq.input('discount', sql.Decimal(18, 4), parseFloat(globalDiscount) || 0.0);
      insGrReq.input('user', sql.NVarChar(256), username);

      await insGrReq.query(`
        INSERT INTO dbo.AGITGR (
          AGCode, ItemGroupCode, AgreementGroupName, ServiceAlias, ServiceDescription,
          Coverage, Deductible, Copay, CopayPercentage, Discount, CausesAdministrativeCharge,
          TaxCode, PriceFactor, ChargeCode, PLPercentage, PLSurcharge, CreatedBy, CreatedOn,
          ModifiedBy, ModifiedOn, ApplyPriceFactorToCustomPrices
        ) VALUES (
          @agCode, @groupCode, NULL, NULL, NULL,
          100.0, 0.0, 0.0, NULL, @discount, 0,
          NULL, @factor, NULL, NULL, NULL, @user, GETDATE(),
          @user, GETDATE(), 1
        )
      `);
    }

    await transaction.commit();

    return {
      success: true,
      message: `Convenio '${cleanCode}' - ${agName} creado exitosamente con 37 grupos tarifarios sincronizados.`,
      agCode: cleanCode
    };

  } catch (err) {
    await transaction.rollback();
    throw new Error(`Fallo al crear el convenio: ${err.message}`);
  }
  });
}

module.exports = {
  getAgreementsAudit,
  getAgreementAttempts,
  searchBusinessPartners,
  repairAgreement,
  createAgreement
};
