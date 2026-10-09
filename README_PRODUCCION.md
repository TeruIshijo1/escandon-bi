# Pase a producción — Hospital Escandón BI

Actualizado el **9 de octubre de 2026**. Este pase integra todo el estado actual del proyecto, incluidos archivos nuevos y cambios pendientes de guardar en Git. El servidor `SERVIDORCALIDAD` entrega API y frontend en el puerto **5173**.

La revisión actual incluye todos los cambios de frontend y backend de honorarios, PDF y Excel, reportes, estadísticas, tableros, avisos y reapertura de cuentas. Consulta [la revisión del 9 de octubre](docs/revision-pase-2026-10-09.md), [la revisión general del 8 de octubre](docs/revision-pase-2026-10-08.md) y [la evidencia anterior de estadísticos](docs/revision-pase-final-2026-10-07.md). Ejecuta `instalar.bat` antes del arranque: también prepara los dos archivos de referencia que utilizan los estadísticos, conservando el histórico existente.

La reapertura en Vertical requiere los permisos de consulta y ejecución, una revisión completa de SAP, una preparación vigente y la confirmación del número de cuenta. Antes de modificar los registros conserva un respaldo en la carpeta configurada del servidor. Consulta [el procedimiento y sus límites](docs/reapertura-cuentas-sap.md). El [mapa e instructivo](docs/Mapa_Instructivo_Plataforma_y_Origen_Datos.md) y su [PDF completo](docs/Mapa_Plataforma_Hospital_Escandon_BI.pdf) forman parte del pase.

La revisión de Vertical documentada el 9 de octubre detectó que la conexión carecía de `VIEW DEFINITION`. La ejecución de reaperturas permanece bloqueada cuando no puede verificar toda la estructura y sus relaciones. El responsable de esa base debe habilitar la lectura de metadatos correspondiente; el instalador no cambia esos permisos. Esta preparación local no comprueba que ya se hayan habilitado en el servidor.

**Generar PDF para pago** descarga los servicios aprobados con sus datos disponibles aunque falte la ficha fiscal o SAP no responda. Marca retenciones y neto desconocidos como pendientes; conserva las tarifas, aprobaciones, cierres y pagos guardados. Para un médico ya configurado en SAP se mantiene la opción explícita de preparar el pago con esos datos. Requiere actualizar el backend y frontend completos y reiniciar la aplicación.

**Mis reportes** permite a Sistemas/Administración asignar reportes guardados a usuarios activos. Cada destinatario accede a la configuración guardada sin recibir permisos generales sobre sus fuentes. El arranque crea de forma idempotente la tabla de asignaciones en PostgreSQL; requiere que su usuario pueda crear tablas e índices. Las plantillas anteriores se conservan como reportes propios. También se incluyen los conceptos, sus descripciones y los valores predeterminados de los convenios, separados de los importes aplicados a pacientes. Consulta [el alcance y las comprobaciones](docs/asistente-recursos-financieros-2026-10-08.md).

El arranque productivo mediante `iniciar_produccion.bat` o `npm start` prepara automáticamente las referencias de estadísticas faltantes desde `initial-data`, antes de cargar los servicios. Conserva los archivos existentes y comprueba los archivos nuevos contra el manifiesto y su JSON. Si falta parte del pase, se detiene con una indicación de copiarlo completo. Se utiliza el lanzador `backend/scripts/start-server.js`; ejecutar `node backend/server.js` directamente omite esta preparación.

Si una instalación anterior muestra `Cannot find module '../data/statistics_manual_controls.json'`, desde CMD del servidor ejecuta:

```bat
cd /d "C:\Users\SERVIDORCALIDAD\Desktop\ESCANODN-BI"
".runtime\node.exe" scripts\initialize-package-data.cjs
iniciar_produccion.bat
```

La instalación debe contener el pase completo, incluidos `MANIFIESTO.json`, `scripts` e `initial-data`. Si el preparador informa un error, corrige esa copia antes de iniciar. Esta preparación no reemplaza la instalación de dependencias realizada por `instalar.bat`.

## Preparar el pase en desarrollo

Ejecuta `powershell -ExecutionPolicy Bypass -File .\build_deploy.ps1` desde el proyecto. El script valida Node, recompila todo el frontend, incluye el backend completo y verifica hashes, dependencias locales y recursos compilados. El pase anterior queda conservado en `tmp/pase-anterior-*`. Si falla el build o la auditoría previa, el pase anterior se conserva.

El script usa el runtime de `.runtime/node.exe` preparado por `scripts/prepare-node-runtime.ps1`. El pase incluye Node **24.21.0** para Windows; no depende de la versión de Node que estuviera iniciando el servidor. Se necesita npm instalado para preparar las dependencias del backend. El instalador ejecuta también la herramienta npm con el runtime incluido, evitando que su lanzador seleccione otro Node.

## Contenido del paquete

