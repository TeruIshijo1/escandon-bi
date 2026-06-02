/**
 * useKPIConfig.js — Hook para leer y actualizar configuración de KPIs
 * Hospital Escandón BI Platform v4.0
 *
 * Uso:
 *   const { getKPI, updateKPI, loading } = useKPIConfig();
 *   const kpi = getKPI('directivo.ocupacion');
 *   // → { nombre, icono, pbiUrl, nombreDefault, nombreCustom }
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../api/config';

// Cache en memoria (dura mientras la sesión esté activa)
let _cache = null;
let _listeners = [];

const notifyListeners = () => _listeners.forEach(fn => fn());

export function useKPIConfig() {
  const [config, setConfig] = useState(_cache);
  const [loading, setLoading] = useState(!_cache);

  // Suscribirse a cambios del cache compartido
  useEffect(() => {
    const update = () => setConfig({ ..._cache });
    _listeners.push(update);
    return () => { _listeners = _listeners.filter(fn => fn !== update); };
  }, []);

  // Cargar config si no está en caché
  useEffect(() => {
    if (_cache) { setConfig(_cache); setLoading(false); return; }
    const token = sessionStorage.getItem('escandon_token');
    if (!token) return;

    fetch(`${API_BASE}/dashboard/kpi-config`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(json => {
        if (json.ok) {
          _cache = json.data;
          setConfig(_cache);
          notifyListeners();
        }
      })
      .catch(err => console.error('[useKPIConfig]', err))
      .finally(() => setLoading(false));
  }, []);

  /** Devuelve la config de un KPI por su elementoId */
  const getKPI = useCallback((elementoId) => {
    if (!config) {
      // Mientras carga: generar nombre legible del elementoId como fallback
      const parts = (elementoId || '').split('.');
      const fallback = parts[parts.length - 1]?.replace(/_/g, ' ') || elementoId;
      return { nombre: fallback, icono: '📊', pbiUrl: null, nombreDefault: fallback, nombreCustom: null };
    }
    return config[elementoId] || { nombre: elementoId, icono: '📊', pbiUrl: null };
  }, [config]);


  /** Actualiza un KPI en la BD y refresca el caché local */
  const updateKPI = useCallback(async (elementoId, { nombreCustom, icono, pbiUrl }) => {
    const token = sessionStorage.getItem('escandon_token');
    const res = await fetch(`${API_BASE}/admin/kpi-config/${elementoId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nombreCustom, icono, pbiUrl }),
    });
    const json = await res.json();
    if (json.ok && _cache) {
      // Actualizar caché local inmediatamente (sin esperar re-fetch)
      _cache[elementoId] = {
        ...(_cache[elementoId] || {}),
        nombre:      nombreCustom || (_cache[elementoId]?.nombreDefault || elementoId),
        icono:       icono        || _cache[elementoId]?.icono,
        pbiUrl:      pbiUrl       || null,
        nombreCustom: nombreCustom || null,
      };
      notifyListeners();
    }
    return json;
  }, []);

  /** Invalida el caché (fuerza re-fetch en el próximo render) */
  const invalidate = useCallback(() => {
    _cache = null;
    notifyListeners();
  }, []);

  return { config, loading, getKPI, updateKPI, invalidate };
}
