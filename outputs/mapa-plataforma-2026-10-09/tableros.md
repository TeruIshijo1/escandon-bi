## Inicio, tableros, estadísticas y agenda de consulta externa

Este apartado se verificó contra el código vigente del 9 de octubre de 2026. Describe lo que la aplicación consulta y calcula; no certifica que las conexiones externas estén disponibles ni que los datos de producción estén actualizados. Las referencias `archivo:línea` corresponden al árbol de código de `D:\Escritorio\escandon-bi`.

### Cómo interpretar las fuentes de estos tableros

| Fuente indicada | Qué significa para el usuario | Objetos usados y evidencia |
|---|---|---|
| Vertical directo | Consulta al sistema hospitalario por SQL Server durante la petición. | Cuentas `PC`, pacientes `PT`, médicos `PR`, estancias y asignaciones `PCFR`, cargos `PCIT` y vistas institucionales `UDR_*`/`V_UDR_*`. |
| Vertical guardado en BI / DW | Copia local en PostgreSQL para consultar históricos sin releer toda la fuente. No es una conexión directa para cada tarjeta. | `dw_vertical_pc`, `dw_vertical_pt`, `dw_vertical_pcit`, `dw_vertical_indicadores_operativos`, `dw_vertical_cuentas_servicios`, `dw_vertical_productividad_medicos`, `dw_vertical_consulta_dia`, `dw_vertical_solicitudes_estudios`, `dw_vertical_pay_ima`, `dw_vertical_consultas_prog`. Mapeo de origen: `backend/services/dashboardSync.service.js:25`, `:72`, `:118`, `:154`, `:225`, `:269`, `:302`, `:357`, `:396`, `:437`. |
| SAP directo | SAP Business One Service Layer, con colecciones de documentos, catálogo de artículos y consultas guardadas. | `Orders` (`ORDR`/`RDR1`), `Invoices` (`OINV`/`INV1`), `CreditNotes` (`ORIN`/`RIN1`), `Items` (`OITM`), `BusinessPartners` (`OCRD`), `IncomingPayments` (`ORCT`), `PurchaseInvoices` (`OPCH`). |
| SAP guardado en BI / DW | Datos de SAP previamente sincronizados a PostgreSQL. | `dw_sap_ingresos_grupos`, `dw_sap_quirofano_analiticas`, `sap_incoming_payments`, `sap_purchase_invoices`. Evidencia: `backend/services/dashboardSync.service.js:519`; `backend/services/sync.service.js:8`, `:68`; `backend/routes/dashboard.routes.js:1823`. |
| SITI | Sistema histórico independiente; no se atribuye a SAP ni al Vertical actual. La aplicación envía consultas a su API. | Tablas antiguas `CtaH`, `CtaHLn`, `Paciente`, `Producto`, `Medico`, `KdxCajaDet`, `OsMed`, `OsMedEst`, `EstuMed`, `Consulta`, `ExpClinConsulta`, `PreConsulta`, `VtaReceta`. `backend/config/siti-api.js`; `backend/routes/siti.routes.js`. |
| Registro local de BI | Datos administrativos/operativos capturados o almacenados por la propia plataforma. No hay evidencia de que cada tabla se replique de Vertical. | `Camas`, `Admisiones`, `Egresos`, `ProgramacionQuirofano`, `AlmacenOrdenes`, `AuditoriaInventarioCargos`, `cex_citas`, `cex_pacientes`, `cex_consultas`, `cex_bitacora`. El adaptador `getDb()` utiliza PostgreSQL: `backend/config/db.js:2`, `:75`. |
| Histórico manual | Totales mensuales de archivos importados, sin el detalle transaccional verificable que ofrece el cálculo actual. | `backend/data/excel_stats_history.json`, `backend/data/statistics_manual_controls.json`; `backend/services/statistics.service.js:8`. |
| Estimación | Cálculo predictivo, no ingreso ocurrido ni servicio realizado. | Regresión lineal del macropanel y tabla `ml_forecast_ingresos_mensual`. `backend/routes/dashboard.routes.js:712`, `:760`; `backend/routes/finanzas.routes.js:11`. |

La sincronización general de tableros está programada cada 15 minutos. La ventana incremental es de 15 días; la carga completa inicia el 1 de abril de 2026. Varias consultas dividen el rango: hasta ayer usan DW y hoy usan Vertical/SAP directo. La fecha de esa separación depende de la hora local del servidor, no necesariamente de la zona del navegador. Evidencia: `backend/services/dashboardSync.service.js:554`, `:568`, `:579`, `:605`; `backend/utils/dashboard-helper.js:11`. La definición SQL interna de varias vistas `UDR_*` y de consultas SAP preexistentes no está incluida en estos archivos: se documentan sus objetos y campos consumidos, sin inventar las tablas internas de esas vistas.

### Inicio — Bienvenida y accesos a los módulos

**Ruta:** `/`. **Qué consultar:** bienvenida, identidad del usuario y accesos rápidos a los módulos habilitados para su rol, área y permisos. Cada tarjeta abre su módulo. El listado es dinámico y omite la propia tarjeta Inicio.

**Fuente:** sesión y catálogo de navegación/permisos de BI (`getNavItems`, `hasPermission`); no consulta pacientes, cuentas, ingresos ni KPIs hospitalarios. Aunque el archivo importa componentes de KPI y de Power BI, el contenido actual sólo renderiza accesos rápidos. Evidencia: `frontend/src/pages/HomePage.jsx:177`, `:277`; `frontend/src/utils/rbac.js`.

### Dashboard de mando directivo

**Ruta:** `/dashboard/directivo`. El menú ofrece exactamente cinco pestañas: **Eficiencia Operativa**, **Eficacia Clínica**, **Macropanel Financiero**, **Ingresos y Egresos**, **Demografía Geográfica**. Cambiar pestaña monta su componente específico. Evidencia: `frontend/src/components/dashboard/DashboardDirectivo.jsx:274`, `:317`.

**Uso general:** elegir pestaña, establecer fechas, aplicar filtros o limpiar. Los accesos rápidos de fecha incluyen Hoy, Esta Semana, Este Mes, Mes Pasado y Este Año. La barra presenta búsqueda de paciente/médico; sólo la pestaña Eficacia añade campos Médico y Especialidad. No todos los tableros consumen todos estos filtros: se indican abajo. El encabezado dispone de exportación PDF y Excel; el Excel directo usa `/api/dashboard/export-excel`. Evidencia: `frontend/src/components/dashboard/GlobalFilterBar.jsx:23`, `:114`; `frontend/src/components/dashboard/DashboardDirectivo.jsx:255`.

#### Eficiencia Operativa

**Qué se ve:** uso de camas y quirófanos, volumen de atención, tiempos frente a objetivos institucionales.

| KPI / gráfica | Cálculo o dato consultado | Fuente exacta |
|---|---|---|
| Camas Ocupadas (Promedio) | Promedio aritmético de `CamasOcupadas` de los periodos seleccionados, redondeado al entero. No es el censo de este instante. | Vertical `UDR_BI_INDICADORES_OPERATIVOS` → `dw_vertical_indicadores_operativos.camasocupadas`. |
| Quirófanos Activos | Promedio redondeado de `QuirofanosActivos` de esos periodos. | Misma vista → `quirofanosactivos`. Hay diferencia de nombre de campo entre respuesta y UI, explicada debajo. |
| Total Urgencias (6m) | Suma de `Urgencias`. La etiqueta dice 6m; con fechas explícitas comprende el rango solicitado. | Misma vista → `urgencias`. |
| Total Hospitalización (6m) | Suma de `Hospitalizacion`; misma salvedad del rango. | Misma vista → `hospitalizacion`. |
| Pacientes atendidos por mes | Barras mensuales de Urgencias y Hospitalización. | `Anio`, `Mes`, `FechaPeriodo`, `Urgencias`, `Hospitalizacion`. |
| Estancia promedio y objetivo (horas) | Serie real `EgresoHoras` frente a `EgresoMeta`; no recalcula la estancia desde las cuentas en esta ruta. | `egresohoras`, `egresometa`. |
| Triaje (Real vs Meta) | Serie `TriajeMin` frente a `TriajeMeta`. | `triajemin`, `triajemeta`; también llegan `triajeoutliers`, `estadotriaje`. |
| Laboratorio Clínico (Real vs Meta) | Serie `LaboratorioMin` frente a `LaboratorioMeta`. | `laboratoriomin`, `laboratoriometa`; también llegan outliers y estado. |
| Imagenología (Real vs Meta) | Serie `ImagenologiaMin` frente a `ImagenologiaMeta`. | `imagenologiamin`, `imagenologiameta`; también llegan outliers y estado. |

**Filtros:** inicio/fin; sin fechas se toman los últimos seis registros de la vista, ordenados por periodo. La búsqueda de paciente/médico no se envía a esta ruta. **Exportación:** Excel del encabezado consulta la vista Vertical directamente, mientras la pantalla lee DW; su vigencia puede diferir. No se encontró la definición de la vista para verificar cómo se obtienen originalmente los tiempos/metas.

**Limitación visible:** backend devuelve `kpis.quirofanosactivos` y la tarjeta consume `kpis.quirofanosActivos`; el dato de la tarjeta no está correctamente enlazado en este código. Evidencia: `frontend/src/components/dashboard/DashboardEficienciaNativo.jsx:82`, `:93`, `:133`; `backend/routes/dashboard.routes.js:856`, `:875`, `:928`, `:2008`; `backend/services/dashboardSync.service.js:154`.

#### Eficacia Clínica

**Qué se ve:** productividad médica y estados de citas; este tablero no calcula por sí mismo mortalidad ni desenlaces clínicos.

| KPI / apartado | Información y cálculo | Fuente |
|---|---|---|
| Consultas en el año | Suma `TotalAtenciones` del rango; el texto del KPI dice año, pero sin fechas el backend usa 30 días. | `UDR_BI_PRODUCTIVIDAD_MEDICOS.TotalAtenciones` → DW; hoy directo. |
| Top Especialidad | Especialidad con mayor suma de `TotalAtenciones`. | `Especialidad`. |
| Primeras Veces | Suma de `Primeras`. | Misma vista. |
| Subsecuentes | Suma de `Subsecuentes`. | Misma vista. |
| Volumen de Consultas por Mes | Total y primeras veces, agrupados por mes de `Fecha`. | Misma vista. |
| Estado de Citas del Día | Conteo por `Estatus_Orden_Venta`; comprende el rango consultado, pese al título del día. Clic abre el detalle por estado. | `V_UDR_CONSULTA_DIA` → `dw_vertical_consulta_dia`. |
| Top 10 Especialidades | Suma de atenciones por especialidad, descendente. Clic permite filtrar. | Productividad médica. |
| Top 10 Médicos (Productividad) | Suma de atenciones por combinación médico/especialidad. Clic permite filtrar. | Productividad médica. |
| Detalle de Consultas / Últimas Consultas (General) | Fecha/hora, número de cita, paciente, médico, especialidad, estado; general limitado a 100 filas más recientes. Clic en valores permite buscar cita/paciente/médico/especialidad. | Consulta del día: `Numero_Cita`, `Folio_Medico`, `Medico`, `MSDescription_ES`, `Fecha`, `Hora`, `Numero_Paciente`, `Paciente`, `Edad_Anios`, teléfonos, `Estatus_Orden_Venta`, `Articulo`. |

