# Qué reportes se pueden pedir con la estructura actual de Vertical

Exploración real realizada el **6 de octubre de 2026**, sobre la conexión de Vertical configurada en el backend. Se consultó la estructura de la base y se compilaron consultas con `SELECT TOP (0)`. No se recuperaron registros de pacientes, médicos, cuentas ni importes.

La conexión permitió ver **478 tablas, 246 vistas y 13,519 columnas**. Se comprobaron 63 tablas/vistas clínicas con cero filas y las consultas exactas de los **25 temas Vertical** del constructor, también con cero filas: todas se ejecutaron correctamente. Esto confirma que las fuentes y columnas existen y que las consultas son válidas en esa base; no demuestra que cada campo tenga datos, que una vista cubra todos los casos o que sus importes sean equivalentes a pagos.

## Pedidos que ya tienen un tema y columnas disponibles

Las siguientes frases son ejemplos de la información disponible en el constructor. El asistente debe traducir cada pedido a su tema y columnas autorizados. La exploración de estructura no comprueba por sí sola que cualquier redacción coloquial se interprete correctamente.

| Pedido del usuario | Tema disponible | Información que puede incluir | Unidad de cada fila |
| --- | --- | --- | --- |
| “Todos los pacientes con las órdenes de venta de septiembre” | Órdenes de venta Vertical · resumen por orden (`vertical_sales_orders`) | Paciente, número de paciente, orden, atención, creación, estado original, código de pagador, número de médico solicitante, subtotal, impuesto y total | Una orden; incluye órdenes sin líneas de servicio |
| “El detalle de los servicios de las órdenes de septiembre” | Órdenes de venta de servicios (`vertical_service_orders`) | Paciente, orden, servicio, cantidad, precio, importe de línea y estados originales | Una línea de servicio; excluye líneas que no son servicios |
| “Las cuentas de septiembre con total, anticipos y saldo” | Cuentas y atenciones hospitalarias (`vertical_accounts`) | Atención, número de paciente, ingreso, tipo y estado original de atención, número de médico, total, saldo, anticipos, alta y cierre | Una cuenta; el saldo es actual |
| “Los cargos de las cuentas con artículo, cantidad y precio” | Detalle de cargos de cuentas (`vertical_account_charges`) | Atención, fecha de cargo, unidad, artículo, cantidad y precio unitario | Un cargo |
| “Los cargos por servicio con paciente y médico” | Cargos por unidad de servicio (`vertical_service_charges`) | Paciente, atención, unidad, artículo, cargos, devoluciones, importes y médicos que expone la vista | Un renglón de la vista |
| “Las citas de septiembre con paciente, médico y especialidad” | Agenda y citas de consulta (`vertical_consultation_schedule`) | Cita, fecha, hora, paciente, médico, especialidad, servicio, estados de cita/orden y diagnóstico | Un renglón de la agenda |
| “Las consultas del periodo con paciente y servicio” | Consulta del día y órdenes vinculadas (`vertical_consultations_day`) | Cita, paciente, médico, especialidad, fecha, hora, edad, servicio y estado de orden | Un renglón de la vista clínica |
| “Los estudios solicitados por área y médico” | Solicitudes de estudios y auxiliares (`vertical_study_requests`) | Solicitud, fecha, estudio, área, médico, tipo de atención y cantidad | Una solicitud de estudio |
| “Los cobros de imagenología con paciente y estudio” | Cobros de imagenología y auxiliares (`vertical_auxiliary_charges`) | Paciente, cargo, fecha, unidad, servicio, cantidad e importe de línea | Un renglón de cobro vinculado a un cargo |
| “Las cirugías de septiembre con paciente, médicos y procedimiento” | Cirugías y uso de quirófano (`vertical_surgeries`) | Paciente, atención, inicio/fin, quirófano, médicos, procedimientos, estado actual de cuenta, alta médica y fechas de alta/cierre | Una cirugía registrada |
| “Las cirugías con cuenta cerrada o con alta médica” | Cirugías y uso de quirófano (`vertical_surgeries`) | Las columnas anteriores; filtros por cuenta abierta/cerrada/cancelada o por alta médica | Una cirugía; cuenta cerrada y alta médica son condiciones diferentes |
| “Las consultas por médico y día” | Productividad médica diaria (`vertical_physician_productivity`) | Médico, especialidad, fecha, primeras consultas, subsecuentes y total | Médico/especialidad/día según la vista |
| “La ocupación y los tiempos del hospital por periodo” | Indicadores operativos (`vertical_operational_indicators`) | Ocupación, quirófanos, urgencias, hospitalización, tiempos, metas y registros de triaje/laboratorio/imagenología/egreso | Un periodo consolidado |
| “Los honorarios de referencia con paciente, médico y servicio” | Honorarios: cálculo de referencia (`vertical_fee_reference`) | Atención, paciente, médico, especialidad, servicio, base/IVA de referencia, tabulador y alertas | Un cálculo de referencia; no acredita un pago |
| “Los honorarios excluidos y el motivo” | Honorarios: universo y auditoría (`vertical_fee_audit`) | Universo de auditoría, paciente, médico, servicio, importe de referencia, elegibilidad, origen y motivo de exclusión | Un renglón original de auditoría |
| “El directorio de médicos con especialidad” | Directorio de médicos y especialidades (`vertical_physicians`) | Médico, especialidad, actividad, tipo y permisos clínicos registrados | Un médico con rol P |
| “El catálogo de servicios por grupo” | Catálogo de servicios (`vertical_service_catalog`) | Código, descripción, grupo, unidad, clasificación y habilitación | Una ficha por origen/artículo; el código puede repetirse por origen |
| “Los pacientes con saldo pendiente y antigüedad” | Cuentas pendientes (`vertical_receivables`) | Paciente, ingreso, atención, convenio, médico, facturado, abonado, devuelto, saldo y vencimiento | Una cuenta; saldo actual |
| “Los pacientes dados de alta en septiembre” | Altas y egresos hospitalarios (`vertical_discharges`) | Paciente, atención, fecha y tipo de alta, tipo de atención | Un alta de la vista |
| “Las estancias por habitación con paciente y médico” | Habitaciones y estancias (`vertical_room_stays`) | Habitación, paciente, médico, entrada, cierre y estados originales | Una estancia; una cuenta puede tener varias |
| “Las devoluciones de artículos por mes y unidad” | Devoluciones clínicas por mes (`vertical_returns_monthly`) | Mes, artículo, unidad, eventos, cantidades e importe devuelto | Un agregado mensual por dimensiones |
| “Las recetas con medicamento, vía y frecuencia” | Recetas y tratamientos indicados (`vertical_prescriptions`) | Paciente, médico, receta, medicamento, inicio/fin, vía, frecuencia, instrucciones y dispensación registrada | Un renglón de receta |
| “Las consultas e ingresos por médico y mes” | Consultas e ingresos médicos por mes (`vertical_physician_revenue_monthly`) | Médico, mes, consultas e ingresos de la vista | Médico/mes; ingresos clínicos de referencia |
| “Los servicios subrogados con sus importes de referencia” | Servicios subrogados (`vertical_subcontracted_services`) | Paciente, atención, servicio, cantidad e importe calculado | Un cargo subrogado; no acredita transferencia |
| “Los insumos entregados por atención, lote y caducidad” | Tickets de insumos y lotes (`vertical_clinical_supply_tickets`) | Paciente, atención, solicitud, artículo, lote, caducidad, cantidad, precio e importe | Un renglón de ticket con lote |
| “Las devoluciones de insumos por paciente y lote” | Tickets de devolución (`vertical_clinical_return_tickets`) | Paciente, atención, solicitud, artículo, lote, cantidad e importe original | Un renglón de devolución; conserva el signo original |

