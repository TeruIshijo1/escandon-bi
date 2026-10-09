## Control de calidad de datos

**Ubicación:** Auditoría → Control de Calidad de Datos, `/calidad-datos`. Título de pantalla: **Revisión de la información**.

| Apartado o KPI | Información y definición | Origen |
|---|---|---|
| Revisar información | Escanea hasta 200 cargos recientes, ordenados por fecha descendente; registra nuevos hallazgos | Vertical `UDR_CUENTAS_SERVICIOS`; consulta `TOP 200` |
| Datos sin observaciones | `max(0, 100 − pendientes × 2.5)`, redondeado a un decimal | Cálculo sobre hallazgos internos. Es un puntaje; **no es el porcentaje medido de todos los registros clínicos** pese al texto de la tarjeta. |
| Alertas pendientes | Número de hallazgos PENDIENTE y subconteo de prioridad ALTA | `data_quality_issues` |
| Observaciones resueltas | Conteo de estado RESUELTO | Registro interno |
| Observaciones registradas | Conteo histórico total, incluyendo pendientes/resueltas/ignoradas | Registro interno |
| Lista de observaciones | Fecha, origen, prioridad, regla, artículo/descripcion, paciente, datos del registro y estado | Hallazgo + copia del renglón en `row_data` |
| Filtros y seguimiento | Estado Todos/Pendientes/Resueltos/Ignorados, prioridad Alta/Media/Baja, notas, resolver o ignorar | Actualiza el seguimiento interno; no corrige automáticamente el cargo en Vertical |

**Reglas que ejecuta el escaneo actual:** precio cero con cantidad positiva (ALTA); cantidad **≥10** (MEDIA); `Devuelto > 0` (MEDIA). La interfaz tiene etiquetas para posible cargo duplicado y fecha inválida, pero este escaneo no implementa esas dos detecciones. El precio se obtiene de `TotalCobrado || PrecioUnitario || 0`; no es una validación completa de todas las posibles tarifas/negativos. La API de inspección individual aplica reglas diferentes: precio ≤0 y cantidad >20. Se deduplican algunos hallazgos por artículo/paciente/regla, no por un identificador único de toda atención.

**Campos originales:** `NUMERO_DE_ORDEN`, `NOMBRE_DEL_PACIENTE`, `UNIDAD_DE_SERVICIO`, `CODIGO`, `DESCRIPCION_DEL_ARTICULO`, `CANTIDAD`, `DEVUELTO`, `TOTAL_COBRADO`, `PRECIO_UNITARIO`, `FECHA_DE_CARGO` de `UDR_CUENTAS_SERVICIOS`. La lista de pantalla solicita 100 observaciones; el resumen se calcula sobre la tabla completa de hallazgos.

**Pasos:** Revisar información → filtrar prioridad/estado → leer detalle → revisar en el sistema de origen → anotar la acción → marcar Resuelto o Ignorado → Actualizar Estado. Ignorar no elimina el histórico.

Evidencia: `frontend/src/pages/DataQualityDashboard.jsx:33–96`, `frontend/src/pages/DataQualityDashboard.jsx:188`, `backend/services/dataQuality.service.js:18–85`, `backend/services/dataQuality.service.js:101–110`, `backend/services/dataQuality.service.js:190–216`, `backend/routes/dataQuality.routes.js:74`.

## Administración

### Gestión de Usuarios

**Ruta:** `/admin/usuarios`. Permite consultar usuario, nombre, correo, perfil/rol, área, activo/inactivo y datos de administración de la cuenta; buscar y filtrar por rol; crear/editar cuentas, cambiar contraseña, activar/desactivar y gestionar permisos de acceso por grupos. El catálogo de permisos se genera desde la navegación, las áreas, indicadores y permisos de consulta de reportes. La lista de áreas del formulario no contiene necesariamente las 13 áreas declaradas en RBAC.

**Procedencia:** datos propios de BI en `Usuarios`, `Roles` y campo de permisos `Permisos`; relación `Usuarios.RolId=Roles.RolId`. No se obtienen cuentas de usuario del directorio médico de Vertical ni de los socios de negocio SAP. Los permisos a reportes guardados/asignados se describen en el capítulo de reportes.

**Pasos:** localizar usuario → Editar para sus datos/rol/área/estado → Permisos de acceso para seleccionar apartados → guardar → la cuenta accede según su rol, permisos y restricciones del servicio. La baja del endpoint de usuario se maneja como desactivación según implementación; no equivale a borrar la identidad en SAP/Vertical.

