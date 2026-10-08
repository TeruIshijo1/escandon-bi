# Revisión de precios de referencia de honorarios

Revisión del 5 de octubre de 2026, 12:39 h, Ciudad de México. Consultas de solo lectura a Vertical y a la base BI configurada en este proyecto.

**BI copia correctamente los precios de Vertical, pero algunos registros de origen necesitan aclaración antes de usarse como tarifa autorizada.** La fecha de sincronización acredita cuándo se copiaron; no acredita la vigencia del honorario.

## Comprobación de la copia

- Vertical contiene 226 registros en `UT_Honorarios`, correspondientes a 223 códigos.
- Los 225 registros vinculados al catálogo BI coinciden exactamente con Vertical en identificador, importe, descripción y notas: **cero diferencias**.
- El registro restante es `AF00573`, un marcapasos de $45,000 sin ficha actual en el catálogo consultado. No es un honorario médico omitido.
- De las referencias de origen, 211 códigos corresponden a conceptos activos dentro del alcance de honorarios. Los otros 12 códigos incluyen conceptos fuera del alcance, inactivos y el registro sin ficha.
- No se encontraron importes nulos, negativos ni con más de dos decimales.
- Última sincronización correcta del catálogo BI: 5 de octubre de 2026, 12:12 h. No registró error.

## Los 11 servicios que requieren revisión

Los identificadores son `Id_UT` de Vertical. Los importes de esta tabla son referencias existentes, no nuevas tarifas autorizadas.

| Código | Servicio | Referencias en Vertical | Qué debe aclararse |
| --- | --- | --- | --- |
| SER0521 | Colocación de catéter Urgencias 1 | $1,500 (43) y $1 (274) | Hay dos importes distintos. La descripción del registro 43 también es más general. Confirmar cuál aplica al servicio y médico. |
| SER1277 | Interconsulta de especialidad Privados | $1,000 (218) y $600 (287) | Hay dos importes distintos. La nota del registro 218 indica que el concepto debería corresponder a jornadas de especialidad Privados A y B. Aclarar concepto e importe. |
| SER0655 | Jornada de vigilancia de especialidad Privados PA y PB | $1,000 (180) y $1,000 (286) | Registro duplicado con el mismo importe. No representa dos honorarios ni $2,000 por unidad. |
| SER0728 | Cirugía de terceros molares | $0 (42) | La nota indica «SIN COSTEO». Falta confirmar el honorario autorizado. |
| SER0735 | Endodoncia | $0 (191) | La nota indica «SIN COSTEO». Falta confirmar el honorario autorizado. |
| SER1281 | Honorarios médicos | $1 (288) | Importe nominal y concepto general. Confirmar importe, médico y servicio antes de autorizar. |
| SER2382 | Valoración preoperatoria | $1 (295) | Confirmar el importe real autorizado. |
| SER0539 | Colocación de catéter Urgencias 2 | $2 (275) | Importe muy pequeño que requiere confirmación; no se presupone una tarifa correcta. |
| SER0667 | Colocación de catéter Terapia | $3 (276) | Importe muy pequeño que requiere confirmación. |
| SER1469 | Colocación de catéter Privados | $4 (277) | Importe muy pequeño que requiere confirmación. |
| SER0570 | Ecocardiograma transtorácico en reposo | $1,800 (173); la nota también menciona $2,250 | La nota distingue importes según el médico. No tomar $1,800 como importe universal. |

La secuencia de catéteres contiene importes de $1, $2, $3, $4 y $5 en registros consecutivos. El registro de $5 corresponde a `SER1276`, actualmente fuera del alcance de honorarios por su clasificación. Esa secuencia justifica revisar los datos; por sí sola no permite determinar el importe correcto ni cambiar el alcance del servicio.

## Sobre el precio de $600 mostrado en pantalla

Se confirmó que $600 existe en Vertical para 22 códigos. La captura recibida no muestra el código o nombre del servicio, por lo que no permite identificar cuál de ellos es.

Si el servicio es **SER1277**, también existe una referencia de $1,000 y la diferencia está pendiente de aclaración. Para los otros códigos, una única referencia de $600 no demuestra que ese importe siga autorizado o aplique a todos los médicos.

Códigos que tienen alguna referencia de $600: SER0507, SER0508, SER0509, SER0510, SER0511, SER0519, SER0525, SER0526, SER0527, SER0528, SER0529, SER0537, SER0744, SER0747, SER1277, SER1484, SER1487, SER1489, SER1500, SER1503, SER1505 y SER2362.

## Otras referencias comprobadas

| Código | Concepto Afirma | Referencia |
| --- | --- | --- |
| SER1467 | Medicina interna | $225 |
| SER1470 | Nutrición | $200 |
| SER1471 | Psicología | $250 |

Estos tres códigos no presentan importes contradictorios. La nota de Nutrición contiene únicamente un punto; no establece condiciones de pago.

## Uso para pagar y pase a producción

`UT_Honorarios` contiene código, descripción, importe y notas; no tiene campos de vigencia ni de médico. Por ello, las referencias deben contrastarse con la autorización correspondiente y registrarse como tarifa BI con médico, función y fechas cuando aplique.

En la base BI consultada había **cero tarifas autorizadas registradas**. Se comprobó en el código que los precios de referencia no generan automáticamente una tarifa ni un pago: el cálculo exige una tarifa autorizada aplicable a la fecha del servicio. Las referencias múltiples se muestran por separado y conservan sus notas.

La revisión no modificó Vertical, tarifas BI, autorizaciones ni pagos. No se eligió automáticamente entre los importes contradictorios. Los 11 casos anteriores deben resolverse con el responsable de honorarios antes de registrar sus tarifas; no hay evidencia suficiente para sustituirlos por otros valores.

El informe se incluye en la carpeta de pase `pase_a_produccion`. Preparar y verificar esa carpeta no equivale a aplicar el pase en el servidor ni a autorizar estos precios.

## Evidencia técnica

- Lecturas: `CATALOG_SQL` y `REFERENCE_SQL` de `backend/services/honorariosCatalog.service.js`, metadatos de `UT_Honorarios` y tablas BI del catálogo, sincronización y tarifas.
- Vertical: consultas `SELECT`/`WITH`; PostgreSQL: transacción `READ ONLY`, finalizada con `ROLLBACK`.
- Cotejo de referencias por código de servicio, sin seleccionar por coincidencia de nombre, y comparación de todos los registros de cada código.
- El código preparado incluye 2,960 conceptos; la copia BI tenía 2,424. La diferencia corresponde a los 536 conceptos del catálogo quirúrgico CP incorporados al pase anterior, que no tienen registros en `UT_Honorarios`. Actualizar y sincronizar el catálogo tras aplicar ese pase incorporará esos conceptos; no corrige ni decide los precios señalados arriba.
