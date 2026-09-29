# Revisión de las respuestas de Contabilidad sobre honorarios médicos

Revisión del 25 de septiembre de 2026. Se leyeron el Word, las dos capturas de SAP y las tres páginas del PDF entregados en `Respuestas`. Se contrastaron con consultas de solo lectura al Service Layer y a las dos fuentes de honorarios del sistema clínico. No se recibieron un archivo Excel ni XML de CFDI en esa carpeta.

**La documentación permite confirmar el flujo de facturación y un caso contable concreto, pero no acredita que SAP tenga todos los datos fiscales ni que todas las consultas de la hoja de pago estén incluidas en la fuente de BI.** Hay dos problemas distintos: diferencias en servicios incluidos y diferencias en impuestos. No deben resolverse sustituyendo un total por otro.

## Qué confirma la respuesta

El flujo descrito es: Mónica consolida servicios y prepara la hoja; el médico la revisa y factura; Lily revisa los datos fiscales y registra la factura de proveedor en SAP. Contabilidad separa los cobros que un médico factura directamente al paciente, en los que no participa la Fundación.

La primera captura identifica Compras - Proveedores / Factura de proveedores. La segunda identifica Socios de Negocios / Datos maestros y muestra varios grupos. Estas pantallas localizan la información, pero no demuestran que cada campo esté capturado ni permiten identificar por sí solas todas las atenciones facturables a la Fundación.

La pregunta sobre unidad, atención o paquete quedó sin una regla explícita. El ejemplo permite calcular dos tarifas de ese caso, pero no constituye un tabulador general vigente.

## Comprobación del catálogo de SAP

La lectura completa devolvió 678 proveedores con RFC capturado. El campo de régimen fiscal `U_B1SYS_FiscRegime` está vacío en los 678. No se encontró en lo recibido una fecha de vigencia del régimen.

| Grupo en SAP | Proveedores | Con régimen fiscal capturado |
|---|---:|---:|
| HMEDRES | 100 | 0 |
| HONMED | 99 | 0 |
| HONRESICO | 8 | 0 |
| HONORARIOS | 25 | 0 |
| Total de estos cuatro grupos | 232 | 0 |

Los cuatro grupos permiten preparar un catálogo inicial, no una lista de 232 médicos activos, identidades confirmadas o liquidaciones autorizadas. El grupo RESICO contiene otros 12 proveedores; no se incluyó automáticamente porque el nombre del grupo no identifica una actividad médica. Buscar únicamente HONORARIOS tampoco cubriría los otros grupos médicos.

Para María Antonieta Calva, el RFC de SAP coincide con el que se lee en el CFDI impreso. El CFDI indica persona física con actividades empresariales y profesionales, mientras que el campo `CompanyPrivate` del proveedor devuelve `cCompany`. Este último campo no debe usarse como prueba de personalidad fiscal. El régimen que se observa en el documento específico tampoco autoriza a asumirlo para otros médicos o periodos.

## Conciliación del caso entregado

El PDF contiene tres documentos: una representación impresa de CFDI, una hoja de liquidación firmada y una hoja anterior con la anotación manuscrita sobre consultas HSBC faltantes.

| Concepto | Hoja anterior, página 3 | Hoja firmada, página 2 | CFDI impreso, página 1 |
|---|---:|---:|---:|
| Consultas identificadas en la hoja | 23 | 24 generales + 11 HSBC | Un concepto agregado |
| Subtotal | $5,175.00 | $8,150.00 | $8,150.00 |
| IVA trasladado | $828.00 | $1,304.00 | $1,304.00 |
| Retención de IVA mostrada | $552.00 | $869.33 | $869.34 |
| Retención de ISR mostrada | $600.30 | $815.00 | $815.00 |
| Neto mostrado | $5,402.70 | $7,769.67 | $7,769.66 |

### Diferencia de servicios

La fuente de liquidación del sistema clínico, consultada para agosto y el nombre de esa prestadora, devuelve 23 unidades, base $5,175 e IVA $828. Coincide con la base de la hoja anterior. En el detalle de auditoría hay 23 registros elegibles; no se localizó un grupo de cliente identificado como HSBC dentro del alcance de la consulta.

La hoja firmada contiene 24 consultas por $5,400 y 11 consultas HSBC por $2,750. La diferencia frente a la fuente es **$2,975**, compuesta por una consulta de $225 y las once de HSBC por $2,750. Se requiere el origen de esos servicios y el soporte del ajuste. No se deben sumar los renglones excluidos de auditoría para forzar ese resultado: varios representan órdenes con cita asociada y pueden duplicar la misma atención.

Las tarifas de $225 y $250 se infieren de esta hoja concreta. Falta confirmar la regla contractual, vigencia y forma de aplicar cantidades y paquetes.

### Diferencia de impuestos