Evidencia: `frontend/src/pages/AdminUsuarios.jsx:30–56`, `frontend/src/pages/AdminUsuarios.jsx:79–191`, `frontend/src/pages/AdminUsuarios.jsx:470–572`; `backend/routes/admin.routes.js:57–124`, `backend/routes/admin.routes.js:143–308`; `frontend/src/utils/rbac.js`.

### Historial de actividad

**Ruta:** `/admin/auditoria-log`. Consulta usuario, perfil, acción (consultar/registrar/actualizar/eliminar), apartado/ruta, resultado, tiempo de respuesta, IP y fecha/hora. Tiene búsqueda en pantalla, rango de fechas, actualización de aproximadamente 30 segundos cuando no hay fechas y descarga Excel.

**Fuente:** `AuditLog` de PostgreSQL; el middleware registra actividad HTTP de la plataforma. Permite ver actividad del portal, no el historial completo de cambios en SAP o Vertical. El servicio devuelve hasta 100.000 filas, ordenadas por fecha descendente; la consulta puede aplicar una o ambas fechas.

Evidencia: `frontend/src/pages/AdminAuditoriaLog.jsx:23–67`, `frontend/src/pages/AdminAuditoriaLog.jsx:132`, `backend/routes/admin.routes.js:322–362`, `backend/middleware/audit.middleware.js`.

### Configuración general de indicadores y vínculos

**Ruta:** `/admin/configuracion`. La interfaz actual presenta configuración de cuadros/indicadores: sección, identificador, nombre original/personalizado, icono, enlaces de reporte, fuente JSON por URL/archivo y multipágina, con editar/guardar/cancelar y filtros Todos/Directivo/Mando/Tablero de Área/Estadísticas/Auditoría/Inicio.

**Fuente:** `KPIConfig`: `ElementoId`, `Seccion`, `NombreDefault`, `NombreCustom`, `Icono`, `PBIUrl`, `PBIUrl2`, `PBIUrl3`, `JsonApiUrl`, `JsonFilePath`, `MultiPagina`, estado y modificación. El código puede cambiar el nombre de una tarjeta; el nombre personalizado no modifica por sí solo la fórmula nativa. Los 44 identificadores de la semilla SQL se enumeran en el control final; los registros efectivos pueden variar en la base instalada.

**Carga de JSON:** se guarda un archivo configurado en `backend/uploads/json`; Excel desde JSON lee ese archivo/URL. El origen clínico/contable del JSON depende de quien lo prepare. **Power BI/Looker:** un enlace abre un modelo externo; su origen de datos, relaciones y medidas no se certifica leyendo `KPIConfig`.

**Situación de ConfiguracionBI:** la página carga también `/admin/config-bi` y conserva estado para reportes/archivos, pero su render actual termina con la tabla de indicadores; no se identificó un editor de reportes BI independiente renderizado. El CRUD backend de reportes existe y se documenta a continuación como capacidad de servicio, sin inventar una pestaña visible.

Evidencia: `frontend/src/pages/AdminConfiguracion.jsx:139–230`, `frontend/src/pages/AdminConfiguracion.jsx:309–493`, `backend/routes/admin.routes.js:588–646`, `frontend/src/hooks/useKPIConfig.js:34–93`.

### Capacidades administrativas de servicio sin pantalla dedicada actual

| Función | Información consultable/gestionable | Origen y evidencia |
|---|---|---|
| Catálogo de reportes BI | Título/ID, workspace/report ID, Looker 1–3, archivos PBIX/Excel/miniatura, roles/área, estado, multipágina, API/archivo JSON; CRUD | `ConfiguracionBI`, `backend/routes/admin.routes.js:426–491`; disponibilidad al usuario vía `/api/bi/available-reports` según configuración. |
| Conectores | Nombre, tipo y configuración; registrar conector; descubrir entidades del archivo/base | `DataConnectors`, `DataEntities`; `backend/routes/admin.routes.js:505–539`, `backend/services/datahub.service.js:44–100`. |
| Mapeo de métricas | Sección UI, entidad, columna de valor/delta/filtro y método de cálculo | `MetricMappings` unido a entidades/conectores; `backend/routes/admin.routes.js:545–574`. |
| Cálculo DataHub | Suma, promedio, conteo o método LAST según archivo/tabla configurados | `datahub.service.js:113–201`; Excel/CSV, SQL Server/PostgreSQL; ausencia de origen/mapeo puede volver al cálculo de ruta. En archivo, COUNT cuenta renglones y LAST toma el último renglón recorrido; SQL COUNT cuenta valores no nulos y LAST usa LIMIT 1 sin orden, por lo que no garantiza el último cronológico. SQLite es fallback. El origen dinámico no es universalmente Vertical/SAP. |
| Sincronización completa | Actualiza Quirófano, tableros y traslados, de manera secuencial | `/api/admin/sync-dw-full`; `backend/routes/admin.routes.js:655`. Es una operación de administración, no un KPI ni una prueba de producción. |
| Subida de activos | JSON, PBIX, Excel/CSV y miniaturas, según endpoint y extensión | `/api/admin/upload-json`, `/upload-assets`; `backend/server.js:164`; archivos locales protegidos mediante `/api/files`. |
| Prueba SAP | Estado de conexión/respuesta del Service Layer | `/api/sap/ping`; entrada `/admin/prueba-sap` sin ruta montada en `App.jsx`. La API no convierte el menú en una pantalla de prueba disponible. |