**Filtros:** fechas, búsqueda y especialidad, con catálogos locales de médicos/especialidades provenientes de productividad. La UI incorpora el campo médico a su consulta mediante búsqueda. **Exportación:** Excel directo de consulta del día con tope 500, no la misma tabla de productividad de las cuatro tarjetas. Evidencia: `frontend/src/components/dashboard/DashboardEficaciaNativo.jsx:36`, `:59`, `:127`, `:138`, `:246`; `backend/routes/dashboard.routes.js:1365`, `:1394`, `:1455`, `:1535`, `:1581`, `:1636`, `:1980`.

#### Macropanel Financiero

**Qué se ve:** importes de cuentas hospitalarias cerradas, costo directo, utilidad, cobranza inferida, cartera y revisión de la calidad de los datos. **Fuente:** Vertical `PC` y `PT`, con histórico DW y hoy directo. Este panel no obtiene sus seis KPI desde facturas SAP.

| KPI | Fórmula aplicada por la ruta |
|---|---|
| Ingresos Facturados | Suma de `PC.Balance`, interpretado en esta ruta como total facturado de la cuenta. |
| Costo de insumos y medicamentos | Suma de `PC.SubtotalCost`. |
| Utilidad Bruta | Suma de `Balance - SubtotalCost`; recalcula utilidad, no usa directamente `PC.Profit`. |
| Margen Bruto | `(utilidad acumulada / ingresos acumulados) × 100`; es margen agregado ponderado por importe. |
| Cobranza / Anticipos | Suma de `max(0, Balance - max(0, PC.Total))`. Es liquidación inferida de los valores de cuenta, no suma de recibos SAP. |
| Saldos por Cobrar | Suma de `max(0, PC.Total)`. |

**Criterio de inclusión:** ingreso de cuenta desde el 1 de abril de 2026; `PC_ST='CL'`; `Balance>0`; paciente sin TEST/PRUEBA; alta médica presente, posterior o igual al ingreso y no futura. El filtro temporal usa `PC.Date`/`entrydate`, aunque las series se agrupan por `MedicalDischargeDate`. Evidencia: `backend/routes/dashboard.routes.js:499`, `:521`, `:628`.

**Cada apartado adicional:**

- **Ingresos, costos y estimación de ingresos futuros:** importe mensual real y tres meses futuros por regresión lineal simple, calculada cuando hay al menos tres meses. La tabla ML puede sustituir el ingreso proyectado para meses coincidentes de área GENERAL/servicio TODOS.
- **Utilidad por mes y estimación futura:** utilidad real y proyección lineal, sin garantía de resultado futuro.
- **Saldos pendientes por antigüedad:** suma de pendientes por 0–30, 31–60, 61–90 y más de 90 días desde alta médica (o ingreso como respaldo). Clic filtra la tabla; detalle de cada rango conserva hasta 50 cuentas por mayor pendiente.
- **Auditoría Automática de Calidad de Datos:** registros originales, registros válidos y razones de exclusión: cuenta no finalizada, ceros/negativos, paciente de prueba y fechas incoherentes. Detecta importes superiores a `Q3 + 1,5 × IQR` dentro de cada mes si existen cuatro cuentas o más; esos importes se contabilizan, no se eliminan.
- **Detalle de cuentas:** hasta 100 cuentas recientes; alta, folio, paciente, total, costo, utilidad, margen, pagado y pendiente. Clic abre **Estado de Cuenta** con fecha de cargo, área, código, descripción, cantidad, precio e importe.

**Detalle de cuenta:** `/api/dashboard/financiero-nativo/cuenta/:pcNum` intenta `dw_vertical_pcit`; sólo si no encuentra ninguna fila consulta `PCIT` directo. Los códigos sin descripción se enriquecen con catálogo SAP `Items.ItemName`. Si existe una copia parcial local no la completa con cargos directos. **Filtros:** fechas y búsqueda de paciente/cuenta. **Exportación:** Excel directo sobre `dw_vertical_pc` aplica filtros distintos del panel (por ejemplo usa anticipos `Downpayments` como prioridad y no replica todas las exclusiones); no debe presumirse igualdad exacta del Excel con los KPI. Evidencia: `frontend/src/components/dashboard/DashboardFinancieroNativo.jsx:116`, `:141`, `:187`, `:238`, `:300`, `:422`; `backend/routes/dashboard.routes.js:395`, `:663`, `:712`, `:777`, `:787`, `:823`, `:1948`.

#### Ingresos y Egresos

**Qué se ve:** cobros recibidos, facturas de proveedores, formas de pago y estimaciones. Aunque una nota de la tarjeta dice Vertical POS, los valores actuales se leen de copias de SAP.

| KPI / apartado | Cálculo y fuente |
|---|---|
| Ingresos Totales (Cobros) | Suma `sap_incoming_payments.DocTotal` de pagos no cancelados del periodo. La sincronización construye `DocTotal=CashSum+TransferSum+tarjetas+cheques` desde SAP `IncomingPayments`; fuente contable ORCT. |
| Total en Efectivo | Suma `CashSum`. |
| Egresos (Cuentas por Pagar) | Suma `sap_purchase_invoices.DocTotal`, de SAP `PurchaseInvoices`/OPCH no canceladas. Son facturas de proveedor, no prueba de pago al proveedor. |
| Total Pagos | Número de filas de movimientos entregadas: hasta 300 ingresos y 300 facturas de proveedor. Incluye ambos tipos; no es un conteo ilimitado de recibos. |
| Distribución por Método de Pago | Dona de montos de Efectivo, Tarjeta de Débito/Crédito, Transferencia y Cheque. |
| Detalle por Método | Importe y cantidad de movimientos por método. Los conteos se basan en la lista limitada; el importe en todo el rango. Un pago mixto se etiqueta con prioridad tarjeta → transferencia → cheque → efectivo. |
| Últimos Movimientos Registrados | Tipo, fecha, folio/recibo, cuenta/socio, paciente/proveedor, método y monto. Subfiltros Todos, Ingresos y Egresos. |
| Ver Recibo SAP | Abre detalle del ingreso asociado a `DocNum`, consulta copia local y SAP directo para ampliar los datos. |
| Ver Factura de Proveedor SAP | Documento, proveedor, importe y líneas de SAP `PurchaseInvoices`, buscado por `DocNum`; la respuesta usa la primera factura encontrada. |
| Ver Estado de Cuenta | Para cuentas numéricas usa el detalle financiero de cargos Vertical. |
| Proyección de Ingresos (Próximo Mes) | Tabla con periodo predicho, área/servicio, ingreso estimado, intervalo bajo/alto y modelo desde `ml_forecast_ingresos_mensual`. Son predicciones. |

**Filtros:** inicio/fin y búsqueda por nombre/código de socio, número de documento y referencia del pago; inicio predeterminado 1 de abril de 2026. **Exportaciones:** PDF de pantalla; Excel del encabezado descarga `.xlsx` del backend sin los topes de movimientos de la UI; hay también exportación interna `.xls` basada en la lista recibida y subfiltro local. **Actualizar proyecciones:** inicia un trabajo en segundo plano que sincroniza el conjunto de entrenamiento, ejecuta `train_revenue_forecast.py` y `predict_revenue_forecast.py`. Estado disponible por `/api/finanzas/ml-forecast/status`; la UI de esta pestaña relee los resultados tras cinco segundos y no utiliza ese endpoint para confirmar finalización. El mapa de IA explica el entrenamiento.

Evidencia: `frontend/src/components/dashboard/DashboardFinanzasNativo.jsx:52`, `:70`, `:82`, `:99`, `:182`, `:274`, `:309`, `:475`; `backend/routes/dashboard.routes.js:3372`, `:3418`, `:3457`, `:3502`, `:3570`, `:3616`, `:1894`; `backend/services/sync.service.js:15`, `:32`, `:74`, `:130`; `backend/routes/finanzas.routes.js:11`, `:65`, `:78`.

#### Demografía Geográfica

**Qué se ve:** mapa por estado, Top 10 Estados y Top 15 Municipios/Alcaldías. Exporta los datos recibidos y PDF de la visualización. Se puede consultar el valor de un estado sobre el mapa.

**Fuente:** copia local de catálogo de pacientes `dw_vertical_pt`, alimentada de `PT.StateCode`, `PT.City`, `PT.FullName`, `PT.BirthDate` y ubicación `V_MRPT`. Agrupa `COUNT(*)` por estado/ciudad; blancos se convierten a CDMX. No utiliza ingresos, diagnósticos ni atenciones por periodo. El mapa recibe sólo los diez estados y quince ciudades más frecuentes. Los filtros globales del directivo no se envían a esta consulta.

**Componentes:** `DashboardNuevoMapa` carga la API; `DashboardMapaGeografico` dibuja el mapa mediante archivo local `/mx-all.topo.json`, normaliza abreviaturas y presenta rankings. No aparecen KPI adicionales en esta versión porque el contenedor no los proporciona. Evidencia: `frontend/src/components/dashboard/DashboardNuevoMapa.jsx:14`, `:32`; `frontend/src/components/dashboard/DashboardMapaGeografico.jsx:8`, `:109`, `:128`, `:169`, `:252`, `:271`; `backend/routes/dashboard.routes.js:2886`.

#### Datos del endpoint consolidado directivo que no se dibujan como tarjetas actuales

La página llama `/api/dashboard/directivo`, pero conserva sólo `censo` en su estado, y sus cinco pestañas consultan otras rutas. Para no omitir la lógica existente, el endpoint consolidado ofrece:

| Métrica disponible por API | Fuente y criterio |
|---|---|
| TotalCamas, Ocupadas, PctOcupacion | `Camas` activas; ocupadas/total × 100. Puede reemplazarse por métrica Data Hub `dir_ocupacion`. |
| TasaMortalidad, TotalEgresos, EstanciaPromedio | `Egresos` + `Admisiones`, último mes móvil; defunciones/egresos × 100; promedio segundos entre ingreso y egreso/86.400. Mortalidad reemplazable con `dir_mortalidad`. |
| CirugiasHoy, Realizadas, Canceladas, EnCurso | `ProgramacionQuirofano` con fecha del día; `dir_cirugias` puede sustituir CirugiasHoy. |
| financiero.ingresosMes, margen | Constantes cero en esta respuesta; no son cálculos financieros completos. |
| CostoInsumosMes, egresosMes | `AlmacenOrdenes`: suma precio unitario × cantidad surtida del mes; la consulta también calcula `AuditoriaInventarioCargos.MontoDisputa`. |
| mando.eficiencia/eficacia/satisfaccion/presupuesto | Sólo mapeos Data Hub `mando_*`, o null cuando no hay datos. No hay fórmula fija de estos cuatro indicadores en esa ruta. |
| Censo por área | Cuenta camas locales con estado OCUPADA por `Area`. |