En la página 3, $600.30 equivale al 10% de $6,003, que incluye IVA. Además, el neto mostrado es $6,003 - $600.30: la retención de IVA de $552 aparece, pero no se resta.

Con la base de esa misma hoja y el tratamiento del ejemplo, el cálculo sería:

`$5,175 + $828 - $517.50 - $552 = $4,933.50`

Ese resultado solo corrige la aritmética de las 23 consultas; no resuelve las consultas adicionales ni determina el importe definitivo del CFDI completo. La corrección previa en BI ya calcula ISR sobre la base sin IVA; sigue faltando validar y aplicar la retención de IVA por perfil fiscal.

El ejemplo del Word sí cuadra: `$5,800 + $928 - $618.67 - $580 = $5,529.33`.

En el documento completo, dos tercios de $1,304 dan $869.3333..., que redondeados son $869.33. En la impresión del CFDI se observa una tasa de retención de IVA de 10.6667% sobre $8,150: el importe es $869.33605, que redondea a $869.34. Esto explica aritméticamente el centavo de diferencia. Debe conservarse el importe documental y conciliar el XML, sin alterar SAP para hacerlo coincidir con el cálculo teórico.

### Qué contiene SAP para ese documento

Se localizó la factura **7999**, referencia **F-86B35**, contabilizada el **16/09/2026**. El RFC coincide con el del impreso, la referencia coincide con la terminación del folio fiscal y las observaciones dicen que corresponde a psicología y consultas HSBC de **agosto de 2026**. Es una correspondencia documental sólida para revisar el caso; no equivale a validar el CFDI ante SAT.

| Dato contabilizado | Importe |
|---|---:|
| Línea de psicología | $6,264.00 |
| Línea de consultas HSBC | $3,190.00 |
| Suma de líneas | $9,454.00 |
| IVA separado en SAP | $0.00 |
| Retención de ISR | $815.00 |
| Retención de IVA | $869.34 |
| Total del documento | $7,769.66 |
| Pagado acumulado al consultar | $0.00 |

La suma de líneas coincide con subtotal más IVA del CFDI. Por ello, el IVA separado en SAP igual a cero no demuestra que el servicio original sea exento. En este caso el soporte recibido permite explicar el importe incorporado en las líneas; no se debe generalizar ese desglose a cualquier factura sin su soporte.

Las bases y tasas de retención registradas tampoco reconstruyen por sí solas los impuestos: la línea de IVA tiene base $9,454 y tasa 10.66%, pero importe $869.34; la de ISR tiene base cero e importe $815. El total contable cuadra, aunque esas bases no reproduzcan el cálculo fiscal.

El campo UUID está vacío, no hay referencia de anexo utilizable y la colección electrónica consultada está vacía. Eso no prueba que el XML no exista en otro repositorio. La impresión entregada no permite validar su estructura ni estado SAT. Una firma o la forma de pago indicada en el CFDI tampoco acreditan que ya se realizó la transferencia.

## Reglas fiscales que no deben convertirse en supuestos del código

La frase de Contabilidad de que todos los servicios gravan ISR no determina una retención universal. Para los servicios profesionales de una persona física a una persona moral, la LISR contempla 10% en el supuesto del artículo 106; para contribuyentes RESICO del artículo 113-E, el artículo 113-J prevé 1.25% sin IVA. No debe extrapolarse esa retención a todas las personas morales proveedoras. [LISR, artículos 106 y 113-J](https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf).

