# SAP Service Layer como complemento de honorarios médicos

Revisión del 25/09/2026. Complementa la auditoría de KH_HE y Plataforma BI. Se utilizó la conexión SAP configurada en el backend, exclusivamente mediante Service Layer.

**SAP aporta proveedores con RFC, retenciones contabilizadas, facturas, asientos y pagos relacionados. Permite mejorar sustancialmente BI, pero los campos actuales no permiten validar automáticamente el régimen fiscal, el CFDI ni la correspondencia de cada atención.**

No se modificaron SAP, Vertical, KH_HE ni el código operativo de BI. Se realizaron 30 peticiones GET de negocio/metadatos y ocho peticiones de apertura/cierre de sesión. No se crearon consultas SQL en SAP. Además, se consultó en modo lectura un agregado de agosto en KH_HE para contrastar el caso de la auditoría anterior. Los archivos nuevos son documentación y evidencia local.

## Qué se consultó y qué se encontró

La ventana de documentos fue del 01/09/2026 al 25/09/2026 por **fecha de contabilización**. No se asumió que todos esos documentos correspondieran a servicios de septiembre. Se siguió la paginación completa de las colecciones consultadas, con límite de seguridad que produce error si se alcanza; no se aceptaron resultados parciales como completos.

| Fuente | Resultado comprobado | Uso propuesto en BI |
|---|---|---|
| `BusinessPartners` | 678 proveedores con RFC capturado | Identidad del proveedor y clave `CardCode`; el RFC requiere validación, no solo presencia |
| `BusinessPartnerGroups` | Grupos GENERAL, HMEDRES, HONMED, RESICO, HONRESICO, HONORARIOS y otros | Clasificación inicial y candidatos a vinculación |
| `BPWithholdingTaxCollection` + `WithholdingTaxCodes` | Códigos asignados a proveedores, tasas, bases y cuentas | Contrastar configuración y detectar diferencias; no acreditar por sí solos el régimen |
| `PurchaseInvoices` | 570 cabeceras en el periodo; 104 documentos relevantes examinados en detalle | Facturado, conceptos contables, impuestos registrados y saldo de referencia |
| `VendorPayments` | 478 pagos en la ventana; nueve enlaces con facturas de candidatos del reporte | Identificar aplicaciones de pago por documento |
| `JournalEntries` + `ChartOfAccounts` | Asientos de dos documentos representativos y cuentas de retención/gasto | Comprobar cómo se contabilizan los importes |
| `SalesTaxCodes` | C0, C16, CE, V0 y VE | Distinguir tasa cero y exento en la nomenclatura de SAP |
| `PurchaseCreditNotes` | Tres notas en la ventana; ninguna para los proveedores seleccionados | Incluir ajustes y cancelaciones en futuras conciliaciones |

Los 104 documentos se seleccionaron por los grupos 103, 104, 106 y 108, más los proveedores candidatos vinculados al reporte de KH_HE. Todos son documentos de servicio. De ellos, 70 pertenecen a 60 de los candidatos identificados y 103 contienen retenciones. No son 104 CFDI verificados: son documentos contables de SAP.

## Vinculación con médicos de KH_HE

Los nombres no están ordenados igual: KH_HE suele presentar nombres antes de apellidos y SAP registra apellidos antes de nombres. Comparando los componentes del nombre, sin acentos ni títulos, se obtuvieron **77 candidatos únicos de los 89 médicos aprobados** del corte anterior; no hubo candidatos múltiples con ese método y quedaron 12 sin coincidencia.

**Son candidatos, no identidades confirmadas.** Una coincidencia de nombre no demuestra que sea el mismo contribuyente. Los 12 casos restantes tampoco prueban que no existan en SAP: pueden tener diferencias ortográficas, razones sociales, otra cuenta o un registro faltante.

