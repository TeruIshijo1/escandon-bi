# Revisión de honorarios médicos: KH_HE y Plataforma-BI

Fecha de revisión: 25 de septiembre de 2026. Periodo examinado: 01/09/2026 a 25/09/2026, inclusive. Moneda: MXN.

Actualización: se realizó posteriormente una revisión de SAP Service Layer, documentada en `docs/revision-sap-honorarios-2026-09-25.md`. Aporta proveedores candidatos, retenciones contabilizadas y aplicaciones de pago; también detecta campos fiscales incompletos. Complementa, sin sustituir, las conclusiones y escenarios de este corte de KH_HE.

**Conclusión: los importes actuales no deben tratarse como una liquidación fiscal validada.** Hay errores matemáticos reproducidos, duplicación de bases en la integración y controles insuficientes para determinar el impuesto aplicable y documentar el pago. Una cuenta que cuadra no demuestra que el impuesto corresponda al prestador o al servicio.

Esta entrega es una auditoría y una especificación de corrección. No se modificaron las vistas, los datos de KH_HE, el código operativo ni el despliegue. Las consultas fueron de lectura. Se conservaron los cambios que ya existían en el proyecto.

## Alcance y evidencia

Se comprobó la conexión a `KH_HE`, se consultaron `UDR_HON_PAGO_Audit`, `UDR_HON_PAGO`, `PR` y `UT_Honorarios`, y se ejecutó el manejador real de `/api/honorarios/audit` con las fechas anteriores. Se reprodujeron las funciones actuales de cálculo del componente y el generador real de PDF en un entorno local de prueba.

La consulta devolvió 9,673 renglones: 2,498 aprobados, 7,175 excluidos y 89 médicos con aprobaciones. Reprodujo exactamente la base, el ISR y el neto de la captura. La captura tiene ocho exclusiones menos; se trata de un corte de una base activa, no de una fotografía transaccional inmutable. Los recálculos utilizan el mismo archivo local de resultados, sin ajustes de `localStorage` del navegador del usuario.

La cuenta disponible tiene `VIEW DEFINITION = 0` para ambas vistas. Son vistas sin cifrar, pero no se pudo leer su definición SQL. Por tanto, se verificaron sus resultados y su integración, sin atribuirles una fórmula interna que no se pudo inspeccionar. No se examinaron XML timbrados, constancias fiscales, contratos, transferencias ni declaraciones.

Se generaron y renderizaron tres PDF de prueba: el caso de la captura, el prestador con más conceptos distintos del corte y un caso sintético con 35 conceptos. Los dos primeros caben en una página; el tercero pierde el resumen financiero y la firma por falta de paginación.

## Conciliación numérica

| Cálculo reproducido | Base | IVA mostrado | ISR | Neto mostrado/calculado |
|---|---:|---:|---:|---:|
| Indicador general actual | $624,018.00 | $15,156.00 | $43,864.82 | $595,309.18 |
| Suma de resúmenes por médico / lógica PDF | $624,018.00 | $15,156.00 | $42,361.82 | $596,812.18 |
| Suma de renglones del detalle | $624,018.00 | $15,156.00 | $42,359.94 | $596,814.06 |
| Escenario: ISR sobre base y sin repetir los dos importes agregados identificados | $623,068.00 | $15,156.00 | $42,310.57 | $595,913.43 |

**La última fila no es una autorización de pago ni el neto fiscal definitivo.** Conserva los impuestos configurados, los demás renglones aprobados y el redondeo actual por médico; no resuelve la retención de IVA, perfiles fiscales, CFDI ni las excepciones de elegibilidad. Sirve para aislar el efecto de dos defectos comprobados.

## Hallazgos y correcciones concretas

**1. Prioridad alta: ISR sobre IVA en el indicador general.**

En `frontend/src/components/honorarios/HonorariosAuditView.jsx:402`, se calcula `gross = base + iva` y se multiplica por la tasa ISR. El resumen por médico, línea 459, y el PDF, línea 201, usan la base. La diferencia del periodo es $1,503.00 de ISR adicional en el indicador y la misma reducción del neto mostrado.