- `frontend/dist/`: aplicación completa recompilada; incluye todos los cambios de frontend, permisos, estilos, reportes y descargas. El servidor no necesita Vite ni las fuentes de React.
- `frontend/public/`: recursos utilizados directamente por exportaciones del backend, incluido el logo institucional.
- `backend/`: código activo completo, configuración de ejemplo, scripts, manifiesto de dependencias y `package-lock.json`.
- `.runtime/node.exe`, `.nvmrc` y `scripts/prepare-node-runtime.ps1`: runtime y recuperación del runtime.
- `database/*.sql`: esquemas y herramientas SQL; no se ejecutan en bloque ni se restaura una base durante una actualización.
- `initial-data/`: historiales y modelos de referencia para instalaciones sin esos archivos. El instalador copia cada uno sólo cuando no existe; conserva los datos y modelos del servidor.
- `instalar.bat`, `iniciar_produccion.bat`, `permitir_acceso_red.bat` y `verificar_pase.ps1`.
- Documentación actualizada, la revisión del 9 de octubre, el mapa e instructivo en Markdown y PDF y `MANIFIESTO.json` con inventario, tamaños y hashes SHA256.

No incluye `.env`, claves, `node_modules`, bases SQLite, dumps de PostgreSQL, cargas de usuarios, pruebas, logs, temporales ni backups de modelos. El instalador no restaura ni limpia PostgreSQL.

## Aplicar esta actualización en SERVIDORCALIDAD

1. Conserva un respaldo de la instalación y de PostgreSQL del servidor. Detén la instancia de esta plataforma desde su ventana o su servicio.
2. Antes de copiar, ejecuta `powershell -ExecutionPolicy Bypass -File .\verificar_pase.ps1` dentro de la carpeta del pase. Debe confirmar que todos los archivos coinciden con el manifiesto.
3. Copia **el contenido completo de `pase_a_produccion`**, incluida la carpeta `.runtime`, a `C:\Users\SERVIDORCALIDAD\Desktop\ESCANODN-BI`. Reemplaza el código y los recursos. El paquete no contiene archivos que reemplacen `backend/.env`, `backend/uploads`, `backend/data`, los modelos activos ni la base productiva. Los archivos estáticos viejos pueden retirarse reemplazando únicamente `frontend/dist`.
4. Ejecuta `instalar.bat`. Usa **npm ci --omit=dev**, conserva la configuración existente y prepara los datos iniciales que falten. No se instalan dependencias del frontend.
5. Revisa `backend/.env` conservando sus credenciales. Para Gemini configura **GEMINI_MODEL=gemini-3.5-flash-lite**. No copies la clave del entorno de desarrollo. Conserva `NODE_ENV=production` y `PORT=5173`; el lanzador productivo también establece estos valores.
6. Las nuevas tablas de honorarios se crean de forma idempotente al usar sus servicios. Puedes prepararlas antes del arranque con `.\.runtime\node.exe backend\scripts\migrate-honorarios.js`. Este script sólo crea estructuras en PostgreSQL de BI; no modifica SAP ni Vertical. El usuario de PostgreSQL debe poder crear las tablas e índices necesarios. `db:init` y los seeds son para instalación inicial, no para sustituir los datos de una actualización.
7. Inicia `iniciar_produccion.bat`. Abre `http://localhost:5173/health`: debe indicar `status: ok`, `db: ok` y `environment: production`. Entra a `http://localhost:5173` y recarga con **Ctrl + F5**.
8. Verifica con un usuario autorizado los tableros claro/oscuro, honorarios, reportes y revisión de cuentas. Los módulos nuevos y los 64 temas de reportes requieren sus permisos correspondientes en Administración de usuarios; el acceso completo especial de `amendoza` se conserva. No se asignan permisos nuevos automáticamente a otros usuarios.


La revisión del 5 de octubre incorpora procedimientos quirúrgicos por rol desde PCFRCP/PCFRPR y el catálogo CP. Revisa sus tarifas autorizadas y posibles coincidencias con cargos antes de aprobarlos. El Excel respeta estado, médico, grupo y búsqueda; el Excel del cierre consulta los pagos actuales. Evidencia y alcance: `docs/revision-pase-honorarios-2026-10-05.md`.

La actualización del 6 de octubre incluye **Honorarios Médicos → Auditoría**: consulta de los registros originales de Vertical, filtros, detalle, paginación y Excel completo del filtro. Las listas de médicos, grupos y orígenes se cargan al abrir la pestaña y se actualizan al cambiar las fechas. Esta auditoría es de sólo lectura, utiliza el permiso existente de honorarios y no requiere una migración adicional. También incorpora la corrección del historial fiscal al cambiar de médico, la navegación vigente de Servicios, Pagos y PDF y Configuración, y todos los cambios actuales de los demás módulos. Consulta [la revisión de este pase](docs/revision-pase-2026-10-07.md) y [el alcance de la auditoría](docs/auditoria-honorarios-vertical.md).

