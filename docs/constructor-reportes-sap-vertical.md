# Constructor de reportes SAP y Vertical

Actualizado el 20 de octubre de 2026. El catálogo tiene 64 módulos: 39 SAP y 25 Vertical, en 19 categorías.

MAR-IA reutiliza este intérprete para consultas de reportes y seguimientos con fechas, columnas y filtros. La actualización de MAR-IA y Gemini, conservada en el expediente técnico del proyecto como [mar-ia-reportes-2026-10-08.md](../../historial/pases-anteriores/documentacion/da9b0eb7a7d2762596dcf84eb929bbd6611dcc384c0f905798a969739ddf3f71/mar-ia-reportes-2026-10-08.md), documenta sus permisos, límites de vista previa y comprobación en el servidor. Un rechazo HTTP 402 se distingue de una consulta guiada exitosa y explica revisar el proyecto y la facturación del proveedor.

## Uso

La pantalla inicia en **Crear con asistente**. El usuario puede describir su reporte, por ejemplo: «Necesito las cirugías del mes pasado con paciente, médico y procedimiento». El asistente prepara un tema autorizado con sus columnas y filtros, pregunta por fechas o datos ambiguos y genera el resultado cuando la solicitud está completa. Los ajustes de seguimiento, como «agrega la fecha», conservan la configuración anterior. Se puede descargar el Excel, guardar una plantilla o pasar a **Elegir un tema** para ajustar la configuración manualmente sin perder la conversación.

Las solicitudes admiten lenguaje coloquial para elegir el tema, las columnas y los filtros, además de las fechas. Se reconocen abreviaturas y errores comunes, incluso sin comas: «kiero las sirujias mes pasado pasiente doc fecha», «lo que hay en farma con producto cuanto queda costo», «quita el doc y pon la fecha», «cambia el médico por el procedimiento» y «nomás los que van en refri». La corrección de escritura se limita al vocabulario del generador; no altera los nombres ni códigos indicados en una búsqueda. «Nomás paciente y fecha» reemplaza columnas, mientras que «nomás los antibióticos» aplica un filtro y conserva las columnas. Un tema nuevo descarta columnas y filtros incompatibles del reporte anterior.

Cuando un dato puede significar varias cosas (médico tratante o solicitante, costo promedio o último costo, distintos almacenes), se ofrecen opciones con nombres claros. La solicitud original y hasta cuatro respuestas de aclaración permanecen en `pending`, de modo que elegir una opción no pierde el período ni las otras columnas solicitadas. Los reemplazos explícitos sugeridos por el asistente (`Cambia «...» por «...».`, incluidas columnas cuya etiqueta empieza con «Fecha», como **Fecha de alta médica** o **Fecha de cierre de cuenta**) se aplican directamente sobre las columnas pendientes sin confundirse con cambios de período ni reevaluar palabras de filtro dentro del texto descartado, y las cláusulas reiteradas de estado («abiertas ... y si siguen abiertas también») se depuran globalmente para no quedar como columnas desconocidas. Cuando una solicitud pide filtrar documentos por estado de pago («pagadas», «sin pagar») en un módulo cuyo estado abierto/cerrado no acredita el cobro o pago, el asistente ofrece opciones directas de estado documental (**Solo abiertas**, **Solo cerradas**, **Abiertas y cerradas**) y limpia el rechazo previo en cuanto el usuario elige una opción o reformula el filtro, sin arrastrar «pagadas» como columna faltante. Los cambios entendidos se comprueban también contra la propuesta del modelo para evitar que una respuesta omita operaciones o filtros explícitos. Los filtros aplicados aparecen con sus nombres legibles en el resumen y en el mensaje; no se confirma una condición que el tema no admite.

Al enviar un pedido nuevo o un ajuste, se oculta el resultado anterior hasta completar y generar la nueva configuración. La conversación conserva su contexto, pero el usuario no puede confundir ni guardar el reporte anterior como resultado de una solicitud todavía pendiente. Desde una aclaración se puede abrir la configuración manual con el borrador validado de esa respuesta, cuando existe, y completar lo que falta. Un pedido no entendido o no disponible sin borrador abre el catálogo para elegir un tema, sin reutilizar el reporte anterior. Ese paso no ejecuta el borrador ni borra el historial, el contexto o la aclaración de la conversación. Si el tema o las columnas dejaron de estar autorizados, se pide elegir un tema disponible.