La anomalía también aparece en resultados de KH_HE: en 422 renglones con `IVA_PC > 0` e ISR de 10%, `RetISR_PC` coincide con 10% de `Total_PC`, no de `Subtotal_PC`. Ejemplo de totales de una atención: subtotal $225, IVA $36, total $261, ISR $26.10 y neto $234.90; el ISR sobre base sería $22.50. Estos campos `_PC` son agregados repetidos en las líneas: no deben sumarse directamente.

Corrección: establecer un cálculo único sobre la base fiscal del honorario y usar sus resultados en indicadores, detalle y exportaciones. La vista SQL requiere revisión por su propietario antes de reutilizar `RetISR_PC` como dato fiscal autorizado.

**2. Prioridad alta: se repite un total agregado en cada renglón del detalle.**

`backend/routes/honorarios.routes.js:127` une por `UDRKey + ItemCode` y selecciona `p.BaseImporte` para cada fila de auditoría. La vista de pago ya agrupó dos unidades en estos casos:

| Clave / servicio | Renglones de auditoría | Base individual en auditoría | Cantidad / base en pago | Base resultante en BI | Exceso |
|---|---:|---:|---:|---:|---:|
| CITA-20927 / SER0578 | 2 | $225.00 | 2 / $450.00 | $900.00 | $450.00 |
| SO-38684 / SER0758 | 2 | $250.00 | 2 / $500.00 | $1,000.00 | $500.00 |

La base propuesta está inflada en $950.00; con las tasas actuales, el exceso de neto en el resumen por médico es $898.75. Esto no demuestra que se haya efectuado un pago indebido: no se revisaron pagos bancarios.

En el corte, la auditoría tiene 421 claves repetidas por `UDRKey + ItemCode`; la vista de pago no tiene repeticiones de esa combinación. Solo dos combinaciones repetidas están en el conjunto aprobado examinado. Las demás no deben borrarse: pueden representar detalles legítimos.

Corrección: definir la unidad de registro. Liquidar una sola vez el agregado de pago o distribuirlo entre sus líneas con una regla documentada, conservando los identificadores originales. No aplicar `DISTINCT` a ciegas ni dividir por el número de filas sin validar cantidades, médicos y alcance del agregado.

**3. Prioridad alta: elegibilidad de negocio presentada como autorización financiera.**

La condición de `backend/routes/honorarios.routes.js:99` no exige importe positivo, tabulador encontrado ni coincidencia de médico. La expresión `MotivoExclusion NOT LIKE 'No entra%'` también acepta motivos no vacíos que no empiecen con ese texto. La ausencia de `p` se disimula con `COALESCE(p.SinTabulador, 0)`.

Entre los 2,498 renglones aprobados se observaron:

| Incidencia | Renglones | Base involucrada |
|---|---:|---:|
| Sin tabulador, según la vista de pago | 29 | $0.00 |
| Base cero | 81 | $0.00 |
| `MatchMedico = 0` | 120 | $27,525.00 |
| Sin coincidencia con la vista de pago | 73 | $17,137.00 |
| Tasa ISR cero y base positiva | 101 | $21,160.00 |

Las categorías se solapan; sus cantidades no se deben sumar. Los 73 renglones sin coincidencia con la vista de pago se confirmaron también mediante `p.UDRKey IS NULL` en la consulta de verificación. Un ISR cero no es por sí solo ilegal: falta comprobar la personalidad y el régimen.

Corrección: separar “cumple reglas operativas”, “requiere revisión”, “validado fiscalmente”, “autorizado” y “pagado”. Las incidencias deben impedir la autorización definitiva salvo resolución documentada, sin esconder los servicios del reporte de auditoría.

**4. Prioridad alta: ajustes manuales afectan múltiples servicios y no dejan una autorización central.**

