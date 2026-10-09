# Revisión de frontend, backend y pase del 8 de octubre de 2026

Se revisó el conjunto de cambios guardado en `efebbe4` y las fuentes actuales de la plataforma. La preparación incluye todo el frontend compilado y el backend activo, no sólo los archivos de un módulo. También incluye las referencias de estadísticas, los esquemas SQL, el runtime, los recursos y la documentación productiva.

## Alcance y resultado

La revisión abarcó honorarios, tarifas y catálogo, corrección del médico, aprobaciones, pagos fijos mensuales, fichas fiscales, cierres, pagos, PDF y Excel; consultas y asistente de reportes SAP/Vertical; revisión de cuentas; estadísticas, tableros, navegación, sesión, permisos, avisos y exportaciones. Se contrastaron también los scripts de instalación, arranque e inventario del paquete.

No se encontró una regresión funcional concreta en las comprobaciones ejecutadas. Se corrigió el encabezado duplicado de Configuración por **Configuración de indicadores**. Se conservaron las adiciones del proyecto y el nombre **Vertical** en las etiquetas, mensajes y exportaciones. Las comparaciones del marcador histórico del Kardex conservan los nombres reales de usuarios y no requieren renombrar tablas.

## Comprobaciones de la revisión general

| Comprobación | Resultado |
| --- | --- |
| Backend completo | 44 suites Jest y 632 pruebas aprobadas. |
| Lógica del frontend | 48 pruebas aprobadas; incluye paridad monetaria cliente/servidor en 1,039,896 combinaciones. |
| Instalación e inventario | 8 pruebas aprobadas, incluida la conservación de configuración e históricos existentes. |
| Navegador | 9 integraciones aprobadas: elegibilidad de PDF, corrección del médico, flujo fijo mensual, presentación de tableros, asistente de reportes, constructor de reportes, estadísticas, reapertura de cuentas y avisos. |
| Presentación de tableros | 12 tableros comprobados en dos tamaños y dos temas, incluidas pérdidas. |
| PostgreSQL | Gestión de honorarios y mensualidades comprobadas en esquemas temporales con datos ficticios. Cero esquemas temporales de estas integraciones restantes al terminar. |
| Catálogo de permisos | Los 64 módulos coinciden entre frontend y backend. |
| Imports del frontend | 119 archivos JavaScript/JSX/JSON analizados y 373 imports locales resueltos, sin fallos. |
| Análisis estático | Cero errores en frontend y backend. Permanecen 577 advertencias en frontend y 108 en backend, principalmente imports y variables sin uso. |

Los logs de esta revisión están en `tmp/backend-review-jest-20261008.*`, `tmp/review-frontend-*.log` y `tmp/revision-*-eslint-2026-10-08.json`. Son evidencia de desarrollo y no se distribuyen en el pase.

## Corrección posterior de «Ver todos» en Datos fiscales

Se corrigió una carrera al abrir la ficha de un médico: una consulta inicial tardía de SAP podía sustituir el grupo elegido manualmente. Ahora esa elección tiene prioridad. «Ver todos» limpia la búsqueda, resalta el botón y despliega la lista de médicos con desplazamiento y teclado, conservando al médico seleccionado y su captura pendiente.

La integración del directorio fiscal reprodujo el fallo antes de la corrección y pasó después. Incluye los tres grupos, búsqueda, respuestas tardías, un directorio ficticio de 266 médicos y selección del último médico por teclado; también mantiene la comprobación de historial tardío. La integración fiscal completa pasó con aprobaciones, ficha interna, cierre y comprobante. Se revisaron capturas de escritorio y móvil; el análisis del componente terminó sin errores y con una advertencia previa por el import de React. Evidencia: `tmp/review-fiscal-ver-todos-before.log`, `tmp/review-fiscal-ver-todos-after.log`, `tmp/review-fiscal-ver-todos-flow.log` y `tmp/honorarios-fiscal-categorias/`.

## Avisos de cambios de referencia desde Vertical

