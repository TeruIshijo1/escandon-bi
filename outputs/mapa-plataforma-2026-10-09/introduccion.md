# Mapa e instructivo de la plataforma Hospital Escandón BI

**Fecha de corte:** 9 de octubre de 2026.  
**Código revisado:** árbol de trabajo actual de `D:\Escritorio\escandon-bi`, incluidos sus cambios locales existentes.  
**Objetivo:** localizar cada apartado, explicar qué información permite consultar y rastrear de qué parte de Vertical, SAP u otra fuente se obtiene.

## Cómo usar este documento

1. Consulta el **mapa general** para ubicar la pantalla.
2. Lee su ficha: información disponible, indicadores, filtros, acciones y procedencia.
3. Para verificar una cifra, sigue **fuente original → transformación o sincronización → servicio → pantalla**. Las tablas y campos se incluyen como referencia para Sistemas; los nombres de pantalla y pasos sirven al usuario operativo.
4. Si buscas un reporte que no figura en el menú, revisa el catálogo de reportes personalizados y el anexo de capacidades del asistente.
5. Consulta los controles finales para comprobar las rutas, componentes y operaciones incluidas.

**Alcance de la revisión:** análisis estático del código, consultas SQL, catálogos, componentes, rutas, configuraciones iniciales y servicios. No se ejecutaron consultas a las bases del hospital, ni se certificaron cifras, permisos efectivos, conexiones, modelos externos de Power BI/Looker o la versión instalada en producción. No se modificó la aplicación.

**Regla de cobertura:** se incluyen las pantallas accesibles, sus subapartados, componentes alternativos y funciones declaradas sin una pantalla montada. Cuando el código contiene una opción incompleta, una fuente configurable o un dato estimado, se describe su situación; no se presenta como una consulta operativa confirmada. Los adjuntos y modelos externos no incluidos como código legible se registran como fuentes pendientes de trazabilidad interna.

## Mapa general de navegación

Los apartados visibles dependen del rol, área, permisos individuales y reportes asignados. Que un apartado no aparezca en la sesión de un usuario no significa que no exista en la plataforma. El permiso del menú y la autorización del servicio pueden ser diferentes. Existe una excepción nominal de acceso total para `amendoza` en el código revisado; para los demás usuarios se comprueban permisos explícitos. Evidencia: `frontend/src/utils/rbac.js:166`, `frontend/src/components/layout/Sidebar.jsx:20`, `frontend/src/components/layout/ProtectedRoute.jsx` y `backend/middleware/auth.middleware.js`.

