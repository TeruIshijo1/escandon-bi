# Ventas hospitalarias

**Fecha de corte:** 16 de octubre de 2026.

## Consulta y descarga

Abre **Auditoría → Ventas hospitalarias**, selecciona fecha inicial y final y consulta el reporte. El periodo inicial es del 1 de abril de 2026 al día actual del hospital; puedes elegir otro intervalo de hasta 366 días, sin fechas futuras.

El reporte reúne artículo/código, descripción, cantidades e importes por mes y acumulados del periodo. **Facturadas** aparece en verde y **No facturadas** en rojo. Los importes son MXN netos sin IVA; una factura no acredita un cobro recibido y un pendiente no acredita por sí mismo la prestación de un servicio clínico.

**Banco de Sangre** está incluido en los totales generales y tiene un desglose propio. No se debe sumar otra vez ese desglose al total del hospital. La identificación procede del grupo de artículos 105 de SAP, no de una búsqueda aproximada por nombre.

El Excel conserva la presentación institucional BI y las columnas de cantidad/monto por mes y total acumulado. Sus cuatro hojas son **General**, **Banco de Sangre**, **Resumen mensual** y **Por revisar**. El resumen conserva importes de control documental, IVA y diferencia frente al detalle de artículos. Los renglones apartados para revisión no se agregan al saldo rojo. El archivo incluye la consulta completa del periodo; la búsqueda y los filtros de visualización no recortan el libro.

## Cómo interpretar los meses

- **Verde:** facturas de venta vigentes menos notas de crédito vigentes, agrupadas por la fecha contable de cada documento. Una nota de crédito puede reducir un mes distinto del de la factura original.
- **Rojo:** remanentes actualmente abiertos de órdenes o entregas vigentes cuya fecha contable cae en el periodo seleccionado. El mes corresponde al documento que conserva el remanente.
- Los pendientes se consultan con el estado disponible al generar el reporte. No reconstruyen el saldo histórico que existía al cierre de cada mes ni al día final de un periodo anterior.
- Una nota de crédito no reabre automáticamente un pendiente. El saldo rojo depende de lo que SAP conserve abierto y de los vínculos comprobados entre documentos.

Para compartir cifras, conserva las fechas, la hora de extracción y las notas de conciliación. La suma verde más rojo se presenta como combinación de facturación y pendientes documentales; no constituye una cifra de ingreso contable reconocido o de cobranza.

## Origen y fórmulas

La consulta de sólo lectura usa SAP Business One Service Layer. No registra consultas SQL ni modifica documentos. Consulta líneas de `Invoices` y `CreditNotes` para la facturación, `Orders` y `DeliveryNotes` para pendientes y `Returns` para comprobar movimientos relacionados. `Items.ItemsGroupCode` identifica Banco de Sangre. No obtiene el importe facturado desde la cuenta de Vertical.

Para cada documento de factura o nota de crédito, el descuento de cabecera se distribuye proporcionalmente entre sus líneas:

```text
Neto de línea = LineTotal - TotalDiscount × LineTotal / suma(LineTotal del documento)
Facturadas = suma(neto de facturas) - suma(neto de notas de crédito)
```

Las cantidades de las notas de crédito tienen signo negativo. Los importes de línea ya reflejan su descuento de línea y no incluyen IVA; el descuento general se aplica una sola vez. Los controles contrastan los netos de artículos con el neto de cabecera `DocTotal - VatSum`; las diferencias permanecen visibles, sin forzarlas a artículos.

Para los pendientes de documentos de artículos se utiliza la cantidad abierta actual por línea y la proporción de importe y descuento que corresponde a ese remanente. En documentos de tipo servicio se usa `OpenAmount` y se proporciona la cantidad según `OpenAmount / LineTotal`, en lugar de aplicar el control de unidades de inventario. Se contrastan `BaseType`, `BaseEntry` y `BaseLine` de facturas, entregas y devoluciones para no sumar dos veces una orden transferida ni una entrega ya facturada. Las entregas que proceden de factura de reserva quedan fuera del saldo no facturado. No se inventan relaciones entre documentos independientes por coincidir artículo, descripción o paciente.

Las cantidades o cadenas de origen sin comprobar se informan en advertencias o en **Por revisar**, según su condición. Los remanentes que se solapan con facturas o transferencias verificadas se apartan del total rojo. Las líneas cerradas con cantidades residuales tampoco se convierten automáticamente en ventas pendientes. Un código ausente del catálogo se conserva en el total general, sin atribuirlo a Banco de Sangre.

La lectura recorre la paginación completa y rechaza páginas repetidas, respuestas incompletas y líneas sin identificación. El límite es de 2.000 páginas o 300.000 líneas por colección; si se supera, se debe reducir el periodo. Una consulta fallida no se presenta como un reporte completo con ventas en cero.

## Acceso e instalación

La pantalla y la API requieren el permiso explícito `auditoria-ventas-hospitalarias`, asignable desde Gestión de Usuarios, salvo la excepción nominal `amendoza` de la plataforma. El catálogo de navegación declara ADMIN/DIRECTOR como perfiles de referencia; el rol por sí solo no sustituye el permiso. Una asignación expresa puede habilitar la consulta para otra cuenta. La autorización del servicio se comprueba además de mostrar la entrada del menú.

La ruta de pantalla es `/auditoria/ventas-hospitalarias` y la lectura es `GET /api/audit/sales`. El código está en `frontend/src/pages/HospitalSales.jsx`, `frontend/src/utils/hospitalSalesWorkbook.js`, `backend/routes/hospitalSales.routes.js` y `backend/services/hospitalSales.service.js`. El libro se genera con el exportador institucional del frontend.

El pase debe generarse desde las fuentes vigentes mediante `build_deploy.ps1` y validarse con `verificar_pase.ps1` y `production-package.cjs verify pase_a_produccion --source`. La instalación requiere copiar el paquete completo, conservar la configuración del servidor y reiniciar. Las pruebas locales y la integridad del paquete no prueban la instalación remota ni la disponibilidad de las colecciones y permisos de SAP del servidor.
