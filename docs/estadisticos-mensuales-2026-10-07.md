# Estadísticos mensuales: criterios y conciliación

Revisión: 9 de octubre de 2026. Fuentes consultadas en modo lectura: Vertical, SAP Business One Service Layer y los libros de `Excel base`. No se modificaron datos en Vertical ni SAP.

## Uso

En Estadísticas, **Generar estadístico** abre un formulario de fechas. Ambas fechas se incluyen completas. El periodo predeterminado es el mes anterior, según la fecha de Ciudad de México. El detalle está disponible desde el 1 de abril de 2026; los meses anteriores conservan los totales históricos originales, sin repartir personas proporcionalmente entre días.

El Excel reúne resumen, apartados, documentos que sustentan los Top 10, comparación con referencias manuales y criterios. Los errores de consulta impiden la descarga; los datos no verificables se muestran como **No disponible**, nunca como cero. Un archivo descargado puede contener observaciones pendientes: deben revisarse antes de enviarlo.

Se exige el permiso `estadisticas` en las cuatro rutas de lectura/exportación, además de la capacidad de exportación en la descarga. Se conserva la excepción administrativa existente de la plataforma.

## Criterios

| Apartado | Criterio aplicado |
|---|---|
| 02 Nacimientos | Cuenta pacientes con `PT.CreatedOn` (Creado en) y `PT.BirthDate` dentro del periodo y en la misma fecha calendario. Una fila por `PTNum`; se excluye el expediente creado después del nacimiento. Este es el criterio solicitado para reconocer los recién nacidos del hospital. |
| 03 VaSeguro | Convenio `VAGSEG001` (VASEGURO PAQUETE), autorizado, cuenta cerrada y alta médica en el periodo. Excluye convenios cancelados y otras aseguradoras. |
| 04 Urgencias | Cantidades netas de los servicios de consulta de urgencias, sin interconsultas. |
| 05 Estancia | Cantidades netas de los servicios de estancia de privados, cuneros, cuidados intensivos/intermedios y ambulatorios. No se confunden con días calendario. |
| 06 Terapia | Servicios de estancia en terapia intensiva, intermedia y neonatal; sin ambulancias, insumos ni interconsultas. |
| 08 Ambulatorios | Criterio confirmado por el usuario: cuenta cerrada con ingreso y egreso en la misma fecha, con estancia de procedimiento registrada. El detalle conserva ambas fechas y las técnicas. No exige que el nombre del servicio diga ambulatorio. |
| 09 Especialidad | Servicios específicos de consulta de especialidad en órdenes vigentes. Excluye consulta genérica, medicina general y materiales del grupo. No se presenta una cita agendada como consulta terminada. |
| 10 Imagen y 11 Laboratorio | Facturas menos notas de crédito vigentes, por fecha de contabilización. Cantidad neta e importe sin IVA separados. Incluye pacientes externos. Un paquete cuenta como una unidad y no se expande en sus pruebas. |
| 14 y 15 Médicos | Dos Top 10 independientes por total de órdenes de venta vigentes y fecha de documento, conforme al manual. Cada cabecera se cuenta una vez. No se combina el nombre de un médico de SAP con el identificador de otro tratante en Vertical. |

Las órdenes son una base diferente de facturación y de cobros. Las notas de crédito se descuentan sólo en la base de facturación. Los servicios registrados/facturados no demuestran por sí solos la ejecución clínica. Las estancias de quirófano conservan sus procedimientos, pero una estancia con varias técnicas no se presenta como varias personas.

El archivo `11_COVID.xlsx` contiene laboratorio general. Su nombre no permite inferir casos de COVID, por lo que no se añadió un apartado de casos.

## Hallazgos corregidos