Las fechas admiten «mejor del 1 al 15 de septiembre», «del primero al quince» y «la primera quincena de septiembre». Las fechas explícitas se interpretan y validan también cuando la IA no responde; se aplican a la consulta real y se confirman en el mensaje. Si falta el año, se conserva el del reporte que se está ajustando o se usa el año actual en una solicitud nueva. Si falta el mes, sólo se toma del contexto cuando el período anterior pertenece a un único mes. Fechas inexistentes, rangos invertidos y cambios no entendidos requieren aclaración; no se ejecuta nuevamente el reporte anterior como si se hubiera aplicado el cambio.

`POST /api/sap-query/assistant` interpreta la conversación mediante la conexión Gemini, DeepSeek u OpenAI ya configurada. Se envían la solicitud, hasta ocho mensajes recientes y metadatos compactados del catálogo autorizado (`buildPromptMetadata` conserva completos los temas prioritarios y acota las columnas de tablas secundarias de esquema cuando el catálogo supera 12 recursos, manteniendo el prompt dentro de los límites de tokens por minuto del proveedor); los resultados de consultas no se envían al modelo. La respuesta se valida contra los temas, columnas, filtros y fechas disponibles antes de ejecutar mediante `/execute`, que vuelve a comprobar el permiso. No se ejecutan SQL, uniones, cálculos ni columnas inventadas por el modelo. Las combinaciones no disponibles se explican al usuario. Las fechas relativas se resuelven en America/Mexico_City. El límite del asistente es de veinte solicitudes por minuto y usuario.

La conversación permanece sólo en la sesión de la pantalla. **Nueva conversación** borra su contexto, sin borrar las plantillas. Las solicitudes completas ya entendidas, las condiciones localmente identificadas como no soportadas y las preguntas obligatorias de origen SAP/Vertical se preparan localmente con cualquier proveedor o sin clave, sin esperar una conexión ni mostrar un aviso de caída. Cuando hace falta IA, se usa el proveedor primario y sólo las reservas habilitadas expresamente; si no responden, se usa la búsqueda guiada y el generador manual sigue disponible. Toda la operación, incluidos proveedores sucesivos, cuerpos JSON, descubrimiento y reintentos, comparte un límite de 25 segundos. El tiempo restante se reparte entre los proveedores pendientes para dejar una oportunidad a los respaldos. Las credenciales permanecen en el backend.

«Órdenes de venta», «órdenes de ventas» y «OV» se reconocen en SAP y Vertical. Si el usuario tiene acceso a ambas fuentes y no precisa el origen, el asistente ofrece los dos resúmenes y conserva pacientes, números de orden y fechas mientras aclara. «Las OV» como respuesta no se convierte en una columna desconocida. «Ambas» permite elegir qué fuente generar primero; no mezcla ni duplica órdenes entre sistemas. Un origen no autorizado nunca se sustituye silenciosamente por otro, incluso si lo propone la IA. Los textos de búsqueda, como `busca "Vertical"`, permanecen literales.

Los nuevos resúmenes entregan una fila por orden: **Órdenes de venta SAP · resumen por orden** incluye cabeceras canceladas y sin líneas; **Órdenes de venta Vertical · resumen por orden** incluye órdenes aunque no tengan líneas de servicio. Los detalles anteriores mantienen sus alcances: SAP excluye canceladas y Vertical sólo incluye servicios. El nombre del paciente procede del dato de paciente en SAP o de la relación única del paciente en Vertical; no se reemplaza por el pagador ni por su número. El total de cabecera se muestra una vez por orden. Cada resumen requiere su propio permiso explícito, asignable en Administración. En Vertical el estado conserva el valor original y no se infiere abierto/cerrado.

La exploración de las bases y ejemplos de solicitudes distingue los datos existentes de los reportes ya habilitados. El diagnóstico de IA productiva explica cómo comprobar la conexión desde el servidor con datos ficticios. Ambas notas se conservan en el expediente técnico del proyecto: [exploracion-reportes-sap-vertical-2026-10-06.md](../../historial/pases-anteriores/documentacion/abda9f5906f66640f38a3216b99ee51719067026164bc00012459bea34ee3fe4/exploracion-reportes-sap-vertical-2026-10-06.md) y [incidencia-ia-produccion-2026-10-06.md](../../historial/pases-anteriores/documentacion/45f16ec081d0e81a341e2b3d0d35402f63a1534430c90d127485da1740e08d53/incidencia-ia-produccion-2026-10-06.md).

