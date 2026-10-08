# Facturas y reapertura de cuentas

El apartado de Auditoría `/auditoria/reapertura-cuentas` consulta SAP por nombre del paciente (`U_PTName`) o número exacto de cuenta (`U_PCNum`). El folio se busca en cabeceras y líneas para incluir facturas consolidadas. `U_PRName` corresponde al médico y no se utiliza como nombre del paciente.

La pantalla muestra las facturas, su estado literal en SAP, los documentos relacionados y los motivos que impiden confirmar la reapertura. La opción **Actualizar desde SAP** vuelve a consultar los datos y retira la acreditación anterior mientras verifica; las observaciones anteriores siguen visibles, identificadas como datos de la consulta anterior. No ejecuta la reapertura.

La revisión comprueba primero las facturas propias mediante una consulta fresca. Si no encuentra ninguna, informa inmediatamente que la cuenta no cumple la condición obligatoria e incluye las órdenes disponibles como contexto. El resultado indica `mapState: not_requested` y `complete: false`: no presenta ese contexto como un mapa completo. **Consultar mapa completo** permite solicitar el recorrido completo de forma explícita (`fullMap=true`).

Las consultas muestran el tiempo transcurrido y pueden cancelarse. La cancelación aborta la petición del navegador, las solicitudes HTTPS a SAP y el trabajo pendiente de esa consulta; no deja una revisión anterior acreditando la reapertura. Los límites de espera mantienen cualquier fallo o demora como un resultado sin verificar.

Una cuenta cumple las condiciones únicamente cuando existe al menos una factura vigente localizada por el folio consultado, todas sus facturas vigentes indican `bost_Close` (o `C`), el mapa está completo y ningún documento relacionado tiene estado abierto o desconocido. Las facturas canceladas no acreditan por sí solas el cierre; una factura de otra cuenta tampoco sustituye esa condición. Las facturas ajenas vinculadas siguen formando parte del mapa y pueden impedir la reapertura. Una consulta fallida, truncada o con datos faltantes impide el resultado positivo.

Los pagos y asientos no exponen el mismo estado documental que una factura. Sus partidas del socio de negocios se verifican con los saldos pendientes de JDT1 en moneda local, extranjera y de sistema. La pantalla distingue **Sin partidas abiertas** de **Cerrado**. El recorrido incluye vínculos base, sucesores, referencias, aplicaciones de anticipos y conciliaciones; compartir un cliente no basta para crear una relación.

El acceso requiere el permiso `auditoria-reapertura-cuentas`, asignable desde Administración de usuarios. `amendoza` conserva el acceso general definido por la plataforma. La API valida el mismo permiso y evita almacenar las respuestas en caché.

Las definiciones SELECT `sq_bi_reopen_balance_v2`, `sq_bi_reopen_journal_v1` y `sq_bi_reopen_recon_v2` permiten consultar saldos y conciliaciones por documento. `sq_bi_reopen_invoice_keys_v1` y las consultas `sq_bi_reopen_keys_<tipo>_v1` localizan cuentas en cabeceras y líneas. El servicio comprueba la definición antes de utilizarla y registra únicamente sus propias plantillas SELECT cuando faltan. No modifica documentos financieros.

Si SAP restringe una tabla de inventario, la búsqueda de documentos utiliza las colecciones nativas de Service Layer. Si tampoco se puede completar esa lectura o la verificación contable, la cuenta queda **Sin verificar**. Los tiempos de espera, límites de paginación y tipos de documento no reconocidos nunca se interpretan como un mapa vacío. Las consultas de este apartado comparten un máximo de dos solicitudes simultáneas a SAP y no reutilizan estados financieros guardados.

Validación local: `node frontend/tests/accountReopening.integration.mjs` y las pruebas Jest `sapAccountReview.test.js` / `sapAccountReview.routes.test.js`. Las pruebas de navegador usan pacientes ficticios. Las verificaciones reales no guardan nombres ni números de cuenta en sus salidas.
