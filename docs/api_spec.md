# API Specification — Hospital Escandón BI v1.0

Base URL: `http://localhost:4000/api`  
Autenticación: `Authorization: Bearer <JWT>`  
Content-Type: `application/json`

---

## Autenticación

| Método | Ruta              | Roles       | Descripción                         |
|--------|-------------------|-------------|-------------------------------------|
| POST   | `/auth/login`     | Público     | Login con username + password       |
| GET    | `/auth/me`        | Autenticado | Datos del usuario autenticado       |
| POST   | `/auth/logout`    | Autenticado | Invalida el refresh token           |

### POST /auth/login
**Body:**
```json
{ "username": "usuario.ejemplo", "password": "<CONTRASENA>" }
```
**Response 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJ...",
  "user": {
    "id": 2,
    "username": "usuario.ejemplo",
    "nombre": "Usuario Ejemplo",
    "role": "DIRECTOR",
    "area": null
  }
}
```

---

## Dashboard

| Método | Ruta                        | Roles                    | Descripción                           |
|--------|-----------------------------|--------------------------|---------------------------------------|
| GET    | `/dashboard/directivo`      | ADMIN, DIRECTOR          | KPIs globales: ocupación, eficacia, QX|
| GET    | `/dashboard/area/:area`     | Todos (filtrado por área)| KPIs del área especificada            |
| GET    | `/dashboard/censo`          | Todos                    | Censo hospitalario actual por área    |

### GET /dashboard/directivo
**Response 200:**
```json
{
  "ok": true,
  "timestamp": "2026-05-04T09:30:00.000Z",
  "data": {
    "ocupacion":  { "TotalCamas": 214, "Ocupadas": 187, "PctOcupacion": 87.4 },
    "eficacia":   { "TasaMortalidad": 1.2, "TotalEgresos": 412, "EstanciaPromedio": 4 },
    "produccion": { "CirugiasHoy": 8, "Realizadas": 6, "Canceladas": 1, "EnCurso": 1 }
  }
}
```

---

## Auditoría (Prioridad 1)

| Método | Ruta                               | Roles            | Descripción                              |
|--------|------------------------------------|------------------|------------------------------------------|
| GET    | `/audit/inventarios-vs-cargos`     | ADMIN, DIRECTOR  | ETL completo: conciliación de órdenes    |
| GET    | `/audit/kpis-productividad`        | ADMIN, DIRECTOR, JEFE_AREA | KPIs operativos del período    |
| GET    | `/audit/tasa-mortalidad`           | ADMIN, DIRECTOR  | Tasa de mortalidad ajustada              |

### GET /audit/inventarios-vs-cargos
**Query params:**
| Param       | Tipo   | Ejemplo        | Descripción                              |
|-------------|--------|----------------|------------------------------------------|
| area        | string | QUIROFANO      | Filtrar por área hospitalaria            |
| estado      | string | DIFERENCIA     | COINCIDE \| DIFERENCIA \| FALTANTE \| EXCEDENTE |
| fechaDesde  | date   | 2026-04-01     | Inicio del período                       |
| fechaHasta  | date   | 2026-04-30     | Fin del período                          |
| limit       | int    | 500            | Máximo de registros (default 500)        |

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "generadoEn": "2026-05-04T09:30:00.000Z",
    "totalRegistros": 247,
    "resumen": {
      "totalPartidas": 247,
      "coincidencias": 218,
      "diferencias": 20,
      "faltantes": 5,
      "excedentes": 4,
      "montoDisputa": 8420.50,
      "porcentajeConciliado": 88.26
    },
    "partidas": [
      {
        "orden": "ORD-24001",
        "paciente": "García Martínez, J.",
        "area": "QUIROFANO",
        "insumo": "Solución Hartmann 1L",
        "cantAlmacen": 4,
        "cantCargo": 4,
        "diferencia": 0,
        "monto": 0,
        "estado": "COINCIDE",
        "enfermera": "E. Ramírez",
        "fecha": "2026-05-04"
      }
    ]
  },
  "meta": {
    "solicitadoPor": "dr.gomez",
    "rol": "DIRECTOR",
    "timestamp": "2026-05-04T09:30:00.000Z"
  }
}
```

---

## Exportación

| Método | Ruta                        | Roles              | Descripción                          |
|--------|-----------------------------|--------------------|--------------------------------------|
| GET    | `/export/excel/:reportId`   | Según capacidad    | Descarga .xlsx con datos crudos      |
| GET    | `/export/pdf/:reportId`     | Según capacidad    | Descarga PDF ejecutivo               |

**Report IDs disponibles:** `directivo-main`, `auditoria-inventarios`, `area-quirofano`, `area-uci`, `area-urgencias`, `area-cuneros`, `area-imagenologia`

**Response:** Binario (application/pdf o application/xlsx) para descarga directa.

---

## Inteligencia Artificial (RAG)

| Método | Ruta          | Roles                          | Descripción                     |
|--------|---------------|--------------------------------|---------------------------------|
| POST   | `/ai/query`   | ADMIN, DIRECTOR, JEFE_AREA     | Consulta en lenguaje natural    |

### POST /ai/query
**Body:**
```json
{ "question": "¿Cuál es la ocupación de camas hoy?" }
```
**Response 200:**
```json
{
  "ok": true,
  "answer": "Con corte al día de hoy, la ocupación hospitalaria por área es:\n• Urgencias: 28/30 (93.3%) ⚠️\n• UCI: 12/14 (85.7%)\n• Quirófano: 6/8 (75.0%)\n• Cuneros: 8/12 (66.7%)",
  "sources": ["SQL Server — Hospital Escandón", "Tabla: ocupacion_camas"],
  "intent": "ocupacion_camas",
  "timestamp": "2026-05-04T09:30:00.000Z"
}
```

---

## PowerBI Embedded

| Método | Ruta               | Roles  | Descripción                            |
|--------|--------------------|--------|----------------------------------------|
| GET    | `/bi/token/:reportId` | Todos | Genera EmbedToken para el reporte     |

**Response 200:**
```json
{
  "embedToken":  "eyJ...",
  "embedUrl":    "https://app.powerbi.com/reportEmbed?reportId=...",
  "reportId":    "report-directivo-001",
  "workspaceId": "workspace-escandon-001",
  "expiresIn":   3600,
  "tokenType":   "Embed"
}
```

---

## Códigos de Error

| Código | Significado               | Cuándo ocurre                                     |
|--------|---------------------------|---------------------------------------------------|
| 400    | Bad Request               | Parámetros faltantes o inválidos                  |
| 401    | Unauthorized              | Token ausente, inválido o expirado                |
| 403    | Forbidden                 | Rol o área no tiene permisos para este recurso    |
| 404    | Not Found                 | Recurso no encontrado (ej. reportId inválido)     |
| 429    | Too Many Requests         | Rate limit excedido (300/15min global, 20/min IA) |
| 500    | Internal Server Error     | Error de BD, de terceros (PowerBI, OpenAI) u otro |

**Formato de error:**
```json
{
  "error": "Descripción del error",
  "code":  "CÓDIGO_INTERNO"
}
```

---

## Rate Limits

| Endpoint          | Límite           | Ventana   |
|-------------------|------------------|-----------|
| `POST /auth/login`| 10 requests      | 15 minutos |
| `POST /ai/query`  | 20 requests/user | 1 minuto  |
| Global            | 300 requests     | 15 minutos |
