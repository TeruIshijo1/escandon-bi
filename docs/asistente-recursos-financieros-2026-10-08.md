# Recursos financieros y administrativos del asistente de reportes

La ampliación se usa desde **Crear con asistente**. El selector manual conserva sus 64 temas. El asistente dispone de 631 capacidades internas autorizadas: cuatro reportes específicos, 416 recursos de esquema, 48 relaciones entre recursos de Vertical y 163 relaciones por código exacto con SAP. No se ejecuta SQL ni se inventan relaciones o fórmulas a partir de una respuesta de IA.

## Acuerdos y estados de cuenta

Los convenios maestros provienen de `dbo.AG`, confirmado por el usuario. Se ofrecen nombre y código, pagador, lista y tabulador, descuento global en porcentaje, factor de precio, condiciones de deducible, copago y coaseguro, cargos administrativos, descuentos adicionales e impuestos. Los descuentos adicionales cuyo significado porcentual no se ha confirmado conservan su unidad registrada.

La revisión del esquema y del catálogo confirmó que `Deductible`, `CopayAmount`, `CopayPercentage`, `Coinsurance` y `CoinsurancePercentage` son referencias de texto a conceptos, no importes ni porcentajes. Cada referencia muestra su código y, cuando existe una descripción inequívoca para ese código exacto en `V_IT`, su nombre. Los cuatro campos `DefaultDeductible`, `DefaultCopayAmount`, `DefaultCopayPercentage` y `DefaultCoinsurancePercentage` muestran por separado los valores numéricos predeterminados. No existe un importe predeterminado de coaseguro en este maestro. Solicitar una condición incluye su código, descripción y valor predeterminado disponible; pedir expresamente los valores predeterminados permite seleccionar sólo esos números.

Los códigos conservan los nombres registrados, aunque una descripción resulte inesperada para la condición en que se configuró. Una descripción faltante o ambigua queda vacía. La consulta agrega el catálogo por código y conserva una fila por convenio, sin duplicarla por artículos de distintas compañías. Los valores de este maestro describen la configuración del convenio: no sustituyen los importes aplicados a una atención en `PCAG`.

La solicitud «Necesito los acuerdos con descuentos, dedicibles, copagos y coaseguros» reconoce el tema y corrige la escritura de deducibles. Cuando hay varias medidas de descuento o copago, pregunta por la medida y conserva cada elección durante las aclaraciones siguientes. El símbolo `%` distingue una columna porcentual de una monetaria; elegir «Copago del convenio» o «Copago del convenio (%)» ya no repite la pregunta. El resultado identifica el convenio por código y nombre junto con las condiciones solicitadas; una instrucción explícita como «Solo descuento global registrado (%)» permite limitar las columnas.

La misma resolución funciona para columnas administrativas obtenidas del esquema, como importe, porcentaje o descripción del cargo administrativo. Las elecciones se conservan en el borrador también cuando una conversación extensa supera las cuatro respuestas recientes. Una elección sólo resuelve una ambigüedad si corresponde a uno de sus campos autorizados; no reemplaza datos desconocidos ni agrega las columnas predeterminadas cuando todavía se están aclarando columnas específicas.

Las cuentas se relacionan con paciente, médico, convenios aplicados y pagador. Se conservan cuentas sin convenio y varios convenios de una atención. El descuento del convenio maestro y el aplicado a la atención son columnas diferentes; no se sustituye uno por otro cuando falta un valor. Total, saldo y anticipos de cuenta se repiten por convenio y no se suman automáticamente.

## Facturas y cobros al hospital

El reporte específico relaciona cuentas de Vertical con facturas SAP por folio de atención, tanto en cabecera como en líneas. Luego consulta aplicaciones de cobros recibidos al identificador exacto de cada factura, únicamente del tipo factura de cliente. Excluye documentos cancelados y conserva como pendientes de verificación los estados desconocidos o las evidencias incompletas.

