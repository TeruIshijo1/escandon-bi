<div align="center">
  <h1>🏥 Hospital Escandón — Plataforma BI</h1>
  <p><strong>Plataforma de Estadísticos e Indicadores con BI Embedded y Control de Accesos (RBAC)</strong></p>
  <p>
    <img src="https://img.shields.io/badge/React-18-blue.svg" alt="React" />
    <img src="https://img.shields.io/badge/Node.js-20-green.svg" alt="Node.js" />
    <img src="https://img.shields.io/badge/Vite-5-purple.svg" alt="Vite" />
    <img src="https://img.shields.io/badge/PostgreSQL-BI-blue.svg" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/PowerBI-Embedded-yellow.svg" alt="PowerBI" />
  </p>
</div>

---

## 📖 Descripción del Proyecto

La **Plataforma BI Hospital Escandón** es una solución web integral orientada a facilitar la toma de decisiones directivas, operativas y clínicas. La herramienta concentra, procesa y visualiza la información proveniente de los diversos ecosistemas de datos del hospital a través de tableros incrustados (Power BI Embedded), control de acceso por roles (RBAC) y la generación de métricas clave en tiempo real.

## 🏗️ Arquitectura y Fuentes de Datos

La plataforma unifica la información de 3 sistemas clave dentro de la institución:
1. **Sistema Histórico (Legacy):** Datos operativos históricos y registros anteriores (PostgreSQL).
2. **Sistema Operativo Actual (Vertical):** Operaciones diarias, gestión de camas, expedientes clínicos y control de urgencias (SQL Server).
3. **ERP Institucional (SAP Business One):** Información financiera, contabilidad, inventarios y facturación.

## ✨ Características Principales

- 🔐 **Control de Acceso (RBAC):** Sistema robusto con Autenticación JWT y roles personalizables (Directivo, Administrador, Jefes de Área y Perfil Operativo).
- 📊 **Power BI Embedded:** Paneles interactivos totalmente incrustados dentro de la plataforma sin requerir licenciamiento individual por usuario para su visualización básica.
- 🏥 **Módulos Especializados:** Paneles dedicados para monitorear Quirófano, UCI, Consulta Externa y Farmacia.
- 📄 **Auditoría e Inventarios:** Módulos de conciliación automática que comparan inventarios con cargos en la cuenta del paciente.
- 💰 **Ventas Hospitalarias:** Consulta en Auditoría de ventas facturadas y pendientes por artículo, con cantidades e importes mensuales y acumulados, desglose de Banco de Sangre y exportación a Excel institucional.
- 📈 **Exportación de Datos:** Generación automatizada de reportes en PDF interactivo y formato Excel avanzado.
- 🩺 **Módulo de Honorarios Médicos:** Liquidación, conciliación fiscal, comprobantes de pago y catálogos de tarifas médicas.

## 🛠️ Stack Tecnológico

- **Frontend:** React 18, Vite 5, React Router 6, Recharts, Material-UI Icons y CSS nativo modularizado.
- **Backend:** Node.js, Express, Knex / pg (PostgreSQL), Tedious / mssql (SQL Server).
- **Base de Datos:** PostgreSQL (Data Warehouse institucional e histórico).
- **Integraciones:** SAP Business One Service Layer (OData / REST).
- **Autenticación:** JSON Web Tokens (JWT) y cifrado con bcrypt.
- **Generación Documental:** ExcelJS y PDFKit.

## 🚀 Instalación y Despliegue Local

### Prerrequisitos
- Node.js 20 o superior con npm (o runtime Windows incluido en `.runtime/`)
- PostgreSQL instalado y configurado con base de datos `escandon_bi`
- Acceso de red a las fuentes de datos (SQL Server / SAP Service Layer)
- Git

### 1. Clonar el repositorio
```bash
git clone https://github.com/TeruIshijo1/escandon-bi.git
cd escandon-bi
```

### 2. Configurar y Levantar el Backend
```bash
cd backend
cp .env.example .env
# Configurar las variables en .env (PG*, REMOTE_DB_*, SAP_*)
npm install
npm run db:init
npm run dev
```

### 3. Levantar el Frontend
En otra terminal desde la raíz del proyecto:
```bash
cd frontend
npm install
npm run dev
```

### 4. Ejecución de Pruebas
```bash
# Pruebas unitarias y de integración de Backend
cd backend
npm test

# Pruebas de Frontend
cd frontend
npm test
```

---

## 📚 Documentación del Proyecto

Toda la documentación técnica y funcional se encuentra centralizada en la carpeta [`docs/`](docs/):

- **[Mapa e Instructivo de la Plataforma](docs/Mapa_Instructivo_Plataforma_y_Origen_Datos.md):** Especificación completa de rutas, orígenes de datos, fórmulas y módulos.
- **[Mapa de la Plataforma (PDF)](docs/Mapa_Plataforma_Hospital_Escandon_BI.pdf):** Diagrama y mapa integral en formato PDF.
- **[Guía Operativa de Consulta (PDF)](docs/Guia_Operativa_Consulta_Plataforma.pdf):** Manual de uso para usuarios y jefaturas de área.
- **[Pase a Producción](README_PRODUCCION.md):** Manual de instalación, despliegue y puesta en marcha en servidores de producción.
- **[Conexión por Tailscale](GUIA_CONEXION_PRODUCCION_TAILSCALE.md):** Instrucciones de red y seguridad para conexión con SQL Server / Vertical.
- **[Ventas Hospitalarias](docs/ventas-hospitalarias.md):** Documentación técnica de criterios y conciliación del módulo de ventas.

---

## 👨‍💻 Autor y Mantenimiento

**Hospital Escandón — Coordinación de Sistemas y Tecnologías de la Información**  
Desarrollador Principal: **Ing. Alberto García Mendoza** ([@TeruIshijo1](https://github.com/TeruIshijo1))
