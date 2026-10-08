# Exploración de bases y solicitudes de reportes

Revisión del 6 de octubre de 2026.

Se exploraron las conexiones configuradas de SAP, SQL Server Vertical y PostgreSQL. Sólo se recuperó estructura; las selecciones de validación se hicieron sin coincidencias o con TOP(0). No se guardaron registros de pacientes, credenciales ni respuestas hospitalarias.

| Fuente | Estructura visible comprobada | Validación |
| --- | --- | --- |
| SAP Service Layer | 301 tipos de entidad y 333 colecciones; campos clínicos de Document y detalles de artículos, pagos y contabilidad | Orders e Invoices aceptaron selecciones de campos con HTTP 200 y cero filas usando DocEntry = -1. |
| Vertical SQL Server | 478 tablas, 246 vistas y 13,519 columnas | 63 fuentes y los 25 reportes Vertical aceptaron TOP(0); ninguna fila recuperada. |
| PostgreSQL BI | 75 tablas/vistas y 783 columnas | Information schema y claves, dentro de una transacción de sólo lectura. No se consultaron registros. |

Estas cantidades describen objetos visibles para las credenciales utilizadas. La existencia de una columna no autoriza a consultar sus registros ni la convierte automáticamente en un reporte del chat. El catálogo expuesto contiene 64 temas (39 SAP y 25 Vertical), sujetos a los permisos de cada usuario.

## Corrección del caso productivo

La búsqueda guiada confundía «todas las órdenes de venta que tengan» con una columna desconocida; también ignoraba «pacientes» antes de «con». El reconocimiento ahora conserva esos datos, reconoce OV y aclara el origen SAP/Vertical. La propuesta IA está sujeta a la misma aclaración y permisos.

| Reporte | Qué contiene | Relación de paciente | Período |
| --- | --- | --- | --- |
| Órdenes de venta SAP · resumen por orden | Una fila por cabecera, incluso canceladas y sin líneas; estado, marca de cancelación, pagador e importe | U_PTName, U_PTNum y U_PCNum son campos reales; CardName representa cliente/aseguradora. U_SONum se expone como orden Vertical de origen. | Fecha de emisión DocDate. |
| Órdenes de venta Vertical · resumen por orden | Una fila por SO, incluso sin servicios; paciente, cuenta e importe de cabecera | SO.PTNum → PT.PTNum. Se comprobó la clave primaria única/activa de PT. LEFT JOIN conserva órdenes sin paciente relacionado. | Fecha de creación CreatedOn. |
| Pedidos de clientes y aseguradoras (detalle SAP) | Una fila por artículo/servicio; excluye canceladas | Paciente de la propia orden, sin sustituirlo por el pagador. | Fecha de emisión. |
| Órdenes de venta de servicios (detalle Vertical) | Una fila SOLN de servicio; no reúne todos los insumos ni todas las cabeceras | Paciente de la orden. | Fecha de creación de orden. |

Los resúmenes nuevos requieren acceso explícito a sales_order_summary y vertical_sales_orders. Los permisos están disponibles en Administración; no se otorgaron permisos durante esta revisión. No se modificaron las bases.

Pedir «ambas» prepara reportes separados por origen. U_SONum es un vínculo candidato para una conciliación futura; esta revisión estructural no acreditó una correspondencia uno a uno ni la equivalencia de fechas/estados. No se mezclan importes de ambos sistemas ni se afirma que cada orden exista en el otro.

## Ejemplos comprobados con el intérprete guiado

Las siguientes frases se prepararon contra el catálogo completo, sin llamar a la IA ni ejecutar consultas de registros. Para «mes pasado» se fijó el 6 de octubre de 2026; el período resultante fue septiembre de 2026. Listo confirma una configuración, no la existencia de registros ni acceso de cualquier usuario.

| Solicitud | Resultado | Datos o aclaración |
| --- | --- | --- |
| Necesito los pacientes con todas las OV de SAP del 01/09/2026 al 30/09/2026 | Listo | Paciente, Folio SAP |
| Necesito los pacientes con todas las OV de Vertical del 01/09/2026 al 30/09/2026 | Listo | Paciente, Número de orden |
| OV de SAP del mes pasado con paciente, folio SAP y total | Listo | Paciente, Folio SAP, Total en moneda local |
| OV de Vertical del mes pasado con paciente, número de orden y total | Listo | Paciente, Número de orden, Total de orden |
| Cirugías del mes pasado con paciente, médico, procedimiento, status y alta médica | Listo | Paciente, Médicos registrados, Procedimientos, Estado de cuenta, Alta médica |
| Inventario de farma con producto, existencias y costo promedio | Listo | Descripción del Insumo / Medicamento, Existencias disponibles, Costo Promedio ($) |
| Lotes del mes pasado con lote y caducidad | No disponible en ese tema | Este tema muestra información actual y no permite consultar un período histórico. Puedes pedirlo sin fechas o elegir otro tema. |
| Cuentas hospitalarias del mes pasado con paciente y folio | No disponible en ese tema | Este tema no reúne todos los datos que pediste. No tiene «paciente». Puedes pedirlo sin esos datos o elegir otro tema. |
| Citas del mes pasado con paciente y médico | Listo | Paciente, Médico |
| Directorio de médicos con médico y especialidad | Listo | Médico, Especialidad |
| Cuentas por cobrar del mes pasado | Listo | Identificador del documento, Folio SAP, Fecha de emisión, Fecha de vencimiento, Código del socio, Cliente / proveedor, Moneda del documento, Total en moneda local |
| Pagos a proveedores del mes pasado | Listo | Identificador del pago, Folio del pago, Fecha del pago, Código del socio, Cliente / proveedor, Moneda, Efectivo en moneda local, Transferencia en moneda local |
| Detalle de órdenes de servicios del mes pasado con paciente y cantidad | Listo | Paciente, Cantidad |
| Órdenes de compra del mes pasado | Listo | No. Orden Compra, Fecha Emisión, Proveedor, Código Insumo, Descripción del Insumo, Cant. Pedida, Cant. Pendiente, Precio Pactado ($), Total Pedido ($), Estatus Pedido |
| Todas las OV de SAP y Vertical del mes pasado con paciente | Aclaración | Puedo preparar las órdenes de venta de SAP y de Vertical por separado. ¿Cuál quieres generar primero? |

