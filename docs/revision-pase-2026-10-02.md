# Revisión del pase a producción — 2 de octubre de 2026

Este documento conserva la revisión inicial del día. El cierre de la revisión, con el catálogo Aprobados, el PDF para pago y el inventario actualizado, se encuentra en [revisión final de honorarios y del pase](revision-pase-honorarios-2026-10-02.md).

Se revisó el estado completo del proyecto, incluidos los cambios pendientes y los archivos nuevos. El pase se prepara con el backend completo y una compilación nueva de todo el frontend; no depende de que los cambios estén confirmados en Git. El inventario de cada archivo distribuido, su origen, tamaño y SHA256 queda en `MANIFIESTO.json`.

El inventario de trabajo contiene **205 archivos modificados o nuevos**, incluyendo documentación, pruebas y herramientas. Todos tienen destino o una exclusión de desarrollo explícita en la tabla de este informe. La distribución incluye también los archivos necesarios que ya estaban confirmados en Git.

## Cambios incluidos y revisión funcional

| Área | Cambios y comprobaciones |
| --- | --- |
| Textos de la plataforma | Mensajes sencillos en administración, acceso, inventarios, farmacia, auditoría, exportaciones y agenda. Formato central de avisos en backend y frontend; mantiene los identificadores y los datos del negocio. |
| Tableros | Los 9 tableros de área comparten selector accesible, espacio entre secciones, indicadores legibles y gráficas adaptables. Predomina el azul institucional, con acentos propios de cada área y rojo para pérdidas. También se actualizaron tableros generales, directivos, históricos y de calidad. Se probaron tema claro/oscuro y tamaños de pantalla de escritorio y móvil. |
| Reportes SAP y Vertical | Catálogo de 62 temas, selección manual, filtros, permisos por tema, plantillas y exportaciones. Chat con contexto para ajustar el mismo reporte, lenguaje coloquial, abreviaturas y errores de escritura; valida columnas, periodos y filtros antes de consultar. Se incluyeron estado de cuenta y alta médica en las cirugías. |
| IA | Cliente Gemini con interpretación local de respaldo. La configuración de ejemplo y los valores predeterminados del clasificador se alinearon con gemini-3.5-flash-lite. La selección del modelo respeta el proveedor de la clave utilizada, evitando mezclar opciones de otros proveedores. Se conserva el límite de 1500 caracteres por mensaje del chat de reportes. |
| Honorarios | Catálogo de servicios y tarifas en PostgreSQL, vigencia y cambios por revisión, médico asignado, evidencia de atención, estados y aprobaciones individuales o por lote. Se revisaron importes, IVA y retenciones, cobertura, duplicados, folios de cita/atención/orden de venta, cierres, pagos y ajustes. Los cierres conservan su fotografía de cálculo. |
| Fallos de SAP en honorarios | Se restauró un aviso visible y sencillo cuando no se obtienen las facturas e impuestos. Los servicios siguen visibles y los importes incompletos quedan pendientes. La prueba comprueba que ese fallo no produce un neto presentado como completo. |
| Revisión de cuentas | Búsqueda de paciente y cuenta, estados literales de SAP, documentos, pagos, conciliaciones y mapa de relaciones. Comprobaciones de cancelación real, presupuesto de tiempo y respuestas antiguas. Las rutas de revisión no reabren ni modifican cuentas. |
| Arranque y conexiones | Lanzador con selección del Node portable, validación de versión y comprobación de la instancia. No inicia sincronizaciones si no pudo abrir el puerto; no termina indiscriminadamente otros procesos. Se incluyen los cambios del transporte SAP. |

## Correcciones del proceso de pase

- El paquete se prepara y valida en una carpeta temporal antes de sustituir el pase anterior. El anterior se conserva en `tmp/pase-anterior-*`.
- El frontend se recompila completo. Se registra el SHA256 de las fuentes y de las entradas de compilación antes del build y se comprueba que no cambiaron durante éste.
- Se verifican imports locales, dependencias productivas declaradas, consistencia de `package-lock.json`, imports de assets compilados y recursos requeridos por PDF. Se incluye `frontend/public/logo-escandon.png`, además del logo compilado.
- Se incluye `.runtime/node.exe` 24.21.0. El instalador ejecuta npm con ese Node para evitar que npm seleccione una instalación anterior.
- El instalador conserva `.env` y usa `npm ci --omit=dev`. No exporta ni restaura PostgreSQL y no ejecuta seeds de actualización.
- Los historiales y modelos de referencia quedan en `initial-data/`. Se copian sólo si faltan; una segunda ejecución conserva el histórico, los modelos y la configuración existentes.
- Se incluye la preparación opcional e idempotente de las estructuras de honorarios en PostgreSQL de BI. No modifica SAP ni Vertical.
- Se corrigieron instrucciones antiguas de SQLite, FastAPI y variables KH_*/DATABASE_URL que no configuran estas conexiones. La guía de Tailscale ahora usa REMOTE_DB_* y PG* con marcadores de credenciales.
- Se reparó la codificación de `.gitignore` para que los temporales y el runtime local queden excluidos correctamente.