**Estado:** API existente, no cuadro de mando adicional montado en la UI vigente. Evidencia: `frontend/src/components/dashboard/DashboardDirectivo.jsx:119`; `backend/routes/dashboard.routes.js:133`, `:141`, `:178`, `:198`, `:209`.

### Ocupación de Camas

**Ruta:** `/dashboard/ocupacion`. **Qué consultar:** censo actual con Total, Libres, Ocupadas, porcentajes y tarjetas individuales con nombre de cama, paciente y médico cuando está ocupada. Clic en Libres/Ocupadas filtra; segundo clic vuelve a todas. Agrupa PPB (Planta Baja), PPA (Planta Alta), Urgencias 1, Urgencias 2, Terapia Intensiva y Otras Áreas. Se actualiza automáticamente cada 30 segundos y muestra hora de última actualización.

**Cómo se obtiene:** maestro de camas desde ubicaciones registradas en `dw_vertical_pt` (nombres con CAMA o códigos CUBUTI), excluyendo VIRTUAL/VIRT. Ocupación se consulta directamente en Vertical `PC` + `PT` + `PR` + última asignación `PCFR`, `PCFR_ST='AS'`, sin salida, cuenta `OP`, tipo IP/ER y sin alta médica. Se cruza por código de cama, y agrega asignaciones ocupadas que no estuvieran en el maestro. Totales se calculan sobre ese conjunto; porcentajes libres/ocupadas se dividen por total. El maestro proviene del historial de pacientes/ubicaciones, no de una lectura completa de un catálogo físico de habitaciones independiente. La UI conserva grupo Camas Virtuales, aunque el backend las excluye.

Evidencia: `frontend/src/pages/OcupacionCamas.jsx:18`, `:47`, `:100`; `backend/routes/dashboard.routes.js:948`, `:951`, `:965`, `:1018`.

### Tablero por Área Hospitalaria

**Ruta:** `/dashboard/area`. **Uso:** seleccionar área cuando los permisos lo permitan, establecer periodo, aplicar filtros, revisar KPI/gráficas y abrir detalles. El área inicial es la asignada al usuario, la primera autorizada o Urgencias. El catálogo define trece áreas; no son trece rutas diferentes. No hay subpestañas visibles adicionales aunque existe estado interno `tab='kpis'`.

| Las 13 áreas del catálogo | Contenido montado actualmente |
|---|---|
| Quirófano | Actividad de Quirófano nativa. |
| Terapia Intensiva / UCI | Monitor clínico, cargos y KPI UCI. |
| Urgencias | KPI, censo, llegadas, ingresos y pacientes. |
| Cuneros | Recién nacidos, fórmulas, ingresos e insumos. |
| Imagenología | Estudios e ingresos por mes, servicios más solicitados. |
| Laboratorio | Estudios e ingresos por mes, servicios más solicitados. |
| Consulta Externa | Agenda/atenciones, asistencia, médicos y especialidades. |
| Finanzas | KPI genéricos de área y contenedor BI; no monta `DashboardFinanzasNativo` en esta página. |
| Hospitalización | Monitor clínico, cargos y KPI hospitalización. |
| Aseguradoras | Cuentas con convenio, importes y rankings. |
| Farmacia | Auxiliares nativo tipo farmacia; módulo farmacéutico operativo es otro apartado. |
| Cardiología | KPI genéricos y contenedor BI; no existe tablero nativo exclusivo montado aquí. |
| Almacén General | KPI genéricos y contenedor BI; operación de almacén es otro módulo. |

El selector oculta Farmacia, Finanzas, Almacén General y Cardiología excepto cuando coinciden con el área fija del usuario. Esto no elimina sus definiciones ni las rutas operativas específicas. Evidencia: `frontend/src/pages/DashboardArea.jsx:43`, `:90`, `:106`, `:280`, `:428`.

**KPI genéricos para áreas sin componente especializado:** Ocupación=`Camas` ocupadas/activas × 100; Egresos Mes=egresos del área en último mes móvil; Estancia Promedio=días entre `Admisiones.FechaIngreso` y `Egresos.FechaEgreso`; Rotación Camas=egresos/cantidad de camas del área. El denominador de rotación cuenta todas las camas, sin filtro Activo. Provienen de registros locales `Camas`, `Egresos`, `Admisiones`, no de SAP. Las fechas de la barra global no se agregan a `/area/:area`. Evidencia: `frontend/src/pages/DashboardArea.jsx:228`; `backend/routes/dashboard.routes.js:251`.

Sus identificadores configurables son `area.<área en minúsculas>.ocupacion`, `.egresos`, `.estancia` y `.rotacion_camas`. El nombre del área conserva espacios/acentos al aplicar solamente `toLowerCase()`. Estos identificadores permiten localizar la configuración aunque cambie la etiqueta visible; no cambian la fórmula. Evidencia: `frontend/src/pages/DashboardArea.jsx:33`, `:358`.

**Reportes y KPI asignados:** además de los nativos, puede haber tarjetas Reporte Asignado configuradas por permisos individuales; al hacer clic abren `PBIModal` para enlaces de reporte, varios paneles/páginas o datos configurados. Se excluyen permisos estructurales de rutas, áreas e IA. `getKPI` permite nombres e iconos configurables; una etiqueta personalizada no demuestra un origen distinto. Evidencia: `frontend/src/pages/DashboardArea.jsx:380`, `:389`.

**Contenedor BI dinámico:** obtiene `/api/bi/available-reports`, filtra `AreaRequerida`, y elige el reporte más reciente con PBIX/Looker/Power BI/miniatura. El contenido y origen interno de reportes externos no pueden inferirse del título ni del enlace. Hay una incompatibilidad actual: `DashboardArea` le pasa `report={dynamicReport}`, pero `EmbeddedBI` consume `reportId`; esa conexión no suministra la identificación que el visor espera. Se registra como contenido configurado con enlace incompleto, no como dashboard externo verificado. El visor independiente acepta URL/cadena codificada o `/api/bi/token/:reportId`, con Actualizar, iframe y opción multipágina. Sus leyendas de seguridad son texto de presentación, no evidencia de cómo está configurado el acceso externo. Evidencia: `frontend/src/pages/DashboardArea.jsx:252`, `:474`; `frontend/src/components/dashboard/EmbeddedBI.jsx:14`, `:50`.

#### Urgencias

| KPI / apartado | Qué consultar / fórmula | Fuente |
|---|---|---|
| Atenciones Médicas | Número de cuentas ER leídas para el periodo; no deduplica pacientes. | `PC.PCType='ER'`, `PC.Date`, `PC.PCNum`; DW hasta ayer y SQL Server hoy. |
| Egresos Mes | Cantidad de esas cuentas con `PC_ST='CL'` y alta médica presente. El filtro se aplica por ingreso, no por fecha de alta. | `MedicalDischargeDate`, `PC_ST`. |
| Estancia Promedio | Promedio de diferencias positivas ingreso–alta, en minutos/60; muestra horas. | `PC.Date`, `MedicalDischargeDate`. |
| Rotación Camas | Atenciones/días distintos con llegada; es pacientes por día, no pacientes por cama. | Fechas de ingreso del conjunto leído. |
| Censo Clínico en Vivo — Camas Urgencias | Cama, estado, paciente, médico, ingreso, folio y cargos acumulados; tarjetas abren desglose. | `PC`/`PT`/`PR`/`PCFR` directo con cuentas OP, ER, sin alta, habitación Urgencias 1/2; maestro `dw_vertical_pt`; cargos DW por folio. |
| Ingresos de Urgencias | La tarjeta muestra `ingresosSAP` o cero; SAP grupo 104. El servicio calcula por separado cargos Vertical en URG1/URG2, pero no son una alternativa automática en esta tarjeta. | `dw_sap_ingresos_grupos`, consulta guardada `sq_ingresos_grupos` para hoy. Los cargos/rankings Vertical usan `dw_vertical_cuentas_servicios`/`UDR_CUENTAS_SERVICIOS`. |
| Volumen de Llegadas (Últimos Días) | Conteo por fecha de ingreso. | Cuentas ER leídas. |
| Distribución de Estado | Altas/cerradas, abiertas/en piso y otros códigos. | `PC_ST`. |
| Top 10 Médicos por Ingreso | Suma de TOTAL_COBRADO por médico solicitante, o tratante como respaldo; omite NO ESPECIFICADO y EXTERNO EXTERNO. | Servicios Vertical URG1/URG2. |
| Top 10 Servicios Facturados | Suma de TOTAL_COBRADO por descripción de artículo; es importe de la vista Vertical. | `DESCRIPCION_DEL_ARTICULO`. |
| Detalle de Pacientes (Top 100) | Admisión, alta, cuenta, paciente, estancia, estado. | Cuentas ER. |
| Desglose de cuenta | Fecha, categoría, código, concepto, cantidad, total. | `/api/dashboard/cuenta-detalle/:folio`, cargos DW de toda la cuenta. |

**Filtros:** fecha de ingreso, búsqueda paciente/cuenta en detalle; búsqueda local dentro de tabla; censo actual independiente del rango. Los rankings/ingresos de servicios no usan la búsqueda paciente/cuenta de la lista. Sin rango usa 30 días. Cada tramo de lectura de cuentas se limita a 500; los KPI de cuentas se calculan a partir de ese conjunto, no de una consulta ilimitada. **Exportación:** PDF del área y Excel de pacientes con tope 500 de SQL Server. Evidencia: `frontend/src/pages/DashboardArea.jsx:147`, `:160`; `frontend/src/components/dashboard/DashboardUrgenciasNativo.jsx:109`, `:219`, `:234`, `:332`; `backend/routes/dashboard.routes.js:1040`, `:1057`, `:1093`, `:1157`, `:1209`, `:1242`, `:2032`, `:2862`.

#### Quirófano

**Qué se ve:** Actividad de Quirófano; las cuatro tarjetas **Ingresos de Quirófano**, **Total Cirugías**, **Duración Promedio (min)** y **Médicos Activos**; Evolución Mensual; Estado de las cirugías; Médicos con mayores ingresos; Servicios con mayor facturación; Top Procedimientos; Productividad por Especialidades; Detalle de Cirugías.

