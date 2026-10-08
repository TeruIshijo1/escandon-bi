# Revisión final de honorarios y del pase — 2 de octubre de 2026

Esta revisión complementa el primer corte documentado en `revision-pase-2026-10-02.md`. Se volvió a contrastar todo el estado de trabajo para incluir los cambios de backend, frontend y documentación realizados después de ese corte.

## Resultado funcional

- El catálogo mueve automáticamente a **Aprobados** los servicios incluidos, activos y con una tarifa autorizada positiva. Incluir sin tarifa mantiene el servicio pendiente. Quitar la última tarifa o excluir el servicio retira su aprobación.
- La revisión muestra las atenciones de ese catálogo con tarifa aplicable a médico, función y fecha. Una aprobación humana que cambia de beneficiario conserva el médico confirmado. Cambiar una tarifa devuelve la atención a revisión; cambiar la fuente clínica invalida esa atribución.
- Los cambios del catálogo cancelan consultas anteriores e invalidan los resultados en pantalla. Volver a Revisar servicios o usar Ver servicios de este concepto consulta los datos actuales.
- El **PDF para pago** se obtiene desde **Cierres y pagos**. Comprueba el cierre guardado, impuestos, pagos y ajustes, y destaca el saldo pendiente. Los PDF de revisión indican dónde preparar el pago.
- El servidor usa una lectura consistente de cierre, pagos, ajustes y servicios confirmados. Valida centavos, duplicados, referencias, detalle contra cierre, perfil fiscal conservado y cambios clínicos. Una diferencia o imposibilidad de comprobar la fuente bloquea la emisión para pago.
- Los productos tarifa × cantidad usan cálculo decimal exacto y redondeo único. Los pagos y ajustes rechazan más de dos decimales. Los impuestos conservan las reglas y la distribución de centavos utilizada al cerrar.
- Los médicos se separan por identificador. Los cierres anteriores, pagos y ajustes quedan disponibles. El saldo a favor requiere revisión y un cierre pagado muestra cero pendiente.

## Validación final

- Backend: **28 suites / 382 pruebas aprobadas**, sin fallos ni pendientes.
- Frontend: **32 pruebas aprobadas** de cálculo, elegibilidad, mensajes y productos decimales, además de la prueba de paridad de **1,039,896 combinaciones** entre frontend, backend y un oráculo entero independiente.
- Matriz fiscal independiente: IVA 0/8/16 y retención ISR 0/1.25/10, reparto estable de centavos, perfiles incompletos, médicos homónimos y valores extremos. También se compararon 1,035 campos calculados entre frontend y backend.
- API con PostgreSQL real en esquema aislado: catálogo, tarifas, reasignación humana, cierre, pagos, ajustes, duplicados, precisión, reporte READY/PAID/bloqueado y lectura concurrente. El esquema temporal se elimina al terminar.
- Navegador real: alta/baja del catálogo aprobado, revisión por médico, aprobación humana, cierre, pagos y Excel. Un segundo pago registrado con la pantalla abierta se descuenta en el PDF; una atención modificada bloquea su descarga.
- PDF real: saldo pendiente, pagado, varios médicos, cantidades fraccionarias y documentos de varias páginas. **30 inconsistencias** impiden descargar un PDF para pago. Portada y detalle renderizados e inspeccionados visualmente.
- Regresiones: folios en tres vistas, ficha, búsquedas, PDF y Excel; estados, aprobación, SAP no disponible y 12,796 registros ficticios.
- Empaquetado e instalador: **6 pruebas aprobadas**, incluidos archivos ausentes, alterados, dependencias y conservación de configuración e historial.

Las pruebas utilizan datos ficticios. La corrección aritmética depende también de que las tarifas, cantidades, identidad fiscal y pagos previos capturados correspondan a la realidad; esos datos se confirman antes del cierre. El PDF muestra los movimientos registrados hasta su fecha de consulta.

## Cobertura del pase

Se clasificaron **219 archivos modificados o nuevos** del estado completo del proyecto. Cada uno tiene un destino productivo o una exclusión de desarrollo en la tabla siguiente.