Muestra estado y saldo actual de la cuenta, presencia de facturas vigentes, sus folios, estado del cobro, folios de cobros recibidos y observaciones. También ofrece total y saldo de facturas, cobros aplicados y moneda cuando pueden compararse sin ambigüedad. Se distinguen cobro parcial, falta de cobros, liquidación mediante otras aplicaciones y facturas compartidas entre cuentas.

Una cuenta cerrada no acredita un pago. Una factura sin saldo puede haberse liquidado con notas de crédito u otras aplicaciones. La presencia de una factura no confirma que se hayan facturado todos los cargos. El estado de facturas cubiertas por cobros SAP acredita esas facturas relacionadas: debe revisarse el saldo de Vertical y cualquier cargo aún sin facturar para concluir sobre la cuenta completa. El registro en SAP no certifica la conciliación bancaria.

El período corresponde a la atención; facturas, saldos y cobros se revisan a su estado actual, incluso si ocurrieron después. No reconstruye un corte histórico. Las facturas compartidas no asignan su importe completo a cada paciente. Moneda extranjera, descuentos, retenciones o datos incompletos impiden afirmar un cobro completo. La moneda local se obtiene mediante una lectura de la configuración de SAP.

## Precios Público General y Hospitalización

Se aplica la correspondencia confirmada por el usuario: **lista 1 = Público General** y **lista 2 = Hospitalización**. Una fila por artículo muestra código, descripción, grupo, ambos precios y sus monedas. Equivale a relacionar artículos, grupos y precios por lista. Se conservan precios cero y listas ausentes como valores diferentes; se rechazan precios duplicados para una misma lista y artículo. Los precios son actuales y unitarios; no se suman.

## Recursos para solicitudes específicas

El esquema incluye 383 recursos de Vertical y 33 de SAP, con 13,719 campos escalares. Amplía las consultas de socios y condiciones comerciales, acuerdos, precios especiales, tabuladores, documentos de venta y compra, notas de crédito, anticipos, cobros, pagos a proveedores, contabilidad, centros de costo y datos administrativos de cuentas y servicios. Las relaciones internas utilizan claves foráneas hacia claves únicas completas. Las relaciones entre sistemas utilizan exclusivamente códigos de pagador o artículo, conservando los registros sin vínculo.

La selección de recursos utiliza la solicitud y las aclaraciones previas. El proveedor de IA recibe esquema autorizado y conversación, sin registros consultados ni credenciales. Las columnas se validan en el servidor. Las frases administrativas que no están en los sinónimos locales pueden resolverse con el esquema ampliado, conservando las columnas ya reconocidas, el origen pedido y el período indicado. Si faltan datos o el pedido exige una relación o cálculo no implementado, se explica y se pide aclarar; no se presenta un reporte parcial como si resolviera todo el pedido.

## Acceso y límites

Se generaron tres permisos adicionales de recursos del asistente: convenios comerciales, recursos administrativos de Vertical y recursos financieros de SAP. Se asignan en el catálogo de permisos existente; esta ampliación no otorga permisos a usuarios. El reporte financiero requiere acceso a cuentas, resumen de facturas de clientes y cobros recibidos. Las combinaciones requieren todos los permisos de sus fuentes, también al ejecutar, guardar y recuperar reportes propios. Un reporte asignado concede únicamente la ejecución de la configuración guardada, según el apartado siguiente.

Se admiten hasta 10,000 filas y períodos de hasta 366 días cuando corresponda. La verificación financiera recorre las cuentas del período antes de aplicar filtros de cobro o búsqueda, con un presupuesto de 180 segundos y límites explícitos de documentos. Una comprobación incompleta produce un error, no un estado negativo inventado. Las consultas generales de SAP conservan su límite de exploración de 20,000 documentos y 100 páginas e informan cualquier truncamiento.

SAP limita la longitud de la consulta a 2,048 caracteres. Los recursos generales rechazan selecciones de columnas que superen el presupuesto de 1,800 caracteres antes de consultar y piden reducirlas. Las consultas por códigos y las búsquedas de evidencias se dividen en grupos pequeños. Si se agrega una columna no consultada o se cambia un filtro financiero que requiere consultar el origen, la pantalla pide actualizar y bloquea la exportación hasta hacerlo.

