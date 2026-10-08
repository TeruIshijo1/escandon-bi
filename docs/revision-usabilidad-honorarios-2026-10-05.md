> Actualización del 5 de octubre: el flujo vigente está en [Optimización de honorarios](revision-optimizacion-honorarios-2026-10-05.md) y en [el manual](instructivo_honorarios.html). Servicios, Pagos y PDF, Configuración; ficha fiscal interna y comprobante total por médico.

# Ajustes de rendimiento y aprobación de honorarios

5 de octubre de 2026.

- El catálogo existente se consulta en BI sin esperar una nueva conexión o sincronización de Vertical. La primera consulta lo inicializa; Buscar servicios nuevos hace la actualización explícita.
- La sincronización escribe el catálogo con una sola operación INSERT/ON CONFLICT dentro de la transacción, conservando configuraciones y tarifas existentes.
- Guardar configuración actualiza únicamente el concepto recibido del servidor. Guardar tarifa recibe también los conteos actualizados de ese concepto.
- Los guardados conservan la lista, búsqueda, filtros y selección. El catálogo permanece montado al cambiar de apartado.
- La carga de tarifas libera el botón Agregar tarifa sin esperar al historial. Se descartan respuestas de selecciones anteriores y se reutiliza el detalle hasta 60 segundos; Actualizar lo consulta de nuevo.
- Aprobar una atención usa médico, cantidad, función y tarifa ya disponibles. El formulario normal sólo pide seleccionar IVA y guardar. Corregir médico o cantidad permite ajustes excepcionales y recalcula automáticamente.
- Guardar la aprobación confirma la realización por declaración del revisor. El servidor conserva ese método en el snapshot; no se inventa una referencia ni se modifica la confirmación clínica de Vertical.
- Se mantienen las validaciones de identidad, fechas, tarifa vigente, revisiones concurrentes, cantidades, cierres y posibles duplicados. El IVA debe elegirse explícitamente en la aprobación directa.
- Aprobar o excluir actualiza la decisión local desde la respuesta del servidor; no vuelve a consultar todo el periodo ni borra los filtros o acordeones.
- SAP se consulta aparte. Los botones de revisión clínica no esperan esa conciliación; los documentos y exportaciones que necesitan los impuestos sí esperan información vigente. Si se reasigna un médico, se consulta y combina su información SAP sin recargar las atenciones.
- El manual HTML y PDF incluyen el formulario simplificado y una nueva captura ficticia. Se conservan las catorce capturas y la descarga directa de PDF.

Validación: pruebas unitarias del backend y frontend; integración de API en esquema PostgreSQL temporal con fuentes ficticias; navegador real con SAP demorado, catálogo sin recargas por guardado, aprobación directa, corrección de médico, revisión conjunta, Excel, cierres, pagos y PDF actualizado. La validación aislada no mide la latencia de la red del servidor de producción.

Los datos de las pruebas del usuario permanecen pendientes de limpieza hasta su aviso de finalización. Ninguna prueba automatizada escribe en Vertical ni altera las tablas BI operativas.

## Revisión sencilla por médico

- La vista normal presenta tarjetas por médico con número de servicios pendientes y aprobados. Solo muestra el botón azul de aprobación y Ver servicios. El botón azul dice Aprobar seleccionados cuando hay casillas marcadas de ese médico; en caso contrario dice Aprobar pendientes. Los importes pendientes de cálculo se identifican con un aviso breve; no se presentan como saldo pagadero.
- El botón azul prioriza los servicios marcados del mismo médico y que cumplen los filtros actuales, en todas sus páginas. El contador cambia al marcar o desmarcar. No agrega los otros pendientes ni la selección de otro médico. Si hay más de 100 seleccionados, se deshabilita y pide reducir la selección.
- Aprobar pendientes abre directamente el formulario de IVA para hasta 100 prestaciones pendientes del médico que cumplen los filtros actuales. No requiere seleccionar cada fila ni usar una barra de acciones aparte. No incorpora aprobados, excluidos, cancelados ni servicios cerrados.
- El formulario calcula los honorarios y muestra médico, número de servicios y total base. Solo requiere elegir el IVA y pulsar Aprobar servicios. Los posibles duplicados conservan la confirmación explícita; IVA distinto requiere grupos separados.
- Ver servicios despliega una lista sencilla con fecha, paciente, servicio, honorario y acciones individuales. Sus casillas permiten seleccionar solo algunos; Detalle abre los folios y la información completa. Los impuestos, notas fiscales y PDF de revisión quedan bajo Ver impuestos y documentos. Las tablas completas se conservan en Más opciones.
- Descargar PDF de aprobados aparece como siguiente acción cuando ya no hay prestaciones seleccionables por aprobar y existen aprobaciones. Si aún hay pendientes, Preparar pago de aprobados sigue disponible dentro de los detalles. Los cierres y las validaciones del PDF para pago siguen siendo responsabilidad del servidor.
- Cada prestación conserva identidad, médico, función, cantidad, tarifa, revisión y auditoría propias. No se modificó el guardado ni sus validaciones del servidor. Cancelar el formulario no guarda aprobaciones.
- El manual HTML y PDF muestran la tarjeta y el formulario compactos, con catorce capturas ficticias. La descarga directa del PDF continúa disponible sin JavaScript.

