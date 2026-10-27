# Estadístico institucional: correspondencia con los Excel base

Revisión: 14 de octubre de 2026. Se conserva el tipo de información del formato entregado históricamente. Los desgloses adicionales se presentan como complementos. Los ocho Excel originales permanecen intactos.

## Criterios corregidos

| Información | Cálculo aplicado |
|---|---|
| Consultas de urgencias, estancia y terapia | Recuento de líneas de servicio de órdenes SAP por fecha de documento, como las tablas dinámicas. Cantidades e importes aparecen separados, también por código. `ImporteLinea` conserva `Orders.DocumentLines.LineTotal` sin IVA y antes del descuento general, como Total Línea del Excel base; `IngresoNeto` conserva el importe después de distribuir ese descuento. La conciliación del importe usa el primero. Los cargos Vertical quedan como fuente clínica complementaria. |
| Médicos por ingreso | Nombre literal del documento, cuenta de órdenes y suma del total con IVA. General combina hospitalización y urgencias; ambos tipos tienen además sus propios rankings. Se conserva Top 10 y lista completa. Las cuentas distintas por médico no se suman entre médicos. |
| Cirugías | Una asignación de quirófano, excluyendo exactamente los tres textos completos que excluye el pivote de abril. No se reproduce la fórmula errónea que vuelve a sumar el subtotal. |
| Nacimientos | Creación del expediente y nacimiento en la misma fecha calendario, dentro del periodo. Se mantiene la regla previamente acordada. |
| Cuentas | Cuentas cerradas y alta médica dentro del periodo. No se sustituyen cuentas por órdenes. |
| Laboratorio | Unidades e importe neto por artículo, con comparación contra `11_COVID.xlsx`, cuyo contenido corresponde a laboratorio general. |

El histórico de médicos muestra la **suma de Top 10 mensuales**. Para obtener el Top 10 de todo un periodo se genera el reporte de ese rango, agrupando sus órdenes antes de elegir los diez nombres.

### Por qué Samperio encabeza las capturas

Los pivotes de las capturas son acumulados generales de hospitalización y urgencias, no rankings del mes ni de hospitalización sola. Samperio es primero en enero–agosto (425 órdenes, $5,685,794.24) y enero–septiembre (438 órdenes, $5,752,607.44). Enero–marzo aporta $4,311,085.18. En septiembre únicamente tiene 13 órdenes de urgencias por $66,813.20: posición 34 general y 7 en urgencias, sin órdenes de hospitalización. En el acumulado de hospitalización enero–septiembre ocupa el quinto lugar.

Se comprobó directamente el detalle y la configuración de ambos pivotes: no hay filtros ocultos que lo coloquen primero. La selección del periodo y del tipo de atención determina la población antes de ordenar por importe descendente. No existe prioridad por nombre de médico. La evidencia por periodo y los primeros diez están en [Samperio: periodos y ranking](../../evidencias/historicas/statistics-reconciliation-2026-10-14/Samperio_periodos_y_ranking.md).

## Fechas y anomalías de las referencias

La hoja `06_JUNIO` de consultas de urgencias contiene 511 filas fechadas en mayo, con 508 órdenes que también aparecen en la hoja de mayo. Sus totales y desgloses se conservan como evidencia, pero la comparación contra junio se identifica como **No comparable**; no se trasladan ni se suman automáticamente a mayo. La columna de diferencia queda sin cálculo cuando la referencia no corresponde al periodo.

El bloque de sistema de sala de choque de junio conserva cinco registros: cuatro de junio y uno fechado el 2 de julio. También se identifica como **No comparable**, manteniendo su cifra original y la explicación de fechas; no se elimina ni se mueve ese registro automáticamente.

La pestaña de médicos `07_JUNIO` sí contiene fechas de julio, coherentes con su prefijo `07`; su palabra JUNIO es incorrecta. Los registros sin fecha verificable y las fuentes agregadas sin fechas se distinguen de una contradicción confirmada. La revisión de fechas no sustituye la revisión de folios, importes o fórmulas.

## Dos referencias de médicos separadas

| Referencia | Periodo del original | Órdenes | Importe MXN |
|---|---|---:|---:|
| ANUAL 2026 | Enero a septiembre de 2026 | 4,911 | 81,807,644.87 |
| Hoja2 | Enero a agosto de 2026 | 4,439 | 74,385,118.36 |