Tampoco es correcto programar que toda rehabilitación o epidemiología causa IVA solo por su etiqueta. La exención depende de la naturaleza del servicio, el título exigido y el prestador bajo el artículo 15, fracción XIV de la LIVA. El artículo 41 de su Reglamento precisa los servicios profesionales de medicina. La psicología gravada del ejemplo documenta ese caso, sin resolver todos los prestadores o servicios. [LIVA, artículo 15](https://www.diputados.gob.mx/LeyesBiblio/pdf/LIVA.pdf), [Reglamento, artículo 41](https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LIVA_250914.pdf).

Cuando corresponde retener IVA por servicios personales independientes prestados por personas físicas a personas morales, el Reglamento establece dos terceras partes del IVA trasladado y efectivamente pagado. No debe reemplazarse esa proporción por una constante truncada de 10.66% del subtotal. La estimación previa al pago y las retenciones documentadas deben conservarse separadas. [Reglamento de LIVA, artículo 3](https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LIVA_250914.pdf).

## Cambios realizados en Plataforma BI

- Se corrigió la paginación de SAP: `$top=200` limitaba toda la colección a 200 proveedores. Ahora se usa el tamaño de página indicado en la cabecera y se recorren los enlaces hasta terminar. La verificación real devuelve 678 y recupera a Norma Daniela Silva Curiel, antes fuera del primer bloque.
- Se consultan RFC, grupo y régimen disponibles, sin convertir un grupo en régimen validado. Los faltantes aparecen expresamente y se mantiene el vínculo por nombre como candidato.
- Las retenciones se presentan por su descripción de SAP, sin mostrar claves técnicas al usuario. Los importes registrados se conservan, incluso si no son reproducibles con la base y tasa recibidas.
- La pantalla y Excel incluyen las observaciones de la factura para ayudar a identificar el periodo de servicios. El PDF aclara que la fecha contable puede corresponder a servicios de otro periodo.
- Para importes con IVA se muestra que la retención de IVA está pendiente y que todavía no ha sido descontada. No se presenta esa cifra como un neto definitivo ni se inventa un perfil fiscal para calcularlo.
- Se actualizó `pase_a_produccion` con el backend y frontend compilado. No incluye documentos personales de `Respuestas` ni evidencia temporal.

Validación: tres pruebas de regresión de paginación/integridad, consulta real al Service Layer con 678 proveedores y los dos casos revisados, build de producción correcto y revisión visual del PDF. No se modificaron datos de SAP, Vertical ni su base de datos. No se desplegó al servidor.

## Información concreta pendiente

1. Origen y relación de las once consultas HSBC y la consulta adicional del ejemplo, con periodo, cantidad, tarifa y responsable del ajuste.
2. XML original de la factura revisada y ubicación habitual de los XML de proveedores. Se necesita conservar base, IVA, ISR, IVA retenido, UUID y redondeos del documento.
3. Régimen, personalidad y vigencia fiscal por prestador, con una correspondencia de identidad validada. El catálogo SAP reduce la captura inicial, pero no aporta los campos vacíos.
4. Regla del tabulador por unidad, atención o paquete y sus excepciones. La confirmación de los cobros directos a pacientes no identifica automáticamente esas operaciones dentro del reporte.

La evidencia agregada de esta revisión está en `evidencia-respuestas-contabilidad-2026-09-25.json`.

## Aclaración sobre las retenciones configuradas en SAP

El usuario precisó que Contabilidad selecciona al médico y SAP determina las retenciones con su configuración. También informó que el criterio operativo de IVA comprende rehabilitación, psicología, nutrición y epidemiología. Se incorpora nutrición a lo informado inicialmente; esta lista documenta la práctica comunicada por Contabilidad, no una conclusión de que cualquier servicio con esos nombres tenga obligatoriamente ese tratamiento legal.

**El campo de régimen fiscal vacío no implica que SAP carezca de retenciones configuradas.** Son datos diferentes. Se confirmó en vivo que el proveedor del caso Calva está sujeto a retenciones y tiene asignados ISR de 10% e IVA retenido de 10.66%, ambos sobre el 100% de la base neta definida en SAP, con aplicación en factura. La configuración de esos códigos está activa y muestra vigencia desde el 26/12/2025. Esa fecha corresponde a la tasa del catálogo; no demuestra desde cuándo el proveedor pertenece a un régimen fiscal.

BI ahora lee y presenta el indicador del proveedor, las retenciones asignadas, sus tasas, base, momento de aplicación y estado activo/inactivo. La configuración aparece incluso cuando no hay factura en el periodo. Un valor ausente no se convierte en cero ni la existencia de un código asignado implica que deba aplicarse si el proveedor está marcado como no sujeto. La pantalla, el PDF y el Excel conservan por separado configuración e importes de las facturas.

En la extracción de los cuatro grupos médicos, 230 de 232 proveedores tenían algún código asignado; 231 estaban marcados como sujetos a retención y uno como no sujeto. Son indicadores distintos, no una certificación del tratamiento de cada registro. El catálogo incluye tasas de ISR de 10% y 1.25%, y retenciones de IVA con distintas bases; BI no debe tratar todas esas tasas como porcentajes del honorario.

La documentación de [SAP sobre configuración de retenciones](https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/1d1efd893ec341ecbb974120f9edbd89.html) describe el uso de códigos y su aplicación en factura o pago. Esto explica el funcionamiento comunicado por Contabilidad. El importe contabilizado se toma del documento: en el ejemplo, multiplicar $8,150 por el 10.66% del catálogo daría $868.79, pero el CFDI impreso y la factura contienen $869.34. La configuración por sí sola no reproduce ese importe; no se debe sobrescribirlo ni atribuir la diferencia a un ajuste manual sin evidencia.

El IVA trasladado y la retención de IVA son conceptos distintos. Para la lista de especialidades informada, sigue siendo necesario vincular al prestador y al servicio correspondiente. La exención legal se revisa conforme al [artículo 15 de la LIVA](https://wwwmat.sat.gob.mx/articulo/67548/articulo-15) y al [artículo 41 de su Reglamento](https://wwwmat.sat.gob.mx/articulo/74462/articulo-41); el nombre de la especialidad no sustituye esos requisitos.
