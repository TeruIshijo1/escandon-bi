# 💻 Manual para Programador — Plataforma BI v5.0 (Hospital Escandón)

Este documento es una guía técnica para desarrolladores que necesiten realizar modificaciones, dar mantenimiento o extender las funcionalidades de la Plataforma BI.

---

## 1. Arquitectura General

El proyecto está dividido en dos grandes bloques:
*   **Frontend:** Desarrollado con React 18, Vite y React Router DOM v6.
*   **Backend:** Desarrollado con Node.js 20, Express 4 y base de datos SQLite (usando la librería `better-sqlite3`).

---

## 2. Iniciar el Entorno de Desarrollo Local

Si necesitas correr el proyecto en tu máquina para hacer pruebas o desarrollar:

**Terminal 1 (Backend):**
```bash
cd backend
npm install
# Asegúrate de tener el archivo .env configurado (puedes copiar .env.example)
npm run db:init  # Solo la primera vez para crear la base de datos
npm run dev      # Inicia en http://localhost:4000
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm install
npm run dev      # Inicia en http://localhost:5173
```

---

## 3. Mapa de Elementos Editables (¿Dónde cambiar qué?)

A continuación, se detalla de forma específica y sencilla dónde se debe ubicar para modificar los aspectos visuales y lógicos de la plataforma:

### 🎨 Cambiar Colores, Tipografías y Estilos Globales
Para modificar la paleta de colores (ej. el azul corporativo), el tipo de letra o los estilos generales de toda la aplicación, debes dirigirte a:
*   **Ruta del archivo:** `frontend/src/styles/globals.css`
*   **¿Qué buscar?** En las primeras líneas encontrarás una sección `:root` que contiene variables como `--color-azul-fuerte`, `--color-verde-e`, etc. Simplemente cambia el código hexadecimal (ej. `#004687`) por el nuevo color que desees.

### 🗂️ Modificar el Menú Lateral (Sidebar)
Si necesitas agregar o quitar una nueva sección, página o enlace en el menú de la izquierda:
*   **Ruta del archivo:** `frontend/src/components/layout/Sidebar.jsx`
*   **¿Qué buscar?** Busca la lista de navegación (`nav-item`). Ten en cuenta que los elementos del menú se muestran según el rol del usuario validando permisos (RBAC).

### 🤖 Modificar el Comportamiento de la IA (Asistente ARIA)
Si deseas que la inteligencia artificial responda de otra manera, conozca nuevas reglas o cambie su personalidad:
*   **Ruta del archivo:** `docs/ai_system_prompt.md`
*   **¿Qué buscar?** Aquí reside el "System Prompt" o las instrucciones maestras del modelo. Además, la lógica de backend que se comunica con la API de OpenAI está en `backend/services/rag.service.js`.

### 🗃️ Cambiar la Base de Datos (Agregar tablas o columnas)
Si necesitas que el sistema guarde un nuevo tipo de dato (por ejemplo, agregar la columna "Edad" a la tabla de Pacientes):
*   **Ruta del archivo:** `database/01_schema.sql` (para definir la estructura)
*   **Ruta del archivo:** `database/02_seed_roles.sql` (para datos de prueba/iniciales)
*   **Importante:** Después de modificar el esquema, en entorno de desarrollo, deberás borrar la base de datos actual y correr `npm run db:init` en la carpeta `backend/` para regenerarla.

### 🔑 Configurar Contraseñas o Conexiones Externas (Variables de Entorno)
Para cambiar la conexión a la base de datos, la llave secreta (JWT_SECRET) o la clave de la API de OpenAI:
*   **Ruta del archivo:** `backend/.env`
*   **¿Qué buscar?** Este archivo contiene variables críticas. NUNCA se sube al control de versiones (Git). Si agregas una variable nueva, asegúrate de documentarla también en `backend/.env.example`.

### 🌐 Modificar o Agregar Rutas del Servidor (API Endpoints)
Si necesitas que el frontend pueda pedir un nuevo reporte o dato al backend:
*   **Ruta de los archivos:** Carpeta `backend/routes/` y `backend/controllers/`
*   **Documentación:** Asegúrate de actualizar el archivo `docs/api_spec.md` cuando crees nuevos *endpoints* para que otros programadores sepan cómo usarlos.

---

## 4. Notas de Seguridad
*   Todas las rutas de la API en el backend (excepto el login) están protegidas por `auth.middleware.js`.
*   El control de acceso basado en roles (RBAC) se gestiona desde el frontend en `frontend/src/utils/rbac.js` y desde el backend con middlewares de verificación.