La revisión del **7 de octubre** incorpora **Descargar PDF detallado** y **Descargar PDF resumido** junto al médico; ambos contienen sólo sus servicios aprobados. Al guardar una aprobación, la atención pasa a **Aprobados** y **Pagos y PDF**, sale de **Por revisar** y de **Aprobar pendientes**, y conserva su estado al volver a consultar. Si no pueden recuperarse las decisiones guardadas, la pantalla permite reintentar sin mostrarlas como pendientes. En Catálogo y precios, los servicios completos muestran **Configurados** en verde. También corrige la aprobación de servicios desactivados durante la revisión, conserva el orden solicitado de columnas en pantalla y Excel, continúa las páginas SAP vacías que tengan más resultados y respeta las cancelaciones de consultas. Incluye la revisión de etiquetas y gráficos de los tableros. Consulta [la evidencia y el alcance de esta revisión](docs/revision-pase-2026-10-07.md).

## Configuración y fuentes

La ampliación de **Jefes de área** agrega una tabla editable de pagos mensuales vinculada al médico existente. El usuario decide si incluye el fijo de cada mes; se toma completo el importe capturado y se calcula el total e impuestos al final con la ficha del médico. Se conserva un único registro por médico y mes y el importe histórico de los pagos preparados. Consulta [el flujo y las comprobaciones](docs/honorarios-jefes-de-area.md). `backend/scripts/migrate-honorarios.js` incluye las nuevas estructuras propias de BI.

Se conserva la conexión SQL Server/Tailscale `REMOTE_DB_SERVER=100.121.115.8`, `REMOTE_DB_PORT=1433`, base `KH_HE`. SAP usa el Service Layer configurado en el servidor. PostgreSQL conserva usuarios, decisiones, plantillas, tarifas, cierres, aplicaciones e histórico.

Las opciones nuevas son `HONORARIOS_CATALOG_SYNC_MINUTES=30`, `HONORARIOS_DISCOVERY_MONTHS=12` y `SAP_LOCAL_CURRENCY=MXN`. Si no existen en el `.env` del servidor se usan esos valores predeterminados. El catálogo se sincroniza al arrancar y según su intervalo sin reemplazar tarifas autorizadas. Las tablas del DW y las columnas faltantes se preparan por los inicializadores existentes; no se recrea el histórico.

La auditoría de honorarios excluye los códigos **FAR/ALM** y cualquier grupo de **farmacia o almacenes**, como Almacén General, Almacén Quirófano y Farmacia Satélite. También excluye servicios con código SER u otro código que pertenezcan a esos grupos. La exclusión se aplica a registros, totales, listas de filtros y Excel. Para aplicar este cambio hay que actualizar el código y reiniciar el backend; no requiere migraciones ni cambios en Vertical.

La IA necesita la clave existente del proveedor configurado y salida HTTPS a su servicio; para Gemini, `generativelanguage.googleapis.com`. Las reservas entre proveedores sólo se habilitan con `REPORT_AI_FALLBACK_PROVIDERS`; cada una necesita su propia clave. `REPORT_AI_GEMINI_FALLBACK_MODELS` permite indicar modelos Gemini de reserva. El chat envía la solicitud y metadatos del catálogo autorizado; no envía resultados de pacientes. Si el proveedor falla, mantiene la búsqueda guiada y la selección manual. Cambiar el ejemplo de configuración no cambia por sí solo el `.env` conservado del servidor.

Los pronósticos de ML conservan sus scripts Python, modelos iniciales y `backend/ml/requirements.txt`. Python y sus bibliotecas deben estar disponibles en el servidor que use esas funciones; no se copia un entorno virtual local.

## Verificación tras copiar

En Crear reporte personalizado y Mar-IA, comprueba un filtro de saldo, una agrupación con total y una consulta puntual por folio de atención. Verifica por separado estado de cuenta, factura y cobro, y prueba el reporte guardado/asignado con un usuario receptor. Los ejemplos y límites están en `docs/asistente-analisis-y-casos-2026-10-09.md`.

En Honorarios, verifica **Servicios**, **Pagos y PDF**, **Configuración** y **Auditoría** con un usuario autorizado. Comprueba la configuración de una tarifa, la revisión de una atención y un cierre con un pago parcial en un entorno de prueba. El PDF debe mostrar el saldo restante y bloquearse si no puede validar los importes o la fuente clínica. En Auditoría, verifica las fechas, los filtros, el detalle y que el Excel contenga todos los resultados del filtro. Consulta `docs/instructivo_honorarios.html`, `docs/honorarios-aprobados-y-pdf-pago.md` y `docs/auditoria-honorarios-vertical.md` para el flujo y sus comprobaciones. Comprueba también las dos descargas junto al médico y el distintivo Configurados en verde sólo cuando el servicio tiene tarifa autorizada. Los PDF de revisión siguen disponibles como documentos de revisión.

La verificación estricta del manifiesto se aplica a la carpeta del pase **antes de mezclarla con la instalación existente**. Esa instalación contiene configuración, cargas y dependencias que no forman parte del paquete. El empaquetado también contrasta las fuentes actuales para detectar cambios que aún no hayan pasado a producción.

Para otras computadoras abre `http://IP-DEL-SERVIDOR:5173`; no uses localhost. `permitir_acceso_red.bat` prepara el acceso de red cuando corresponde. Consulta `GUIA_CONEXION_PRODUCCION_TAILSCALE.md` para la conexión remota.

El pase se preparó y validó localmente. Su preparación no aplica cambios ni inicia procesos en SERVIDORCALIDAD.
