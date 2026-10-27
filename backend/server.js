

'use strict';

require('dotenv').config();

const express       = require('express');
const cors          = require('cors');
const helmet        = require('helmet');
const rateLimit     = require('express-rate-limit');
const morgan        = require('morgan');
const path          = require('path');
const fs            = require('fs');
const os            = require('os');
const multer        = require('multer');
const xss           = require('xss-clean');

const { connectDB }         = require('./config/db');
const { connectRemoteDB }   = require('./config/remote-db');
const authRoutes             = require('./routes/auth.routes');
const dashboardRoutes        = require('./routes/dashboard.routes');
const exportRoutes           = require('./routes/export.routes');
const aiRoutes               = require('./routes/ai.routes');
const biRoutes               = require('./routes/bi.routes');
const adminRoutes            = require('./routes/admin.routes');
const auditRoutes            = require('./routes/audit.routes');
const hospitalSalesRoutes    = require('./routes/hospitalSales.routes');
const { auditMiddleware }    = require('./middleware/audit.middleware');
const { initPostgresDW, pool }     = require('./config/pg-db');
const { initCronJobs, runFullSync } = require('./services/sync.service');
const { initQuirofanoDW, syncQuirofanoData, initQuirofanoCron } = require('./services/quirofanoSync.service');
const { syncAllDashboards, initDashboardCron } = require('./services/dashboardSync.service');

const app  = express();
const PORT = process.env.PORT || 4000;
const { publicMessages } = require('./middleware/publicMessages.middleware');

app.use(publicMessages);

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://app.powerbi.com', 'blob:'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      frameSrc:   ["'self'", 'https://app.powerbi.com', 'blob:'],
      imgSrc:     ["'self'", 'data:', 'blob:', 'https://*', 'http://*'],
      connectSrc: ["'self'", 'https://*', 'http://*', 'ws://*', 'wss://*'],
      upgradeInsecureRequests: null,
    },
  },
  hsts: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

/* Configuración CORS dinámica (Intranet, Tailscale y Localhost) */
const configuredOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
     
    if (!origin) return callback(null, true);

    // Permitir orígenes explícitamente configurados o comodín '*'
    if (configuredOrigins.includes('*') || configuredOrigins.includes(origin)) {
      return callback(null, true);
    }

    const isAllowedHost = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|100\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+|([a-zA-Z0-9-]+\.)*ts\.net|([a-zA-Z0-9-]+)(\.local|\.lan)?)(:\d+)?$/i.test(origin);
    if (isAllowedHost || configuredOrigins.length === 0) {
      return callback(null, true);
    }

    return callback(new Error(`Bloqueado por política CORS: ${origin}`));
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  exposedHeaders: ['Content-Disposition']
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  
  max:      500,
  standardHeaders: true,
  legacyHeaders: false,
  skip:     (req) => !req.path.startsWith('/api') && req.path !== '/health',
  validate: { xForwardedForHeader: false, trustProxy: false },
  message: { message: 'Demasiadas solicitudes. Intente en 15 minutos.', error: 'Demasiadas solicitudes. Intente en 15 minutos.' },
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  
  max:      200,  
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, trustProxy: false },
  message: { message: 'Demasiados intentos de autenticación. Intente más tarde.', error: 'Demasiados intentos de autenticación. Intente más tarde.' },
});

app.use(globalLimiter);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(xss());  

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(':method :url :status :response-time ms — :res[content-length]'));
}

/* Audit log (middleware global para rutas protegidas) */
app.use('/api', auditMiddleware);

