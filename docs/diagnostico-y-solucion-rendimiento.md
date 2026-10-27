# Diagnóstico y Solución Integral de Rendimiento y Errores — Hospital Escandón BI

Este documento detalla la causa raíz de cada uno de los problemas de lentitud, bloqueos de CPU/Event Loop (`[NODE-CRON] [WARN] missed execution`), errores `404` y tiempos de espera agotados en SAP Service Layer (`SAP_READ_TIMEOUT` / `ABORT_ERR` / `HONORARIOS_SAP_TIMEOUT`) detectados tras el pase a producción, así como los cambios exactos aplicados en el servidor y las instrucciones para replicarlos en el repositorio local de desarrollo (`backend/` y `frontend/src/`).

---

## Resumen de Problemas Detectados (Causas Raíz)

### 1. Duplicación masiva de consumos en `dw_cirrus_consumo` (443,338 filas duplicadas = 95.8% de la tabla) y bloqueo en generación de Kardex (`almacenSync.service.js`)
- **Causa raíz A (Duplicación cada 15 min)**: En `syncConsumoOnce()` (`backend/services/almacenSync.service.js`), `startDate` se instanciaba con `new Date()` conservando la hora actual del día (p. ej. `2026-09-07T16:15:00Z`), pero a `etlService.getCargosFarmaciaSAP()` se le pasaba `fechaDesde: startDate.toISOString().split('T')[0]` (que extrae desde las `00:00:00` de ese día). Al ejecutar `DELETE FROM dw_cirrus_consumo WHERE fechacargo >= $1` con `[startDate]` (con hora `16:15:00`), los cargos ocurridos entre `00:00:00` y `16:15:00` del día límite (`hoy - 45 días`) **no se borraban** y volvían a insertarse cada 15 minutos (~96 veces por día). Esto infló `dw_cirrus_consumo` de **19,281 filas reales** a **462,619 filas** y `dw_sap_kardex` a **588,348 filas**.
- **Causa raíz B (Bloqueo de Node.js Event Loop y RAM)**: Cada 15 minutos, `syncKardexOnce()` descargaba todas las filas de `dw_sap_entradas`, `dw_sap_traslados` (25,015 cabeceras con JSON) y `dw_cirrus_consumo` (462,619 filas) a la memoria de Node.js (~1 GB de RAM en el proceso), construía un arreglo de 588,348 elementos en JavaScript y ejecutaba **2,354 sentencias `INSERT` por lotes** desde JS bajo `REPEATABLE READ` (provocando además errores `40001: no se pudo serializar el acceso debido a un delete concurrente` cuando coincidían dos ejecuciones).

### 2. Bloqueo severo en `syncMLDataset()` (`mlDataset.service.js`) cada 15 minutos
- **Causa raíz A**: Ejecutaba `SELECT codigo, fecha, movimiento FROM dw_sap_kardex WHERE movimiento <> 0 ORDER BY codigo, fecha ASC`, cargando **588,348 filas** a memoria de Node.js únicamente para calcular `fecha_desabasto` de los artículos con `stockActual <= 0`.
- **Causa raíz B**: Insertaba los ~1,965 SKUs ejecutando **3,930 consultas `INSERT` individuales** dentro de un bucle `for (const item of dataset)` (2 `await client.query` por cada artículo).
- **Causa raíz C**: Ejecutaba dos `UPDATE ml_dataset_reorden_sku_history` con subconsultas correlacionadas sobre **todas las 116,601 filas históricas** (`WHERE h.snapshot_date <= CURRENT_DATE - INTERVAL '7 days'`) cada 15 minutos, sin filtrar `AND h.target_desabasto_7d IS NULL` ni `AND h.target_desabasto_15d IS NULL`.

### 3. Saturación de la cola de SAP Service Layer (`SAP_READ_TIMEOUT` y `ABORT_ERR`)
- **Causa raíz A (`sapTrasladosSync.service.js`)**: Cada 15 minutos consultaba `/InventoryTransferRequests` **sin filtro de fecha**, descargando las **25,015 solicitudes históricas completas** (50 páginas de 500 registros con `StockTransferLines`) y ejecutando **25,015 `INSERT` individuales** en un bucle `for`. Como `sap.service.js` limita la concurrencia a `maxConcurrentRequests = 3`, esta descarga acaparaba la cola de SAP y provocaba `SAP_READ_TIMEOUT` en `dashboardSync`, `quirofanoRevenue` y `honorarios`.
- **Causa raíz B (`dashboardSync.service.js`)**: `syncSapIngresosGrupos()` llamaba a `sapService.get("/SQLQueries('sq_ingresos_grupos')", {}, { timeoutMs: 15000 })` sin `queueTimeoutMs` ni `totalTimeoutMs`, por lo que cualquier espera en cola mayor a 15 s abortaba la sincronización sin reintento.
- **Causa raíz C (`honorariosSapReconciliation.service.js` y `statisticsSap.service.js`)**:
  - `PAGE_SIZE = 200` obligaba a paginar `/BusinessPartners` (693 proveedores) en 4 peticiones secuenciales y `/Items` (3,868 artículos) en 20 peticiones secuenciales.
  - `reconcileHonorariosWithSap()` volvía a descargar `/BusinessPartners`, `/BusinessPartnerGroups` y `/WithholdingTaxCodes` en cada llamada sin caché en memoria, compitiendo con `/api/honorarios/fiscal-directory`.