La solución debe guardar, en la base propia de BI, un vínculo validado entre ID del prestador de Vertical, compañía SAP, `CardCode` y RFC. La normalización por nombre solo propone ese vínculo. Posteriormente deben usarse identificadores, no volver a decidir por similitud cada vez que se genera un pago.

## Datos fiscales disponibles y sus límites

**El régimen fiscal todavía falta.** `U_B1SYS_FiscRegime` existe y su descripción es “Fiscal Regime”, pero está vacío en los 678 proveedores consultados. Los grupos HMEDRES, HONMED o RESICO ayudan a localizar registros; no reemplazan una constancia ni establecen la fecha de vigencia de un régimen.

En los 77 candidatos, los RFC capturados tienen 13 caracteres, pero `CompanyPrivate` devuelve `cCompany` en todos. No se debe usar esa propiedad sola para decidir persona física/moral ni eliminar retenciones. SAP documenta ese campo como clasificación empresa/persona particular; su contenido aquí requiere conciliación con documentación fiscal. [Referencia oficial de CompanyPrivate](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/SAPbobsCOM~BusinessPartners~CompanyPrivate.html).

Hay cinco diferencias entre la tasa ISR del reporte de KH_HE y el código ISR asignado al candidato en SAP:

| Proveedor candidato SAP | Tasa en reporte KH_HE | Tasa de código asignado SAP |
|---|---:|---:|
| P00329 | 0% | 1.25% |
| P00299 | 10% | 1.25% |
| P00511 | 0% | 1.25% |
| P00316 | 0% | 1.25% |
| P00664 | 0% | 1.25% |

Es necesario confirmar identidad, régimen y vigencia antes de sustituir una tasa. El dato de SAP representa configuración actual; no acredita que esa misma configuración aplicara a todas las fechas del servicio o pago.

### Catálogo de retenciones

| Código | Nombre en SAP | Tasa registrada | Base configurada | Tipo técnico |
|---|---|---:|---|---|
| 1I | Retención de ISR | 10% | Neto | ISR |
| RES | Retencion de ISR RESICO | 1.25% | Neto | IVA |
| SER | Retención de ISR Servicios Profesionales | 10% | Neto | IVA |
| SERI | Retención de IVA Servicios Profesionales | 10.66% | Neto | IVA |
| 1V | Retención de IVA, 2/3 | 66.66% | IVA | IVA |

`RES` y `SER` tienen una incongruencia entre nombre/cuenta y `WithholdingType`. Ambos apuntan a la cuenta 216-04-001, denominada “Impuestos ret de ISR x servicios prof”, pero se tipifican como IVA. SAP documenta que `WithholdingType` distingue precisamente retención de IVA e impuesto sobre la renta para México. [Referencia oficial](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/SAPbobsCOM~WithholdingTaxCodes~WithholdingType.html).

Por ello, BI no debe clasificar impuestos únicamente con el tipo técnico ni corregir el catálogo remoto. Puede conservar el código y valor originales, mostrar la inconsistencia y utilizar una equivalencia local aprobada por Contabilidad, con responsable y vigencia.

Las tasas 10.66% y 66.66% están truncadas respecto de dos tercios del IVA a 16%. No deben convertirse automáticamente en la regla matemática exacta de un nuevo cálculo. Deben diferenciarse el importe ya contabilizado, el importe del XML y el importe teórico que corresponda. La regla de dos tercios, cuando aplica, está en el [artículo 3 del Reglamento de LIVA](https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LIVA_250914.pdf).

## Caso de la captura: proveedor candidato P00460

El candidato corresponde a “SILVA CURIEL NORMA DANIELA”. Tiene asignados `SER` y `SERI`. Se encontró el documento SAP **8041**, referencia de proveedor **F-517**, contabilizado el **18/09/2026**. Sus observaciones identifican servicios de rehabilitación de **agosto de 2026**.

| Concepto registrado | Importe |
|---|---:|
| Línea de gasto por rehabilitación | $64,206.00 |
| IVA separado en SAP (`VatSum`) | $0.00 |
| Retención `SER` | $5,535.00 |
| Retención `SERI` | $5,904.02 |
| Total de factura / cuenta por pagar | $52,766.98 |
| `PaidToDate` al consultar | $0.00 |

