# Honorarios: IVA, ficha fiscal interna y proceso de pago

- Navegación: Servicios, Pagos y PDF, Configuración. Catálogo y fichas fiscales dentro de Configuración.
- IVA confirmado visible con su tasa, incluso en servicios congelados. IVA y retención separados en PDF. Nombres normalizados para la fuente del PDF.
- Ficha fiscal interna por ID clínico, RFC, régimen capturado, vigencia, ISR y retención IVA explícitos. IVA habitual propuesto al aprobar, sin alterar IVA ya aprobado. SAP es alternativa cuando no hay ficha activa.
- Guardas en PostgreSQL de BI con revisión optimista, bloqueo por médico, historial y responsable. No escribe SAP ni Vertical. No inventa RFC, régimen ni tratamiento fiscal.
- Preparar pago y PDF abre un médico; Generar PDF para pago guarda su cálculo y descarga el reporte validado. Los datos y centavos originales se conservan. Consultas de pagos preparados no escriben cierres.
- Comprobante por médico: importe total distribuido en centavos sobre saldos abiertos; transacción, rechazo de duplicados y sobrepagos. Ajustes y pagos individuales quedan opcionales.
- Migración aditiva: bi_honorarios_fiscal_profiles y bi_honorarios_fiscal_profile_history. Preparación automática al consultar o script backend/scripts/migrate-honorarios.js. Conserva esquemas y datos existentes.
- Pruebas: API con PostgreSQL aislado, SAP/Vertical sintéticos, 50 aprobaciones con IVA 16%, cierre interno, comprobante total, conflictos/historial y congelación después de editar la ficha. Navegador con recorrido completo, capturas, móvil 320/390, PDF bloqueado ante cambios clínicos y Excel filtrado. No se guardan pruebas en tablas operativas.