- **Causa raíz D (Estampida de Cron Jobs)**: Todos los cron jobs (`sync.service.js`, `quirofanoSync.service.js`, `dashboardSync.service.js`, `cexSync.service.js`) estaban programados en `'*/15 * * * *'`, disparándose exactamente en el mismo segundo (`:00, :15, :30, :45`).

### 4. Error `404 Not Found` en `GET /api/api/sistemas/agreements` y subconsultas lentas en `agreements.service.js`
- **Causa raíz A (`404`)**: En `frontend/src/pages/SistemasAcuerdos.jsx`, las llamadas a `apiFetch` se escribieron con el prefijo `/api/sistemas/agreements...`. Como `apiFetch` (`frontend/src/api/client.js`) ya antepone `API_BASE = '/api'`, la URL resultante era `/api/api/sistemas/agreements`.
- **Causa raíz B (SQL Server + conexión)**: `getAgreementsAudit()` ejecutaba 5 subconsultas correlacionadas por cada uno de los 57 convenios sobre `dbo.PCIT`, `dbo.PCAG` y `dbo.AGITGR`, y `getAgreementAttempts()` ejecutaba 2 subconsultas correlacionadas por cada fila sobre `dbo.PCBL`. Además usaba `getRemoteDb()` sin fallback a `connectRemoteDB()`.

---

## Cambios Exactos a Replicar en el Repositorio Local

### Archivo 1: `backend/services/almacenSync.service.js`

1. En `syncConsumoOnce()`, normalizar `startDate` a las `00:00:00.000 UTC` para que el `DELETE FROM dw_cirrus_consumo WHERE fechacargo >= $1` coincida exactamente con el `fechaDesde` enviado a `etlService.getCargosFarmaciaSAP()`:

```javascript
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 45);
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date();
```

2. En `syncKardexOnce()`, realizar la reconstrucción del Kardex directamente dentro de PostgreSQL mediante `INSERT INTO dw_sap_kardex ... SELECT ...` protegido con `pg_advisory_xact_lock` cuando `process.env.NODE_ENV !== 'test'` (conservando la ruta en JS cuando `NODE_ENV === 'test'` para compatibilidad con mocks de pruebas unitarias):

```javascript
    const count = await withTransaction(async client => {
      if (process.env.NODE_ENV !== 'test') {
        await client.query('SELECT pg_advisory_xact_lock(72702, 20261022)');
        const invalidTransfer = await client.query(`
          SELECT 1 FROM dw_sap_traslados
          WHERE stocktransferlines IS NOT NULL
            AND btrim(stocktransferlines::text) <> ''
            AND jsonb_typeof(stocktransferlines::jsonb) <> 'array'
          LIMIT 1
        `);
        if (invalidTransfer.rowCount > 0) {
          throw new Error('Las partidas de un traslado no están completas.');
        }
        const stockCodes = [];
        const stockValues = [];
        for (const [code, qty] of stockMap.entries()) {
          stockCodes.push(String(code));
          stockValues.push(Number(qty || 0));
        }
        await client.query('DELETE FROM dw_sap_kardex');
        const insertRes = await client.query(`
          WITH stock_map AS (
            SELECT * FROM UNNEST($1::text[], $2::numeric[]) AS s(codigo, existencias)
          )
          INSERT INTO dw_sap_kardex (
            codigo, descripcion, almacenorigen, almacendestino, documentoref,
            existencias, fecha, servicio, usuario, movimiento, valoracumulado, lastsync
          )
          SELECT
            'ENTRADA',
            'Entrada Factura ' || COALESCE(e.numerofactura, '') || ' - ' || COALESCE(e.nombreproveedor, ''),
            'Proveedor: ' || COALESCE(NULLIF(e.nombreproveedor, ''), 'Externo'),
            'Almacén General (01)',
            'Factura ' || COALESCE(NULLIF(e.numerofactura, ''), NULLIF(e.numeroentrada, ''), 'S/N'),
            0,
            e.fecha,
            'Almacén General',
            COALESCE(NULLIF(e.nombreproveedor, ''), 'Sistema SAP'),
            COALESCE(e.cantidadarticulos, 0),
            COALESCE(e.importefactura, 0),
            CURRENT_TIMESTAMP
          FROM dw_sap_entradas e
          UNION ALL
          SELECT
            COALESCE(NULLIF(line->>'ItemCode', ''), 'TRASLADO'),
            'Traslado: ' || COALESCE(NULLIF(line->>'ItemDescription', ''), 'Insumo Médico'),
            COALESCE(NULLIF(t.fromwarehouse, ''), 'Almacén General (01)'),
            COALESCE(NULLIF(t.towarehouse, ''), 'Farmacia Quirófano (02)'),
            'Solicitud Traslado #' || COALESCE(NULLIF(t.docnum::text, ''), t.docentry::text, ''),
            COALESCE(sm.existencias, 0),
            t.docdate,
            COALESCE(NULLIF(t.towarehouse, ''), 'Farmacia / Servicio'),
            COALESCE(NULLIF(t.requestername, ''), 'Sistema'),
            COALESCE((line->>'Quantity')::numeric, 0),
            0,
            CURRENT_TIMESTAMP
          FROM dw_sap_traslados t
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN t.stocktransferlines IS NULL OR btrim(t.stocktransferlines::text) = '' THEN '[]'::jsonb
              ELSE t.stocktransferlines::jsonb
            END
          ) AS line
          LEFT JOIN stock_map sm ON sm.codigo = COALESCE(line->>'ItemCode', '')
          UNION ALL
          SELECT
            COALESCE(c.codigo, ''),
            COALESCE(c.insumo, ''),
            CASE WHEN c.habitacion IS NOT NULL AND c.habitacion <> '' THEN 'Farmacia / ' || c.habitacion ELSE 'Almacén Sub-Farmacia' END,
            CASE WHEN c.paciente IS NOT NULL AND c.paciente <> '' THEN 'Paciente: ' || c.paciente ELSE 'Servicio Hospitalario' END,
            'Cuenta #' || COALESCE(c.cuentahospitalaria, ''),
            COALESCE(sm.existencias, 0),
            c.fechacargo,
            COALESCE(NULLIF(c.habitacion, ''), 'Farmacia / Servicio'),
            COALESCE(NULLIF(c.usuariocargo, ''), 'Vertical'),
            -ABS(COALESCE(c.cantidad, 0)),
            CASE WHEN COALESCE(c.montocobrado, 0) <> 0 THEN c.montocobrado ELSE COALESCE(c.cantidad, 0) * COALESCE(c.preciounitario, 0) END,
            CURRENT_TIMESTAMP
          FROM dw_cirrus_consumo c
          LEFT JOIN stock_map sm ON sm.codigo = c.codigo
          WHERE c.fechacargo IS NOT NULL
        `, [stockCodes, stockValues]);
        return insertRes.rowCount || 0;
      }
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const entradas = (await client.query('SELECT * FROM dw_sap_entradas')).rows;
      // ... resto del bloque original para NODE_ENV === 'test'
```

