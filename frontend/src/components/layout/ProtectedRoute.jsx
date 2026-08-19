/**
 * ProtectedRoute.jsx
 * HOC de protección de rutas con lógica RBAC
 * Hospital Escandón BI Platform v3.5
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canAccessRoute, hasPermission, ROUTE_TO_PERMISSION } from '../../utils/rbac';

/**
 * @param {string[]} allowedRoles  - Roles permitidos para la ruta
 * @param {string}   requiredArea  - Área requerida (opcional, para Jefes/Operativos)
 * @param {string}   requiredUsername - Usuario específico requerido (opcional)
 * @param {ReactNode} children
 */
export default function ProtectedRoute({ allowedRoles, requiredArea, requiredUsername, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <LoadingSpinner />
      </div>
    );
  }

  // No autenticado → login
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 1. Verificar permisos individuales del usuario como MÁXIMA AUTORIDAD
  const hasPerm = hasPermission(user, location.pathname);

  // Si el rbac dictamina que no tiene permiso explícito (y la ruta exigía uno), rebotar
  if (!hasPerm) {
    return <Navigate to="/sin-acceso" replace />;
  }

  const permId = ROUTE_TO_PERMISSION[location.pathname];

  // 2. Si la ruta NO tiene un ID de permiso mapeado, caemos en la validación clásica de roles
  if (!permId) {
    const allowed = allowedRoles
      ? allowedRoles.includes(user.role)
      : canAccessRoute(user.role, location.pathname, user.area, requiredArea);
      
    if (!allowed) {
      return <Navigate to="/sin-acceso" replace />;
    }
  }

  if (requiredUsername && user.username !== requiredUsername) {
    return <Navigate to="/sin-acceso" replace />;
  }

  return children;
}

function LoadingSpinner() {
  return (
    <div style={{
      width: 40,
      height: 40,
      border: '3px solid rgba(0,70,135,0.1)',
      borderTop: '3px solid #004687',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