El aviso de cambio de precio usa violeta, con un icono propio y el texto **«Cambió el precio de referencia en Vertical»**. Se distingue del estado pendiente naranja y del estado configurado verde, en tema claro y oscuro. El detalle sólo muestra responsable y fecha si la referencia incluye esa información; cuando no viene responsable, omite cualquier texto adicional. El editor de la configuración BI no se utiliza como autor de Vertical.

Los metadatos de auditoría de las referencias se conservan separados del contenido usado para detectar cambios. Añadirlos a una referencia heredada no genera un aviso ficticio; las modificaciones reales y los avisos previos permanecen. No se modifican los precios autorizados, revisiones ni decisiones guardadas.

Validación enfocada: 43 pruebas de catálogo y flujo aprobadas, más integración PostgreSQL en esquema temporal con referencias heredadas, importe, notas, descripción, altas y bajas; 50 aprobaciones permanecieron vigentes y las tarifas, revisiones y payloads quedaron iguales. El recorrido de navegador de gestión de honorarios pasó con estados, colores, presencia y ausencia de responsable, guardado, móvil, Excel, cierres, pagos y ambos PDF. Evidencia: `tmp/honorarios-reference-catalog-jest-20261008.log`, `tmp/honorarios-reference-pg-20261008.log` y `tmp/review-reference-notice-browser.log`.

## Exportación del catálogo de precios a Excel

«Descargar Excel», junto a los filtros del catálogo, exporta todos sus resultados y no sólo la página visible. Conserva el apartado Aprobados, Recomendados o Todos los servicios, el estado, la búsqueda y la opción Revisar otros conceptos elegidos al iniciar la descarga.

El archivo incluye tres hojas: **Catálogo**, con una fila por servicio, precios y estado; **Referencias Vertical**, con todos los registros de referencia, importes y notas; y **Tarifas autorizadas**, con todas las tarifas, médico, función, vigencia y estado activo/inactivo. Las referencias múltiples y las tarifas específicas permanecen separadas, sin multiplicar sus combinaciones. Los importes de detalle son numéricos; cero se distingue de un precio vacío. Los encabezados quedan congelados y cuentan con filtros de Excel. Los precios unitarios no se suman como pagos.

La descarga utiliza una consulta consistente de lectura de BI y no sincroniza Vertical ni modifica tarifas o aprobaciones. La validación del backend terminó con 47 pruebas aprobadas y una integración PostgreSQL aislada de 304 servicios, preservando tarifas, revisiones y 50 aprobaciones. El recorrido existente de gestión de honorarios también pasó, incluidos Excel, cierres, pagos y ambos PDF. Evidencia: `tmp/honorarios-catalog-export-jest-20261008.log`, `tmp/honorarios-catalog-export-pg-20261008.log` y `tmp/review-catalog-export-management.log`.

La integración específica del catálogo descargó y abrió siete Excel de prueba: resultados mayores a 40 servicios, todas las vistas, filtros combinados y conservados al clic, dos referencias y tres tarifas de un mismo servicio, cero/vacío, estados y exclusiones. También comprobó descarga con acceso de consulta, errores sin archivo parcial, metadatos de responsable sólo si existen y anchos de 320, 390, 768 y 1440 px sin desbordamiento. Evidencia: `tmp/honorarios-catalog-export-integration.log` y `tmp/honorarios-catalog-export/`.

## Servicios históricos y vigencia de tarifas

La revisión de SER0616 confirmó que las consultas admiten meses anteriores: una tarifa debe cubrir la fecha de la atención, el médico y su función. El estado Configurados del catálogo indica que hay una tarifa autorizada; no garantiza que cubra cualquier período. La consulta de sólo lectura encontró 80 atenciones de psicología de agosto en Vertical. El historial de la base BI local mostró una vigencia inicial del 1 de septiembre y una edición posterior al 1 de agosto con el mismo importe. Esa lectura local no confirma la configuración instalada en otro servidor.

La pantalla explica ahora las atenciones que quedaron fuera por falta de una tarifa aplicable y orienta a revisar su vigencia. El acceso directo al catálogo desde el estado vacío utiliza la navegación común, para abrirlo también en la primera visita. «Ver todo el historial» se ofrece cuando existen resultados para cambiar de estado. El formulario explica que las atenciones anteriores a «Se aplica desde» quedan fuera y que debe usarse la fecha autorizada del importe.