## Posibilidades que requieren ampliar el catálogo

Vertical contiene datos de sexo, nacimiento, diagnóstico, habitación, solicitudes de estudios, recetas, alergias, visitas y roles/tiempos quirúrgicos. No todos están reunidos en los temas actuales. Por ejemplo, «cuentas hospitalarias con paciente» todavía requiere incorporar el nombre; el tema de cuentas ofrece el número del paciente. No se sustituye nombre por número ni se ejecuta omitiendo el dato pedido.

El informe [de estructura Vertical](exploracion-reportes-vertical-2026-10-06.md) enumera las relaciones y ampliaciones candidatas. Faltó permiso VIEW DEFINITION para revisar la definición de las 246 vistas; 68 de las 71 relaciones foráneas habilitadas no acreditan integridad histórica. Se comprobó la unicidad de las claves críticas mediante índices, pero no se presume integridad de otras relaciones sólo por tener nombres similares.

PostgreSQL mantiene copias para tableros (cuentas, pacientes, inventario, movimientos, consulta, estudios y productividad), bitácoras/consulta externa y el flujo de revisión/liquidación de honorarios. No todos estos datos son temas del chat. Las copias requieren comprobar su fecha de sincronización antes de prometer información actual; no se midió esa actualización en esta exploración. Usuarios, roles y configuración no se consideran reportes clínicos por aparecer en la estructura.

Agrupaciones arbitrarias, cruces nuevos, filtros por edad/sexo no habilitados y saldos históricos no se ofrecen como si existieran. Los inventarios actuales no reconstruyen el mes pasado. Los saldos son actuales; honorarios de referencia no prueban pagos. Las fechas y los estados de SAP y Vertical tienen significados propios.

## Catálogo actual y datos que puede seleccionar el usuario

Las columnas siguientes son las etiquetas ofrecidas por cada tema. Para un pedido puede usarse el nombre del tema y seleccionar datos de esta lista; cuando una palabra corresponde a varias columnas, el asistente debe aclarar. «Elegir un tema» permite revisar y configurar directamente los campos disponibles.

### Cuentas por cobrar · facturas abiertas

Origen: SAP. Categoría: Cartera y Saldos.

Saldo actual de facturas abiertas emitidas en el periodo. El saldo refleja las aplicaciones actuales, no un corte histórico.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Fecha de vencimiento; Código del socio; Cliente / proveedor; Moneda del documento; Total en moneda local; Aplicado en moneda local; Saldo actual en moneda local; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por documento. Los saldos son actuales.

Permiso: sap-query-accounts_receivable.

### Cuentas por pagar · facturas abiertas

Origen: SAP. Categoría: Cartera y Saldos.

Saldo actual de facturas abiertas emitidas en el periodo. El saldo refleja las aplicaciones actuales, no un corte histórico.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Fecha de vencimiento; Código del socio; Cliente / proveedor; Moneda del documento; Total en moneda local; Aplicado en moneda local; Saldo actual en moneda local; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por documento. Los saldos son actuales.

Permiso: sap-query-accounts_payable.

### Catálogo de almacenes

Origen: SAP. Categoría: Catálogos Maestros.

Almacenes configurados, ubicación y estado.

Período: información actual; sin período obligatorio.

Datos: Código de almacén; Nombre; Ciudad; Dirección; Inactivo.

Unidad de cada fila: Una fila por almacén.

Permiso: sap-query-warehouses.

### Directorio de clientes y aseguradoras

Origen: SAP. Categoría: Catálogos Maestros.

Socios de negocio con RFC, contacto, moneda, lista de precios y saldo actual.

Período: información actual; sin período obligatorio.

Datos: Código; Razón social; RFC; Teléfono; Correo; Moneda; Saldo actual; Lista de precios.

Unidad de cada fila: Una fila por socio de negocio.

Permiso: sap-query-customers.

### Directorio de proveedores

Origen: SAP. Categoría: Catálogos Maestros.

Socios de negocio con RFC, contacto, moneda, lista de precios y saldo actual.

Período: información actual; sin período obligatorio.

Datos: Código; Razón social; RFC; Teléfono; Correo; Moneda; Saldo actual; Lista de precios.

Unidad de cada fila: Una fila por socio de negocio.

Permiso: sap-query-suppliers.

### Directorio de Proveedores y Socios

Origen: SAP. Categoría: Catálogos Maestros.

Padrón de proveedores activos en SAP, RFC, teléfonos, correos y saldos contables.

Período: información actual; sin período obligatorio.

Datos: Código SAP; Razón Social / Proveedor; Tipo (Proveedor / Cliente); RFC; Teléfono; Correo Electrónico; Saldo de Cuenta ($); Grupo Proveedor; Fecha Alta SAP.

Unidad de cada fila: Una fila por socio de negocio.

Permiso: sap-query-business_partners.

### Grupos de artículos y servicios

Origen: SAP. Categoría: Catálogos Maestros.

Clasificación comercial de artículos y servicios en SAP.

Período: información actual; sin período obligatorio.

Datos: Código del grupo; Grupo de artículos.

Unidad de cada fila: Una fila por grupo de artículos.

Permiso: sap-query-item_groups.

### Maestro de artículos y clasificación sanitaria

Origen: SAP. Categoría: Catálogos Maestros.

Catálogo completo de artículos y servicios, incluso sin existencias, con clasificación, mínimos, máximos y estado.

Período: información actual; sin período obligatorio.

Datos: Código del artículo; Artículo / servicio; Código del grupo; Maneja inventario; Se compra; Se vende; Mínimo general; Máximo general; Estado; Costo promedio general; Clasificación sanitaria; Clasificación adicional; Almacén predeterminado.

