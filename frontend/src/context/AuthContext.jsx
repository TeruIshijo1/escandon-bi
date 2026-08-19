/**
 * AuthContext.jsx
 * Contexto global de autenticación y RBAC
 * Hospital Escandón BI Platform v3.5
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../api/config';
import { getToken, setToken } from '../api/client';
import { CAPABILITIES } from '../utils/rbac';

const AuthContext = createContext(null);

const TOKEN_KEY = 'escandon_token';
const LEGACY_TOKEN_KEY = 'token';

/* Migra el token legacy (localStorage) a sessionStorage una sola vez */
function migrateLegacyToken() {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy && !sessionStorage.getItem(TOKEN_KEY)) {
    sessionStorage.setItem(TOKEN_KEY, legacy);
  }
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}


export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  /* ── Inicialización: valida token guardado ───────────────── */
  useEffect(() => {
    migrateLegacyToken();
    const token = getToken();
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
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ── Login ───────────────────────────────────────────────── */
  const login = useCallback(async (username, password) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = data.message || 'Error de autenticación';
        setError(msg);
        return { ok: false, message: msg };
      }

      setToken(data.token);
      setUser({ ...data.user, token: data.token });
      return { ok: true };
    } catch (err) {
      const msg = 'No se pudo conectar al servidor. Verifique que el backend esté corriendo.';
      setError(msg);
      return { ok: false, message: msg };
    }
  }, []);

  /* ── Logout ──────────────────────────────────────────────── */
  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    setUser(null);
  }, []);

  /* ── Helpers RBAC ────────────────────────────────────────── */
  const hasRole = useCallback((role) => user?.role === role, [user]);
  const can     = useCallback((capability) => {
    if (!user) return false;
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