**Operación y cálculo:** el backend agrupa cargos `CQX` de `UDR_CUENTAS_SERVICIOS` / DW por paciente y relaciona el evento más cercano de `UDR_USOQX` / `dw_quirofano_eventos` dentro de ±3 días. Proporciona inicio/fin, quirófano, procedimientos, médicos y notas. La UI cuenta filas filtradas; duración suma `(fin-inicio)/60.000` si las fechas son válidas y divide entre todas las filas, incluso las de duración no válida. Médicos Activos se cuenta por cadenas de médicos completas distintas, no separando siempre cada profesional. Con año Todas, la evolución agrupa por número de mes y puede mezclar años.

La minigráfica de Total Cirugías representa `Total_Cirugias` mensual; la de Duración Promedio representa `Promedio_Duracion_Cirugia`. La minigráfica bajo Médicos Activos reutiliza `Total_Cirugias` como decoración; no es un conteo mensual de médicos. Evidencia: `frontend/src/components/dashboard/DashboardQuirofanoNativo.jsx:336`, `:351`, `:366`, `:373`.

**Estados y productividad:** Estado de las cirugías se agrupa por `Notas` del registro relacionado, no por todas las transiciones clínicas. Top Procedimientos cuenta cadenas de procedimientos iguales. Productividad por Especialidades clasifica palabras de `Procedimiento_Bitacora` o `Procedimientos`:

- Maternidad: Partos, Cesárea, Histerectomía, Miomectomía, Salpingo, AMEU, LUI, Otros.
- Endoscopías: Colonoscopías, Endoscopías/Panendoscopías, Broncoscopías.
- Gastroenterología: CPRE.
- Quirófano: Cirugías cuando no coincidió otra palabra y Notas es Cirugía Registrada.

Una fila puede incrementar varias técnicas; esta clasificación textual no acredita varias cirugías distintas. La fila Otros existe en el esquema pero no tiene incremento específico en las condiciones de clasificación examinadas.

**Ingresos:** copias SAP `dw_sap_quirofano_analiticas`, tipos TOTAL/MEDICO/SERVICIO por fecha `startdate`, top 10. Consultas definidas en código usan `OINV` + `INV1` + `OITM`, grupo 111, `SUM(LineTotal)`, agrupación por `U_PRName` o `Dscription`. Las SQL registradas de quirófano no muestran cláusula de exclusión de canceladas. **Filtros:** globales fechas y búsqueda; locales año, mes, médico, quirófano, estado y procedimiento; clic en gráficos para selección y Limpiar. Los filtros locales no recalculan los importes SAP entregados por backend.

**Exportaciones:** PDF; Excel del encabezado consulta `UDR_USOQX` directo, hasta 10.000 eventos; Excel interno exporta la lista filtrada como `.xls`. La exportación directa tiene una base distinta del listado agrupado por cargos de la pantalla. Detalle: quirófano, procedimiento, médicos, inicio, fin, duración y estado. Evidencia: `frontend/src/components/dashboard/DashboardQuirofanoNativo.jsx:33`, `:65`, `:81`, `:166`, `:227`, `:313`, `:427`, `:534`, `:623`; `backend/routes/dashboard.routes.js:44`, `:1666`, `:1704`, `:1788`, `:1821`, `:2063`.

#### Imagenología, Laboratorio y Farmacia — tableros nativos

Cada uno muestra **Estudios realizados**, **Ingresos de [área]**, **Estudios e ingresos por mes** y **[Estudios/Medicamentos] más solicitados**. En Farmacia se mantiene el texto genérico Estudios realizados; el ranking sí se rotula Medicamentos.

| Área | Volumen y ranking Vertical | Importe mostrado SAP |
|---|---|---|
| Imagenología | `UDR_BI_SOLICITUDES_ESTUDIOS.AreaNombre='IMAGENOLOGIA'`, SUM(Cantidad), por estudio/mes. | Grupo 117. |
| Laboratorio | Mismos campos, AreaNombre LABORATORIO. | Grupo 101. |
| Farmacia | Mismos campos, AreaNombre FARMACIA. | Grupo 115. |

**Fuente y capas:** solicitudes `UDR_BI_SOLICITUDES_ESTUDIOS` → `dw_vertical_solicitudes_estudios`; enlaza ingresos Vertical con `UDR_PAY_IMA` → `dw_vertical_pay_ima` mediante `PCPRITNum=PCITNum`. La pantalla usa **ingresosSAP**, obtenido de `dw_sap_ingresos_grupos` y `sq_ingresos_grupos` para hoy. Cantidades y facturación son bases diferentes: solicitud/cargo no confirma ejecución de estudio. **Filtros:** fechas; sin fechas año actual hasta hoy; búsqueda global se ve pero no se envía/consume en esta consulta. Top 10 por cantidad. Exporta PDF del área; no hay exportación Excel propia en este componente nativo. Las variantes `urgencias`, `hospitalizacion` y `terapia` del archivo de auxiliares son configuraciones de presentación reutilizables, pero no se montan desde DashboardArea, ni tienen tratamiento específico en este endpoint (caerían a Imagenología).

Evidencia: `frontend/src/components/dashboard/DashboardAuxiliaresNativo.jsx:18`, `:36`, `:106`, `:122`, `:152`; `backend/routes/dashboard.routes.js:2175`, `:2218`, `:2278`, `:2330`.

#### Cuneros

| KPI / gráfica | Información y criterio |
|---|---|
| Recién Nacidos | Cuenta pacientes distintos con cuenta cerrada, ubicación CUNERO/CUN y fecha de nacimiento igual al ingreso. Es una aproximación de uso de cunero con nacimiento ese día, no evidencia del lugar de nacimiento. |
| Biberones (Fórmulas) | SUM(Quantity) de `UDR_PAY_IMA` / DW con nombre `RN %` y descripción `%FORMULA%`; enlaces PCIT/PC. Histórico filtra ingreso; tramo de hoy filtra creación de cuenta. No prueba entrega física. |
| Ingresos de Cuneros | Importe SAP grupo 109, copia `dw_sap_ingresos_grupos` y consulta guardada para hoy. |
| Cargos de terapia neonatal | SUM(TOTAL_COBRADO) de Vertical unidad UCIN, histórico y hoy. |
| Top 10 Insumos y Medicamentos | Agrupa cantidades/importes de cargos `UDR_PAY_IMA` con paciente `RN %`; excluye descripciones con FORMULA, USO DE OXIGENO, USO PUNTAS PARA OXIGENO, ESTANCIA, GRUPO SANGUINEO, TOMA DE GLUCOSA, Anticipo y CONSULTA. |
| Distribución de Servicios Neonatales | Cantidades de cargos del mismo conjunto cuyo texto contiene USO DE OXIGENO, USO PUNTAS PARA OXIGENO, ESTANCIA DE CUNERO, TOMA DE GLUCOSA, GRUPO SANGUINEO o TAMIZ. |

**Filtros:** fechas, año actual hasta hoy por defecto; el buscador global no se aplica. **Exportación:** PDF del área; sin Excel propio montado aquí. **Origen exacto:** `PC`, `PT`, `V_MRPT`, `PCIT`, `UDR_PAY_IMA`, `UDR_CUENTAS_SERVICIOS`, sus copias DW y SAP grupos. Este KPI Recién Nacidos tiene criterio diferente del estadístico Nacimientos en el hospital, cuyo resultado actual está pendiente por falta de evidencia estructurada. Evidencia: `frontend/src/components/dashboard/DashboardCunerosNativo.jsx:25`, `:63`, `:119`, `:144`; `backend/routes/dashboard.routes.js:2347`, `:2363`, `:2392`, `:2420`, `:2448`, `:2494`.

#### UCI / Terapia Intensiva

**KPI visibles:** Facturación UCI (Acumulada), Ocupación de Camas UCI, Estancia Promedio UCI, Tasa de Mortalidad UCI.

| KPI / apartado | Fuente / cálculo |
|---|---|
| Facturación UCI (Acumulada) | SUM(`dw_vertical_cuentas_servicios.total_cobrado`) donde unidad UCI/UCIN o grupo TERAPIA INTENSIVA E INTERMEDIA; no factura SAP en esta tarjeta. |
| Ocupación de Camas UCI | Camas ocupadas actuales / camas del censo × 100. Asignación activa `PCFR`; códigos CUBUTI o CUNUCIN01. |
| Estancia Promedio UCI | AVG(DATEDIFF(day, PC.Date, MedicalDischargeDate)) en cuentas cerradas con alta en el rango; ubicación `V_MRPT` CUBUTI/CUNUCIN01. |
| Tasa de Mortalidad UCI | Defunciones/egresos × 100; defunción si `MedicalDischarge` es DEF/DEFUNCION/MD003 o `DateOfDeath` existe. |
| Censo Clínico en Vivo — Monitor de Terapia | Cama libre/ocupada, paciente, médico, ingreso, folio, días y cargos UCI acumulados. Maestro DW de ubicaciones, ocupación Vertical directa. |
| Distribución de Cargos en UCI | SUM(total_cobrado) por grupo de artículos. |
| Top 10 Insumos y Medicamentos de Mayor Costo | Cantidad e importe de cargos por artículo; ordena por total cobrado. El título costo no cambia el hecho de que usa precio/cargo. |
| Historial Clínico y Facturación de Pacientes UCI | Folio, paciente, ubicación, ingreso, alta, días, médico, cargos UCI, estado. Búsqueda local y filtro Activo/Alta; muestra todo el conjunto filtrado recibido. |
| Modal de cuenta | Fecha, grupo, código, artículo, cantidad, precio unitario e importe. Consulta cargos DW de toda la cuenta. |

**Filtros:** fechas y búsqueda global para históricos; ocupación es actual. Sin fechas, año actual. Histórico financiero se obtiene de DW para todo el rango; no completa el día con SQL Server en esas sumas. Estancia/mortalidad usan Vertical directo. En el historial Activo equivale a estado OP y Alta a los restantes estados. El modal permite buscar conceptos y filtrar grupo de cargos. **Exportación:** PDF del encabezado del área; el componente UCI no tiene exportación ni paginación propia del historial. Evidencia: `frontend/src/components/dashboard/DashboardUciNativo.jsx:79`, `:96`, `:175`, `:228`, `:381`, `:466`, `:490`, `:525`, `:548`, `:751`; `backend/routes/dashboard.routes.js:2623`, `:2709`, `:2740`, `:2778`, `:2825`, `:2862`.

#### Hospitalización

**KPI visibles:** Facturación Hospitalización (Acumulada), Ocupación de Camas Hospitalización, Estancia Promedio Hospitalización, Tasa de Mortalidad Hospitalización.