`getRowId`, en `HonorariosAuditView.jsx:74`, devuelve solo `UDRKey`. Hay 521 claves de atención/documento con varios códigos de servicio. Una prueba con dos servicios y la misma clave confirmó que excluir uno excluye ambos. Incluso añadir `ItemCode` no distingue dos líneas legítimas del mismo servicio.

Los ajustes se guardan únicamente en `localStorage` por rango de fechas, sin identidad del autorizador, persistencia central, versión del corte ni bloqueo posterior al pago. Los periodos superpuestos pueden tener ajustes diferentes para el mismo servicio. Estos datos son editables desde el navegador y no constituyen una bitácora de autorización contable.

Corrección: usar ID estable de línea fuente, guardar decisiones en backend con usuario, rol, motivo, valores anteriores/nuevos y fecha, y conservar versiones de las liquidaciones. El servidor debe validar la autorización y calcular lo liquidable.

**5. Prioridad alta: cambiar la base conserva el IVA anterior.**

En `HonorariosAuditView.jsx:125`, el ajuste suma el `IvaLinea` original al nuevo importe. Prueba reproducida con el código real: base $100, IVA $16 e ISR 10%; al cambiar la base a $200 devuelve $196. Manteniendo la misma tasa de IVA, debería devolver $212 antes de una eventual retención de IVA.

Con base manual cero, esa prueba arroja tres netos distintos: renglón $0, indicador $14.40 y resumen/PDF $16.00, porque los agregados siguen sumando el IVA original.

Corrección: recalcular todos los impuestos aplicables desde la base ajustada y el perfil fiscal vigente; conservar los importes anteriores como evidencia. Una base cero no puede conservar automáticamente un traslado de la base anterior.

**6. Prioridad alta: no existe un cálculo de IVA retenido.**

La fórmula del PDF (`honorariosPdfGenerator.js:203`) es `base + IVA - ISR`. No contempla IVA retenido ni distingue exención, tasa cero, ausencia de información y servicio gravado. La etiqueta de línea 212 fija “16%” siempre que hay IVA positivo.

El IVA observado no debe eliminarse indiscriminadamente: está concentrado en terapia/rehabilitación ($13,608), psicología ($1,116), programas de salud ($392) y nutrición ($40). El nombre del área no demuestra que el servicio reúna los requisitos de la exención médica. En `PR` existen campos distintos `UDF_ISR` y `UDF_IVA`; `TaxCode = V0` coexiste con IVA de honorarios de 16%. Sin el SQL de las vistas y los CFDI no puede determinarse el significado fiscal de `V0` para esta relación.

Corrección: determinar el impuesto por prestador, servicio, receptor y fecha; incorporar IVA retenido cuando proceda. No inferir un régimen fiscal de la etiqueta `HN` ni de una especialidad.

**7. Prioridad alta: tasas sin unidad uniforme ni soporte fiscal verificable.**

En prestadores activos de `PR`, `UDF_ISR` contiene 0.1 y 10, 0.0125 y 1.25, además de 1, 123, cero y NULL. La normalización actual interpreta `1` como 100%; el API devolvió 19 renglones con tasa 1, todos excluidos en el corte. Una aprobación manual puede llevarlos al cálculo. El valor 123 se encontró en el catálogo, no entre las tasas aprobadas del periodo.

Los 87 nombres distintos de la vista de pago coincidieron con `PR.FullName`, pero sus registros no tenían `BPCode` vinculado. Esa coincidencia por nombre es un diagnóstico, no una identidad fiscal confiable. La ruta no entrega RFC, régimen, vigencia, CFDI ni identificación del prestador.

Corrección: migrar con validación las tasas a una unidad explícita y una lista de tratamientos permitidos. NULL significa información faltante; no significa exento. Guardar el perfil fiscal con vigencia y evidencia. No convertir arbitrariamente el valor 1 a 1%, 10% o 1.25%.

**8. Prioridad media: cantidad y tabulador no siempre explican la base.**

Cuatro líneas de la vista de pago no cumplen `BaseImporte = Quantity × ImporteUnitario`: 14 × $250 registra $250; 2 × $1,600 registra $1,600; 11 × $200 registra $200; 16 × $200 registra $200. La diferencia condicional suma $9,850 si el tabulador fuera por unidad. Puede existir una regla por atención o paquete; no debe multiplicarse sin comprobar el contrato.