Los contadores de fuentes consultadas conservan los datos anteriores al filtro de elegibilidad, separados de los servicios disponibles para revisión. Así, una lista vacía no se presenta como si no se hubieran leído órdenes, cargos o citas. Estos cambios no editan las fechas, precios ni aprobaciones guardadas.

La regresión del backend verificó SER0616 con tarifa general de 225 y extensión de vigencia de septiembre a agosto, fechas límite inclusivas, aprobación abierta que requiere nueva revisión tras cambiar la tarifa y conservación del cierre y de sus snapshots. Pasaron 58 pruebas enfocadas. La integración del navegador comprobó 80 atenciones omitidas, las fuentes consultadas, el acceso directo al catálogo en la primera visita y una edición explícita de vigencia que conserva importe y período. Evidencia: `tmp/honorarios-historical-tariff-integration.log` y `tmp/honorarios-historical-tariff/`.

## Recuperación de la preparación de pagos

La preparación esperaba consultas SAP sin tiempo límite. La conciliación utiliza ahora un presupuesto total de 60 segundos y un máximo de 30 segundos por petición, incluido el inicio de sesión y los reintentos. Se propaga la cancelación a todas las páginas y a las consultas simultáneas. Una medición de sólo lectura obtuvo las retenciones en 14.37 segundos, demasiado cerca del límite anterior de 15 segundos. El estado HTTP de un timeout es 504. Si SAP no permite comprobar los impuestos, no prepara un cierre con información parcial.

La pantalla distingue la preparación del pago, la consulta de pagos preparados y la comprobación del PDF. Las consultas de ese flujo tienen un límite de espera y se conserva el cierre cuando ya se recibió su identificador. Una respuesta ausente deja pendiente la confirmación; la recuperación consulta los pagos existentes y no vuelve a enviar automáticamente la creación. Cuando el servidor confirma expresamente que el fallo ocurrió antes de crear el cierre, se permite un nuevo intento manual.

La validación enfocada reunió 105 pruebas de backend y tres casos adicionales sobre errores antes de guardar, pérdida de confirmación y lectura fallida después de guardar. La integración específica del navegador comprobó solicitudes silenciosas, doble clic, cancelación, respuesta tardía, recuperación por consulta, espera del PDF y varios pagos coincidentes con selección explícita. El flujo normal de gestión y la integración PostgreSQL en esquema temporal también pasaron, incluidos los cálculos, pagos, ambos PDF y conservación de los cierres. Evidencia: `tmp/honorarios-historical-payment-jest.log`, `tmp/honorarios-preparation-outcome-jest.log`, `tmp/honorarios-payment-recovery-integration.log`, `tmp/review-historical-payment-management.log` y `tmp/honorarios-historical-payment-pg.log`.

## PDF con datos fiscales pendientes

Generar PDF para pago consulta primero las aprobaciones vigentes del médico y periodo elegidos, sin llamar a SAP. Si no existe una ficha fiscal interna completa y aplicable, descarga automáticamente un PDF con los servicios aprobados, cantidades, tarifas e IVA confirmado. Los datos fiscales disponibles se incluyen; las retenciones y el neto desconocidos se muestran como pendientes. Esta descarga no crea un cierre ni modifica tarifas, aprobaciones o pagos existentes. Los servicios ya cerrados no se incluyen en un reporte nuevo de aprobaciones abiertas.

La lectura verifica fuente, catálogo, tarifa, cantidad y beneficiario aprobados. Si cambiaron, se pide revisar la aprobación; la falta de datos fiscales por sí sola permite emitir el PDF. El IVA admite 0%, 8% y 16% según la aprobación, conservando los centavos y los pagos fijos mensuales de cortes parciales. Las descargas detallada y resumida de aprobados también están habilitadas mientras se consulta SAP.

