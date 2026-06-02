# Hospital Escandón — Plataforma BI v1.0
## Árbol de Directorios

```
escandon-bi/
├── frontend/                          # React SPA
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── context/
│   │   │   └── AuthContext.jsx        # Contexto global de autenticación y RBAC
│   │   ├── hooks/
│   │   │   ├── useAuth.js             # Hook de autenticación
│   │   │   └── useAIAssistant.js      # Hook para el asistente RAG
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.jsx        # Navegación lateral con control de roles
│   │   │   │   ├── Navbar.jsx         # Barra superior
│   │   │   │   └── ProtectedRoute.jsx # HOC de protección de rutas
│   │   │   ├── dashboard/
│   │   │   │   ├── DashboardDirectivo.jsx   # KPIs + Macropanel
│   │   │   │   ├── DashboardArea.jsx        # Tablero por área (Quirófano, UCI…)
│   │   │   │   ├── KPICard.jsx              # Tarjeta de indicador reutilizable
│   │   │   │   └── EmbeddedBI.jsx           # Wrapper PowerBI/Looker Embedded
│   │   │   ├── audit/
│   │   │   │   └── InventarioVsCargos.jsx   # Módulo Prioridad 1
│   │   │   ├── ai/
│   │   │   │   └── AIAssistant.jsx          # Chat RAG flotante
│   │   │   └── shared/
│   │   │       ├── ExportButton.jsx         # PDF / Excel
│   │   │       └── LoadingGlass.jsx         # Skeleton glassmorphism
│   │   ├── styles/
│   │   │   ├── globals.css            # Variables CSS + fuentes
│   │   │   └── glassmorphism.css      # Clases utilitarias de glass
│   │   ├── utils/
│   │   │   └── rbac.js                # Mapa de permisos por rol
│   │   ├── App.jsx                    # Router principal con rutas protegidas
│   │   └── main.jsx                   # Punto de entrada
│   ├── package.json
│   └── vite.config.js
│
├── backend/                           # Node.js / Express
│   ├── config/
│   │   ├── db.js                      # Conexión SQLite (better-sqlite3)
│   │   ├── init-db.js                 # Script para inicializar la BD
│   │   └── env.js                     # Variables de entorno validadas
│   ├── middleware/
│   │   ├── auth.middleware.js          # JWT verify + RBAC
│   │   └── audit.middleware.js         # Log de acciones sensibles
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── dashboard.routes.js
│   │   ├── audit.routes.js            # Inventarios vs Cargos
│   │   ├── export.routes.js           # PDF / Excel
│   │   └── ai.routes.js               # Endpoint RAG
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── audit.controller.js
│   │   ├── export.controller.js
│   │   └── ai.controller.js
│   ├── services/
│   │   ├── etl.service.js             # Lógica ETL Inventarios vs Cargos
│   │   ├── bi.service.js              # Tokens PowerBI Embedded
│   │   └── rag.service.js             # Pipeline RAG → SQL → LLM
│   ├── models/
│   │   └── queries.js                 # Queries SQL parametrizadas
│   ├── server.js                      # Entrada Express
│   └── package.json
│
├── database/
│   ├── 01_schema.sql                  # DDL: tablas principales
│   ├── 02_seed_roles.sql              # Datos iniciales de roles
│   └── 03_views_etl.sql               # Vistas para ETL Auditoría
│
└── docs/
    ├── ai_system_prompt.md            # Prompt base para el LLM
    └── api_spec.md                    # Endpoints documentados
```

## Stack Tecnológico

| Capa        | Tecnología            | Versión  |
|-------------|-----------------------|----------|
| Frontend    | React + Vite          | 18 / 5   |
| Routing     | React Router DOM      | 6        |
| Estilos     | CSS Variables + módulos | —      |
| Backend     | Node.js + Express     | 20 / 4   |
| Auth        | JWT (jsonwebtoken)    | 9        |
| Base datos  | SQLite (better-sqlite3)| 3       |
| BI Embed    | PowerBI REST API      | v1.0     |
| IA          | OpenAI / Azure OAI    | GPT-4o   |
| Exportación | pdfkit + exceljs      | —        |
