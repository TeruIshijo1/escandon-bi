## Honorarios médicos: servicios, configuración, aprobaciones y pago

**Ubicación:** Mi Área → Honorarios Médicos. Ruta `/interconsultas-jornadas`. La ruta conserva un nombre antiguo, pero monta `HonorariosAuditView`; el módulo actual abarca más que interconsultas/jornadas.

**Mapa interno:** Servicios → Por revisar/Aprobados/Excluidos/Todos; Pagos y PDF → Servicios aprobados/Preparar pago/Pagos preparados; Auditoría; Configuración → Datos fiscales/Catálogo y precios/Jefes de área. Dentro de Servicios hay vistas Por médico, Lista detallada y Tabla completa, así como detalle del registro y aprobación/exclusión individual o en conjunto.

Evidencia del montaje: `frontend/src/App.jsx:339`, `frontend/src/components/honorarios/HonorariosReviewToolbar.jsx:5`, `frontend/src/components/honorarios/HonorariosAuditView.jsx:1579–1614`.

### Servicios: qué consultar y cómo revisar

| Apartado | Información consultable | Fuente y transformación |
|---|---|---|
| Periodo y cobertura | Fecha inicial/final; líneas de venta, cargos clínicos, citas independientes, procedimientos por rol y Contact Center; atenciones que requieren catálogo, tarifa o médico | Lecturas de Vertical y clasificación de `honorariosSources`/`honorariosWorkflow`. La cobertura explica por qué una atención puede existir en Vertical y aún no aparecer como revisable. |
| Por revisar | Servicios con configuración aplicable que necesitan decisión; médico, paciente, servicio, fecha, folio, cantidad, tarifa y observaciones | Candidatos de Vertical cruzados con catálogo/tarifas BI y revisiones guardadas. |
| Aprobados / Pagos y PDF | Servicios o conceptos aprobados, base autorizada, IVA, impuestos y disponibilidad para preparar pago | Decisiones BI válidas; puede haber cálculo fiscal pendiente aunque la aprobación esté guardada. |
| Excluidos | Registros excluidos de revisión/pago y motivo | Reglas de alcance y decisiones internas; no es una cancelación en Vertical. |
| Todos | Universo que cumple el alcance del reporte actual, agrupable por médico o en tabla | No equivale a todas las líneas históricas de Vertical: se excluyen inventarios y conceptos fuera de alcance. |
| Por médico | Servicios, aprobados/pendientes, base y neto por prestador; abrir/cerrar servicios, aprobar pendientes, preparar pago, PDF | Agrupación de renglones consultados y revisiones; se mantiene identidad de médico para evitar confundir homónimos. |
| Lista detallada / Tabla completa | Fecha, referencia/orden, paciente/cliente, grupo, servicio/código, función del médico, cantidad, importes, estado y observación | Mismos registros, distinta presentación; paginación de 100 en el componente actual. |
| Detalle o ficha del registro | Origen clínico, diagnóstico de reglas, tarifa/importe, impuestos, decisión, corrección de médico y evidencia | Datos del renglón, instantáneas y cálculo común de pantalla/PDF/Excel. |
| Aprobar / Excluir | Médico beneficiario, función, cantidad, tarifa, confirmación de ejecución, IVA, posibles duplicados, motivo/evidencia | Se guarda en BI con versión y huella de los datos; una aprobación pierde vigencia si cambia lo revisado. |
| Cambio de médico | Médico anterior/nuevo y motivo del cambio | Corrección auditable del beneficiario BI. El servidor valida el médico anterior; no cambia la ficha clínica original. |
| Aprobación conjunta | Selección de servicios configurados; vista previa; médico, IVA, motivo y confirmaciones | `reviews/bulk-preview` y `reviews/bulk`; se validan elegibilidad, duplicidad y versiones. Los pagos fijos mensuales se revisan por separado. |

**Filtros:** periodo, estado, búsqueda por médico/paciente/servicio/folio, médico y grupo de servicio; vista de resultados. Los filtros de búsqueda/grupo/médico se aplican a la información ya cargada cuando así lo define el componente; cambiar fechas requiere volver a buscar.

**Instructivo operativo:** seleccionar fechas → Buscar servicios → revisar la cobertura → filtrar médico o servicio → abrir Ver servicios → confirmar médico, ejecución, cantidad, tarifa e IVA → aprobar o excluir con motivo → consultar Pagos y PDF. Para corregir al médico, registrar el motivo antes de guardar. Si falta configuración, completar el catálogo/tarifa; si falta cálculo fiscal, completar los datos fiscales.

