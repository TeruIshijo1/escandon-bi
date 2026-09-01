const { Pool, types } = require('pg');

// INT8 (bigint) → number para que COUNT(*) etc. no lleguen como strings
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

// Configuración del Pool de PostgreSQL para el Data Warehouse
const pool = new Pool({
  user:     process.env.PGUSER     || 'postgres',
  host:     process.env.PGHOST     || 'localhost',
  database: process.env.PGDATABASE || 'escandon_bi',
  port:     parseInt(process.env.PGPORT || '5432', 10),
  ...(process.env.PGPASSWORD ? { password: process.env.PGPASSWORD } : {}),
});

// Hora local del hospital para consultas consistentes
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'America/Mexico_City'").catch(() => {});
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL:', err.message || err);
});

async function initPostgresDW() {
  try {
    console.log('⏳ Inicializando tablas del Data Warehouse en PostgreSQL...');
    
    // Tabla para Ingresos (ORCT)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sap_incoming_payments (
        DocEntry INT PRIMARY KEY,
        DocNum INT NOT NULL,
        DocDate DATE NOT NULL,
        CardCode VARCHAR(50),
        CardName VARCHAR(255),
        CashSum DECIMAL(18,2) DEFAULT 0,
        CreditSum DECIMAL(18,2) DEFAULT 0,
        CheckSum DECIMAL(18,2) DEFAULT 0,
        TrsfrSum DECIMAL(18,2) DEFAULT 0,
        DocTotal DECIMAL(18,2) DEFAULT 0,
        U_NumCta VARCHAR(50),
        CounterReference VARCHAR(50),
        Canceled VARCHAR(1) DEFAULT 'N',
        SyncDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla para Egresos (OPCH)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sap_purchase_invoices (
        DocEntry INT PRIMARY KEY,
        DocNum INT NOT NULL,
        DocDate DATE NOT NULL,
        CardCode VARCHAR(50),
        CardName VARCHAR(255),
        DocTotal DECIMAL(18,2) DEFAULT 0,
        Canceled VARCHAR(1) DEFAULT 'N',
        SyncDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Índices para optimizar las consultas de fechas
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sap_in_date ON sap_incoming_payments (DocDate);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sap_out_date ON sap_purchase_invoices (DocDate);`);

    // --- TABLAS PARA LOS TABLEROS DE CONTROL ---
    
    // Tabla PC (Cuentas)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_vertical_pc (
        pcnum INT PRIMARY KEY,
        pc_st VARCHAR(10),
        medicaldischargedate TIMESTAMP WITH TIME ZONE,
        entrydate TIMESTAMP WITH TIME ZONE,
        total DECIMAL(18,4) DEFAULT 0,
        profit DECIMAL(18,4) DEFAULT 0,
        subtotalcost DECIMAL(18,4) DEFAULT 0,
        balance DECIMAL(18,4) DEFAULT 0,
        ptnum INT,
        bpcode VARCHAR(50),
        pctype VARCHAR(10),
        createdon TIMESTAMP WITH TIME ZONE,
        prnum INT,
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla PT (Pacientes y su última habitación)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_vertical_pt (
        ptnum INT PRIMARY KEY,
        fullname VARCHAR(255),
        statecode VARCHAR(50),
        city VARCHAR(100),
        birthdate TIMESTAMP WITH TIME ZONE,
        roomcode VARCHAR(50),
        roomname VARCHAR(100),
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla PCIT (Ítems de Cuenta)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_vertical_pcit (
        pcitnum INT PRIMARY KEY,
        pcnum INT,
        chargedate TIMESTAMP WITH TIME ZONE,
        sucode VARCHAR(50),
        itemcode VARCHAR(100),
        itemdescription TEXT,
        quantity DECIMAL(18,4) DEFAULT 0,
        unitprice DECIMAL(18,4) DEFAULT 0,
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla Indicadores Operativos (Eficiencia)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_vertical_indicadores_operativos (
        anio INT,
        mes INT,
        fechaperiodo DATE PRIMARY KEY,
        camasocupadas INT,
        quirofanosactivos INT,
        urgencias INT,
        hospitalizacion INT,
        triajemin DECIMAL(18,4),
        triajemeta DECIMAL(18,4),
        triajeoutliers INT,
        triajeregistros INT,
        laboratoriomin DECIMAL(18,4),
        laboratoriometa DECIMAL(18,4),
        laboratoriooutliers INT,
        laboratorioregistros INT,
        imagenologiamin DECIMAL(18,4),
        imagenologiameta DECIMAL(18,4),
        imagenologiaoutliers INT,
        imagenologiaregistros INT,
        egresohoras DECIMAL(18,4),
        egresometa DECIMAL(18,4),
        egresoregistros INT,
        estadotriaje VARCHAR(50),
        estadolaboratorio VARCHAR(50),
        estadoimagenologia VARCHAR(50),
        estadoegreso VARCHAR(50),
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla Cuentas Servicios (Urgencias, Consulta Externa, Cuneros, Quirófano)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_vertical_cuentas_servicios (
        id SERIAL PRIMARY KEY,
        fecha_de_modificacion TIMESTAMP WITH TIME ZONE,
        unidad_de_servicio VARCHAR(50),
        fecha_de_cargo TIMESTAMP WITH TIME ZONE,
        nombre_del_paciente VARCHAR(255),
        folio_de_atencion INT,
        numero_de_orden INT,
        numero_de_cargo INT,
        estatus_ch VARCHAR(50),
        fecha_cerrado_ch TIMESTAMP WITH TIME ZONE,
        minutos INT,
        agcode VARCHAR(50),
        grupo_de_articulos VARCHAR(100),
        codigo VARCHAR(100),
        descripcion_del_articulo VARCHAR(255),
        cantidad DECIMAL(18,4) DEFAULT 0,
        devuelto DECIMAL(18,4) DEFAULT 0,
        total DECIMAL(18,4) DEFAULT 0,
        precio_unitario DECIMAL(18,4) DEFAULT 0,
        precio_ch DECIMAL(18,4) DEFAULT 0,
        cantidad_total DECIMAL(18,4) DEFAULT 0,
        tasa_de_descuento DECIMAL(18,4) DEFAULT 0,
        total_sin_desc DECIMAL(18,4) DEFAULT 0,
        descuento DECIMAL(18,4) DEFAULT 0,
        total_cobrado DECIMAL(18,4) DEFAULT 0,
        total_a_pagar_al_subrogado DECIMAL(18,4) DEFAULT 0,
        pr_pc INT,
        medico_solicitante VARCHAR(255),
        medico_tratante VARCHAR(255),
        anestesiologo VARCHAR(255),
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla Productividad Médicos (Eficacia)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_vertical_productividad_medicos (
        id SERIAL PRIMARY KEY,
        medico VARCHAR(255),
        especialidad VARCHAR(255),
        fecha DATE,
        primeras INT DEFAULT 0,
        subsecuentes INT DEFAULT 0,
        totalatenciones INT DEFAULT 0,
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla Consulta del Día (Eficacia / CEX)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_vertical_consulta_dia (
        numero_cita INT PRIMARY KEY,
        folio_medico INT,
        medico VARCHAR(255),
        msdescription_es VARCHAR(255),
        fecha DATE,
        hora VARCHAR(20),
        numero_paciente INT,
        paciente VARCHAR(255),
        edad_anios VARCHAR(50),
        telefono_1 VARCHAR(50),
        celular_2 VARCHAR(50),
        estatus_orden_venta VARCHAR(100),
        articulo VARCHAR(255),
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla Solicitudes Estudios (Auxiliares)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_vertical_solicitudes_estudios (
        pcpritnum INT PRIMARY KEY,
        estudio VARCHAR(255),
        sucode VARCHAR(50),
        areanombre VARCHAR(100),
        medico VARCHAR(255),
        tipoatencion VARCHAR(50),
        fecha DATE,
        cantidad DECIMAL(18,4) DEFAULT 0,
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla Detalle Auxiliares e Insumos (Auxiliares / Cuneros)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_vertical_pay_ima (
        pcitnum INT PRIMARY KEY,
        sucode VARCHAR(50),
        linetype VARCHAR(50),
        fullname VARCHAR(255),
        itemcode VARCHAR(100),
        itemdescription VARCHAR(255),
        quantity DECIMAL(18,4) DEFAULT 0,
        linetotal DECIMAL(18,4) DEFAULT 0,
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla Consultas Programadas (Consulta Externa)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_vertical_consultas_prog (
        no_cita INT PRIMARY KEY,
        no_medico INT,
        medico VARCHAR(255),
        especialidad VARCHAR(255),
        nopaciente INT,
        paciente VARCHAR(255),
        desdefecha TIMESTAMP WITH TIME ZONE,
        hastafecha TIMESTAMP WITH TIME ZONE,
        pcap_st_descripcion VARCHAR(100),
        ps VARCHAR(50),
        dx_description_es TEXT,
        comentarios TEXT,
        telefono_1 VARCHAR(100),
        celular_2 VARCHAR(100),
        articulo VARCHAR(255),
        edad_anios VARCHAR(50),
        edad_mes VARCHAR(50),
        genero VARCHAR(10),
        consultas_previas INT,
        convenio VARCHAR(255),
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabla SAP Ingresos Grupos (Urgencias / Cuneros)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_sap_ingresos_grupos (
        id SERIAL PRIMARY KEY,
        itmsgrpcod INT,
        docdate DATE,
        total DECIMAL(18,4) DEFAULT 0,
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(itmsgrpcod, docdate)
      );
    `);

    // Tabla SAP Quirófano Analíticas (Caché Quirófano)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_sap_quirofano_analiticas (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(50),
        nombre VARCHAR(255),
        ingresos DECIMAL(18,4) DEFAULT 0,
        startdate DATE,
        enddate DATE,
        sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tipo, nombre, startdate, enddate)
      );
    `);

    // Índices de tableros para optimización de consultas
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_v_pc_date ON dw_vertical_pc (entrydate);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_v_pc_ptnum ON dw_vertical_pc (ptnum);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_v_pcit_pcnum ON dw_vertical_pcit (pcnum);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_v_cs_fecha ON dw_vertical_cuentas_servicios (fecha_de_cargo);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_v_cs_unidad ON dw_vertical_cuentas_servicios (unidad_de_servicio);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_v_prod_fecha ON dw_vertical_productividad_medicos (fecha);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_v_cons_fecha ON dw_vertical_consulta_dia (fecha);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_v_sol_fecha ON dw_vertical_solicitudes_estudios (fecha);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_v_prog_fecha ON dw_vertical_consultas_prog (desdefecha);`);

    // --- NUEVAS TABLAS DE NEGOCIO MIGRADAS DE SQLITE ---

    // 1. Tabla SAP Traslados
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_sap_traslados (
        docentry INT PRIMARY KEY,
        docnum INT,
        docdate TIMESTAMP WITH TIME ZONE,
        duedate TIMESTAMP WITH TIME ZONE,
        fromwarehouse VARCHAR(50),
        towarehouse VARCHAR(50),
        documentstatus VARCHAR(50),
        comments TEXT,
        requester VARCHAR(100),
        requestername VARCHAR(255),
        stocktransferlines TEXT,
        lastsync TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Tabla Cirrus Censo
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_cirrus_censo (
        cuentahospitalaria VARCHAR(100) PRIMARY KEY,
        nombrepaciente VARCHAR(255),
        habitacion VARCHAR(50),
        fechaingreso TIMESTAMP WITH TIME ZONE,
        lastsync TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Tabla Cirrus Consumo
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_cirrus_consumo (
        idcargo SERIAL PRIMARY KEY,
        cuentahospitalaria VARCHAR(100),
        fechacargo TIMESTAMP WITH TIME ZONE,
        codigo VARCHAR(100),
        insumo VARCHAR(255),
        cantidad DECIMAL(18,4) DEFAULT 0,
        preciounitario DECIMAL(18,4) DEFAULT 0,
        montocobrado DECIMAL(18,4) DEFAULT 0,
        lote VARCHAR(100),
        caducidad VARCHAR(100),
        paciente VARCHAR(255),
        habitacion VARCHAR(50),
        medico VARCHAR(255),
        usuariocargo VARCHAR(100),
        lastsync TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Tabla SAP Kardex
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_sap_kardex (
        idkardex SERIAL PRIMARY KEY,
        codigo VARCHAR(100),
        descripcion VARCHAR(255),
        almacenorigen VARCHAR(255),
        almacendestino VARCHAR(255),
        documentoref VARCHAR(100),
        existencias DECIMAL(18,4) DEFAULT 0,
        fecha TIMESTAMP WITH TIME ZONE,
        servicio VARCHAR(100),
        usuario VARCHAR(100),
        movimiento DECIMAL(18,4) DEFAULT 0,
        valoracumulado DECIMAL(18,4) DEFAULT 0,
        lastsync TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Tabla SAP Entradas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_sap_entradas (
        identrada SERIAL PRIMARY KEY,
        fecha TIMESTAMP WITH TIME ZONE,
        numeroentrada VARCHAR(100),
        numerofactura VARCHAR(100),
        nombreproveedor VARCHAR(255),
        codigo VARCHAR(100),
        descripcion VARCHAR(255),
        cantidadarticulos DECIMAL(18,4) DEFAULT 0,
        preciounitario DECIMAL(18,4) DEFAULT 0,
        importefactura DECIMAL(18,4) DEFAULT 0,
        almacenreceptor VARCHAR(255),
        lastsync TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. Tabla SAP Reorder Settings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_sap_reorder_settings (
        itemcode VARCHAR(100) PRIMARY KEY,
        itemdescription VARCHAR(255),
        minstock INT DEFAULT 0,
        maxstock INT DEFAULT 0,
        note TEXT DEFAULT '',
        customsolicitud INT DEFAULT NULL,
        lastupdated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6b. Snapshot persistente del inventario SAP (fallback offline cuando SAP no responde)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_sap_inventory_cache (
        itemcode VARCHAR(100),
        itemname TEXT,
        whscode VARCHAR(20),
        quantity DECIMAL(18,4) DEFAULT 0,
        avgprice DECIMAL(18,4) DEFAULT 0,
        salesprice DECIMAL(18,4) DEFAULT 0,
        price_pg DECIMAL(18,4) DEFAULT 0,
        price_hos DECIMAL(18,4) DEFAULT 0,
        medicalclassification VARCHAR(20),
        secondaryclassification VARCHAR(20),
        lastsync TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`ALTER TABLE dw_sap_inventory_cache ADD COLUMN IF NOT EXISTS price_pg DECIMAL(18,4) DEFAULT 0;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_sap_inventory_cache ADD COLUMN IF NOT EXISTS price_hos DECIMAL(18,4) DEFAULT 0;`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_sap_inv_cache_code ON dw_sap_inventory_cache (itemcode, whscode);`);

    // 6c. Vínculos manuales producto-Excel -> código SAP (Configuración Dinámica Farmacia)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_reorder_excel_map (
        producto VARCHAR(255) PRIMARY KEY,
        itemcode VARCHAR(100),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. Tabla SAP Pedidos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_sap_pedidos (
        dockey VARCHAR(100) PRIMARY KEY,
        docentry INT,
        docnum INT,
        tipodocumento VARCHAR(50),
        tiponombre VARCHAR(100),
        fechadoc TIMESTAMP WITH TIME ZONE,
        cardcode VARCHAR(50),
        cardname VARCHAR(255),
        usersign INT,
        usuarionombre VARCHAR(255),
        docstatus VARCHAR(50),
        doctotal DECIMAL(18,4) DEFAULT 0,
        estatustexto VARCHAR(100),
        itemsjson TEXT,
        lastsync TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 8. Tabla Recetas Ocultas (hidden prescriptions)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dw_hidden_prescriptions (
        pcprit_num VARCHAR(100) PRIMARY KEY,
        hidden_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 9. Tabla Analítica para Machine Learning (Paso 1 DataScience)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ml_dataset_reorden_sku (
        itemcode VARCHAR(100) PRIMARY KEY,
        itemdescription TEXT,
        stock_actual DECIMAL(18,4) DEFAULT 0,
        consumo_7d DECIMAL(18,4) DEFAULT 0,
        consumo_15d DECIMAL(18,4) DEFAULT 0,
        consumo_30d DECIMAL(18,4) DEFAULT 0,
        consumo_promedio_diario DECIMAL(18,4) DEFAULT 0,
        variabilidad_consumo DECIMAL(18,4) DEFAULT 0,
        minstock INT DEFAULT 0,
        maxstock INT DEFAULT 0,
        pedidos_abiertos DECIMAL(18,4) DEFAULT 0,
        fecha_ultimo_movimiento TIMESTAMP WITH TIME ZONE,
        fecha_desabasto TIMESTAMP WITH TIME ZONE,
        dias_stock_restante DECIMAL(18,4) DEFAULT 0,
        riesgo_base VARCHAR(20),
        fecha_calculo TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 10. Tabla Histórica para Entrenamiento de Machine Learning (Paso 2 DataScience)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ml_dataset_reorden_sku_history (
        snapshot_date DATE NOT NULL,
        itemcode VARCHAR(100) NOT NULL,
        itemdescription TEXT,
        stock_actual DECIMAL(18,4) DEFAULT 0,
        consumo_7d DECIMAL(18,4) DEFAULT 0,
        consumo_15d DECIMAL(18,4) DEFAULT 0,
        consumo_30d DECIMAL(18,4) DEFAULT 0,
        consumo_promedio_diario DECIMAL(18,4) DEFAULT 0,
        variabilidad_consumo DECIMAL(18,4) DEFAULT 0,
        minstock INT DEFAULT 0,
        maxstock INT DEFAULT 0,
        pedidos_abiertos DECIMAL(18,4) DEFAULT 0,
        fecha_ultimo_movimiento TIMESTAMP WITH TIME ZONE,
        fecha_desabasto TIMESTAMP WITH TIME ZONE,
        dias_stock_restante DECIMAL(18,4) DEFAULT 0,
        riesgo_base VARCHAR(20),
        target_desabasto_7d INT DEFAULT NULL,
        target_desabasto_15d INT DEFAULT NULL,
        fecha_calculo TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (snapshot_date, itemcode)
      );
    `);

    // 11. Tabla de Predicciones de Machine Learning (Paso 3 DataScience)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ml_predictions_reorden_sku (
        itemcode VARCHAR(100) PRIMARY KEY,
        itemdescription TEXT,
        stock_actual DECIMAL(18,4),
        consumo_promedio_diario DECIMAL(18,4),
        dias_stock_restante DECIMAL(18,4),
        riesgo_base VARCHAR(20),
        prob_desabasto_7d DECIMAL(8,6),
        riesgo_ml VARCHAR(20),
        modelo_version VARCHAR(50),
        fecha_ultimo_movimiento TIMESTAMP WITH TIME ZONE,
        fecha_desabasto TIMESTAMP WITH TIME ZONE,
        fecha_estimada_agotamiento TIMESTAMP WITH TIME ZONE,
        fecha_prediccion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 12. Historial de corridas de entrenamiento ML (Paso 8 DataScience)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ml_model_runs (
        run_id SERIAL PRIMARY KEY,
        modelo_version VARCHAR(100),
        fecha_entrenamiento TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        train_rows INT DEFAULT 0,
        test_rows INT DEFAULT 0,
        precision DECIMAL(8,6),
        recall DECIMAL(8,6),
        f1 DECIMAL(8,6),
        roc_auc DECIMAL(8,6),
        baseline_f1 DECIMAL(8,6),
        notas TEXT
      );
    `);

    // 13. Dataset Histórico Mensual de Ingresos (Paso F1 DataScience)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ml_dataset_ingresos_mensual (
        periodo_mes VARCHAR(7), -- Formato 'YYYY-MM'
        area VARCHAR(100), -- 'GENERAL' o áreas específicas
        servicio VARCHAR(100), -- 'TODOS' o servicios específicos
        ingresos_total DECIMAL(18,4) DEFAULT 0,
        num_cuentas INT DEFAULT 0,
        num_pacientes INT DEFAULT 0,
        ticket_promedio DECIMAL(18,4) DEFAULT 0,
        ingresos_mes_anterior DECIMAL(18,4) DEFAULT 0,
        crecimiento_mensual DECIMAL(8,4) DEFAULT 0,
        dia_habil_count INT DEFAULT 0,
        festivos_count INT DEFAULT 0,
        fecha_calculo TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (periodo_mes, area, servicio)
      );
    `);

    // 14. Predicciones/Forecast de Ingresos (Paso F3 DataScience)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ml_forecast_ingresos_mensual (
        periodo_predicho VARCHAR(7), -- Formato 'YYYY-MM'
        area VARCHAR(100),
        servicio VARCHAR(100),
        ingreso_estimado DECIMAL(18,4) DEFAULT 0,
        intervalo_bajo DECIMAL(18,4) DEFAULT 0,
        intervalo_alto DECIMAL(18,4) DEFAULT 0,
        modelo_version VARCHAR(50),
        metodo VARCHAR(50),
        fecha_prediccion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (periodo_predicho, area, servicio)
      );
    `);

    // 15. Monitoreo y Registro de Ejecución de Jobs ML (Paso F4/Almacén DataScience)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ml_job_runs (
        job_id SERIAL PRIMARY KEY,
        job_name VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        triggered_by VARCHAR(100) DEFAULT 'SYSTEM',
        started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP WITH TIME ZONE,
        duration_seconds DECIMAL(10,2),
        stdout TEXT,
        stderr TEXT,
        error_message TEXT
      );
    `);

    // Índices para mejorar las consultas en las nuevas tablas
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_sap_t_date ON dw_sap_traslados (docdate);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_c_cons_cuenta ON dw_cirrus_consumo (cuentahospitalaria);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_sap_k_fecha ON dw_sap_kardex (fecha);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_sap_k_code ON dw_sap_kardex (codigo);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dw_sap_e_factura ON dw_sap_entradas (numerofactura);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ml_hist_code ON ml_dataset_reorden_sku_history (itemcode);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ml_hist_date ON ml_dataset_reorden_sku_history (snapshot_date);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ml_job_runs_name_status ON ml_job_runs (job_name, status, started_at DESC);`);

    // Migraciones: columnas para soporte de modelos de regresión en ml_model_runs
    await pool.query(`ALTER TABLE ml_model_runs ADD COLUMN IF NOT EXISTS model_type VARCHAR(50);`).catch(() => {});
    await pool.query(`ALTER TABLE ml_model_runs ADD COLUMN IF NOT EXISTS mae DECIMAL(18,4);`).catch(() => {});
    await pool.query(`ALTER TABLE ml_model_runs ADD COLUMN IF NOT EXISTS rmse DECIMAL(18,4);`).catch(() => {});
    await pool.query(`ALTER TABLE ml_model_runs ADD COLUMN IF NOT EXISTS r2 DECIMAL(8,6);`).catch(() => {});

    // Migraciones: ampliar columnas VARCHAR(50) a VARCHAR(255) en tablas existentes
    await pool.query(`ALTER TABLE dw_sap_kardex ALTER COLUMN almacenorigen TYPE VARCHAR(255);`).catch(() => {});
    await pool.query(`ALTER TABLE dw_sap_kardex ALTER COLUMN almacendestino TYPE VARCHAR(255);`).catch(() => {});
    await pool.query(`ALTER TABLE dw_sap_entradas ALTER COLUMN almacenreceptor TYPE VARCHAR(255);`).catch(() => {});

    // Migraciones: columna fecha_desabasto (fecha en la que el SKU se agotó) en tablas ML
    await pool.query(`ALTER TABLE ml_dataset_reorden_sku ADD COLUMN IF NOT EXISTS fecha_desabasto TIMESTAMP WITH TIME ZONE;`).catch(() => {});
    await pool.query(`ALTER TABLE ml_dataset_reorden_sku_history ADD COLUMN IF NOT EXISTS fecha_desabasto TIMESTAMP WITH TIME ZONE;`).catch(() => {});
    await pool.query(`ALTER TABLE ml_predictions_reorden_sku ADD COLUMN IF NOT EXISTS fecha_desabasto TIMESTAMP WITH TIME ZONE;`).catch(() => {});
    await pool.query(`ALTER TABLE ml_predictions_reorden_sku ADD COLUMN IF NOT EXISTS fecha_estimada_agotamiento TIMESTAMP WITH TIME ZONE;`).catch(() => {});

    // Nuevas migraciones a TEXT para evitar truncamientos y errores de inserción
    await pool.query(`ALTER TABLE dw_vertical_consulta_dia ALTER COLUMN medico TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_consulta_dia ALTER COLUMN msdescription_es TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_consulta_dia ALTER COLUMN paciente TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_consulta_dia ALTER COLUMN edad_anios TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_consulta_dia ALTER COLUMN telefono_1 TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_consulta_dia ALTER COLUMN celular_2 TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_consulta_dia ALTER COLUMN estatus_orden_venta TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_consulta_dia ALTER COLUMN articulo TYPE TEXT;`).catch(() => {});

    await pool.query(`ALTER TABLE dw_vertical_solicitudes_estudios ALTER COLUMN estudio TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_solicitudes_estudios ALTER COLUMN medico TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_solicitudes_estudios ALTER COLUMN areanombre TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_solicitudes_estudios ALTER COLUMN tipoatencion TYPE TEXT;`).catch(() => {});

    await pool.query(`ALTER TABLE dw_vertical_cuentas_servicios ALTER COLUMN nombre_del_paciente TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_cuentas_servicios ALTER COLUMN descripcion_del_articulo TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_cuentas_servicios ALTER COLUMN medico_solicitante TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_cuentas_servicios ALTER COLUMN medico_tratante TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_cuentas_servicios ALTER COLUMN anestesiologo TYPE TEXT;`).catch(() => {});

    await pool.query(`ALTER TABLE dw_vertical_productividad_medicos ALTER COLUMN medico TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_productividad_medicos ALTER COLUMN especialidad TYPE TEXT;`).catch(() => {});

    await pool.query(`ALTER TABLE dw_vertical_pt ALTER COLUMN fullname TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_vertical_pt ALTER COLUMN roomname TYPE TEXT;`).catch(() => {});

    await pool.query(`ALTER TABLE sap_incoming_payments ALTER COLUMN CardName TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE sap_purchase_invoices ALTER COLUMN CardName TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_sap_quirofano_analiticas ALTER COLUMN nombre TYPE TEXT;`).catch(() => {});
    
    await pool.query(`ALTER TABLE dw_cirrus_consumo ALTER COLUMN insumo TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_cirrus_consumo ALTER COLUMN paciente TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_cirrus_consumo ALTER COLUMN medico TYPE TEXT;`).catch(() => {});
    
    await pool.query(`ALTER TABLE dw_sap_kardex ALTER COLUMN descripcion TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_sap_kardex ALTER COLUMN almacenorigen TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_sap_kardex ALTER COLUMN almacendestino TYPE TEXT;`).catch(() => {});
    
    await pool.query(`ALTER TABLE dw_sap_entradas ALTER COLUMN nombreproveedor TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_sap_entradas ALTER COLUMN descripcion TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_sap_entradas ALTER COLUMN almacenreceptor TYPE TEXT;`).catch(() => {});
    
    await pool.query(`ALTER TABLE dw_sap_reorder_settings ALTER COLUMN itemdescription TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_sap_pedidos ALTER COLUMN cardname TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE dw_sap_pedidos ALTER COLUMN usuarionombre TYPE TEXT;`).catch(() => {});

    // Corrección de error de Excel en el código SAP del guante 8.5
    await pool.query(`UPDATE dw_sap_reorder_settings SET itemcode = 'ALG0065' WHERE itemcode = '#REF!';`).catch(() => {});

    // Sembrar configuraciones de reorden por defecto
    const fs = require('fs');
    const path = require('path');
    try {
      const reorderCountRes = await pool.query('SELECT COUNT(*) as count FROM dw_sap_reorder_settings');
      const reorderCount = parseInt(reorderCountRes.rows[0].count, 10);
      if (reorderCount === 0) {
        const seedPath = path.join(__dirname, 'reorder_seed.json');
        if (fs.existsSync(seedPath)) {
          const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
          console.log(`[PG Seed] Poblando ${seedData.length} registros en dw_sap_reorder_settings...`);
          for (const item of seedData) {
            await pool.query(`
              INSERT INTO dw_sap_reorder_settings (itemcode, itemdescription, minstock, maxstock, note)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (itemcode) DO NOTHING
            `, [item.code, item.desc, item.min_stock, item.max_stock, item.note || '']);
          }
          console.log(`✅ Poblados registros iniciales en dw_sap_reorder_settings.`);
        }
      }
    } catch (seedErr) {
      console.warn('⚠️ Error al poblar dw_sap_reorder_settings:', seedErr.message);
    }

    console.log('✅ Data Warehouse en PostgreSQL inicializado correctamente.');
  } catch (err) {
    console.error('❌ Error al inicializar PostgreSQL:', err.message);
  }
}

module.exports = {
  pool,
  initPostgresDW
};
