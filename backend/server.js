/**
 * server.js — Entrada principal del Backend
 * Hospital Escandón BI Platform v2.0
 * Node.js + Express · PostgreSQL · JWT
 */
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
const { auditMiddleware }    = require('./middleware/audit.middleware');
const { initPostgresDW, pool }     = require('./config/pg-db');
const { initCronJobs, runFullSync } = require('./services/sync.service');
const { initQuirofanoDW, syncQuirofanoData, initQuirofanoCron } = require('./services/quirofanoSync.service');
const { syncAllDashboards, initDashboardCron } = require('./services/dashboardSync.service');

const app  = express();
const PORT = process.env.PORT || 4000;

/* ── Seguridad global ───────────────────────────────────────── */
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

app.use(cors({
  origin:      process.env.CORS_ORIGIN || 'http://localhost:5173', // Solo orígenes configurados
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  exposedHeaders: ['Content-Disposition']
}));

/* ── Rate limiting global ───────────────────────────────────── */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max:      300,
  standardHeaders: true,
  message: { message: 'Demasiadas solicitudes. Intente en 15 minutos.', error: 'Demasiadas solicitudes. Intente en 15 minutos.' },
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  max:      200, // Límite alto por si están detrás del mismo NAT del hospital
  message: { message: 'Demasiados intentos de autenticación. Intente más tarde.', error: 'Demasiados intentos de autenticación. Intente más tarde.' },
});

app.use(globalLimiter);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(xss()); // Sanitiza body, query y params contra inyecciones XSS

/* ── Logging ────────────────────────────────────────────────── */
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(':method :url :status :response-time ms — :res[content-length]'));
}

/* ── Audit log (middleware global para rutas protegidas) ─────── */
app.use('/api', auditMiddleware);

app.get('/api/ping', (req, res) => res.json({ ok: true, message: 'pong' }));

// Configuración de Multer directamente en server.js para máxima fiabilidad
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

// Endpoint de subida directo (FUERA de /api para evitar middleware de auditoría y bloqueos)
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

/* ── Rutas ──────────────────────────────────────────────────── */
const sitiRoutes = require('./routes/siti.routes');
const dataQualityRoutes = require('./routes/dataQuality.routes');

const ariaRoutes = require('./routes/aria.routes');
const pharmacyRoutes = require('./routes/pharmacy.routes');
const sapRoutes = require('./routes/sap.routes');
const almacenRoutes = require('./routes/almacen.routes');
const finanzasRoutes = require('./routes/finanzas.routes');
const cexRoutes = require('./routes/cex.routes');

