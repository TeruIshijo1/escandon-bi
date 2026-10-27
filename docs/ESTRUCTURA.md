# Estructura del proyecto — Hospital Escandón BI

Corte documental: **27 de octubre de 2026**. Este árbol resume la arquitectura y estructura de carpetas de la plataforma. El inventario funcional completo, fuentes de datos y permisos se detallan en el [mapa e instructivo](Mapa_Instructivo_Plataforma_y_Origen_Datos.md).

## Árbol de directorios

```text
escandon-bi/
├── frontend/                       # Aplicación React y compilación Vite
│   ├── index.html                  # Entrada de Vite
│   ├── public/                     # Recursos públicos y estáticos
│   ├── src/
│   │   ├── components/             # Vistas y componentes modulares
│   │   ├── pages/                  # Pantallas montadas en el router
│   │   ├── context/                # Autenticación y sesión de usuario
│   │   ├── hooks/                  # Hooks y comportamientos compartidos
│   │   ├── services/               # Conexión cliente a servicios y endpoints
│   │   ├── utils/                  # RBAC, utilidades numéricas y generadores de reportes
│   │   ├── styles/                 # Estilos globales y de impresión
│   │   ├── App.jsx                 # Configuración del router y protección de rutas
│   │   └── main.jsx                # Punto de entrada de la aplicación React
│   ├── tests/                      # Pruebas unitarias y de integración de frontend
│   └── package.json
├── backend/                        # API Express y procesos de sincronización
│   ├── config/                     # Conexiones PostgreSQL BI, SQL Server y SAP
│   ├── middleware/                 # Autenticación JWT, permisos y auditoría
│   ├── routes/                     # Endpoints HTTP por módulo
│   ├── controllers/                # Controladores de negocio
│   ├── services/                   # Servicios ETL, conciliación y lógica de negocio
│   │   ├── aria/                   # Asistente analítico hospitalario
│   │   └── prompts/                # Prompts institucionales del asistente
│   ├── tests/                      # Pruebas unitarias e integración con Jest
│   ├── scripts/                    # Scripts de arranque y migraciones
│   ├── data/                       # Catálogos y datos iniciales de referencia
│   ├── ml/                         # Modelos predictivos y scripts de Data Science
│   ├── uploads/                    # Almacenamiento local de archivos y comprobantes
│   ├── server.js                   # Configuración del servidor Express
│   └── package.json
├── database/                       # Esquemas SQL, vistas DDL y seeds de PostgreSQL
├── docs/                           # Documentación técnica, manuales y mapa de la plataforma
├── scripts/                        # Scripts de utilería, automatización y empaquetado
├── .runtime/                       # Runtime Node.js portable para entornos Windows
├── build_deploy.ps1                # Script para compilación y despliegue
└── README.md                       # Documentación principal del repositorio
```

## Tecnologías y fuentes de datos

| Capa | Tecnología | Función |
|---|---|---|
| Interfaz | React 18, Vite 5 y React Router 6 | Pantallas interactivas, navegación y exportaciones cliente |
| Servidor | Node.js y Express 4 | API REST, control de acceso y tareas programadas |
| Data Warehouse BI | PostgreSQL (`pg`, `knex`) | Usuarios, permisos, históricos y copias estadísticas |
| Operación hospitalaria | SQL Server / Vertical (`mssql`, `tedious`) | Consultas clínicas, expedientes, camas y cargos diarios |
| ERP Institucional | SAP Business One Service Layer | Documentos contables, compras, inventarios y facturación |
| Sistema Histórico | SITI (PostgreSQL) | Historial operativo legado |
| Reportes y Exportación | ExcelJS y PDFKit | Generación automatizada de libros Excel y reportes PDF |

## Pruebas y validación

- **Backend:** `cd backend && npm test` ejecuta la suite de pruebas automatizadas con Jest (`backend/tests/`).
- **Frontend:** `cd frontend && npm test` ejecuta las pruebas de componentes e integración (`frontend/tests/`).
- **Empaquetado:** `node --test scripts/production-package.test.cjs` valida la integridad del empaquetador productivo.
