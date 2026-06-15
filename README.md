<div align="center">
  <h1>🏥 Hospital Escandón — Plataforma BI</h1>
  <p><strong>Plataforma de Estadísticos e Indicadores con BI Embedded, RBAC y Asistente de IA (RAG)</strong></p>
  <p>
    <img src="https://img.shields.io/badge/React-18-blue.svg" alt="React" />
    <img src="https://img.shields.io/badge/Node.js-20-green.svg" alt="Node.js" />
    <img src="https://img.shields.io/badge/Vite-5-purple.svg" alt="Vite" />
    <img src="https://img.shields.io/badge/SQLite-3-lightgrey.svg" alt="SQLite" />
    <img src="https://img.shields.io/badge/PowerBI-Embedded-yellow.svg" alt="PowerBI" />
  </p>
</div>

---

## 📖 Descripción del Proyecto

La **Plataforma BI Hospital Escandón** es una solución integral orientada a la toma de decisiones clínicas, operativas y directivas. Combina cuadros de mando avanzados incrustados mediante **PowerBI Embedded**, control de acceso basado en roles (**RBAC**), y un innovador **Asistente de IA** (ARIA) integrado con RAG, capaz de generar consultas a las bases de datos internas respondiendo en lenguaje natural.

## ✨ Características Principales

- 🔐 **Control de Acceso (RBAC):** Sistema robusto con Autenticación JWT y roles personalizables (Superadmin, Directivo, Auditor, Médico Jefe).
- 📊 **PowerBI Embedded:** Dashboards interactivos incrustados sin necesidad de salir de la aplicación.
- 🤖 **Asistente ARIA (IA - RAG):** Asistente virtual impulsado por OpenAI (GPT-4o) para consultas analíticas instantáneas vía chat.
- 🏥 **Módulos Clínicos y Operativos:** Monitorización del Quirófano, UCI, Consulta Externa e Inventarios.
- 📄 **Exportación Dinámica:** Generación de reportes en formatos PDF interactivo y hojas de cálculo (Excel).

## 🛠️ Stack Tecnológico

| Capa        | Tecnología                        | Versión   |
|-------------|-----------------------------------|-----------|
| **Frontend**| React + Vite + React Router DOM   | 18 / 5 / 6|
| **Estilos** | CSS Vanilla (Variables, Módulos)  | —         |
| **Backend** | Node.js + Express                 | 20 / 4    |
| **Base Datos**| SQLite 3 (better-sqlite3)       | 3         |
| **Auth**    | JWT (jsonwebtoken) + bcryptjs     | 9         |
| **BI Embed**| PowerBI REST API                  | v1.0      |
| **IA/RAG**  | OpenAI API / Azure OpenAI (GPT-4o)| —         |
| **Reportes**| pdfkit + exceljs                  | —         |

## 🚀 Inicio Rápido (Instalación Local)

### Prerrequisitos
- [Node.js](https://nodejs.org/es/) (v20 o superior recomendado)
- [Git](https://git-scm.com/)

### 1. Clonar el Repositorio

```bash
git clone https://github.com/TU_USUARIO/escandon-bi.git
cd escandon-bi
```

### 2. Configuración del Backend

```bash
cd backend
# Copia y configura las variables de entorno
cp .env.example .env

# Instala las dependencias
npm install
```

> [!IMPORTANT]
> **Configuración Inicial:**
> Antes de inicializar la base de datos, asegúrate de configurar la variable `SEED_ADMIN_PASSWORD` en el archivo `backend/.env`. Esto establecerá la contraseña de la primera cuenta administradora (`admin`).

```bash
# Inicializa la base de datos SQLite y pobla roles
npm run db:init

# Inicia el servidor de desarrollo
npm run dev
```
El backend estará disponible en `http://localhost:4000`

### 3. Configuración del Frontend

Abre una nueva terminal en el directorio raíz del proyecto:

```bash
cd frontend
# Instala las dependencias
npm install

# Inicia el entorno de Vite
npm run dev
```
El frontend estará disponible en `http://localhost:5173`

---

## ⚙️ Variables de Entorno

El sistema usa variables de entorno para proteger secretos. En la carpeta `backend`, consulta `.env.example`. Las más críticas a rellenar:

- `DB_PATH`: Ruta al archivo de SQLite (por defecto: `../database/escandon_bi.db`)
- `JWT_SECRET`: Llave criptográfica (mínimo 64 caracteres)
- `SEED_ADMIN_PASSWORD`: Contraseña para crear el Admin en `npm run db:init`
- `OPENAI_API_KEY`: API Key para activar el Asistente ARIA
- `PBI_*`: Credenciales para Azure Active Directory y PowerBI Workspace.

---

## 📂 Estructura del Proyecto

El repositorio sigue un patrón cliente-servidor claro:

```text
escandon-bi/
├── backend/            # API REST (Express), Auth, Logs y AI Services
├── frontend/           # SPA (React + Vite), UI Glassmorphism
├── database/           # Scripts DDL, Migraciones, Seeders SQL
└── docs/               # Documentación de Endpoints, Prompts de IA, etc.
```

*Para un desglose detallado de las carpetas, revisa `ESTRUCTURA.md`.*

---

## 🤝 Flujo de Contribución (GitHub)

Para colaborar con el proyecto sigue estos pasos:

1. Realiza un **Fork** del repositorio.
2. Crea una rama para tu feature o bugfix (`git checkout -b feature/nueva-funcionalidad`).
3. Realiza el commit de tus cambios (`git commit -m "feat: añade nuevo panel de radiología"`).
4. Sube los cambios a tu rama (`git push origin feature/nueva-funcionalidad`).
5. Abre un **Pull Request** detallando el alcance de tu contribución.

---

## 📚 Documentación Adicional

- [Especificaciones del API](docs/api_spec.md) - Detalle de los endpoints.
- [Prompt del Asistente IA](docs/ai_system_prompt.md) - Directrices y contexto de GPT-4o.
- [Estructura Completa](ESTRUCTURA.md) - Arquitectura y diseño del código.

---
<p align="center">
  ⚕️ <b>Hospital Escandón</b> · Uso interno y confidencial
</p>
