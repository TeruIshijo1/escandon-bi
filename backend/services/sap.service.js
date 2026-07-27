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
   * Petición GET genérica a SAP
   * Ej: await sapService.get('/Orders?$top=5')
   */
  async get(endpoint) {
    await this._ensureSession();
    return this._request(endpoint, 'GET', null, {
      'Cookie': this.sessionCookie
    });
  }

  /**
   * Petición POST genérica a SAP
   * Ej: await sapService.post('/Orders', { ... })
   */
  async post(endpoint, payload) {
    await this._ensureSession();
    return this._request(endpoint, 'POST', payload, {
      'Cookie': this.sessionCookie
    });
  }
}

// Exportar como Singleton para que toda la app comparta la misma sesión en memoria
const sapServiceInstance = new SapService();
module.exports = sapServiceInstance;