## Validación realizada

- Backend: **26 suites / 341 pruebas aprobadas**, sin fallos ni pruebas pendientes.
- Lógica del frontend: **22 pruebas aprobadas** de cálculos de honorarios y mensajes.
- Empaquetado e instalador: **6 pruebas aprobadas** de inventario, configuración, imports, dependencias, detección de archivos ausentes/alterados y conservación de datos.
- API de honorarios con **PostgreSQL real en un esquema temporal aislado**, fuentes de SAP y Vertical ficticias: catálogo, tarifas, decisiones, cierre inmutable, pagos, saldos, duplicados y ajustes aprobados. El esquema de prueba se eliminó al terminar.
- **9 flujos de navegador aprobados**:

| Flujo | Resultado |
| --- | --- |
| Tableros de las 9 áreas | Aprobado |
| Tableros generales y de dirección | Aprobado |
| Avisos y errores amigables | Aprobado |
| Folios, búsqueda y exportaciones de honorarios | Aprobado |
| Catálogo, tarifas, aprobación, cierre y pagos | Aprobado |
| Cálculos, estados y búsqueda de 12,796 servicios | Aprobado |
| Revisión de cuentas SAP | Aprobado |
| Chat de reportes, lenguaje y estados de cuenta | Aprobado |
| Constructor manual, plantillas y exportaciones | Aprobado |

Los casos de servicios caídos provocan respuestas 503 simuladas para validar los avisos y el funcionamiento degradado. La regresión de honorarios mantiene sus comprobaciones financieras, exportaciones y decisiones, y su búsqueda paginada con 12,796 registros ficticios.

Los logs locales de esta revisión están en `tmp/release-*.log`; se excluyen de la distribución. El build completo terminó correctamente: **225 archivos distribuidos**, imports locales, dependencias productivas, recursos compilados y contraste SHA256 con las fuentes aprobados. La verificación autónoma del paquete usando su propio Node también pasó. `verificar_pase.ps1` comprueba el inventario SHA256 antes de mezclarlo con la instalación existente.

Se comprobó además la aplicación de la copia empaquetada: backend y frontend sirviendo juntos, los **60 archivos JavaScript/CSS** completos recibidos por HTTP y contrastados con sus SHA256, rechazo de consultas sin sesión y pantalla de acceso cargando a **1440 y 390 px** sin errores JavaScript ni desbordamientos. Esta prueba utilizó dependencias locales del backend para resolver los paquetes npm, en modo de prueba y sin conectar bases de datos ni proveedores de IA; el servidor productivo debe instalar sus propias dependencias con `instalar.bat`.

## Comparación con el pase anterior

Antes de recompilar, el inventario completo identifica **120 destinos ausentes** y **24 archivos diferentes** respecto al pase anterior; **81 coinciden**. Esto confirma por qué se reemplaza el paquete completo. Estos números son una comparación previa al nuevo build, que vuelve a generar los assets del frontend.

El manifiesto final es la referencia exacta del contenido distribuido. Los archivos antiguos que dejaron de formar parte de `frontend/dist` no se arrastran a la nueva distribución.

## Requisitos al aplicar en el servidor

Sigue [README_PRODUCCION.md](../README_PRODUCCION.md): preservar las credenciales y los datos existentes, preparar dependencias con el instalador, configurar GEMINI_MODEL=gemini-3.5-flash-lite en el `.env` conservado, permitir crear las estructuras nuevas de BI y asignar los permisos necesarios a quienes utilicen los módulos nuevos. Python y sus bibliotecas siguen siendo un requisito del servidor para los pronósticos de ML.

La preparación y las pruebas se realizaron localmente. El paquete no implica que esta actualización esté instalada ni validada en SERVIDORCALIDAD.

