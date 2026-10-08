---
actualizado: 2026-10-01
---

# Control de honorarios médicos implementado en BI

30 de septiembre de 2026. Implementación local validada; pendiente de publicación en el servidor de la plataforma.

La depuración del alcance ya se aplicó al catálogo PostgreSQL de BI. La pantalla también calcula el alcance cuando un backend anterior no entrega la clasificación. El 1 de octubre de 2026, tras autorización explícita del usuario, el backend local se inició con Node 24.21.0 portable y quedó respondiendo en el puerto 4000 con la versión actual de las guardas y filtros. Las sincronizaciones iniciales finalizaron sin errores nuevos; véase [[Backend]] para la mitigación del cierre nativo y su validación. El cambio sigue pendiente de publicación en el servidor de producción.

## Uso del módulo

El módulo Honorarios Médicos ofrece tres áreas:

1. **Catálogo y precios.** Buscar el servicio profesional, decidir si se incluye y registrar el motivo. Definir el honorario por unidad, su vigencia y, cuando corresponda, una excepción por médico o rol. Los importes de Vertical aparecen como referencia y no autorizan una tarifa BI. Los conceptos profesionales nuevos se incorporan por configurar. **Revisar otros conceptos** permite clasificar servicios ambiguos antes de incluirlos; los cargos hospitalarios y áreas excluidas no se ofrecen para configurar honorarios.
2. **Revisar servicios.** Consultar el periodo, filtrar por médico, servicio u orden y aprobar, excluir o dejar pendiente cada prestación. La aprobación requiere confirmar médico, rol, cantidad y realización. Se pueden seleccionar hasta 100 servicios, calcular sus tarifas y revisar sus médicos, cantidades e importes antes de guardar una decisión conjunta. Cada resultado informa qué se guardó y qué requiere otra revisión.
3. **Cierres y pagos.** Cerrar las aprobaciones abiertas de un periodo, para todos los médicos o uno seleccionado, después de confirmar servicios, pagos previos y cálculo fiscal. El cierre conserva los importes. Registrar los pagos ya realizados por servicio, con referencia y motivo; consultar pagado, ajustes y saldo. Un ajuste conserva el cierre original y el historial.

Una tarifa general y sus excepciones pueden coexistir. La prioridad es médico y rol, médico, rol y general. Dos tarifas con igual alcance no pueden cubrir las mismas fechas. Se admiten fechas contiguas y los límites son inclusivos: cerrar la anterior el día previo al inicio de la nueva.

Los cambios de tarifa devuelven las aprobaciones abiertas afectadas a revisión. Los cierres anteriores conservan sus precios e impuestos. El botón **Verificar cambios de origen** identifica cancelaciones, cambios o servicios que ya no aparecen en el corte original, para revisar un ajuste.

## Fuentes y controles