El primario conserva la prioridad Gemini, DeepSeek, OpenAI y los overrides anteriores de endpoint. `REPORT_AI_FALLBACK_PROVIDERS` habilita una reserva sólo cuando su nombre está incluido y existe su propia clave; vacío o ausente mantiene un único proveedor, aunque haya otras claves. Las reservas usan sus endpoints oficiales y modelos propios, sin heredar `LLM_BASE_URL` ni Azure. Ante un fallo de transporte que termina en búsqueda guiada se prueba el siguiente proveedor dentro del plazo compartido. Una respuesta válida de IA que solicita aclaración o indica un reporte no permitido/no disponible detiene los intentos. El catálogo, las fechas y los permisos se validan igual para todos.

En el endpoint oficial de Gemini, los errores de capacidad HTTP 503 y de límite de cuota HTTP 429 permiten hasta tres solicitudes de generación dentro de su presupuesto cambiando entre modelos Flash/Flash Lite estables disponibles (excluyendo la serie retirada `gemini-2.*`). El descubrimiento automático de una configuración Lite conserva esa familia; `REPORT_AI_GEMINI_FALLBACK_MODELS` permite añadir expresamente otros Flash o Flash Lite estables (`gemini-3.5-flash,gemini-3.6-flash`), incluso Flash desde Lite, tanto en el asistente de reportes como en el clasificador de intenciones de MAR-IA (`llmClassifier.js`). El formato admitido no garantiza que el modelo esté disponible para la cuenta; se excluyen Pro y modelos de vista previa. Otros proveedores/endpoints mantienen un máximo de dos solicitudes. Se usan esperas crecientes, variación breve y `Retry-After` válido sin adelantarlo para encajarlo en el plazo. La lista descubierta se conserva 15 minutos; los modelos alternativos exitosos, hasta una hora después de validar su respuesta. Un 404 invalida y refresca la lista. Cada proceso admite dos operaciones por proveedor; el exceso recibe búsqueda guiada sin cola y puede pasar a una reserva habilitada. Los modelos Gemini con 503 se enfrían 30 segundos para solicitudes siguientes. Si la IA no se recupera, la búsqueda guiada conserva los datos y filtros entendidos. Estas defensas mejoran la continuidad del asistente y no garantizan la disponibilidad de ningún proveedor; la ejecución del reporte depende además de SAP/Vertical.

Cuando hay reservas, un fallo completo de un proveedor suspende esa configuración durante 30 segundos para que los siguientes pedidos puedan usar el respaldo sin repetir toda la espera. Al vencer el período, una nueva solicitud puede probarlo de nuevo. El bloqueo separa endpoint, modelo y credencial; los límites de ocupación local no lo activan. Esta defensa pertenece a cada proceso, igual que los cachés y el límite de concurrencia.

El usuario busca un módulo por nombre, descripción o categoría, filtra por fuente y selecciona las columnas de su reporte. Puede consultar por periodo, filtrar columnas, exportar a Excel y guardar la configuración como plantilla. Las fechas y los filtros disponibles dependen del módulo.

### Estado de las cuentas en el reporte de cirugías

«Cirugías y uso de quirófano» incluye **Estado de cuenta**, **Alta médica**, **Fecha de alta médica** y **Fecha de cierre de cuenta**. Las dos primeras aparecen entre las columnas recomendadas. Estado de cuenta muestra Abierta, Cerrada, Cancelada, Otro estado o Sin información; Alta médica muestra Sí, No o Sin información. Una cuenta cerrada o abierta puede tener alta médica. Estos datos son actuales; el período sigue correspondiendo al inicio de la cirugía.

El filtro permite todas las cuentas, abiertas, cerradas, canceladas, con alta médica o sin alta médica. Se aplica en la fuente antes del límite de filas y se conserva en las plantillas; las columnas elegidas se incluyen en Excel. El chat entiende «agrega status y alta médica», «nomás las cerradas», «solo con alta médica» y «sin alta médica». Cuando se piden dos condiciones distintas a la vez, solicita elegir un filtro y conserva la petición original.

