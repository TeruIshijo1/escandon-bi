# 🏥 Hospital Escandón — Plataforma BI (Manual de Producción & Pase a Producción)

Este documento contiene los ajustes específicos realizados en el servidor productivo (`SERVIDORCALIDAD`), así como las **instrucciones obligatorias para cualquier Agente de IA o desarrollador** al generar la carpeta `pase_a_produccion`.

---

## 📌 1. Modificaciones Realizadas para el Entorno Productivo

Respecto al entorno de desarrollo local, se realizaron las siguientes adaptaciones en el servidor de producción:

### 1.1 Conexión a SQL Server / Túnel Bore (`REMOTE_DB_SERVER`)
- **Archivo**: `backend/.env`
- **Cambio**: 
  ```env
  REMOTE_DB_SERVER=159.223.110.159
  REMOTE_DB_PORT=50351
  ```
- **Motivo Técnico**: En la red local del servidor productivo, la resolución DNS de Windows traducía el dominio `bore.pub` hacia la IP `1.1.1.1` (IP ficticia de filtrado DNS), haciendo fallar las conexiones TCP al puerto `50351`. Usar la IP directa `159.223.110.159` garantiza la conectividad inmediata sin depender de la resolución DNS del router/servidor.

### 1.2 Mensajes de Diagnóstico en la Conexión Remota
- **Archivo**: `backend/config/remote-db.js`
- **Cambio**: Se añadieron sugerencias de diagnóstico automáticas para advertir al usuario en consola en caso de desconexión del túnel `bore` o cambios de puerto.

### 1.3 Migración SQLite → PostgreSQL (Base de Datos Principal)
- **Archivo**: `backend/migrate_to_pg.js`
- **Cambio**: Toda la persistencia de la plataforma (usuarios/RBAC, auditoría, `ConfiguracionBI`, `KPIConfig`, `DataConnectors`, `MetricMappings`, `DataEntities`, calidad de datos, `interop_event_logs` y el legado clínico `Pacientes`/`AuditoriaInventarioCargos`) ahora vive en PostgreSQL (`escandon_bi`). SQLite se eliminó del runtime.
- **Migración en producción (UNA sola vez)**:
  1. Respaldo consistente: el script copia el archivo SQLite a `database/escandon_bi_backup_pre_pg.db` antes de migrar (conservar ese respaldo).
  2. Ejecutar desde `backend/`: `node migrate_to_pg.js`
  3. Requiere `better-sqlite3` instalado (sigue en `package.json` solo como herramienta de migración) y PostgreSQL alcanzable con las variables `PGUSER/PGHOST/PGPASSWORD/PGDATABASE/PGPORT`.
  4. `npm run db:init` crea/actualiza esquema y seeds (idempotente).

---

## 🤖 2. Instrucciones para la IA (Generación de `pase_a_produccion`)

Cuando un Asistente de IA o Desarrollador realice mejoras o correcciones en el entorno local de desarrollo, **DEBE** generar la carpeta `pase_a_produccion` siguiendo estrictamente las reglas descritas a continuación.

> [!IMPORTANT]
> **REGLA DE ORO DE DESPLIEGUE:**
> Al actualizar el servidor productivo, **ÚNICAMENTE SE COPIA EL CONTENIDO DE LA CARPETA `pase_a_produccion`**. 
> NUNCA se debe copiar la carpeta entera de desarrollo con archivos temporales o sobrescribir el archivo `backend/.env` ni las bases de datos productivas.

### 2.1 Archivos y Carpetas OBLIGATORIOS en `pase_a_produccion`

1. **Frontend Compilado**:
   - `frontend/` (Debe contener el build generado por `npm run build` en la subcarpeta `dist/` o los estáticos requeridos).
2. **Backend Limpio**:
   - `backend/` únicamente con código fuente activo (`server.js`, `config/`, `controllers/`, `routes/`, `services/`, `middleware/`, `utils/`, `package.json`, `.env.example`).
3. **Base de Datos (Solo Esquemas y Scripts DDL)**:
   - `database/` conteniendo únicamente archivos `.sql` y `.dump` (`01_schema.sql` a `05_quality_and_interop.sql`, `escandon_bi_dw.dump`).
4. **Scripts de Ejecución y Documentación**:
   - `iniciar.bat`, `iniciar_produccion.bat`, `iniciar_tunel_db.bat`, `instalar.bat`, `servicio_tunel_db.vbs`, `build_deploy.ps1`.
   - `README.md`, `README_PRODUCCION.md`, `INSTRUCCIONES_IA.md`, `ESTRUCTURA.md`, `contexto_plataforma.md`.

---

### 2.2 Lista de Exclusión Estricta (NUNCA incluir en `pase_a_produccion`)

La IA o el script de empaquetado debe **EXCLUIR EXPLICITAMENTE**:

```text
❌ node_modules/                  (Se instalan en destino si fuera necesario)
❌ backend/.env                   (PRESERVAR SIEMPRE el .env del servidor productivo)
❌ backend/database.sqlite        (Restos de pruebas SQLite)
❌ database/*.db                  (SQLite eliminado; NO sobrescribir escandon_bi_backup_pre_pg.db)
❌ database/*.db-shm              (Archivos WAL/SHM temporales de SQLite)
❌ database/*.db-wal
❌ scratch/                       (Carpeta de pruebas sueltas)
❌ backend/scratch/               (Carpeta de pruebas backend)
❌ scratch_*.js / scratch_*.cjs   (Scripts de pruebas temporales)
❌ test_*.js / test_*.cjs         (Scripts de pruebas automatizadas/manuales)
❌ test_*.xlsx / test.xlsx        (Archivos Excel de pruebas)
❌ check_*.js                     (Scripts de inspección temporal)
❌ search_*.js                    (Scripts de búsqueda de columnas)
❌ query_*.js / query_*.cjs       (Queries de prueba sueltas)
❌ update_*.cjs / update_*.js     (Parches temporales)
❌ modify.js / sync_almacen.js
❌ *.log                          (Logs de ejecución)
❌ frontend/screenshot.png        (Capturas de pantalla)
```

---

## 📦 3. Procedimiento para Aplicar Cambios en el Servidor

1. **En la PC de Desarrollo**:
   Ejecutar el script de construcción de producción:
   ```powershell
   .\build_deploy.ps1
   ```
   Esto generará o actualizará automáticamente la carpeta `D:\Escritorio\escandon-bi\pase_a_produccion` aplicando todas las reglas de exclusión arriba mencionadas.

2. **Transferencia al Servidor Productivo**:
   Copiar todo el contenido dentro de `pase_a_produccion` y pegarlo en el servidor de producción (`C:\Users\SERVIDORCALIDAD\Desktop\ESCANODN-BI`), eligiendo **reemplazar archivos existentes**.

3. **Arranque**:
   En el servidor productivo, hacer doble clic en `iniciar.bat`.

---

## 🔄 4. Arquitectura de Sincronización y Data Warehouse (PostgreSQL DW)

La plataforma utiliza una **arquitectura híbrida de 3 capas** para garantizar consultas inmediatas en los tableros sin saturar las bases de datos de producción:

### 4.1 Distribución de Fuentes de Datos
1. **SAP Service Layer (ERP)**: Se consulta en **tiempo real para el día en curso** (facturación, ingresos oficiales grupo 111, inventario valorizado).
2. **SQL Server / Túnel Bore (Vertical)**: Se consulta en **tiempo real para el día en curso** (cuentas de pacientes activas, expediente clínico, censos).
3. **PostgreSQL Data Warehouse (Local)**: Concentra **todo el histórico (ayer y fechas pasadas)**. Todos los tableros analíticos (Quirófano, Urgencias, Eficiencia, CEX) leen el histórico directamente desde PostgreSQL local para ofrecer respuestas en milisegundos.

---

### 4.2 Lógica de Sincronización (Incremental vs Completa)
- **Sincronización Incremental (Cada 15 minutos)**:
  Un Cron Job interno (`initDashboardCron` e `initQuirofanoCron`) ejecuta ciclos cada 15 minutos sincronizando una ventana de **15 días hacia atrás** desde SQL Server y SAP Service Layer hacia PostgreSQL DW.
- **Sincronización Histórica Completa (`fullSync`)**:
  Al arrancar el servidor (`server.js`), el sistema verifica la salud de la base de datos local:
  - Si la tabla de servicios o eventos de Quirófano tiene menos de 1,000 registros o su fecha más antigua (`MIN(fecha_de_cargo)`) es posterior a **60 días atrás**, la plataforma detecta automáticamente que el histórico está incompleto y dispara la carga completa `fullSync` desde `2026-04-01`.

---

### 4.3 Resolución de Inconsistencias (Ej. 84 vs 19 Cirugías en Quirófano)
- **Causa**: Al copiar la plataforma a un nuevo servidor de producción sin migrar el histórico de PostgreSQL, si sólo corría la sincronización incremental (15 días), la consulta del mes completo (ej. 01 al 31 de julio) sólo encontraba datos del 26 al 31 de julio (**19 cirugías**).
- **Solución Automática**: La plataforma ahora detecta la falta de histórico al iniciar y llena automáticamente todo el período de meses pasados (**84 cirugías**).

---

### 4.4 Cómo Forzar la Resincronización Histórica Manualmente
Si se requiere purgar y volver a descargar todo el histórico desde SQL Server / SAP hacia PostgreSQL DW:

1. **Vía Endpoint REST (Rol ADMIN)**:
   ```http
   POST http://localhost:4000/api/admin/sync-dw-full
   Header: Authorization: Bearer <TOKEN_ADMIN>
   ```

2. **Vía Consola de Node.js (Servidor)**:
   Desde el directorio `backend/`:
   ```bash
   node -e "require('./node_modules/dotenv').config(); const { syncAllDashboards } = require('./services/dashboardSync.service'); const { syncQuirofanoData } = require('./services/quirofanoSync.service'); (async () => { await syncQuirofanoData({ fullSync: true }); await syncAllDashboards({ fullSync: true }); console.log('✅ Re-sincronización completa finalizada.'); process.exit(0); })();"
   ```

---

<p align="center">
  🏥 <b>Hospital Escandón BI</b> · Manual de Producción v1.1
</p>