Unidad de cada fila: Una fila por artículo o servicio. Mínimos y máximos generales del catálogo.

Permiso: sap-query-item_master_data.

### Precios y costos por artículo y lista

Origen: SAP. Categoría: Catálogos Maestros.

Todas las listas de precios y el costo promedio de artículos y servicios, incluyendo precios en cero y artículos sin stock.

Período: información actual; sin período obligatorio.

Datos: Código del artículo; Artículo / servicio; Número de lista; Lista de precios; Precio; Moneda; Costo promedio general en moneda local.

Unidad de cada fila: Una fila por artículo y lista de precios. El costo promedio se repite por lista; precios y costos son unitarios.

Permiso: sap-query-item_prices.

### Cotizaciones de proveedores

Origen: SAP. Categoría: Compras y Proveedores.

Detalle por artículo o servicio, con cantidades, importes y estado. Excluye documentos cancelados.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Código del socio; Cliente / proveedor; Número de línea; Código del artículo; Artículo / servicio; Cantidad; Cantidad pendiente; Precio unitario del documento; Subtotal en moneda local; Moneda del documento; Almacén; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por línea del documento. El importe corresponde al subtotal de cada línea.

Permiso: sap-query-purchase_quotations.

### Devoluciones a Proveedores

Origen: SAP. Categoría: Compras y Proveedores.

Consulta los productos devueltos a proveedores por caducidad, daño o exceso de existencias.

Período: Fecha de Devolución.

Datos: Folio Devolución; Fecha Devolución; Cód. Proveedor; Proveedor / Laboratorio; Código Insumo; Descripción del Insumo; Cant. Devuelta; Costo Unitario ($); Importe Devolución ($); Total Devolución ($); Almacén Origen; Motivo de Devolución.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-goods_returns.

### Facturas de proveedores · resumen por documento

Origen: SAP. Categoría: Compras y Proveedores.

Una fila por documento vigente, con total, importe aplicado y saldo actual; excluye documentos cancelados.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Fecha de vencimiento; Código del socio; Cliente / proveedor; Moneda del documento; Total en moneda local; Aplicado en moneda local; Saldo actual en moneda local; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por documento. Los saldos son actuales.

Permiso: sap-query-purchase_invoice_summary.

### Facturas de Proveedores (Compras)

Origen: SAP. Categoría: Compras y Proveedores.

Consulta las facturas de proveedores, los precios de compra, los impuestos y las fechas de registro.

Período: Fecha de registro.

Datos: Folio Factura SAP; Fecha de registro; Fecha Vencimiento; Cód. Proveedor; Proveedor / Razón Social; Código Artículo; Descripción Insumo Facturado; Cant. Comprada; Precio Unitario Compra ($); Subtotal Línea ($); IVA / Impuesto ($); Total Factura ($); Almacén Entrada; Observaciones / Folio Fiscal.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-purchase_invoices.

### Notas de crédito de proveedores

Origen: SAP. Categoría: Compras y Proveedores.

Detalle por artículo o servicio, con cantidades, importes y estado. Excluye documentos cancelados.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Código del socio; Cliente / proveedor; Número de línea; Código del artículo; Artículo / servicio; Cantidad; Cantidad pendiente; Precio unitario del documento; Subtotal en moneda local; Moneda del documento; Almacén; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por línea del documento. El importe corresponde al subtotal de cada línea.

Permiso: sap-query-purchase_credit_memos.

### Órdenes de Compra a Proveedores

Origen: SAP. Categoría: Compras y Proveedores.

Pedidos emitidos a proveedores, cantidades solicitadas vs pendientes de entrega y estatus.

Período: Fecha de Emisión de Orden.

Datos: No. Orden Compra; Fecha Emisión; Fecha Entrega Prometida; Proveedor; Estatus Pedido; Código Insumo; Descripción del Insumo; Cant. Pedida; Cant. Pendiente; Precio Pactado ($); Importe Línea ($); Total Pedido ($); Observaciones.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-purchase_orders.

### Recepciones de Mercancía (Entradas)

Origen: SAP. Categoría: Compras y Proveedores.

Insumos recibidos físicamente en almacén/farmacia de proveedores pendientes de facturar.

Período: Fecha de Recepción.

Datos: Folio Entrada SAP; Fecha Recepción; Fecha Vencimiento; Cód. Proveedor; Proveedor / Razón Social; Código Artículo; Descripción del Insumo; Cant. Recibida; Precio Unitario ($); Subtotal Línea ($); Total Recepción ($); Almacén Destino; Observaciones / Remisión.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-goods_receipts_po.

### Requisiciones y Solicitudes de Compra

Origen: SAP. Categoría: Compras y Proveedores.

Solicitudes internas de material y medicamentos generadas por las distintas áreas hospitalarias.

Período: Fecha de Requisición.

Datos: No. Requisición; Fecha Solicitud; Fecha Requerida; Usuario Solicitante; Área / Departamento; Estatus; Código Insumo; Insumo Solicitado; Cant. Solicitada; Justificación.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-purchase_requests.

### Asientos y movimientos contables

Origen: SAP. Categoría: Contabilidad y Centros de Costo.

Cargos y abonos por línea contable, cuenta, referencia y centro de costo.

Período: Fecha contable.

Datos: Asiento; Fecha contable; Línea; Cuenta contable; Socio / cuenta auxiliar; Cargo en moneda local; Abono en moneda local; Centro de costo; Proyecto; Concepto; Referencia 1; Referencia 2.

Unidad de cada fila: Una fila por línea contable. Los cargos y abonos se presentan por separado.

Permiso: sap-query-journal_entries.

### Catálogo de cuentas contables

Origen: SAP. Categoría: Contabilidad y Centros de Costo.

Plan contable, niveles, cuenta superior y saldos actuales por moneda de cuenta.

Período: información actual; sin período obligatorio.