Si el médico ya está configurado en SAP, la opción **Preparar pago con datos de SAP** conserva esa vía después de descargar el PDF disponible. Tanto la consulta fiscal de Servicios como esa preparación leen proveedores y retenciones; no cargan facturas, pagos ni grupos innecesarios. Se informa que no se consultaron documentos; no se presentan listas ausentes como cero facturas. Los PDF de cierres existentes conservan su validación de impuestos, pagos, ajustes y saldo.

La comprobación enfocada pasó 75 pruebas del reporte disponible, rutas, conciliación y aritmética, y 44 de conservación de cierres, revisiones y datos fiscales. Las integraciones del navegador descargaron PDFs reales con SAP sin responder y datos fiscales incompletos, comprobaron el médico y periodo nuevos, rechazaron respuestas de otro periodo y conservaron la recuperación de preparaciones inciertas. El flujo completo de gestión, la ficha fiscal y la vía opcional SAP también pasaron. PostgreSQL aislado comprobó que la consulta no cambia nueve tablas y que 50 servicios conservan los mismos centavos en el reporte completo y el cierre. Otras 17 validaciones del generador verificaron IVA 8%, cantidades fraccionales, mensualidades de cortes parciales, ceros confirmados y rechazos de importes alterados. Se revisaron páginas iniciales, intermedias y finales de un PDF de 300 servicios y 61 páginas, además del resumen. Evidencia: `tmp/honorarios-available-pdf-backend.log`, `tmp/honorarios-available-regression-backend.log`, `tmp/honorarios-available-payment-integration.log`, `tmp/honorarios-available-management-integration.log`, `tmp/honorarios-available-renderer-integration.log` y `tmp/honorarios-available-payment/`.

## Condiciones de convenios y Mis reportes

Se corrigió la interpretación del maestro de convenios: los campos de deducible, copago y coaseguro son códigos de conceptos del catálogo. El reporte muestra por separado el código, su descripción inequívoca y el importe o porcentaje predeterminado que realmente existe en el maestro. Las condiciones solicitadas incorporan sus columnas relacionadas; los valores aplicados a una atención se conservan separados. Se validaron 37 columnas y 56 convenios distintos en Vertical. Los textos y códigos se conservan en pantalla y Excel, los valores ausentes no se vuelven cero y los valores no numéricos no se presentan como `$NaN` o `NaN%`. Los encabezados largos se ajustan dentro de cada columna.

**Mis reportes** sustituye **Mis plantillas guardadas**. Sistemas/Administración puede elegir destinatarios al guardar y cambiar o retirar los accesos después. La asignación permite abrir la pantalla y ejecutar únicamente la fuente, los campos y los filtros guardados; no modifica los permisos generales. La comprobación de acceso se repite antes de devolver datos, incluida una baja o revocación durante la consulta. Se conserva la propiedad por identificador del usuario, también al renombrarlo, sin transferir reportes privados a otra cuenta que reutilice su nombre.

La tabla de asignaciones se crea al arrancar el backend mediante una migración idempotente. Las pruebas de PostgreSQL usaron un esquema temporal eliminado y usuarios ficticios; no se asignaron reportes a usuarios reales. Se comprobaron reemplazos concurrentes, bajas, revocación, cascada al eliminar el reporte y ausencia de cambios a roles o permisos.

La regresión enfocada del backend aprobó **338 pruebas en 16 suites**, incluidas siete comprobaciones de rutas con JWT. Cuatro pruebas de navegación validaron alcance, revocación, tokens y espera acotada. El navegador comprobó guardado con destinatarios, fallo parcial de asignación recuperable, administración de accesos, ejecución fija y exportación de dos reportes del mismo origen, datos financieros con códigos y números y los dos modales a 390 píxeles. El montaje de sesión, protección de rutas y menú se verificó con un destinatario ficticio sin permisos de módulos, retiro de la asignación y cambio de sesión con una respuesta anterior pendiente. El análisis estático focal no encontró errores. Evidencia: `tmp/assistant-reports-backend-20261008.log`, `tmp/assistant-clarification-browser-20261008.log`, `tmp/mis-reportes-builder-browser-20261008.log`, `tmp/assigned-report-navigation-20261008.log` y `tmp/saved-report-assignments-pg-20261008.log`.

## Preparación e instalación