| KPI / apartado | Fuente / cálculo |
|---|---|
| Facturación Hospitalización (Acumulada) | SUM(total) de `dw_sap_ingresos_grupos` por fecha de documento, con `itmsgrpcod NOT IN (104,111,101,115,117,109,105,103)`. Es la suma de los grupos restantes; la etiqueta no acredita que cada cargo pertenezca exclusivamente a hospitalización. Es diferente de los cargos Vertical de los gráficos. |
| Ocupación de Camas Hospitalización | Camas ocupadas/censo × 100; Vertical PC/PT/PR y última asignación PCFR activa, maestro DW; filtra habitaciones de hospitalización y excluye UCI/UCIN/urgencias y virtuales. |
| Estancia Promedio Hospitalización | Promedio días entre ingreso/alta en cuentas `PC_ST='CL'`, `PCType='IP'`, alta médica dentro del rango; `V_MRPT.RoomCode NOT LIKE 'CUBUTI%'` y distinto de CUNUCIN01. |
| Tasa de Mortalidad Hospitalización | Defunciones/egresos × 100, mismos códigos que UCI. |
| Censo Clínico en Vivo — Monitor de Hospitalización | Cama, paciente, médico, ingreso, cuenta, cargos acumulados y modal de cargos. |
| Distribución de Cargos | Cargos DW por grupo, excluye grupo terapia y unidades UCI, UCIN, URG1, URG2. |
| Top 10 Insumos y Medicamentos de Mayor Costo | Artículos/cantidad/total cobrado; clasificación por cargos, no costo de compra. |
| Historial Clínico y Facturación de Pacientes | Folio, paciente, habitación, ingreso, alta, días de estancia, médico, cargos hospitalización y estado; búsqueda local y filtro Activo/Alta. Muestra todo el conjunto filtrado recibido. |
| Modal de cuenta | Fecha, categoría, código, concepto, cantidad, precio unitario y total, cargos DW de toda la cuenta. |

**Filtros:** fechas y búsqueda para histórico; censo actual independiente. En el historial Activo equivale a OP y Alta a los restantes estados; el modal permite búsqueda textual y filtro por grupo. **Capas:** censo y estadística clínica directo; maestro, cargos y facturación SAP guardados en DW. **Exportación:** PDF del encabezado de área; el componente Hospitalización no tiene exportación ni paginación propia del historial. Evidencia: `frontend/src/components/dashboard/DashboardHospitalizacionNativo.jsx:79`, `:96`, `:175`, `:228`, `:388`, `:473`, `:497`, `:532`, `:555`; `backend/routes/dashboard.routes.js:3690`, `:3773`, `:3820`, `:3851`, `:3865`, `:3880`, `:3913`.

#### Consulta Externa — tablero del área

**KPI:** Citas Programadas = filas de `UDR_CONSULTAS_PROG`; Pacientes Atendidos = estados con texto llegó/lleg..., y si ese conteo es cero utiliza cantidad de filas de `V_UDR_CONSULTA_DIA`; Cancelaciones = estados cuyo texto contiene cancelad; Tasa de Asistencia = atendidos/programadas × 100 redondeado.

**Gráficas:** Tendencia de Consultas por día; Top Especialidades; Top 10 Médicos por Consulta. **Detalle de Citas (Top 100):** fecha/hora, paciente, médico, especialidad y estado. **Fuente:** ambas vistas Vertical directas para todo el rango, sin SAP en los KPI. **Filtros:** fechas y búsqueda paciente/médico para listas/rankings; los cuatro KPI se calculan sobre los datos anteriores al filtro de texto, por lo que no siempre cambian al buscar. Sin fechas consulta hoy. Cuando se consulta hoy, tendencia muestra los últimos siete días. **Exportación:** PDF del área. No equivale a la Agenda de Consulta Externa de la ruta `/consulta-externa`.

Evidencia: `frontend/src/components/dashboard/DashboardConsultaExternaNativo.jsx:30`, `:50`, `:75`, `:108`, `:129`; `backend/routes/dashboard.routes.js:3048`, `:3080`, `:3092`, `:3101`, `:3130`, `:3150`.

#### Aseguradoras

**KPI:** Pacientes con convenio = número de cuentas elegibles, no pacientes únicos; Total Facturado = suma `PC.Total`; Saldo Pendiente = suma `PC.Balance`; Cuenta Promedio = total/número de cuentas. Esta interpretación Total/Balance difiere de la que aplica el Macropanel Financiero y debe conciliarse antes de comparar cifras.

**Fuente SAP:** catálogo `BusinessPartners` con `GroupCode=109`, códigos/nombres. **Fuente Vertical:** `PC` + `PT` + `PR`; selecciona cuentas cuyo BPCode pertenezca al catálogo o que tengan convenio `PCAG.AGCode` con alguno de esos socios; usa primer acuerdo coincidente. El SQL de esta ruta no exige `PCAG_ST='AU'`, a pesar de que un comentario llama activo al acuerdo. Si falla catálogo SAP utiliza cuatro socios predeterminados: es respaldo de alcance reducido, no catálogo completo.

**Gráficas/tabla:** Top 10 Aseguradoras por Volumen; Top 10 Aseguradoras por Monto sobre el mismo top obtenido por volumen; clic selecciona aseguradora y filtra lista. Tabla de cuentas/pacientes: cuenta, paciente, aseguradora, fecha de apertura, total, saldo y acción Ver Estado de Cuenta (detalle de cargos financiero). Lista API hasta 2.000 cuentas. **Filtros:** fechas; año actual por defecto; selección local aseguradora; búsqueda global no se consume. **Exportación:** PDF del área. Evidencia: `frontend/src/components/dashboard/DashboardAseguradorasNativo.jsx:39`, `:81`, `:137`, `:164`, `:226`; `backend/routes/dashboard.routes.js:3225`, `:3245`, `:3256`, `:3271`, `:3333`, `:3344`.

### Estadísticas Institucionales

**Ruta:** `/estadisticas`. **Uso:** seleccionar semana, mes, trimestre o año para tarjetas; revisar criterios/observaciones; abrir el Explorador de Estadísticas Institucionales; elegir sección, Tabla o Gráfico y año; hacer clic en un mes con detalle disponible; exportar tabla actual o generar Excel completo para fechas elegidas. Cada fecha final incluye el día completo. El Excel completo usa cálculo actual desde abril de 2026; el histórico mensual anterior conserva totales manuales y no admite detalle verificable.

**Fuentes centrales y consistencia:** tarjetas, detalle, histórico y Excel se construyen con `statistics.service`, `statisticsVertical.service` y `statisticsSap.service`. Los servicios actuales consultan directamente Vertical y SAP; no usan el antiguo prorrateo mensual de `getExcelProportionalValue` de dashboard.routes. Existe caché en memoria de 120 segundos por rango, con deduplicación de lecturas simultáneas; catálogo Items SAP tiene caché de diez minutos. Evidencia: `backend/routes/dashboard.routes.js:350`; `backend/routes/statistics.routes.js:41`; `backend/services/statistics.service.js:11`, `:148`; `backend/services/statisticsSap.service.js:145`.

#### Las siete tarjetas generales y cuadros de distribución

| Tarjeta / cuadro | Qué significa y fórmula actual |
|---|---|
| Egresos (periodo) | Cantidad de folios cerrados `PC_ST='CL'`, tipos IP/ER, con alta médica en periodo. |
| Promedio de edad | Promedio de edades válidas al alta médica; edad calculada desde `PC.BirthDate` descontando el cumpleaños aún no ocurrido. |
| % Género femenino | Egresos con F/FEMENINO / egresos con género F/M/FEMENINO/MASCULINO × 100. Desconocidos no entran al denominador. |
| Defunciones | Suma de casos con `MedicalDischarge` DEF/DEFUNCION/MD003 o `DateOfDeath` presente, en egresos IP/ER. |
| Nacimientos en el hospital | Actualmente **No disponible**: no existe evidencia estructurada del nacimiento en el hospital; no se sustituye por edad ni ocupación de cunero. |
| Estancia promedio | Promedio de `DATEDIFF(day, ingreso, alta)` válido sólo de hospitalización IP; es diferente del conteo de servicios de estancia del Explorador. |
| Vidas salvadas | Folios de atención distintos con servicio sala de choque registrado en órdenes vigentes SAP del periodo, no desenlace de supervivencia demostrado. Clic abre detalle SAP legado descrito más adelante. |
| Distribución de importes por área/servicio | Suma de `IngresoNeto` de líneas de órdenes SAP, agrupadas Imagenología, Laboratorio, Consulta de especialidad, Sala de choque y Otros. El identificador interno es top_diagnosticos/diagnosticos, pero no contiene diagnósticos clínicos. |
| Top 10 médicos por ingreso en hospitalización | Ranking IP por suma total de órdenes de venta vigentes por médico, con IVA si aplica. |
| Top 10 médicos por ingreso en urgencias | Mismo cálculo para ER. |

**Identificadores para configuración:** Egresos=`stats.egresos_total`; Promedio de edad=`stats.promedio_edad`; Género femenino=`stats.genero_femenino`; Defunciones=`stats.defunciones`; Nacimientos=`stats.nacimientos`; Estancia promedio=`stats.estancia_global`; Vidas salvadas=`stats.vidas_salvadas`; gráfica de importes=`stats.top_diagnosticos`. La tarjeta Nacimientos conserva su nombre visible, aunque exista otro nombre configurado. Las demás pueden tomar un nombre personalizado mediante `getKPI`; el identificador permite reconocer la métrica original. Evidencia: `frontend/src/pages/Estadisticas.jsx:156`, `:408`, `:450`.

Evidencia: `frontend/src/pages/Estadisticas.jsx:148`, `:156`, `:450`, `:486`; `backend/services/statisticsVertical.service.js:29`, `:74`, `:111`; `backend/services/statistics.service.js:80`, `:95`, `:193`, `:279`.

#### Las 18 secciones del Explorador y del Excel completo