app.get('/api/ping', (req, res) => res.json({ ok: true, message: 'pong' }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let subfolder = '';
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pbix') subfolder = 'pbix';
    else if (['.xlsx', '.xls', '.csv'].includes(ext)) subfolder = 'excel';
    else if (['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext)) subfolder = 'thumbnails';
    const dir = path.join(__dirname, 'uploads', subfolder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const { authenticate, authorize } = require('./middleware/auth.middleware');
app.post('/upload-assets', authenticate, authorize(['ADMIN']), (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[UPLOAD ERROR]', err.message);
      return res.status(500).json({ error: 'Error de subida: ' + err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const subfolder = req.file.destination.split(path.sep).pop();
    res.json({ ok: true, filename: `${subfolder}/${req.file.filename}` });
  });
});

/* Rutas */
const sitiRoutes = require('./routes/siti.routes');
const dataQualityRoutes = require('./routes/dataQuality.routes');

const ariaRoutes = require('./routes/aria.routes');
const pharmacyRoutes = require('./routes/pharmacy.routes');
const sapRoutes = require('./routes/sap.routes');
const almacenRoutes = require('./routes/almacen.routes');
const finanzasRoutes = require('./routes/finanzas.routes');
const cexRoutes = require('./routes/cex.routes');
const sapQueryBuilderRoutes = require('./routes/sapQueryBuilder.routes');
const honorariosRoutes = require('./routes/honorarios.routes');
const agreementsRoutes = require('./routes/agreements.routes');

app.use('/api/auth',          authLimiter, authRoutes);
app.use('/api/dashboard',     dashboardRoutes);
app.use('/api/export',        exportRoutes);
app.use('/api/ai',            aiRoutes);
app.use('/api/aria',          ariaRoutes);
app.use('/api/bi',            biRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/siti',          sitiRoutes);
app.use('/api/audit',         auditRoutes);
app.use('/api/audit/sales',   hospitalSalesRoutes);
app.use('/api/data-quality',  dataQualityRoutes);
app.use('/api/pharmacy',      pharmacyRoutes);
app.use('/api/almacen',       almacenRoutes);
app.use('/api/honorarios',    honorariosRoutes);
app.use('/api/sap',           sapRoutes);
app.use('/api/sap-query',     sapQueryBuilderRoutes);
app.use('/api/finanzas',      finanzasRoutes);
app.use('/api/cex',           cexRoutes);
app.use('/api/sistemas/agreements', agreementsRoutes);
app.use('/api/files', authenticate, express.static(path.join(__dirname, 'uploads')));

// Servir Frontend compilado en Producción
let frontendPath = path.join(__dirname, '../frontend/dist');
if (!fs.existsSync(path.join(frontendPath, 'index.html'))) {
  frontendPath = path.join(__dirname, '../frontend');
}

if (fs.existsSync(path.join(frontendPath, 'index.html'))) {
  app.use(express.static(frontendPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

/* Manejo de errores global */
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);

  // Error de validación JWT
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Tu sesión terminó. Inicia sesión de nuevo.' });
  }

  if (err.severity || (err.code && /^[0-9A-Z]{5}$/.test(err.code))) {
    return res.status(500).json({ error: 'No se pudo consultar la información. Intenta de nuevo en unos minutos.' });
  }

  res.status(err.status || 500).json({
    message: err.message || 'Error interno del servidor',
    error:   err.message || 'Error interno del servidor',
  });
});

let dbStatus = 'pendiente';
// Readiness covers warehouse structure only, never SAP/Vertical data freshness.
let dwStatus = 'pendiente';
function failWindowsServiceStartup(phase) {
  if (process.env.BI_WINDOWS_SERVICE !== '1') return;
  console.error('[Backend] No se completó el arranque del servicio; Windows podrá reintentarlo.', {
    code: 'BI_SERVICE_STARTUP_FAILED', phase
  });
  process.exit(1);
}
const { SERVICE_NAME, instanceId } = require('./utils/backendInstance');
const installationId = instanceId(__dirname);

app.get('/health', (req, res) => {
  const windowsService = process.env.BI_WINDOWS_SERVICE === '1';
  res.json({
    service:   SERVICE_NAME,
    installationId,
    environment: process.env.NODE_ENV || 'development',
    status:    dbStatus === 'ok' && (!windowsService || dwStatus === 'ok') ? 'ok' : 'degradado',
    db:        dbStatus,
    ...(windowsService ? { dw: dwStatus } : {}),
    timestamp: new Date().toISOString(),
    version:   '1.0.0',
  });
});

if (process.env.NODE_ENV !== 'test') { (async () => {
  let localIp = 'localhost';
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          localIp = net.address;
          break;
        }
      }
    }
  } catch (e) {}

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏥  Hospital Escandón BI — Backend v2.0`);
    console.log(`🚀  Servidor corriendo en:`);
    console.log(`   ➜ Local:    http://localhost:${PORT}`);
    console.log(`   ➜ Intranet: http://${localIp}:${PORT} (Desde cualquier otra PC o Tablet en la red)`);
    console.log(`🛡️   Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔌  Intentando conectar a PostgreSQL...\n`);
  });

  await new Promise(resolve => {
    server.once('listening', resolve);
    server.once('error', err => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ El puerto ${PORT} ya está ocupado. Usa npm start para comprobar si el backend está disponible o revisa qué proceso ocupa ese puerto.\n`);
      } else console.error('❌ No se pudo abrir el servidor:', err.message);
       
      process.exit(1);
    });
  });

  try {
    await connectDB();
    dbStatus = 'ok';
    const syncHonorariosCatalog = async () => {
      const { syncIfDue } = require('./services/honorariosCatalog.service');
      await syncIfDue(await connectRemoteDB());
    };
    syncHonorariosCatalog().catch(error => console.warn('[Honorarios] Sincronización de catálogo:', error.message));
    const honorariosSyncInterval = Math.max(60000, (Number(process.env.HONORARIOS_CATALOG_SYNC_MINUTES) || 30) * 60000);
    setInterval(() => syncHonorariosCatalog().catch(error => console.warn('[Honorarios] Sincronización de catálogo:', error.message)), honorariosSyncInterval).unref();
    
    // Inicializar conexión a SQL Server Remoto
    connectRemoteDB().catch(e => console.warn('⚠️ SQL Server Remoto no inicializado al arranque.'));
    
    // Inicializar PostgreSQL Data Warehouse y sincronización ETL
    const dwInitialization = initPostgresDW();
    const backgroundQueue = require('./services/backgroundQueue.service');
    dwInitialization.then(async () => {
      dwStatus = 'ok';
      initCronJobs();

      const { startStatisticsSync } = require('./services/statistics.service');
      setTimeout(() => {
        startStatisticsSync().catch(error => console.warn('[Estadísticas] Actualización pendiente:', error.message));
      }, 20000).unref();

      try {
        await initQuirofanoDW();
        initQuirofanoCron();
        const countQx = await pool.query('SELECT COUNT(*) as count FROM dw_quirofano_eventos');
        const isQxEmpty = parseInt(countQx.rows[0].count, 10) === 0;
        console.log(`[Quirofano Sync Startup] ¿Tabla de quirofano vacía?: ${isQxEmpty}`);
        backgroundQueue.enqueue('quirofano', () => syncQuirofanoData({ activityFullSync: isQxEmpty }), { delayMs: 5000 })
          .catch(error => console.warn('[Quirófano] Actualización pendiente:', error.message));
      } catch (err) {
        console.warn('[Quirófano] Inicialización pendiente; los demás tableros continúan.');
      }

      initDashboardCron();

      // Re-entrenamiento automático del modelo ML (diario 04:30)
      try {
        const { initMLCron } = require('./services/mlPipeline.service');
        initMLCron();
      } catch (err) {
        console.warn('⚠️ No se pudo inicializar el cron de ML Pipeline:', err.message);
      }

      // Una sola cola para los ciclos pesados: SAP no recibe dos sincronizaciones
      // simultáneas y las consultas interactivas conservan prioridad.
      backgroundQueue.enqueue('dashboards', () => syncAllDashboards())
        .catch(error => console.warn('[Tableros] Actualización pendiente:', error.message));

      const freshness = await pool.query(`
        SELECT
          EXISTS (SELECT 1 FROM dw_sap_kardex WHERE lastsync >= CURRENT_TIMESTAMP - INTERVAL '15 minutes') AS almacen,
          EXISTS (SELECT 1 FROM dw_sap_traslados WHERE lastsync >= CURRENT_TIMESTAMP - INTERVAL '15 minutes') AS traslados
      `).then(result => result.rows[0] || {}).catch(() => ({}));

      const { syncTraslados } = require('./services/sapTrasladosSync.service');
      backgroundQueue.enqueue('traslados', () => syncTraslados(), { delayMs: freshness.traslados ? 10 * 60000 : 15000 })
        .catch(error => console.warn('[Traslados] Actualización pendiente:', error.message));

      const { runAlmacenSync } = require('./services/almacenSync.service');
      const syncAlmacen = async () => {
        const inventoryService = require('./services/sapInventory.service');
        const recent = await pool.query(`
          SELECT
            EXISTS (
              SELECT 1 FROM dw_sap_inventory_cache
              WHERE lastsync >= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
            ) AS inventory_fresh,
            EXISTS (
              SELECT 1 FROM ml_dataset_reorden_sku
              WHERE fecha_calculo >= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
            ) AS dataset_fresh
        `).then(result => result.rows[0] || {}).catch(() => ({}));
        if (recent.inventory_fresh && recent.dataset_fresh && await inventoryService.loadInventoryFromDB()) {
          console.log('[Almacén] Caché reciente cargada desde PostgreSQL; se omite la descarga completa de SAP al arranque.');
        }
        await runAlmacenSync({ skipInventoryDownload: Boolean(recent.inventory_fresh) });
        console.log('✅ Sincronización inicial de Almacén/Censo completada.');
      };
      backgroundQueue.enqueue('almacen', syncAlmacen, { delayMs: freshness.almacen ? 10 * 60000 : 10000 })
        .catch(error => console.warn('[Almacén] Actualización pendiente:', error.message));

      // Se conserva el ciclo de 15 minutos; la cola impide solapamientos.
      setInterval(() => {
        backgroundQueue.enqueue('almacen', syncAlmacen)
          .catch(error => console.warn('⚠️ Sync background almacén error:', error.message));
      }, 15 * 60 * 1000).unref();
    }).catch(e => {
      dwStatus = 'sin_conexion';
      console.warn('⚠️ Falló la inicialización de Postgres DW.');
      failWindowsServiceStartup('warehouse');
    });

  } catch (err) {
    dbStatus = 'sin_conexion';
    console.warn('\n⚠️   PostgreSQL no disponible:', err.message);
    failWindowsServiceStartup('postgres');
    console.warn('⚠️   El servidor sigue activo pero las rutas de datos fallarán.');
    console.warn('⚠️   Ejecute: node config/init-db.js para crear la BD.\n');
  }
})();
}

module.exports = app;  