Los temas con periodo filtran por su fecha indicada: creación de orden, emisión, atención, cargo, ingreso, alta, inicio de cirugía o primer día del mes. Un periodo no equivale automáticamente a todas esas fechas al mismo tiempo. Los filtros por estado disponibles deben proceder del catálogo; el resumen de órdenes Vertical muestra el estado original sin traducir códigos no comprobados.

## La diferencia entre todas las órdenes y su detalle de servicios

El tema anterior `vertical_service_orders` parte de `SO INNER JOIN SOLN` y exige que cada artículo exista en `V_IT` con `ItemType = 'S'`. Su universo son las líneas de servicios; una orden sin líneas de servicio no aparece y una orden puede producir varias filas. Es correcto para pedir detalle de servicios, pero no satisface “todas las OV”.

Se añadió `vertical_sales_orders` sobre `SO`, sin exigir `SOLN` ni una clasificación de artículo. Entrega una fila por `SONum` y muestra los importes de cabecera una sola vez. El nombre se obtiene por unión izquierda a `PT`, con su clave primaria única `PTNum`, conservando órdenes sin paciente relacionado. El periodo corresponde a `SO.CreatedOn`; una fecha de creación ausente no pertenece a un rango fechado.

La fuente SAP tiene además `sales_order_summary`, una fila por cabecera de `Orders`, con paciente de `U_PTName`, número de paciente/cuenta y referencia `U_SONum`. Incluye canceladas y órdenes sin líneas y presenta la cancelación explícitamente. El detalle SAP `sales_orders` conserva su alcance de líneas y su exclusión de documentos cancelados. Estos dos resúmenes son temas distintos y requieren permisos explícitos; no fusionan SAP y Vertical ni suman ambos universos.