También hay dos líneas aprobadas sin vista de pago con cantidades 2 y 16 que usan una base de $250. La alternativa `a.IMPORTE` del backend no especifica si ese valor ya incluye cantidad.

`UT_Honorarios` repite los códigos SER0521 (importes 1 y 1,500), SER0655 (1,000 y 1,000) y SER1277 (600 y 1,000). Se requiere una clave de tarifa/vigencia y una selección inequívoca.

**9. Prioridad media: redondeo y totales de exportación inconsistentes.**

El detalle redondea ISR por línea; el PDF lo vuelve a calcular por médico. La diferencia del periodo es $1.88. Agrupar solo por nombre y tomar la primera tasa también fallará con homónimos, cambios de régimen o distintas liquidaciones; no se encontraron tasas mixtas por nombre en este corte.

En `HonorariosAuditView.jsx:534`, los totales de Excel toman `kpis` del universo mientras sus filas usan `filteredData`. Filtrando al caso de la captura, las filas tienen base $43,425 pero el pie toma $624,018. El detalle exporta IVA original aun en líneas excluidas, mientras el pie suma solo las elegibles.

Corrección: definir el documento de liquidación/CFDI como unidad de cierre, usar aritmética decimal y una política de redondeo compatible con sus importes fiscales. Repartir diferencias de presentación de forma trazable si se requieren centavos por renglón. Los totales de cada exportación deben provenir exactamente de sus filas y del mismo alcance.

**10. Prioridad media: el PDF no respeta completamente las exclusiones ni el detalle.**

En `honorariosPdfGenerator.js:48` y 342, `ElegiblePago === 1` puede volver a incluir una línea excluida manualmente mediante `_effectiveElegible = false`. La prueba confirmó su inclusión en el formato detallado: permanece como concepto/cantidad con monto cero. No se observó que recuperara automáticamente el importe excluido en ese caso.

Los botones “resumido” y “detallado” solo cambian la inclusión de conceptos de importe cero. Ambos agrupan por descripción y grupo; no proporcionan trazabilidad por atención, línea, tarifa, base fiscal o CFDI. Conceptos con distintos códigos pueden fusionarse si tienen la misma descripción.

El caso sintético de 35 conceptos genera una sola página; dibuja el neto en Y=305.7 mm y la firma hasta Y=374 mm, fuera de los 279.4 mm de la hoja. Debe paginar, medir el alto real del texto y repetir encabezados.

**11. Prioridad alta: documento interno presentado como recibo oficial y finiquito.**

El PDF no contiene un CFDI timbrado ni enlace a XML, UUID, RFC, fecha o referencia bancaria. La leyenda de `honorariosPdfGenerator.js:243` afirma ausencia de adeudo y renuncia presente/futura antes de comprobar el pago. Además declara inexistencia de relación laboral como si la firma la determinara.

Corrección: denominarlo “Propuesta de liquidación” mientras esté pendiente; vincular el CFDI y, al pagar, generar un comprobante interno con fecha, referencia, monto y saldo. Sustituir la renuncia general por una conformidad acotada a conceptos identificados. La naturaleza de la relación debe evaluarse con el contrato y los hechos.

## Reglas fiscales que debe representar el motor

Para una persona física residente que presta servicios profesionales a una persona moral, el régimen general contempla ISR retenido de 10%; si corresponde RESICO, 1.25% sobre el pago sin IVA. La tasa se acredita con el régimen vigente; no por una etiqueta interna. [LISR, artículos 106 y 113-J](https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf).

