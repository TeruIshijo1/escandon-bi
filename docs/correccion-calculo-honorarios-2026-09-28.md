# Corrección de retenciones y diferencias entre documentos

## Caso revisado

Las capturas comparan conjuntos distintos. La base de BI coincide con la hoja anterior de 23 consultas, pero no con la factura completa.

| Concepto | BI anterior (23 consultas) | Hoja anterior (23 consultas) | Estimación corregida (23 consultas) | CFDI impreso / SAP |
|---|---:|---:|---:|---:|
| Base | 5,175.00 | 5,175.00 | 5,175.00 | 8,150.00 |
| IVA | 828.00 | 828.00 | 828.00 | 1,304.00 |
| ISR | 517.50 | 600.30 | 517.50 | 815.00 |
| Retención IVA descontada | No descontada | 552.00 impresa pero no descontada | 552.00 | 869.34 |
| Importe mostrado / neto | 5,485.50 | 5,402.70 | **4,933.50** | **7,769.66** |

La hoja anterior aplica el 10% de ISR a 6,003.00, que incluye IVA, y calcula el neto como 6,003.00 - 600.30. La preliquidación de BI ya aplicaba ISR a la base, pero aún omitía descontar IVA retenido. Se corrige esta omisión en todas las salidas.

La hoja firmada de Contabilidad contiene 24 consultas generales por 5,400.00 y 11 HSBC por 2,750.00. La diferencia de base frente a BI es **2,975.00: una consulta de 225.00 y once de 250.00**. No se agregaron servicios ni se aprobaron exclusiones para forzar el total. Queda pendiente identificar sus folios y soporte en el origen.

La factura SAP 7999, contabilizada el 16/09/2026, conserva su total de **7,769.66**, ISR 815.00 e IVA retenido 869.34. Se reconsultó el 28/09/2026 en modo de lectura. Su fecha contable es septiembre y las observaciones refieren servicios de agosto. Una consulta de facturas limitada a agosto no la devuelve.

## Criterio del cálculo implementado

- Fórmula: **base + IVA - ISR - IVA retenido**.
- Se usa el IVA registrado en el origen, no se añade otro 16% por el nombre de la especialidad.
- La configuración actual del candidato único de SAP permite una **estimación**, sin convertir el enlace por nombre en identidad verificada ni el estado actual en prueba histórica de régimen.
- Para el catálogo revisado se reconoce ISR de servicios profesionales 10% y RESICO 1.25% sobre honorarios sin IVA. Se exige una regla compatible, activa, cuya fecha de tasa no sea posterior al servicio y un RFC con estructura de persona física.
- Las configuraciones revisadas de IVA retenido para servicios profesionales o dos tercios de IVA permiten estimar **2/3 del IVA registrado**, sin usar 10.66% o 66.66% truncados. No se extiende esta regla a cualquier retención del catálogo.
- Estado ausente, candidato ambiguo, perfil incompatible, retenciones contradictorias o falta de base para IVA dejan el neto **pendiente**, nunca convertido en cero. Se conserva el ISR de origen como estimación informativa cuando no hay tasa compatible de SAP; eso no completa el neto.
- Proveedor explícitamente no sujeto, sin retenciones activas contradictorias: estimación sin retenciones, identificada en la nota del cálculo.
- El impuesto se redondea por médico y tasa, y los centavos se distribuyen de forma determinista al detalle. Los filtros suman esos mismos renglones; no recalculan impuestos independientes.
- Un ajuste de base escala proporcionalmente el IVA original. Si no existe base de origen para inferir ese IVA, no se inventa una exención. Excluir elimina base, IVA y ambas retenciones del cálculo; restaurar vuelve a calcularlas.
- Las facturas contabilizadas nunca se recalculan. En la base completa de 8,150.00, dos tercios de 1,304.00 redondean a 869.33, pero la tasa impresa 10.6667% produce 869.34. El importe documental prevalece para conciliar esa factura, no para sustituir el cálculo de un conjunto distinto de servicios.

## Fundamento y límites

El [artículo 3, fracción I, del Reglamento de la LIVA](https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LIVA_250914.pdf) establece la retención de dos terceras partes del IVA trasladado y efectivamente pagado en los supuestos allí indicados, incluidos servicios personales independientes de personas físicas. La [LISR, artículos 106 y 113-J](https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf), regula las retenciones de ISR correspondientes. La [LIVA, artículo 15, fracción XIV](https://www.diputados.gob.mx/LeyesBiblio/pdf/LIVA.pdf), condiciona la exención de servicios profesionales de medicina; el nombre de la especialidad no basta para decidirla.

Estas normas sustentan una estimación bajo los supuestos documentados. No certifican automáticamente el tratamiento de todos los proveedores ni sustituyen el CFDI, su XML, la identidad validada y el periodo de los servicios. El módulo genera preliquidaciones internas, no registros de impuestos efectivamente pagados.

## Alcance técnico

Se unifica el cálculo de pantalla, ficha, PDF y Excel en `frontend/src/utils/honorariosCalculation.js`. El backend identifica reglas compatibles del catálogo sin modificar datos de SAP. El detalle, resumen y descargas presentan ambos impuestos retenidos y el estado pendiente cuando corresponda.

Se conserva el contenido previo del paquete `pase_a_produccion` y se actualiza el servicio de conciliación y el frontend compilado. No se incluyen credenciales, documentos de pacientes ni archivos temporales. No se modificó Vertical, su base de datos ni documentos o pagos de SAP. El paquete debe aplicarse y reiniciarse en el servidor para que la pantalla instalada use esta versión.

## Validación realizada

- Ocho pruebas del cálculo: caso de 23 consultas, ejemplo de Contabilidad, diferencia de redondeo del CFDI, RESICO, IVA cero, reparto de centavos estable frente a filtros, ajustes/exclusiones/restauración y datos fiscales pendientes.
- Cinco pruebas de lectura SAP: paginación completa, fallo de páginas, enlaces externos, indicador de retención y clasificación acotada del catálogo. Los importes contabilizados no se recalculan.
- Consulta real de SAP: 678 proveedores, perfil compatible de la médica del ejemplo y factura 7999 conservada por 7,769.66. Aplicado a la base de 23 consultas, el perfil devuelve 4,933.50.
- Prueba aislada en Chromium del componente real con datos sintéticos: tres salidas (pantalla/PDF/Excel), ficha, exclusión y restauración, y falla de SAP. Se descargaron ambos PDF y el Excel y se comprobaron sus cifras. No se usaron credenciales ni se omitió la autenticación de la aplicación real para esta prueba.
- PDF resumido, detallado y pendiente revisados visualmente; build de producción correcto. El build conserva el aviso previo sobre tamaño de algunos paquetes JavaScript.
