# 🏥 Contexto General de la Plataforma BI — Hospital Escandón

Este documento resume el contexto de la **Plataforma BI Hospital Escandón**, revisado al **20 de octubre de 2026**. El [mapa e instructivo vigente](Mapa_Instructivo_Plataforma_y_Origen_Datos.md) conserva el inventario completo, los estados de cada función, los permisos y la procedencia de los datos.

---

## 🎯 1. Objetivos del Proyecto

La plataforma tiene como finalidad centralizar la visualización de datos estadísticos y financieros del Hospital Escandón, incorporando inteligencia artificial y control estricto de accesos:
*   **Auditoría y Conciliación:** Automatizar la comparación entre los consumos reales en inventario y los cargos cobrados/registrados en enfermería para evitar mermas financieras (Prioridad 1).
*   **Salud Operativa y Financiera:** Dashboards directivos y financieros que concentren KPIs de eficiencia, eficacia y rentabilidad (Prioridad 2).
*   **Control por Áreas Clínicas:** Tableros especializados para áreas críticas como Quirófano, UCI, Urgencias, Cuneros, Imagenología, etc. (Prioridad 3).
*   **Asistente de IA (ARIA):** Integrar un asistente RAG (Retrieval-Augmented Generation) capaz de traducir lenguaje natural a consultas SQL estructuradas sobre la base de datos y ofrecer respuestas automatizadas de BI.
*   **Exportación Ejecutiva:** Herramientas para la descarga ágil de reportes en PDF y hojas de cálculo avanzadas en Excel.

---

## 🏗️ 2. Arquitectura General y Stack Tecnológico

La plataforma adopta una arquitectura de aplicación web moderna desacoplada en dos capas principales (Frontend y Backend) con PostgreSQL para persistencia de BI y conectores separados para las fuentes hospitalarias.

| Capa | Componente / Tecnología | Propósito |
| :--- | :--- | :--- |
| **Frontend** | React 18 + Vite | Interfaz de usuario SPA ágil, responsiva y modular. |
| **Enrutamiento** | React Router DOM v6 | Navegación interna y protección de rutas según rol (RBAC). |
| **Diseño** | CSS Variables + Glassmorphism | Estética moderna, limpia, y altamente visual con modo oscuro/claro adaptable. |
| **Backend** | Node.js + Express 4 (runtime Windows incluido 24.21.0) | Servidor de APIs REST, servicios ETL y pipeline RAG. |
| **Base de Datos** | PostgreSQL (`pg`, `knex`) | Persistencia de usuarios, configuración, históricos, decisiones y copias estadísticas en el servidor configurado. |
| **Autenticación** | JWT (`jsonwebtoken`) + `bcryptjs` | Autenticación basada en tokens sin estado y almacenamiento seguro de credenciales. |
| **Integración BI** | PowerBI REST API | Embebido seguro de dashboards avanzados desde PowerBI. |
| **Inteligencia Artificial** | Interpretación local y proveedor configurado | Interpretación, selección y composición de reportes autorizados, según el flujo y sus permisos. |
| **Exportación** | `pdfkit` + `exceljs` | Generación del lado del servidor de PDFs enriquecidos y archivos Excel. |

---

## 📁 3. Estructura de Directorios (Mapeo de la Plataforma)

El [árbol de directorios vigente](ESTRUCTURA.md) detalla la organización del código de ejecución (`frontend`, `backend`, `database`, `scripts`), pruebas y la documentación técnica centralizada en `docs/`.

Las pruebas se ejecutan desde los comandos habituales de `backend/package.json` (`npm test`) y `frontend/package.json`.

---

## 🔑 4. Matriz de Control de Acceso Basado en Roles (RBAC)

La plataforma protege los recursos tanto en el Frontend como en el Backend a través de cuatro roles de usuario:

1.  **ADMIN (Administrador):**
    *   Acceso completo sin restricciones.
    *   Gestión de usuarios y configuración de conexiones.
    *   Auditoría técnica de logs de actividad.
2.  **DIRECTOR (Director Ejecutivo / Médico):**
    *   Acceso al Dashboard Directivo, Macropanel Financiero y vistas consolidadas.
    *   Capacidad de visualización global, pero sin edición de catálogos o configuraciones.
3.  **JEFE_AREA (Jefes de Quirófano, UCI, etc.):**
    *   Acceso restringido únicamente al dashboard de su respectiva área de asignación.
    *   No pueden consultar información consolidada de dirección ni datos confidenciales de otras áreas.
4.  **USUARIO_OPERATIVO (Enfermería / Personal administrativo):**
    *   Acceso a las vistas de carga y ejecución de conciliación de Auditoría (Inventarios vs. Cargos).
    *   Sin acceso a tableros ejecutivos ni financieros.

---

## ⚙️ 5. Módulos y Flujos de Datos Clave

### 📥 A. Cruce de Auditoría (Inventarios vs. Cargos)
1.  **Carga de datos:** El usuario operativo sube un reporte de consumos de almacén (inventario físico/digital) y el reporte de cargos en cuenta de paciente (enfermería/facturación).
2.  **Proceso ETL (`etl.service.js`):** El backend limpia la información, asocia códigos de insumos y compara cantidades usando la base de datos SQL.
3.  **Visualización:** Se genera una lista de discrepancias (insumos usados pero no cobrados, o insumos cobrados pero no registrados en almacén).

### 🤖 B. Asistente RAG — ARIA
1. **Pregunta y acceso:** el usuario consulta un tema y periodo; el backend aplica los permisos del recurso.
2. **Interpretación:** cada flujo puede resolver localmente la intención o recurrir al proveedor configurado. Las instrucciones ejecutables están en `backend/services/prompts/ai.system.prompt.js`, `backend/services/aria/` y los servicios de reportes; `ai_system_prompt.md` es una referencia documental.
3. **Selección y consulta:** se eligen recursos y filtros permitidos. El servicio correspondiente consulta PostgreSQL de BI, Vertical, SAP o SITI mediante su conector; no se mezclan motores ni se ejecuta SQL libre del usuario sobre los proveedores.
4. **Respuesta:** se muestran resultados, periodo, alcance y límites disponibles. Una vista previa puede estar limitada; el reporte y su descarga conservan su propio alcance y reglas.

---

## 🚀 6. Guía Rápida de Operaciones Comunes

*   **Modificar colores o tipografía general:** Editar variables en `frontend/src/styles/globals.css`.
*   **Agregar un módulo o vista al menú:** Registrar la ruta en `frontend/src/App.jsx` y añadir el menú correspondiente en `frontend/src/components/layout/Sidebar.jsx`.
*   **Modificar el esquema de la base de datos:** Preparar una migración aditiva e idempotente, validarla sobre una base aislada y conservar un respaldo. `npm run db:init` desde `backend` corresponde a una instalación nueva; no borrar ni sustituir una base existente.
*   **Cambiar el comportamiento o personalidad del bot de IA:** Revisar las instrucciones ejecutables de `backend/services/prompts/ai.system.prompt.js` y el servicio del flujo; actualizar `docs/ai_system_prompt.md` como referencia.
