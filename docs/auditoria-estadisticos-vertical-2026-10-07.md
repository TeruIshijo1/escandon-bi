# Auditoría de fuentes clínicas para estadísticos

Consulta real de sólo lectura del 7 de octubre de 2026. Periodos examinados: julio, agosto y septiembre de 2026. Se usó la conexión configurada de Vertical y únicamente `SELECT` de metadatos o agregados; no se modificó ninguna base remota. Este documento no contiene registros identificables de pacientes.

## Criterios implementados

El servicio `backend/services/statisticsVertical.service.js` usa fechas iniciales inclusivas y fechas finales exclusivas. Se comprobó que enviar texto ISO como `sql.Date` con `useUTC:false` retrocedía el inicio un día en esta zona horaria; ahora se parametriza texto ISO de diez caracteres y SQL Server compara las fechas sin esa conversión.

| Concepto | Fuente y regla |
| --- | --- |
| Hospitalización / urgencias | `PC`, cuenta cerrada `CL`, tipo `IP` / `ER`, fecha de alta médica. No se confunde el alta médica con cierre contable. |
| VaSeguro | Las mismas cuentas con `EXISTS PCAG` de `AGCode=VAGSEG001` y `PCAG_ST=AU`. El catálogo identifica `VASEGURO PAQUETE`; los demás convenios y convenios cancelados quedan excluidos. |
| Consultas de urgencias | `PCIT` vigente `CH`, cantidad neta `Quantity-Returned`, fecha de cargo, códigos `SER0508`, `SER0509`, `SER0510`, `SER0511`, `SER0526`, `SER0527`, `SER0528`, `SER0529`, `SER1272`, `SER1278`. No incluye interconsultas. |
| Estancia | Servicios `SER0653`, `SER0654`, `SER0657`, `SER0658`, `SER0660`, `SER0661`, `SER0662`, `SER0663`, `SER1234`, `SER1286`, bajo la misma regla de cargo neto. Se presentan unidades, renglones y atenciones por separado. Excluye estancia por hora en urgencias. |
| Terapia | Servicios de estancia `SER0658`, `SER0660`, `SER0661`, `SER0662`, `SER0663`: intensiva, intermedia y neonatal. Excluye insumos, interconsultas y traslados en ambulancia. |
| Imagen / laboratorio de cuentas | Cargos netos `PCIT` de grupos de catálogo `117` / `101`. No cubren por sí solos las ventas a externos. Son un control clínico separado de las cantidades e importes SAP. |
| Quirófano | `UDR_USOQX` deduplicado por `PCFRNum`, unido por `PCFR.PCNum` a la cuenta. Se distingue atenciones únicas de estancias. No equivale al número de técnicas realizadas. |
| Procedimientos ambulatorios | Definición confirmada por el usuario: ingreso y egreso en la misma fecha calendario. Se cuentan estancias con procedimientos registrados en quirófano, cuenta cerrada y `PC.Date` / `PC.MedicalDischargeDate` en la misma fecha; el periodo se aplica al inicio del procedimiento. El cargo llamado estancia ambulatoria no determina la inclusión. |

Todos los cargos exigen una cuenta con estado observado `OP`, `CL` o `PD`. Las consultas tienen límite de 100,000 filas y fallan explícitamente si lo exceden; nunca se publica un subtotal truncado como completo.

## Conciliación obtenida de la base actual

| Métrica | Julio | Agosto | Septiembre |
| --- | ---: | ---: | ---: |
| Cuentas cerradas hospitalización por alta médica | 111 | 101 | 82 |
| Cuentas cerradas urgencias por alta médica | 375 | 253 | 378 |
| Cuentas VaSeguro autorizado | 85 | 8 | 115 |
| Consultas urgencias: unidades netas | 335 | 249 | 340 |
| Estancia: unidades netas | 246 | 224 | 206 |
| Estancia: renglones de cargo | 242 | 222 | 206 |
| Estancia: atenciones distintas | 105 | 103 | 84 |
| Terapia: unidades netas | 18 | 15 | 15 |
| Quirófano: atenciones distintas | 69 | 71 | 51 |
| Quirófano: estancias | 77 | 72 | 54 |
| Procedimientos ambulatorios: estancias con ingreso y egreso el mismo día | 9 | 15 | 4 |
| Imagen: cargos netos de cuentas | 493 | 356 | 356 |
| Laboratorio: cargos netos de cuentas | 990 | 939 | 846 |

Estos resultados representan el estado actual consultado. No prueban coincidencia con capturas históricas de Excel ni con facturación SAP: difieren las fechas, el universo y las unidades de conteo. Los Excel manuales revisados por separado cuentan renglones en estancia y consultas; sumar unidades netas es una métrica distinta y se identifica como tal.

