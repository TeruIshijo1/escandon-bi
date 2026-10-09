## Anexo de control: rutas, archivos de pantalla y servicios registrados

Este control se extrajo del código para contrastar la cobertura del instructivo. Una ruta o capacidad declarada no demuestra que tenga registros, permisos o conexión disponibles. Las filas son un índice técnico; las explicaciones funcionales están en los capítulos anteriores.

### Rutas de pantalla (36 rutas explícitas y reglas de redirección)

| Ruta | Evidencia |
|---|---|
| `/` | `frontend/src/App.jsx:144` |
| `/login` | `frontend/src/App.jsx:133` |
| `/sin-acceso` | `frontend/src/App.jsx:134` |
| `/dashboard/directivo` | `frontend/src/App.jsx:148` |
| `/dashboard/ocupacion` | `frontend/src/App.jsx:156` |
| `/siti/dashboard` | `frontend/src/App.jsx:166` |
| `/siti/comparativo` | `frontend/src/App.jsx:174` |
| `/dashboard/area` | `frontend/src/App.jsx:184` |
| `/mi-area/consultas-service-layer` | `frontend/src/App.jsx:192` |
| `/auditoria/inventarios` | `frontend/src/App.jsx:202` |
| `/auditoria/cargos` | `frontend/src/App.jsx:210` |
| `/auditoria/cargos-reversas` | `frontend/src/App.jsx:218` |
| `/farmacia/devoluciones` | `frontend/src/App.jsx:226` |
| `/farmacia/cargos-sap` | `frontend/src/App.jsx:234` |
| `/farmacia/resumen-maestro` | `frontend/src/App.jsx:242` |
| `/farmacia/inventario` | `frontend/src/App.jsx:250` |
| `/farmacia/reorden` | `frontend/src/App.jsx:258` |
| `/quirofano` | `frontend/src/App.jsx:265` |
| `/quirofano/agenda` | `frontend/src/App.jsx:267` |
| `/quirofano/kits` | `frontend/src/App.jsx:275` |
| `/quirofano/variaciones` | `frontend/src/App.jsx:283` |
| `/quirofano/almacen` | `frontend/src/App.jsx:291` |
| `/almacen/inventario` | `frontend/src/App.jsx:299` |
| `/almacen/reorden` | `frontend/src/App.jsx:307` |
| `/almacen/traslados` | `frontend/src/App.jsx:315` |
| `/almacen/reportes` | `frontend/src/App.jsx:323` |
| `/almacen/precios-articulos` | `frontend/src/App.jsx:331` |
| `/interconsultas-jornadas` | `frontend/src/App.jsx:339` |
| `/calidad-datos` | `frontend/src/App.jsx:347` |
| `/rastreo-ordenes` | `frontend/src/App.jsx:355` |
| `/auditoria/reapertura-cuentas` | `frontend/src/App.jsx:363` |
| `/consulta-externa` | `frontend/src/App.jsx:373` |
| `/estadisticas` | `frontend/src/App.jsx:383` |
| `/admin/usuarios` | `frontend/src/App.jsx:394` |
| `/admin/auditoria-log` | `frontend/src/App.jsx:402` |
| `/admin/configuracion` | `frontend/src/App.jsx:410` |
| `*` | `frontend/src/App.jsx:420` |
| `*` | `frontend/src/App.jsx:424` |

### Pantallas y componentes React (96 archivos)

