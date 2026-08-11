/**
 * sap.service.js
 * Servicio Core para conexión con SAP Business One (Service Layer)
 */
'use strict';

const https = require('https');
const sapConfig = require('../config/sap.config');

class SapService {
  constructor() {
    this.sessionCookie = null;
    this.sessionExpiresAt = null;
    
    // Configurar Agente HTTPS para SAP
    // Útil si SAP usa certificados autofirmados
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: sapConfig.rejectUnauthorized
    });
  }

  /**
   * Helper interno para hacer peticiones HTTP
   */
  _request(endpoint, method, payload = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(`${sapConfig.baseUrl}${endpoint}`);
      
      const options = {
        method: method,
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        agent: this.httpsAgent,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...headers
        }
      };

      let payloadString = '';
      if (payload && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
        options.headers['Content-Length'] = Buffer.byteLength(payloadString, 'utf8');
      }

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(data);
          } catch(e) {
            json = data; // fallback a texto si no es json
          }
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: json
            });
          } else {
            reject({
              status: res.statusCode,
              error: json
            });
          }
        });
      });

      req.on('error', (err) => reject(err));
      
      if (payloadString) {
        req.write(payloadString);
      }
      
      req.end();
    });
  }

  /**
   * Inicia sesión en SAP y guarda la cookie en caché
   */
  async login() {
    if (!sapConfig.companyDb || !sapConfig.username || !sapConfig.password) {
      throw new Error('Credenciales de SAP no configuradas en el servidor.');
    }

    try {
      const payload = {
        CompanyDB: sapConfig.companyDb,
        UserName: sapConfig.username,
        Password: sapConfig.password
      };

      console.log(`[SAP] Intentando login en ${sapConfig.baseUrl} para base de datos ${sapConfig.companyDb}...`);
      const response = await this._request('/Login', 'POST', payload);
      
      // Extraer Cookies de SAP (B1SESSION y ROUTEID)
      if (response.headers && response.headers['set-cookie']) {
        // Concatenamos todas las cookies que SAP manda (separadas por ;)
        const cookies = response.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
        this.sessionCookie = cookies;
      } else {
        // Fallback en caso de que el balancer no devuelva Set-Cookie
        this.sessionCookie = `B1SESSION=${response.data.SessionId}`;
      }

      // El timeout default de SAP suele ser de 30 mins. Restamos 5 min de margen.
      const timeoutMinutes = response.data.SessionTimeout || 30;
      this.sessionExpiresAt = Date.now() + ((timeoutMinutes - 5) * 60 * 1000);
      
      console.log('[SAP] Login exitoso. Sesión cacheada.');
      return true;
    } catch (error) {
      console.error('[SAP] Error al iniciar sesión:', error);
      throw error;
    }
  }

  /**
   * Verifica si hay una sesión válida. Si no, inicia sesión automáticamente.
   */
  async _ensureSession() {
    if (!this.sessionCookie || !this.sessionExpiresAt || Date.now() > this.sessionExpiresAt) {
      console.log('[SAP] Sesión inválida o expirada. Renovando automáticamente...');
      await this.login();
    }
  }

  /**
   * Helper interno con reintentos automáticos para errores temporales (502, 503, 504, drop de red)
   */
  async _requestWithRetry(endpoint, method, payload = null, headers = {}, retries = 2) {
    try {
      return await this._request(endpoint, method, payload, headers);
    } catch (err) {
      if (retries > 0 && (err.status === 502 || err.status === 503 || err.status === 504 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        console.warn(`[SAP] Error HTTP ${err.status || err.code} al consultar ${endpoint}. Reintentando en 1.5s (${retries} restantes)...`);
        await new Promise(r => setTimeout(r, 1500));
        return this._requestWithRetry(endpoint, method, payload, headers, retries - 1);
      }
      throw err;
    }
  }

  /**
   * Petición GET genérica a SAP
   * Ej: await sapService.get('/Items')
   */
  async get(endpoint, additionalHeaders = {}) {
    await this._ensureSession();
    return this._requestWithRetry(endpoint, 'GET', null, {
      'Cookie': this.sessionCookie,
      ...additionalHeaders
    });
  }

  /**
   * Petición POST genérica a SAP
   * Ej: await sapService.post('/Orders', { ... })
   */
  async post(endpoint, payload, additionalHeaders = {}) {
    await this._ensureSession();
    return this._requestWithRetry(endpoint, 'POST', payload, {
      'Cookie': this.sessionCookie,
      ...additionalHeaders
    });
  }

  /**
   * Petición PATCH genérica a SAP
   */
  async patch(endpoint, payload, additionalHeaders = {}) {
    await this._ensureSession();
    return this._requestWithRetry(endpoint, 'PATCH', payload, {
      'Cookie': this.sessionCookie,
      ...additionalHeaders
    });
  }

  /**
   * Fetch a SAP Service Layer endpoint handling pagination automatically (odata.nextLink)
   * Returns an array of all values. Caches results for 5 minutes by endpoint key.
   */
  async fetchAllPages(endpoint, additionalHeaders = {}) {
    if (!this.cache) this.cache = new Map();
    
    const cacheKey = endpoint;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.data;
    }

    let allValues = [];
    // Ensure $top=1000 is present if not already specified to fetch larger chunks per request
    let currentEndpoint = endpoint;
    if (!currentEndpoint.includes('$top=')) {
      const sep = currentEndpoint.includes('?') ? '&' : '?';
      currentEndpoint += `${sep}$top=1000`;
    }
    
    let pageCount = 0;
    const maxPages = 10; // Cap at 10 pages max (up to 10,000 records) to prevent hanging
    
    const headers = { 'Prefer': 'odata.maxpagesize=1000', ...additionalHeaders };
    
    while (currentEndpoint && pageCount < maxPages) {
      pageCount++;
      try {
        if (!currentEndpoint.includes('$top=')) {
          const sep = currentEndpoint.includes('?') ? '&' : '?';
          currentEndpoint += `${sep}$top=1000`;
        }
        const response = await this.get(currentEndpoint, headers);
        const data = response.data;
        
        if (data && data.value && Array.isArray(data.value)) {
          allValues = allValues.concat(data.value);
        }
        
        if (data && data['odata.nextLink']) {
          currentEndpoint = data['odata.nextLink'].startsWith('/') ? data['odata.nextLink'] : `/${data['odata.nextLink']}`;
        } else {
          currentEndpoint = null;
        }
      } catch (err) {
        console.error(`[SAP] Error fetching page ${pageCount} for ${currentEndpoint}:`, err.message || err);
        break;
      }
    }
    
    // Save to cache
    this.cache.set(cacheKey, { timestamp: Date.now(), data: allValues });
    return allValues;
  }
}

// Exportar como Singleton para que toda la app comparta la misma sesión en memoria
const sapServiceInstance = new SapService();
module.exports = sapServiceInstance;
