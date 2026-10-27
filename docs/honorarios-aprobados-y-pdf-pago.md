> Actualización del 5 de octubre: el flujo vigente está en [el manual](instructivo_honorarios.html). La nota Optimización de honorarios se conserva en el expediente técnico del proyecto como [revision-optimizacion-honorarios-2026-10-05.md](../../historial/pases-anteriores/documentacion/5cc6f26ab9b5e4009c50b8ffdac57d557ab1cb7797f003db464bd8e79f710063/revision-optimizacion-honorarios-2026-10-05.md). Servicios, Pagos y PDF, Configuración; ficha fiscal interna y comprobante total por médico.

# Honorarios: servicios aprobados y PDF para pago

Actualización del 8 de octubre de 2026.

## Flujo de trabajo

1. En **Catálogo y precios**, incluye el servicio y guarda su tarifa autorizada. Los servicios completos muestran **Configurados** en verde. Si falta una tarifa, mantienen el aviso pendiente. Si ya está configurado, comienza directamente en Servicios.
2. En **Revisar servicios**, el botón azul aprueba los marcados del médico o sus pendientes si no hay selección. Elige una vez el IVA. Corregir médico o cantidad es opcional; se conserva la confirmación de prestación, auditoría y validación de duplicados.
3. Al guardar, los servicios aprobados aparecen en **Aprobados** y **Pagos y PDF**, y dejan de aparecer en **Por revisar** y **Aprobar pendientes**. La aprobación se conserva al volver a consultar. En **Todos** permanecen como historial y no pueden volver a seleccionarse o aprobarse. Para corregir una decisión abierta se conservan **Excluir** y **Devolver a revisión**.
4. En **Pagos y PDF**, consulta los aprobados y elige **Descargar PDF detallado** o **Descargar PDF resumido** junto al médico. Ambas versiones respetan periodo, búsqueda, grupo y médico, incluyen todas las páginas y excluyen pendientes y rechazados. El detallado agrega pacientes y folios; el resumido agrupa servicios e importes. No requieren cierre ni un perfil fiscal completo; los importes fiscales no determinados se identifican como pendientes. En Servicios también aparecen ambas descargas cuando el médico tiene aprobados y ya no tiene pendientes seleccionables.

Si la consulta no puede recuperar las decisiones guardadas, pulsa **Reintentar consulta**. Hasta recuperar su estado, no se presenta una lista de pendientes ni se permite aprobar esos servicios.

Abre **Ver servicios → Ver impuestos y documentos → Preparar pago de aprobados**. Médico y fechas ya vienen seleccionados. **Generar PDF para pago** comprueba los servicios aprobados del periodo actual sin esperar a SAP. Si falta la ficha fiscal interna, descarga el PDF con los datos disponibles y marca como pendientes las retenciones y el neto que no puedan calcularse. No crea un pago preparado ni cambia las aprobaciones; puedes completar la ficha después. Cambiar médico o fechas es opcional y consulta las aprobaciones de la nueva selección.

Con ficha interna completa y aplicable, el botón prepara el pago y descarga su PDF. Si el médico está configurado en SAP, después del PDF disponible abre **Opciones del pago → Preparar pago con datos de SAP**. Esa preparación conserva las validaciones fiscales y de concurrencia. No hay guardado al navegar ni se pide motivo o casilla adicional.

En un pago preparado, registra los pagos ya realizados y sus comprobantes, así como los ajustes que correspondan. Los pagos de otras herramientas deben estar aplicados a los servicios del cierre para descontarse. **Descargar PDF para pago** vuelve a consultar los movimientos, comprueba el cálculo y muestra el saldo pendiente. El PDF de aprobaciones abiertas con fiscales pendientes muestra los importes disponibles; el saldo se obtiene del pago preparado y sus movimientos.

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