| Archivo | Familia funcional |
|---|---|
| `frontend/src/App.jsx` | Acceso, montaje o contexto |
| `frontend/src/components/ai/AIAssistant.jsx` | ai |
| `frontend/src/components/almacen/InventarioAlmacen.jsx` | almacen |
| `frontend/src/components/almacen/PuntoReordenAlmacen.jsx` | almacen |
| `frontend/src/components/almacen/ReportesAlmacen.jsx` | almacen |
| `frontend/src/components/almacen/TrasladosAlmacen.jsx` | almacen |
| `frontend/src/components/aria/AriaCopilotWidget.jsx` | aria |
| `frontend/src/components/audit/CargosReversasPaciente.jsx` | audit |
| `frontend/src/components/audit/InventarioVsCargos.jsx` | audit |
| `frontend/src/components/dashboard/AreaIcon.jsx` | dashboard |
| `frontend/src/components/dashboard/AreaSwitcher.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardAseguradorasNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardAuxiliaresNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardChart.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardComparativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardConsultaExternaNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardCunerosNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardDirectivo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardEficaciaNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardEficienciaNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardFinancieroNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardFinanzasNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardHospitalizacionNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardMapaGeografico.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardMetricCard.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardNuevoMapa.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardQuirofanoNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardSiti.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardSitiAuxiliares.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardSitiCirugias.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardSitiMapa.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardSitiMedicos.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardSitiPacientes.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardUciNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardUrgenciasNativo.jsx` | dashboard |
| `frontend/src/components/dashboard/DashboardVidasSalvadas.jsx` | dashboard |
| `frontend/src/components/dashboard/EmbeddedBI.jsx` | dashboard |
| `frontend/src/components/dashboard/GlobalFilterBar.jsx` | dashboard |
| `frontend/src/components/dashboard/ModalDetalleEstadisticas.jsx` | dashboard |
| `frontend/src/components/honorarios/HonorariosAuditView.jsx` | honorarios |
| `frontend/src/components/honorarios/HonorariosCatalogPanel.jsx` | honorarios |
| `frontend/src/components/honorarios/HonorariosCoveragePanel.jsx` | honorarios |
| `frontend/src/components/honorarios/HonorariosDoctorReviewCard.jsx` | honorarios |
| `frontend/src/components/honorarios/HonorariosFiscalPanel.jsx` | honorarios |
| `frontend/src/components/honorarios/HonorariosLiquidationsPanel.jsx` | honorarios |
| `frontend/src/components/honorarios/HonorariosMonthlyFixedPanel.jsx` | honorarios |
| `frontend/src/components/honorarios/HonorariosReviewToolbar.jsx` | honorarios |
| `frontend/src/components/honorarios/HonorariosVerticalAuditPanel.jsx` | honorarios |
| `frontend/src/components/layout/AppShell.jsx` | layout |
| `frontend/src/components/layout/HospitalPulse.jsx` | layout |
| `frontend/src/components/layout/Navbar.jsx` | layout |
| `frontend/src/components/layout/ProtectedRoute.jsx` | layout |
| `frontend/src/components/layout/Sidebar.jsx` | layout |
| `frontend/src/components/mi-area/ConsultaServiceLayer.jsx` | mi-area |
| `frontend/src/components/mi-area/ReportAssistant.jsx` | mi-area |
| `frontend/src/components/mi-area/ReportBuilderIcon.jsx` | mi-area |
| `frontend/src/components/pharmacy/CargosSAP.jsx` | pharmacy |
| `frontend/src/components/pharmacy/ControlledLedger.jsx` | pharmacy |
| `frontend/src/components/pharmacy/DevolucionesFarmacia.jsx` | pharmacy |
| `frontend/src/components/pharmacy/DoctorVariations.jsx` | pharmacy |
| `frontend/src/components/pharmacy/InventarioFarmacia.jsx` | pharmacy |
| `frontend/src/components/pharmacy/PatientHistory.jsx` | pharmacy |
| `frontend/src/components/pharmacy/PendingMonitor.jsx` | pharmacy |
| `frontend/src/components/pharmacy/PuntoReordenFarmacia.jsx` | pharmacy |
| `frontend/src/components/pharmacy/ResumenMaestro.jsx` | pharmacy |
| `frontend/src/components/pharmacy/SurgicalAgenda.jsx` | pharmacy |
| `frontend/src/components/pharmacy/SurgicalKits.jsx` | pharmacy |
| `frontend/src/components/quirofano/AlmacenQuirofano.jsx` | quirofano |
| `frontend/src/components/shared/EditableKPIWrapper.jsx` | shared |
| `frontend/src/components/shared/ErrorBoundary.jsx` | shared |
| `frontend/src/components/shared/EstadoCuentaModal.jsx` | shared |
| `frontend/src/components/shared/ExportApiModal.jsx` | shared |
| `frontend/src/components/shared/ExportButton.jsx` | shared |
| `frontend/src/components/shared/ExportToolbar.jsx` | shared |
| `frontend/src/components/shared/FacturaProveedorModal.jsx` | shared |
| `frontend/src/components/shared/KPICard.jsx` | shared |
| `frontend/src/components/shared/PBIModal.jsx` | shared |
| `frontend/src/components/shared/PremiumLoader.jsx` | shared |
| `frontend/src/components/shared/ReciboIngresoModal.jsx` | shared |
| `frontend/src/context/AuthContext.jsx` | Acceso, montaje o contexto |
| `frontend/src/main.jsx` | Acceso, montaje o contexto |
| `frontend/src/pages/AccountReopeningReview.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/AdminAuditoriaLog.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/AdminConfiguracion.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/AdminUsuarios.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/AuditoriaCargos.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/ConsultaExternaPage.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/DashboardArea.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/DataQualityDashboard.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/Estadisticas.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/HomePage.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/LoginPage.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/OcupacionCamas.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/QuirofanoPage.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/SinAcceso.jsx` | Pantalla; revisar su ruta en el índice |
| `frontend/src/pages/TraceOrder.jsx` | Pantalla; revisar su ruta en el índice |

