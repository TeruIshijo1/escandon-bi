# Propuesta final para el control de honorarios médicos en BI

30 de septiembre de 2026. Propuesta funcional y técnica basada en la exploración de Vertical y en la administración de precios e inclusiones solicitada para la plataforma BI.

**Estado:** el control de catálogo, tarifas, revisión, cierres y aplicación de pagos ya está implementado y probado en el proyecto local. El [detalle de implementación y uso](implementacion-honorarios-medicos-2026-09-30.md) identifica las funciones disponibles, las validaciones y el paso pendiente de publicar la versión. Los precios e inclusiones reales requieren configuración del responsable del hospital.

## Objetivo

Que el personal responsable pueda identificar los servicios prestados, confirmar a qué médico corresponde cada honorario, definir su precio desde BI y decidir qué se contabiliza para el pago. Vertical se consulta exclusivamente en lectura; las tarifas, decisiones, ajustes e historial se guardan en la base propia de BI.

La solución combina un catálogo administrable con una revisión de prestaciones del periodo. Las órdenes de venta y los cargos clínicos aportan los candidatos; las vistas UDR_HON_PAGO y UDR_HON_PAGO_Audit sirven para conciliarlos con el resultado actual. Dejan de ser el único filtro de entrada.

Se mantienen fuera del pago Farmacia, Laboratorio, Imagenología y Almacén General. La exclusión se aplica por grupo y por concepto: durante la investigación se encontraron ultrasonidos clasificados en otros grupos, por lo que el grupo por sí solo no cubre la exclusión solicitada. Estos estudios también deben quedar excluidos mediante reglas de conceptos revisadas por el responsable.

## Fundamento de la propuesta

La investigación confirmó que UT_Honorarios contiene 226 registros para 223 códigos. Es el catálogo inicial de referencia, pero tiene importes duplicados, valores nominales de 1 y notas con precios distintos según médico. No puede copiarse como un tabulador autorizado sin revisión.

También se encontraron cargos clínicos sin vínculo a órdenes de venta, diferencias entre el solicitante de la orden y el médico de la cita, y discrepancias entre el médico propuesto por auditoría y el anestesiólogo registrado en el procedimiento. Por ello, agregar únicamente órdenes o cambiar de vista no resuelve toda la cobertura ni la atribución.

La revisión de los códigos de Contact Center identificó 39 líneas elegibles en la auditoría, pero ausentes del pago y sin marca de realización. Son casos para contrastar con el registro de sesiones; no montos adeudados confirmados.

Los hallazgos, consultas y límites de medición están en [la exploración de Vertical](exploracion-honorarios-vertical-2026-09-30.md). Las ausencias en una vista no equivalen por sí mismas a importes adeudados: hay que confirmar realización, médico, precio y pagos previos.

## 1. Configurar servicios y precios

BI tendrá un catálogo de servicios con código, nombre, grupo, origen y estos campos editables:

| Campo | Uso |
| --- | --- |
| Genera honorario médico | Incluir o excluir el concepto del cálculo, con motivo para las exclusiones |
| Honorario base | Importe que se reconoce al médico; independiente del precio cobrado al paciente |
| Unidad de pago | Consulta, sesión, procedimiento u otra unidad acordada |
| Vigencia | Fecha desde la que aplica el precio |
| Excepciones | Tarifas específicas por médico y rol cuando el acuerdo lo requiera |
| Responsable e historial | Identificar quién cambió el precio o la regla, cuándo y por qué |

La pantalla mostrará el precio de Vertical como referencia separada del precio aprobado en BI. El responsable podrá confirmar esa referencia o capturar otro importe sin modificar UT_Honorarios ni las órdenes de Vertical.

Los precios duplicados, nominales o sin vigencia clara quedarán señalados para revisión. BI no escogerá automáticamente un importe entre varias opciones ni interpretará una nota como autorización de pago. Se usará la tarifa vigente en la fecha reconocida de la prestación, no la fecha en que se abre o aprueba el reporte. Una excepción por médico y rol tendrá prioridad sobre la tarifa general vigente; las vigencias superpuestas deberán resolverse antes de calcular.

La misma persona autorizada podrá definir precios y decidir inclusiones. Se utilizarán los permisos de BI y el historial de cambios, sin imponer un segundo autorizador.

## 2. Incorporación automática de conceptos nuevos

La carga inicial recuperará los artículos de tipo servicio de V_IT e incorporará los precios de UT_Honorarios como referencia. Así, el catálogo no quedará limitado a los conceptos que ya tienen tabulador. También descubrirá servicios presentes en las líneas de venta y cargos clínicos, para señalar cualquier concepto que requiera configuración o conciliación.

La clasificación S de Vertical se depura antes de presentar el catálogo de honorarios. Los alias de artículos, paquetes hospitalarios completos, estancias, equipo, materiales, medicamentos y cargos administrativos no generan honorarios ni se ofrecen para configurar una tarifa. La pantalla muestra candidatos a servicios profesionales, incluidas consultas, interconsultas, jornadas y anestesia ausentes de UT_Honorarios. Los conceptos ambiguos se conservan en **Revisar otros conceptos**, para confirmar su naturaleza antes de incluirlos; una referencia en UT_Honorarios no anula las exclusiones.