La relación de sólo lectura utiliza `UDR_USOQX.PCFRNum → PCFR.PCFRNum → PC.PCNum`, con claves únicas comprobadas y uniones izquierdas para conservar cada cirugía. El estado procede de `PC.PC_ST` (OP, CL, CA); el alta médica procede de `PC.MedicalDischargeDate` y el cierre de `PC.ClosedOn`. No se infiere el alta a partir de la fecha final de cirugía. Si no hay cuenta relacionada se indica Sin información; esos casos no se cuentan como sin alta médica.

La selección muestra la unidad de cada fila: documento, línea, cuenta, cita, lote, evento o agregado mensual. Los totales de cabecera repetidos en líneas no se suman. Los importes de honorarios y subrogados son referencias de sus vistas; no acreditan pagos efectuados. Las fuentes mensuales se filtran por el primer día del mes, indicado en el filtro y columna.

## Acceso y límites

Cada módulo conserva el permiso sap-query-<id>, incluso las fuentes Vertical. Sólo amendoza recibe acceso total automático. Los demás usuarios acceden mediante permisos granulares asignables en Administración; el permiso general de pantalla conserva el acceso limitado anterior a inventarios. Los reportes propios se listan y guardan únicamente para módulos autorizados.

**Mis reportes** reúne los reportes propios y los asignados. Al guardar, Sistemas/Administración puede elegir usuarios activos; **Administrar accesos** permite cambiar esa lista después. El destinatario abre y consulta la fuente, las columnas y los filtros guardados, sin recibir permisos generales del módulo. La asignación se comprueba antes de consultar y antes de entregar el resultado. El alcance de las asignaciones y de los recursos financieros se conserva en el expediente técnico del proyecto: [asistente-recursos-financieros-2026-10-08.md](../../historial/pases-anteriores/documentacion/2e531c91cff9af30d32116d1df658146c0e36f6c41632ee02583a002df4c2612/asistente-recursos-financieros-2026-10-08.md).

El máximo es de 10000 filas entregadas. Se avisa cuando el origen o el resultado alcanza un límite; los indicadores describen sólo las filas entregadas. Las consultas SAP nuevas recorren páginas y filtran sus detalles antes del límite, con un tope operativo de 20000 documentos revisados. Las consultas SQL SAP heredadas mantienen su tope de 5000 y ahora avisan si lo alcanzan o si queda una página pendiente. Vertical usa TOP con un registro adicional, filtros parametrizados y fecha final inclusiva.

Los saldos de cartera y documentos son actuales al momento de consulta; filtrar por fecha de emisión o ingreso no reconstruye el saldo histórico. Los catálogos de artículos y precios usan Items y conservan artículos sin stock, precios cero y mínimos/máximos reales. El costo promedio se etiqueta por separado de precios por lista.

## Fuentes y mantenimiento

SAP: los módulos adicionales consultan colecciones mediante GET del Service Layer y campos contrastados con su metadata y selecciones reales. Vertical: tablas y vistas existentes, con consultas cerradas de sólo lectura. Las fechas civiles de SQL Server se conservan con useUTC:false; los eventos con hora usan datetime.

Archivos: backend/services/sapQueryBuilder.service.js integra el catálogo anterior con sapReportCatalog.service.js y verticalReportCatalog.service.js. frontend/src/components/mi-area/ConsultaServiceLayer.jsx muestra el constructor. La lista asignable de permisos está en frontend/src/utils/reportQueryPermissions.json. Regenerar con node scripts/sync-report-permissions.cjs después de añadir o renombrar módulos; el test de integración comprueba que no falten permisos.

## Catálogo