- Las líneas de SO/SOLN aportan órdenes y servicios. Las citas relacionadas aportan fecha, médico y evidencia del episodio; una marca de cabecera con varios conceptos requiere confirmación de la línea.
- PCBL aporta cargos clínicos con o sin vínculo a una orden. Para anestesia se usa el participante AN de PCFRPR cuando es único; una atribución insuficiente queda pendiente. Los cargos y procedimientos no acreditan por sí solos la realización de cada servicio.
- PCAP aporta citas con concepto propio que no está representado por una línea de venta. Las citas sin concepto identificable no se convierten en servicios inventados.
- Las vistas UDR_HON_PAGO y UDR_HON_PAGO_Audit se agregan por clave y concepto para comparar presencia y bases de referencia. No multiplican candidatos ni determinan el precio BI. Su presencia tampoco acredita un pago al médico.
- Farmacia, Laboratorio, Imagenología y Almacén General quedan fuera del reporte de pago. También se excluyen conceptos de imagen clasificados en otros grupos, mediante códigos y términos de estudio identificados.
- La clasificación S de Vertical no acredita un servicio profesional. Se excluyen alias A-CEYE/A-FAR/A-ITEM/A-QUI, paquetes hospitalarios PQX, materiales, medicamentos, estancias, renta y uso de equipos, administración, coaseguros y otros cargos de hospital. Ni una referencia UT_Honorarios ni una configuración antigua incluida permiten convertirlos en honorarios.
- Consultas, interconsultas, jornadas médicas, anestesiología, visitas, valoraciones y otros actos profesionales se conservan como candidatos, aunque no tengan tabulador UT. No se descarta completo un grupo mixto: ANALISIS DE CUENTAS contiene jornadas médicas HSBC; AMBULANCIAS contiene responsivas médicas; TERAPIA NEONATAL contiene interconsultas y jornadas.
- Un concepto ambiguo se conserva para revisión de clasificación en el catálogo. Aparece en el reporte del periodo cuando el responsable confirma su inclusión. Los candidatos reconocidos también necesitan tarifa y aprobación de la prestación; la clasificación no acredita realización ni adeudo.
- Una línea usada por varias citas conserva una cantidad máxima compartida. BI comprueba las unidades reconocidas en otras revisiones, incluso fuera del periodo, antes de aprobar. Las cantidades desconocidas aparecen pendientes y no se sustituyen por una unidad en el Excel.
- Las coincidencias entre orden, cita y cargo se señalan para revisión; no se fusionan por semejanza de nombre. Cancelaciones y devoluciones conservan su efecto sobre elegibilidad y cantidad.
- El servidor vuelve a consultar el servicio y verifica la tarifa calculada antes de guardar. Las versiones y bloqueos evitan que dos revisores sobrescriban una decisión o que un cambio simultáneo de tarifa pase inadvertido.
- Atención, cita y orden se conservan en campos separados. El Excel incluye línea/cargo, código del médico, rol, cantidad, precio BI, tarifa, estado, motivo y cierre. Una referencia inexistente queda vacía.

Las fechas civiles de Vertical se conservan para el corte y las tarifas; convertir un cargo nocturno a UTC no desplaza su fecha al día siguiente.

## Contact Center

SER1467, SER1470 y SER1471 se incorporan inicialmente con modalidad Contact Center. Su habilitación y tarifa requieren decisión del responsable. Una llegada física no es requisito: se conserva la marca de realización de la orden o cita cuando existe y se permite confirmar la sesión en BI con referencia de soporte. Las cancelaciones bloquean la aprobación.

Cuando falta evidencia suficiente en Vertical, la referencia de realización es obligatoria. En una revisión conjunta puede registrarse una referencia que respalde el conjunto, después de confirmar los servicios y médicos mostrados. La lectura de una plataforma o importación externa de Contact Center requiere identificar primero una fuente disponible; el flujo manual de BI ya está disponible.

## Persistencia y actualización

Vertical se consulta mediante SELECT. Las tablas bi_honorarios_catalog, bi_honorarios_tariffs, sus historiales, las revisiones, los cierres, pagos y ajustes se guardan en PostgreSQL de BI. Su creación es idempotente al utilizar los servicios. Los precios de referencia y las descripciones se sincronizan sin sobrescribir la configuración y tarifas autorizadas.

La sincronización del catálogo corre al iniciar el servidor y cada 30 minutos por defecto. HONORARIOS_CATALOG_SYNC_MINUTES configura el intervalo; HONORARIOS_DISCOVERY_MONTHS configura el corte de movimientos adicionales, con un máximo de 36 meses. Una consulta fallida conserva la ficha anterior y reporta el error.

La ruta principal /api/honorarios/audit usa el universo nuevo. /api/honorarios/audit-vertical conserva el reporte anterior para diagnóstico. Las decisiones previas y los documentos SAP mantienen su almacenamiento existente; las nuevas prestaciones usan identidades de línea, cargo o cita.

Los pagos registrados son aplicaciones de comprobantes ya verificados. BI no ejecuta transferencias ni modifica SAP. El neto del cierre es una estimación fiscal con la configuración SAP consultada y confirmada por el responsable. Si falta información fiscal suficiente o el IVA no fue confirmado, el cierre se bloquea con el motivo.

## Validación realizada

