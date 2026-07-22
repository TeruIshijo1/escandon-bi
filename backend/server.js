/**
 * server.js — Entrada principal del Backend
 * Hospital Escandón BI Platform v1.0
 * Node.js + Express · SQLite · JWT
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
const multer        = require('multer');

const { connectDB }         = require('./config/db');
const authRoutes             = require('./routes/auth.routes');
const dashboardRoutes        = require('./routes/dashboard.routes');
const exportRoutes           = require('./routes/export.routes');
const aiRoutes               = require('./routes/ai.routes');
const biRoutes               = require('./routes/bi.routes');
const adminRoutes            = require('./routes/admin.routes');
const testRoutes             = require('./routes/test.routes');
const auditRoutes            = require('./routes/audit.routes');
const { auditMiddleware }    = require('./middleware/audit.middleware');
const { connectRemoteDB }    = require('./config/remote-db');

const app  = express();
const PORT = process.env.PORT || 4000;

/* ── Seguridad global ───────────────────────────────────────── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'https://app.powerbi.com', 'blob:'],
      frameSrc:   ["'self'", 'https://app.powerbi.com', 'blob:'],
      imgSrc:     ["'self'", 'data:', 'blob:', 'https://*', 'http://*'],
      connectSrc: ["'self'", 'https://*', 'http://*', 'ws://*', 'wss://*'],
    },
  },
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
  message: { error: 'Demasiadas solicitudes. Intente en 15 minutos.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message: { error: 'Demasiados intentos de autenticación. Intente más tarde.' },
});

app.use(globalLimiter);
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

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
const { authenticate } = require('./middleware/auth.middleware');
app.post('/upload-assets', authenticate, (req, res) => {
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

app.use('/api/auth',       authLimiter, authRoutes);
app.use('/api/dashboard',  dashboardRoutes);
app.use('/api/export',     exportRoutes);
app.use('/api/ai',         aiRoutes);
app.use('/api/bi',         biRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/test',       testRoutes);
app.use('/api/siti',       sitiRoutes);
app.use('/api/audit',      auditRoutes);
app.use('/api/files',      express.static(path.join(__dirname, 'uploads')));

/* ── Manejo de errores global ───────────────────────────────── */
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);

  // Error de validación JWT
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // Error de SQLite
  if (err.code && err.code.startsWith('SQLITE')) {
    return res.status(500).json({ error: 'Error de base de datos', code: err.code });
  }

  res.status(err.status || 500).json({
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
(() => {
  // El servidor arranca siempre, con o sin BD
  app.listen(PORT, () => {
    console.log(`\n🏥  Hospital Escandón BI — Backend v1.0`);
    console.log(`🚀  Servidor corriendo en http://localhost:${PORT}`);
    console.log(`🛡️   Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔌  Intentando conectar a SQLite...\n`);
  });

  try {
    connectDB();
    dbStatus = 'ok';
    
    // Inicializar conexión a SQL Server Remoto
    connectRemoteDB().catch(e => console.warn('⚠️ SQL Server Remoto no inicializado al arranque.'));
  } catch (err) {
    dbStatus = 'sin_conexion';
    console.warn('\n⚠️   SQLite no disponible:', err.message);
    console.warn('⚠️   El servidor sigue activo pero las rutas de datos fallarán.');
    console.warn('⚠️   Ejecute: node config/init-db.js para crear la BD.\n');
  }
})();

module.exports = app; // para tests