Validación: 34 pruebas del frontend aprobadas y recorrido completo en navegador real con fuentes ficticias. Se comprobó la aprobación directa de 50 servicios del médico filtrado, sin cancelados, cerrados ni otro médico; cancelar sin guardar; selección opcional de algunos; ausencia de recarga del periodo; dos botones visibles en la tarjeta inicial; pantalla y lista de servicios sin desbordamiento a 320 y 390 píxeles. El mismo recorrido verificó configuración de catálogo, Excel filtrado, cierres, pagos, saldo del PDF y bloqueo cuando cambia el origen. Los datos operativos de las pruebas del usuario no se modificaron.

Validación del botón azul: se marcaron dos de 50 servicios, se desmarcó y volvió a marcar uno y se verificó el contador. El guardado recibió únicamente los dos IDs seleccionados, con el IVA común, dejando sin aprobar los otros 48 y otro médico. Después el botón volvió a Aprobar pendientes (48) y permitió aprobar los restantes. Los 34 tests del frontend y el recorrido completo de catálogo, Excel filtrado, cierres, pagos y PDF pasaron. No se alteraron los datos operativos del usuario.


## Aprobados visibles y descarga directa

- Aprobados y PDF es un apartado visible en la navegación. Conserva periodo y filtros, muestra solo los servicios aprobados y ofrece el PDF junto al médico. El mensaje de aprobación también enlaza a este apartado; cambiar allí no recarga las atenciones.
- El PDF de aprobados filtra por estado dentro del generador, además de validar catálogo, tarifa y médico. Incluye todas las páginas coincidentes. Mantiene sus impuestos desconocidos como PENDIENTE y no presenta ese documento como saldo para pago. Los PDF de revisión mantienen todos los estados coincidentes.
- El cierre recibe médico y periodo desde la tarjeta. El botón Preparar cierre registra la acción y su motivo automático; no se pide motivo ni casilla adicional. Cambiar médico o fechas es opcional. No se realiza ninguna operación al entrar a la pantalla.
- El servidor conserva las validaciones de datos fiscales, fuente, tarifas, revisión concurrente y cierre duplicado. Si no se puede cerrar por datos fiscales, el aviso conserva acceso al PDF de aprobados y remite a Contabilidad; no inventa retenciones ni importes netos.
- El manual principal tiene tres pasos: buscar, aprobar y descargar. Cierre y pagos son instrucciones adicionales para registrar movimientos y obtener saldo. Incluye catorce capturas ficticias.

Validación: recorrido de navegador con APIs simuladas (aprobación individual, dos de 50, restantes 48, acceso sin recarga, PDFs exclusivos de aprobados, pantalla móvil, cierre de un clic, pagos, saldo actualizado, bloqueo por cambios de origen y falta fiscal sin pérdida de aprobaciones); pruebas del generador individual y combinado; 31 pruebas de cálculo, elegibilidad y dinero aprobadas. No se modificaron datos operativos.

En Aprobados y PDF, el resumen principal muestra el número de servicios aprobados, su honorario y el IVA. La falta de información fiscal no convierte visualmente la aprobación en pendiente: el aviso sobre el cálculo neto se presenta aparte. La prueba comprobó tres servicios aprobados y $750 de honorarios con perfil fiscal sin coincidencia.