El asiento confirma cargo a gasto por $64,206.00 y abonos de $5,535.00, $5,904.02 y $52,766.98 a las cuentas correspondientes. El documento cuadra aritméticamente.

Como inferencia para conciliar: $5,535 / 10% = $55,350, y $55,350 × 1.16 = $64,206. Es compatible con incorporar IVA al gasto en vez de desglosarlo como `VatSum`; **no demuestra el tratamiento fiscal del XML ni su corrección**. La línea utiliza `CE`, cuyo catálogo significa “IVA Acreditable Exento”, y el detalle de retención `SERI` tiene base declarada cero con importe positivo. Se necesita el CFDI para separar base e IVA con certeza.

La consulta de agosto en `UDR_HON_PAGO` para el nombre de ese prestador devuelve 233 unidades, base $52,425 e IVA $8,388. No coincide con la base inferida de $55,350 de la factura. No se puede atribuir la diferencia a servicios faltantes o error sin revisar ajustes, alcance del corte y soporte. Este ejemplo es de agosto; **no debe descontarse automáticamente del reporte de servicios de septiembre**.

El hallazgo sí confirma que el proceso contable observado contempla una retención adicional que la fórmula actual del PDF de BI no representa.

## Facturado y pagado pueden separarse

Para nueve facturas de los proveedores candidatos se localizaron pagos no cancelados dentro de la ventana mediante `PaymentInvoices.DocEntry`, verificando `InvoiceType = it_PurchaseInvoice` y coincidencia de proveedor.

Ejemplo: factura **7748**, base contable $10,000, retención RES $125 y neto $9,875. El pago **6458**, del 04/09/2026, aplica $9,875 a esa factura. El proveedor coincide y la transferencia registrada tiene ese importe. Es evidencia de un pago **registrado en SAP**, no una conciliación bancaria independiente.

La clave de aplicación está documentada como referencia a la factura. Debe combinarse con compañía, tipo de objeto e identificador de documento; un número visible `DocNum` aislado no identifica todos los objetos contables de forma universal. [Referencia SAP de Payments_Invoices.DocEntry](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/SAPbobsCOM~Payments_Invoices~DocEntry.html).

La consulta de pagos se limitó a septiembre. No encontrar un enlace en esa ventana no demuestra ausencia de pagos anteriores, reconciliaciones, anticipos o notas. El futuro saldo debe contemplarlos; `PaidToDate` puede usarse como control, pero no reemplaza la explicación de las aplicaciones.

## Qué aún no responde SAP con los datos examinados

- En los 104 documentos revisados no apareció UUID en los campos/textos seleccionados ni una referencia `AttachmentEntry` utilizable. Esto no demuestra que el CFDI no exista en otro repositorio o aplicación. Todavía se requieren XML representativos o conocer su repositorio.
- `U_PRNum`, `U_PR_Id`, `U_PCNum` y `U_SONum` existen como posibles referencias, pero en la muestra no aportaron un vínculo utilizable con médico/atención/orden de Vertical. No hay correspondencia automática atención-factura comprobada.
- Los campos personalizados de autorizador y fecha de autorización seleccionados están vacíos en la muestra. No se concluye que SAP carezca de aprobaciones: no se revisó todo su circuito de autorización.
- Los 104 documentos tienen líneas con código CE y `VatSum = 0`; esto no permite inferir que todos los servicios originales fueron exentos.
- En 23 renglones de retención, `TaxableAmount × Rate / 100` no reproduce `WTAmount`; 12 documentos tienen alguna retención positiva con base declarada cero. Los importes registrados sí cierran el total de los 104 documentos. Debe distinguirse consistencia contable de trazabilidad fiscal; los campos no bastan para reconstruir todas las bases originales.
- Las facturas de servicio contienen `Quantity = 0` en los ejemplos, y `Price` puede diferir de `LineTotal`. No se deben usar para reemplazar el tabulador ni para recalcular servicios como cantidad por precio. El tabulador contractual sigue pendiente.