**Descargas:** PDF resumido, PDF detallado y Excel del periodo/filtros; el PDF de revisión, el PDF de servicios aprobados y el PDF para pago tienen finalidades distintas. La descarga de revisión no registra ni descuenta pagos.

### Fuentes originales de los servicios de honorarios

| Parte de Vertical/SAP | Objetos y campos principales | Cómo se utiliza |
|---|---|---|
| Órdenes de venta y sus servicios | `SO` + `SOLN`: `SONum`, `SOLNNum`, `LineNum`, `ItemCode`, `Quantity`, `UnitPrice`, `SO_ST`, `SOLN_ST`, `UDF_FromDate`, `CreatedOn`, `PR_RQ` | Candidatos por servicio de orden; fecha preferida de cita, después fecha de servicio y después creación. Cuenta vínculos de citas en todo el historial para detectar cantidad compartida. |
| Citas y ejecución | `PCAP`: `PCAPNum`, `PCNum`, `SONum`, `FromDate`, `PRNum`, `PTNum`, `ItemCode`, `PCAP_ST`, `UDF_Ejecutada` | Vincula orden/cita y recupera citas independientes sin una línea de venta equivalente. La presencia de la cita no basta para autorizar pago. |
| Cargos de atención | `PCBL`: `PCBLNum`, `PCNum`, `ChargeDate`, `LineType`, `ItemType`, `ItemCode`, `Quantity`, `UnitPrice`, `SONum`, `PCFRNum`, `PR_TX`, `PR_PC`, `ProcedureRole` | Selecciona cargos de servicio (`LineType='CH'`), médico ejecutante/tratante y vínculos quirúrgicos. |
| Procedimientos de quirófano y participantes | `PCFR`, `PCFRCP`, `PCFRPR`, `CP`: `PCFRNum`, `EntryDate`, `CPCode`, `CPTCode`, `CPTName_ES`, `PRNum`, `SurgeryRole` | Prestaciones por procedimiento y función: cirujano, anestesiólogo y ayudante. Varios participantes sin identificación inequívoca generan revisión pendiente. |
| Atención, paciente, médico y especialidad | `PC`, `PT`, `PR`, `MS`: `PCNum`, `PTNum`, `PRNum`, `FullName`, `Role`, `MSDescription_ES`, `UDF_TIPO_MEDICO`, `UDF_ISR`, `UDF_IVA` | Identificación y contexto; el directorio médico filtra `PR.Role='P'`. |
| Solicitudes, ejecución/cancelación y devolución | `PCIT`, `PCPR`, `PCPRIT`: claves y estados `PCIT_ST`, `PCPR_ST`, `PCPRIT_ST`, `Returned` | Complementa el estado de los cargos; no autoriza por sí solo el importe. |
| Catálogo de servicios y procedimientos | `V_IT`: `ItemCode`, `ItemDescription`, `ItemGroupName`, `ItemType`; `CP` para procedimientos ausentes del catálogo | Nombres, grupos y universo sincronizable; identifica servicios `ItemType='S'`. |
| Referencia histórica de honorarios | `UT_Honorarios`: `Id_UT`, `ITEMCODE`, `ITEMDESCRIPTION`, `IMPORTE`, `NOTAS` | Precios de referencia; la tarifa autorizada para pagar se registra en BI. |
| Auditoría/liquidación declarada en Vertical | `UDR_HON_PAGO_Audit` y `UDR_HON_PAGO`: `UDRKey`, `ItemCode`, `PCDate`, elegibilidad, motivo, base e IVA | Conciliación y auditoría del origen. No reemplaza el motor de aprobación/tarifa BI actual. |
| Proveedores y retenciones de SAP | `BusinessPartners`, `BusinessPartnerGroups`, `WithholdingTaxCodes`, `BPWithholdingTaxCollection`: código/nombre, RFC, régimen y tasas/vigencias | Identifica candidatos fiscales, comprueba configuración y estima retenciones. Coincidencia de nombre no certifica identidad. |
| Facturas y pagos a proveedores SAP | `PurchaseInvoices`, `VendorPayments`, líneas, aplicaciones y retenciones del documento | Consulta documental y comparación; conserva importe original, cancelación, moneda, factura y pagos. No se suma automáticamente como una segunda prestación clínica. |

Evidencia: `backend/services/honorariosSources.service.js:14–179`, `backend/services/honorariosSources.service.js:437–469`, `backend/services/honorariosCatalog.service.js:15–25`, `backend/services/honorariosSapReconciliation.service.js:243–257`, `backend/services/honorariosSapReconciliation.service.js:332–335`.

