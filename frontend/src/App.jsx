/**
 * App.jsx — Router principal con protección de rutas RBAC
 * Hospital Escandón BI Platform v3.5
 *
 * Estructura de rutas:
 *   /login                → Pública
 *   /                     → Todos los roles autenticados
 *   /dashboard/directivo  → ADMIN, DIRECTOR
 *   /dashboard/mando      → ADMIN, DIRECTOR
 *   /dashboard/area       → Todos (filtrado por área)
 *   /auditoria/*          → ADMIN, DIRECTOR
 *   /estadisticas         → ADMIN, DIRECTOR, JEFE_AREA
 *   /reportes             → Todos
 *   /admin/*              → ADMIN solamente
 *   /sin-acceso           → Pública (error 403)
 */
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';

import { AuthProvider }    from './context/AuthContext';
import ProtectedRoute      from './components/layout/ProtectedRoute';
import AppShell            from './components/layout/AppShell';
import { ROLES }           from './utils/rbac';
import './styles/globals.css';

/* ── Carga diferida de páginas (code splitting) ──────────────── */
const LoginPage           = lazy(() => import('./pages/LoginPage'));
const HomePage            = lazy(() => import('./pages/HomePage'));
const DashboardDirectivo  = lazy(() => import('./components/dashboard/DashboardDirectivo'));
const DashboardMando      = lazy(() => import('./pages/DashboardMando'));
const DashboardArea       = lazy(() => import('./pages/DashboardArea'));
const AuditoriaInventarios = lazy(() => import('./components/audit/InventarioVsCargos'));
const AuditoriaCargos     = lazy(() => import('./pages/AuditoriaCargos'));
const Estadisticas        = lazy(() => import('./pages/Estadisticas'));
const Reportes            = lazy(() => import('./pages/Reportes'));
const AdminUsuarios       = lazy(() => import('./pages/AdminUsuarios'));
const AdminAuditoriaLog   = lazy(() => import('./pages/AdminAuditoriaLog'));
const AdminConfiguracion  = lazy(() => import('./pages/AdminConfiguracion'));
const SinAcceso           = lazy(() => import('./pages/SinAcceso'));

/* ── Fallback de carga ───────────────────────────────────────── */
function PageLoader() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '60vh',
      flexDirection: 'column',
      gap: '1rem',
    }}>
      <div style={{
        width: 48,
        height: 48,
        border: '4px solid rgba(0,70,135,0.1)',
        borderTop: '4px solid #004687',
        borderRadius: '50%',
        animation: 'spin 0.9s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <span style={{ color: '#8A97A8', fontSize: '0.85rem' }}>Cargando módulo…</span>
    </div>
  );
}

/* ── Componente raíz ─────────────────────────────────────────── */
export default function App() {
  // ── Medidas de Seguridad Global Anti-Inspección ──
  useEffect(() => {
    // 1. Deshabilitar menús contextuales (Click derecho)
    const preventContextMenu = (e) => e.preventDefault();
    window.addEventListener('contextmenu', preventContextMenu);

    // 2. Deshabilitar atajos de teclado de DevTools y guardado
    const preventShortcuts = (e) => {
      // F12
      if (e.keyCode === 123) {
        e.preventDefault();
        return false;
      }
      // Ctrl+Shift+I / J / C (DevTools)
      if (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) {
        e.preventDefault();
        return false;
      }
      // Ctrl+U (Ver código fuente), Ctrl+S (Guardar), Ctrl+P (Imprimir)
      if (e.ctrlKey && (e.keyCode === 85 || e.keyCode === 83 || e.keyCode === 80)) {
        e.preventDefault();
        return false;
      }
    };
    window.addEventListener('keydown', preventShortcuts);

    // 3. Deshabilitar arrastrar elementos (para evitar extraer imágenes/links)
    const preventDrag = (e) => e.preventDefault();
    window.addEventListener('dragstart', preventDrag);

    // 4. Bloquear la consola para evitar que vean logs u objetos
    const noop = () => {};
    ['log', 'info', 'warn', 'error', 'table', 'trace', 'dir'].forEach((method) => {
      if (window.console && console[method]) {
        console[method] = noop;
      }
    });

    // 5. Annoyance debugger (cierra la ejecución si tienen devtools abierto por alguna razón)
    const antiDebug = setInterval(() => {
      const start = new Date();
      debugger; // eslint-disable-line no-debugger
      if (new Date() - start > 100) {
        // Si tarda más de 100ms, significa que el debugger se activó y pausó la ejecución
        document.body.innerHTML = '<div style="display:flex;height:100vh;align-items:center;justify-content:center;font-family:sans-serif;color:#004687;font-weight:bold;">ACCESO DENEGADO - MODO DESARROLLADOR DETECTADO</div>';
      }
    }, 2000);

    return () => {
      window.removeEventListener('contextmenu', preventContextMenu);
      window.removeEventListener('keydown', preventShortcuts);
      window.removeEventListener('dragstart', preventDrag);
      clearInterval(antiDebug);
    };
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>

            {/* ── Ruta pública: Login ── */}
            <Route path="/login"      element={<LoginPage />} />
            <Route path="/sin-acceso" element={<SinAcceso />} />

            {/* ── Rutas protegidas dentro del AppShell ── */}
            <Route element={
              <ProtectedRoute allowedRoles={Object.values(ROLES)}>
                <AppShell />
              </ProtectedRoute>
            }>

              {/* Home / Resumen */}
              <Route index element={<HomePage />} />

              {/* Dashboard Directivo — ADMIN + DIRECTOR */}
              <Route
                path="dashboard/directivo"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.DIRECTOR]}>
                    <DashboardDirectivo />
                  </ProtectedRoute>
                }
              />

              {/* Panel de Mando — ADMIN + DIRECTOR */}
              <Route
                path="dashboard/mando"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.DIRECTOR]}>
                    <DashboardMando />
                  </ProtectedRoute>
                }
              />

              {/* Dashboard por Área — Todos (filtrado por área del usuario) */}
              <Route
                path="dashboard/area"
                element={
                  <ProtectedRoute allowedRoles={Object.values(ROLES)}>
                    <DashboardArea />
                  </ProtectedRoute>
                }
              />

              {/* Auditoría — ADMIN + DIRECTOR */}
              <Route
                path="auditoria/inventarios"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.DIRECTOR]}>
                    <AuditoriaInventarios />
                  </ProtectedRoute>
                }
              />
              <Route
                path="auditoria/cargos"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.DIRECTOR]}>
                    <AuditoriaCargos />
                  </ProtectedRoute>
                }
              />

              {/* Estadísticas — ADMIN, DIRECTOR, JEFE_AREA */}
              <Route
                path="estadisticas"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN, ROLES.DIRECTOR, ROLES.JEFE_AREA]}>
                    <Estadisticas />
                  </ProtectedRoute>
                }
              />

              {/* Reportes — Todos */}
              <Route
                path="reportes"
                element={
                  <ProtectedRoute allowedRoles={Object.values(ROLES)}>
                    <Reportes />
                  </ProtectedRoute>
                }
              />

              {/* Administración — Solo ADMIN */}
              <Route
                path="admin/usuarios"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                    <AdminUsuarios />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/auditoria-log"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                    <AdminAuditoriaLog />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/configuracion"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                    <AdminConfiguracion />
                  </ProtectedRoute>
                }
              />

              {/* Ruta no encontrada dentro del shell */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>

            {/* Ruta global 404 */}
            <Route path="*" element={<Navigate to="/login" replace />} />

          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