## Claves y relaciones comprobadas

Se inspeccionaron índices de SQL Server. Las siguientes claves primarias son únicas, activas y no filtradas en la base consultada.

| Fuente | Clave única | Relación útil | Precaución |
| --- | --- | --- | --- |
| `PT` | `PTNum` | `SO.PTNum → PT.PTNum`; `PC.PTNum → PT.PTNum` | `FullName` es `nvarchar` y admite nulos; `SO.PTNum` admite nulos |
| `PC` | `PCNum` | Cuenta → paciente, médico y atención | La FK a paciente/médico no está validada para todos los datos históricos |
| `SO` | `SONum` | Cabecera de orden → paciente, atención, cita, receta y médico solicitante | No se observó FK declarada para `SO.PTNum`; conservar órdenes mediante `LEFT JOIN` |
| `SOLN` | `SOLNNum`; índice único `(SONum, LineNum)` | Varias líneas → una orden por `SONum` | Unir líneas multiplica la cabecera; no sumar su total repetido |
| `PR` | `PRNum` | Médico y especialidad `MSCode`; rol P en directorio | Identificador del solicitante no es el nombre del médico |
| `MS` | `MSCode` | Especialidad del médico | Nombre localizado disponible en `MSDescription_ES` |
| `PCAP` | `PCAPNum` | Cita → `PCNum`, `PTNum`, `PRNum`, `SONum`, `PCFRNum` | Citas y órdenes pueden tener cardinalidad distinta; evitar uniones por paciente y fecha solamente |
| `PCIT` | `PCITNum` | Cargo → cuenta, paciente, solicitud, orden y línea | Expone `PCPRNum`, `PCPRITNum`, `SONum`, `SOLNNum`, `ChargeDate` y cantidad/precio |
| `PCBL` | `PCBLNum`; índice único `(PCNum, Partition, LineNum)` | Renglón de cuenta/facturación → cargo, solicitud, orden y médicos | Importes y reglas de cobertura propios del renglón; no equivalen a un pago |
| `PCPR` | `PCPRNum` | Solicitud clínica → cuenta, estancia, médicos, `SONum`, receta | La fecha de solicitud y la del cargo son distintas |
| `PCPRIT` | `PCPRITNum`; índice único `(PCPRNum, LineNum)` | Línea de solicitud → artículo, lote, cantidad, orden/línea y receta | La petición puede no estar ejecutada; estados requieren interpretación clínica |
| `PCRX` / `PCRXLN` | `PCRXNum` / `(PCRXNum, LineNumber)` | Receta y sus renglones; médico en `PR_RX` | Indicación, dispensación y administración no son conceptos equivalentes |
| `PCFR` | `PCFRNum` | Estancia → cuenta, paciente y recurso/habitación | Una cuenta puede tener varias estancias |
| `FR` / `SU` / `DX` | `FRCode` / `SUCode` / `DXCode` | Recursos, unidades de servicio y diagnóstico | Metadatos de clasificación; no prueban su uso ni completitud |

Se observaron **71 claves foráneas declaradas**, representadas por 76 pares de columnas; todas están habilitadas, pero **68 tienen `is_not_trusted = 1`**. Esto significa que SQL Server no confirma su integridad para todo el contenido histórico. La unicidad del destino sí limita una unión a como máximo una coincidencia, pero no demuestra que cada origen tenga destino. Conviene mantener filas sin vínculo y mostrar datos ausentes.

La cuenta usada no tiene permiso `VIEW DEFINITION` en la base: las 246 vistas tienen definición no visible y `sys.sql_expression_dependencies` no devolvió relaciones. Se verificaron sus columnas y consultas con cero filas, pero no se pudo auditar el SQL interno de esas vistas. Los enlaces no respaldados por una FK se identifican como relaciones por campos compatibles, no como integridad demostrada.

## Campos exactos del nuevo resumen de órdenes Vertical

| Campo de origen | Tipo comprobado | Uso |
| --- | --- | --- |
| `SO.SONum` | `int`, clave primaria, no nulo | Número de orden |
| `SO.CreatedOn` | `datetime`, nullable | Fecha de creación y filtro de periodo |
| `SO.SO_ST` / `SO.SOType` | `nvarchar(32)`, no nulo | Estado y tipo originales; no se tradujeron por inferencia |
| `SO.PTNum` / `SO.PCNum` / `SO.PR_RQ` | `int`, nullable | Paciente, atención y médico solicitante |
| `SO.BPCode` | `nvarchar(20)`, no nulo | Código de pagador |
| `SO.Subtotal` / `SO.TaxTotal` / `SO.Total` | `decimal(19,6)`, no nulo | Importes de cabecera |
| `PT.FullName` | `nvarchar`, nullable | Nombre real del paciente; vacío se muestra como ausente |