Se conservan en el expediente de auditoría y en las referencias internas, con sus periodos originales. No se incluyen en el Excel de entrega directiva ni se suman al reporte seleccionado. Sus controles se comparan por separado cuando el rango consultado cubre íntegramente las fechas del corte. El detalle de las diferencias entre ambos originales está en [la auditoría de los ocho libros](../../evidencias/historicas/statistics-reconciliation-2026-10-14/Auditoria_Excel_Base.md). La comprobación adicional de órdenes SAP enero–marzo sí fue una lectura real completa: 15,743 órdenes y 56,802 líneas; las 263 órdenes de Samperio suman $4,311,085.18 y coinciden con cada mes del original.

El corte enero–agosto de ANUAL conserva 4,443 órdenes/$75,277,845.66 frente a 4,439/$74,385,118.36 en Hoja2. La diferencia de cuatro órdenes/$892,727.30 se explica íntegramente por seis órdenes sólo en ANUAL ($1,615,880.57) y dos sólo en Hoja2 ($723,153.27); los 4,437 documentos compartidos conservan médico, tipo, fecha e importe. Cambian las cifras de cuatro médicos y la posición de 18; 15 de éstos mantienen sus cifras. Samperio conserva el primer lugar, sus 425 órdenes y $5,685,794.24 en ambos. No se atribuyen cancelaciones sin evidencia. La revisión por documento y ambos Top 10 están en [Diferencia de los cortes enero–agosto](../../evidencias/historicas/statistics-reconciliation-2026-10-14/Enero_agosto_diferencia_Hoja2_ANUAL.md).

El cálculo completo aplica la misma clasificación que la plataforma: si SAP no confirma el tipo, lo completa desde la cuenta de Vertical. Una orden del 10 de enero por $400 tiene tipo vacío en SAP y cuenta ER confirmada en Vertical. El anual actual contiene por ello 4,912 órdenes/$81,808,044.87: una orden/$400 más que ANUAL. Son tres controles distintos afectados por un solo caso, sin modificar ningún Top 10. Enero–agosto actual contiene 4,444/$75,278,245.66, cinco órdenes/$893,127.30 más que Hoja2. Se distingue la diferencia entre los originales de esta clasificación complementaria; no se oculta la orden ni se califica automáticamente al archivo como erróneo. Samperio coincide en posición, órdenes e importe en ambos cortes. Los soportes clínicos de enero–agosto y enero–septiembre se leyeron íntegros; el soporte financiero combina la lectura completa enero–marzo (14,871 facturas/notas de crédito y 49,569 líneas) con las consultas verificadas abril–septiembre, conservando fechas y huellas de cada lectura. No es una nueva consulta simultánea de todo el año.

## Comprobación real de septiembre de 2026

| Medida | Base | Consulta | Resultado |
|---|---:|---:|---|
| Hospitalización: cuentas | 82 | 82 | Mismos folios |
| VaSeguro: cuentas | 115 | 115 | Mismos folios |
| Nacimientos | 2 | 2 | Coincide |
| Consultas urgencias: registros | 335 | 335 | Coincide |
| Estancia: registros | 86 | 86 | Coincide |
| Terapia: registros | 4 | 4 | Coincide |
| Órdenes hospitalización MXN | 5,225,088.12 | 5,225,088.12 | Coincide |
| Órdenes urgencias MXN | 1,304,711.09 | 1,304,711.09 | Coincide |
| Urgencias: cuentas | 374 | 378 | Cuatro cuentas adicionales vigentes |
| Laboratorio: unidades | 982 | 1,065 | Diferencia de 83 |
| Laboratorio: importe neto MXN | 885,655.01 | 956,478.63 | Diferencia de 70,823.62 |

Coinciden los 131 controles por médico de los tres rankings: nombre, cantidad de órdenes, importe y posición. También coinciden los recuentos, cantidades e importes por cada código de consulta, estancia y terapia. En conjunto hay 333 comparaciones: 312 coinciden y 21 difieren. Estas 21 comprenden tres medidas generales (cuentas urgencias, unidades laboratorio e importe laboratorio) y 18 artículos de laboratorio. Otros seis apartados no tienen una referencia comparable de septiembre en los archivos proporcionados.

Los cuatro folios adicionales de urgencias no sustituyen ni eliminan los 374 originales. El Excel no documenta si la diferencia se debe a cierres posteriores o a una selección manual. En laboratorio, el detalle original contiene artículos y totales, pero no folios de facturas para atribuir la diferencia a documentos concretos. No se eliminaron facturas vigentes ni se ajustaron importes para producir una coincidencia aparente.