## Problemas comprobados en la lógica anterior

- `UDR_CUENTAS_SERVICIOS` repite identificadores de cargo: julio 3,006 filas / 2,919 cargos; agosto 2,426 / 2,366; septiembre 2,560 / 2,487. Sumar esa vista sin deduplicar aumenta cantidades e importes.
- `CANTIDAD_TOTAL` de esa vista difiere del neto del cargo en 166 / 121 / 157 filas respectivamente. `TOTAL` sí coincide con `PCIT.Quantity-Returned` en todas las filas comparadas; se usa directamente `PCIT` para evitar ambos problemas.
- Las reversas `RT` tienen cantidad devuelta igual a la original en el corte. Hay cargos `CH` parcialmente devueltos; por eso no basta excluir `RT`: hay que restar `Returned`. Se excluyen `RR` y `CA`.
- La existencia de cualquier `PCAG` incluía descuentos y otras aseguradoras en VaSeguro. También había convenios VaSeguro cancelados (3 cuentas en julio, 5 en septiembre); el nuevo filtro exige el autorizado.
- La vista de solicitudes contiene estados pendientes y cancelados. Septiembre de imagen incluía una solicitud `OP` cuya cabecera estaba cancelada; contar solicitudes no acredita estudios prestados.
- `UDR_USOQX.Numero_Atencion_Medica` puede contener el texto `Eliminado`; se evita convertir ese campo a entero y se usa la relación numérica de la estancia a la cuenta.

## Información que falta para certificar los totales

**Nacimientos dentro del hospital.** No se encontró campo estructurado de lugar de nacimiento ni relación madre/bebé. `PC.DateOfBirth`, `PCNumRef`, `PCNumBase` y diagnósticos `Z38` no aportaron evidencia poblada en la cohorte neonatal examinada. Existen campos de texto `NACIMIENTO`, `DATOS_NACIMIENTO` y `APGAR` en `MR_HC_HOS`, pero no hubo historias de esta cohorte. `MR_TERM_EMB` tampoco devolvió registros del trimestre; un consentimiento de cesárea no prueba el nacimiento ni el número de bebés. La misma fecha de ingreso/nacimiento y uso de cunero no descartan traslados. El sistema deja el total pendiente, en vez de informar cero o una inferencia como nacimiento confirmado.

**Alcance de procedimientos ambulatorios.** El usuario confirmó que son atenciones con ingreso y egreso el mismo día. Esta regla ya está implementada y sus totales aparecen arriba; el detalle incluye ambas fechas y el texto de todos los procedimientos registrados por estancia. Se excluyen cuentas abiertas, fechas de egreso ausentes y pernoctas, aunque el cargo se llame ambulatorio. La fuente comprobada es quirófano: `PCMP` no aportó procedimientos del trimestre por fecha de procedimiento o por estancia y `PCFR.CPCode` estaba vacío. No se suman rentas de endoscopio, anestesia ni servicios de estancia como procedimientos adicionales. Los procedimientos fuera de la fuente de quirófano requieren otra fuente de ejecución acreditada para ampliar la cobertura.

**Consulta de especialidad.** La vista del día mezcla órdenes `Confirmada`, `Procesada` y `Sin Orden de Venta`; incluye miles de citas cuyo estado no acredita consulta realizada. No se publica ese conteo como actividad prestada. Debe conciliarse contra servicios efectivamente prestados/facturados con la definición acordada.

**COVID-19.** No se ha validado una fuente de casos confirmados. El valor permanece pendiente.

## Evidencia reproducible

- Ejecutor acotado de lectura: `tmp/clinical-audit.cjs`.
- Consultas y resultados agregados: `tmp/clinical-audit-{catalog,services,services2,final,remaining,procedures}*.json*`.
- Validación del servicio completo sin imprimir detalles personales: `tmp/clinical-audit-implementation.cjs`; resultados `tmp/clinical-audit-implementation-results.jsonl`.
- Nueve pruebas unitarias aprobadas en `backend/tests/statisticsVertical.test.js`: deduplicación, unidades netas, selección de servicios, VaSeguro, resultados desconocidos, ambulatorios con ingreso y egreso el mismo día, granularidad de quirófano, fechas, truncamiento y parámetros de clasificación.
- Las pruebas unitarias usan datos sintéticos; la lectura real de tres meses es una verificación independiente. Ninguna sustituye aprobación clínica/administrativa de las definiciones pendientes ni acredita una conciliación financiera completa.