**Alcance excluido:** los grupos/códigos de almacén y farmacia se excluyen desde las consultas y reglas, no sólo al dibujar la pantalla. En el motor de prestaciones también hay grupos auxiliares/administrativos y servicios excluidos según `honorariosScope`. Las claves de Contact Center y anestesia tienen clasificación específica. No toda referencia en `UT_Honorarios` constituye un honorario pagable.

### Indicadores e importes de honorarios

| Indicador | Definición en la plataforma | Procedencia |
|---|---|---|
| Por revisar / Aprobados / Excluidos / Todos | Conteos por estado dentro del universo cargado; servicios y conceptos mensuales pueden mostrarse por separado | Candidatos + revisiones internas |
| Total aprobado / Neto | Suma de netos aprobados; si un aprobado carece de cálculo, el total queda pendiente y se informa cuántos lo requieren | Cálculo BI; conserva importe original para filas documentales SAP |
| Honorarios / Base | Para una prestación BI, tarifa autorizada × cantidad confirmada; para pago fijo, importe mensual completo | `bi_honorarios_tariffs` / asignación mensual |
| IVA | Base × tasa confirmada en la aprobación; admite 0%, 8% y 16% en esta implementación | Decisión y perfil fiscal, según vigencia |
| ISR estimado | Base sin IVA × tasa aplicable; implementación contempla 0%, 1.25% o 10% en la ficha interna y reglas SAP admitidas | Ficha fiscal interna confirmada o configuración SAP |
| Retención de IVA | IVA × fracción aplicable; ficha interna contempla 0 o 2/3 | Ficha fiscal o retenciones SAP reconocidas |
| Neto calculado | Base + IVA − ISR − retención de IVA | Cálculo común; distribución de centavos por médico/tasa |
| Aprobados con cálculo pendiente | Servicios aprobados que carecen de información suficiente para cerrar el cálculo fiscal | Validación del cálculo; no se sustituye por un cero confirmado |
| Servicios / Pagos fijos mensuales | Subtotales antes de impuestos, manteniendo ambos conceptos diferenciados | Prestaciones y asignaciones BI |
| Documentos SAP | Total y retenciones registrados en factura; el total documental puede incluir pagos previos | SAP; no representa por sí mismo el saldo pendiente de pago |
| Neto cerrado / Ajustes / Pagado / Saldo | Saldo = neto guardado + ajustes − aplicaciones de pago registradas en BI | Instantánea del cierre + historial interno |

Estas son reglas implementadas, no asesoría fiscal ni verificación de la corrección de cada ficha del hospital. Cuando SAP no identifica de forma inequívoca al proveedor o las retenciones, el cálculo puede quedar pendiente. Evidencia: `frontend/src/utils/honorariosCalculation.js:115–158`, `frontend/src/utils/honorariosCalculation.js:163–319`, `backend/utils/honorariosFiscal.js`, `backend/services/honorariosLiquidation.service.js:154`.

El resumen de la pantalla se calcula sobre el universo del periodo cargado (`effectiveData`), antes del filtro textual/médico/grupo; las listas y exportaciones filtradas pueden tener otro alcance. El componente calcula además médicos distintos por nombre, pacientes distintos por nombre (sin documentos SAP) y decisiones modificadas para uso interno/exportación; no son tres tarjetas adicionales del resumen actual. Evidencia: `frontend/src/components/honorarios/HonorariosAuditView.jsx:627–655`.

### Configuración → Catálogo y precios

**Consulta disponible:** servicios, código/grupo, estado de configuración, activo/inactivo, número de tarifas, modalidad presencial/Contact Center, precios de referencia y cambios detectados en Vertical. Subapartados **Aprobados**, **Recomendados** y **Todos los servicios**; la opción Revisar otros conceptos amplía la revisión de candidatos cuya relación con honorarios necesita confirmarse.

**Detalle del servicio:** incluido/pendiente/excluido, tipo de atención, precios de referencia con notas, tarifas autorizadas generales o por médico/función, vigencia inicial/final, historial y última modificación. Una tarifa histórica sólo se aplica a fechas incluidas en su vigencia.

**Pasos:** Buscar servicios nuevos → elegir servicio → confirmar inclusión/modalidad → guardar configuración → agregar tarifa con médico/función/importe/vigencia → comprobar estado configurado → Ver servicios de este concepto. Buscar servicios nuevos consulta Vertical; Actualizar relee lo guardado. El Excel incluye todos los resultados filtrados de todas las páginas.

