> Actualización del 5 de octubre: el flujo vigente está en [Optimización de honorarios](revision-optimizacion-honorarios-2026-10-05.md) y en [el manual](instructivo_honorarios.html). Servicios, Pagos y PDF, Configuración; ficha fiscal interna y comprobante total por médico.

# Honorarios: servicios aprobados y PDF para pago

Actualización del 7 de octubre de 2026.

## Flujo de trabajo

1. En **Catálogo y precios**, incluye el servicio y guarda su tarifa autorizada. Los servicios completos muestran **Configurados** en verde. Si falta una tarifa, mantienen el aviso pendiente. Si ya está configurado, comienza directamente en Servicios.
2. En **Revisar servicios**, el botón azul aprueba los marcados del médico o sus pendientes si no hay selección. Elige una vez el IVA. Corregir médico o cantidad es opcional; se conserva la confirmación de prestación, auditoría y validación de duplicados.
3. Al guardar, los servicios aprobados aparecen en **Aprobados** y **Pagos y PDF**, y dejan de aparecer en **Por revisar** y **Aprobar pendientes**. La aprobación se conserva al volver a consultar. En **Todos** permanecen como historial y no pueden volver a seleccionarse o aprobarse. Para corregir una decisión abierta se conservan **Excluir** y **Devolver a revisión**.
4. En **Pagos y PDF**, consulta los aprobados y elige **Descargar PDF detallado** o **Descargar PDF resumido** junto al médico. Ambas versiones respetan periodo, búsqueda, grupo y médico, incluyen todas las páginas y excluyen pendientes y rechazados. El detallado agrega pacientes y folios; el resumido agrupa servicios e importes. No requieren cierre ni un perfil fiscal completo; los importes fiscales no determinados se identifican como pendientes. En Servicios también aparecen ambas descargas cuando el médico tiene aprobados y ya no tiene pendientes seleccionables.

Si la consulta no puede recuperar las decisiones guardadas, pulsa **Reintentar consulta**. Hasta recuperar su estado, no se presenta una lista de pendientes ni se permite aprobar esos servicios.

Para conservar el neto y registrar pagos, abre **Ver servicios → Ver impuestos y documentos → Preparar pago de aprobados**. Médico y fechas ya vienen seleccionados. **Preparar cierre** guarda con motivo automático e intención explícita del botón, sujeto a las validaciones fiscales y de concurrencia del servidor. No hay guardado al navegar ni se pide motivo o casilla adicional. Cambiar médico o fechas es opcional.

Registra los pagos ya realizados y sus comprobantes, así como los ajustes que correspondan. Los pagos de otras herramientas deben estar aplicados a los servicios del cierre para descontarse. **Descargar PDF para pago** vuelve a consultar los movimientos, comprueba el cálculo y muestra el saldo pendiente. Si faltan datos fiscales, Contabilidad los completa; el PDF de aprobados permanece accesible.

Las descargas del menú **Exportar** de **Servicios** conservan el contexto de la revisión. Los dos botones junto al médico contienen solo aprobados. El documento que descuenta los pagos registrados se obtiene con **Preparar pago y PDF**, y después **Descargar PDF para pago**.

## Qué contiene el PDF para pago

- Número de cierre, periodo, médico e identificador, fecha de consulta y responsable del cierre.
- Servicios, referencias de atención/cita/orden, cantidad, tarifa, honorarios, IVA, ISR, retención de IVA y neto.
- Pagos y ajustes registrados con sus referencias, separados por médico.
- Saldo pendiente: **neto del cierre + ajustes − pagos registrados**. Un cierre totalmente pagado muestra cero pendiente.

Los impuestos usan las reglas y datos fiscales conservados al cerrar, confirmados por el responsable. La validación comprueba que esas reglas se hayan aplicado y sumado correctamente; no sustituye la confirmación de que los datos fiscales del médico sean correctos.

## Comprobaciones antes de emitir

El servidor lee el cierre, los pagos y los ajustes en una misma lectura consistente. Comprueba cantidades, precios, impuestos, redondeos, netos, sumas por médico y saldo en centavos. Conserva la distribución de centavos de las retenciones entre servicios del mismo grupo fiscal.

Una diferencia de importes, un servicio duplicado, un movimiento sin servicio asociado o información incompleta impide generar el PDF para pago. También se detiene la emisión si cambió la fuente clínica, no pudo comprobarse o existe un saldo negativo que necesita revisión. La pantalla explica qué debe revisarse.

Los médicos se separan por identificador, incluso cuando tienen el mismo nombre. El documento lleva fecha de consulta: un pago o ajuste registrado después requiere volver a generar el PDF. Descargarlo no registra ni realiza una transferencia.

## Inclusión en el pase

La actualización requiere copiar el backend y el frontend completos del pase. Utiliza las estructuras existentes de honorarios; conserva el catálogo, tarifas, aprobaciones, cierres y pagos guardados. La comprobación de la fuente clínica necesita la conexión a Vertical disponible. La generación del PDF no envía información al proveedor de IA.