Los conectores y destinos pueden contener configuración sensible; este instructivo registra su función y objetos, sin copiar credenciales ni valores privados.

## Funciones comunes de toda la plataforma

### Acceso, menú, cuenta y presentación

**Iniciar sesión:** `/login` envía usuario/contraseña a `/api/auth/login`; `/api/auth/me` recupera identidad, rol, área y permisos desde `Usuarios`/`Roles`. Cerrar sesión en el frontend actual borra token, usuario y asignaciones de la sesión local; no llama a `/api/auth/logout`. Ese endpoint existe como capacidad de servicio separada. Sin acceso explica la restricción y ofrece navegación correspondiente. No son consultas a las credenciales de SAP/Vertical. Evidencia adicional: `frontend/src/context/AuthContext.jsx:132–140`.

**Menú y encabezado:** Sidebar agrupa módulos filtrados por permisos; Navbar muestra apartado, cuenta/perfil, mostrar/ocultar menú, modo claro/oscuro y cierre de sesión. El tema se conserva en `localStorage`. `HospitalPulse` es una animación decorativa: no representa pulso de paciente ni estado en vivo del hospital.

**Acceso a reportes asignados:** una cuenta con reportes asignados puede ver Mis reportes en lugar de Crear Reporte Personalizado según sus permisos. No debe interpretarse que posee acceso al constructor o a todos los recursos por ver esa entrada.

Evidencia: `backend/routes/auth.routes.js:17–116`, `frontend/src/context/AuthContext.jsx`, `frontend/src/components/layout/Sidebar.jsx:20–26`, `frontend/src/components/layout/Navbar.jsx:44–59`, `frontend/src/components/layout/HospitalPulse.jsx:3`, `frontend/src/utils/assignedReportAccess.js`.

### Modales y detalles de consulta

| Componente/apartado | Información que muestra | Fuente efectiva |
|---|---|---|
| Estado de cuenta | Cargos por atención/folio, importes y suma de `Total` del detalle recibido | `/api/dashboard/financiero-nativo/cuenta/:pcNum`; consulta descrita en el tablero financiero. `EstadoCuentaModal.jsx:36`. |
| Factura de proveedor | Folio, proveedor, fecha, moneda, importe y detalle de documento SAP | `/api/dashboard/finanzas-nativo/factura/:docNum`; `FacturaProveedorModal.jsx:21`. |
| Recibo de ingreso | Cobro SAP, cliente, fecha, importes/aplicaciones disponibles | `/api/dashboard/finanzas-nativo/ingreso/:docNum`; `ReciboIngresoModal.jsx:21`. |
| Detalle estadístico | Registros/gráfica asociados a la sección elegida, filtros y periodo | `ModalDetalleEstadisticas.jsx` y `/api/dashboard/stats-detalle`; fuentes del estadístico seleccionado. |
| Visor BI / PBIModal | Reporte incrustado, páginas configuradas y opciones de descarga asociadas | URL de `KPIConfig`/`ConfiguracionBI` o API del apartado; el modelo externo tiene trazabilidad separada. `PBIModal.jsx:13`. |
| Edición sobre un indicador | Cambiar nombre/icono/enlace; abrir BI si tiene URL y permiso | `EditableKPIWrapper.jsx:23–87` + `useKPIConfig`. No altera el origen o fórmula nativa por cambiar el título. |

Los modales no constituyen nuevos módulos de navegación. Se incluyen para que el mapa abarque la información que aparece después de pulsar una fila, cifra o tarjeta.

### Descargas, archivos y alcance de los reportes