**Origen:** `V_IT`, `CP`, códigos observados en `SOLN`/`PCBL` y referencia `UT_Honorarios` → sincronización → `bi_honorarios_catalog`, `bi_honorarios_tariffs`, `bi_honorarios_catalog_history`, `bi_honorarios_catalog_sync` en PostgreSQL. El precio cobrado al paciente y el importe a pagar al médico pueden ser diferentes.

Evidencia: `frontend/src/components/honorarios/HonorariosCatalogPanel.jsx:274–470`, `backend/services/honorariosCatalog.service.js:130–154`, `backend/routes/honorarios.routes.js:160–184`.

### Configuración → Datos fiscales

**Consulta disponible:** directorio médico, grupo **Por completar**, **Listos con SAP**, **Configurados internamente** y consulta de todos; RFC, régimen fiscal, vigencia, IVA habitual, retención ISR, retención IVA, identificación de candidato SAP y observaciones de disponibilidad. Historial por médico con revisiones.

**Pasos:** seleccionar fecha/médico → revisar datos SAP → si corresponde configurar ficha interna, completar RFC/régimen/vigencia/tasas → confirmar y guardar → volver al pago. Si cambia la fecha, una ficha antes lista puede quedar pendiente por su vigencia.

**Origen:** directorio `PR` de Vertical; `BusinessPartners` y `WithholdingTaxCodes` SAP; ficha interna `bi_honorarios_fiscal_profiles` e historial `bi_honorarios_fiscal_profile_history`. La ficha interna confirmada puede ser la fuente efectiva del cálculo; no modifica el proveedor en SAP.

Evidencia: `frontend/src/components/honorarios/HonorariosFiscalPanel.jsx:43–152`, `frontend/src/utils/honorariosFiscalDirectory.js:1–23`, `backend/services/honorariosFiscalDirectory.service.js:14–15`, `backend/services/honorariosFiscalProfile.service.js:10–14`.

### Configuración → Jefes de área

**Consulta disponible:** médico, área, pago mensual antes de impuestos, vigencia por mes, estado y búsqueda. Alta, cambio y retiro desde un mes determinado. El listado inicial son propuestas que deben vincularse/confirmarse; no son pagos ya autorizados por su mera aparición.

**Origen:** identidad del médico en `PR`; importe, área, meses y cambios en `bi_honorarios_monthly_fixed_assignments` y `bi_honorarios_monthly_fixed_history`. Se genera un concepto `BI_FIJO_MENSUAL` identificado por médico/mes, con cantidad 1 e importe completo, adicional a sus servicios. No procede de una factura SAP ni de un cargo de paciente.

**Pasos:** agregar médico del directorio → área/importe/meses → guardar → Buscar servicios en el periodo → aprobar el concepto mensual individualmente si corresponde → preparar pago. Cambios de vigencia pueden invalidar aprobaciones abiertas afectadas; conservan cierres existentes.

Evidencia: `frontend/src/components/honorarios/HonorariosMonthlyFixedPanel.jsx:25–40`, `frontend/src/components/honorarios/HonorariosMonthlyFixedPanel.jsx:141–188`, `backend/services/honorariosMonthlyFixed.service.js:82–94`, `backend/services/honorariosMonthlyFixed.service.js:197–212`.

### Auditoría de honorarios en Vertical

**Consulta disponible:** registros originales y reglas de revisión; fecha, folio de referencia, origen, orden de venta, paciente, cliente/aseguradora, médico/especialidad/tipo, grupo/código/servicio, cantidad, precio al paciente, referencia, IVA/tasas, creación y estados de cita/orden. El detalle incluye las banderas de estado de atención, tipo de servicio, referencia en catálogo, inclusión y elegibilidad, con motivo de exclusión.

**Indicadores:** Registros encontrados, Cumplen reglas, Fuera de reglas y Sin evaluar. Son conteos del universo filtrado de la auditoría Vertical, distintos de las aprobaciones BI.

**Filtros:** fechas, médico, grupo, origen, estado, búsqueda, orden y dirección; páginas de 25/50/100. Excel de auditoría con el alcance filtrado. Se excluyen prefijos `FAR`/`ALM` y grupos con FARMACIA/ALMACEN también en opciones, consulta y exportación.

