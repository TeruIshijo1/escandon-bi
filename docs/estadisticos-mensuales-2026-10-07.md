# Estadísticos mensuales: criterios y conciliación

Revisión: 7 de octubre de 2026. Fuentes consultadas en modo lectura: Vertical, SAP Business One Service Layer y los ocho libros de `Excel base`. No se modificaron datos en Vertical ni SAP.

## Uso

En Estadísticas, **Generar estadístico** abre un formulario de fechas. Ambas fechas se incluyen completas. El periodo predeterminado es el mes anterior, según la fecha de Ciudad de México. El detalle está disponible desde el 1 de abril de 2026; los meses anteriores conservan los totales históricos originales, sin repartir personas proporcionalmente entre días.

El Excel reúne resumen, apartados, documentos que sustentan los Top 10, comparación con referencias manuales y criterios. Los errores de consulta impiden la descarga; los datos no verificables se muestran como **No disponible**, nunca como cero. Un archivo descargado puede contener observaciones pendientes: deben revisarse antes de enviarlo.

Se exige el permiso `estadisticas` en las cuatro rutas de lectura/exportación, además de la capacidad de exportación en la descarga. Se conserva la excepción administrativa existente de la plataforma.

## Criterios

| Apartado | Criterio aplicado |
|---|---|
| 02 Nacimientos | Requiere evidencia de nacimiento dentro del hospital. Edad, fecha de alta y uso de cunero no lo prueban. **Pendiente de identificar el registro válido**; no se publica un conteo supuesto. |
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

| Control | Manual | Consulta actual | Diferencia |
|---|---:|---:|---:|
| Septiembre: órdenes hospitalización | $5,225,088.12 | $5,225,088.12 | $0.00 |
| Septiembre: órdenes urgencias | $1,304,711.09 | $1,304,711.09 | $0.00 |
| Julio: unidades laboratorio | 1,160 | 1,160 | 0 |
| Julio: ingreso laboratorio | $917,763.43 | $917,763.43 | $0.00 |
| Septiembre: unidades laboratorio | 982 | 1,065 | 83 |
| Septiembre: ingreso laboratorio | $885,655.01 | $956,478.60 | $70,823.59 |

Referencias verificadas en los libros:

- `11_COVID.xlsx`, `07_JULIO`, filas 2:135, cantidad en C e importe en D.
- `11_COVID.xlsx`, `09_SEPTIEMBRE`, filas 2:140, cantidad en C e importe en D. Los importes están guardados como texto con sufijo MXN; se convirtieron a número para la comparación.
- `03_14_15_ATENCIONES MEDICAS - MEDICOS HOSPITALIZACION.xlsx`, `09_SEPTIEMBRE SAP`, filas 3:470. F contiene tipo de atención e I el total de la orden. Son 90 órdenes de hospitalización y 378 de urgencias.

Los controles de referencia y sus rangos se conservan en `backend/data/statistics_manual_controls.json`. Sólo se aplican al mes completo correspondiente; no se prorratean para rangos arbitrarios ni se anuncian como una verificación universal.

### Diferencia de laboratorio pendiente

Las facturas **145277 (14 de septiembre)** y **145422 (15 de septiembre)** presentan el mismo desglose de laboratorio: 81 unidades y $68,482.61, asociado a la misma atención. SAP reporta ambas vigentes. Esto es una señal para revisión documental, no prueba suficiente para eliminar una.

La diferencia total comprende 18 códigos. Excluir hipotéticamente una de esas facturas dejaría dos unidades adicionales (SER0237 por $1,301 y SER0319 por $1,040), además del redondeo. No se aplicó esa exclusión. No se encontraron notas de crédito de los primeros siete días de octubre que explicaran el caso. Deben revisarse los comprobantes y el corte del manual antes de aprobar una corrección en la fuente.

### Nacimientos pendiente

Los campos de origen y vínculos revisados no contienen evidencia suficiente del lugar de nacimiento. Los libros manuales incluyen pacientes nacidos en meses anteriores; el catálogo de pacientes no equivale a un registro de partos. Falta confirmar con el usuario el registro que usan para distinguir nacidos en el hospital de recién nacidos trasladados.

## Verificación y límites

- Lecturas reales de Vertical en julio, agosto y septiembre; ver [auditoría clínica](auditoria-estadisticos-vertical-2026-10-07.md).
- Lectura completa y paginada de SAP, con órdenes, facturas, notas de crédito y facturas de origen cuando aplica. La paginación incompleta o repetida produce error.
- Pruebas de servicios/rutas cubren fechas, devoluciones, cancelaciones, identidades de médicos, notas de crédito, permisos, datos ausentes, rankings y estructura del Excel.
- Pruebas de navegador cubren selección de fechas, doble envío, descarga, errores, cambios rápidos de sección/detalle y vista móvil. Usan respuestas controladas para comprobar la interfaz; la evidencia de cifras procede de las lecturas reales separadas.
- Compilación del frontend comprobada. No se reinició ni desplegó el servidor de producción.
- La primera consulta de un periodo puede tardar varios minutos por la paginación de SAP. Se usan límites y caché breve; no se entrega un archivo truncado para acelerar la respuesta.

La conciliación no está cerrada mientras falten la evidencia de nacimientos y la revisión de las diferencias señaladas.

## Corrección de la descarga local

La captura de error mostraba la interfaz nueva con resultados del servidor anterior. Al revisar el entorno local no había servidores escuchando en 4000 y 5173. Se restablecieron con el código actual. Una reproducción independiente del reporte completo también detectó un tiempo agotado de SAP en el catálogo: las lecturas simultáneas de catálogo, órdenes y facturas con páginas de 500 registros excedían el límite de 45 segundos.

- El catálogo se consulta primero y se comparte entre solicitudes; los documentos se leen por etapas con páginas de 200 registros. Una cola común limita las lecturas de estadísticas a una solicitud de SAP a la vez, con hasta 90 segundos por petición.
- El explorador carga el histórico cuando se pulsa **Consultar histórico** o se elige una sección. Abrir la pantalla ya no inicia una consulta de seis meses que compita con el reporte mensual.
- La descarga avisa que puede tardar varios minutos. Distingue un servidor sin actualizar de un servicio temporalmente indisponible; un tiempo agotado no genera un archivo parcial.
- Los errores del servidor registran únicamente la ruta y un código controlado, sin respuestas privadas de las fuentes.
- Pruebas de interfaz verifican que el histórico no arranque solo, la descarga, el doble envío y los errores 404/503. Los servicios locales se reiniciaron; no se desplegó producción.

Verificación posterior a la corrección: `getReport` con todas las fuentes reales, sin reutilizar archivos de consultas anteriores, generó septiembre en 182.026 segundos. La solicitud autenticada iniciada desde el botón de Chrome respondió **HTTP 200**, 694,062 bytes, en **209.329 segundos**. La conexión de control de Chrome se perdió durante la espera, por lo que no se inspeccionó el archivo guardado por ese navegador; el resultado HTTP se confirmó en el registro del servidor local.

El libro independiente generado con las mismas fuentes se conserva en `outputs/statistics-2026-10-07/Estadistico_2026-09-01_2026-09-30_verificado.xlsx`. Se comprobaron sus 22 hojas, 18 totales del resumen y 21 fórmulas contra la revisión anterior: todos coinciden, sin errores de Excel. La única ampliación estructural es la columna de servicios sin artículo en Especialidad; no altera importes ni cantidades. Siguen pendientes los nacimientos y la diferencia de laboratorio documentados arriba. Pasaron 48 pruebas de backend, 5 de presentación, la prueba de navegador con respuestas controladas y la compilación final.