| Grupo | Apartado y ruta | Qué permite localizar | Fuente principal |
|---|---|---|---|
| Acceso | Iniciar sesión `/login`; Sin acceso `/sin-acceso` | Identificación y explicación de acceso denegado | Usuarios y roles internos |
| Principal | Inicio `/` | Bienvenida y accesos disponibles para la cuenta | Sesión, navegación y permisos internos; sin KPI clínico actual |
| Dirección | Tablero directivo `/dashboard/directivo` | Eficiencia Operativa, Eficacia Clínica, Macropanel Financiero, Ingresos y Egresos, Demografía Geográfica | Vertical, SAP y datos sincronizados |
| Dirección | Ocupación de camas `/dashboard/ocupacion` | Camas, ocupación y pacientes vinculados | Vertical |
| Mi Área | Tablero de Área `/dashboard/area` | Áreas clínicas, auxiliares, aseguradoras y alternativas configurables | Vertical/SAP; BI externo donde se configure |
| Mi Área | Estadísticas `/estadisticas` | 18 apartados estadísticos, históricos, detalles y Excel | Vertical y SAP según estadístico |
| Mi Área | Honorarios Médicos `/interconsultas-jornadas` | Servicios, aprobaciones, pago/PDF, auditoría, tarifas, fichas fiscales y jefaturas | Vertical + SAP + gestión interna BI |
| Mi Área | Crear Reporte Personalizado o Mis reportes `/mi-area/consultas-service-layer` | Catálogo, consultas, asistente, reportes guardados y asignados | SAP, Vertical y metadatos internos |
| Históricos SITI | Reportes históricos `/siti/dashboard` | Pacientes, cirugías, médicos, auxiliares y mapa | SITI histórico |
| Históricos SITI | Comparativo vs Vertical `/siti/comparativo` | Comparación por origen y periodo | SITI y Vertical |
| Auditoría | Inventarios y Consumos Clínicos `/auditoria/inventarios` | Insumos, cargos y discrepancias | Vertical; integración configurada/interna |
| Auditoría | Cargos y Reversas por Paciente `/auditoria/cargos-reversas` | Movimientos y devoluciones por paciente | Vertical |
| Auditoría | Discrepancias en Consumos `/auditoria/cargos` | Pantalla con ruta directa, sin entrada equivalente en el menú actual | Auditoría interna |
| Auditoría | Rastreo de Órdenes e Insumos `/rastreo-ordenes` | Cadena de documentos y movimientos | SAP y Vertical |
| Auditoría | Facturas y reapertura de cuentas `/auditoria/reapertura-cuentas` | Facturas, relaciones y condiciones de revisión | SAP; revisión sin reapertura automática |
| Auditoría | Control de Calidad de Datos `/calidad-datos` | Observaciones, prioridades, seguimiento y resolución | Vertical + registro interno |
| Farmacia | Inventario Farmacia (SAP) `/farmacia/inventario` | Inventario, recetas pendientes, salidas e historial | SAP y Vertical según pestaña |
| Farmacia | Cargos a Pacientes (SAP) `/farmacia/cargos-sap` | Cargos clínicos y enriquecimiento con lotes | Cargos Vertical + información SAP |
| Farmacia | Resumen Maestro de Salidas `/farmacia/resumen-maestro` | Resumen de consumos y salidas | Vertical/SAP según consulta |
| Farmacia | Devoluciones `/farmacia/devoluciones` | Cantidades devueltas, estado y trazabilidad | Vertical |
| Farmacia | Punto de Reorden SAP `/farmacia/reorden` | Stock, mínimos/máximos, pedidos y pronósticos | SAP + configuración y ML internos |
| Quirófano | Agenda y Proyección `/quirofano/agenda` | Programación, consumos e insumos previstos | Vertical + sincronización interna |
| Quirófano | Kits Quirúrgicos `/quirofano/kits` | Insumos agrupados por cirugía | Vertical + cálculo/caché interna |
| Quirófano | Variaciones por Cirujano `/quirofano/variaciones` | Diferencias de consumo por médico/procedimiento | Vertical |
| Quirófano | Almacén Quirófano (QX) `/quirofano/almacen` | Existencias y necesidades del almacén QX | SAP + Vertical |
| Quirófano | Acceso abreviado `/quirofano` | Redirige a la agenda; no es un quinto submódulo | Redirección de navegación |
| Almacén General | Inventario Almacén (SAP) `/almacen/inventario` | Stock, valoración y movimientos | SAP |
| Almacén General | Punto de Reorden & Pedidos SAP `/almacen/reorden` | Reposición, pedidos, configuración y ML | SAP + gestión interna |
| Almacén General | Traslados Almacén (SAP) `/almacen/traslados` | Transferencias, origen/destino y detalle | SAP + copia sincronizada |
| Almacén General | Reportes Almacén (SAP) `/almacen/reportes` | Reportes de inventario, movimientos y consultas | SAP; algunos reportes cruzan Vertical |
| Almacén General | Precios de artículos `/almacen/precios-articulos` | Ruta dedicada que reutiliza ReportesAlmacen con reporte de precios | SAP |
| Consulta Externa | Agenda `/consulta-externa` | Agenda, pacientes, consultas y seguimiento | Vertical sincronizado + registros CEX internos |
| Administración | Gestión de Usuarios `/admin/usuarios` | Cuentas, perfiles, permisos, altas y bajas | Base interna BI |
| Administración | Historial de actividad `/admin/auditoria-log` | Consultas, cambios, resultados y exportación del registro | Base interna BI |
| Administración | Configuración `/admin/configuracion` | Nombre, icono, enlaces y fuentes de datos de indicadores | Configuración interna; destinos externos |
| Administración | Prueba SAP BOne `/admin/prueba-sap` | Entrada declarada en menú/permisos; sin componente de ruta en App actual | Existe prueba API `/api/sap/ping`; no pantalla independiente montada |
| Transversal | MAR-IA, modales, filtros, descargas, tema y cuenta | Asistente, detalles de cuenta/factura/recibo, reportes externos y exportación | Fuente del apartado o servicio asociado |

