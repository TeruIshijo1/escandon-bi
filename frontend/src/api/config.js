/**
 * api/config.js
 * Configuración centralizada de endpoints
 */

// Usamos ruta relativa '/api' para que el proxy de Vite (en desarrollo) 
// o el servidor (en producción) maneje la redirección al backend.
// Esto permite el acceso desde cualquier PC de la red sin configurar IPs.
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const ENDPOINTS = {
  auth: {
    login: `${API_BASE}/auth/login`,
    me:    `${API_BASE}/auth/me`,
  },
  bi: {
    token: (reportId) => `${API_BASE}/bi/token/${reportId}`,
  },
  // Otros endpoints...
};
