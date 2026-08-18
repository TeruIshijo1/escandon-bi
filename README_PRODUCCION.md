# 🏥 Hospital Escandón — Plataforma BI (Manual de Producción & Pase a Producción)

Este documento contiene los ajustes específicos realizados en el servidor productivo (`SERVIDORCALIDAD`), la arquitectura de sincronización v2.0, y las **instrucciones obligatorias para cualquier Agente de IA o desarrollador** al generar la carpeta `pase_a_produccion`.

---

## 📌 1. Configuración del Entorno Productivo (`SERVIDORCALIDAD`)

El servidor de producción opera mediante un proceso Node.js integrado que entrega tanto la **API REST (Backend)** como la **aplicación React SPA (Frontend)** compilada en el puerto `5173`.

### 1.1 Conexión a SQL Server / Túnel Remote (`REMOTE_DB_SERVER`)
- **Archivo**: `backend/.env`
- **Configuración**: 
  ```env
  REMOTE_DB_SERVER=159.223.110.159
  REMOTE_DB_PORT=37368
  ```
- **Nota Técnica**: En la red local del servidor productivo, la resolución DNS de Windows traducía el dominio `bore.pub` hacia la IP `1.1.1.1` (IP ficticia de filtrado DNS). Usar la IP directa `159.223.110.159` garantiza la conectividad TCP inmediata hacia la base de datos Vertical SQL Server.

### 1.2 Arranque en Producción
- **Script**: `iniciar_produccion.bat`
- **Puerto**: `http://localhost:5173` o `http://192.168.254.249:5173` (Acceso Intranet)
- **Mecanismo**: Express sirve los archivos estáticos compilados de React (`frontend/dist`) y la API REST en el mismo puerto.

---

## 🛠️ 2. Migraciones y Correcciones Automáticas de Base de Datos

### 2.1 Migración Automática de Esquemas (`pg-db.js`)
Para evitar errores de columnas faltantes al actualizar versiones anteriores del Data Warehouse PostgreSQL:
- **Tablas CEX (Consulta Externa)**: Creación automática de `cex_pacientes`, `cex_medicos`, `cex_citas`, `cex_consultas` y `cex_bitacora`.
- **Columnas de Agenda Programada**: Autocorreció de columnas faltantes en `dw_vertical_consultas_prog` (`ps`, `comentarios`, `dx_description_es`, `telefono_1`, `celular_2`, `articulo`, `edad_anios`, `edad_mes`, `genero`, `consultas_previas`, `convenio`).
- **Columna `TipoConsulta` en `cex_citas`**: Auto-migrada en el arranque de Node.js.
  ```sql
  ALTER TABLE dw_vertical_consultas_prog ADD COLUMN IF NOT EXISTS ps VARCHAR(50);
  ALTER TABLE cex_citas ADD COLUMN IF NOT EXISTS TipoConsulta VARCHAR(100);
  ```
- Al iniciar `server.js`, la plataforma detecta y crea automáticamente las columnas y tablas faltantes en PostgreSQL sin requerir intervención manual ni riesgo de caída del servidor (`42703 - errorMissingColumn`).

---

## 🤖 3. Instrucciones de Despliegue y Empaquetado (`pase_a_produccion`)

> [!IMPORTANT]
> **REGLA DE ORO DE DESPLIEGUE:**
> Al actualizar el servidor productivo, **ÚNICAMENTE SE COPIA EL CONTENIDO DE LA CARPETA `pase_a_produccion`**.
> NUNCA sobrescribir el archivo `backend/.env` ni las bases de datos de producción.

### 3.1 Archivos y Carpetas OBLIGATORIOS en `pase_a_produccion`

1. **Frontend Compilado**:
   - `frontend/dist/` (Build generado por `npm run build` en la carpeta frontend).
2. **Backend Limpio**:
   - `backend/` con el código fuente activo de Node.js (`server.js`, `config/`, `controllers/`, `routes/`, `services/`, `middleware/`, `utils/`, `scripts/`, `package.json`, `.env.example`).
3. **Base de Datos (Scripts DDL y Dump)**:
   - `database/` conteniendo únicamente archivos `.sql` y `.dump` (`01_schema.sql` a `06_cex.sql`, `escandon_bi_dw.dump`).
4. **Scripts de Ejecución y Documentación**:
   - `iniciar_produccion.bat`, `instalar.bat`, `servicio_tunel_db.vbs`, `build_deploy.ps1`.
   - `README.md`, `README_PRODUCCION.md`, `INSTRUCCIONES_IA.md`, `ESTRUCTURA.md`, `contexto_plataforma.md`, `QUERYS SAP.docx`.

---

### 3.2 Lista de Exclusión Estricta (NUNCA incluir en `pase_a_produccion`)

El script de empaquetado `build_deploy.ps1` excluye estrictamente:

```text
❌ node_modules/                  (Se instalan en destino si fuera necesario)
❌ backend/.env                   (PRESERVAR SIEMPRE el .env del servidor productivo)
❌ APK_Tablets/                   (Proyectos externos como Bitácora HES)
❌ mobile_app/                    (Proyectos externos Expo / React Native)
❌ backend_node/                  (Microservicios ajenos)
❌ backend/main.py, venv/, etc.   (Archivos o entornos Python ajenos)
❌ scratch/ / test_*.js           (Pruebas o scripts temporales)
❌ *.log                          (Logs de ejecución)
```

---

## 🔄 4. Arquitectura de Sincronización (PostgreSQL DW)

La plataforma utiliza una **arquitectura híbrida de 3 capas**:

1. **SAP Service Layer (ERP)**: Consultas en tiempo real para transacciones del día actual (facturación, inventario valorizado, partidas).
2. **SQL Server / Túnel Remote (Vertical)**: Consultas en vivo para el día en curso (censo, expediente, agendas).
3. **PostgreSQL Data Warehouse (Local)**: Concentra todo el histórico (ayer y pasado). Todos los tableros analíticos (Quirófano, CEX, Urgencias, Eficiencia) leen el DW local para dar respuestas inmediatas.

### 4.1 Frecuencia de Sincronización
- **Incremental (Cada 15 minutos)**: Sincroniza automáticamente una ventana de 15 días hacia atrás desde SAP y SQL Server hacia PostgreSQL DW.
- **Sincronización Completa (`fullSync`)**: Auto-detectada al iniciar el servidor si la base local no contiene el histórico esperado.

### 4.2 Re-Sincronización Histórica Manual
Si se requiere forzar una carga completa desde la consola del servidor:
```bash
cd backend
node -e "require('dotenv').config(); const { syncAllDashboards } = require('./services/dashboardSync.service'); const { syncQuirofanoData } = require('./services/quirofanoSync.service'); (async () => { await syncQuirofanoData({ fullSync: true }); await syncAllDashboards({ fullSync: true }); console.log('✅ Re-sincronización completa finalizada.'); process.exit(0); })();"
```

---

## 👨‍💻 5. Procedimiento para Aplicar Cambios en Servidor

1. **En la PC de Desarrollo**:
   ```powershell
   .\build_deploy.ps1
   ```
2. **Copiar al Servidor Productivo**:
   Copiar todo el contenido de `pase_a_produccion` hacia `C:\Users\SERVIDORCALIDAD\Desktop\ESCANODN-BI`, eligiendo reemplazar archivos existentes.
3. **Iniciar Servicio**:
   Ejecutar `iniciar_produccion.bat`.

---

<p align="center">
  🏥 <b>Hospital Escandón BI</b> · Manual de Producción v2.0
</p>