Evidencia principal de navegación: `frontend/src/App.jsx:133–424` y `frontend/src/utils/rbac.js:330–562`. El índice técnico final contiene cada ruta individual con su línea.

## Cómo se obtiene la información

```text
Vertical (SQL Server) ── lectura directa ──────────────────┐
                     └─ sincronización ── PostgreSQL DW ──┤
SAP Business One ── Service Layer / SQLQueries ────────────┤
                 └─ sincronización ── PostgreSQL DW ───────┤
SITI histórico ── API o tablas históricas configuradas ────┤── API BI ── pantalla / KPI / Excel / PDF
Gestión propia BI ── PostgreSQL ───────────────────────────┤
Excel / CSV / JSON / conectores configurados ──────────────┘
Power BI / Looker ── modelo externo ── visor incrustado (trazabilidad del modelo aparte)
```

| Tipo de origen | Parte funcional | Qué debe interpretarse |
|---|---|---|
| **Vertical directo** | Atención/cuenta (`PC`), paciente (`PT`), cargos (`PCIT`, `PCBL`), solicitudes (`PCPR`, `PCPRIT`), citas (`PCAP`), órdenes (`SO`, `SOLN`), procedimientos (`PCFR`, `PCFRCP`, `PCFRPR`) y vistas `UDR_*` | La consulta se ejecuta contra la fuente clínica/comercial configurada. El nombre real de la base procede de `REMOTE_DB_NAME`; no se supone un nombre por referencias antiguas. |
| **SAP directo** | Ventas, compras, socios de negocios, cobros/pagos, inventario, almacenes, listas de precios y contabilidad | Se utiliza Service Layer y, donde está implementado, `SQLQueries`. Se conservan diferencias entre total del documento, líneas, impuestos y pagos. |
| **DW/copia sincronizada** | Tablas `dw_*` en PostgreSQL | Refleja la última sincronización exitosa, no necesariamente el estado instantáneo de SAP/Vertical. La consulta local puede seguir funcionando aunque la sincronización haya fallado. |
| **BI interno** | Usuarios, roles, permisos, actividad, observaciones, agenda CEX, tarifas, aprobaciones, pagos registrados, reportes guardados y configuración | Son registros creados o conservados por esta plataforma. Un pago capturado no equivale a ejecutar una transferencia en SAP/banco. |
| **SITI** | Históricos heredados | Conserva su propio universo y periodo; no se considera idéntico al de Vertical por compartir una etiqueta. |
| **Externo configurable** | Power BI, Looker, archivos o enlaces JSON | El código acredita el vínculo/configuración, pero no permite afirmar el origen interno del modelo externo sin inspeccionarlo. |
| **Derivado/estimado** | Fórmulas, reglas, clasificación, proyección y ML | Se genera a partir de los datos y parámetros descritos. No es un campo original de SAP/Vertical ni un evento clínico certificado. |

La conexión principal de la aplicación y el DW usan PostgreSQL en el código actual (`backend/config/db.js:1`, `backend/config/pg-db.js:7`). Documentación antigua o archivos SQLite conservados no sustituyen este hecho. La conexión de Vertical usa SQL Server (`backend/config/remote-db.js:13`).

### Actualización y lectura de periodos

Los procesos de cobros/compras/traslados, tableros y quirófano tienen programación de aproximadamente **15 minutos**, condicionada al arranque y éxito de cada tarea. La agenda CEX se sincroniza desde el DW. Honorarios actualiza su catálogo según su propio intervalo/configuración. Inventarios, reportes personalizados y auditorías también tienen lecturas directas o cachés específicas descritas por módulo. **Actualizar la pantalla** vuelve a consultar su servicio y no garantiza por sí mismo una sincronización completa del origen.

Evidencia: `backend/services/sync.service.js:130`, `backend/services/dashboardSync.service.js:607`, `backend/services/dashboardSync.service.js:617`, `backend/services/quirofanoSync.service.js:385`, `backend/server.js:282–288`. El origen de la fecha puede ser fecha de atención, cargo, cita, creación, contabilización o vencimiento; se indica en cada apartado cuando está definido.