### Operaciones HTTP declaradas (203)

Incluye los 18 archivos de rutas y las operaciones directas del servidor. `statistics.routes.js` se monta dentro de `/api/dashboard`. `/api/files` sirve adjuntos autenticados; no es una pantalla adicional. Las dos rutas comodín son reglas de entrega del frontend.

| Método | Operación | Evidencia |
|---|---|---|
| POST | `/api/admin/upload-json` | `backend/routes/admin.routes.js:42` |
| GET | `/api/admin/usuarios` | `backend/routes/admin.routes.js:57` |
| GET | `/api/admin/usuarios/:id` | `backend/routes/admin.routes.js:92` |
| PUT | `/api/admin/usuarios/:id/permisos` | `backend/routes/admin.routes.js:124` |
| POST | `/api/admin/usuarios` | `backend/routes/admin.routes.js:143` |
| PUT | `/api/admin/usuarios/:id` | `backend/routes/admin.routes.js:206` |
| PUT | `/api/admin/usuarios/:id/password` | `backend/routes/admin.routes.js:258` |
| DELETE | `/api/admin/usuarios/:id` | `backend/routes/admin.routes.js:283` |
| GET | `/api/admin/roles` | `backend/routes/admin.routes.js:308` |
| GET | `/api/admin/audit-logs` | `backend/routes/admin.routes.js:322` |
| GET | `/api/admin/audit-logs/excel` | `backend/routes/admin.routes.js:367` |
| GET | `/api/admin/config-bi` | `backend/routes/admin.routes.js:426` |
| POST | `/api/admin/config-bi` | `backend/routes/admin.routes.js:447` |
| PUT | `/api/admin/config-bi/:id` | `backend/routes/admin.routes.js:467` |
| DELETE | `/api/admin/config-bi/:id` | `backend/routes/admin.routes.js:488` |
| GET | `/api/admin/connectors` | `backend/routes/admin.routes.js:505` |
| POST | `/api/admin/connectors` | `backend/routes/admin.routes.js:514` |
| GET | `/api/admin/connectors/:id/entities` | `backend/routes/admin.routes.js:528` |
| GET | `/api/admin/entities` | `backend/routes/admin.routes.js:536` |
| GET | `/api/admin/metric-mappings` | `backend/routes/admin.routes.js:545` |
| POST | `/api/admin/metric-mappings` | `backend/routes/admin.routes.js:559` |
| GET | `/api/admin/kpi-config` | `backend/routes/admin.routes.js:588` |
| PUT | `/api/admin/kpi-config/:elementoId` | `backend/routes/admin.routes.js:621` |
| POST | `/api/admin/sync-dw-full` | `backend/routes/admin.routes.js:655` |
| POST | `/api/ai/query` | `backend/routes/ai.routes.js:35` |
| GET | `/api/almacen/inventario` | `backend/routes/almacen.routes.js:15` |
| GET | `/api/almacen/ubicaciones` | `backend/routes/almacen.routes.js:41` |
| GET | `/api/almacen/historial-movimientos` | `backend/routes/almacen.routes.js:96` |
| GET | `/api/almacen/traslados` | `backend/routes/almacen.routes.js:132` |
| GET | `/api/almacen/traslados/:id` | `backend/routes/almacen.routes.js:167` |
| GET | `/api/almacen/reportes/kardex` | `backend/routes/almacen.routes.js:210` |
| GET | `/api/almacen/reportes/censo` | `backend/routes/almacen.routes.js:251` |
| GET | `/api/almacen/reportes/entradas` | `backend/routes/almacen.routes.js:278` |
| GET | `/api/almacen/reportes/consumo` | `backend/routes/almacen.routes.js:353` |
| GET | `/api/almacen/reportes/custom-sap` | `backend/routes/almacen.routes.js:420` |
| GET | `/api/almacen/reportes/detalle/kardex/:codigo` | `backend/routes/almacen.routes.js:637` |
| GET | `/api/almacen/reportes/detalle/censo/:cuenta` | `backend/routes/almacen.routes.js:660` |
| GET | `/api/almacen/reportes/detalle/entradas/:numFactura` | `backend/routes/almacen.routes.js:697` |
| GET | `/api/almacen/punto-reorden` | `backend/routes/almacen.routes.js:775` |
| PUT | `/api/almacen/punto-reorden/:code` | `backend/routes/almacen.routes.js:888` |
| GET | `/api/almacen/pedidos-sap` | `backend/routes/almacen.routes.js:939` |
| GET | `/api/almacen/ml-dataset` | `backend/routes/almacen.routes.js:988` |
| POST | `/api/almacen/ml-dataset/sync` | `backend/routes/almacen.routes.js:1029` |
| GET | `/api/almacen/ml-history` | `backend/routes/almacen.routes.js:1044` |
| GET | `/api/almacen/ml-history/download` | `backend/routes/almacen.routes.js:1081` |
| GET | `/api/almacen/ml-model-metrics` | `backend/routes/almacen.routes.js:1135` |
| GET | `/api/almacen/ml-predictions` | `backend/routes/almacen.routes.js:1154` |
| GET | `/api/almacen/ml-predictions/status` | `backend/routes/almacen.routes.js:1185` |
| POST | `/api/almacen/ml-predictions/run` | `backend/routes/almacen.routes.js:1200` |
| POST | `/api/aria/query` | `backend/routes/aria.routes.js:69` |
| GET | `/api/aria/suggestions` | `backend/routes/aria.routes.js:95` |
| GET | `/api/aria/permissions` | `backend/routes/aria.routes.js:116` |
| GET | `/api/audit/inventarios-vs-cargos` | `backend/routes/audit.routes.js:8` |
| GET | `/api/audit/movimientos-paciente` | `backend/routes/audit.routes.js:26` |
| POST | `/api/auth/login` | `backend/routes/auth.routes.js:17` |
| GET | `/api/auth/me` | `backend/routes/auth.routes.js:86` |
| POST | `/api/auth/logout` | `backend/routes/auth.routes.js:116` |
| GET | `/api/bi/available-reports` | `backend/routes/bi.routes.js:21` |
| GET | `/api/bi/token/:reportId` | `backend/routes/bi.routes.js:42` |
| POST | `/api/cex/sync` | `backend/routes/cex.routes.js:18` |
| GET | `/api/cex/agenda` | `backend/routes/cex.routes.js:45` |
| GET | `/api/cex/pacientes` | `backend/routes/cex.routes.js:122` |
| POST | `/api/cex/citas` | `backend/routes/cex.routes.js:146` |
| PATCH | `/api/cex/citas/:id/estado` | `backend/routes/cex.routes.js:187` |
| PATCH | `/api/cex/citas/:id/notas` | `backend/routes/cex.routes.js:225` |
| POST | `/api/cex/consultas` | `backend/routes/cex.routes.js:249` |
| GET | `/api/cex/reportes` | `backend/routes/cex.routes.js:281` |
| GET | `/api/cex/consulta-dia` | `backend/routes/cex.routes.js:309` |
| GET | `/api/cex/consultas-programadas` | `backend/routes/cex.routes.js:342` |
| GET | `/api/dashboard/directivo` | `backend/routes/dashboard.routes.js:133` |
| GET | `/api/dashboard/area/:area` | `backend/routes/dashboard.routes.js:251` |
| GET | `/api/dashboard/kpi-config` | `backend/routes/dashboard.routes.js:358` |
| GET | `/api/dashboard/financiero-nativo/cuenta/:pcNum` | `backend/routes/dashboard.routes.js:395` |
| GET | `/api/dashboard/financiero-nativo` | `backend/routes/dashboard.routes.js:499` |
| GET | `/api/dashboard/eficiencia-nativo` | `backend/routes/dashboard.routes.js:856` |
| GET | `/api/dashboard/censo-camas` | `backend/routes/dashboard.routes.js:948` |
| GET | `/api/dashboard/urgencias-nativo` | `backend/routes/dashboard.routes.js:1040` |
| GET | `/api/dashboard/eficacia-nativo` | `backend/routes/dashboard.routes.js:1365` |
| GET | `/api/dashboard/filtros-eficacia` | `backend/routes/dashboard.routes.js:1636` |
| GET | `/api/dashboard/quirofano-nativo` | `backend/routes/dashboard.routes.js:1666` |
| GET | `/api/dashboard/export-excel` | `backend/routes/dashboard.routes.js:1876` |
| GET | `/api/dashboard/auxiliares-nativo/:tipo` | `backend/routes/dashboard.routes.js:2175` |
| GET | `/api/dashboard/cuneros-nativo` | `backend/routes/dashboard.routes.js:2347` |
| GET | `/api/dashboard/uci-nativo` | `backend/routes/dashboard.routes.js:2623` |
| GET | `/api/dashboard/cuenta-detalle/:folio` | `backend/routes/dashboard.routes.js:2862` |
| GET | `/api/dashboard/geografia` | `backend/routes/dashboard.routes.js:2886` |
| GET | `/api/dashboard/sap/vidas-salvadas` | `backend/routes/dashboard.routes.js:2924` |
| GET | `/api/dashboard/sap/vidas-salvadas/:atencion/detalle` | `backend/routes/dashboard.routes.js:2962` |
| GET | `/api/dashboard/consulta-externa-nativo` | `backend/routes/dashboard.routes.js:3048` |
| GET | `/api/dashboard/aseguradoras-nativo` | `backend/routes/dashboard.routes.js:3225` |
| GET | `/api/dashboard/finanzas-nativo` | `backend/routes/dashboard.routes.js:3372` |
| GET | `/api/dashboard/finanzas-nativo/factura/:docNum` | `backend/routes/dashboard.routes.js:3570` |
| GET | `/api/dashboard/finanzas-nativo/ingreso/:docNum` | `backend/routes/dashboard.routes.js:3616` |
| GET | `/api/dashboard/hospitalizacion-nativo` | `backend/routes/dashboard.routes.js:3690` |
| POST | `/api/data-quality/scan` | `backend/routes/dataQuality.routes.js:15` |
| GET | `/api/data-quality/stats` | `backend/routes/dataQuality.routes.js:27` |
| GET | `/api/data-quality/issues` | `backend/routes/dataQuality.routes.js:41` |
| POST | `/api/data-quality/issues/:id/resolve` | `backend/routes/dataQuality.routes.js:54` |
| POST | `/api/data-quality/inspect` | `backend/routes/dataQuality.routes.js:74` |
| GET | `/api/export/json-to-excel/:type/:id` | `backend/routes/export.routes.js:310` |
| GET | `/api/export/excel/:reportId` | `backend/routes/export.routes.js:325` |
| GET | `/api/export/pdf/:reportId` | `backend/routes/export.routes.js:422` |
| POST | `/api/export/convert-json` | `backend/routes/export.routes.js:958` |
| GET | `/api/finanzas/ml-forecast` | `backend/routes/finanzas.routes.js:11` |
| GET | `/api/finanzas/ml-forecast/status` | `backend/routes/finanzas.routes.js:65` |
| POST | `/api/finanzas/ml-forecast/run` | `backend/routes/finanzas.routes.js:77` |
| GET | `/api/honorarios/vertical-audit/options` | `backend/routes/honorarios.routes.js:41` |
| GET | `/api/honorarios/vertical-audit` | `backend/routes/honorarios.routes.js:53` |
| GET | `/api/honorarios/vertical-audit/excel` | `backend/routes/honorarios.routes.js:65` |
| GET | `/api/honorarios/reviews` | `backend/routes/honorarios.routes.js:81` |
| PUT | `/api/honorarios/reviews` | `backend/routes/honorarios.routes.js:94` |
| POST | `/api/honorarios/reviews/bulk-preview` | `backend/routes/honorarios.routes.js:127` |
| POST | `/api/honorarios/reviews/bulk` | `backend/routes/honorarios.routes.js:144` |
| GET | `/api/honorarios/catalog` | `backend/routes/honorarios.routes.js:160` |
| GET | `/api/honorarios/catalog/export-data` | `backend/routes/honorarios.routes.js:170` |
| POST | `/api/honorarios/catalog/sync` | `backend/routes/honorarios.routes.js:174` |
| PUT | `/api/honorarios/catalog/:itemCode` | `backend/routes/honorarios.routes.js:178` |
| GET | `/api/honorarios/catalog/:itemCode/tariffs` | `backend/routes/honorarios.routes.js:179` |
| POST | `/api/honorarios/catalog/:itemCode/tariffs` | `backend/routes/honorarios.routes.js:180` |
| GET | `/api/honorarios/catalog/:itemCode/history` | `backend/routes/honorarios.routes.js:184` |
| GET | `/api/honorarios/providers` | `backend/routes/honorarios.routes.js:185` |
| GET | `/api/honorarios/monthly-fixed` | `backend/routes/honorarios.routes.js:186` |
| POST | `/api/honorarios/monthly-fixed` | `backend/routes/honorarios.routes.js:187` |
| PUT | `/api/honorarios/monthly-fixed/:id` | `backend/routes/honorarios.routes.js:189` |
| GET | `/api/honorarios/fiscal-profiles` | `backend/routes/honorarios.routes.js:191` |
| GET | `/api/honorarios/fiscal-directory` | `backend/routes/honorarios.routes.js:192` |
| PUT | `/api/honorarios/fiscal-profiles/:providerId` | `backend/routes/honorarios.routes.js:194` |
| GET | `/api/honorarios/fiscal-profiles/:providerId/history` | `backend/routes/honorarios.routes.js:199` |
| POST | `/api/honorarios/approval-preview` | `backend/routes/honorarios.routes.js:200` |
| GET | `/api/honorarios/audit` | `backend/routes/honorarios.routes.js:205` |
| GET | `/api/honorarios/liquidations` | `backend/routes/honorarios.routes.js:213` |
| POST | `/api/honorarios/available-payment-report` | `backend/routes/honorarios.routes.js:214` |
| POST | `/api/honorarios/liquidations` | `backend/routes/honorarios.routes.js:218` |
| GET | `/api/honorarios/liquidations/:id` | `backend/routes/honorarios.routes.js:219` |
| GET | `/api/honorarios/liquidations/:id/payment-report` | `backend/routes/honorarios.routes.js:220` |
| POST | `/api/honorarios/liquidations/:id/check` | `backend/routes/honorarios.routes.js:221` |
| POST | `/api/honorarios/liquidations/:id/provider-payment` | `backend/routes/honorarios.routes.js:226` |
| POST | `/api/honorarios/liquidations/:id/payments` | `backend/routes/honorarios.routes.js:227` |
| POST | `/api/honorarios/liquidations/:id/adjustments` | `backend/routes/honorarios.routes.js:228` |
| POST | `/api/honorarios/sap-reconciliation` | `backend/routes/honorarios.routes.js:235` |
| GET | `/api/honorarios/audit-vertical` | `backend/routes/honorarios.routes.js:266` |
| GET | `/api/pharmacy/devoluciones` | `backend/routes/pharmacy.routes.js:11` |
| GET | `/api/pharmacy/cargos-sap` | `backend/routes/pharmacy.routes.js:22` |
| GET | `/api/pharmacy/master-outputs` | `backend/routes/pharmacy.routes.js:33` |
| GET | `/api/pharmacy/inventario` | `backend/routes/pharmacy.routes.js:121` |
| GET | `/api/pharmacy/lotes` | `backend/routes/pharmacy.routes.js:147` |
| GET | `/api/pharmacy/historial-lotes` | `backend/routes/pharmacy.routes.js:175` |
| GET | `/api/pharmacy/ubicaciones` | `backend/routes/pharmacy.routes.js:223` |
| GET | `/api/pharmacy/salidas-farmacia` | `backend/routes/pharmacy.routes.js:346` |
| GET | `/api/pharmacy/controlled-ledger` | `backend/routes/pharmacy.routes.js:347` |
| GET | `/api/pharmacy/pending-prescriptions` | `backend/routes/pharmacy.routes.js:418` |
| POST | `/api/pharmacy/pending-prescriptions/hide/:id` | `backend/routes/pharmacy.routes.js:493` |
| GET | `/api/pharmacy/patient-history/:search` | `backend/routes/pharmacy.routes.js:507` |
| GET | `/api/pharmacy/surgical-kits` | `backend/routes/pharmacy.routes.js:551` |
| GET | `/api/pharmacy/surgical-events` | `backend/routes/pharmacy.routes.js:574` |
| GET | `/api/pharmacy/doctor-variations` | `backend/routes/pharmacy.routes.js:619` |
| GET | `/api/pharmacy/quirofano-inventory` | `backend/routes/pharmacy.routes.js:678` |
| GET | `/api/pharmacy/quirofano-movements` | `backend/routes/pharmacy.routes.js:730` |
| GET | `/api/pharmacy/punto-reorden` | `backend/routes/pharmacy.routes.js:854` |
| PUT | `/api/pharmacy/punto-reorden/:code` | `backend/routes/pharmacy.routes.js:1033` |
| GET | `/api/pharmacy/pedidos-sap` | `backend/routes/pharmacy.routes.js:1085` |
| GET | `/api/pharmacy/ml-dataset` | `backend/routes/pharmacy.routes.js:1143` |
| POST | `/api/pharmacy/ml-dataset/sync` | `backend/routes/pharmacy.routes.js:1224` |
| GET | `/api/pharmacy/ml-history` | `backend/routes/pharmacy.routes.js:1240` |
| GET | `/api/pharmacy/ml-history/download` | `backend/routes/pharmacy.routes.js:1282` |
| GET | `/api/pharmacy/ml-predictions` | `backend/routes/pharmacy.routes.js:1337` |
| GET | `/api/pharmacy/ml-predictions/status` | `backend/routes/pharmacy.routes.js:1373` |
| POST | `/api/pharmacy/ml-predictions/run` | `backend/routes/pharmacy.routes.js:1389` |
| GET | `/api/pharmacy/config-dinamica` | `backend/routes/pharmacy.routes.js:1438` |
| GET | `/api/pharmacy/config-dinamica/search-sap` | `backend/routes/pharmacy.routes.js:1453` |
| POST | `/api/pharmacy/config-dinamica/link` | `backend/routes/pharmacy.routes.js:1468` |
| POST | `/api/pharmacy/config-dinamica/apply` | `backend/routes/pharmacy.routes.js:1487` |
| POST | `/api/pharmacy/config-dinamica/upload` | `backend/routes/pharmacy.routes.js:1537` |
| GET | `/api/sap/account-review/search` | `backend/routes/sap.routes.js:22` |
| GET | `/api/sap/account-review/:account` | `backend/routes/sap.routes.js:40` |
| GET | `/api/sap/ping` | `backend/routes/sap.routes.js:64` |
| GET | `/api/sap/warehouses` | `backend/routes/sap.routes.js:89` |
| GET | `/api/sap/trace-order/:docNum` | `backend/routes/sap.routes.js:109` |
| GET | `/api/sap-query/catalog` | `backend/routes/sapQueryBuilder.routes.js:33` |
| POST | `/api/sap-query/assistant` | `backend/routes/sapQueryBuilder.routes.js:46` |
| POST | `/api/sap-query/execute` | `backend/routes/sapQueryBuilder.routes.js:65` |
| GET | `/api/sap-query/saved` | `backend/routes/sapQueryBuilder.routes.js:102` |
| GET | `/api/sap-query/saved/access` | `backend/routes/sapQueryBuilder.routes.js:114` |
| GET | `/api/sap-query/saved/recipients` | `backend/routes/sapQueryBuilder.routes.js:124` |
| PUT | `/api/sap-query/saved/:id/assignments` | `backend/routes/sapQueryBuilder.routes.js:133` |
| POST | `/api/sap-query/saved` | `backend/routes/sapQueryBuilder.routes.js:144` |
| DELETE | `/api/sap-query/saved/:id` | `backend/routes/sapQueryBuilder.routes.js:169` |
| GET | `/api/siti/financiero` | `backend/routes/siti.routes.js:19` |
| GET | `/api/siti/pacientes` | `backend/routes/siti.routes.js:69` |
| GET | `/api/siti/cirugias` | `backend/routes/siti.routes.js:115` |
| GET | `/api/siti/auxiliares/:tipo` | `backend/routes/siti.routes.js:180` |
| GET | `/api/siti/pacientes-demografia` | `backend/routes/siti.routes.js:352` |
| GET | `/api/siti/medicos` | `backend/routes/siti.routes.js:416` |
| GET | `/api/siti/demografia` | `backend/routes/siti.routes.js:464` |
| GET | `/api/siti/imagen-detalle` | `backend/routes/siti.routes.js:1183` |
| GET | `/api/dashboard/stats` | `backend/routes/statistics.routes.js:41` |
| GET | `/api/dashboard/stats-historico` | `backend/routes/statistics.routes.js:47` |
| GET | `/api/dashboard/stats-detalle` | `backend/routes/statistics.routes.js:52` |
| GET | `/api/dashboard/stats-export` | `backend/routes/statistics.routes.js:68` |
| GET | `/api/ping` | `backend/server.js:122` |
| POST | `/upload-assets` | `backend/server.js:145` |
| GET | `*` | `backend/server.js:197` |
| GET | `/health` | `backend/server.js:228` |