Datos: Código de cuenta; Nombre de cuenta; Nivel; Cuenta superior; Moneda de cuenta; Saldo actual en moneda local; Código de presentación.

Unidad de cada fila: Una fila por cuenta contable. Los saldos de distintos niveles no se suman.

Permiso: sap-query-chart_accounts.

### Centros de costo y dimensiones

Origen: SAP. Categoría: Contabilidad y Centros de Costo.

Centros de costo con su dimensión, vigencia y estado.

Período: información actual; sin período obligatorio.

Datos: Código; Centro de costo; Dimensión; Activo; Vigencia desde; Vigencia hasta.

Unidad de cada fila: Una fila por centro de costo.

Permiso: sap-query-cost_centers.

### Lotes y Caducidades de Insumos

Origen: SAP. Categoría: Control de Caducidades.

Números de lote activos, fechas de caducidad, días restantes para vencimiento y almacén.

Período: información actual; sin período obligatorio.

Datos: Código del Artículo; Medicamento / Insumo; Número de Lote; Almacén; Cantidad en Lote; Fecha Ingreso; Fecha Caducidad; Días por Vencer; Estatus del Lote.

Unidad de cada fila: Una fila por lote, artículo y almacén.

Permiso: sap-query-batches.

### Facturación e Ingresos Hospitalarios

Origen: SAP. Categoría: Facturación e Ingresos.

Facturación emitida a pacientes, aseguradoras y empresas por hospitalización, servicios y medicamentos.

Período: Fecha de Facturación.

Datos: Folio Factura Venta; Fecha Factura; Fecha Vencimiento; Cód. Cliente/Paciente; Paciente / Aseguradora / Razón Social; Médico Tratante / Especialista; Código Concepto; Concepto / Medicamento Facturado; Cantidad; Precio Unitario ($); Importe Línea ($); IVA ($); Total Factura ($); Almacén Salida; Observaciones / Cuenta.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-sales_invoices.

### Facturas de clientes · resumen por documento

Origen: SAP. Categoría: Facturación e Ingresos.

Una fila por documento vigente, con total, importe aplicado y saldo actual; excluye documentos cancelados.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Fecha de vencimiento; Código del socio; Cliente / proveedor; Moneda del documento; Total en moneda local; Aplicado en moneda local; Saldo actual en moneda local; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por documento. Los saldos son actuales.

Permiso: sap-query-sales_invoice_summary.

### Notas de Crédito a Clientes (Devoluciones)

Origen: SAP. Categoría: Facturación e Ingresos.

Devoluciones, cancelaciones y notas de crédito aplicadas a cuentas hospitalarias y facturas de clientes.

Período: Fecha de Nota de Crédito.

Datos: Folio Nota Crédito; Fecha Emisión; Cód. Cliente; Paciente / Aseguradora; Código Concepto; Concepto Cancelado / Devuelto; Cant. Bonificada; Precio Unitario ($); Importe Cancelado ($); Total Nota Crédito ($); Motivo de Cancelación / Descuento.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-credit_memos.

### Disponibilidad, comprometido y en pedido

Origen: SAP. Categoría: Inventarios y Stock.

Existencias por almacén incluyendo stock cero, cantidades comprometidas, pedidos, mínimos y máximos.

Período: información actual; sin período obligatorio.

Datos: Código del artículo; Artículo; Almacén; Existencias; Comprometido; En pedido; Disponible proyectado; Mínimo del almacén; Máximo del almacén.

Unidad de cada fila: Una fila por artículo y almacén. Disponible proyectado = existencias − comprometido + en pedido.

Permiso: sap-query-stock_availability.

### Inventario por almacén

Origen: SAP. Categoría: Inventarios y Stock.

Existencias actuales, costos y precios en Farmacia, Quirófano, Carro Rojo y Almacén General.

Período: información actual; sin período obligatorio.

Datos: Código del Artículo; Descripción del Insumo / Medicamento; Cód. Almacén; Nombre del Almacén; Existencias disponibles; Último Costo Compra ($); Costo Promedio ($); Precio Hospitalización ($); Precio Público General ($); Margen Teórico (%); Grupo de Artículos; Laboratorio / Tipo; Tipo de medicamento; Clasificación adicional.

Unidad de cada fila: Una fila por artículo y almacén.

Permiso: sap-query-inventory.

### Entradas Directas y Ajustes Positivos

Origen: SAP. Categoría: Movimientos de Almacén.

Ajustes positivos de inventario físico, altas directas de material y donaciones.

Período: Fecha de Entrada.

Datos: Folio Entrada SAP; Fecha Entrada; Código Insumo; Descripción Insumo; Cant. Ingresada; Costo Valuado ($); Valor Total ($); Almacén Destino; Concepto / Justificación.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-goods_receipts_inv.

### Salidas de Inventario (Mermas / Bajas)

Origen: SAP. Categoría: Movimientos de Almacén.

Bajas de caducados, mermas, consumos de centros de costos y ajustes negativos de inventario.

Período: Fecha de Salida.

Datos: Folio Salida SAP; Fecha Salida; Código Insumo; Descripción del Insumo; Cant. Dada de Baja; Costo Unitario ($); Costo Total Baja ($); Almacén Origen; Motivo / Justificación.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-goods_issues.

### Solicitudes de Traslado entre Almacenes

Origen: SAP. Categoría: Movimientos de Almacén.

Solicitudes de reabastecimiento generadas por las áreas (Farmacia/Quirófano) hacia Almacén General.

Período: Fecha de Solicitud.

Datos: No. Solicitud; Fecha Solicitud; Fecha Requerida; Almacén Origen (De); Almacén Destino (A); Estatus; Código Insumo; Descripción Insumo; Cant. Solicitada; Cant. Pendiente; Justificación / Área.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-transfer_requests.

### Traslados entre Almacenes Realizados

Origen: SAP. Categoría: Movimientos de Almacén.