| Sección visible | Información consultable y unidad | Origen / criterio verificable |
|---|---|---|
| 01 Vidas Salvadas (Sala de Choque) | Atenciones con sala de choque; una vez por folio. | Órdenes de venta SAP `Orders` (`ORDR`/`RDR1`), códigos SER0515/SER0533, cantidad positiva, `U_PCNum`. Se filtra por `TaxDate` del documento, no se interpreta como resultado clínico. |
| 02 Recién nacidos en el hospital | Nacimientos confirmados. Actual No disponible. | Requiere registro estructurado del lugar/nacimiento; el código no lo encontró. Histórico manual se conserva. |
| 03 Egresos de Hospitalización | Cuentas cerradas IP con alta médica en periodo. | Vertical `PC.PCNum`, `MedicalDischargeDate`, `Date`, `PCType`, `PC_ST`, género/edad/días/defunción. |
| 03 Cuentas de Urgencias | Cuentas cerradas ER con alta médica en periodo. | Mismo objeto Vertical. |
| 03 Cuentas de VaSeguro | Cuentas cerradas con autorización de convenio VaSeguro. | Vertical PC, `EXISTS PCAG` con `AGCode='VAGSEG001'` y `PCAG_ST='AU'`. |
| 04 Servicios de consulta de urgencias | Unidades netas de cargos de consulta, no atenciones únicas. | `PCIT` vigente CH, cuentas OP/CL/PD, Quantity−Returned; códigos SER0508, SER0509, SER0510, SER0511, SER0526, SER0527, SER0528, SER0529, SER1272, SER1278. Excluye interconsultas. |
| 05 Servicios de estancia | Unidades netas de servicios de habitación/cunero/terapia/ambulatorio. | Misma base PCIT; SER0653, SER0654, SER0657, SER0658, SER0660, SER0661, SER0662, SER0663, SER1234, SER1286; excluye estancia por hora de urgencias. No equivale a días cama calendario. |
| 06 Servicios de terapia | Unidades netas de cuidados intensivos/intermedios/neonatales. | Misma base PCIT; SER0658, SER0660, SER0661, SER0662, SER0663. El ID histórico conserva códigos antiguos SER501/SER600/SER710/SER730; no son el filtro actual Vertical. |
| 07 Personas que pasaron por Quirófano | Atenciones distintas con estancia Qx registrada. | `UDR_USOQX` + `PCFR` + `PC`, `FolioAtencion`; inicio en periodo, estancia no cancelada, cuentas OP/CL/PD. Una atención puede tener varias estancias. |
| 08 Procedimientos ambulatorios | Estancias de procedimiento en cuenta cerrada cuyo ingreso y alta médica tienen la misma fecha calendario y orden cronológico válido. | Misma base Qx; conserva las técnicas juntas en cada estancia. No cuenta cada técnica como paciente distinto. |
| 09 Consultas de Especialidad | Cantidad de servicios específicos en órdenes SAP vigentes. | Grupo 107 y catálogo permitido SER0578–SER0597 y SER0599–SER0623; excluye SER0577/SER0598, rentas, insumos e interconsultas. Registro de servicio no acredita consulta concluida. |
| 10 Estudios de Imagenología | Unidades facturadas menos notas de crédito, incluidos pacientes externos. | SAP `Invoices`/`CreditNotes` con `DocumentLines.Quantity`, ItemsGroupCode 117/130; fecha `DocDate`, no canceladas. Paquete cuenta como unidad, no se desglosa. |
| 10 Ingresos de imagenología | Importe neto sin IVA, facturas menos notas de crédito. | Mismas líneas/grupos: signo × (LineTotal−descuento de cabecera distribuido). |
| 11 Estudios de Laboratorio | Unidades facturadas menos notas de crédito, incluidos externos. | Mismos documentos SAP, grupos 101/121. |
| 11 Ingresos de laboratorio | Importe neto sin IVA de facturas menos notas de crédito. | Mismas líneas/grupos. |
| 13 Cirugías Realizadas | Estancias de quirófano registradas, una por `PCFRNum`; varias técnicas por estancia no son cirugías independientes. | `UDR_USOQX` + `PCFR` + `PC`, fecha de inicio. El nombre institucional exige validar técnicas ejecutadas antes de certificar cirugías. |
| 14 Top 10 médicos por ingreso en hospitalización | MXN de los diez médicos con mayor suma de órdenes IP. | Órdenes SAP, `DocTotal` contado una vez por orden, incluye IVA si aplica; médico U_PRNum/U_PRName, tipo U_PCType y folio U_PCNum; enriquece datos faltantes con PC/PR por folio, sin mezclar identidades. |
| 15 Top 10 médicos por ingreso en urgencias | Mismo ranking para órdenes ER. | Misma base. |

**No se omite un 12:** el catálogo actual no define sección 12; no se inventa un indicador para completar la numeración. Las 18 entradas incluyen subdivisiones de cuentas y montos. **COVID:** hay una salida interna `covid` pendiente de fuente validada, pero no es una sección visible de las 18 ni un conteo certificado. Evidencia del catálogo completo: `frontend/src/pages/Estadisticas.jsx:21`; `backend/services/statisticsCatalog.js:4`; reglas: `backend/services/statisticsVertical.service.js:6`, `:11`, `:29`, `:43`, `:95`; `backend/services/statisticsSap.service.js:7`, `:12`, `:176`, `:198`, `:209`, `:267`; `backend/services/statistics.service.js:80`, `:109`.

#### Histórico, detalle y archivos estadísticos

- **Tabla:** filas enero–diciembre, columnas años, totales mensuales/anuales/gran total. Los periodos no disponibles permanecen así; totales parciales suman sólo información disponible. Antes de abril 2026 usa `excel_stats_history.json`, agregado manual. Los meses actuales se recalculan desde fuente actual. El criterio anterior puede diferir: no se aplica prorrateo para aparentar detalle diario.
- **Gráfico:** barras de total por año y línea mensual del año elegido; unidad puede ser cantidad o MXN según sección.
- **Detalle mensual:** modal con criterio, cantidad, unidad, observaciones y filas de transacciones; búsqueda local y exportación Excel del detalle en `ModalDetalleEstadisticas`. Meses anteriores al corte no tienen detalle verificable.
- **Exportar tabla actual:** `.xlsx` de la sección histórica presentada, con No disponible y aclaración de totales parciales.
- **Generar estadístico / Descargar Excel completo:** resumen; las 18 hojas del catálogo; Órdenes por médico; Conciliación manual; Criterios y revisión. Las órdenes financieras y la facturación se concilian por separado; no se suman entre sí. Hoja de conciliación compara controles del archivo manual solamente cuando el rango es un mes completo y existe control, mostrando diferencia; no modifica cifras para igualarlas.
- **Datos financieros faltantes:** órdenes sin médico o sin tipo confirmado se mantienen fuera de los Top 10 y se reportan; documentos con más de una atención conservan la señal de atribución múltiple. Créditos buscan factura original cuando necesitan clasificarla; importes de descuento/IVA se distribuyen con redondeo y diferencia residual visible. Consulta SAP pagina todos los resultados con límites de seguridad; sobrepasarlos produce error en lugar de un total parcial silencioso.

Evidencia: `frontend/src/pages/Estadisticas.jsx:175`, `:200`, `:222`, `:265`, `:492`, `:589`, `:692`; `frontend/src/components/dashboard/ModalDetalleEstadisticas.jsx`; `backend/routes/statistics.routes.js:47`, `:52`, `:68`; `backend/services/statistics.service.js:177`, `:215`; `backend/services/statisticsWorkbook.service.js:90`, `:100`, `:136`, `:144`, `:160`.

#### Ventana adicional Detalle de Vidas Salvadas (SAP B1)

Al hacer clic en la tarjeta se monta `DashboardVidasSalvadas`. **Qué se consulta:** tabla de atenciones de consulta guardada SAP `VidasSalvChoqueDet`, y por atención un modal con **Facturas / Órdenes SAP** y **Cargos Vertical**, códigos, cantidades, precios e importes. El modal SAP une facturas `OINV/INV1` y órdenes `ORDR/RDR1` por `U_PCNum`, excluye canceladas; cargos Vertical usa `PCIT` directo por `PCNum` y calcula cantidad × precio unitario.

**Diferencia importante con tarjeta/histórico:** listado usa consulta guardada externa `VidasSalvChoqueDet` por fecha inicial, cuenta filas retornadas; no implementa el criterio común de distinct folios de `statistics.service`. Recibe `endDate` pero no lo aplica a la consulta guardada. La definición de `VidasSalvChoqueDet` no se encuentra en esta ruta: no se afirma qué filtros internos tiene. La ventana y la tarjeta pueden diferir en conteo o periodo. Unir facturas y órdenes en el modal sirve para revisar documentos, no para sumarlos como un único ingreso sin duplicación. Evidencia: `frontend/src/pages/Estadisticas.jsx:416`, `:791`; `frontend/src/components/dashboard/DashboardVidasSalvadas.jsx:30`, `:66`, `:139`, `:202`, `:238`; `backend/routes/dashboard.routes.js:2924`, `:2944`, `:2962`, `:2971`, `:3013`.

### Históricos SITI — Dashboard

**Ruta:** `/siti/dashboard`. Acceso backend para ADMIN/DIRECTOR. Las once pestañas son: **General (Finanzas), Quirófanos, Laboratorio, Imagenología, Farmacia, Consultas/Urgencias, Pisos/Hospitalización, Terapia Intensiva, Demografía Pacientes, Médicos, Mapa Geográfico**. Son consultas al sistema histórico SITI por su API; no son datos actuales SAP/Vertical. Exportaciones de estos componentes usan los conjuntos recibidos y/o PDF del panel.

#### General (Finanzas)

| KPI / gráfica | Origen y fórmula |
|---|---|
| Ingresos Históricos | SUM(`CtaHLn.PrecioFinal`), enlazando `CtaH` por NoAno/NoCtaH y agrupando año/mes de FechaIng. |
| Utilidad Operativa (Real) | Ingresos − SUM(`CtaHLn.Costo`). La etiqueta Real no modifica la base antigua de cargos. |
| Pacientes Atendidos | Conteo de filas `Paciente` por FechaRegistro y sexo; no conteo de atenciones médicas efectivas. |
| Crecimiento Financiero (SITI) | Serie anual consolidada de ingresos/utilidad. |
| Volumen de Pacientes por Género | Nuevos registros de pacientes por año, hombres/mujeres. `Sexo=True` se considera hombre; las otras filas se asignan mujer en esta ruta concreta. |

**Rango:** consulta financiero hasta año 2026, sin corte expreso marzo; pacientes usa todo lo registrado. **Exportación:** financiero y pacientes recibidos. Evidencia: `frontend/src/components/dashboard/DashboardSiti.jsx:23`, `:45`, `:274`, `:287`, `:309`; `backend/routes/siti.routes.js:19`, `:69`.

#### Quirófanos

**KPI:** Volumen de Cirugías (Histórico) = cuentas distintas con líneas cuyo producto `CodTipo LIKE 'CX%'`; Ingresos por Cirugías = SUM(MontoLinea) de esas líneas. **Gráficas:** Tendencia de Cirugías e Ingresos por Año; Top 10 Cirujanos (Volumen de Procedimientos); Top 10 Procedimientos Quirúrgicos.

**Fuente:** `CtaH`/`CtaHLn`/`Producto` para cuentas y líneas; `CtaH`/`Medico` para ranking médico. Tendencia excluye CtaH.Estatus C. Top procedimientos cuenta líneas de producto CX. Ranking de médicos cuenta todas las cuentas por médico y ordena por MontoCargos; no aplica filtro CX, aunque el título diga cirujanos/procedimientos. Ese ranking no confirma especialidad quirúrgica. **Filtros:** no fechas locales; histórico disponible. **Exportación:** tendencia, top médicos y procedimientos recibidos. Evidencia: `frontend/src/components/dashboard/DashboardSitiCirugias.jsx:24`, `:84`, `:98`, `:130`, `:150`; `backend/routes/siti.routes.js:115`, `:135`, `:149`.

#### Las seis pestañas SITI de auxiliares / servicios