| Mecanismo | Qué descarga | Procedencia y límite |
|---|---|---|
| Exportación de un tablero en navegador | PDF de la vista/gráficas y Excel construido con los datos cargados | `ExportToolbar`/`ExportButton`; una captura PDF no equivale a la descarga de todos los renglones históricos. `ExportToolbar.jsx:9–117`. |
| Exportación del servidor | `/api/export/excel/:reportId`, `/pdf/:reportId`; filtros de área/estado/fechas según resolver | Datos que `resolveReportData` define para cada reporte. En auditoría/directivo sin filtros, la ruta puede emitir **CSV** pese al nombre Excel, con límite de consulta de 100.000. `export.routes.js:325–343`. |
| Tableros nativos | `/api/dashboard/export-excel` y exportación CEX dedicada | Queries/grupos admitidos por ese servicio; no un exportador universal de la base. |
| Estadísticos | Workbook mensual completo y detalles por sección | Generación del servicio `statisticsWorkbook` con fuentes descritas en Estadísticas. |
| Reportes personalizados | Excel de las columnas, filtros y granularidad configurados | Motor SAP/Vertical y límites de consulta del catálogo. |
| Honorarios | PDF resumido/detallado, aprobados, pago disponible, PDF para pago y Excel de cierre | Candidatos/revisiones/cierre y movimientos; se distinguen en Honorarios. |
| Registro de actividad / auditorías | Excel de los resultados admitidos por el servicio | `AuditLog`, auditoría Vertical o movimientos, según pantalla. |
| JSON configurado de KPI/BI | `/api/export/json-to-excel/:type/:id` | `KPIConfig` o `ConfiguracionBI` → API/archivo JSON; depende del contenido del origen. |
| Crear Excel desde un enlace | `/api/export/convert-json` | URL JSON pública admitida; fuente externa proporcionada. No es automáticamente Vertical/SAP. `ExportApiModal` se importa en Área y Directivo, pero su render está comentado en ambas pantallas; el servicio existe y el modal no se muestra actualmente. |
| PBIX/Excel/adjuntos publicados | Archivo local o vínculo configurado del reporte | Archivos de `backend/uploads`/configuración; un PBIX no permite deducir todas sus medidas sólo leyendo el wrapper. |

Evidencia: `backend/routes/export.routes.js:232–234`, `backend/routes/export.routes.js:310–325`, `backend/routes/export.routes.js:422`, `backend/routes/export.routes.js:958`, `frontend/src/components/shared/ExportApiModal.jsx:28`, `frontend/src/components/shared/ExportButton.jsx:46`.

### Componentes compartidos sin fuente de datos independiente

`KPICard`, `DashboardMetricCard`, `DashboardChart`, `AreaSwitcher`, `AreaIcon`, `ReportBuilderIcon` y componentes de filtros son presentación de datos recibidos del módulo. `PremiumLoader` muestra progreso de carga, `ErrorBoundary` muestra incidencias de renderizado, `ProtectedRoute` controla el acceso, `AppShell`/`App`/`main` montan la aplicación y `AuthContext` conserva la identidad. No consultan nuevas tablas clínicas por existir como componentes. Los 96 archivos React se enumeran al final para cubrir también estos elementos.

## Límites que deben acompañar la lectura del mapa

1. **Código actual y producción:** este documento describe el árbol local a la fecha de corte. Se necesita contrastar la versión instalada para asegurar igualdad con producción.
2. **Declarado y disponible:** una tabla, entidad, capacidad o columna declarada en catálogo puede faltar en el ambiente conectado o requerir permisos/metadatos específicos. El anexo conserva la declaración y su condición.
3. **Vista externa:** se identifica una vista `UDR_*` como origen exacto cuando el código la consulta; si no está su definición SQL completa, no se inventan sus tablas internas.
4. **Tablero configurable externo:** Power BI/Looker/JSON puede apuntar a información distinta de la nativa. Se debe verificar el modelo/recurso vinculado para conocer su trazabilidad completa.
5. **Conteo, importe y periodo:** pacientes, cuentas, citas, órdenes, líneas, procedimientos y pagos son unidades diferentes. Fecha de servicio, cargo, creación y contabilización también pueden diferir.
6. **Estimaciones:** proyección quirúrgica, pronóstico ML, clasificación por texto, reglas de eficacia/vidas salvadas y puntajes son cálculos de la plataforma; no son certificaciones clínicas ni saldos bancarios.
7. **Caché y dato ausente:** un cero mostrado por fallback, un resultado limitado o una caché antigua no demuestra ausencia de actividad. Las fichas señalan casos detectados.