## Cambios que pueden implementarse únicamente en Plataforma BI

1. **Lector SAP de solo consulta.** Credenciales solo en backend; lista permitida de recursos GET, paginación comprobada y rechazo explícito de resultados incompletos. Guardar fecha de lectura y compañía de origen.
2. **Catálogo de vínculos propio de BI.** Proponer los 77 candidatos, resolver los 12 restantes y validar RFC/identidad. Conservar quién aprobó cada vínculo y desde cuándo aplica.
3. **Perfil fiscal propio y versionado.** Precargar códigos y RFC de SAP; completar régimen, personalidad, condiciones de IVA y vigencia con Contabilidad. Mantener por separado dato de origen y clasificación validada.
4. **Conciliación de cuatro importes.** Mostrar honorario calculado desde KH_HE, importe fiscal del CFDI, importe contabilizado en SAP y pago aplicado. Exponer las diferencias y su motivo; no sustituir silenciosamente una fuente por otra.
5. **Periodos separados.** Fecha de atención, periodo de prestación, fecha del CFDI, contabilización y pago. Un documento de septiembre puede cubrir agosto o varios periodos.
6. **Estados verificables.** Calculado, pendiente fiscal, autorizado en BI, facturado en SAP y pago registrado en SAP. El último estado requiere aplicaciones comprobadas y control de cancelaciones; no lo determina una firma en PDF ni una marca local.
7. **PDF con trazabilidad.** Folio/versión de BI, proveedor y RFC validados, referencias SAP/CFDI disponibles, base, IVA, ISR, IVA retenido, saldo y estado. No presentar una propuesta como comprobante de pago.

No se requieren nuevas tablas, campos ni cambios de vistas en KH_HE. Tampoco cambios en los proveedores o documentos de SAP. Los vínculos, validaciones y equivalencias se conservarían en la base independiente de BI.

## Precauciones concretas del código actual de BI

`backend/services/sapQueryBuilder.service.js` no es un lector puro: al inicializar registra consultas y `ensureSapQuery` puede crear/eliminar objetos `SQLQueries` en SAP. No se utilizó ese servicio durante esta revisión y no debe reutilizarse para una integración prometida como solo lectura.

`backend/services/sap.service.js:fetchAllPages` captura errores y puede devolver/cachear el acumulado parcial; además reconoce solo `odata.nextLink`. Para conciliación financiera debe fallar de forma explícita si una página no se obtiene y manejar los enlaces de la versión utilizada. Una respuesta incompleta no puede interpretarse como cero facturas o cero pagos.

## Qué pedir ahora a Contabilidad

La información ya solicitada sigue siendo necesaria, pero SAP permite reducir la captura manual:

- Confirmar los vínculos prestador-RFC-CardCode y resolver las cinco diferencias de tasa, con régimen y vigencia.
- Facilitar XML representativos, especialmente F-517 / documento SAP 8041, y explicar el registro de IVA dentro del gasto y las bases de retención.
- Validar el significado y tratamiento local de SER, RES y SERI; documentar diferencias de centavos entre importes contabilizados y CFDI.
- Confirmar las reglas del tabulador y el alcance de cada liquidación mensual, así como quién autoriza y cómo se gestionan ajustes/pagos.
- Confirmar qué operaciones son facturas a la Fundación y cuáles, si existen, se cobran por cuenta de terceros. Las facturas de proveedor examinadas aportan evidencia del primer flujo, no excluyen otros.

La evidencia agregada, referencias de documentos y registro de consultas están en `docs/evidencia-sap-honorarios-2026-09-25.json`. No se incluyeron RFC completos, datos de pacientes, cuentas bancarias, credenciales ni sesiones en ese entregable.