| Fuente | Categoría | Módulo | Identificador | Fecha de filtro |
| --- | --- | --- | --- | --- |
| SAP | Inventarios y Stock | Inventario por almacén | inventory | Sin fecha obligatoria |
| SAP | Control de Caducidades | Lotes y Caducidades de Insumos | batches | Sin fecha obligatoria |
| SAP | Compras y Proveedores | Facturas de Proveedores (Compras) | purchase_invoices | Fecha de registro |
| SAP | Compras y Proveedores | Órdenes de Compra a Proveedores | purchase_orders | Fecha de Emisión de Orden |
| SAP | Compras y Proveedores | Recepciones de Mercancía (Entradas) | goods_receipts_po | Fecha de Recepción |
| SAP | Compras y Proveedores | Devoluciones a Proveedores | goods_returns | Fecha de Devolución |
| SAP | Movimientos de Almacén | Traslados entre Almacenes Realizados | stock_transfers | Fecha de Traslado |
| SAP | Movimientos de Almacén | Solicitudes de Traslado entre Almacenes | transfer_requests | Fecha de Solicitud |
| SAP | Movimientos de Almacén | Salidas de Inventario (Mermas / Bajas) | goods_issues | Fecha de Salida |
| SAP | Movimientos de Almacén | Entradas Directas y Ajustes Positivos | goods_receipts_inv | Fecha de Entrada |
| SAP | Compras y Proveedores | Requisiciones y Solicitudes de Compra | purchase_requests | Fecha de Requisición |
| SAP | Facturación e Ingresos | Facturación e Ingresos Hospitalarios | sales_invoices | Fecha de Facturación |
| SAP | Facturación e Ingresos | Notas de Crédito a Clientes (Devoluciones) | credit_memos | Fecha de Nota de Crédito |
| SAP | Catálogos Maestros | Directorio de Proveedores y Socios | business_partners | Sin fecha obligatoria |
| SAP | Catálogos Maestros | Precios y costos por artículo y lista | item_prices | Sin fecha obligatoria |
| SAP | Catálogos Maestros | Maestro de artículos y clasificación sanitaria | item_master_data | Sin fecha obligatoria |
| SAP | Facturación e Ingresos | Facturas de clientes · resumen por documento | sales_invoice_summary | Fecha de emisión |
| SAP | Compras y Proveedores | Facturas de proveedores · resumen por documento | purchase_invoice_summary | Fecha de emisión |
| SAP | Cartera y Saldos | Cuentas por cobrar · facturas abiertas | accounts_receivable | Fecha de emisión |
| SAP | Cartera y Saldos | Cuentas por pagar · facturas abiertas | accounts_payable | Fecha de emisión |
| SAP | Tesorería y Pagos | Anticipos de clientes | sales_down_payments | Fecha de emisión |
| SAP | Tesorería y Pagos | Anticipos a proveedores | purchase_down_payments | Fecha de emisión |
| SAP | Ventas y Servicios | Pedidos de clientes y aseguradoras | sales_orders | Fecha de emisión |
| SAP | Ventas y Servicios | Órdenes de venta SAP · resumen por orden | sales_order_summary | Fecha de emisión |
| SAP | Ventas y Servicios | Cotizaciones de servicios y ventas | sales_quotations | Fecha de emisión |
| SAP | Ventas y Servicios | Entregas a clientes | sales_deliveries | Fecha de emisión |
| SAP | Ventas y Servicios | Devoluciones de clientes | sales_returns | Fecha de emisión |
| SAP | Compras y Proveedores | Notas de crédito de proveedores | purchase_credit_memos | Fecha de emisión |
| SAP | Compras y Proveedores | Cotizaciones de proveedores | purchase_quotations | Fecha de emisión |
| SAP | Tesorería y Pagos | Cobros recibidos · medios de pago | incoming_payments | Fecha del pago |
| SAP | Tesorería y Pagos | Pagos efectuados a proveedores | outgoing_payments | Fecha del pago |
| SAP | Contabilidad y Centros de Costo | Asientos y movimientos contables | journal_entries | Fecha contable |
| SAP | Contabilidad y Centros de Costo | Catálogo de cuentas contables | chart_accounts | Sin fecha obligatoria |
| SAP | Contabilidad y Centros de Costo | Centros de costo y dimensiones | cost_centers | Sin fecha obligatoria |
| SAP | Catálogos Maestros | Catálogo de almacenes | warehouses | Sin fecha obligatoria |
| SAP | Catálogos Maestros | Grupos de artículos y servicios | item_groups | Sin fecha obligatoria |
| SAP | Catálogos Maestros | Directorio de clientes y aseguradoras | customers | Sin fecha obligatoria |
| SAP | Catálogos Maestros | Directorio de proveedores | suppliers | Sin fecha obligatoria |
| SAP | Inventarios y Stock | Disponibilidad, comprometido y en pedido | stock_availability | Sin fecha obligatoria |
| Vertical | Hospitalización y Cuentas | Cuentas y atenciones hospitalarias | vertical_accounts | Fecha de atención |
| Vertical | Hospitalización y Cuentas | Detalle de cargos de cuentas | vertical_account_charges | Fecha de cargo |
| Vertical | Servicios Clínicos | Cargos por unidad de servicio | vertical_service_charges | Fecha de cargo |
| Vertical | Consulta Externa | Agenda de consulta externa | vertical_consultation_schedule | Fecha programada |
| Vertical | Consulta Externa | Consulta del día y órdenes vinculadas | vertical_consultations_day | Fecha de consulta |
| Vertical | Estudios y Auxiliares | Solicitudes de estudios y auxiliares | vertical_study_requests | Fecha de solicitud |
| Vertical | Estudios y Auxiliares | Cobros de imagenología y auxiliares | vertical_auxiliary_charges | Fecha de cargo |
| Vertical | Quirófano | Cirugías y uso de quirófano | vertical_surgeries | Inicio de cirugía |
| Vertical | Productividad e Indicadores | Productividad médica diaria | vertical_physician_productivity | Fecha de atención |
| Vertical | Productividad e Indicadores | Indicadores operativos por periodo | vertical_operational_indicators | Fecha del periodo |
| Vertical | Honorarios Médicos | Honorarios: cálculo de referencia Vertical | vertical_fee_reference | Fecha de atención |
| Vertical | Honorarios Médicos | Honorarios: universo y auditoría Vertical | vertical_fee_audit | Fecha de atención |
| Vertical | Servicios Clínicos | Órdenes de venta de servicios | vertical_service_orders | Fecha de creación de orden |
| Vertical | Servicios Clínicos | Órdenes de venta Vertical · resumen por orden | vertical_sales_orders | Fecha de creación de orden |
| Vertical | Catálogos Clínicos | Directorio de médicos y especialidades | vertical_physicians | Sin fecha obligatoria |
| Vertical | Catálogos Clínicos | Catálogo de servicios de Vertical | vertical_service_catalog | Sin fecha obligatoria |
| Vertical | Hospitalización y Cuentas | Cartera y saldos de cuentas hospitalarias | vertical_receivables | Fecha de ingreso |
| Vertical | Hospitalización y Cuentas | Altas y egresos hospitalarios | vertical_discharges | Fecha de alta |
| Vertical | Hospitalización y Cuentas | Habitaciones y estancias | vertical_room_stays | Fecha de entrada a estancia |
| Vertical | Servicios Clínicos | Devoluciones clínicas por mes | vertical_returns_monthly | Mes de devolución (primer día del mes) |
| Vertical | Farmacia Clínica | Recetas y tratamientos indicados | vertical_prescriptions | Inicio del tratamiento |
| Vertical | Productividad e Indicadores | Consultas e ingresos médicos por mes | vertical_physician_revenue_monthly | Mes de ingresos (primer día del mes) |
| Vertical | Servicios Clínicos | Servicios subrogados: importes de referencia | vertical_subcontracted_services | Fecha de cargo |
| Vertical | Farmacia Clínica | Tickets de insumos y lotes por atención | vertical_clinical_supply_tickets | Fecha de registro de ticket |
| Vertical | Farmacia Clínica | Tickets de devolución de insumos clínicos | vertical_clinical_return_tickets | Fecha de registro de devolución |