app.use('/api/auth',          authLimiter, authRoutes);
app.use('/api/dashboard',     dashboardRoutes);
app.use('/api/export',        exportRoutes);
app.use('/api/ai',            aiRoutes);
app.use('/api/aria',          ariaRoutes);
app.use('/api/bi',            biRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/siti',          sitiRoutes);
app.use('/api/audit',         auditRoutes);
app.use('/api/data-quality',  dataQualityRoutes);
app.use('/api/pharmacy',      pharmacyRoutes);
app.use('/api/almacen',       almacenRoutes);
app.use('/api/sap',           sapRoutes);
app.use('/api/finanzas',      finanzasRoutes);
app.use('/api/cex',           cexRoutes);
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

/* ── Manejo de errores global ───────────────────────────────── */
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);

  // Error de validación JWT
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // Error de base de datos (códigos SQLSTATE de PostgreSQL o legacy SQLite)
  if (err.severity || (err.code && /^[0-9A-Z]{5}$/.test(err.code))) {
    return res.status(500).json({ error: 'Error de base de datos', code: err.code });
  }

  res.status(err.status || 500).json({
    message: err.message || 'Error interno del servidor',
    error:   err.message || 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

/* ── Health check ampliado ──────────────────────────────────── */
let dbStatus = 'pendiente';

app.get('/health', (req, res) => {
  res.json({
    status:    dbStatus === 'ok' ? 'ok' : 'degradado',
    db:        dbStatus,
    timestamp: new Date().toISOString(),
    version:   '1.0.0',
  });
});

/* ── Arranque ───────────────────────────────────────────────── */
// En modo test se importa `app` para supertest sin arrancar servidor,
// conexiones a BD ni cron jobs.
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

  // El servidor arranca siempre, con o sin BD
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏥  Hospital Escandón BI — Backend v2.0`);
    console.log(`🚀  Servidor corriendo en:`);
    console.log(`   ➜ Local:    http://localhost:${PORT}`);
    console.log(`   ➜ Intranet: http://${localIp}:${PORT} (Desde cualquier otra PC o Tablet en la red)`);
    console.log(`🛡️   Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔌  Intentando conectar a PostgreSQL...\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ [ERROR EADDRINUSE] El puerto ${PORT} ya está ocupado por otro proceso de Node.js.`);
      console.error(`💡 Solución: Ejecuta "taskkill /F /IM node.exe" para liberar el puerto e inicia nuevamente.\n`);
      process.exit(1);
    }
  });

  try {
    await connectDB();
    dbStatus = 'ok';
    
    // Inicializar conexión a SQL Server Remoto
    connectRemoteDB().catch(e => console.warn('⚠️ SQL Server Remoto no inicializado al arranque.'));
    
    // Inicializar PostgreSQL Data Warehouse y sincronización ETL
    initPostgresDW().then(async () => {
      initCronJobs();
      await initQuirofanoDW();
      initQuirofanoCron();

      // Sincronización de Quirófano (fullSync si está vacía)
      try {
        const countQx = await pool.query('SELECT COUNT(*) as count FROM dw_quirofano_eventos');
        const isQxEmpty = parseInt(countQx.rows[0].count, 10) === 0;
        console.log(`[Quirofano Sync Startup] ¿Tabla de quirofano vacía?: ${isQxEmpty}`);
        syncQuirofanoData({ fullSync: isQxEmpty }).catch(e => console.warn('⚠️ Sync Quirófano DW error:', e.message));
      } catch (err) {
        syncQuirofanoData({ fullSync: false }).catch(e => console.warn('⚠️ Sync Quirófano DW error:', e.message));
      }

      // Sincronizar todos los tableros en PostgreSQL DW (fullSync si alguna tabla clave está vacía)
      initDashboardCron();

      // Re-entrenamiento automático del modelo ML (diario 04:30)
      try {
        const { initMLCron } = require('./services/mlPipeline.service');
        initMLCron();
      } catch (err) {
        console.warn('⚠️ No se pudo inicializar el cron de ML Pipeline:', err.message);
      }

      try {
        const countPC = await pool.query('SELECT COUNT(*) as count FROM dw_vertical_pc');
        const countSrv = await pool.query('SELECT COUNT(*) as count FROM dw_vertical_cuentas_servicios');
        const countCons = await pool.query('SELECT COUNT(*) as count FROM dw_vertical_consulta_dia');
        const countSol = await pool.query('SELECT COUNT(*) as count FROM dw_vertical_solicitudes_estudios');
        
        const isDbEmpty = 
          parseInt(countPC.rows[0].count, 10) === 0 ||
          parseInt(countSrv.rows[0].count, 10) === 0 ||
          parseInt(countCons.rows[0].count, 10) === 0 ||
          parseInt(countSol.rows[0].count, 10) === 0;

        console.log(`[Dashboard Sync Startup] ¿Base de datos local vacía o incompleta?: ${isDbEmpty}`);
        syncAllDashboards({ fullSync: isDbEmpty }).catch(e => console.warn('⚠️ Sync Dashboard DW error:', e.message));
      } catch (err) {
        console.warn('⚠️ Error al comprobar estado de DW Dashboards, ejecutando incremental:', err.message);
        syncAllDashboards({ fullSync: false }).catch(e => console.warn('⚠️ Sync Dashboard DW error:', e.message));
      }

      // Sincronizar traslados en PostgreSQL DW (si está vacía o para actualización rápida)
      try {
        const countT = await pool.query('SELECT COUNT(*) as count FROM dw_sap_traslados');
        const isTEmpty = parseInt(countT.rows[0].count, 10) === 0;
        console.log(`[Traslados Sync Startup] ¿Tabla de traslados vacía?: ${isTEmpty}`);
        const { syncTraslados } = require('./services/sapTrasladosSync.service');
        syncTraslados().then(c => console.log(`[Traslados Sync Startup] Sincronizados ${c} traslados desde SAP.`)).catch(e => console.warn('⚠️ Sync Traslados error:', e.message));
      } catch (err) {
        console.warn('⚠️ Error al comprobar estado de DW Traslados en inicio:', err.message);
      }
    }).catch(e => console.warn('⚠️ Falló la inicialización de Postgres DW.'));

    // Inicializar Sincronización de Data Warehouse Almacén/Cirrus a PostgreSQL
    try {
      const { runAlmacenSync } = require('./services/almacenSync.service');
      runAlmacenSync().then(() => {
        console.log('✅ Sincronización inicial de Almacén/Censo completada.');
      }).catch(err => console.warn('⚠️ Sincronización inicial de Almacén incompleta:', err.message));
      
      // Ejecutar sincronización cada 15 minutos
      setInterval(() => {
        runAlmacenSync().catch(err => console.warn('⚠️ Sync background almacén error:', err.message));
      }, 15 * 60 * 1000);
    } catch(err) {
      console.warn('⚠️ No se pudo iniciar el servicio de sync de Almacén.');
    }

  } catch (err) {
    dbStatus = 'sin_conexion';
    console.warn('\n⚠️   PostgreSQL no disponible:', err.message);
    console.warn('⚠️   El servidor sigue activo pero las rutas de datos fallarán.');
    console.warn('⚠️   Ejecute: node config/init-db.js para crear la BD.\n');
  }
})();
}

module.exports = app; // para tests