Cada una permite ver **Volumen de Estudios (Histórico)** (texto genérico aun para farmacia/terapia), **Ingresos por [área]**, **Tendencia de Estudios e Ingresos por Año**, **Top 10 Estudios/Medicamentos/Servicios Solicitados**. La cantidad puede ser líneas o cuentas según tipo; no significa siempre estudios realizados. Exporta tendencia y Top 10 recibidos.

| Pestaña | Filtro exacto de SITI / base |
|---|---|
| Laboratorio | Cargos `Producto.CodTipo='ESTLAB'` o `CtaHLn.CodAlm` LAB; ingresos externos de `KdxCajaDet.CodTransCaja='LAB100'` más cargos hospitalarios. Top estudios `OsMedEst` + `EstuMed` + `OsMed`, CodTipoEstuMed LAB. |
| Imagenología | CodTipo ESTIMA o almacén IMA/RAYO; caja externa CodTransCaja IMA100 más cargos hospitalarios. Top estudios CodTipoEstuMed IM. |
| Farmacia | Almacén FARM o CodTipo FAR; líneas y MontoLinea de cuentas hospitalarias. |
| Consultas/Urgencias | Almacén ADMCON/ADMON/ADMRES; cuentas distintas en tendencia e importes de líneas. |
| Pisos/Hospitalización | Almacén PPA/PPB; cuentas distintas e importes de líneas. |
| Terapia Intensiva | NoProd SER501/SER600/SER710/SER730 o almacén TERAPI/TERINT; cuentas distintas e importes. |

**Objetos base:** `CtaHLn` + `CtaH` + `Producto`; por defecto agrupa FechaIng de la cuenta. En laboratorio/imagenología los volúmenes de caja cuentan filas de caja y hospitalarios cuentan líneas; no son una unidad idéntica. El backend también admite variantes **uso_qx** (USOQX1HR), **consultas** (CodTipo/almacén CONS), **endoscopia** (palabras en descripción), **vidas_salvadas** (USOSALCHO), **nacimientos** (productos CX-37/CX-34), que no están montadas como pestañas independientes en este dashboard. Evidencia: `frontend/src/components/dashboard/DashboardSiti.jsx:126`, `:190`, `:362`; `frontend/src/components/dashboard/DashboardSitiAuxiliares.jsx:18`, `:36`, `:97`, `:111`, `:143`; `backend/routes/siti.routes.js:180`, `:185`, `:212`, `:227`, `:273`, `:292`.

#### Demografía Pacientes

**KPI:** Pacientes Únicos=COUNT(DISTINCT NoPaciente) en CtaH; Total Admisiones=COUNT(NoCtaH); Nuevos (1 Ingreso)=pacientes con una cuenta; Recurrentes (2+ Ingresos)=pacientes con más de una cuenta histórica. **Gráficas:** Por Género (pacientes distintos del catálogo Paciente, no necesariamente la misma base de cuentas), Nuevos vs Recurrentes, Top 10 Motivos de Ingreso (`CtaH.MotivoIng`). **Fuente:** SITI CtaH/Paciente. **Filtros:** histórico completo, sin selector de fechas. Exporta resumen, género, motivos y retención. Evidencia: `frontend/src/components/dashboard/DashboardSitiPacientes.jsx:20`, `:47`, `:69`, `:97`, `:151`; `backend/routes/siti.routes.js:352`.

#### Médicos

**KPI:** Total de Médicos=COUNT(DISTINCT MedicoTratante) en cuentas con fecha de ingreso y médico no vacío; Ingreso Promedio por Médico=SUM(MontoCargos)/médicos distintos. **Gráfica:** Top 15 Médicos por Ingresos Generados, con cuentas distintas (`NoAno-NoCtaH`) e ingresos por cada código/nombre de tratante. No consulta honorarios devengados ni pagos reales al médico. **Filtro:** Histórico o años 2010–2025 del selector, aunque backend permite año solicitado; Excel/PDF del resultado. **Fuente:** SITI CtaH, campos FechaIng, MedicoTratante, MontoCargos. Evidencia: `frontend/src/components/dashboard/DashboardSitiMedicos.jsx:17`, `:43`, `:86`, `:101`; `backend/routes/siti.routes.js:416`.

#### Mapa Geográfico SITI

**Qué se ve:** mapa, Top 10 Estados, Top 15 Municipios/Alcaldías; KPI de pacientes y procedencia principal; distribución de género, rangos de edad; Población y Servicios Brindados por programas; Estadísticas de Edades y Sexo por Programa. **Filtro:** 2025 inicial, años 2010–2025 e Histórico; la API acepta año específico.

**Fuente general:** une por UNION ALL eventos de CtaH (FechaIng), OsMed (FechaSol), Consulta, Paciente (FechaRegistro), ExpClinConsulta, PreConsulta, VtaReceta (Fecha). Deduplica por paciente/año/mes antes de geografía, género y edad, enlaza catálogo Paciente. Un paciente presente en varios meses se cuenta varias veces al totalizar: la etiqueta Pacientes Únicos no equivale a personas distintas de todo el año. Los estados/municipios se normalizan mediante equivalencias; códigos sin especificar pueden atribuirse a CDMX. Edad usa año de evento menos año de nacimiento, sin verificar cumpleaños.

**Distribución edad general:** 0–12, 13–17, 18–29, 30–49, 50–64, 65+, No especificado. **Matrices oficiales:** grupos 0–6, 7–17, 18–24, 25–44, 45–60 y 61+; género FEM/MAS; en modo Histórico el cálculo de esas matrices usa 2025 como año de edad fijo.

| Programa de tabla Población y Servicios | Base y criterio aplicado |
|---|---|
| 1.1 Procedimientos quirúrgicos | CtaH con CodServ QX/PPA/PPB o CodTipo P/A; agrupa por NoPaciente. No consulta la técnica quirúrgica ejecutada. |
| 1.2 Hospitalización | CtaH con CodServ T/TER/UCI/END/IMG. Ésta es la clasificación que implementa esa tabla, aunque otras rutas usan otra base. |
| 1.3 Estudios auxiliares y de diagnóstico | OsMed por FechaSol; cuenta órdenes por paciente. |
| 2.1 Consulta externa | ExpClinConsulta por Fecha. |
| 2.2 Atención en Admisión Continua | CtaH con CodServ U/ADC. |

Para cada programa: Recurrente=personas con más de un evento del programa; Eventual=personas con un evento; Población Total=personas del programa; Total Servicios=suma eventos. Gran Total suma programas, por lo que una misma persona puede repetirse entre ellos. **Constante de respaldo:** si el total de servicios auxiliares es cero/no convertible, el código sustituye 17.936; por ello esa celda puede ser constante y no cifra consultada.

**Excel ejecutivo:** hojas 1 Población y Servicios; 2 Estadísticas Edades y Sexo; 3 Matriz Alcaldías/Municipios; 4 Matriz Estados; 5 Resumen Ejecutivo. Las matrices tienen columnas enero–diciembre, total anual y porcentaje; en Histórico agregan meses de diferentes años en columnas homónimas. Exporta PDF del mapa/tabla. Evidencia: `frontend/src/components/dashboard/DashboardSitiMapa.jsx:9`, `:29`, `:101`, `:149`, `:184`, `:197`, `:250`, `:320`; `backend/routes/siti.routes.js:464`, `:580`, `:630`, `:667`, `:701`, `:787`, `:964`, `:987`.

#### Consulta SITI adicional sin pestaña propia: imagen-detalle

`GET /api/siti/imagen-detalle` está registrado para estudios de imagen con código IMA, precios del catálogo, cantidades y ventas. Origen `EstuMed`, `EstuMedLn` (línea 1), `ProdAlmPrecio`, `OsMedEst`, `OsMedLn`, `OsMed`; fecha de cita fija año **2020**, orden con Pagado distinto de N. Calcula precio × cantidad y suma de ventas. No se encontró llamada de los componentes de dashboard a esta ruta; se clasifica como API adicional, no pantalla actual. Evidencia: `backend/routes/siti.routes.js:1183`.

### Análisis Comparativo SITI vs Vertical

**Ruta:** `/siti/comparativo`. **Qué consultar:** Transición de Ingresos (Línea de Tiempo Completa), barras SITI y área Vertical por mes; explicación textual de migración. **Fuente:** `/api/siti/financiero` (cargos PrecioFinal/Costos de SITI) y `/api/dashboard/financiero-nativo` (Balance/costo de cuentas Vertical válidas). Une meses iguales y representa ceros como null; no ofrece más KPI ni filtros locales ni exportación dedicada.

**Límite de interpretación:** las bases contables son distintas; no se puede afirmar que el gráfico sea una conciliación. El texto dice SITI hasta marzo 2026 y Vertical desde abril, pero el endpoint financiero SITI admite todo 2026 y la unión permite empalmes. Debe leerse como comparación de las series recibidas, no prueba del corte exacto escrito. Evidencia: `frontend/src/components/dashboard/DashboardComparativo.jsx:15`, `:24`, `:41`, `:55`, `:89`, `:110`.

### Agenda de Consulta Externa

**Ruta:** `/consulta-externa`. Tres pestañas: **Agenda Principal**, **Consulta del Día**, **Consultas Programadas Pagadas**. **Uso común:** escoger Fecha Cita o Fecha Creación, fechas Desde/Hasta, buscar, elegir especialidad cuando corresponda; Actualizar agenda; descargar Excel de pestaña con filtros. No es la misma fuente/fórmula que la pestaña Consulta Externa del tablero por área.

#### Agenda Principal

**Qué consultar:** cita/origen, fecha/hora y creación, paciente/expediente, edad/género, médico, especialidad/tipo de consulta, consultorio/artículo, teléfonos, convenio, estado, notas/diagnóstico; búsqueda por paciente, médico, expediente, convenio o números de cita; filtro especialidad y por estado.

| KPI | Cálculo actual sobre lista filtrada por búsqueda/especialidad |
|---|---|
| Total Citas | Cantidad de filas de `cex_citas` del rango recibido. |
| Asistencias | Estado local ASISTIDA. |
| Pagadas | Texto notas + diagnóstico + estado contiene pagada o pagado; no se comprueba recibo SAP ni pago contable. |
| No Asistió | Estado local NO_ASISTIO. |
| Tasa Asistencia | ASISTIDA/total × 100 redondeado. |

**Acciones visibles:** clic KPI filtra filas; Notas abre edición de notas iniciales/observaciones y diagnóstico/motivo; Guardar Notas registra campos locales. Cambios de estado tienen lógica frontend y API, pero en la tabla vigente la acción visible encontrada es Notas, no un formulario completo de atención clínica.

**Fuente de consulta:** `cex_citas` + `cex_pacientes` + `cex_consultas`, enlaza `dw_vertical_consultas_prog` por CitaOrigenId para completar consultorio, diagnóstico, notas, teléfonos, edad, género, consultas previas y convenio. La fecha Creación usa COALESCE(fecha local, fecha DW, fecha de cita). No escribe de regreso a Vertical ni SAP al guardar notas. Evidencia: `frontend/src/pages/ConsultaExternaPage.jsx:95`, `:134`, `:141`, `:166`, `:371`; `backend/routes/cex.routes.js:45`, `:69`, `:225`.