## Verificación

La ampliación del 9 de octubre incorpora filtros por importes, agrupaciones, conteos y sumas verificadas, así como casos puntuales por cuenta o número de paciente en el asistente y Mar-IA. La nota Análisis y consultas de cuentas, conservada en el expediente técnico del proyecto como [asistente-analisis-y-casos-2026-10-09.md](../../historial/pases-anteriores/documentacion/35b01c362a0be5447e2cc874a63ba109c2a2ded3e28244d208f0d11897ddb98e/asistente-analisis-y-casos-2026-10-09.md), contiene ejemplos, fuentes, límites y conservación de la configuración en «Mis reportes».

La revisión de usabilidad del 7 de octubre de 2026 corrige las aclaraciones encadenadas: la selección de un reporte conserva su título como selección, incluso al volver a procesar las respuestas anteriores para añadir el período. El chat ofrece acciones sólo en la última respuesta. Las fechas faltantes y las elecciones concretas entre columnas del catálogo se resuelven localmente, sin consultar un proveedor ni mostrar un aviso de conexión. Un ajuste que pide un dato no disponible conserva los demás cambios pendientes hasta que el usuario lo corrija o acepte excluir ese dato; quitar la última columna exige elegir un dato antes de generar.

La validación previa del constructor registró **300 pruebas de backend en doce suites** y las **dos integraciones de navegador**, del asistente y del constructor. Incluye seleccionar SAP o Vertical antes de indicar fechas, títulos de conversaciones anteriores, dos aclaraciones consecutivas de costo/precio, almacén/tipo de medicamento y estado/rol médico, sustitución explícita de un dato desconocido, conservación de ajustes pendientes y rechazo de una respuesta de IA que intenta reutilizar una columna eliminada. La captura de desarrollo `tmp/report-assistant/ov-sap-fechas-pendientes.png` muestra la selección SAP con paciente, folio y período por definir. Se usaron registros ficticios y proveedores simulados; no se consultaron bases ni se verificó una instalación productiva.