## Información que existe y todavía requiere ampliar el catálogo

| Pedido posible | Evidencia estructural | Trabajo pendiente |
| --- | --- | --- |
| Pacientes con edad, sexo, diagnóstico, convenio y días de estancia | `UDR_BI_PACIENTES`: `Paciente`, `Edad`, `Sexo`, `Diagnostico`, `Convenio`, `DiasEstancia`, `TipoAtencion`, `GrupoEdad`; `PT`: `BirthDate`, `Gender` | Crear tema/columnas con su permiso y comprobar la unidad de la vista y el cálculo de edad |
| Censo de pacientes por habitación, diagnóstico, convenio y médico | `UDR_AD_CENSO`: `Habitacion`, `Paciente`, `Edad`, `FechaEntrada`, `MedicoTratante`, `Diagnostico`, `Convenio`, `Especialidad`, `Abonos`, `Saldo` | Comprobar si la vista es un censo actual o admite cortes históricos antes de exponer fechas |
| Todas las líneas de órdenes, además de servicios | `SO`, `SOLN`; `UDR_SO` incluye `PTName`, `NombreMedico`, `ItemName`, cantidad, precio e importe | Crear un detalle sin exigir `ItemType = 'S'`; conservar la unidad de línea y validar el origen del artículo |
| Órdenes con nombre del médico y pagador | `PR.FullName`, `SO.PR_RQ`; `UDR_SO.NombreMedico`, `BPName` | Añadir relación cerrada y comprobar clave/nulos; el resumen actual sólo expone identificadores |
| Estudios por paciente, atención y orden | `PCPR`, `PCPRIT`, `LBOR` y `LBORLN`: referencias a cuenta/paciente/médico/orden/solicitud y fecha requerida | Construir tema con claves exactas; el tema actual de solicitudes no expone paciente |
| Procedimientos quirúrgicos con tiempos de anestesia y roles de médico | `PCMP`: `AnesthesiaStarts`, `AnesthesiaEnds`, `ProcedureStarts`, `ProcedureEnds`, `PCFRNum`; `PCMPPR` y `PCFRPR`: roles y `PRNum` | Determinar cardinalidad de procedimientos/roles antes de unir y evitar repetir tiempos/importes |
| Alergias del paciente | `PTAL`: `PTNum`, `AllergyNum`, `AllergicSince`, `PTAL_ST` | Identificar catálogo de alergia, significado de estado y permiso específico; no inferir diagnóstico por número |
| Visitantes y tiempos de visita | `PCVL`: `PCNum`, `PCFRNum`, `DateIn`, `DateOut`, estado | Tema nuevo con acceso específico; la exploración no consultó identidades ni teléfonos |

Estas posibilidades se apoyan en campos existentes. No se incorporan automáticamente a los permisos ni autorizan consultar documentos clínicos completos. Tampoco se ejecuta SQL generado libremente por el asistente: cada ampliación debe convertirse en una definición cerrada del catálogo.

## Evidencia y reproducibilidad

- Metadata y comprobaciones sin registros: `tmp/vertical-metadata-2026-10-06.json`.
- Exploración remota de sólo lectura: `tmp/explore-vertical-metadata-2026-10-06.cjs`.
- Captura local de las consultas del catálogo sin conexión: `tmp/capture-vertical-catalog-top-zero-2026-10-06.cjs`.
- SQL de las 25 consultas, con `TOP (0)` explícito: `tmp/vertical-catalog-top-zero-2026-10-06.json`.
- Catálogo implementado: `backend/services/verticalReportCatalog.service.js` y `backend/services/sapReportCatalog.service.js`.
- Pruebas locales de ambos catálogos después de añadir los resúmenes: **58 pruebas aprobadas** con fuentes simuladas. Las comprobaciones reales `TOP (0)` son independientes de esas pruebas y no validan resultados clínicos o financieros.

No se guardaron credenciales, ubicaciones de servidor, definiciones de vistas ni registros personales en esta evidencia. El primer intento de red dentro del sandbox no pudo abrir la conexión; las comprobaciones reales se hicieron con la ejecución autorizada. Una propuesta intermedia de interceptar el conector fue rechazada por revisión automática; se reemplazó por SQL capturado localmente y validación obligatoria de `SELECT TOP (0)` antes de enviarlo a SQL Server.