Movimientos de insumos entre Almacén General, Farmacia, Quirófano y Carro Rojo con fechas y cantidades.

Período: Fecha de Traslado.

Datos: Folio Traslado; Fecha Traslado; Almacén Origen (De); Almacén Destino (A); Código Insumo; Descripción Insumo; Cant. Trasladada; Motivo / Comentarios.

Unidad de cada fila: Una fila por línea de documento. El total del documento se repite en sus líneas; utiliza el subtotal de línea para sumar.

Permiso: sap-query-stock_transfers.

### Anticipos a proveedores

Origen: SAP. Categoría: Tesorería y Pagos.

Una fila por documento vigente, con total, importe aplicado y saldo actual; excluye documentos cancelados.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Fecha de vencimiento; Código del socio; Cliente / proveedor; Moneda del documento; Total en moneda local; Aplicado en moneda local; Saldo actual en moneda local; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por documento. Los saldos son actuales.

Permiso: sap-query-purchase_down_payments.

### Anticipos de clientes

Origen: SAP. Categoría: Tesorería y Pagos.

Una fila por documento vigente, con total, importe aplicado y saldo actual; excluye documentos cancelados.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Fecha de vencimiento; Código del socio; Cliente / proveedor; Moneda del documento; Total en moneda local; Aplicado en moneda local; Saldo actual en moneda local; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por documento. Los saldos son actuales.

Permiso: sap-query-sales_down_payments.

### Cobros recibidos · medios de pago

Origen: SAP. Categoría: Tesorería y Pagos.

Una fila por pago vigente, con efectivo, transferencias, tarjetas y cheques. El total suma estos medios de pago.

Período: Fecha del pago.

Datos: Identificador del pago; Folio del pago; Fecha del pago; Código del socio; Cliente / proveedor; Moneda; Efectivo en moneda local; Transferencia en moneda local; Tarjetas; Cheques; Total de medios en moneda local; Observación del total; Referencia; Fecha de transferencia; Observaciones.

Unidad de cada fila: Una fila por pago; el total corresponde a los medios de pago registrados.

Permiso: sap-query-incoming_payments.

### Pagos efectuados a proveedores

Origen: SAP. Categoría: Tesorería y Pagos.

Una fila por pago vigente, con efectivo, transferencias, tarjetas y cheques. El total suma estos medios de pago.

Período: Fecha del pago.

Datos: Identificador del pago; Folio del pago; Fecha del pago; Código del socio; Cliente / proveedor; Moneda; Efectivo en moneda local; Transferencia en moneda local; Tarjetas; Cheques; Total de medios en moneda local; Observación del total; Referencia; Fecha de transferencia; Observaciones.

Unidad de cada fila: Una fila por pago; el total corresponde a los medios de pago registrados.

Permiso: sap-query-outgoing_payments.

### Cotizaciones de servicios y ventas

Origen: SAP. Categoría: Ventas y Servicios.

Detalle por artículo o servicio, con cantidades, importes y estado. Excluye documentos cancelados.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Código del socio; Cliente / proveedor; Número de línea; Código del artículo; Artículo / servicio; Cantidad; Cantidad pendiente; Precio unitario del documento; Subtotal en moneda local; Moneda del documento; Almacén; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por línea del documento. El importe corresponde al subtotal de cada línea.

Permiso: sap-query-sales_quotations.

### Devoluciones de clientes

Origen: SAP. Categoría: Ventas y Servicios.

Detalle por artículo o servicio, con cantidades, importes y estado. Excluye documentos cancelados.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Código del socio; Cliente / proveedor; Número de línea; Código del artículo; Artículo / servicio; Cantidad; Cantidad pendiente; Precio unitario del documento; Subtotal en moneda local; Moneda del documento; Almacén; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por línea del documento. El importe corresponde al subtotal de cada línea.

Permiso: sap-query-sales_returns.

### Entregas a clientes

Origen: SAP. Categoría: Ventas y Servicios.

Detalle por artículo o servicio, con cantidades, importes y estado. Excluye documentos cancelados.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Código del socio; Cliente / proveedor; Número de línea; Código del artículo; Artículo / servicio; Cantidad; Cantidad pendiente; Precio unitario del documento; Subtotal en moneda local; Moneda del documento; Almacén; Estado del documento; Observaciones.

Unidad de cada fila: Una fila por línea del documento. El importe corresponde al subtotal de cada línea.

Permiso: sap-query-sales_deliveries.

### Órdenes de venta SAP · resumen por orden

Origen: SAP. Categoría: Ventas y Servicios.

Todas las órdenes de venta SAP emitidas en el periodo, con paciente registrado, cliente o aseguradora e importe de cabecera; incluye canceladas y órdenes sin líneas.

Período: Fecha de emisión.

Datos: Identificador de orden; Folio SAP; Fecha de emisión; Estado de orden SAP; Cancelada; Paciente; Número de paciente; Folio de atención; Código del cliente; Cliente / aseguradora; Moneda del documento; Total en moneda local; Orden Vertical de origen.

Unidad de cada fila: Una fila por orden de venta SAP (DocEntry). Los importes corresponden a la cabecera e incluyen órdenes canceladas.

Permiso: sap-query-sales_order_summary.

### Pedidos de clientes y aseguradoras

Origen: SAP. Categoría: Ventas y Servicios.

Órdenes de venta por artículo o servicio, con paciente registrado, cantidades, importes y estado. Excluye documentos cancelados.

Período: Fecha de emisión.

Datos: Identificador del documento; Folio SAP; Fecha de emisión; Código del socio; Cliente / proveedor; Número de línea; Código del artículo; Artículo / servicio; Cantidad; Cantidad pendiente; Precio unitario del documento; Subtotal en moneda local; Moneda del documento; Almacén; Estado del documento; Observaciones; Paciente; Número de paciente; Folio de atención.

Unidad de cada fila: Una fila por línea del documento. El importe corresponde al subtotal de cada línea.

Permiso: sap-query-sales_orders.