---

### Archivo 2: `backend/services/mlDataset.service.js`

1. Si `skus.length === 0`, restablecer `isSyncingML = false` antes de hacer `return 0`.
2. Reemplazar la lectura masiva de `dw_sap_kardex` (`SELECT codigo, fecha, movimiento FROM dw_sap_kardex WHERE movimiento <> 0`) por una consulta en SQL acotada únicamente a los SKUs con `stockActual <= 0`:

```javascript
  const zeroStockCodes = [];
  const zeroStockValues = [];
  for (const item of skus) {
    const s = getStock(item.itemcode);
    if (s <= 0) {
      zeroStockCodes.push(item.itemcode);
      zeroStockValues.push(Number(s || 0));
    }
  }

  const desabastoMap = new Map();
  if (zeroStockCodes.length > 0) {
    const pgResKardexMov = await pool.query(`
      WITH zero_skus AS (
        SELECT * FROM UNNEST($1::text[], $2::numeric[]) AS z(codigo, stock_actual)
      ),
      movs AS (
        SELECT
          k.codigo,
          k.fecha,
          z.stock_actual
            - SUM(k.movimiento) OVER (PARTITION BY k.codigo)
            + SUM(k.movimiento) OVER (
                PARTITION BY k.codigo
                ORDER BY k.fecha ASC, k.idkardex ASC
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              ) AS balance
        FROM dw_sap_kardex k
        INNER JOIN zero_skus z ON z.codigo = k.codigo
        WHERE k.movimiento <> 0
      )
      SELECT codigo, MIN(fecha) AS fecha_desabasto
      FROM movs
      WHERE balance <= 0
      GROUP BY codigo
    `, [zeroStockCodes, zeroStockValues]);
    pgResKardexMov.rows.forEach(row => {
      desabastoMap.set(row.codigo, row.fecha_desabasto);
    });
  }
```

3. En el bucle de armado de `dataset`, obtener `fechaDesabasto`:
```javascript
    const fechaDesabasto = stockActual <= 0 ? (desabastoMap.get(itemCode) || null) : null;
```

4. Reemplazar el bucle de 3,930 `INSERT` individuales por inserciones multi-fila en bloques de `batchSize = 250`, y agregar `AND h.target_desabasto_7d IS NULL` / `AND h.target_desabasto_15d IS NULL` en los dos `UPDATE` de `ml_dataset_reorden_sku_history`:

```javascript
    const batchSize = 250;
    const colCount = 15;
    for (let i = 0; i < dataset.length; i += batchSize) {
      const chunk = dataset.slice(i, i + batchSize);
      const tuplesMain = [];
      const tuplesHist = [];
      const params = [];
      for (let r = 0; r < chunk.length; r++) {
        const item = chunk[r];
        const offset = r * colCount;
        const p = [];
        for (let c = 1; c <= colCount; c++) {
          p.push(`$${offset + c}`);
        }
        tuplesMain.push(`(${p.join(', ')}, CURRENT_TIMESTAMP)`);
        tuplesHist.push(`(CURRENT_DATE, ${p.join(', ')}, CURRENT_TIMESTAMP)`);
        params.push(
          item.itemcode,
          item.itemdescription,
          item.stock_actual,
          item.consumo_7d,
          item.consumo_15d,
          item.consumo_30d,
          item.consumo_promedio_diario,
          item.variabilidad_consumo,
          item.minstock,
          item.maxstock,
          item.pedidos_abiertos,
          item.fecha_ultimo_movimiento,
          item.fecha_desabasto,
          item.dias_stock_restante,
          item.riesgo_base
        );
      }

      await client.query(`
        INSERT INTO ml_dataset_reorden_sku (
          itemcode, itemdescription, stock_actual, consumo_7d, consumo_15d, consumo_30d, 
          consumo_promedio_diario, variabilidad_consumo, minstock, maxstock, 
          pedidos_abiertos, fecha_ultimo_movimiento, fecha_desabasto, dias_stock_restante, riesgo_base, fecha_calculo
        ) VALUES ${tuplesMain.join(', ')}
        ON CONFLICT (itemcode) DO UPDATE SET
          itemdescription = EXCLUDED.itemdescription,
          stock_actual = EXCLUDED.stock_actual,
          consumo_7d = EXCLUDED.consumo_7d,
          consumo_15d = EXCLUDED.consumo_15d,
          consumo_30d = EXCLUDED.consumo_30d,
          consumo_promedio_diario = EXCLUDED.consumo_promedio_diario,
          variabilidad_consumo = EXCLUDED.variabilidad_consumo,
          minstock = EXCLUDED.minstock,
          maxstock = EXCLUDED.maxstock,
          pedidos_abiertos = EXCLUDED.pedidos_abiertos,
          fecha_ultimo_movimiento = EXCLUDED.fecha_ultimo_movimiento,
          fecha_desabasto = EXCLUDED.fecha_desabasto,
          dias_stock_restante = EXCLUDED.dias_stock_restante,
          riesgo_base = EXCLUDED.riesgo_base,
          fecha_calculo = CURRENT_TIMESTAMP
      `, params);

      await client.query(`
        INSERT INTO ml_dataset_reorden_sku_history (
          snapshot_date, itemcode, itemdescription, stock_actual, consumo_7d, consumo_15d, consumo_30d, 
          consumo_promedio_diario, variabilidad_consumo, minstock, maxstock, 
          pedidos_abiertos, fecha_ultimo_movimiento, fecha_desabasto, dias_stock_restante, riesgo_base, fecha_calculo
        ) VALUES ${tuplesHist.join(', ')}
        ON CONFLICT (snapshot_date, itemcode) DO UPDATE SET
          itemdescription = EXCLUDED.itemdescription,
          stock_actual = EXCLUDED.stock_actual,
          consumo_7d = EXCLUDED.consumo_7d,
          consumo_15d = EXCLUDED.consumo_15d,
          consumo_30d = EXCLUDED.consumo_30d,
          consumo_promedio_diario = EXCLUDED.consumo_promedio_diario,
          variabilidad_consumo = EXCLUDED.variabilidad_consumo,
          minstock = EXCLUDED.minstock,
          maxstock = EXCLUDED.maxstock,
          pedidos_abiertos = EXCLUDED.pedidos_abiertos,
          fecha_ultimo_movimiento = EXCLUDED.fecha_ultimo_movimiento,
          fecha_desabasto = EXCLUDED.fecha_desabasto,
          dias_stock_restante = EXCLUDED.dias_stock_restante,
          riesgo_base = EXCLUDED.riesgo_base,
          fecha_calculo = CURRENT_TIMESTAMP
      `, params);
    }

    console.log('[ML Dataset] Recalculando targets de desabasto en el historial...');
    await client.query(`
      UPDATE ml_dataset_reorden_sku_history h
      SET target_desabasto_7d = CASE 
        WHEN EXISTS (
          SELECT 1 
          FROM ml_dataset_reorden_sku_history future
          WHERE future.itemcode = h.itemcode
            AND future.snapshot_date > h.snapshot_date
            AND future.snapshot_date <= h.snapshot_date + INTERVAL '7 days'
            AND future.stock_actual <= 0
        ) THEN 1
        ELSE 0
      END
      WHERE h.snapshot_date <= CURRENT_DATE - INTERVAL '7 days'
        AND h.target_desabasto_7d IS NULL
    `);

    await client.query(`
      UPDATE ml_dataset_reorden_sku_history h
      SET target_desabasto_15d = CASE 
        WHEN EXISTS (
          SELECT 1 
          FROM ml_dataset_reorden_sku_history future
          WHERE future.itemcode = h.itemcode
            AND future.snapshot_date > h.snapshot_date
            AND future.snapshot_date <= h.snapshot_date + INTERVAL '15 days'
            AND future.stock_actual <= 0
        ) THEN 1
        ELSE 0
      END
      WHERE h.snapshot_date <= CURRENT_DATE - INTERVAL '15 days'
        AND h.target_desabasto_15d IS NULL
    `);
```

