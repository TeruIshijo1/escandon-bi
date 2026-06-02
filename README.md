# 🏥 Hospital Escandón — Plataforma BI v1.0

> Plataforma de Estadísticos e Indicadores con BI Embedded, RBAC y Asistente de IA (RAG)

---

## Inicio Rápido

### 1. Backend
```bash
cd backend
cp .env.example .env          # Configurar variables
npm install
# Definir SEED_ADMIN_PASSWORD en .env antes del primer inicio
npm run db:init               # Crear base de datos SQLite
npm run dev                   # http://localhost:4000
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

---

## Acceso Inicial

Antes de ejecutar `npm run db:init`, configura `SEED_ADMIN_PASSWORD` en
`backend/.env`. El inicializador creará la cuenta administrativa indicada por
`SEED_ADMIN_USERNAME` sin publicar credenciales en el repositorio.

---

## Stack Tecnológico

| Capa        | Tecnología                        |
|-------------|-----------------------------------|
| Frontend    | React 18 + Vite + React Router 6  |
| Backend     | Node.js 20 + Express 4            |
| Base datos  | SQLite 3 (better-sqlite3)         |
| Auth        | JWT (jsonwebtoken) + bcryptjs     |
| BI Embed    | PowerBI REST API                  |
| IA/RAG      | OpenAI GPT-4o / Azure OpenAI      |
| Exportación | pdfkit + exceljs                  |

---

## Estructura de Módulos

```
📦 Prioridad 1 — Auditoría
  └─ Inventarios vs. Cargos de Enfermería (ETL + conciliación)

📊 Prioridad 2 — Salud Operativa
  ├─ Dashboard Directivo (KPIs Eficiencia + Eficacia)
  ├─ Panel de Mando (Vista ejecutiva)
  └─ Macropanel Financiero

🏥 Prioridad 3 — Clínico por Área
  ├─ Quirófano, UCI, Urgencias, Cuneros
  ├─ Imagenología, Laboratorio
  └─ Consulta Externa, Cardiología

🤖 IA — Asistente ARIA (RAG)
  └─ Consultas en lenguaje natural → SQL → GPT-4o → Respuesta

📄 Exportación
  ├─ PDF Ejecutivo (pdfkit)
  └─ Excel Data Explorer (exceljs)
```

---

## Variables de Entorno Requeridas

Ver `backend/.env.example` para la lista completa.

Las más críticas:
- `DB_PATH` (ruta al archivo SQLite, por defecto `../database/escandon_bi.db`)
- `SEED_ADMIN_PASSWORD` (contraseña local para crear el administrador inicial)
- `JWT_SECRET` (mínimo 64 caracteres hex)
- `OPENAI_API_KEY` (para el asistente ARIA)
- `PBI_*` (para PowerBI Embedded)

---

## Documentación

- `docs/api_spec.md` — Especificación completa de endpoints
- `docs/ai_system_prompt.md` — Prompt y flujo RAG del asistente ARIA
- `database/` — DDL, seeds y vistas ETL (SQLite)

---

⚕️ **Hospital Escandón** · Plataforma BI v1.0 · Uso interno y confidencial
