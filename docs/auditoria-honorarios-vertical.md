# Auditoría de honorarios de Vertical

Dentro de **Honorarios Médicos → Auditoría**, el usuario puede consultar los registros originales de `UDR_HON_PAGO_Audit` sin modificar Vertical.

1. Abrir **Auditoría** y elegir las fechas. Las listas de médicos, grupos y orígenes se cargan automáticamente para ese periodo.
2. Filtrar por médico, grupo, origen o resultado de revisión. Buscar por paciente, cliente, médico, servicio, código, folio o motivo de exclusión.
3. Elegir el orden de los resultados y pulsar **Consultar auditoría**. **Limpiar filtros** conserva las fechas.
4. Abrir **Ver detalle** para consultar las 30 columnas con sus nombres de lectura.
5. Pulsar **Descargar Excel** para obtener todos los registros que cumplen los filtros, independientemente de la página mostrada.

## Alcance de la información

- Se excluyen los servicios cuyo código comienza con **FAR** (farmacia) o **ALM** (almacén), también si el código llega en minúsculas o con espacios exteriores.
- También se excluye cualquier grupo cuyo nombre contenga **almacén** o **farmacia**, sin distinguir mayúsculas ni acentos: Almacén General, Almacén Quirófano, Farmacia Satélite y sus variantes. Se excluyen incluso cuando el código es SER u otro distinto de FAR/ALM. La misma exclusión se aplica antes de calcular el resumen y la paginación, cargar médicos/grupos/orígenes y generar el Excel. El selector tampoco muestra grupos de inventarios recibidos en una lista anterior y limpia su selección si ya estaba aplicada.
- Los demás servicios conservan sus grupos y las filas repetidas de la vista. Los códigos ausentes no se convierten en FAR o ALM; un grupo de farmacia o almacén se excluye aunque falte el código. No cruza datos de liquidación, SAP ni aprobaciones BI.
- **Cumple reglas**, **Fuera de reglas** y **Sin evaluar** reflejan exclusivamente el indicador original `Elegible_V_HON_PAGO`. No autorizan pagos.
- **Importe de referencia** es el valor original `IMPORTE`. La cantidad, el precio al paciente, el IVA, las tasas y los valores ausentes se conservan; una ausencia no se sustituye por cero.
- `PCNum` se muestra como **Folio de referencia**, pues puede corresponder a una atención, cita u orden según su origen. La orden de venta `SONum` se presenta por separado.
- Las fechas de consulta incluyen ambos días completos y conservan el calendario local de la conexión a Vertical.
- El detalle traduce los orígenes conocidos. Los códigos de estado sin descripción confirmada permanecen como estados registrados, sin atribuirles una interpretación.

## Consulta, exportación y acceso

- `GET /api/honorarios/vertical-audit`: filtros parametrizados, resumen del conjunto filtrado, páginas de 25, 50 o 100 filas, orden y opciones del periodo.
- `GET /api/honorarios/vertical-audit/options`: carga únicamente las listas del periodo, sin consultar las filas del reporte ni exigir una consulta previa. Las opciones se actualizan al cambiar las fechas y las respuestas de un periodo anterior se descartan. La pantalla informa cuando está cargando, cuando no hay opciones para esas fechas y cuando hace falta reintentar.
- `GET /api/honorarios/vertical-audit/excel`: vuelve a consultar los mismos filtros, sin paginación. Incluye las 30 columnas originales y el resultado de revisión, encabezados legibles, filtros de Excel, filas inmovilizadas e importes numéricos.
- Las exportaciones mayores de 50,000 filas se rechazan con una instrucción para reducir el periodo o añadir filtros. No se descarga un archivo incompleto.
- Se exige el permiso existente `interconsultas-jornadas`, con la excepción ya establecida de `amendoza`. El rol o permisos de otros módulos no conceden acceso. Las respuestas usan `Cache-Control: no-store`.
- Al cambiar los filtros se ocultan los resultados anteriores y se desactiva la exportación hasta consultar de nuevo. Salir de la pestaña cancela la solicitud pendiente del navegador.

## Verificación del 6 de octubre de 2026

- Pruebas de servicio y rutas: validación, parametrización, duplicados, valores ausentes, acceso, errores, exportación completa y contenido del Excel.
- Exclusión de códigos y grupos de inventarios: diez pruebas de servicio y rutas aprobadas. Se comprobó en SQL Server el filtro utilizado por el servicio con 28 combinaciones ficticias de códigos y grupos: 17 se excluyeron y 11 se conservaron. Incluye códigos SER en farmacia/almacenes, acentos, minúsculas, plurales, valores ausentes y grupos clínicos conservados.
- Consulta real de opciones del 1 al 30 de septiembre de 2026: 25 grupos disponibles y **cero grupos de farmacia o almacenes**. Esta comprobación sólo leyó opciones; no modificó datos ni guardó información de pacientes. Los conteos pueden variar al cambiar la base activa.
- Prueba de navegador con datos sintéticos: listas cargadas antes de la primera consulta, ocultación de cuatro variantes de grupos de farmacia y almacenes recibidas en las opciones, actualización de las tres listas al cambiar las fechas, reintento y periodo sin opciones; además, acceso a la pestaña, filtros, detalle, paginación, descarga completa, escritorio, móvil, ausencia de resultados, errores y cancelación.
- Presentación en modo oscuro: filas alternadas y resaltado usan las variables del tema; las etiquetas de resultado y el selector de página conservan fondos oscuros y texto legible. Revisión visual con datos sintéticos en claro, oscuro, detalle y móvil, después de las transiciones de color. El contraste mínimo observado en las muestras fue 6.35:1 en claro y 9.43:1 en la tabla oscura; se volvió a comprobar el flujo existente de filtros, detalle, paginación y Excel.
- Prueba previa de Honorarios: estados, aprobaciones, exportaciones, SAP degradado y búsqueda con 12,796 registros.
- Antes de excluir FAR y ALM, la consulta real de solo lectura del 1 al 30 de septiembre de 2026 tenía 24,778 registros; 4,108 cumplían reglas y 20,670 quedaban fuera. Conteos verificados con una consulta independiente, primera página comparada con la exportación y filtros de grupo y estado comprobados. Estos conteos no representan el nuevo alcance filtrado.
- En esa revisión previa se generó el Excel real de 24,778 registros hacia un flujo en memoria y se descartó. No se guardaron archivos ni capturas con datos de pacientes. Los conteos pueden variar al cambiar la base activa.

Para cargar el cambio en una instalación que ya esté en ejecución, actualizar el frontend compilado y reiniciar el backend. No requiere migraciones de base de datos.