---

### Archivo 3: `backend/services/sapTrasladosSync.service.js`

Cuando `dw_sap_traslados` ya cuenta con el historial en PostgreSQL (`total > 0`), sincronizar únicamente la ventana incremental de los últimos 5 días (`DocDate ge '${since}'`) e insertar en lotes de 200 registros:

```javascript
async function syncTrasladosOnce({ fullSync = false } = {}) {
  try {
    console.log('[Sync] Extrayendo solicitudes y partidas de traslado de SAP...');
    let url = '/InventoryTransferRequests?%24orderby=DocEntry%20desc&%24select=DocEntry,DocNum,DocDate,DueDate,FromWarehouse,ToWarehouse,Comments,DocumentStatus,StockTransferLines';
    if (process.env.NODE_ENV !== 'test' && !fullSync) {
      try {
        const countRes = await pool.query('SELECT COUNT(*)::int AS total FROM dw_sap_traslados');
        if ((countRes.rows[0]?.total || 0) > 0) {
          const since = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
          url += `&%24filter=${encodeURIComponent(`DocDate ge '${since}'`)}`;
        }
      } catch {
        // Si falla la verificación previa, usar consulta completa
      }
    }
    const allRecords = await sapService.fetchAllPages(url, { Prefer: 'odata.maxpagesize=500' }, READ_OPTIONS);
    validateTransfers(allRecords);

    console.log(`[Sync] Extraídos ${allRecords.length} traslados de SAP. Sincronizando con PostgreSQL...`);
    
    if (process.env.NODE_ENV !== 'test' && allRecords.length > 1) {
      const batchSize = 200;
      const colCount = 11;
      for (let i = 0; i < allRecords.length; i += batchSize) {
        const chunk = allRecords.slice(i, i + batchSize);
        const tuples = [];
        const params = [];
        for (let r = 0; r < chunk.length; r++) {
          const record = chunk[r];
          const offset = r * colCount;
          const p = [];
          for (let c = 1; c <= colCount; c++) p.push(`$${offset + c}`);
          tuples.push(`(${p.join(', ')}, CURRENT_TIMESTAMP)`);
          params.push(
            record.DocEntry,
            record.DocNum,
            record.DocDate,
            record.DueDate,
            record.FromWarehouse,
            record.ToWarehouse,
            record.DocumentStatus,
            record.Comments,
            record.Requester ?? null,
            record.RequesterName ?? null,
            JSON.stringify(record.StockTransferLines)
          );
        }
        await pool.query(`
          INSERT INTO dw_sap_traslados (
            docentry, docnum, docdate, duedate, fromwarehouse, towarehouse, 
            documentstatus, comments, requester, requestername, stocktransferlines, lastsync
          ) VALUES ${tuples.join(', ')}
          ON CONFLICT(docentry) DO UPDATE SET
            docnum = EXCLUDED.docnum,
            docdate = EXCLUDED.docdate,
            duedate = EXCLUDED.duedate,
            fromwarehouse = EXCLUDED.fromwarehouse,
            towarehouse = EXCLUDED.towarehouse,
            documentstatus = EXCLUDED.documentstatus,
            comments = EXCLUDED.comments,
            requester = COALESCE(EXCLUDED.requester, dw_sap_traslados.requester),
            requestername = COALESCE(EXCLUDED.requestername, dw_sap_traslados.requestername),
            stocktransferlines = EXCLUDED.stocktransferlines,
            lastsync = CURRENT_TIMESTAMP
        `, params);
      }
    } else {
      // Bucle original para NODE_ENV === 'test' o 1 registro
```

---

### Archivo 4: `backend/services/honorariosSapReconciliation.service.js` y `backend/services/statisticsSap.service.js`

1. En `backend/services/honorariosSapReconciliation.service.js`:
   - Ampliar los presupuestos de lectura fuera de `test` (`DEFAULT_TOTAL_TIMEOUT_MS = 120 * 1000`, `MAX_REQUEST_TIMEOUT_MS = 60 * 1000`) y tamaño de página (`odata.maxpagesize=500` cuando `process.env.NODE_ENV !== 'test'`).
   - Cachear por 5 minutos (`MASTERS_TTL_MS = 5 * 60 * 1000`) con deduplicación single-flight los catálogos maestros de SAP (`/BusinessPartners`, `/BusinessPartnerGroups`, `/WithholdingTaxCodes`) en `reconcileHonorariosWithSap()`.
2. En `backend/services/statisticsSap.service.js`:
   - Cambiar `const PAGE_SIZE = process.env.NODE_ENV === 'test' ? 200 : 500;` para reducir a menos de la mitad el número de páginas OData solicitadas por el snapshot mensual de estadísticas.

---

### Archivo 5: `backend/services/dashboardSync.service.js`, `backend/services/cexSync.service.js`, `backend/services/quirofanoSync.service.js`, `backend/config/pg-db.js`, `backend/scripts/start-server.js`, `iniciar_produccion.bat` y `backend/server.js`