## Cobertura de todos los cambios pendientes

M: modificado; D: eliminado; ??: archivo nuevo. Las fuentes React se entregan compiladas; las pruebas y herramientas de desarrollo quedan en el proyecto. La tabla refleja el estado previo al build final.

| Estado | Archivo de origen | Cobertura en el pase |
| --- | --- | --- |
| M | `.gitignore` | Herramienta de desarrollo; su resultado queda integrado en el pase |
| M | `GUIA_CONEXION_PRODUCCION_TAILSCALE.md` | GUIA_CONEXION_PRODUCCION_TAILSCALE.md |
| M | `README.md` | README.md |
| M | `README_PRODUCCION.md` | README_PRODUCCION.md |
| M | `backend/.env.example` | backend/.env.example · modo y puerto productivos |
| M | `backend/package.json` | backend/package.json |
| M | `backend/routes/admin.routes.js` | backend/routes/admin.routes.js |
| M | `backend/routes/almacen.routes.js` | backend/routes/almacen.routes.js |
| M | `backend/routes/auth.routes.js` | backend/routes/auth.routes.js |
| M | `backend/routes/cex.routes.js` | backend/routes/cex.routes.js |
| M | `backend/routes/dashboard.routes.js` | backend/routes/dashboard.routes.js |
| M | `backend/routes/export.routes.js` | backend/routes/export.routes.js |
| M | `backend/routes/finanzas.routes.js` | backend/routes/finanzas.routes.js |
| M | `backend/routes/honorarios.routes.js` | backend/routes/honorarios.routes.js |
| M | `backend/routes/pharmacy.routes.js` | backend/routes/pharmacy.routes.js |
| M | `backend/routes/sap.routes.js` | backend/routes/sap.routes.js |
| M | `backend/routes/sapQueryBuilder.routes.js` | backend/routes/sapQueryBuilder.routes.js |
| M | `backend/server.js` | backend/server.js |
| M | `backend/services/aria/core/llmClassifier.js` | backend/services/aria/core/llmClassifier.js |
| M | `backend/services/honorariosCoverage.service.js` | backend/services/honorariosCoverage.service.js |
| M | `backend/services/honorariosReview.service.js` | backend/services/honorariosReview.service.js |
| M | `backend/services/prompts/ai.system.prompt.js` | backend/services/prompts/ai.system.prompt.js |
| M | `backend/services/rag.service.js` | backend/services/rag.service.js |
| M | `backend/services/sap.service.js` | backend/services/sap.service.js |
| M | `backend/services/sapQueryBuilder.service.js` | backend/services/sapQueryBuilder.service.js |
| M | `backend/tests/auth.routes.test.js` | Validación local; no se instala en producción |
| M | `backend/tests/export.routes.test.js` | Validación local; no se instala en producción |
| M | `backend/tests/honorariosCoverage.test.js` | Validación local; no se instala en producción |
| M | `build_deploy.ps1` | Herramienta de desarrollo; su resultado queda integrado en el pase |
| M | `docs/Backend.md` | docs/Backend.md |
| M | `docs/INSTRUCCIONES_IA.md` | docs/INSTRUCCIONES_IA.md |
| M | `docs/Pase_a_Produccion.md` | docs/Pase_a_Produccion.md |
| M | `docs/README_PRODUCCION.md` | docs/README_PRODUCCION.md |
| D | `frontend/dist/assets/Area-DCVSqhty.js` | Asset anterior retirado; sustitución por compilación completa |
| D | `frontend/dist/assets/BarChart-B6jUwr5R.js` | Asset anterior retirado; sustitución por compilación completa |
| D | `frontend/dist/assets/CartesianChart-B-v2XLsr.js` | Asset anterior retirado; sustitución por compilación completa |
| D | `frontend/dist/assets/ComposedChart-DVp52Pjx.js` | Asset anterior retirado; sustitución por compilación completa |
| D | `frontend/dist/assets/LineChart-C2Snicc_.js` | Asset anterior retirado; sustitución por compilación completa |
| M | `frontend/dist/index.html` | frontend/dist/index.html |
| M | `frontend/src/App.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/api/client.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/ai/AIAssistant.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/almacen/InventarioAlmacen.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/almacen/PuntoReordenAlmacen.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/almacen/ReportesAlmacen.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/almacen/TrasladosAlmacen.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/audit/CargosReversasPaciente.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/audit/InventarioVsCargos.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardAseguradorasNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardAuxiliaresNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardComparativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardConsultaExternaNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardCunerosNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardDirectivo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardEficaciaNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardEficienciaNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardFinancieroNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardFinanzasNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardHospitalizacionNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardMapaGeografico.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardQuirofanoNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardSiti.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardSitiAuxiliares.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardSitiCirugias.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardSitiMapa.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardSitiMedicos.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardSitiPacientes.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardUciNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardUrgenciasNativo.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/DashboardVidasSalvadas.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/EmbeddedBI.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/GlobalFilterBar.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/dashboard/ModalDetalleEstadisticas.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/honorarios/HonorariosAuditView.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/layout/Navbar.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/layout/Sidebar.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/mi-area/ConsultaServiceLayer.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/CargosSAP.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/ControlledLedger.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/DevolucionesFarmacia.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/DoctorVariations.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/InventarioFarmacia.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/PatientHistory.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/PendingMonitor.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/PuntoReordenFarmacia.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/ResumenMaestro.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/SurgicalAgenda.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/pharmacy/SurgicalKits.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/quirofano/AlmacenQuirofano.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/shared/EditableKPIWrapper.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/shared/ErrorBoundary.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/shared/EstadoCuentaModal.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/shared/ExportApiModal.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/shared/ExportButton.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/shared/ExportToolbar.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/shared/FacturaProveedorModal.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/shared/KPICard.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/shared/PBIModal.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/components/shared/ReciboIngresoModal.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/context/AuthContext.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/hooks/useKPIConfig.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/AdminAuditoriaLog.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/AdminConfiguracion.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/AdminUsuarios.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/ConsultaExternaPage.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/DashboardArea.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/DataQualityDashboard.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/Estadisticas.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/HomePage.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/LoginPage.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/OcupacionCamas.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/pages/TraceOrder.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/services/cex.service.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/utils/excelInstitutionalGenerator.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/utils/honorariosCalculation.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/utils/honorariosPdfGenerator.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/src/utils/rbac.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| M | `frontend/tests/honorariosCalculation.test.js` | Validación local; no se instala en producción |
| M | `frontend/tests/honorariosView.integration.mjs` | Validación local; no se instala en producción |
| M | `iniciar.bat` | Herramienta de desarrollo; su resultado queda integrado en el pase |
| M | `iniciar_produccion.bat` | iniciar_produccion.bat |
| ?? | `.nvmrc` | .nvmrc |
| ?? | `backend/middleware/publicMessages.middleware.js` | backend/middleware/publicMessages.middleware.js |
| ?? | `backend/scripts/migrate-honorarios.js` | backend/scripts/migrate-honorarios.js |
| ?? | `backend/scripts/start-server.js` | backend/scripts/start-server.js |
| ?? | `backend/services/honorariosCatalog.service.js` | backend/services/honorariosCatalog.service.js |
| ?? | `backend/services/honorariosLiquidation.service.js` | backend/services/honorariosLiquidation.service.js |
| ?? | `backend/services/honorariosSources.service.js` | backend/services/honorariosSources.service.js |
| ?? | `backend/services/honorariosWorkflow.service.js` | backend/services/honorariosWorkflow.service.js |
| ?? | `backend/services/reportAssistant.service.js` | backend/services/reportAssistant.service.js |
| ?? | `backend/services/reportIntent.service.js` | backend/services/reportIntent.service.js |
| ?? | `backend/services/reportLanguage.service.js` | backend/services/reportLanguage.service.js |
| ?? | `backend/services/reportVocabulary.service.js` | backend/services/reportVocabulary.service.js |
| ?? | `backend/services/sapAccountReview.service.js` | backend/services/sapAccountReview.service.js |
| ?? | `backend/services/sapReportCatalog.service.js` | backend/services/sapReportCatalog.service.js |
| ?? | `backend/services/verticalReportCatalog.service.js` | backend/services/verticalReportCatalog.service.js |
| ?? | `backend/tests/backendInstance.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/honorariosCatalog.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/honorariosManagement.pg.integration.cjs` | Validación local; no se instala en producción |
| ?? | `backend/tests/honorariosSources.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/honorariosWorkflow.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/llmClassifier.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/publicMessages.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/reportAssistant.routes.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/reportAssistant.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/reportIntent.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/sapAccountReview.routes.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/sapAccountReview.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/sapQueryBuilder.routes.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/sapQueryBuilder.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/sapReportCatalog.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/sapTransport.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/serverPortConflict.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/startServer.test.js` | Validación local; no se instala en producción |
| ?? | `backend/tests/verticalReportCatalog.test.js` | Validación local; no se instala en producción |
| ?? | `backend/utils/backendInstance.js` | backend/utils/backendInstance.js |
| ?? | `backend/utils/honorariosFiscal.js` | backend/utils/honorariosFiscal.js |
| ?? | `backend/utils/honorariosReviewSource.js` | backend/utils/honorariosReviewSource.js |
| ?? | `backend/utils/honorariosScope.js` | backend/utils/honorariosScope.js |
| ?? | `docs/constructor-reportes-sap-vertical.md` | docs/constructor-reportes-sap-vertical.md |
| ?? | `docs/diagrama-flujo-honorarios.html` | docs/diagrama-flujo-honorarios.html |
| ?? | `docs/exploracion-honorarios-vertical-2026-09-30.md` | docs/exploracion-honorarios-vertical-2026-09-30.md |
| ?? | `docs/implementacion-honorarios-medicos-2026-09-30.md` | docs/implementacion-honorarios-medicos-2026-09-30.md |
| ?? | `docs/lenguaje-de-la-plataforma.md` | docs/lenguaje-de-la-plataforma.md |
| ?? | `docs/propuesta-final-honorarios-medicos-2026-09-30.md` | docs/propuesta-final-honorarios-medicos-2026-09-30.md |
| ?? | `docs/reapertura-cuentas-sap.md` | docs/reapertura-cuentas-sap.md |
| ?? | `docs/revision-pase-2026-10-02.md` | docs/revision-pase-2026-10-02.md |
| ?? | `frontend/src/components/dashboard/AreaIcon.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/dashboard/AreaSwitcher.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/dashboard/DashboardChart.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/dashboard/DashboardMetricCard.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/dashboard/DashboardVisuals.css` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/dashboard/areaColors.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/honorarios/HonorariosCatalogPanel.css` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/honorarios/HonorariosCatalogPanel.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/honorarios/HonorariosLiquidationsPanel.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/honorarios/HonorariosReviewToolbar.css` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/honorarios/HonorariosReviewToolbar.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/mi-area/ConsultaServiceLayer.css` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/mi-area/ReportAssistant.css` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/mi-area/ReportAssistant.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/components/mi-area/ReportBuilderIcon.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/pages/AccountReopeningReview.css` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/pages/AccountReopeningReview.jsx` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/pages/DashboardArea.css` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/utils/honorariosIdentifiers.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/utils/honorariosScope.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/utils/reportQueryPermissions.json` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/src/utils/userMessages.js` | frontend/dist · compilación completa; fuente registrada en MANIFIESTO |
| ?? | `frontend/tests/accountReopening.integration.mjs` | Validación local; no se instala en producción |
| ?? | `frontend/tests/areaDashboards.integration.mjs` | Validación local; no se instala en producción |
| ?? | `frontend/tests/dashboardVisuals.integration.mjs` | Validación local; no se instala en producción |
| ?? | `frontend/tests/honorariosFolios.integration.mjs` | Validación local; no se instala en producción |
| ?? | `frontend/tests/honorariosManagement.integration.mjs` | Validación local; no se instala en producción |
| ?? | `frontend/tests/reportAssistant.integration.mjs` | Validación local; no se instala en producción |
| ?? | `frontend/tests/reportBuilder.integration.mjs` | Validación local; no se instala en producción |
| ?? | `frontend/tests/userMessages.test.js` | Validación local; no se instala en producción |
| ?? | `frontend/tests/userNotices.integration.mjs` | Validación local; no se instala en producción |
| ?? | `instalar_produccion.bat` | instalar.bat |
| ?? | `scripts/initialize-package-data.cjs` | scripts/initialize-package-data.cjs |
| ?? | `scripts/prepare-node-runtime.ps1` | scripts/prepare-node-runtime.ps1 |
| ?? | `scripts/production-package.cjs` | scripts/production-package.cjs |
| ?? | `scripts/production-package.test.cjs` | Validación local; no se instala en producción |
| ?? | `scripts/sync-report-permissions.cjs` | Herramienta de desarrollo; su resultado queda integrado en el pase |
| ?? | `verificar_pase.ps1` | verificar_pase.ps1 |