### Catálogo de servicios de Vertical

Origen: Vertical. Categoría: Catálogos Clínicos.

Servicios disponibles, grupo, descripción, unidad de medida y habilitación de la ficha clínica.

Período: información actual; sin período obligatorio.

Datos: Código de servicio; Nombre; Descripción; Grupo de servicios; Código de grupo; Habilitado; Unidad de medida; Tipo de artículo; Artículo de venta; Origen de ficha; Centro de ficha.

Unidad de cada fila: Una fila de ficha de servicio de V_IT por origen y artículo; un código puede tener varios orígenes.

Permiso: sap-query-vertical_service_catalog.

### Directorio de médicos y especialidades

Origen: Vertical. Categoría: Catálogos Clínicos.

Médicos de Vertical, especialidad, actividad y permisos de consulta y recetas.

Período: información actual; sin período obligatorio.

Datos: Número de médico; Médico; Código de especialidad; Especialidad; Activo en Vertical; Tipo de médico; Permite citas; Emite recetas; Presta servicios externos.

Unidad de cada fila: Una fila por médico con rol P (PRNum).

Permiso: sap-query-vertical_physicians.

### Agenda de consulta externa

Origen: Vertical. Categoría: Consulta Externa.

Citas programadas con paciente, médico, especialidad y estados originales de cita y orden.

Período: Fecha programada.

Datos: Número de cita; Fecha programada; Hora programada; Médico; Especialidad; Número de paciente; Paciente; Estado de cita; Servicio; Realización registrada; Grupo de ejecución; Estado de orden Vertical; Orden vinculada en cita; Orden vinculada en venta; Estado de pago según vista; Factura pagada registrada; Diagnóstico; Comentarios; Número de médico.

Unidad de cada fila: Una fila de la agenda de citas de Vertical (UDR_CPP).

Permiso: sap-query-vertical_consultation_schedule.

### Consulta del día y órdenes vinculadas

Origen: Vertical. Categoría: Consulta Externa.

Consultas del periodo, servicios y estados de orden reportados por la vista clínica del día.

Período: Fecha de consulta.

Datos: Número de cita; Fecha de consulta; Hora de consulta; Médico; Especialidad; Número de paciente; Paciente; Estado de orden; Servicio; Edad en años; Número de médico.

Unidad de cada fila: Una fila de la vista de consulta del día (V_UDR_CONSULTA_DIA).

Permiso: sap-query-vertical_consultations_day.

### Cobros de imagenología y auxiliares

Origen: Vertical. Categoría: Estudios y Auxiliares.

Detalle de cobros de auxiliares con fecha del cargo original y total de línea de la vista.

Período: Fecha de cargo.

Datos: Número de cargo; Fecha de cargo; Unidad de servicio; Tipo de línea; Paciente; Código de artículo; Artículo o servicio; Cantidad; Total de línea.

Unidad de cada fila: Una fila de UDR_PAY_IMA, vinculada a su cargo PCIT por PCITNum.

Permiso: sap-query-vertical_auxiliary_charges.

### Solicitudes de estudios y auxiliares

Origen: Vertical. Categoría: Estudios y Auxiliares.

Estudios solicitados por área, médico y tipo de atención, con cantidades registradas.

Período: Fecha de solicitud.

Datos: Número de solicitud; Fecha de solicitud; Estudio; Código de área; Área; Médico; Tipo de atención; Cantidad.

Unidad de cada fila: Una fila por solicitud de estudio (PCPRITNum).

Permiso: sap-query-vertical_study_requests.

### Recetas y tratamientos indicados

Origen: Vertical. Categoría: Farmacia Clínica.

Renglones de receta, medicamento, vía, frecuencia e instrucciones del tratamiento.

Período: Inicio del tratamiento.

Datos: Número de receta; Renglón de receta; Inicio del tratamiento; Paciente; Médico; Medicamento; Frecuencia; Vía de administración; Instrucciones; Fin del tratamiento; Dispensación registrada; Dosis total registrada; Horario registrado; Cédula médica; Descripción de artículo.

Unidad de cada fila: Una fila por renglón de receta según UDR_RECETA_MEDICA (PCRXNum y NLINEA).

Permiso: sap-query-vertical_prescriptions.

### Tickets de devolución de insumos clínicos

Origen: Vertical. Categoría: Farmacia Clínica.

Detalle de devoluciones clínicas por solicitud, paciente, artículo y lote.

Período: Fecha de registro de devolución.

Datos: Número de solicitud; Folio de atención; Fecha de registro; Paciente; Unidad de servicio; Habitación o recurso; Código de artículo; Artículo; Lote; Caducidad; Cantidad; Precio unitario; Importe de línea; Impuesto de línea; Total de línea; Registrado por; Fecha de proceso; Usuario de proceso.

Unidad de cada fila: Una fila original de ticket de devolución de UDR_ticket_fr_dev; conserva el signo del importe y cantidad.

Permiso: sap-query-vertical_clinical_return_tickets.

### Tickets de insumos y lotes por atención

Origen: Vertical. Categoría: Farmacia Clínica.

Insumos clínicos por paciente y solicitud, con lote, caducidad, cantidad e importe original.

Período: Fecha de registro de ticket.

Datos: Número de solicitud; Folio de atención; Fecha de registro; Paciente; Unidad de servicio; Habitación o recurso; Código de artículo; Artículo; Lote; Caducidad; Cantidad; Precio unitario; Importe de línea; Impuesto de línea; Total de línea; Registrado por; Fecha de proceso; Usuario de proceso.

Unidad de cada fila: Una fila de detalle de ticket clínico de UDR_TICKET_FR; conserva el lote de cada renglón.

Permiso: sap-query-vertical_clinical_supply_tickets.

### Honorarios: cálculo de referencia Vertical

Origen: Vertical. Categoría: Honorarios Médicos.

Base e IVA calculados por Vertical, tabulador y alertas. Estos importes no acreditan un pago aplicado.

Período: Fecha de atención.

