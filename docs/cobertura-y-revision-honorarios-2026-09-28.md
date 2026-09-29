# Cobertura y revisión de honorarios — 28 de septiembre de 2026

## Decisión funcional

El usuario pidió mostrar todos los candidatos a honorarios y que una persona los apruebe o rechace. El permiso existente del módulo (`interconsultas-jornadas`, más la regla maestra de la plataforma) controla estas acciones. No se agregó un rol o permiso nuevo.

Todos los registros sin decisión vigente aparecen **pendientes**. La elegibilidad de la fuente clínica es información de auditoría, no una aprobación humana. Los registros rechazados y pendientes aportan cero al total aprobado. Un registro aprobado que no se puede calcular hace que el total se muestre **pendiente**, nunca como un total completo.

## Investigación de las fuentes, exclusivamente de lectura

- Se revisaron agosto completo y septiembre del 1 al 28 de 2026. No se recibieron otros médicos o fechas concretos.
- Ninguna fila de la fuente de pago de esos cortes estaba ausente de su auditoría. Las dos filas con base 225 excluidas por mes correspondían a órdenes canceladas: no era correcto activarlas automáticamente.
- Se localizaron 27 citas con concepto y sin líneas de orden: 20 de agosto y 7 de septiembre. Siete tienen tabulador y datos consistentes sin coincidencias alternativas detectadas (base propuesta total 1,575); las otras 20 tienen observaciones de realización, orden, cargo o posible duplicidad. Se muestran **todas pendientes**, incluidas las no realizadas o con coincidencias alternativas; no se suman sin aprobación.
- La consulta final de agosto produjo 12,500 filas. La cita 26662 permite mostrar una consulta general adicional de María Antonieta Calva: 24 consultas con base propuesta 5,400. No se fabricaron las 11 consultas HSBC a partir de la factura agregada.
- En SAP se leyeron todas las páginas del catálogo. La conciliación con médicos clínicos de agosto y documentos/pagos de septiembre incorporó **20 proveedores adicionales** y **139 facturas en total**, incluyendo dos contabilizadas fuera de septiembre, localizadas por pagos del rango (documentos 5599 y 7399).
- El universo SAP incluye grupos médicos, coincidencias con el catálogo de prestadores y el grupo general Honorarios. Este último contiene también servicios no médicos: se identifica como candidato pendiente de confirmar, sin clasificarlo automáticamente como médico.
- Cada factura se identifica por DocEntry y se agrega una sola vez. Los pagos son evidencia de aplicación y no se convierten en honorarios adicionales. Las líneas SAP se presentan como importes contabilizados: no se supone que sean bases sin IVA.
- Las vistas alternativas de cuentas contienen también cargos de materiales, estancia y otros servicios; su importe cobrado al paciente no se utiliza como base de honorario. El tabulador y los importes propuestos requieren revisión cuando no existe base conciliada.

## Cálculo y revisión

1. Atenciones aprobadas: base + IVA − ISR − retención de IVA. Se conserva el motor único para pantalla, ficha, PDF y Excel. Las tasas compatibles provienen del candidato SAP; el IVA puede confirmarse expresamente durante la revisión con motivo documentado.
2. Se redondean retenciones por médico y se distribuyen los centavos al detalle, de modo que sus sumas coinciden con el resumen.
3. Facturas aprobadas: se conserva su neto contabilizado; sus impuestos no se vuelven a descontar. El neto puede contener importes ya pagados y no equivale a un saldo por pagar.
4. Si se aprueban atenciones y facturas del mismo proveedor, el cálculo queda pendiente hasta revisar la posible duplicidad. El revisor puede confirmar con justificación que corresponden a servicios distintos; si son los mismos, debe aprobar una sola fuente. Esto no acredita por sí solo la correspondencia entre factura y atención.
5. Documentos cancelados, importes ausentes, moneda distinta de MXN o perfiles fiscales incompatibles no producen un neto MXN definitivo. Se conservan sus datos para revisión.
6. Los cambios en los datos de origen invalidan la decisión aplicada al cálculo y devuelven el registro a pendiente. Se conserva la decisión anterior en BI.

## Persistencia y alcance

Las decisiones se guardan exclusivamente en PostgreSQL de BI, en `bi_honorarios_reviews` y `bi_honorarios_review_history`. Se registra acción, base revisada, IVA confirmado, motivo, datos revisados, responsable, fecha y versión. Las tablas se crean al primer acceso al módulo. Las decisiones se comparten entre equipos y entre cortes superpuestos. Un control de versión impide que dos revisores se sobrescriban.

Los ajustes históricos de localStorage no se migran como autorizaciones compartidas, porque no acreditan un responsable autenticado. Permanecen en el navegador original y deben revisarse en el flujo nuevo.

No se modificaron datos ni esquemas clínicos ni de SAP. La aprobación es interna de BI; no registra facturas, pagos, pólizas ni movimientos en esos sistemas.

## Verificación

- Consulta SQL final ejecutada en lectura con recuperación de citas; fechas y conteos verificados.
- Conciliación SAP final completa: 139 facturas, 20 proveedores adicionales; lectura final de aproximadamente 17 segundos. La consulta por periodo evita las consultas concurrentes por listas de proveedores que devolvían 504.
- 12 pruebas de backend: paginación, configuración fiscal, documentos fuera de corte, recuperación, permisos y validación de revisiones.
- 12 pruebas del motor de cálculo: ambos impuestos, RESICO, redondeo, aprobación/rechazo, cambios del origen, monedas y duplicidad entre fuentes.
- Integración PostgreSQL en un esquema temporal aislado de BI: persistencia, historial, conflicto entre revisores y permiso del módulo. El esquema de prueba se eliminó al finalizar.
- Navegador aislado con el componente real: aprobar/rechazar, recarga de decisiones, fallo de guardado sin aprobación falsa, fechas clínicas/contables independientes, proveedor sólo SAP, caída de SAP y exportaciones.
- PDF resumido, detallado, unificado y pendiente renderizados y revisados; importes de Excel contrastados. Datos sintéticos en los artefactos de prueba.

Ejemplos sintéticos comprobados: 23 × 225 = 5,175; IVA 828, ISR 517.50, retención IVA 552, neto 4,933.50. Una factura distinta aprobada de 900 lleva el total de ambos médicos a 5,833.50 sin recalcular los impuestos del documento. Para el caso real de Calva, aprobar únicamente las 24 consultas generales con su IVA y perfil compatible daría 5,148; la factura completa conserva el neto 7,769.66 registrado en SAP.

## Límite de lo comprobado

La revisión cubre las fuentes y cortes descritos; no prueba que todas las prestaciones existentes en papel tengan un registro clínico individual. En particular, las 11 consultas HSBC se observan agregadas en la evidencia contable y su factura, pero no se localizaron como once atenciones clínicas. El reporte permite revisarlas por documento sin inventar pacientes, fechas o servicios. La aprobación no sustituye revisar identidad, vigencia fiscal, CFDI y servicios efectivamente incluidos.