- VaSeguro antes aceptaba cualquier convenio.
- La vista de cargos duplica registros: septiembre tenía 2,560 filas para 2,487 cargos. Los nuevos volúmenes parten del cargo único, con cantidad original menos devoluciones.
- Los códigos vigentes de estancia y terapia difieren de los códigos antiguos presentes en los títulos.
- Los filtros incluyen el último día completo y usan límites parametrizados. Se corrigió un desplazamiento de un día ocasionado por enviar fechas ISO como `sql.Date` con `useUTC:false`.
- Los errores ya no se convierten en ceros. El histórico distingue valores ausentes y totales parciales.
- Resumen, detalle y exportación comparten los cálculos. Los rankings están separados y el Excel incorpora sus órdenes de sustento.

## Conciliación real

| Mes | Estudios manuales | Estudios SAP | Diferencia | Importe manual | Importe SAP | Diferencia |
|---|---:|---:|---:|---:|---:|---:|
| Abril | 1,430 | 1,430 | 0 | $1,121,491.32 | $1,121,491.32 | $0.00 |
| Mayo | 1,348 | 1,363 | 15 | $1,169,995.18 | $1,181,455.84 | $11,460.66 |
| Junio | 1,421 | 1,421 | 0 | $1,101,133.48 | $1,101,133.49 | $0.01 |
| Julio | 1,160 | 1,160 | 0 | $917,763.43 | $917,763.43 | $0.00 |
| Agosto | 1,474 | 1,391 | -83 | $1,285,031.86 | $1,214,208.25 | -$70,823.61 |
| Septiembre | 982 | 1,065 | 83 | $885,655.01 | $956,478.60 | $70,823.59 |

Referencias verificadas en los libros:

- `11_COVID.xlsx`, `04_ABRIL`, filas 2:158, grupo 101, estudios en I e importe en J. Se excluyó la fila 159, que repite el total.
- `11_COVID.xlsx`, `05_MAYO`, `06_JUNIO`, `07_JULIO`, `08_AGOSTO` y `09_SEPTIEMBRE`: cantidades en C e importes en D, hasta las últimas filas con código de artículo. Los importes guardados como texto con sufijo MXN se convirtieron a número.
- La pestaña `04_ABRIL` usa un formato distinto: incluye el grupo y una fila total al final. Sumar el total junto con el detalle duplicaría abril; sólo se tomaron las filas del grupo 101.
- `03_14_15_ATENCIONES MEDICAS - MEDICOS HOSPITALIZACION.xlsx`, `09_SEPTIEMBRE SAP`, filas 3:470. F contiene tipo de atención e I el total de la orden. Son 90 órdenes de hospitalización y 378 de urgencias.

Los controles de laboratorio abril-septiembre y los controles de nacimientos julio-septiembre se conservan en `backend/data/statistics_manual_controls.json`. Sólo se aplican al mes completo correspondiente; no se prorratean para rangos arbitrarios ni se anuncian como una verificación universal.

Agosto y septiembre cambian en sentido contrario: el manual tiene 83 estudios y $70,823.61 más en agosto; SAP tiene 83 estudios y $70,823.59 más en septiembre. Al sumar ambos meses, las cantidades coinciden (2,456) y la diferencia de importes es $0.02 a favor del manual. Esto apunta a una diferencia de corte mensual, pero el libro no conserva folios ni una fecha de servicio que permita asignar el movimiento; no se cambió la regla de fecha de contabilización SAP ni se redistribuyeron importes. Mayo mantiene una diferencia independiente de 15 estudios/$11,460.66 en 11 códigos, todos del grupo SAP 101. Junio difiere sólo $0.01.

En mayo las diferencias por código SAP menos manual son:

| Código | Unidades | MXN |
|---|---:|---:|
| SER0237 | 2 | $2,602.00 |
| SER0300 | 1 | $1,652.06 |
| SER0272 | 1 | $1,181.00 |
| SER0299 | 1 | $1,172.00 |
| SER0049 | 1 | $1,102.00 |
| SER0051 | 4 | $1,020.00 |
| SER0260 | 1 | $724.00 |
| SER0335 | 1 | $578.00 |
| SER0332 | 1 | $543.00 |
| SER0348 | 1 | $473.60 |
| SER0312 | 1 | $413.00 |

