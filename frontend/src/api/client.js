/**
 * api/client.js — Cliente HTTP centralizado de la plataforma
 * Hospital Escandón BI Platform
 *
 * Unifica:
 *  - Inyección del token JWT (sessionStorage) en el header Authorization
 *  - Manejo de errores consistente (ApiError con status)
 *  - Parseo de JSON seguro
 *  - Soporte para respuestas binarias (blob) en exportaciones
 *
 * Uso:
 *   const data = await apiFetch('/dashboard/stats');
 *   const blob = await apiFetch('/export/pdf/x', { raw: 'blob' });
 */
import { API_BASE } from './config';

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

const TOKEN_KEY = 'escandon_token';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * Fetch centralizado.
 * @param {string} path  Ruta API (ej. '/dashboard/stats' o '/api/dashboard/stats')
 * @param {Object} options { method, body, params, headers, raw }
 *   - params: objeto → query string
 *   - raw: 'blob' | 'text' para no intentar parsear JSON
 * @returns {Promise<any>} JSON parseado, blob o texto
 */
export async function apiFetch(path, {
  method = 'GET',
  body,
  params,
  headers = {},
  raw,
} = {}) {
  let url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : '/' + path}`;

  if (params) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
  }

  const token = getToken();
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Respuestas binarias (PDF/Excel)
  if (raw === 'blob') {
    if (!res.ok) throw new ApiError(res.status, `Error ${res.status} al descargar el archivo`);
    return res.blob();
  }
  if (raw === 'text') {
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, text || `Error ${res.status}`);
    return text;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Sin cuerpo JSON: usar texto si existe
    data = await res.text().catch(() => null);
  }

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Error del servidor (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }

  return data;
}