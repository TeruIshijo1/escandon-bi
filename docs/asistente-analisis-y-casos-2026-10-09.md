# Análisis y consultas de cuentas con el asistente

Fecha: 9 de octubre de 2026. Alcance: «Crear con asistente» dentro de Crear reporte personalizado y consultas con Mar-IA. Los recursos adicionales permanecen implícitos; no se añaden tarjetas a «Elegir un tema».

## Qué se puede pedir

- «Cuentas por cobrar de septiembre con saldo mayor a $10,000».
- «Cuentas por cobrar de septiembre agrupadas por cliente con suma de saldo».
- «Cobros recibidos de septiembre agrupados por cliente con suma del total de medios en moneda local».
- «Cuántos registros por convenio». El resultado cuenta filas; para contar cuentas o pacientes diferentes se debe solicitar el conteo de su identificador distinto.
- «Dime si la cuenta 123 ya tiene factura pagada y está cerrada».
- «Dime las facturas, cobros e insumos de la cuenta 123».
- «Necesito los cargos e insumos de la cuenta 123».
- «Dime el estado de cuenta del paciente número 456».

Los números son ejemplos. Para una persona mencionada por nombre se debe precisar su número de paciente o folio de atención; no se presupone que un nombre identifica a una sola persona. Un paciente puede tener varias atenciones.

La configuración muestra los filtros, agrupaciones, totales y orden que se interpretaron. Una aclaración, un cambio de fechas o una modificación de columnas conserva los demás datos del pedido. La consulta puede guardarse en «Mis reportes» y asignarse con el mismo mecanismo de accesos existente. El usuario receptor ejecuta la definición guardada; no obtiene permisos generales sobre las fuentes.

## Condiciones y medidas

Se admiten comparaciones de columnas numéricas, intervalos, igualdad, desigualdad, texto contenido y datos presentes o faltantes. Se aplican condiciones simultáneas, agrupaciones, conteo de registros, conteo de valores distintos, sumas habilitadas y orden ascendente o descendente.

Las sumas financieras se habilitan para cabeceras de facturas, cartera SAP, anticipos, órdenes de venta, subtotales de líneas, cobros y pagos con total verificado, cargos y abonos contables por línea, y las fuentes de cuentas, cartera y órdenes Vertical que declaran el identificador de cada importe. No se suman automáticamente precios unitarios, porcentajes, identificadores, niveles de cuentas contables ni importes del pagador repetidos en varias cuentas. Los recursos genéricos conservan filtros, agrupación y conteos; una clasificación numérica de una columna no demuestra que sea sumable.

Los importes SAP en moneda local conservan esa unidad. Los valores registrados en Vertical conservan su unidad de registro. Los importes de facturas con una columna de moneda se agrupan también por esa moneda, sin convertirlos. Un importe o moneda sin verificar deja su total sin información; no se sustituye por cero. Las sumas y comparaciones usan aritmética decimal con seis posiciones, conservando importes negativos.

## Consultas puntuales

Un identificador exacto se valida y se lleva como parámetro a la consulta de origen antes del límite de filas. La cuenta financiera consulta sus facturas y aplicaciones de cobros por relaciones verificadas. Las fuentes de cuentas, cargos, convenios y órdenes pueden acotarse por los identificadores expresamente habilitados. Una identificación exacta permite omitir el período; si se proporciona un período, se conserva junto con el identificador. Una fecha parcial o inválida se debe corregir.

La consulta conjunta de facturación e insumos requiere una sola cuenta exacta y acceso a las cuatro fuentes: cuentas Vertical, facturas SAP, cobros SAP y cargos Vertical. Conserva una fila por cargo; si no hay cargos, conserva una fila con la información de cuenta. Los saldos de cabecera se repiten como contexto y quedan marcados como no sumables.

«¿Ya está pagada?» y «¿Está cerrada?» solicitan información. No se convierten en filtros que oculten la cuenta cuando la respuesta sea negativa. Cierre clínico, existencia de factura, liquidación de factura y cobro al hospital se presentan como estados distintos. Una factura compartida, una aplicación dudosa o una moneda no verificada requiere revisión; el sistema no afirma que todo esté cerrado por la sola existencia de una factura pagada.

## Integridad, límites y presentación

El análisis requiere la fuente completa dentro del alcance acotado de hasta 10,000 registros. Si el origen entrega una consulta truncada, se pide reducir el período o los filtros; no se presenta un total parcial como completo. El límite de salida es independiente y se informa si sólo se entregan algunos grupos. Los totales pertenecen a la consulta de origen, antes de los filtros locales de la tabla.

La tabla y Excel utilizan las columnas efectivamente devueltas, incluyendo las medidas agrupadas. La paginación de pantalla no limita las filas cargadas que se exportan. Al cambiar una configuración analítica o fallar una ejecución, se debe recalcular antes de exportar. Los campos técnicos necesarios para verificar la identidad o moneda se cargan internamente y se excluyen del detalle visible cuando no fueron solicitados.

Mar-IA utiliza el mismo catálogo y motor, exige los permisos de cada fuente y muestra una vista previa acotada. Su conversación conserva la configuración del análisis, sin incorporar filas de pacientes al historial enviado al proveedor. Los errores operativos no revelan conexiones, SQL ni mensajes internos del servidor.

Los períodos de cuentas corresponden a atención/ingreso y los de documentos a emisión; los saldos, facturas y cobros consultados son actuales. Esta ampliación no reconstruye saldos históricos, no compara períodos automáticamente ni admite fórmulas, uniones o SQL propuestos por la IA. Las condiciones sobre totales de grupos, promedios calculados y primeros N requieren una ampliación posterior y se rechazan de forma explícita.

## Producción

El pase se genera completo mediante `build_deploy.ps1`, se comprueba con `pase_a_produccion/verificar_pase.ps1` y se contrasta con las fuentes mediante `production-package.cjs verify pase_a_produccion --source`. Incluye el arranque que repone exclusivamente archivos iniciales ausentes de estadísticas, conservando datos existentes.

Una validación local no demuestra instalación en el servidor. El operador debe copiar el pase completo, ejecutar `instalar.bat`, reiniciar `iniciar_produccion.bat` y recargar el navegador con Ctrl+F5. Conservar los archivos de datos y configuración de producción.