Los 18 códigos con desplazamiento agosto-septiembre son SER0049, SER0319, SER0260, SER0308, SER0051, SER0480, SER0299, SER0237, SER0317, SER0312, SER0474, SER0348, SER0335, SER0332, SER0070, SER0425, SER0134 y SER0352. El movimiento de 83 unidades/$70,823.60 se conserva distribuido entre estos códigos; un centavo cambia entre sus dos meses y otro centavo aparece en SER0054.

### Diferencia de laboratorio pendiente

Las facturas **145277 (14 de septiembre)** y **145422 (15 de septiembre)** presentan el mismo desglose de laboratorio: 81 unidades y $68,482.61, asociado a la misma atención. SAP reporta ambas vigentes. Esto es una señal para revisión documental, no prueba suficiente para eliminar una.

La comparación por código entre agosto y septiembre encontró 18 códigos con diferencias opuestas: en conjunto, el manual de agosto supera SAP en 83 unidades/$70,823.61 y SAP de septiembre supera su manual en 83 unidades/$70,823.60. El código SER0054 añade en septiembre una diferencia de $0.01 sin diferencia de cantidad. No hay folios ni fechas de servicio en las pestañas manuales para probar qué documentos cambiaron de mes. Esta compensación apunta a un corte mensual distinto, pero no demuestra el motivo.

En la revisión de septiembre del 7 de octubre, excluir hipotéticamente una de las facturas repetidas dejaría dos unidades adicionales (SER0237 por $1,301 y SER0319 por $1,040), además del redondeo. No se aplicó esa exclusión. No se encontraron notas de crédito de los primeros siete días de octubre que explicaran el caso. Deben revisarse los comprobantes y el corte del manual antes de aprobar una corrección en la fuente.

En la consulta SAP de abril-julio se informó una línea de nota de crédito sin factura de origen y atención verificables. No se pudo clasificar esa línea por mes o grupo de servicio; por ello, su posible efecto en laboratorio queda pendiente. Los totales de laboratorio anteriores reflejan la consulta de facturación, pero no se debe considerar cerrada esta conciliación hasta identificar el documento y comprobar su grupo e importe. No se asignó ni eliminó esa nota de crédito por inferencia.

### Nacimientos: regla y conciliación

El usuario confirmó filtrar por doble fecha: `PT.CreatedOn` debe coincidir en fecha calendario con `PT.BirthDate`, y ambas deben caer dentro del periodo. La comparación en memoria del detalle manual contra Vertical, por identificador interno no expuesto, dio:

| Mes | Manual | Vertical | Diferencia | Cruce de registros |
|---|---:|---:|---:|---|
| Julio | 4 | 5 | 1 | 4 coinciden; 1 expediente de Vertical no aparece en el manual |
| Agosto | 8 | 8 | 0 | 8 coinciden |
| Septiembre | 2 | 2 | 0 | 2 coinciden |

La fuente del libro es `02_NACIEMIENTOS.xlsx`, fecha de nacimiento en D y creación en AO. El filtro se implementa en Vertical `PT`; no usa el campo de fecha de cuenta `PC.Date` del KPI legado de cuneros. La diferencia de julio queda visible en la conciliación mensual y no se fuerza el resultado de Vertical al total manual. La coincidencia de fechas es la regla operativa acordada; no existe un campo separado que certifique el lugar físico del parto.

## Verificación y límites

