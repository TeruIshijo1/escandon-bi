const dotenv = require('dotenv');

// Cargar variables de entorno si no han sido cargadas
dotenv.config();

const SITI_API_URL = process.env.SITI_API_URL || 'http://192.168.254.21:9000';
const SITI_USER = process.env.SITI_USER;
const SITI_PASS = process.env.SITI_PASS;

let sitiToken = null;

/**
 * Autenticarse contra la API de SITI
 */
async function authenticateSiti() {
  if (!SITI_USER || !SITI_PASS) {
    throw new Error('Faltan credenciales SITI_USER o SITI_PASS en .env');
  }

  try {
    const response = await fetch(`${SITI_API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: SITI_USER,
        password: SITI_PASS
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
    const data = await response.json();
    sitiToken = data.access_token || data.token || data;
    console.log('✅ Autenticado exitosamente con SITI Plataforma.');
  } catch (error) {
    console.error('❌ Error al autenticar con SITI API:', error.message);
    throw new Error('No se pudo autenticar con SITI');
  }
}

/**
 * Obtener las tablas disponibles en SITI
 */
async function getSitiTables() {
  if (!sitiToken) await authenticateSiti();
  
  try {
    let response = await fetch(`${SITI_API_URL}/api/tables`, {
      headers: { 'token': sitiToken }
    });
    
    if (response.status === 401) {
      await authenticateSiti();
      response = await fetch(`${SITI_API_URL}/api/tables`, {
        headers: { 'token': sitiToken }
      });
    }
    return await response.json();
  } catch (error) {
    throw error;
  }
}

/**
 * Ejecutar un query arbitrario en SITI
 * @param {string} sqlQuery 
 */
async function querySiti(sqlQuery) {
  if (!sitiToken) await authenticateSiti();
  
  try {
    let response = await fetch(`${SITI_API_URL}/api/query`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'token': sitiToken 
      },
      body: JSON.stringify({ query: sqlQuery })
    });

    if (response.status === 401) {
      await authenticateSiti();
      response = await fetch(`${SITI_API_URL}/api/query`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'token': sitiToken 
        },
        body: JSON.stringify({ query: sqlQuery })
      });
    }
    return await response.json();
  } catch (error) {
    throw error;
  }
}

module.exports = {
  getSitiTables,
  querySiti
};