#### Consulta del Día

**Qué consultar:** número de cita, médico y folio, especialidad, fecha/hora, paciente y número, edad, teléfonos/celular, estado de orden de venta y artículo. **Fuente:** `dw_vertical_consulta_dia`, alimentada de `V_UDR_CONSULTA_DIA` y `PCAP.CreatedOn`. **Filtros:** Fecha Cita o Fecha Creación (respaldo a fecha de cita si falta creación), rango y búsqueda por paciente/médico/artículo/cita/número paciente. El nombre del apartado no restringe automáticamente a hoy si se cambió el rango. **Acciones:** lectura y Excel; no crea consultas en esta pestaña. Evidencia: `frontend/src/pages/ConsultaExternaPage.jsx:110`, `:388`; `backend/routes/cex.routes.js:309`; `backend/services/dashboardSync.service.js:302`.

#### Consultas Programadas Pagadas

**Qué consultar:** número de cita/paciente, médico, especialidad, fechas, paciente, convenio, descripción de estado de cita, tipo PS, diagnóstico y comentarios de la copia DW. **KPI:** Total=longitud del conjunto recibido; Pagadas=filas con `pcap_st_descripcion==='PAGADA'`; las tarjetas no usan necesariamente el subconjunto filtrado por texto. **Filtros:** búsqueda paciente/médico/convenio/especialidad/cita/paciente, especialidad y estado; Fecha Cita/Fecha Creación. La ruta devuelve todas las filas del rango y no filtra de origen exclusivamente PAGADA, a pesar del nombre de pestaña; el usuario debe revisar estado/filtro.

**Fuente exacta:** `dw_vertical_consultas_prog` se llena desde `UDR_CD` enlazada a `PCAP`, `SO`, `UDR_CONSULTAS_PROG`; convenio primero `SO.UDF_convenio_so`, luego convenio más reciente de `UDR_BI_PACIENTES`. FechaHoraCita se construye con fecha+hora; HastaFecha=DesdeFecha+30 minutos es una duración asignada por sincronización, no duración de consulta comprobada. Estado es COALESCE(descripción de UDR_CONSULTAS_PROG, estatus de orden de venta). **Acciones:** Excel de la pestaña y Actualizar agenda. Evidencia: `frontend/src/pages/ConsultaExternaPage.jsx:120`, `:428`, `:610`, `:629`; `backend/routes/cex.routes.js:342`; `backend/services/dashboardSync.service.js:437`, `:445`, `:458`.

#### Actualización y estados CEX: procedencia y límites

**Actualizar agenda** pide `/api/cex/sync`: intenta releer Vertical desde 15 días atrás a `dw_vertical_consultas_prog`, y después copia el DW a `cex_citas`/`cex_pacientes`. Si falla la lectura remota todavía puede copiar el DW y devolver Agenda actualizada, por lo que ese mensaje no prueba vigencia de Vertical. La copia trabaja ventana de 60 días por fecha de cita/creación. Los cron de ambas etapas se ejecutan cada 15 minutos.

**Mapeo de estados:** texto cancelad/cancelar → CANCELADA; procesada/llegó → ASISTIDA; otro → PROGRAMADA, salvo si pasaron cuatro horas desde cita, cuando marca NO_ASISTIO. Este último es inferencia temporal, no registro explícito de ausencia. Aunque el comentario del archivo dice respetar estados manuales finales, el `ON CONFLICT` realmente sustituye Estado sin condición; una futura sincronización puede modificar el estado local. Las notas/diagnóstico locales tienen prioridad al mostrar valores sobre los de DW.

**API adicional, sin formulario dedicado montado:** buscar pacientes `/pacientes`; crear cita `/citas` (local); cambiar estado `/citas/:id/estado` y bitácora; registrar consulta `/consultas` con signos vitales, motivo, diagnóstico, notas y próxima cita y marcar ASISTIDA; resumen por estado `/reportes`. Las crea/edita en tablas CEX locales, no en sistema externo. Evidencia: `backend/routes/cex.routes.js:18`, `:122`, `:146`, `:187`, `:249`, `:281`; `backend/services/cexSync.service.js:10`, `:24`, `:59`, `:90`; `frontend/src/services/cex.service.js:22`, `:46`.

### Inventario de componentes y rutas de este bloque

Esta lista complementa el mapa general para no confundir archivos reutilizables, componentes montados y API sin pantalla.

| Archivo de `frontend/src/components/dashboard/` | Estado y cobertura |
|---|---|
| DashboardDirectivo.jsx | Ruta montada, cinco pestañas descritas. |
| DashboardEficienciaNativo.jsx | Montado en Directivo/Eficiencia; todos KPI y cinco gráficos descritos. |
| DashboardEficaciaNativo.jsx | Montado en Directivo/Eficacia; cuatro KPI, volumen/estado/top y detalles. |
| DashboardFinancieroNativo.jsx | Montado en Directivo/Macropanel; seis KPI, cartera/calidad/cuentas/proyecciones. |
| DashboardFinanzasNativo.jsx | Montado en Directivo/Ingresos y Egresos; cobros/proveedores/métodos/movimientos/ML. |
| DashboardNuevoMapa.jsx | Montado Directivo/Demografía; cargador de mapa Vertical. |
| DashboardMapaGeografico.jsx | Renderizador reutilizado por mapas actuales/históricos; mapa, KPI opcionales y rankings. |
| DashboardUrgenciasNativo.jsx | Montado DashboardArea/Urgencias. |
| DashboardQuirofanoNativo.jsx | Montado DashboardArea/Quirófano. |
| DashboardAuxiliaresNativo.jsx | Montado DashboardArea/Imagenología/Laboratorio/Farmacia; variantes de presentación adicionales señaladas. |
| DashboardCunerosNativo.jsx | Montado DashboardArea/Cuneros. |
| DashboardUciNativo.jsx | Montado DashboardArea/UCI. |
| DashboardHospitalizacionNativo.jsx | Montado DashboardArea/Hospitalización. |
| DashboardConsultaExternaNativo.jsx | Montado DashboardArea/Consulta Externa. |
| DashboardAseguradorasNativo.jsx | Montado DashboardArea/Aseguradoras. |
| DashboardSiti.jsx | Ruta montada, once pestañas descritas. |
| DashboardSitiCirugias.jsx | Montado SITI/Quirófanos. |
| DashboardSitiAuxiliares.jsx | Montado en seis pestañas SITI; importación adicional en DashboardArea no se usa allí. |
| DashboardSitiPacientes.jsx | Montado SITI/Demografía Pacientes. |
| DashboardSitiMedicos.jsx | Montado SITI/Médicos. |
| DashboardSitiMapa.jsx | Montado SITI/Mapa, matrices/servicios/sexo/edad. |
| DashboardComparativo.jsx | Ruta montada SITI vs Vertical. |
| DashboardVidasSalvadas.jsx | Modal de Estadísticas; fuente/diferencias documentadas. |
| ModalDetalleEstadisticas.jsx | Modal de detalle histórico, filtrado/exportación. |
| EmbeddedBI.jsx | Visor reutilizable; fallback DashboardArea con contrato de props incompleto. |
| GlobalFilterBar.jsx | Barra transversal; filtros/periodos y consumo real descritos. |
| AreaSwitcher.jsx | Selector de áreas autorizadas; no nueva fuente de datos. |
| AreaIcon.jsx | Iconografía de áreas; no API/KPI. |
| areaColors.js | Paleta para áreas; no API/KPI. |
| DashboardMetricCard.jsx | Presentación/formato de tarjetas; no fuente propia. |
| DashboardChart.jsx | Contenedor de visualización; puede sustituir barras por ranking/lista para legibilidad, conservando los datos recibidos; no nueva métrica. |
| DashboardVisuals.css | Estilos compartidos, no consultas ni módulos independientes. |

**Páginas cubiertas:** `frontend/src/pages/HomePage.jsx`, `DashboardArea.jsx`, `OcupacionCamas.jsx` y su CSS, `Estadisticas.jsx`, `ConsultaExternaPage.jsx`. **Rutas montadas verificadas:** `/`, `/dashboard/directivo`, `/dashboard/ocupacion`, `/dashboard/area`, `/estadisticas`, `/siti/dashboard`, `/siti/comparativo`, `/consulta-externa` (`frontend/src/App.jsx:148`, `:156`, `:166`, `:174`, `:184`, `:373`, `:383`).

**Endpoints cubiertos:** dashboard `/directivo`, `/area/:area`, `/kpi-config`, `/financiero-nativo`, `/financiero-nativo/cuenta/:pcNum`, `/eficiencia-nativo`, `/censo-camas`, `/urgencias-nativo`, `/eficacia-nativo`, `/filtros-eficacia`, `/quirofano-nativo`, `/export-excel`, `/auxiliares-nativo/:tipo`, `/cuneros-nativo`, `/uci-nativo`, `/cuenta-detalle/:folio`, `/geografia`, `/sap/vidas-salvadas`, `/sap/vidas-salvadas/:atencion/detalle`, `/consulta-externa-nativo`, `/aseguradoras-nativo`, `/finanzas-nativo`, `/finanzas-nativo/factura/:docNum`, `/finanzas-nativo/ingreso/:docNum`, `/hospitalizacion-nativo`; estadísticos `/stats`, `/stats-historico`, `/stats-detalle`, `/stats-export`; SITI `/financiero`, `/pacientes`, `/cirugias`, `/auxiliares/:tipo`, `/pacientes-demografia`, `/medicos`, `/demografia`, `/imagen-detalle`; CEX `/sync`, `/agenda`, `/pacientes`, `/citas`, `/citas/:id/estado`, `/citas/:id/notas`, `/consultas`, `/reportes`, `/consulta-dia`, `/consultas-programadas`; Finanzas `/ml-forecast`, `/ml-forecast/status`, `/ml-forecast/run`. `/kpi-config` se vincula al inventario transversal de configuración.

**Servicios revisados para trazabilidad:** `dashboardSync.service.js`, `sync.service.js`, `cexSync.service.js`, `etl.service.js` (cálculos locales de eficacia/estancia y cargos; no reemplaza las fuentes actuales de las pestañas nativas), `statistics.service.js`, `statisticsVertical.service.js`, `statisticsSap.service.js`, `statisticsCatalog.js`, `statisticsCommon.js`, `statisticsWorkbook.service.js`; `config/db.js`, `config/pg-db.js`, `config/remote-db.js`, `config/siti-api.js`, `utils/dashboard-helper.js`. Los documentos antiguos con SQLite se consideran antecedentes; la conexión local actual examinada es PostgreSQL.