Datos: Referencia Vertical; Folio de atención; Fecha de atención; Paciente; Médico; Especialidad; Código de servicio; Servicio; Cantidad; Pagador; Grupo de artículos; Tipo de médico; Número de orden; Estado de cita Vertical; Estado de orden Vertical; Importe unitario de referencia; Base de referencia; IVA de referencia; Sin tabulador; Alerta de auditoría; Vínculo de cita ambiguo; Órdenes relacionadas.

Unidad de cada fila: Una fila de cálculo en UDR_HON_PAGO; no representa un movimiento de pago.

Permiso: sap-query-vertical_fee_reference.

### Honorarios: universo y auditoría Vertical

Origen: Vertical. Categoría: Honorarios Médicos.

Universo completo de la vista de auditoría, incluyendo exclusiones y reglas de elegibilidad de Vertical.

Período: Fecha de atención.

Datos: Referencia Vertical; Folio de atención; Fecha de atención; Paciente; Médico; Especialidad; Código de servicio; Servicio; Cantidad; Pagador; Grupo de artículos; Tipo de médico; Número de orden; Estado de cita Vertical; Estado de orden Vertical; Origen del renglón; Precio registrado; Importe de referencia de auditoría; IVA de referencia; Elegibilidad según Vertical; Motivo de exclusión; Pasa regla de estado; Pasa regla de artículo; Pasa regla de tabulador; Pasa regla de inclusión.

Unidad de cada fila: Una fila original de auditoría en UDR_HON_PAGO_Audit; no implica aprobación o liquidación en BI.

Permiso: sap-query-vertical_fee_audit.

### Altas y egresos hospitalarios

Origen: Vertical. Categoría: Hospitalización y Cuentas.

Altas registradas por atención, paciente, tipo de atención y motivo o tipo de alta.

Período: Fecha de alta.

Datos: Folio de atención; Fecha de alta; Número de paciente; Paciente; Tipo de atención; Código de tipo de atención; Tipo de alta; Código de alta.

Unidad de cada fila: Una fila de alta médica reportada por UDR_ATM_EGRESO.

Permiso: sap-query-vertical_discharges.

### Cartera y saldos de cuentas hospitalarias

Origen: Vertical. Categoría: Hospitalización y Cuentas.

Cuentas por cobrar, abonos, saldo pendiente, antigüedad y convenio de la vista de cartera.

Período: Fecha de ingreso.

Datos: Folio de atención; Fecha de ingreso; Paciente; Tipo de atención; Médico; Convenio; Total facturado; Total abonado; Saldo pendiente actual; Total devuelto; Porcentaje cobrado; Estado de atención; Antigüedad del saldo; Días desde término; Cartera vencida; Fecha de alta; Fecha de cierre; Número de paciente; Número de médico.

Unidad de cada fila: Una fila de cuenta en UDR_BI_CARTERA; los saldos son valores actuales al consultar.

Permiso: sap-query-vertical_receivables.

### Cuentas y atenciones hospitalarias

Origen: Vertical. Categoría: Hospitalización y Cuentas.

Cuentas clínicas con ingreso, alta, médico, total, anticipos y saldo registrados en Vertical.

Período: Fecha de atención.

Datos: Folio de atención; Fecha de atención; Número de paciente; Tipo de atención; Estado Vertical; Código de pagador; Número de médico; Total registrado; Saldo registrado; Anticipos; Costo registrado; Utilidad registrada; Fecha de alta médica; Fecha de cierre; Fecha de creación.

Unidad de cada fila: Una fila por cuenta o atención médica (PCNum).

Permiso: sap-query-vertical_accounts.

### Detalle de cargos de cuentas

Origen: Vertical. Categoría: Hospitalización y Cuentas.

Artículos y servicios cargados a cada atención: cantidad y precio unitario originales.

Período: Fecha de cargo.

Datos: Número de cargo; Folio de atención; Fecha de cargo; Unidad de servicio; Código de artículo; Artículo o servicio; Cantidad; Precio unitario.

Unidad de cada fila: Una fila por cargo de cuenta (PCITNum).

Permiso: sap-query-vertical_account_charges.

### Habitaciones y estancias

Origen: Vertical. Categoría: Hospitalización y Cuentas.

Estancias por habitación con paciente, médico, fecha de entrada, cierre y estados nativos.

Período: Fecha de entrada a estancia.

Datos: Folio de atención; Entrada a estancia; Paciente; Habitación o recurso; Médico; Fecha de cierre; Estado de estancia Vertical; Estado de recurso Vertical; Número de paciente; Modificado por.

Unidad de cada fila: Una fila de estancia/habitación de UDR_RPT_HABITACION; una atención puede tener varias estancias.

Permiso: sap-query-vertical_room_stays.

### Consultas e ingresos médicos por mes

Origen: Vertical. Categoría: Productividad e Indicadores.

Consultas e ingresos mensuales por médico registrados en la vista de ingresos de Vertical.

Período: Mes de ingresos (primer día del mes).

Datos: Periodo (primer día del mes); Número de médico; Médico; Año; Mes; Nombre del mes; Consultas del mes; Ingresos registrados en vista.

Unidad de cada fila: Una fila por médico y mes de UDR_BI_INGRESOS_MEDICOS; ingresos clínicos de referencia de la vista.

Permiso: sap-query-vertical_physician_revenue_monthly.

### Indicadores operativos por periodo

Origen: Vertical. Categoría: Productividad e Indicadores.

Ocupación y tiempos de triaje, laboratorio, imagenología y egreso con metas de la vista.

Período: Fecha del periodo.

Datos: Fecha del periodo; Año; Mes; Camas ocupadas; Quirófanos activos; Urgencias; Hospitalización; Triaje: minutos; Triaje: meta; Triaje: fuera de meta; Triaje: registros; Triaje: estado; Laboratorio: minutos; Laboratorio: meta; Laboratorio: fuera de meta; Laboratorio: registros; Laboratorio: estado; Imagenologia: minutos; Imagenologia: meta; Imagenologia: fuera de meta; Imagenologia: registros; Imagenologia: estado; Egreso: horas; Egreso: meta; Egreso: registros; Egreso: estado.

