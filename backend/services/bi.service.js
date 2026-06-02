/**
 * bi.service.js — Servicio de PowerBI Embedded
 * Hospital Escandón BI Platform v1.0
 *
 * Implementa el flujo OAuth2 Client Credentials de Azure AD
 * para obtener tokens de acceso y generar EmbedTokens de PowerBI.
 *
 * Documentación oficial:
 *  https://learn.microsoft.com/en-us/power-bi/developer/embedded/embed-sample-for-customers
 */
'use strict';

/* ── Configuración desde variables de entorno ───────────── */
const PBI_CONFIG = {
  tenantId:     process.env.PBI_TENANT_ID,
  clientId:     process.env.PBI_CLIENT_ID,
  clientSecret: process.env.PBI_CLIENT_SECRET,
  workspaceId:  process.env.PBI_WORKSPACE_ID,
  scope:        'https://analysis.windows.net/powerbi/api/.default',
  authorityUrl: `https://login.microsoftonline.com/${process.env.PBI_TENANT_ID}/oauth2/v2.0/token`,
  apiBase:      'https://api.powerbi.com/v1.0/myorg',
};

/* Cache de token Azure AD (evita llamadas innecesarias) */
let cachedToken   = null;
let tokenExpiresAt = 0;

/* ══════════════════════════════════════════════════════════
   1. Obtener Access Token de Azure AD (Client Credentials)
══════════════════════════════════════════════════════════ */
async function getAzureADToken() {
  const now = Date.now();

  // Usar token cacheado si sigue vigente (margen de 2 min)
  if (cachedToken && now < tokenExpiresAt - 120_000) {
    return cachedToken;
  }

  // Modo demo: sin credenciales reales
  if (!PBI_CONFIG.clientId || !PBI_CONFIG.clientSecret) {
    return 'DEMO_TOKEN_NO_AZURE_CREDENTIALS';
  }

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     PBI_CONFIG.clientId,
    client_secret: PBI_CONFIG.clientSecret,
    scope:         PBI_CONFIG.scope,
  });

  const res  = await fetch(PBI_CONFIG.authorityUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Azure AD token error: ${res.status} — ${err}`);
  }

  const data       = await res.json();
  cachedToken      = data.access_token;
  tokenExpiresAt   = now + (data.expires_in * 1000);

  return cachedToken;
}

/* ══════════════════════════════════════════════════════════
   2. Generar EmbedToken para un reporte específico
   https://api.powerbi.com/v1.0/myorg/groups/{workspaceId}/reports/{reportId}/GenerateToken
══════════════════════════════════════════════════════════ */
async function generateEmbedToken(workspaceId, reportId, accessLevel = 'view') {
  const azureToken = await getAzureADToken();

  // Modo demo
  if (azureToken === 'DEMO_TOKEN_NO_AZURE_CREDENTIALS') {
    return {
      token:     Buffer.from(JSON.stringify({ reportId, demo: true, exp: Date.now() + 3600000 })).toString('base64'),
      expiration: new Date(Date.now() + 3600000).toISOString(),
      tokenId:   'demo-token-id',
    };
  }

  const url = `${PBI_CONFIG.apiBase}/groups/${workspaceId}/reports/${reportId}/GenerateToken`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${azureToken}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ accessLevel }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PowerBI GenerateToken error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  return {
    token:      data.token,
    expiration: data.expiration,
    tokenId:    data.tokenId,
  };
}

/* ══════════════════════════════════════════════════════════
   3. Obtener metadata del reporte (embedUrl, datasetId)
══════════════════════════════════════════════════════════ */
async function getReportDetails(workspaceId, reportId) {
  const azureToken = await getAzureADToken();

  if (azureToken === 'DEMO_TOKEN_NO_AZURE_CREDENTIALS') {
    return {
      id:       reportId,
      name:     'Reporte Demo — Hospital Escandón',
      embedUrl: `https://app.powerbi.com/reportEmbed?reportId=${reportId}&groupId=${workspaceId}`,
      webUrl:   `https://app.powerbi.com/groups/${workspaceId}/reports/${reportId}`,
      datasetId:'demo-dataset-id',
    };
  }

  const url = `${PBI_CONFIG.apiBase}/groups/${workspaceId}/reports/${reportId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${azureToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PowerBI GetReport error: ${res.status} — ${err}`);
  }

  return await res.json();
}

/* ══════════════════════════════════════════════════════════
   4. Función orquestadora: obtiene todo lo necesario
      para inicializar powerbi-client en el frontend
══════════════════════════════════════════════════════════ */
async function getEmbedConfig(workspaceId, reportId) {
  const [details, embedToken] = await Promise.all([
    getReportDetails(workspaceId, reportId),
    generateEmbedToken(workspaceId, reportId),
  ]);

  return {
    reportId:    details.id,
    embedUrl:    details.embedUrl,
    embedToken:  embedToken.token,
    tokenExpiry: embedToken.expiration,
    workspaceId,
    settings: {
      filterPaneEnabled:    true,
      navContentPaneEnabled: false,
      background:           'Transparent',
    },
  };
}

module.exports = {
  getEmbedConfig,
  getAzureADToken,
  generateEmbedToken,
  getReportDetails,
};
