# 🏥 Contexto General de la Plataforma BI — Hospital Escandón

Este documento centraliza el contexto operativo, técnico y de arquitectura de la **Plataforma BI v1.0 (Hospital Escandón)**. Está diseñado para servir como referencia única tanto para el equipo de desarrollo como para la toma de decisiones tecnológicas.

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

La plataforma adopta una arquitectura de aplicación web moderna desacoplada en dos capas principales (Frontend y Backend) con una base de datos local embebida.

| Capa | Componente / Tecnología | Propósito |
| :--- | :--- | :--- |
| **Frontend** | React 18 + Vite | Interfaz de usuario SPA ágil, responsiva y modular. |
| **Enrutamiento** | React Router DOM v6 | Navegación interna y protección de rutas según rol (RBAC). |
| **Diseño** | CSS Variables + Glassmorphism | Estética moderna, limpia, y altamente visual con modo oscuro/claro adaptable. |
| **Backend** | Node.js 20 + Express 4 | Servidor de APIs REST, servicios ETL y pipeline RAG. |
| **Base de Datos** | SQLite 3 (`better-sqlite3`) | Base de datos relacional local ágil de alto rendimiento y cero-configuración. |
| **Autenticación** | JWT (`jsonwebtoken`) + `bcryptjs` | Autenticación basada en tokens sin estado y almacenamiento seguro de credenciales. |
| **Integración BI** | PowerBI REST API | Embebido seguro de dashboards avanzados desde PowerBI. |
| **Inteligencia Artificial** | OpenAI GPT-4o / Azure OpenAI | Motor LLM para procesamiento RAG y generación de consultas SQL dinámicas. |
| **Exportación** | `pdfkit` + `exceljs` | Generación del lado del servidor de PDFs enriquecidos y archivos Excel. |

---

## 📁 3. Estructura de Directorios (Mapeo de la Plataforma)

```text
escandon-bi/
├── frontend/                          # Interfaz de Usuario (React SPA)
│   ├── public/                        # Archivos públicos estáticos
│   ├── src/
│   │   ├── context/
│   │   │   └── AuthContext.jsx        # Estado de autenticación y lógica de inicio de sesión
│   │   ├── hooks/
│   │   │   ├── useAuth.js             # Acceso rápido a autenticación
│   │   │   └── useAIAssistant.js      # Hook para intercomunicación con el bot de IA
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.jsx        # Menú de navegación dinámico según permisos (RBAC)
│   │   │   │   ├── Navbar.jsx         # Encabezado del usuario
│   │   │   │   └── ProtectedRoute.jsx # Wrapper para bloquear rutas no autorizadas
│   │   │   ├── dashboard/
│   │   │   │   ├── DashboardDirectivo.jsx # Tablero general de dirección
│   │   │   │   ├── DashboardArea.jsx      # Tableros por áreas clínicas individuales
│   │   │   │   ├── KPICard.jsx            # Tarjetas de métricas reutilizables
│   │   │   │   └── EmbeddedBI.jsx         # Componente para embeber PowerBI
│   │   │   ├── audit/
│   │   │   │   └── InventarioVsCargos.jsx # Conciliación de Auditoría (Prioridad 1)
│   │   │   ├── ai/
│   │   │   │   └── AIAssistant.jsx        # Interfaz de chat flotante de ARIA
│   │   │   └── shared/
│   │   │       ├── ExportButton.jsx       # Botón genérico de exportación (Excel/PDF)
│   │   │       └── LoadingGlass.jsx       # Skeleton de carga con efecto vidrio templado
│   │   ├── styles/
│   │   │   ├── globals.css            # Estilos globales y paleta de colores corporativa
│   │   │   └── glassmorphism.css      # Efectos visuales translúcidos modernos
│   │   ├── utils/
│   │   │   └── rbac.js                # Definición de permisos y vistas permitidas por rol
│   │   ├── App.jsx                    # Definición de rutas y estructura principal
│   │   └── main.jsx                   # Punto de entrada de React
│   ├── package.json
│   └── vite.config.js
│
├── backend/                           # Servidor de API (Node.js & Express)
│   ├── config/
│   │   ├── db.js                      # Conexión persistente de SQLite
│   │   ├── init-db.js                 # Inicializador/creador de las tablas iniciales
│   │   └── env.js                     # Validación y tipado de variables de entorno
│   ├── middleware/
│   │   ├── auth.middleware.js         # Validador de JWT y permisos de roles
│   │   └── audit.middleware.js        # Bitácora de auditoría para registro de acciones sensibles
│   ├── routes/
│   │   ├── auth.routes.js             # Autenticación de usuarios
│   │   ├── dashboard.routes.js        # Métricas agregadas y datos para gráficos
│   │   ├── audit.routes.js            # Endpoints del módulo Inventario vs Cargos
│   │   ├── export.routes.js           # Generación de archivos descargables
│   │   └── ai.routes.js               # Conexión con el Asistente ARIA
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── audit.controller.js
│   │   ├── export.controller.js
│   │   └── ai.controller.js
│   ├── services/
│   │   ├── etl.service.js             # Lógica de extracción, transformación y cruce de datos
│   │   ├── bi.service.js              # Interacción con la API de PowerBI para tokens seguros
│   │   └── rag.service.js             # Middleware RAG: Pregunta -> SQL en SQLite -> LLM
│   ├── models/
│   │   └── queries.js                 # Consultas SQL nativas parametrizadas
│   ├── server.js                      # Inicialización del servidor Express
│   └── package.json
│
├── database/                          # Scripts SQL
│   ├── 01_schema.sql                  # Estructura del esquema de BD
│   ├── 02_seed_roles.sql              # Inserción de catálogo de roles e información inicial
│   └── 03_views_etl.sql               # Vistas para los cruces de auditoría
│
└── docs/                              # Documentación Técnica
    ├── ai_system_prompt.md            # Instrucciones del sistema RAG de ARIA
    ├── api_spec.md                    # Especificación OpenAPI/REST de la plataforma
    ├── manual_programador.md          # Manual del programador
    └── manual_usuario.md              # Manual de operaciones del usuario
```

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
1.  **Pregunta del usuario:** *"¿Cuántas cirugías de quirófano se realizaron en mayo?"*
2.  **Prompt System (`ai_system_prompt.md`):** Indica al LLM el esquema de las tablas de SQLite del Hospital Escandón.
3.  **Generación de SQL:** El LLM genera una consulta SQLite sanitizada.
4.  **Ejecución:** El backend ejecuta la query de forma segura contra SQLite.
5.  **Generación de Respuesta:** El LLM recibe los datos en bruto y redacta una respuesta coherente para el usuario final.

---

## 🚀 6. Guía Rápida de Operaciones Comunes

*   **Modificar colores o tipografía general:** Editar variables en `frontend/src/styles/globals.css`.
*   **Agregar un módulo o vista al menú:** Registrar la ruta en `frontend/src/App.jsx` y añadir el menú correspondiente en `frontend/src/components/layout/Sidebar.jsx`.
*   **Modificar el esquema de la base de datos:** Modificar `database/01_schema.sql` y posteriormente reiniciar la base de datos local usando `npm run db:init` desde el directorio `backend`.
*   **Cambiar el comportamiento o personalidad del bot de IA:** Editar el System Prompt en `docs/ai_system_prompt.md`.