El pase se regenera con backend completo y una compilación nueva de frontend. `MANIFIESTO.json` es la referencia final de archivos, tamaños, fuentes y SHA256. La verificación del paquete contrasta ese inventario con las fuentes actuales; no depende de commits.

Se conserva el pase anterior en `tmp/pase-anterior-*`. El paquete conserva la política de no distribuir credenciales ni restaurar bases de datos. Esta preparación local no despliega en SERVIDORCALIDAD.

| Estado | Archivo | Destino o exclusión |
| --- | --- | --- |
| M | `.gitignore` | Herramienta de desarrollo; resultado integrado en el pase |
| M | `GUIA_CONEXION_PRODUCCION_TAILSCALE.md` | GUIA_CONEXION_PRODUCCION_TAILSCALE.md |
| M | `README.md` | README.md |
| M | `README_PRODUCCION.md` | README_PRODUCCION.md |
| M | `backend/.env.example` | backend/.env.example |
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
| M | `backend/tests/auth.routes.test.js` | Prueba local; excluida del runtime |
| M | `backend/tests/export.routes.test.js` | Prueba local; excluida del runtime |
| M | `backend/tests/honorariosCoverage.test.js` | Prueba local; excluida del runtime |
| M | `build_deploy.ps1` | Herramienta de desarrollo; resultado integrado en el pase |
| M | `docs/Backend.md` | docs/Backend.md |
| M | `docs/INSTRUCCIONES_IA.md` | docs/INSTRUCCIONES_IA.md |
| M | `docs/Pase_a_Produccion.md` | docs/Pase_a_Produccion.md |
| M | `docs/README_PRODUCCION.md` | docs/README_PRODUCCION.md |
| D | `frontend/dist/assets/Area-DCVSqhty.js` | Asset anterior retirado al sustituir frontend/dist |
| D | `frontend/dist/assets/BarChart-B6jUwr5R.js` | Asset anterior retirado al sustituir frontend/dist |
| D | `frontend/dist/assets/CartesianChart-B-v2XLsr.js` | Asset anterior retirado al sustituir frontend/dist |
| D | `frontend/dist/assets/ComposedChart-DVp52Pjx.js` | Asset anterior retirado al sustituir frontend/dist |
| D | `frontend/dist/assets/LineChart-C2Snicc_.js` | Asset anterior retirado al sustituir frontend/dist |
| M | `frontend/dist/index.html` | frontend/dist/index.html |
| M | `frontend/src/App.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/api/client.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/ai/AIAssistant.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/almacen/InventarioAlmacen.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/almacen/PuntoReordenAlmacen.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/almacen/ReportesAlmacen.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/almacen/TrasladosAlmacen.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/audit/CargosReversasPaciente.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/audit/InventarioVsCargos.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardAseguradorasNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardAuxiliaresNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardComparativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardConsultaExternaNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardCunerosNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardDirectivo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardEficaciaNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardEficienciaNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardFinancieroNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardFinanzasNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardHospitalizacionNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardMapaGeografico.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardQuirofanoNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardSiti.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardSitiAuxiliares.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardSitiCirugias.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardSitiMapa.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardSitiMedicos.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardSitiPacientes.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardUciNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardUrgenciasNativo.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/DashboardVidasSalvadas.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/EmbeddedBI.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/GlobalFilterBar.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/dashboard/ModalDetalleEstadisticas.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/honorarios/HonorariosAuditView.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/layout/Navbar.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/layout/Sidebar.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/mi-area/ConsultaServiceLayer.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/CargosSAP.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/ControlledLedger.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/DevolucionesFarmacia.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/DoctorVariations.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/InventarioFarmacia.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/PatientHistory.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/PendingMonitor.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/PuntoReordenFarmacia.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/ResumenMaestro.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/SurgicalAgenda.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/pharmacy/SurgicalKits.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/quirofano/AlmacenQuirofano.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/shared/EditableKPIWrapper.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/shared/ErrorBoundary.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/shared/EstadoCuentaModal.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/shared/ExportApiModal.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/shared/ExportButton.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/shared/ExportToolbar.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/shared/FacturaProveedorModal.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/shared/KPICard.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/shared/PBIModal.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/components/shared/ReciboIngresoModal.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/context/AuthContext.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/hooks/useKPIConfig.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/AdminAuditoriaLog.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/AdminConfiguracion.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/AdminUsuarios.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/ConsultaExternaPage.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/DashboardArea.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/DataQualityDashboard.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/Estadisticas.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/HomePage.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/LoginPage.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/OcupacionCamas.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/pages/TraceOrder.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/services/cex.service.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/utils/excelInstitutionalGenerator.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/utils/honorariosCalculation.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/utils/honorariosPdfGenerator.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/src/utils/rbac.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| M | `frontend/tests/honorariosCalculation.test.js` | Prueba local; excluida del runtime |
| M | `frontend/tests/honorariosView.integration.mjs` | Prueba local; excluida del runtime |
| M | `iniciar.bat` | Herramienta de desarrollo; resultado integrado en el pase |
| M | `iniciar_produccion.bat` | iniciar_produccion.bat |
| ?? | `.nvmrc` | .nvmrc |
| ?? | `backend/middleware/publicMessages.middleware.js` | backend/middleware/publicMessages.middleware.js |
| ?? | `backend/scripts/migrate-honorarios.js` | backend/scripts/migrate-honorarios.js |
| ?? | `backend/scripts/start-server.js` | backend/scripts/start-server.js |
| ?? | `backend/services/honorariosCatalog.service.js` | backend/services/honorariosCatalog.service.js |
| ?? | `backend/services/honorariosLiquidation.service.js` | backend/services/honorariosLiquidation.service.js |
| ?? | `backend/services/honorariosPaymentReport.service.js` | backend/services/honorariosPaymentReport.service.js |
| ?? | `backend/services/honorariosSources.service.js` | backend/services/honorariosSources.service.js |
| ?? | `backend/services/honorariosWorkflow.service.js` | backend/services/honorariosWorkflow.service.js |
| ?? | `backend/services/reportAssistant.service.js` | backend/services/reportAssistant.service.js |
| ?? | `backend/services/reportIntent.service.js` | backend/services/reportIntent.service.js |
| ?? | `backend/services/reportLanguage.service.js` | backend/services/reportLanguage.service.js |
| ?? | `backend/services/reportVocabulary.service.js` | backend/services/reportVocabulary.service.js |
| ?? | `backend/services/sapAccountReview.service.js` | backend/services/sapAccountReview.service.js |
| ?? | `backend/services/sapReportCatalog.service.js` | backend/services/sapReportCatalog.service.js |
| ?? | `backend/services/verticalReportCatalog.service.js` | backend/services/verticalReportCatalog.service.js |
| ?? | `backend/tests/backendInstance.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/honorariosCatalog.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/honorariosManagement.pg.integration.cjs` | Prueba local; excluida del runtime |
| ?? | `backend/tests/honorariosPaymentArithmetic.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/honorariosPaymentReport.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/honorariosSources.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/honorariosWorkflow.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/llmClassifier.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/publicMessages.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/reportAssistant.routes.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/reportAssistant.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/reportIntent.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/sapAccountReview.routes.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/sapAccountReview.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/sapQueryBuilder.routes.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/sapQueryBuilder.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/sapReportCatalog.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/sapTransport.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/serverPortConflict.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/startServer.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/tests/verticalReportCatalog.test.js` | Prueba local; excluida del runtime |
| ?? | `backend/utils/backendInstance.js` | backend/utils/backendInstance.js |
| ?? | `backend/utils/honorariosFiscal.js` | backend/utils/honorariosFiscal.js |
| ?? | `backend/utils/honorariosMoney.js` | backend/utils/honorariosMoney.js |
| ?? | `backend/utils/honorariosReviewSource.js` | backend/utils/honorariosReviewSource.js |
| ?? | `backend/utils/honorariosScope.js` | backend/utils/honorariosScope.js |
| ?? | `docs/constructor-reportes-sap-vertical.md` | docs/constructor-reportes-sap-vertical.md |
| ?? | `docs/diagrama-flujo-honorarios.html` | docs/diagrama-flujo-honorarios.html |
| ?? | `docs/exploracion-honorarios-vertical-2026-09-30.md` | docs/exploracion-honorarios-vertical-2026-09-30.md |
| ?? | `docs/honorarios-aprobados-y-pdf-pago.md` | docs/honorarios-aprobados-y-pdf-pago.md |
| ?? | `docs/implementacion-honorarios-medicos-2026-09-30.md` | docs/implementacion-honorarios-medicos-2026-09-30.md |
| ?? | `docs/lenguaje-de-la-plataforma.md` | docs/lenguaje-de-la-plataforma.md |
| ?? | `docs/propuesta-final-honorarios-medicos-2026-09-30.md` | docs/propuesta-final-honorarios-medicos-2026-09-30.md |
| ?? | `docs/reapertura-cuentas-sap.md` | docs/reapertura-cuentas-sap.md |
| ?? | `docs/revision-pase-2026-10-02.md` | docs/revision-pase-2026-10-02.md |
| ?? | `docs/revision-pase-honorarios-2026-10-02.md` | docs/revision-pase-honorarios-2026-10-02.md |
| ?? | `frontend/src/components/dashboard/AreaIcon.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/dashboard/AreaSwitcher.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/dashboard/DashboardChart.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/dashboard/DashboardMetricCard.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/dashboard/DashboardVisuals.css` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/dashboard/areaColors.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/honorarios/HonorariosCatalogPanel.css` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/honorarios/HonorariosCatalogPanel.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/honorarios/HonorariosLiquidationsPanel.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/honorarios/HonorariosReviewToolbar.css` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/honorarios/HonorariosReviewToolbar.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/mi-area/ConsultaServiceLayer.css` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/mi-area/ReportAssistant.css` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/mi-area/ReportAssistant.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/components/mi-area/ReportBuilderIcon.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/pages/AccountReopeningReview.css` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/pages/AccountReopeningReview.jsx` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/pages/DashboardArea.css` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/utils/honorariosEligibility.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/utils/honorariosIdentifiers.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/utils/honorariosMoney.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/utils/honorariosPaymentPdfGenerator.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/utils/honorariosScope.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/utils/reportQueryPermissions.json` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/src/utils/userMessages.js` | frontend/dist: compilación completa y fuente SHA256 en manifiesto |
| ?? | `frontend/tests/accountReopening.integration.mjs` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/areaDashboards.integration.mjs` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/dashboardVisuals.integration.mjs` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/honorariosEligibility.test.js` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/honorariosFolios.integration.mjs` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/honorariosManagement.integration.mjs` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/honorariosMoney.test.js` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/honorariosMoneyParity.test.js` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/honorariosPaymentPdf.integration.mjs` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/honorariosPdfEligibility.integration.mjs` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/reportAssistant.integration.mjs` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/reportBuilder.integration.mjs` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/userMessages.test.js` | Prueba local; excluida del runtime |
| ?? | `frontend/tests/userNotices.integration.mjs` | Prueba local; excluida del runtime |
| ?? | `instalar_produccion.bat` | instalar.bat |
| ?? | `scripts/initialize-package-data.cjs` | scripts/initialize-package-data.cjs |
| ?? | `scripts/prepare-node-runtime.ps1` | scripts/prepare-node-runtime.ps1 |
| ?? | `scripts/production-package.cjs` | scripts/production-package.cjs |
| ?? | `scripts/production-package.test.cjs` | Prueba local; excluida del runtime |
| ?? | `scripts/sync-report-permissions.cjs` | Herramienta de desarrollo; resultado integrado en el pase |
| ?? | `verificar_pase.ps1` | verificar_pase.ps1 |

## Evidencia local

Los resultados de esta revisión quedan en `tmp/honorarios-payment-report-backend-tests.{json,log}`, `tmp/honorarios-payment-report-postgres.log`, `tmp/honorarios-approved-frontend-unit.log`, `tmp/honorarios-money-parity.log`, `tmp/honorarios-approved-management.log`, `tmp/honorarios-payment-pdf.log`, los logs de regresión y `tmp/release-package-tests.log`. Los PDF ficticios y capturas están en `tmp/honorarios-payment-pdf/`. Esos archivos de validación no se distribuyen.

El build y las verificaciones finales quedan en `tmp/release-build.log`, `tmp/release-final-verify.log` y `tmp/release-package-smoke.log`.