### Identificadores iniciales de KPI configurables (44)

Son identificadores de configuración de nombre, icono y enlace; su presencia no prueba que el indicador se renderice en la pantalla actual ni que el reporte externo esté configurado. El usuario puede consultar los elementos registrados en Administración → Configuración. Cada KPI nativo y su cálculo se explican en el capítulo de tableros.

| Identificador | Declaración inicial |
|---|---|
| `stats.egresos_total` | `database/04_kpi_config.sql:26` |
| `stats.promedio_edad` | `database/04_kpi_config.sql:27` |
| `stats.genero_femenino` | `database/04_kpi_config.sql:28` |
| `stats.defunciones` | `database/04_kpi_config.sql:29` |
| `stats.nacimientos` | `database/04_kpi_config.sql:30` |
| `stats.estancia_global` | `database/04_kpi_config.sql:31` |
| `stats.top_diagnosticos` | `database/04_kpi_config.sql:32` |
| `stats.egresos_servicio` | `database/04_kpi_config.sql:33` |
| `area.quirofano.ocupacion` | `database/04_kpi_config.sql:38` |
| `area.quirofano.egresos` | `database/04_kpi_config.sql:39` |
| `area.quirofano.estancia` | `database/04_kpi_config.sql:40` |
| `area.quirofano.rotacion_camas` | `database/04_kpi_config.sql:41` |
| `area.uci.ocupacion` | `database/04_kpi_config.sql:43` |
| `area.uci.egresos` | `database/04_kpi_config.sql:44` |
| `area.uci.estancia` | `database/04_kpi_config.sql:45` |
| `area.uci.rotacion_camas` | `database/04_kpi_config.sql:46` |
| `area.urgencias.ocupacion` | `database/04_kpi_config.sql:48` |
| `area.urgencias.egresos` | `database/04_kpi_config.sql:49` |
| `area.urgencias.estancia` | `database/04_kpi_config.sql:50` |
| `area.urgencias.rotacion_camas` | `database/04_kpi_config.sql:51` |
| `area.cuneros.ocupacion` | `database/04_kpi_config.sql:53` |
| `area.cuneros.egresos` | `database/04_kpi_config.sql:54` |
| `area.cuneros.estancia` | `database/04_kpi_config.sql:55` |
| `area.cuneros.rotacion_camas` | `database/04_kpi_config.sql:56` |
| `area.imagenologia.ocupacion` | `database/04_kpi_config.sql:58` |
| `area.imagenologia.egresos` | `database/04_kpi_config.sql:59` |
| `area.imagenologia.estancia` | `database/04_kpi_config.sql:60` |
| `area.imagenologia.rotacion_camas` | `database/04_kpi_config.sql:61` |
| `area.laboratorio.ocupacion` | `database/04_kpi_config.sql:63` |
| `area.laboratorio.egresos` | `database/04_kpi_config.sql:64` |
| `area.laboratorio.estancia` | `database/04_kpi_config.sql:65` |
| `area.laboratorio.rotacion_camas` | `database/04_kpi_config.sql:66` |
| `area.consulta_externa.ocupacion` | `database/04_kpi_config.sql:68` |
| `area.consulta_externa.egresos` | `database/04_kpi_config.sql:69` |
| `area.consulta_externa.estancia` | `database/04_kpi_config.sql:70` |
| `area.consulta_externa.rotacion_camas` | `database/04_kpi_config.sql:71` |
| `area.cardiologia.ocupacion` | `database/04_kpi_config.sql:73` |
| `area.cardiologia.egresos` | `database/04_kpi_config.sql:74` |
| `area.cardiologia.estancia` | `database/04_kpi_config.sql:75` |
| `area.cardiologia.rotacion_camas` | `database/04_kpi_config.sql:76` |
| `area.hospitalizacion.ocupacion` | `database/04_kpi_config.sql:78` |
| `area.hospitalizacion.egresos` | `database/04_kpi_config.sql:79` |
| `area.hospitalizacion.estancia` | `database/04_kpi_config.sql:80` |
| `area.hospitalizacion.rotacion_camas` | `database/04_kpi_config.sql:81` |
