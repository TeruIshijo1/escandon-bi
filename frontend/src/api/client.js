

import { API_BASE } from './config';
import { userMessage } from '../utils/userMessages';

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(userMessage(message, status));
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

export async function apiFetch(path, {
  method = 'GET',
  body,
  params,
  headers = {},
  raw,
  signal,
} = {}) {
  const cleanPath = path.replace(/^\/api(?=\/|$)/, '');
  let url = path.startsWith('http') ? path : `${API_BASE}${cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath}`;

  if (params) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
  }

  const token = getToken();
  let res;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: {
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
     
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    throw new ApiError(0, userMessage(error));
  }

  if (raw === 'blob') {
    if (!res.ok) throw new ApiError(res.status, 'No se pudo descargar el archivo. Intenta de nuevo.');
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
     
    data = await res.text().catch(() => null);
  }

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || 'No se pudo completar la acción. Intenta de nuevo.';
    throw new ApiError(res.status, msg, data);
  }

  return data;
}