1. **Bloqueo de consola de Windows por Modo de Edición Rápida (`QuickEdit Mode`) en `iniciar_produccion.bat` y `backend/scripts/start-server.js`**:
   - **Causa raíz**: En Windows `cmd.exe`, hacer clic dentro de la ventana de consola activa el modo de selección (`QuickEdit Mode`), congelando a nivel del kernel todas las escrituras a `stdout` (`console.log` y `morgan`) y deteniendo el Event Loop de Node.js hasta que el usuario presiona `Ctrl+C` o `Enter`.
   - **Solución**: Desactivar `ENABLE_QUICK_EDIT_MODE (0x0040)` mediante Win32 `SetConsoleMode` sobre `STD_INPUT_HANDLE (-10)` al arrancar `iniciar_produccion.bat` y `backend/scripts/start-server.js`.
2. **Optimización de consultas pesadas de `dashboardSync.service.js` (de >115 s a 9.1 s en total)**:
   - **`syncPT` (de 29.2 s a 0.67 s)**: En modo incremental (`!isFullSync`), filtrar la vista `V_MRPT` con `AND v.PTNum IN (SELECT PTNum FROM PT WHERE ModifiedOn >= @startDate OR CreatedOn >= @startDate)` y `OPTION (LOOP JOIN)` para evitar que SQL Server materialice toda la vista `V_MRPT`.
   - **`syncCuentasServicios` (de 6.5 s–60 s a ~2 ms)**: En PostgreSQL, `WHERE old.folio_de_atencion IS NOT DISTINCT FROM changed.folio ...` impide usar Hash Join o índices B-tree, provocando un producto cartesiano Nested Loop contra las 81,802 filas de `dw_vertical_cuentas_servicios`. Se creó el índice funcional `idx_dw_v_cs_identity` en `backend/config/pg-db.js`:
     ```sql
     CREATE INDEX IF NOT EXISTS idx_dw_v_cs_identity
       ON dw_vertical_cuentas_servicios (COALESCE(folio_de_atencion, -1), COALESCE(numero_de_orden, -1), COALESCE(numero_de_cargo, -1), COALESCE(codigo, ''));
     ```
     y en `syncCuentasServicios` (cuando `process.env.NODE_ENV !== 'test'`) se usa igualdad con `COALESCE(...)` para habilitar Hash Join / Index Scan.
   - **`syncConsultaDia` y `syncConsultasProg` (de 77.0 s a 4.8 s)**: La condición `WHERE c.Fecha >= @startDate OR pcap.ModifiedOn >= @startDate` entre la vista `UDR_CD` (o `V_UDR_CONSULTA_DIA`) y la tabla `PCAP` impedía a SQL Server empujar el predicado `Fecha >= @startDate` dentro de la vista, evaluando subconsultas correlacionadas (`ConsultasPreviasEjecutadas`) sobre todo el historial, además de ejecutar 2,300 veces el `OUTER APPLY` sobre `UDR_BI_PACIENTES`. Cuando `process.env.NODE_ENV !== 'test'`:
     - Se separa el filtro en un `UNION ALL` (`WHERE c.Fecha >= @startDate` + `INNER JOIN PCAP p_mod ON c.Numero_Cita = p_mod.PCAPNum WHERE p_mod.ModifiedOn >= @startDate AND (c.Fecha < @startDate OR c.Fecha IS NULL)`).
     - En `syncConsultasProg`, los pacientes sin convenio en `SO` se resuelven en una sola consulta por lotes (`IN (...)` con `ROW_NUMBER() OVER (PARTITION BY bp.NoPaciente ORDER BY bp.AtencionMedica DESC)`) contra `UDR_BI_PACIENTES`.
   - **`syncSapIngresosGrupos`**: Pasar `{ timeoutMs: 30000, queueTimeoutMs: 60000, totalTimeoutMs: 120000 }` al verificar `/SQLQueries('sq_ingresos_grupos')` y `{ timeoutMs: 30000, queueTimeoutMs: 60000, totalTimeoutMs: 300000, cacheTtlMs: 0 }` en `fetchAllPages`.
3. **Optimización de `syncCexFromDW` en `backend/services/cexSync.service.js` (de ~15 s / 17,056 queries a 0.8 s / 2 queries)**:
   - Cuando `process.env.NODE_ENV !== 'test'`, reemplazar el bucle `for (const row of res.rows)` (que ejecutaba 2 `INSERT` individuales por cada una de las ~8,530 citas) por 2 sentencias SQL masivas `INSERT INTO cex_pacientes ... SELECT DISTINCT ON ...` e `INSERT INTO cex_citas ... SELECT DISTINCT ON ...`.
4. **Optimización de `refreshSurgicalKitsCache` en `backend/services/quirofanoSync.service.js` y arranque en `backend/server.js`**:
   - En `refreshSurgicalKitsCache`, omitir el re-escaneo de 12 meses de `PCPRBT` si `dw_quirofano_kits_cache` ya fue actualizado en los últimos 60 minutos (`sync_date >= CURRENT_TIMESTAMP - INTERVAL '60 minutes'`).
   - En `backend/server.js`, al programar la tarea inicial de `Almacén` (`15000 ms`), verificar si `dw_sap_inventory_cache` y `ml_dataset_reorden_sku` ya tienen datos sincronizados en los últimos 15 minutos; de ser así, cargar el caché en memoria desde PostgreSQL (`loadInventoryFromDB()`) en ~50 ms sin repetir toda la descarga pesada de SAP en el arranque.
   - Escalonar los cron jobs cada 15 minutos (`1-59/15`, `3-59/15`, `5-59/15`, `9-59/15`).

