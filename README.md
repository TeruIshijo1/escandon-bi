<div align="center">
  <h1>🏥 Hospital Escandón — Plataforma BI</h1>
  <p><strong>Plataforma de Estadísticos e Indicadores con BI Embedded y Control de Accesos (RBAC)</strong></p>
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

La **Plataforma BI Hospital Escandón** es una solución web integral orientada a facilitar la toma de decisiones directivas, operativas y clínicas. La herramienta concentra, procesa y visualiza la información proveniente de los diversos ecosistemas de datos del hospital a través de tableros incrustados (Power BI Embedded), control de acceso por roles (RBAC) y la generación de métricas clave en tiempo real.

## 🏗️ Arquitectura y Fuentes de Datos

La plataforma unifica la información de 3 sistemas clave dentro de la institución:
1. **Sistema Histórico (Legacy):** Datos operativos históricos y registros anteriores (PostgreSQL).
2. **Sistema Operativo Actual (SIT):** Operaciones diarias, gestión de camas, expedientes clínicos y control de urgencias (SQL Server).
3. **ERP Institucional (SAP Business One):** Información financiera, contabilidad, inventarios y facturación.

## ✨ Características Principales

- 🔐 **Control de Acceso (RBAC):** Sistema robusto con Autenticación JWT y roles personalizables (Directivo, Administrador, Jefes de Área y Perfil Operativo).
- 📊 **Power BI Embedded:** Paneles interactivos totalmente incrustados dentro de la plataforma sin requerir licenciamiento individual por usuario para su visualización básica.
- 🏥 **Módulos Especializados:** Paneles dedicados para monitorear Quirófano, UCI, Consulta Externa y Farmacia.
- 📄 **Auditoría e Inventarios:** Módulos de conciliación automática que comparan inventarios con cargos en la cuenta del paciente.
- 📈 **Exportación de Datos:** Generación automatizada de reportes en PDF interactivo y formato Excel avanzado.

## 🛠️ Stack Tecnológico

- **Frontend:** React.js, Vite, React Router, y CSS nativo modularizado.
- **Backend:** Node.js, Express.
- **Base de Datos:** SQLite (motor local, con integraciones remotas a SQL Server y HANA).
- **Autenticación:** JSON Web Tokens (JWT) y cifrado con bcrypt.
- **Reportes:** pdfkit y exceljs.

## 🚀 Instalación y Despliegue Local

### Prerrequisitos
- Node.js (v20 o superior recomendado)
- Git

### 1. Clonar el repositorio
```bash
git clone https://github.com/TeruIshijo1/escandon-bi.git
cd escandon-bi
```

### 2. Levantar el Backend
```bash
cd backend
cp .env.example .env
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

---

## 👨‍💻 Acerca del Autor

**Ing. Alberto García Mendoza**  
Arquitecto de Soluciones y Desarrollador Principal  
GitHub: [@TeruIshijo1](https://github.com/TeruIshijo1)
