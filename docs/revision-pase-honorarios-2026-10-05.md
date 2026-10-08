> Actualización del 5 de octubre: el flujo vigente está en [Optimización de honorarios](revision-optimizacion-honorarios-2026-10-05.md) y en [el manual](instructivo_honorarios.html). Servicios, Pagos y PDF, Configuración; ficha fiscal interna y comprobante total por médico.

# Revisión final de honorarios y pase — 5 de octubre de 2026

## Resultado

Se corrigió una omisión de procedimientos quirúrgicos, los filtros de la exportación Excel y la lectura de pagos al descargar el Excel de un cierre. El paquete se prepara en la carpeta existente pase_a_produccion, mediante build_deploy.ps1, y se contrasta con las fuentes actuales y su manifiesto SHA256.

## Cobertura contrastada con KH_HE

La revisión usó exclusivamente SELECT en Vertical. En septiembre se localizaron 3,976 candidatos antes del cambio y 4,088 después: 3,290 líneas de órdenes, 676 cargos clínicos, 10 citas sin línea y 112 prestaciones quirúrgicas por rol. Los roles SURGEON, AN y AY conservan identificadores separados.

La fuente anterior contenía 55 registros CXQ que no aparecían entre los candidatos. Ahora 53 están representados en el corte de septiembre; los otros dos tienen fecha de procedimiento en octubre y se comprobó su presencia en el corte del 1 al 5 de octubre. No quedaron registros de esa comparación sin explicación. La fecha de prestación sigue determinando el periodo y la vigencia de la tarifa.

Estos registros tenían base de referencia cero: su presencia no determina un importe adicional a pagar. Los procedimientos se incorporan al catálogo desde CP y permanecen pendientes hasta confirmar servicio, médico, tarifa vigente, realización e impuestos. Las referencias a cargos del mismo procedimiento y rol señalan posibles duplicados. La ausencia de participante o una atribución ambigua no asigna el cargo al médico principal.

El aviso de prestaciones pendientes de configuración queda abierto y visible al existir omisiones del reporte de revisión. Los conteos incluyen candidatos que necesitan catálogo, tarifa o médico, conservando la diferencia entre cobertura de fuentes y servicios autorizados para pago.

## Excel

- La revisión exporta la pestaña activa (Por revisar, Aprobados, Excluidos o Todos), médico, grupo y búsqueda. El detalle, resumen por médico, cantidades, tasas y totales corresponden a los mismos resultados. La hoja de SAP conserva el contexto fiscal de los médicos de esa selección.
- La exportación incluye todas las páginas del filtro y espera a que termine la búsqueda. Un filtro sin resultados no descarga registros de otra pestaña.
- Cada hoja conserva los filtros utilizados. El autofiltro nativo cubre encabezados y datos y deja fuera la fila de totales.
- El Excel de un cierre vuelve a leer pagos y ajustes del servidor antes de descargarse. Un pago registrado desde otra sesión actualiza el saldo exportado y el de la pantalla.

## PDF

Se verificaron PDF de revisión y de pago, documentos pagados, cantidades fraccionarias, médicos homónimos y varias páginas. El PDF de revisión conserva el contexto de los estados; el documento para pago se genera en Cierres y pagos desde el saldo validado del servidor.

Se renderizaron muestras actuales de 3, 7 y 12 páginas. Se inspeccionaron portada, detalle, última página y firmas al final. Ningún texto quedó fuera de los límites de página. Las pruebas bloquean 30 inconsistencias antes de descargar un PDF para pago.

## Pruebas

- Backend completo: 28 suites y 383 pruebas aprobadas.
- Frontend: 34 pruebas aprobadas, incluyendo paridad decimal con 1,039,896 combinaciones.
- API y PostgreSQL en esquema temporal aislado: catálogo, aprobaciones, pagos, ajustes, lectura consistente y nuevo flujo quirúrgico desde tarifa hasta cierre y PDF para pago.
- Navegador real: todos los estados del Excel, combinaciones de médico/grupo/búsqueda, todos los resultados paginados, datos fiscales ausentes, folios y Excel del cierre con pago registrado en otra sesión.
- PDF: cuatro flujos de revisión y documentos de pago, saldo cero y multipágina.
- Empaquetado e instalador: seis pruebas aprobadas, incluyendo recursos ausentes o alterados y conservación de configuración e historial.

La evidencia de esta revisión está en D:\Escritorio\HE-Backup\honorarios-*.{json,log}, los logs de integración de esa carpeta y sus vistas en honorarios-qa. Los PDF y Excel sintéticos permanecen en tmp del proyecto. Esos archivos de prueba no se distribuyen en el pase.

## Aplicación del pase

Ejecutar verificar_pase.ps1 dentro del paquete antes de copiar. Copiar el contenido de pase_a_produccion al servidor y seguir README_PRODUCCION.md para instalar y reiniciar. La preparación local no publica en SERVIDORCALIDAD.

Antes de pagar honorarios quirúrgicos, el área responsable debe confirmar las tarifas por médico y rol y conciliar los posibles duplicados con cargos existentes. Los pagos reales y la configuración fiscal de producción no se modificaron durante las pruebas.


## Actualización de usabilidad: aprobados y PDF

La navegación incluye Aprobados y PDF y cada médico tiene descarga directa del documento de sus aprobaciones. El generador filtra los aprobados en todas las páginas y conserva pendientes fiscales sin inventar netos. El resumen identifica la aprobación separadamente del cálculo fiscal. El cierre recibe los datos del médico y del periodo y se prepara con un botón; cambios de fechas son opcionales. El servidor mantiene las validaciones fiscales y de concurrencia.

En esta actualización se verificaron el flujo completo del navegador con fuentes y APIs ficticias, selección de dos de 50 y posterior aprobación de 48, PDF sin perfil fiscal, cierre sin recaptura, preservación de pagos, PDF actualizado y bloqueo por cambios clínicos. Se aprobaron 31 pruebas de cálculos, elegibilidad y dinero y las pruebas de PDF individual, combinado y multipágina. Se comprobó el manual de 13 páginas y 14 capturas, con descarga nativa sin JavaScript y sin desbordamiento móvil. Los datos operativos del usuario permanecen intactos.

El paquete se prepara con build_deploy.ps1 y se contrasta con las fuentes actuales y el manifiesto SHA256. El pase anterior se conserva bajo tmp; no se publica automáticamente en el servidor.