La exención médica exige las condiciones del servicio y del prestador previstas en la ley. No equivale a tasa cero ni se extiende automáticamente a todo lo agrupado como “honorarios médicos”. [LIVA, artículo 15 XIV](https://www.diputados.gob.mx/LeyesBiblio/pdf/LIVA.pdf); [Reglamento de LIVA, artículo 41](https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LIVA_250914.pdf).

Cuando una persona moral deba retener por servicios personales independientes gravados recibidos de una persona física, la retención de IVA es dos terceras partes del IVA trasladado y efectivamente pagado. Hay que verificar los supuestos y excepciones del retenedor. [LIVA, artículo 1-A](https://www.diputados.gob.mx/LeyesBiblio/pdf/LIVA.pdf); [Reglamento, artículo 3 I](https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LIVA_250914.pdf).

Ser I.A.P. no acredita por sí solo el tratamiento de una factura recibida de un tercero. Deben distinguirse la operación hospital-paciente y la operación prestador-Fundación; la exención aplicable a una no se traslada automáticamente a la otra.

Como especificación de cálculo, una vez validados los conceptos y el perfil:

```text
Base honorarios = importe contractual aprobado, después de ajustes válidos
IVA trasladado = impuesto de los conceptos gravados (cero importe en los exentos)
ISR retenido   = base sujeta a retención × tasa legal aplicable
IVA retenido   = retención aplicable a los conceptos gravados
Neto documento = base + IVA trasladado - ISR retenido - IVA retenido
Saldo a pagar  = neto documento - pagos/anticipos aplicados ± ajustes documentados
```

No se debe calcular una tarifa de asimilados o nómina con estas tasas fijas. Tampoco aplicar automáticamente retenciones de persona física a una persona moral. Esos casos requieren un tratamiento separado y documentado.

### Caso de la captura: escenarios, no determinación del régimen

| Escenario sobre base $43,425.00 | IVA | ISR 10% | IVA retenido | Neto |
|---|---:|---:|---:|---:|
| Fórmula actual del PDF | $6,948.00 | $4,342.50 | No contemplado | $46,030.50 |
| Servicio exento, si cumple requisitos | $0.00 | $4,342.50 | $0.00 | $39,082.50 |
| Servicio gravado y sujeto a retención de dos tercios | $6,948.00 | $4,342.50 | $4,632.00 | $41,398.50 |

El PDF actual es aritméticamente consistente con su fórmula incompleta. No hay evidencia suficiente para escoger uno de los dos escenarios fiscales alternativos para esa persona. Se necesita confirmar quién factura, quién recibe el servicio, régimen, cédula y naturaleza de cada concepto. Si existen servicios mixtos, deben separarse; no elegir una sola tasa por especialidad.

### CFDI, pago y relación laboral

El reporte interno no sustituye los comprobantes fiscales exigibles. El cierre debe conciliar XML/UUID, emisor y receptor, bases, impuestos, estado del CFDI y pagos. [CFF, artículos 29 y 29-A](https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf); [SAT: requisitos de factura](https://www.sat.gob.mx/minisitio/Factura/solicita_requisitos.htm).

La fecha de atención sirve para devengar/controlar el servicio; no demuestra la fecha de pago. Deben registrarse pagos parciales y el complemento correspondiente cuando proceda. [SAT: complemento de pagos](https://wwwmatnp.sat.gob.mx/consultas/92764/comprobante-de-recepcion-de-pagos).

Una leyenda civil no elimina una relación laboral si los hechos encuadran en ella, y la renuncia de derechos laborales tiene límites legales. [LFT, artículos 20, 21 y 33](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf).

Redacción propuesta para un documento todavía no pagado:

> Propuesta de liquidación de los conceptos y periodo identificados. Sujeta a conciliación del CFDI, validación fiscal y autorización de pago. Este documento no acredita la recepción del pago ni sustituye el CFDI. Las aclaraciones se limitarán a los conceptos aquí relacionados.

## Diseño de corrección y criterios de aceptación

1. **Conciliación de origen:** obtener la definición de ambas vistas con el DBA; resolver la unidad de registro, las reglas por cantidad/paquete, los tres códigos duplicados del tabulador y las discrepancias de médico. Conservar evidencias de cada decisión.
2. **Perfil fiscal:** ID del prestador, RFC, personalidad, régimen y vigencia, receptor del CFDI, condiciones de exención por servicio, tasas y obligación de retención, evidencia y responsable de validación. No rellenar datos faltantes con “HN”, tasa cero o una regla inferida del nombre.
3. **Motor único en backend:** importes decimales; unidad de cierre por liquidación/CFDI; desglose de base, IVA, ISR, IVA retenido, ajustes, pagos y saldo. Frontend y exportadores consumen el mismo resultado y versión.
4. **Aprobaciones persistentes:** separación de quien propone y quien autoriza, permisos del servidor, ID estable por línea, historial de cambios y bloqueo de versiones ya pagadas. Evitar incluir la misma atención en dos pagos por cambiar el rango de fechas.
5. **Documento trazable:** folio y versión, estado, identidad fiscal, periodo de servicio separado de fecha de pago, CFDI asociado, detalle conciliable, resumen fiscal, paginación y firma/conformidad acotada. Anexos clínicos solo cuando sean necesarios para la conciliación.

Pruebas mínimas para aceptar la corrección:

| Prueba | Resultado requerido |
|---|---|
| Base 1,000, exento, ISR 10% | ISR 100; neto 900 |
| Base 1,000, exento, RESICO 1.25% | ISR 12.50; neto 987.50 |
| Base 1,000, IVA 16%, ISR 10%, retención IVA dos tercios | IVA 160; ISR 100; IVA retenido 106.67; neto 953.33, según cierre del documento |
| Mismo caso con RESICO 1.25% | Neto 1,040.83, según cierre del documento |
| Repeticiones identificadas | Bases 450 y 500 una sola vez; cantidades conciliadas |
| Dos servicios con mismo UDRKey | Modificar uno no cambia el otro |
| Base modificada o llevada a cero | Todos los impuestos y vistas se recalculan consistentemente |
| Falta régimen o tasa ambigua | Pendiente de validación; sin autorización definitiva automática |
| Filtro de un médico | Filas, pie y resumen exportados concilian |
| Renglón excluido manualmente | No reaparece como concepto aprobado en PDF |
| Cierre y redondeo | Suma de documentos coincide con el indicador; ajustes de centavos trazables |
| 35 conceptos y descripciones largas | Todas las páginas legibles, totales y firmas visibles |
| Pago parcial/periodos superpuestos | Saldo correcto y sin pagar dos veces la misma obligación |

El registro contable debe separar gasto por honorarios, IVA según su tratamiento, cuenta por pagar, retenciones por enterar y bancos. Las retenciones no son descuentos al gasto. La definición de IVA acreditable, no acreditable o pendiente depende de la actividad y documentación de la Fundación; el módulo examinado no la determina.

## Información pendiente para cerrar la validación

- Definiciones SQL de `UDR_HON_PAGO` y `UDR_HON_PAGO_Audit` facilitadas por su administrador; la cuenta actual no permite leerlas.
- Confirmación de si el prestador factura a la Fundación o al paciente, y en qué casos la Fundación solo recauda por cuenta de terceros.
- Catálogo vigente de personalidad/régimen fiscal, RFC, cédula y naturaleza de servicios; XML representativos de honorarios generales, RESICO y servicios gravados.
- Contratos/tabuladores que definan importes unitarios, por atención o paquete y la base antes/después de impuestos.
- Flujo real de autorización, anticipos, pagos, cancelaciones y conciliación contable.

Sin estos elementos puede corregirse el software matemáticamente, pero no declararse validado el tratamiento fiscal individual ni un saldo definitivo a pagar.

Las consultas reproducibles se incluyen en `database/auditoria_honorarios_readonly.sql`; el archivo completo se ejecutó y devolvió sus diez conjuntos de resultados. El resumen numérico, evidencia agregada de KH_HE, pruebas del PDF y huellas SHA-256 del código examinado se conservan en `docs/evidencia-honorarios-2026-09-25.json`. Se verificó que los tres archivos de código examinados conservaran esas huellas al terminar. Los datos de pacientes no se incluyen en esos entregables.