La integración conversacional se comprueba con `backend/tests/reportAssistant.test.js`, `backend/tests/reportIntent.test.js`, `backend/tests/reportAssistant.routes.test.js` y `frontend/tests/reportAssistant.integration.mjs`: fechas faltantes, contexto y aclaraciones entre mensajes, errores de escritura, abreviaturas, solicitudes sin puntuación, operaciones mixtas de columnas, cambio de tema, filtros cotidianos, nombres sin alteraciones, campos y condiciones no disponibles, límites y permisos, generación automática, descarga, plantillas, edición manual, errores y reintento. Las pruebas de navegador usan registros ficticios; las de IA simulan el proveedor y no realizan llamadas externas.

El 6 de octubre pasaron 272 pruebas de backend en doce suites, incluyendo recuperación 503/404, plazos estrictos compartidos, cachés, enfriamiento de modelos, suspensión temporal de proveedores fallidos y nueva comprobación tras 30 segundos, concurrencia por proveedor, reservas explícitas y diagnóstico seguro. Las pruebas de configuración y de `check-report-ai.js --reserves` verifican con respuestas simuladas que cada proveedor usa su host y clave propios, y que una reserva buena o una interpretación local no ocultan el fallo de otra. La comprobación individual real con una petición fija y catálogo ficticio de dos campos respondió `ai`, `ready`, Gemini `gemini-3.5-flash-lite`, HTTP 200 y código de salida 0 en aproximadamente 2,26 segundos desde desarrollo con salida de red permitida.

Pasaron también las dos integraciones finales de navegador del asistente y del constructor con datos ficticios. Se verificaron conservación de solicitudes pendientes, fechas y columnas, preparación local sin llamadas al proveedor, limpieza del aviso anterior y paso manual desde una aclaración. Una respuesta no disponible sin plan abrió el catálogo sin reutilizar el reporte anterior ni ejecutar una consulta; volver al chat conservó el historial y el contexto para añadir la fecha al reporte.

La comprobación real posterior de reservas en desarrollo habilitó OpenAI sólo para el proceso hijo, sin modificar `.env`: Gemini respondió HTTP 200, `ai`, `ready`; OpenAI `gpt-4o` devolvió HTTP 401, `credentials`. El resultado fue código 2, `incomplete`, con dos configuraciones y sólo un proveedor oficial listo. **Las reservas no quedaron aprobadas para liberar**. Antes del pase con respaldos habilitados debe pasar `--reserves` en el servidor de destino con credenciales válidas: todos listos y al menos dos proveedores oficiales distintos. En ambas comprobaciones se usó únicamente el catálogo ficticio; no se consultaron bases ni se enviaron registros hospitalarios. El fallo productivo HTTP 503 recibido para `gemini-3.7-flash`, las claves y la red de esa instalación siguen pendientes de comprobar con la actualización. El detalle y los límites de esta evidencia se conservan en el expediente técnico del proyecto, en [incidencia-ia-produccion-2026-10-06.md](../../historial/pases-anteriores/documentacion/45f16ec081d0e81a341e2b3d0d35402f63a1534430c90d127485da1740e08d53/incidencia-ia-produccion-2026-10-06.md).

Se validó además la conexión real con Gemini, con autorización del usuario: solicitudes ficticias y metadatos de temas y columnas, sin registros de pacientes. Se comprobó la preparación del reporte, los ajustes de seguimiento, la respuesta ante costos no disponibles y la recuperación ante un modelo retirado.