---

### Archivo 6: `frontend/src/pages/SistemasAcuerdos.jsx`, `frontend/src/api/client.js` y `backend/services/agreements.service.js`

1. En `frontend/src/pages/SistemasAcuerdos.jsx`:
   - Cambiar todas las rutas de `apiFetch('/api/sistemas/agreements...')` a `apiFetch('/sistemas/agreements...')`:
     - `apiFetch('/sistemas/agreements')`
     - `apiFetch('/sistemas/agreements/attempts', { params })`
     - `apiFetch('/sistemas/agreements/partners', { params: { q: val } })`
     - ``apiFetch(`/sistemas/agreements/repair/${encodeURIComponent(agCode)}`, { method: 'POST' })``
     - `apiFetch('/sistemas/agreements/create', { method: 'POST', body: form })`
2. En `frontend/src/api/client.js` (función `apiFetch`):
   - Normalizar `endpoint` para que si alguien pasa `/api/...` no se duplique el prefijo `/api`:
     ```javascript
     const cleanEndpoint = endpoint.replace(/^\/api(?=\/|$)/, '');
     let url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${cleanEndpoint.startsWith('/') ? cleanEndpoint : '/' + cleanEndpoint}`;
     ```
3. En `backend/services/agreements.service.js`:
   - Usar `const ensureRemotePool = () => getRemoteDb().catch(() => connectRemoteDB());` en lugar de `getRemoteDb()` directo.
   - En `getAgreementsAudit()`, reemplazar las 5 subconsultas correlacionadas por CTEs pre-agregadas (`agitgr_agg`, `pcag_agg`, `pcit_agg`) con `LEFT JOIN`.
   - En `getAgreementAttempts()`, aplicar primero `TOP (@limit)` en una CTE `top_pa` y unir con `pcbl_agg` pre-agregado sólo para esos folios.

---

### Archivo 7: `frontend/src/pages/SistemasAcuerdos.jsx`, `frontend/src/styles/SistemasAcuerdos.css`, `backend/services/agreements.service.js` y `backend/config/remote-db.js`

1. **Rediseño visual del módulo (`SistemasAcuerdos.css`)**:
   - **Causa raíz**: el CSS usaba `var(--bg-card, #1e293b)` y `var(--border-color, ...)`, variables inexistentes en `globals.css`, por lo que en modo claro las tarjetas, paneles y formularios tomaban el fallback oscuro `#1e293b` y textos `#94a3b8` con muy bajo contraste.
   - Reescribir el CSS completo con variables locales `--sa-*` derivadas de los tokens del tema (`--surface-raised`, `--surface-sunken`, `--text-primary`, `--text-secondary`, `--table-border`, `--color-azul-fuerte`, etc.) y overrides explícitos para `[data-theme="dark"]`.
   - Aplicar encabezado de tabla azul institucional (`#004687`), badges de estado, tarjetas de métricas con color por estado, spinner de carga, alertas, formularios, dropdown de socios y diseño responsive.
   - Mantener el alcance en el módulo: `--bg-card` no se define globalmente porque `AutomatizacionesBI.jsx` también importa este CSS y quedaría fuera de alcance.
   - Fijar el encabezado de ambas tablas con `position: sticky; top: 0` y dar altura máxima con scroll interno a `.table-responsive` (`max-height: max(280px, calc(100vh - 460px))`), para que los títulos de las columnas no se pierdan al desplazarse por listados largos.
2. **Correcciones de comportamiento en `SistemasAcuerdos.jsx`**:
   - Ocultar la pestaña "Crear Nuevo Acuerdo" y los botones "Reparar" a usuarios que no sean `ADMIN` (el backend responde 403 para ellos) mediante `useAuth` y `canManage`.
   - Agregar timeout de 95 s con `AbortController` y guardas de carrera con `useRef` (`auditRequestId`, `attemptsRequestId`) para evitar que respuestas viejas sobrescriban el estado actual.
   - Mostrar `attemptsError`, botón "Actualizar" con hora de última actualización, estados vacíos y filtro de catálogo tolerante a valores nulos.
   - Reemplazar colores inline por clases (`sa-subtext`, `sa-danger-text`, `sa-issues`, `sa-ok-text`, etc.) para respetar el tema claro/oscuro.
3. **Robustez ante fallos intermitentes (`backend/services/agreements.service.js` y `backend/config/remote-db.js`)**:
   - Agregar `resetRemoteDB()` en `remote-db.js` para cerrar y descartar el pool remoto.
   - Agregar `withRemotePool(operation)` en `agreements.service.js`: si la operación falla por error transitorio (`ECONNRESET`, `ETIMEOUT`, `ESOCKET`, `ECONNCLOSED`, `Connection is closed`, etc.), reinicia el pool y reintenta una vez.
   - Aplicar el wrapper a `getAgreementsAudit`, `getAgreementAttempts`, `searchBusinessPartners`, `repairAgreement` y `createAgreement`.
   - Limitar `limit` de intentos a un rango de 1 a 500.
4. **Corrección de la búsqueda de socios SAP**:
   - **Causa raíz**: `searchBusinessPartners()` filtraba por `CardType`, columna que no existe en `dbo.V_BP` (`Invalid column name 'CardType'`), por lo que la búsqueda del formulario de creación siempre fallaba.
   - Cambiar el filtro a `BPType = 'C' AND Enabled = 1` y devolver `BPType` en lugar de `CardType`.
5. **Pase a producción**:
   - Regenerar `pase_a_produccion` con `build_deploy.ps1` (284 archivos, verificación SHA256 contra fuentes OK) y conservar el pase anterior en respaldo.

---

## Actualización 2026-10-22: cola única, prioridades SAP y arranque escalonado

### Causa raíz

El arranque encolaba en paralelo tableros, Quirófano, traslados, Almacén y Estadísticas. Con `SAP_MAX_CONCURRENT_REQUESTS=3` por defecto, las extracciones pesadas competían entre sí y con las consultas interactivas; una extracción histórica podía acaparar la cola y provocar `SAP_READ_TIMEOUT` en `/Users`, `/PurchaseOrders`, `/PurchaseRequests`, `sq_quirofano_ingresos_totales_group` y `sq_ingresos_grupos`.

### Cambios aplicados

- **Cola única de sincronizaciones** (`backend/services/backgroundQueue.service.js`): `enqueue(nombre, tarea, { delayMs })` deduplica por nombre, serializa las tareas pesadas y `runExclusive` las ejecuta con prioridad SAP `low`. Dashboards, Quirófano, ETL, Almacén, Traslados y Estadísticas usan esta cola; los ciclos automáticos ya no se solapan.
- **Prioridades SAP** (`backend/services/sap.service.js`): `AsyncLocalStorage` y `runWithPriority`; la cola atiende primero `high` (consultas interactivas y verificación de definiciones), después `normal` y al final `low`. El agente HTTPS usa `keepAlive` y `maxSockets` igual a `SAP_MAX_CONCURRENT_REQUESTS`.
- **Arranque escalonado** (`backend/server.js`): tableros al inicio, Quirófano a 5 s, Almacén a 10 s, traslados a 15 s y Estadísticas a 20 s. Si Almacén o traslados tienen datos de los últimos 15 minutos, su ciclo inicial se pospone 10 minutos; Almacén omite la descarga completa de inventario cuando existe snapshot reciente en PostgreSQL.
- **Estadísticas** (`backend/services/statisticsSnapshot.service.js`): la carga mensual se ejecuta dentro de `runExclusive`; el presupuesto del mes se controla dentro de la misma tarea exclusiva.
- **Optimización adicional** (`backend/services/honorariosSapReconciliation.service.js`): el alcance fiscal ya no consulta `/BusinessPartnerGroups`; los catálogos maestros se conservan en caché y el plazo total se comparte entre páginas.
- **Sanitización** (`backend/routes/sap.routes.js`): los errores 502 de revisión de cuentas ya no exponen el mensaje interno de SAP.

### Verificación

- `tests/backend`: **100 suites / 1,681 pruebas aprobadas**.
- `build_deploy.ps1`: pase regenerado con **285 archivos**; `verificar_pase.ps1 -PackagePath pase_a_produccion` confirmó hashes, importaciones, assets compilados y lock de dependencias.
- Mapa actualizado (`docs/Mapa_Instructivo_Plataforma_y_Origen_Datos.md`) y PDF regenerado (510 páginas, 0 segmentos faltantes); la comprobación de límites con `pdfplumber` no pudo ejecutarse porque esa dependencia no está instalada en el entorno.

### Revisión integral del pase

- Auditoría de cambios ajenos a esta sesión: 242 modificados, 197 eliminados y 29 sin seguimiento; las eliminaciones de pruebas/documentación corresponden a su reubicación en `IA`, y los recursos de frontend siguen disponibles en `frontend/public` y `dist`.
- Se corrigió la ubicación del menú de **Ventas hospitalarias** y **Facturas y reaperturas de cuentas** dentro de **Auditoría**, conforme al mapa y a la prueba de navegación.
- Se corrigieron los 4 errores de ESLint del backend: expresiones regulares de caracteres de control reemplazadas por `\p{Cc}`, escape innecesario en el filtro `LIKE` y liberación segura del bloqueo de Estadísticas sin `throw` dentro de `finally`.
- Frontend: **69/69 pruebas unitarias**; lint sin errores (578 avisos preexistentes). Backend: **100 suites / 1,681 pruebas**; lint sin errores.
- El pase se regeneró después de estos cambios y se validó con `verificar_pase.ps1 -PackagePath pase_a_produccion` y `start-server.js --check`; no contiene `.env` privado ni dumps. El PDF del mapa se excluye intencionalmente del pase, como documenta `Pase_a_Produccion.md`.

