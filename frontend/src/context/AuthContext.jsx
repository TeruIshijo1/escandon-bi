/**
 * AuthContext.jsx
 * Contexto global de autenticación y RBAC
 * Hospital Escandón BI Platform v3.5
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../api/config';

const AuthContext = createContext(null);


export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  /* ── Inicialización: valida token guardado ───────────────── */
  useEffect(() => {
    const token = sessionStorage.getItem('escandon_token');
    if (!token) { setLoading(false); return; }

    (async () => {
      try {
        const res  = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Token inválido');
        const data = await res.json();
        setUser({ ...data.user, token });
      } catch {
        sessionStorage.removeItem('escandon_token');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ── Login ───────────────────────────────────────────────── */
  const login = useCallback(async (username, password) => {
    setError(null);
    const res = await fetch(`${API_BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (!res.ok) { setError(data.message || 'Error de autenticación'); return false; }

    sessionStorage.setItem('escandon_token', data.token);
    setUser({ ...data.user, token: data.token });
    return true;
  }, []);

  /* ── Logout ──────────────────────────────────────────────── */
  const logout = useCallback(() => {
    sessionStorage.removeItem('escandon_token');
    setUser(null);
  }, []);

  /* ── Helpers RBAC ────────────────────────────────────────── */
  const hasRole = useCallback((role) => user?.role === role, [user]);
  const can     = useCallback((capability) => {
    if (!user) return false;
    const { CAPABILITIES } = require('../utils/rbac');
    return CAPABILITIES[user.role]?.[capability] ?? false;
  }, [user]);

  const value = { user, loading, error, login, logout, hasRole, can };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