La sincronización registrará los códigos nuevos como **Nuevo, pendiente de configurar**, con nombre, grupo y tarifa de referencia cuando exista. El responsable verá la novedad, decidirá si genera honorario y fijará su precio. La configuración permitirá resolver las prestaciones pendientes del concepto y calcular las posteriores según la vigencia aprobada.

Actualizar datos descriptivos desde Vertical no sobrescribirá precios, vigencias, exclusiones ni decisiones de BI. Si cambia la tarifa de referencia, BI mostrará el cambio sin aplicarlo al precio autorizado. Un concepto retirado conservará su historial y quedará inactivo para nuevas configuraciones cuando la baja se confirme; una consulta fallida no se tratará como eliminación.

La implementación sincroniza automáticamente el catálogo en el servidor y al consultarlo cuando vence su intervalo, y ofrece el botón **Sincronizar catálogo**, con fecha de última actualización y aviso de errores. El intervalo predeterminado es de 30 minutos y es configurable. La ficha de servicios se consulta completa; el descubrimiento adicional por movimientos usa un corte acotado. También se incorporan los conceptos desconocidos que aparezcan al consultar una prestación.

## 3. Revisar servicios del periodo

Esta será la segunda área de trabajo. Cada registro mostrará fecha utilizada para el corte, servicio, cantidad, médico y rol, atención, cita, orden de venta, honorario aplicable y motivo de cualquier pendiente.

| Fuente de Vertical | Función en BI |
| --- | --- |
| SO y SOLN | Obtener cada línea de servicio de la orden |
| PCAP | Relacionar cita, médico y evidencia de llegada o ejecución del episodio |
| PCBL | Incorporar cargos clínicos que no están relacionados con una orden |
| PCFRCP y PCFRPR | Aportar evidencia del procedimiento y participación por rol |
| PR | Mantener la identidad del médico mediante su código, además del nombre |
| UDR_HON_PAGO y UDR_HON_PAGO_Audit | Comparar cobertura, importes y motivos del cálculo actual |

Las citas y procedimientos ayudan a acreditar o atribuir una prestación; no crean por sí mismos un segundo cargo. El solicitante del encabezado de una orden tampoco se convierte automáticamente en el beneficiario.

BI propondrá el médico de la cita para servicios asociados a esa cita y el participante del rol correspondiente para procedimientos que requieran cirujano, anestesiólogo o ayudante. Si la relación es insuficiente o hay varios participantes posibles, el responsable resolverá el caso en la misma pantalla, dejando el motivo de su decisión.

### Consultas en línea gestionadas por Contact Center

El conjunto inicial identificado por el hospital es `SER1467`, `SER1470` y `SER1471` (Afirma Medicina Interna, Nutrición y Psicología). `SER1471` es distinto de `SER0616`, el concepto general de consulta de Psicología. La llegada presencial no será requisito de pago para el conjunto de Contact Center. BI relacionará cada línea de orden con el resultado de su sesión. Una sesión confirmada como realizada servirá como evidencia de ejecución; una cancelación o llamada sin respuesta no generará honorario. Si falta el resultado, la prestación quedará pendiente.

Una integración externa, cuando exista una fuente disponible, deberá recuperar el folio de orden o cita, el concepto, el médico, la fecha y el resultado de la sesión. La implementación actual permite registrar la confirmación en BI con referencia y responsable, individualmente o en una selección de servicios. En KH_HE no se encontró un campo que registre modalidad en línea, por lo que esa confirmación debe respaldarse en el registro de Contact Center o en la revisión del responsable.

También se revisó `UT_APIT`, la lista que `V_PCAP_Consultas` expone para validar artículos de cita. Contiene `SER0616` (consulta general de Psicología), pero no los códigos Afirma `SER1467`, `SER1470` y `SER1471`. En las citas psicológicas consultadas, el código de artículo de cita está vacío incluso cuando la cita figura ejecutada. El flujo de BI usa las líneas de orden y su revisión sin requerir cambios en UT_APIT ni en Vertical.

El corte incorporará órdenes creadas antes del periodo cuando sus prestaciones correspondan al periodo revisado. Conservará por separado creación, programación, cargo y ejecución. Cuando sólo exista una fecha programada o de cargo, se indicará qué fecha se usó y se revisará la realización; la fecha de creación de la orden no acreditará un servicio realizado. Las novedades tardías aparecerán en conciliación para su revisión.

## 4. Decidir qué se contabiliza

La configuración del catálogo indica qué conceptos pueden generar honorario. La revisión del periodo decide qué prestaciones concretas entran al pago.

El responsable podrá **incluir, excluir o dejar pendiente**, tanto una prestación como una selección de líneas de una orden. Una orden puede contener servicios de varios médicos y conceptos que no generan honorario; aprobarla en conjunto deberá mostrar exactamente qué líneas y cantidades se están aprobando. Las exclusiones por Farmacia, Laboratorio e Imagenología seguirán aplicándose.

