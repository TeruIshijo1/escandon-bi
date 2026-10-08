# Pagos fijos mensuales de jefes de área

Actualización del 7 de octubre de 2026.

En **Honorarios médicos → Configuración → Jefes de área** se administra una tabla con el médico del directorio existente, su área, el importe mensual antes de impuestos y los meses de vigencia. No se crea un médico nuevo ni se vinculan pagos sólo por un nombre parecido.

## Configurar la tabla

- **Agregar jefe de área:** selecciona al médico existente, indica área, importe y mes inicial, y confirma su identidad.
- **Editar:** cambia el importe o el área desde el mes elegido. Las vigencias permiten conservar los tramos anteriores. Un cambio pendiente de pago puede requerir revisar nuevamente su aprobación.
- **Quitar:** desactiva el pago desde el mes elegido. Conserva los meses anteriores, el historial y los pagos ya preparados.
- **Cargar listado inicial:** presenta las seis propuestas de la imagen. Una coincidencia única del nombre se sugiere, pero cada médico debe confirmarse antes de guardar. Si hay varias coincidencias, se elige su identificador del directorio.

| Médico del listado inicial | Área | Pago mensual antes de impuestos |
| --- | --- | ---: |
| ALFAN GUZMAN FELIPE | Ginecología | $2,500.00 |
| GARCIA TORRES LUIS JERONIMO | Cirugía general | $2,500.00 |
| ORRICO GALVEZ RUBEN DARIO | Ortopedia | $2,500.00 |
| MEDINA PEREZ JUAN JOSE | Anestesiología | $2,500.00 |
| MERAYO CHALICO FRANCISCO JAVIER | Medicina interna | $2,500.00 |
| LOPEZ VEJAR CESAR EMMANUEL | Infectología | $4,500.00 |

## Decidir el pago de cada mes

La configuración no agrega automáticamente el importe a un pago. En **Servicios → Ver servicios**, el médico muestra un concepto separado por cada mes consultado. El usuario decide si utiliza **Incluir pago mensual** o **Excluir**. Al incluirlo, confirma el IVA y se guarda el importe mensual completo, aunque el periodo consultado abarque sólo parte del mes.

**Aprobar pendientes** y la selección conjunta incluyen únicamente las atenciones; el pago fijo requiere su propia decisión. También puede incluirse cuando el médico no realizó consultas en ese periodo.

Después de incluirlo, aparece en **Aprobados** y **Pagos y PDF**. El cálculo muestra por separado servicios y pagos fijos antes de impuestos; aplica la ficha fiscal confirmada del mismo médico, con el cálculo y redondeo existentes. Un perfil sin retenciones confirmadas no genera retenciones. Si faltan datos fiscales, la aprobación permanece guardada y el cierre solicita completarlos.

Por ejemplo, tres servicios de $225.00 más un fijo de $2,500.00 dan **$3,175.00 antes de impuestos**. El fijo no se multiplica por el número de consultas ni por los días seleccionados.

El registro mensual pertenece al identificador del médico y al mes. Consultar otro corte del mismo mes recupera la misma decisión. Al preparar el pago se comprueba nuevamente la configuración y se impide cerrar ese mes dos veces, incluso con periodos superpuestos o peticiones concurrentes.

## PDF, pagos e historial

Los PDF detallado y resumido muestran el fijo aprobado como concepto mensual separado. El PDF para pago incluye sus impuestos, pagos registrados, ajustes y saldo. El Excel también conserva el concepto y su médico.

El cierre guarda el importe y la versión de configuración utilizados. Editar el precio o quitar al jefe después del cierre no modifica ese pago. Los pagos reales se registran con su comprobante mediante el flujo existente; incluir un concepto o descargar un PDF no realiza una transferencia.

## Pase y comprobación

El pase debe incluir backend y frontend completos. La preparación del esquema se incluye en **backend/scripts/migrate-honorarios.js** y agrega las tablas propias de BI de forma idempotente, sin modificar médicos, SAP ni Vertical. Conserva la configuración, aprobaciones, cierres y pagos existentes.

En un entorno de prueba, agrega un jefe, aprueba una atención, elige incluir el fijo y comprueba la suma en pantalla y PDF. Verifica otro corte del mismo mes, el rechazo de un segundo cierre, el cambio de precio desde otro mes y la conservación del primer pago. La evidencia local utiliza médicos ficticios y estructuras PostgreSQL temporales.