## Mis reportes y asignaciones

El botón **Mis reportes** reemplaza **Mis plantillas guardadas**. Sistemas/Administración puede seleccionar destinatarios al guardar un reporte y administrar posteriormente su acceso desde esa lista. El rol existente `ADMIN` y el superadministrador `amendoza` pueden asignar; el permiso anterior de consulta o eliminación del director no se convierte en permiso de asignación. Se eligen únicamente usuarios activos y se pueden retirar sus asignaciones. Una persona dada de baja se identifica como inactiva en la lista previa; al administrar accesos se informa que guardar retirará esa asignación, sin impedir elegir otros usuarios activos.

Los destinatarios ven el reporte en **Mis reportes** aunque no dispongan del módulo de origen. Al abrirlo, ejecutan mediante su identificador la fuente, las columnas y los filtros guardados. Es una configuración fija: no permite ampliar campos, cambiar fechas o filtros, redistribuirla ni obtener las otras columnas del origen. La búsqueda y los filtros locales operan sobre el resultado permitido. No se modifican roles ni permisos generales. Usuarios con acceso ordinario a la fuente conservan el constructor que ya tenían.

El backend comprueba nuevamente el acceso, la actividad del destinatario y la configuración guardada antes de entregar el resultado. Retirar una asignación o dar de baja al destinatario bloquea las siguientes consultas y una consulta que todavía no terminó. La respuesta conserva sólo las columnas guardadas. La tabla PostgreSQL `usersapqueryassignments` se crea mediante una migración idempotente al arrancar el backend y sus registros se eliminan en cascada al eliminar el reporte. Las pruebas utilizan usuarios y reportes ficticios en un esquema temporal; durante el desarrollo no se asignaron reportes a usuarios reales.

La presentación y la exportación conservan textos y códigos, distinguen ceros de datos ausentes y no convierten valores no numéricos en `$NaN` o `NaN%`. Las celdas de texto se exportan como texto y con caracteres HTML escapados.

## Evidencia y pase de producción

El esquema de referencia se capturó el 6 de octubre. Se verificó de nuevo SAP el 8 de octubre y coincidió con ese esquema. La API publica algunos campos que no acepta en todas las clases de documento: se verificaron los 33 recursos SAP y se excluyeron 420 campos incompatibles por origen. Se excluyeron también una vista del sistema sin permiso y una colección SAP que no admite una consulta normal.

La comprobación inicial realizó **538 consultas correctas**, mediante `SELECT TOP (0)` en Vertical y filtros de claves inexistentes en SAP. Además, se validaron los campos de convenios maestros y los 35 de cuentas con convenios. La revisión posterior del maestro, incluidos conceptos y valores predeterminados, validó 37 columnas y 56 filas con 56 códigos de convenio distintos. Esta evidencia confirma estructura, relaciones y aceptación de consultas; no concilia importes de pacientes reales.

Las pruebas cubren clasificación financiera, vínculos y cancelaciones, moneda, facturas compartidas, cero y ausencia de precios, filtros, paginación, esquema, consultas acotadas, permisos, plantillas y lenguaje natural. La integración del navegador utiliza registros ficticios y comprueba exportación, fuentes combinadas, actualización de columnas, permisos revocados y la ausencia de tarjetas adicionales en el selector manual.

Los archivos y las pruebas se incorporan al pase mediante `build_deploy.ps1`. Deben aprobarse `pase_a_produccion/verificar_pase.ps1` y `production-package.cjs verify pase_a_produccion --source`. El pase anterior se conserva bajo `tmp/pase-anterior-*`. La preparación local no instala los cambios en el servidor.

Evidencia de desarrollo: `tmp/assistant-financial-schema-validation-20261008.json`, `tmp/assistant-sap-field-validation-20261008.json`, `tmp/assistant-vertical-validation-20261008.json`, pruebas de backend y `frontend/tests/reportAssistant.integration.mjs`. Estos archivos temporales no se distribuyen en el pase.