Para contabilizar una prestación se requiere concepto elegible, realización acreditada, médico y rol confirmados, cantidad reconocida y tarifa vigente. Cuando Vertical no aporte una marca suficiente, se permitirá documentar la confirmación en BI con motivo y referencia de soporte. Las marcas de ejecución de una cita o de la cabecera no se tratarán como prueba independiente de cada línea.

Los registros incompletos permanecerán visibles como **Pendiente de precio**, **Pendiente de médico**, **Pendiente de realización** o **Posible duplicado**. No desaparecerán ni se liquidarán como si su honorario fuera cero. Una exclusión tendrá un motivo consultable.

Al incluir una prestación válida, BI calculará cantidad reconocida por honorario unitario y la incorporará al total aprobado del médico. Las retenciones y el neto se mostrarán por separado conforme a la configuración fiscal aplicable del módulo.

## 5. Evitar duplicados y conservar decisiones

La identificación conservará la línea de venta y su cita o episodio, o el identificador del cargo clínico, junto con médico y rol. El folio de la orden por sí solo no basta: una misma línea puede estar relacionada con más de una cita y la cantidad de la orden no debe repetirse íntegra por cada relación.

Cuando una prestación aparezca en varias fuentes, BI conciliará sus referencias y cantidades antes de contabilizarla una sola vez. Si faltan vínculos verificables entre orden y cargo, mostrará un posible duplicado para revisión; no fusionará registros sólo por coincidir paciente, fecha y concepto. Si un procedimiento genera honorarios para varios roles, cada obligación deberá tener beneficiario y tarifa propios.

La aprobación conservará una copia del precio, cantidad, médico, rol, fecha de referencia y datos revisados. Un cambio de precio posterior no alterará liquidaciones cerradas. Una revisión retroactiva requerirá una acción explícita con historial.

Las cancelaciones, devoluciones y cambios clínicos posteriores se señalarán para revisión. Si una prestación ya fue pagada, la corrección generará un ajuste trazable, conservando el pago anterior y su relación con la prestación.

## 6. Totales, conciliación y Excel

La pantalla por médico mostrará total aprobado, registros pendientes y excluidos con sus motivos. Cuando existan comprobantes de pago aplicados a las prestaciones, mostrará también importe pagado y saldo pendiente. Estar presente en UDR_HON_PAGO no acredita por sí mismo que el médico ya recibió el dinero.

La conciliación permitirá localizar servicios ausentes de las vistas actuales, diferencias de precio, diferencias de médico y bloqueos por sus reglas. Esto facilitará revisar con el responsable funcional la combinación de Honorarios Médicos y anestesia que actualmente limita algunos cargos.

El Excel conservará separados **Folio Atención**, **Folio Cita** y **Folio Orden de Venta**, además del identificador de línea o cargo, servicio, médico, rol, cantidad, precio BI, importe aprobado, estado y motivo. Cuando una referencia no exista, quedará vacía; un folio de orden no se copiará al de atención.

## 7. Implementación y validación

Se propone ampliar el módulo actual, con tarifas, reglas e historial en PostgreSQL de BI, aprovechando la revisión y los permisos existentes. Vertical conservará acceso de consulta. La extracción de prestaciones y su conciliación se mantendrán separadas de las decisiones administrativas guardadas en BI.

| Etapa | Entrega |
| --- | --- |
| 1. Catálogo administrable | Importación, novedades automáticas, precios, vigencias, excepciones y exclusiones |
| 2. Cobertura y revisión | Órdenes, citas y cargos clínicos; médico por rol; pendientes, cantidades y duplicados |
| 3. Liquidación | Cierre del periodo, Excel, aplicación de pagos y ajustes con historial |

Antes de utilizarlo para liquidar, se ejecutará en paralelo con el proceso actual para un médico y periodo con servicios y pagos conocidos. La aceptación debe comprobar que:

- Un servicio sin tarifa aparece pendiente y puede resolverse desde BI.
- Un concepto nuevo se incorpora sin perder configuraciones previas ni autorizarse automáticamente.
- Farmacia, Laboratorio e Imagenología quedan fuera, incluidos estudios clasificados en otros grupos.
- Una cita del periodo conserva su servicio aunque la orden se haya creado antes.
- El anestesiólogo se identifica por su participación correspondiente, sin heredar al solicitante.
- Una sesión en línea confirmada por Contact Center puede contabilizarse aunque no exista marca de llegada; una sesión sin resultado permanece pendiente.
- Una orden reutilizada o un registro presente en varias fuentes no duplica cantidades.
- Una cancelación o devolución conserva su efecto y su historial.
- Un cambio de tarifa no modifica un cierre anterior y un pago aplicado reduce el saldo de la obligación correcta.

El resultado esperado es un control completo de candidatos y decisiones, con precios administrados por el hospital, pendientes visibles y trazabilidad hasta el servicio y el pago. La propuesta define el diseño; el importe adicional realmente adeudado se determinará al validar las prestaciones y conciliar pagos previos.