El 2 de octubre se recuperó la conexión real con Gemini usando `gemini-3.5-flash-lite`, después de detectar que el modelo configurado devolvía 404 y otras versiones tenían errores de capacidad. Se actualizó `GEMINI_MODEL` local y el ejemplo de configuración. La validación autorizada con el catálogo completo de 62 temas y peticiones ficticias confirmó respuestas de IA listas, sin aviso de búsqueda guiada: «nesesito las sirujias de septiembre con pasiente medico status y alta medica», «nomás las cerradas» y «mejor solo con alta médica». Se conservaron exactamente las cuatro columnas, las fechas y el filtro solicitado. No se enviaron registros de pacientes.

Los seis filtros quirúrgicos se validaron contra SQL Server con `SELECT TOP (0)`, sin recuperar registros. La prueba de navegador confirma chat, configuración manual, columnas y fechas de estado en Excel, filtro en plantillas y presentación clara/oscura de 390 a 1440 píxeles.

Pruebas de backend: sapReportCatalog.test.js, verticalReportCatalog.test.js, sapQueryBuilder.test.js y sapQueryBuilder.routes.test.js. Interacción de frontend: frontend/tests/reportBuilder.integration.mjs; cubre búsqueda, fuentes/categorías, permisos, filtros, plantillas, exportación, errores y formatos de datos. Validación técnica de conexiones en tmp/report-catalog: 25 selecciones SAP y 24 módulos Vertical aceptados; las evidencias sólo conservan estado y nombres de campos, sin registros personales. Algunas fuentes pueden no tener filas para un periodo.

## Completitud y fallos de SAP

El registro de consultas reutiliza la definición verificada cuando coincide y sólo crea o modifica la plantilla cuando corresponde. La comparación de definición reconoce identificadores simples equivalentes con comillas dobles o corchetes, como `AS "Fecha"` y `AS [Fecha]`, sin confundirlos con valores entre comillas simples ni asumir equivalencia general de SQL. El helper confirma la definición en memoria por destino, código y SQL actual durante una hora por defecto; el primer uso después de reiniciar revalida, sin precargas ni temporizadores, y cambiar el SQL solicitado por este código se comprueba de inmediato. Una edición externa que siga ejecutándose correctamente puede detectarse sólo al revalidar por vencimiento o reinicio. Una ausencia explícita permitida puede invalidar esa confirmación, comprobar la definición y repetir la lectura sólo una vez. Una ausencia no resuelta, un HTTP 504, un timeout o una respuesta malformada mantienen la consulta como fallida; no equivalen a un reporte vacío ni autorizan una creación o modificación oportunista. Una respuesta sin el conjunto de registros esperado también se rechaza.

Las consultas OData anteriores de traslados, salidas y entradas conservan su tope de 1,500 documentos antes de expandir las líneas. El resultado indica el truncamiento cuando corresponde; no acredita el total completo. La lectura verifica que cada continuación permanezca en el mismo origen y colección, acepta las rutas Service Layer v1/v2 admitidas y se detiene ante un ciclo, una respuesta inválida o las guardas de 100 páginas y cinco minutos. Reduce el periodo o divide la consulta si se alcanza el límite. Los análisis no confirman un total a partir de una extracción incompleta.

Validación: `backend/tests/sapQueryBuilder.test.js`, `backend/tests/sapQueryBuilder.routes.test.js` y `backend/tests/sapQueryRegistration.test.js`; la comprobación local no acredita la disponibilidad del Service Layer en el servidor.

## Productividad por fechas

El módulo manual **Productividad médica diaria** consulta PC, PR y MS mediante el mismo SQL diario utilizado por la sincronización del tablero. La fecha es el día real de `PC.Date`; la primera atención de cada paciente con cada médico se determina sobre toda la historia antes de filtrar el periodo. Se conservan las seis columnas y el total de atenciones. La vista original `UDR_BI_PRODUCTIVIDAD_MEDICOS` agrupaba por mes con fecha del día 1, por lo que filtrar desde un día intermedio podía excluir el mes completo.

El recurso automático que explora esa vista original mantiene su agregado mensual. Su fecha de filtro corresponde al primer día del mes y no debe confundirse con el módulo manual diario. Ambos recursos conservan sus permisos y su identificador; no se duplica ni se aumenta el catálogo por esta corrección.