- Lecturas reales de Vertical para nacimientos en abril-septiembre, y del conjunto SAP de facturas/notas de crédito para laboratorio en abril-septiembre; ver [auditoría clínica](auditoria-estadisticos-vertical-2026-10-07.md).
- Lectura completa y paginada de SAP, con órdenes, facturas, notas de crédito y facturas de origen cuando aplica. La paginación incompleta o repetida produce error.
- Pruebas de servicios/rutas cubren fechas, devoluciones, cancelaciones, identidades de médicos, notas de crédito, permisos, datos ausentes, rankings y estructura del Excel.
- Pruebas de navegador cubren selección de fechas, doble envío, descarga, errores, cambios rápidos de sección/detalle y vista móvil. Usan respuestas controladas para comprobar la interfaz; la evidencia de cifras procede de las lecturas reales separadas.
- Compilación del frontend comprobada. No se reinició ni desplegó el servidor de producción.
- La primera consulta de un periodo puede tardar varios minutos por la paginación de SAP. Se usan límites y caché breve; no se entrega un archivo truncado para acelerar la respuesta.

La regla de nacimientos ya está implementada y se cotejó con el manual; queda por revisar el registro adicional de julio. La conciliación de laboratorio conserva diferencias mensuales en mayo, agosto y septiembre, aunque agosto-septiembre coincide al sumar ambos meses salvo $0.02. Además, queda pendiente clasificar una línea de nota de crédito sin origen verificable. El Excel muestra las diferencias y no ajusta importes automáticamente.

## Corrección de la descarga local

La captura de error mostraba la interfaz nueva con resultados del servidor anterior. Al revisar el entorno local no había servidores escuchando en 4000 y 5173. Se restablecieron con el código actual. Una reproducción independiente del reporte completo también detectó un tiempo agotado de SAP en el catálogo: las lecturas simultáneas de catálogo, órdenes y facturas con páginas de 500 registros excedían el límite de 45 segundos.

- El catálogo se consulta primero y se comparte entre solicitudes; los documentos se leen por etapas con páginas de 200 registros. Una cola común limita las lecturas de estadísticas a una solicitud de SAP a la vez, con hasta 90 segundos por petición.
- El explorador carga el histórico cuando se pulsa **Consultar histórico** o se elige una sección. Abrir la pantalla ya no inicia una consulta de seis meses que compita con el reporte mensual.
- La descarga avisa que puede tardar varios minutos. Distingue un servidor sin actualizar de un servicio temporalmente indisponible; un tiempo agotado no genera un archivo parcial.
- Los errores del servidor registran únicamente la ruta y un código controlado, sin respuestas privadas de las fuentes.
- Pruebas de interfaz verifican que el histórico no arranque solo, la descarga, el doble envío y los errores 404/503. Los servicios locales se reiniciaron; no se desplegó producción.

Verificación posterior a la corrección: `getReport` con todas las fuentes reales, sin reutilizar archivos de consultas anteriores, generó septiembre en 182.026 segundos. La solicitud autenticada iniciada desde el botón de Chrome respondió **HTTP 200**, 694,062 bytes, en **209.329 segundos**. La conexión de control de Chrome se perdió durante la espera, por lo que no se inspeccionó el archivo guardado por ese navegador; el resultado HTTP se confirmó en el registro del servidor local.

El libro independiente generado con las fuentes del 7 de octubre se conserva en `outputs/statistics-2026-10-07/Estadistico_2026-09-01_2026-09-30_verificado.xlsx`. Esta revisión posterior añade el filtro de nacimientos por coincidencia de fechas, controles manuales de laboratorio abril-septiembre y de nacimientos julio-septiembre. La regla se cotejó con Vertical; la diferencia de julio y las diferencias mensuales de laboratorio siguen visibles en vez de forzarse a cero.

Validación local del 9 de octubre de 2026: 72 suites y 1,140 pruebas backend aprobadas; ESLint aprobado para los archivos modificados; compilación Vite y construcción del pase aprobadas. `verificar_pase.ps1` y `production-package.cjs verify pase_a_produccion --source` confirmaron 258 archivos y 105,580,399 bytes con fuentes coincidentes. El pase es local y no implica instalación ni reinicio en producción. La consulta adicional para localizar la nota de crédito sin origen no concluyó; la limitación queda asentada arriba.
