# 💻 Manual para Programador — Plataforma BI v5.0 (Hospital Escandón)

Este documento es una guía técnica para desarrolladores que necesiten realizar modificaciones, dar mantenimiento o extender las funcionalidades de la Plataforma BI.

---

## 1. Arquitectura General

El proyecto está dividido en dos grandes bloques:
*   **Frontend:** Desarrollado con React 18, Vite y React Router DOM v6.
*   **Backend:** Desarrollado con Node.js, Express 4 y PostgreSQL para la persistencia de BI. El runtime Windows incluido es Node 24.21.0. Vertical se consulta con SQL Server y SAP mediante Service Layer; cada módulo conserva sus reglas y permisos de origen.

---

## 2. Iniciar el Entorno de Desarrollo Local

Si necesitas correr el proyecto en tu máquina para hacer pruebas o desarrollar:

**Terminal 1 (Backend):**
```bash
cd backend
npm install
# Asegúrate de tener el archivo .env configurado (puedes copiar .env.example)
npm run db:init  # Sólo en una instalación nueva, con PostgreSQL y credenciales preparados
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
*   **Código ejecutable:** `backend/services/prompts/ai.system.prompt.js`, `backend/services/rag.service.js`, `backend/services/aria/` y `backend/services/reportAssistant.service.js`, según el flujo.
*   **Qué revisar:** instrucciones, catálogo autorizado, selección de recursos, filtros y proveedor configurado. `docs/ai_system_prompt.md` conserva contexto documental; editar ese Markdown no cambia por sí mismo el asistente en ejecución.

### 🗃️ Cambiar la Base de Datos (Agregar tablas o columnas)
Si necesitas que el sistema guarde un nuevo tipo de dato (por ejemplo, agregar la columna "Edad" a la tabla de Pacientes):
*   **Ruta del archivo:** `database/01_schema.sql` (para definir la estructura)
*   **Ruta del archivo:** `database/02_seed_roles.sql` (para datos de prueba/iniciales)
*   **Importante:** Preparar una migración o inicialización aditiva e idempotente, comprobarla sobre una base aislada y conservar un respaldo antes de aplicarla. `db:init` y los seeds se usan para una instalación nueva; no borrar ni sustituir una base existente para actualizar el esquema.

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
*   Revisar la autenticación y el permiso de cada ruta. El servidor declara excepciones públicas como salud e inicio de sesión; el permiso de la pantalla no sustituye la autorización del backend.
*   El control de acceso basado en roles (RBAC) se gestiona desde el frontend en `frontend/src/utils/rbac.js` y desde el backend con middlewares de verificación.

## 5. Pruebas, comentarios y documentación

Las pruebas se concentran en `backend/tests/` y `frontend/tests/`. Ejecutar `npm test -- --runInBand` desde `backend`, `npm test` desde `frontend` o `npm run test:ui -- <archivo>` para la prueba de interfaz indicada. Desde la raíz, `node --test tests/production-package.test.cjs` verifica el empaquetador. Los lanzadores resuelven configuración y dependencias desde `scripts/`; los resultados pertenecen a las carpetas de IA, fuera del código de ejecución.

Conservar las descripciones de funciones y bloques al limpiar comentarios y comprobar que no cambió el código ejecutable. El mapa mantiene las referencias de línea posteriores a la limpieza. Actualizar el [mapa completo](Mapa_Instructivo_Plataforma_y_Origen_Datos.md), la [guía operativa](Guia_Operativa_Consulta_Plataforma.md) y sus PDF cuando cambie una función. El generador y el verificador están en `scripts/`; consultar [sus instrucciones](../../herramientas/mapa-pdf/README.md).

El [árbol actual](ESTRUCTURA.md) describe las carpetas versionadas. Documentación, pruebas, herramientas y evidencias están en `IA`; datos, configuración, cargas y modelos conservan sus ubicaciones propias. El pase se genera completo con `build_deploy.ps1` y se verifica contra las fuentes; no editar sus copias a mano. Procedimiento: [README_PRODUCCION.md](../README_PRODUCCION.md).