Se corrigió un fallo de arranque observado en producción: el archivo `statistics_manual_controls.json` estaba incluido en `initial-data`, pero sólo se activaba al ejecutar el instalador. Ahora el lanzador productivo prepara las referencias de estadísticas faltantes antes de iniciar `server.js`. La preparación agrega únicamente archivos ausentes, valida los pendientes antes de copiar y conserva byte a byte los históricos y la configuración existentes. Una referencia ausente del pase, un hash incorrecto o JSON inválido detiene el arranque con una indicación de recuperar el pase completo. El modo de desarrollo y `--check` no activan referencias. La comprobación se realiza en una instalación temporal, sin conectar a las bases ni arrancar servicios del servidor productivo.

La regresión aprobó **45 pruebas de arranque, runtime e instancia**, incluidas 14 de preparación de referencias, y **8 pruebas de empaquetado**. El proceso temporal reproduce el error original y después carga ambos JSON desde el lanzador real con Node 24.21.0. Dos arranques conservan los bytes y fechas de modificación del histórico y `.env`; se rechazan archivos faltantes, hashes distintos y JSON malformado antes de copiarlos. Evidencia: `tmp/production-startup-final-tests-20261008.log` y `tmp/production-startup-package-tests-20261008.log`. La recuperación en `SERVIDORCALIDAD` debe confirmarse con su arranque y su `/health`; estas pruebas no ejecutan una instalación remota.

La ampliación posterior del asistente incorpora convenios con descuentos, cuentas con convenios, facturación y cobros de cuentas, precios Público General/Hospitalización y recursos financieros y administrativos de SAP/Vertical. Se utiliza desde **Crear con asistente**, sin añadir tarjetas al selector manual. Su alcance, acceso, interpretación financiera, validación de consultas y límites se detallan en [Recursos financieros y administrativos del asistente](asistente-recursos-financieros-2026-10-08.md). Debe distribuirse el pase completo regenerado, incluidos los nuevos catálogos JSON y permisos del asistente.

Se corrigió además el bucle de aclaraciones de condiciones comerciales: las etiquetas preservan la unidad porcentual y las elecciones de copago, deducible y coaseguro mantienen un concepto estable al continuar la conversación. Se comprobó la petición exacta de las capturas, incluida la escritura «dedicibles», ambas opciones de copago y respuestas en distinto orden. También se verificaron elecciones administrativas sin un sinónimo especial y una conversación de seis aclaraciones consecutivas, conservando las primeras elecciones en el borrador. El reporte conserva código y nombre del convenio, salvo una limitación explícita de columnas. La validación enfocada pasó 333 pruebas de backend en 15 suites; evidencia: `tmp/assistant-clarification-backend-20261008.log` y `tmp/assistant-clarification-browser-20261008.log`.

El pase se regenera con `build_deploy.ps1` y se comprueba con `pase_a_produccion/verificar_pase.ps1` y `production-package.cjs verify pase_a_produccion --source`. El contraste verifica todos los archivos del inventario, sus hashes, los imports del backend, las dependencias productivas y los recursos compilados, además de la coincidencia con las fuentes actuales. El pase anterior se conserva en `tmp/pase-anterior-*`.

El instalador conserva la configuración `.env`, la base de datos, los históricos y los modelos existentes. Prepara los archivos de referencia ausentes de `initial-data` y no ejecuta todos los SQL ni restaura una base durante una actualización. El arranque utiliza el Node portable incluido y comprueba la instancia antes de iniciar conexiones o sincronizaciones.

Este resultado es una revisión y un paquete local. Las integraciones de esta revisión usan fuentes SAP/Vertical ficticias y PostgreSQL aislado; no prueban todos los módulos con proveedores externos ni instalan el pase en `SERVIDORCALIDAD`. Las conciliaciones documentales de estadísticas mantienen su alcance de [la revisión anterior](revision-pase-final-2026-10-07.md).

Para aplicar el paquete completo al servidor, sigue [README_PRODUCCION.md](../README_PRODUCCION.md), ejecuta `instalar.bat`, reinicia con `iniciar_produccion.bat` y recarga la pantalla.