**Origen efectivo:** `UDR_HON_PAGO_Audit`, fecha `PCDate`; el servicio lee las columnas de la vista. La definición SQL interna completa de esta vista pertenece a la base externa y no se obtiene de una lectura del componente. El endpoint legado `/audit-vertical` también cruza `UDR_HON_PAGO`, pero la pestaña actual usa `/vertical-audit`.

Evidencia: `backend/services/honorariosVerticalAudit.service.js:7–29`, `backend/services/honorariosVerticalAudit.service.js:73–94`, `frontend/src/components/honorarios/HonorariosVerticalAuditPanel.jsx:111–197`, `backend/routes/honorarios.routes.js:266`.

### Pagos y PDF → Preparar pago y pagos preparados

**Consulta disponible:** aprobaciones abiertas por médico/periodo; pagos preparados con número, periodo, servicios y neto; detalle por servicio/orden, médico/función, cantidad, neto cerrado, ajustes, pagado y saldo. Historial de pagos y ajustes, referencias, motivos y responsable.

**Flujo:** elegir médico/periodo desde Aprobados → Preparar pago y PDF → completar datos fiscales si se solicita → Generar PDF para pago. Se conserva una instantánea del cierre. Si la respuesta de preparación se pierde, Consultar pagos preparados recupera el estado antes de reenviar una creación. Después se puede descargar PDF para pago y Excel del cierre.

**Registrar pago ya realizado:** elegir médico, importe, fecha y referencia/comprobante. El sistema distribuye el importe entre servicios pendientes del médico. También admite pagos o ajustes por servicio; ajustes negativos reducen la obligación y positivos la aumentan, preservando el neto original y movimientos anteriores.

**Verificar cambios de origen:** compara la prestación con el origen actualizado y muestra diferencias que pueden requerir ajuste. La generación del PDF comprueba cierre, movimientos, distribución e integridad; no reemplaza un registro de pago faltante. El PDF disponible de servicios aprobados cuando falta cálculo fiscal no descuenta pagos ni informa un saldo por pagar.

**Fuentes:** servicio clínico/tarifa y revisión en BI → cálculo fiscal SAP o ficha interna → instantánea en `bi_honorarios_liquidations` y `bi_honorarios_finalized_rows`; movimientos en `bi_honorarios_payment_applications` y `bi_honorarios_liquidation_adjustments`. Registro/huella/versiones en `bi_honorarios_reviews` y `bi_honorarios_review_history`. PDF de pago deriva de la instantánea validada y los pagos/ajustes actuales, no de sumar nuevamente los cargos de Vertical.

**Límite operativo:** preparar el pago o generar el PDF no ejecuta una transferencia. Capturar un comprobante aquí registra su aplicación interna. No se comprobó conciliación automática bancaria ni escritura de pago al proveedor SAP.

**Consulta documental SAP complementaria:** el servicio de conciliación también soporta facturas y pagos por proveedor; el componente conserva código para mostrar documentos SAP, sus conceptos y posibles coincidencias. La búsqueda y actualización vigente de esta pantalla envían `scope='fiscal'`, por lo que no solicitan esos documentos en el flujo normal de Servicios. Se registra esa capacidad como complementaria, no como una pestaña documental activa ni como fuente automática del listado clínico. Evidencia: `frontend/src/components/honorarios/HonorariosAuditView.jsx:193`, `:482`; `backend/routes/honorarios.routes.js:235`.

Evidencia: `frontend/src/components/honorarios/HonorariosLiquidationsPanel.jsx:220–343`, `backend/services/honorariosLiquidation.service.js:21–32`, `backend/services/honorariosLiquidation.service.js:64–120`, `backend/services/honorariosPaymentReport.service.js`, `backend/services/honorariosAvailablePaymentReport.service.js`, `backend/services/honorariosReview.service.js:8–17`.

### Componentes y caminos complementarios de honorarios

`HonorariosDoctorReviewCard` y `HonorariosPhysicianCorrection` son la tarjeta y corrección dentro del módulo; `HonorariosReviewToolbar` reúne encabezado, periodo, resumen, impuestos, filtros y selección. Los generadores de PDF/Excel usan estos datos y sus instantáneas; no tienen un origen independiente.

`HonorariosCoveragePanel.jsx` conserva un componente de citas recuperadas con conteos de candidatos, datos completos, pendientes y duplicados, pero no está importado por el módulo actual. Se documenta como componente existente **sin montaje actual**, no como una pestaña disponible. `honorariosCoverage.service.js` y `/audit-vertical` mantienen consultas complementarias/legadas; el flujo vigente de prestaciones usa `honorariosSources` y `honorariosWorkflow`.