Unidad de cada fila: Una fila por periodo consolidado; los tiempos y ocupaciones no deben sumarse entre periodos.

Permiso: sap-query-vertical_operational_indicators.

### Productividad médica diaria

Origen: Vertical. Categoría: Productividad e Indicadores.

Primeras consultas, subsecuentes y atenciones por médico, especialidad y día.

Período: Fecha de atención.

Datos: Fecha; Médico; Especialidad; Primeras consultas; Consultas subsecuentes; Total de atenciones.

Unidad de cada fila: Una fila por médico, especialidad y fecha de la vista de productividad.

Permiso: sap-query-vertical_physician_productivity.

### Cirugías y uso de quirófano

Origen: Vertical. Categoría: Quirófano.

Cirugías con paciente, sala, médicos, procedimientos y estado actual de la cuenta y del alta médica.

Período: Inicio de cirugía.

Datos: Número de estancia quirúrgica; Inicio; Fin; Quirófano; Número de paciente; Paciente; Médicos registrados; Procedimientos; Folio de atención; Estado de cuenta; Alta médica; Fecha de alta médica; Fecha de cierre de cuenta.

Unidad de cada fila: Una fila por cirugía registrada.

Permiso: sap-query-vertical_surgeries.

### Cargos por unidad de servicio

Origen: Vertical. Categoría: Servicios Clínicos.

Cargos, devoluciones, descuentos y médicos de urgencias, quirófano, consulta y otros servicios.

Período: Fecha de cargo.

Datos: Folio de atención; Número de cargo; Fecha de cargo; Unidad de servicio; Paciente; Código de artículo; Artículo o servicio; Cantidad; Cantidad devuelta; Total cobrado en la vista; Precio unitario; Descuento; Importe sin descuento; Importe de referencia del subrogado; Número de orden; Estado de cuenta Vertical; Fecha de cierre; Grupo de artículos; Médico solicitante; Médico tratante; Anestesiólogo; Estado de devolución; Fecha de devolución.

Unidad de cada fila: Una fila de detalle de la vista de cuentas de servicios; conserva sus cargos y devoluciones.

Permiso: sap-query-vertical_service_charges.

### Devoluciones clínicas por mes

Origen: Vertical. Categoría: Servicios Clínicos.

Resumen mensual de artículos devueltos por unidad, usuario y artículo.

Período: Mes de devolución (primer día del mes).

Datos: Periodo (primer día del mes); Año; Mes; Nombre del mes; Código de artículo; Artículo; Unidad de servicio; Eventos de devolución; Cantidad devuelta; Monto devuelto; Creado por; Modificado por.

Unidad de cada fila: Una fila agregada de devoluciones por mes y dimensiones de UDR_BI_DEVOLUCIONES.

Permiso: sap-query-vertical_returns_monthly.

### Órdenes de venta de servicios

Origen: Vertical. Categoría: Servicios Clínicos.

Líneas de servicio de órdenes Vertical, con paciente registrado, precio, cantidad, total de línea y estado real.

Período: Fecha de creación de orden.

Datos: Número de orden; Número de línea; Creación de orden; Código de servicio; Servicio; Cantidad; Precio unitario; Total de línea; Estado de orden Vertical; Estado de línea Vertical; Folio de atención; Número de paciente; Paciente; Número de médico solicitante; Código de pagador; Grupo de servicios; Inicio programado (texto de origen); Fin programado (texto de origen); Realización registrada.

Unidad de cada fila: Una fila por línea de servicio (SOLNNum); el total de cabecera no se repite en las líneas.

Permiso: sap-query-vertical_service_orders.

### Órdenes de venta Vertical · resumen por orden

Origen: Vertical. Categoría: Servicios Clínicos.

Todas las órdenes de venta Vertical del periodo, con paciente, folio de atención e importes de cabecera; incluye órdenes sin líneas de servicio.

Período: Fecha de creación de orden.

Datos: Número de orden; Creación de orden; Estado de orden Vertical; Número de paciente; Folio de atención; Paciente; Número de médico solicitante; Código de pagador; Tipo de orden Vertical; Subtotal de orden; Impuesto de orden; Total de orden.

Unidad de cada fila: Una fila por orden de venta (SONum). Los importes corresponden a la cabecera de cada orden.

Permiso: sap-query-vertical_sales_orders.

### Servicios subrogados: importes de referencia

Origen: Vertical. Categoría: Servicios Clínicos.

Detalle clínico de cargos subrogados e importe a pagar calculado por la vista de Vertical.

Período: Fecha de cargo.

Datos: Folio de atención; Número de cargo; Fecha de cargo; Unidad de servicio; Paciente; Código de artículo; Artículo o servicio; Cantidad; Cantidad devuelta; Total cobrado en la vista; Precio unitario; Descuento; Importe sin descuento; Importe de referencia del subrogado; Número de orden; Estado de cuenta Vertical; Fecha de cierre; Grupo de artículos.

Unidad de cada fila: Una fila de cargo subrogado en UDR_PAGO_SUBROGADOS; no acredita una transferencia efectuada.

Permiso: sap-query-vertical_subcontracted_services.

## Evidencia y producción

Metadatos locales: tmp/report-sap-pg-metadata-2026-10-06.json, tmp/vertical-metadata-2026-10-06.json y tmp/report-capabilities-2026-10-06.json. Son estructura y propuestas, sin registros hospitalarios. Las pruebas de navegador y catálogos usan datos ficticios; no certifican que los registros reales estén completos.

La causa exacta de la conexión IA productiva sigue pendiente de ejecutar el [diagnóstico seguro](incidencia-ia-produccion-2026-10-06.md) desde el servidor. Este trabajo no cambió su configuración ni reinició el servidor productivo.
