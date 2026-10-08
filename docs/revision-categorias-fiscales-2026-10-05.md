# Categorías fiscales de médicos

Configuración → Datos fiscales: Por completar, Listos con SAP y Configurados internamente, con conteos, búsqueda y Ver todos. La clasificación utiliza la fecha Desde del periodo. Una ficha activa con vigencia posterior aparece por completar para ese periodo.

SAP listo exige que la configuración permita servicios con y sin IVA usando las mismas reglas del cálculo de honorarios. Una configuración válida solo sin IVA queda por completar, con explicación. Un régimen no informado por SAP no bloquea un cálculo que ya permite el motor, pero debe confirmarse al guardar una ficha interna.

Consulta exclusiva de maestros SAP, paginación estricta, caché de cinco minutos y botón Actualizar SAP. No descarga facturas ni pagos para clasificar. Las coincidencias múltiples, médicos que comparten proveedor y nombres incompletos no precargan identidades. La indisponibilidad de SAP se informa y no presenta datos antiguos como verificados.

RFC, régimen y retenciones disponibles se precargan para una coincidencia única. No se infiere IVA habitual ni vigencia del médico; una retención de IVA ausente queda vacía, nunca cero. Guardar usa la ficha interna por ID clínico con revisión optimista, responsable e historial. No hay escrituras en SAP ni Vertical. Copiar de SAP prepara una edición, no la guarda automáticamente. Refrescar SAP conserva la captura y la revisión original de guardado. Desactivar la ficha vuelve a SAP si sus datos permiten el cálculo. Los pagos preparados conservan sus importes y perfil fiscal congelado.

Verificación real del 5 de octubre: 266 médicos, 687 proveedores; 12 con cálculo SAP con/sin IVA, 155 únicamente sin IVA, 8 coincidencias ambiguas y 89 sin coincidencia. Estos conteos son de la consulta para 1 de octubre de 2026 y pueden cambiar con la configuración.

Validación: 56 pruebas unitarias de directorio fiscal, conciliación SAP, cálculo, revisión y reporte de pago. Navegador con grupos/conteos, SAP parcial/completo/ambiguo, precarga y edición, actualización sin perder captura, desactivación e historial, conflicto de guardado, vigencia futura, SAP indisponible y móvil 320/390/768. Recorrido completo de aprobación, pago y PDF, PostgreSQL en esquema temporal aislado y exportación Excel filtrada. Las pruebas no guardan registros en tablas operativas.