- Catálogo real revisado: 2,422 registros S, con 1,219 fuera del alcance. Se identificaron 1,044 candidatos profesionales y 159 conceptos que requieren clasificación. Estos últimos no se mezclan con los honorarios por configurar en la vista predeterminada. Se conservaron los precios de referencia y se dejaron sin tarifas autorizadas los conceptos pendientes.
- La extracción real de septiembre recuperó líneas de venta, cargos clínicos y 10 citas sin línea de orden. Se comprobó unicidad de identidades y ausencia de importes BI autorizados antes de configurar tarifas.
- 39 pruebas de backend y 19 del cálculo compartido de pantalla y exportación aprobaron los controles de precios, vigencias, identidad, cantidades, fuentes, fechas, duplicados, alcance profesional y retenciones.
- Una integración de API con PostgreSQL aislado comprobó configuración, precios nominales, sesiones en línea, revisión conjunta, cambio de tarifa del médico asignado, cantidad compartida, cierres, aplicaciones de pago, exceso de saldo, comprobante repetido y ajustes. También confirmó que alias, paquetes y administración quedan ocultos y no admiten inclusión ni tarifas, incluso con una configuración antigua incorrecta. Las tablas de prueba se retiraron.
- La prueba de navegador usó datos sintéticos y comprobó catálogo, tarifas, asignación de médico, referencia de sesión, decisiones individuales y conjuntas, cierre y pago. También descargó y examinó los archivos Excel. Las tres vistas, ficha, búsqueda y PDF conservaron los folios separados.

La versión debe publicarse en el servidor que sirve la plataforma y validarse con el responsable sobre un médico y periodo conocidos antes de usar sus resultados para liquidar. La configuración de importes e inclusiones reales corresponde al hospital: no se convirtieron referencias ni candidatos en adeudos confirmados.

## Simplificación de la revisión de honorarios (2026-09-30)

- La revisión abre en **Por revisar** y usa **Buscar servicios** para consultar el periodo. Las tres áreas del módulo conservan su acceso.
- **Exportar** agrupa PDF resumido, PDF detallado y Excel; conserva el alcance, los importes y las condiciones de disponibilidad existentes.
- El total aprobado del periodo aparece en una sola tarjeta; **Ver desglose de impuestos** abre los componentes fiscales. Sin aprobaciones se informa que todavía no hay servicios aprobados.
- Búsqueda y médico permanecen visibles. **Más opciones** contiene grupo, vista de resultados, abrir/cerrar secciones y selección de hasta 100 servicios configurados de la lista actual. Los filtros activos se pueden limpiar sin abrir el panel.
- Las acciones conjuntas aparecen al seleccionar servicios; permiten aprobar, excluir o cancelar la selección. El término **Excluir** es consistente en los estados y en la decisión local. Las reglas, permisos, confirmaciones y valores fiscales no cambian.
- Los controles se adaptan a móvil y los recorridos de navegador utilizan exclusivamente datos sintéticos para verificar revisión, selección, descargas y cierres.


## Recomendados en el catálogo (2026-10-01)

El catálogo abre en **Recomendados**, con los servicios del catálogo BI que tienen
al menos una referencia sincronizada desde **UT_Honorarios** de Vertical.
**Todos los servicios** permite consultar el resto del catálogo. Ambos apartados
conservan búsqueda, estado y revisión de otros conceptos; los contadores de estado
corresponden al apartado activo. Cambiar de apartado reinicia la página y limpia
la selección para no editar una ficha fuera de la lista mostrada.

La presencia de la referencia es el criterio del apartado, incluso si su importe
es nominal, cero, nulo o tiene duplicados. Sus advertencias permanecen disponibles
en la ficha. Las exclusiones obligatorias del catálogo siguen aplicando.
Las inclusiones, tarifas BI y aprobaciones siguen requiriendo la decisión del
responsable. El apartado filtra el catálogo existente y no amplía su universo.

Validación: compilación Vite correcta y recorrido de navegador con datos sintéticos
completado. Se comprobaron referencias nominales, cero, nulas y duplicadas; servicios
sin referencia en Todos; exclusiones obligatorias; composición con búsqueda y estado;
limpieza del detalle al cambiar apartado; y presentación a 390 px sin desbordamiento.
El recorrido completo conservó tarifas, decisiones, Excel, cierres y pagos existentes.
