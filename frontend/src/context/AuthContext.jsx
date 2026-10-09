/**
 * AuthContext.jsx
 * Contexto global de autenticación y RBAC
 * Hospital Escandón BI Platform v3.5
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../api/config';
import { getToken, setToken } from '../api/client';
import { CAPABILITIES } from '../utils/rbac';
import { requestAssignedReportAccess } from '../utils/assignedReportAccess';

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
  const [assignedReportAccess, setAssignedReportAccess] = useState({ token: null, available: false });
  const assignmentSession = useRef(null);
  const assignmentRequest = useRef(0);
  const assignmentAbort = useRef(null);

  const refreshAssignedReportAccess = useCallback(async () => {
    const token = user?.token;
    if (!token) return false;
    const requestId = ++assignmentRequest.current;
    assignmentAbort.current?.abort();
    const controller = new AbortController();
    assignmentAbort.current = controller;
    try {
      const available = await requestAssignedReportAccess(API_BASE, token, controller.signal);
      if (assignmentSession.current === token && requestId === assignmentRequest.current) {
        setAssignedReportAccess({ token, available });
      }
      return available;
    } catch {
      if (assignmentSession.current === token && requestId === assignmentRequest.current) {
        setAssignedReportAccess({ token, available: false });
      }
      return false;
    } finally {
      if (assignmentAbort.current === controller) assignmentAbort.current = null;
    }
  }, [user?.token]);

  useEffect(() => {
    assignmentSession.current = user?.token || null;
    ++assignmentRequest.current;
    if (!user?.token) {
      setAssignedReportAccess({ token: null, available: false });
      return undefined;
    }
    refreshAssignedReportAccess();
    const onFocus = () => { refreshAssignedReportAccess(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAssignedReportAccess(); };
    const timer = window.setInterval(onFocus, 60000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      assignmentSession.current = null;
      ++assignmentRequest.current;
      assignmentAbort.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.token, refreshAssignedReportAccess]);

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
        if (!res.ok) throw new Error('Tu sesión terminó. Inicia sesión de nuevo.');
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
      const msg = 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.';
      setError(msg);
      return { ok: false, message: msg };
    }
  }, []);

  /* ── Logout ──────────────────────────────────────────────── */
  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    setUser(null);
    assignmentSession.current = null;
    ++assignmentRequest.current;
    assignmentAbort.current?.abort();
    setAssignedReportAccess({ token: null, available: false });
  }, []);

  /* ── Helpers RBAC ────────────────────────────────────────── */
  const hasRole = useCallback((role) => user?.role === role, [user]);
  const can     = useCallback((capability) => {
    if (!user) return false;
    return CAPABILITIES[user.role]?.[capability] ?? false;
  }, [user]);

  const hasAssignedReports = Boolean(user?.token && assignedReportAccess.token === user.token && assignedReportAccess.available);
  const assignedReportsLoading = Boolean(user?.token && assignedReportAccess.token !== user.token);
  const value = { user, loading, error, login, logout, hasRole, can,
    hasAssignedReports, assignedReportsLoading, refreshAssignedReportAccess };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