## Exportación y consulta

1. En Estadísticas, revisar las fechas del periodo; sala de choque usa ese mismo rango.
2. Abrir **Generar estadístico**: inicia con las fechas del tablero. Si se editan, **Ver estas fechas en el tablero** aplica el mismo rango a sus indicadores y rankings. La interfaz señala cuando el rango de descarga difiere del consultado. Descargar el Excel completo, disponible desde enero de 2026. **Acumulado del año** termina hoy; los cortes de las capturas se consultan expresamente con final 31/08 o 30/09. Los años anteriores conservan información agregada y no se ofrecen como detalle.
3. En **Resumen**, consultar indicador, total y unidad. Los indicadores enlazan su detalle.
4. En médicos, una sola tabla conserva el listado completo y resalta los diez primeros; el importe del Top 10 está arriba y el total de todos está al pie.
5. **Órdenes por médico** y **Servicios por concepto** aportan el detalle complementario, con el alcance y las medidas identificados.

El Excel de septiembre contiene **22 hojas**. Se quitaron conciliaciones, hojas de referencias, Criterios y notas repetidas. Cada apartado conserva título, periodo y resultado en B4; la tabla empieza en fila 5 y los datos en fila 6. Importes y fechas son numéricos, con filtros y paneles fijos; los totales monetarios usan ROUND(SUM(...),2) y resultados guardados compatibles con Excel, incluidos créditos. Las cantidades no se redondean para calcular su SUM. Los datos ausentes permanecen explícitos.

El histórico y el detalle individual descargan una sola hoja. Periodo, unidad y alcance están arriba; las explicaciones largas se despliegan en la interfaz y sólo los avisos necesarios aparecen al final de la descarga. El detalle permite todos los registros o los filtrados, conservando el total del periodo con su alcance explícito.

## Revisión de las 241 diferencias

La [revisión detallada](../../evidencias/historicas/statistics-reconciliation-2026-10-14/Diferencias_241_Explicadas.md) está fuera del Excel directivo. Conserva cada fila inicial y sus referencias; distingue cortes originales diferentes, registros actuales cancelados o adicionales, errores corregidos y residuos sin causa probada.

El sistema preserva la precisión del prorrateo de descuento e IVA hasta sumar cada medida y redondear el total. Esta corrección resuelve 12 filas originales y revela cuatro centavos que el método anterior compensaba; 233 comparaciones siguen distintas, incluidas 74 variaciones exclusivamente de posición de médicos. No son 233 errores independientes. La cirugía faltante de abril está cancelada actualmente, al igual que las órdenes de choque faltantes de abril; los registros adicionales cumplen los filtros actuales. Para seis residuos de laboratorio de junio y otros agregados sin documentos se mantiene explícito el límite de trazabilidad.

## Evidencia y mantenimiento

El cotejo inicial, anterior a la corrección de precisión, [de abril a septiembre](../../evidencias/historicas/statistics-reconciliation-2026-10-14/Cotejo_SAP_Vertical_abril_septiembre_2026.md) registra por mes las lecturas completas, las coincidencias, las diferencias y las referencias no comparables. La auditoría de los originales y el cotejo de fuentes actuales se conservan separados.

- Inventario completo: ocho libros, 46 hojas, 38 pivotes, seis fórmulas; SHA-256 de originales sin cambios.
- Referencias operativas: `backend/data/statistics_base_references.json`, con 68 controles, 36 rankings y 834 registros agregados de laboratorio. No contiene datos de pacientes.
- Extracción reproducible y revisión de pivotes: `outputs/statistics-reconciliation-2026-10-14/`.
- Reglas comunes: `statistics.service.js`, `statisticsCatalog.js`, `statisticsSap.service.js`, `statisticsVertical.service.js` y `statisticsReconciliation.js`.
- Libro institucional: `statisticsWorkbook.service.js`; exportaciones de la interfaz: `frontend/src/utils/statisticsWorkbook.js`.

Las pruebas automatizadas verifican cálculos, fechas, datos faltantes, agrupaciones, exportaciones y permisos; la interfaz se comprobó con respuestas controladas. Las cifras de septiembre proceden de una lectura real separada de SAP y Vertical. La verificación local no constituye despliegue ni reinicio del servidor de producción.
