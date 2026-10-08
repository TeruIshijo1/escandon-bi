# Cobertura y atribución de honorarios en Vertical

Investigación del 30 de septiembre de 2026 para resolver servicios que no se reflejan correctamente en el pago a médicos. Se consultó KH_HE exclusivamente en lectura, con énfasis en agosto y septiembre de 2026. La propuesta es construir un registro de prestaciones desde las líneas de venta y los cargos clínicos, identificar al médico por su participación y conciliar después con las vistas de honorarios.

La evidencia muestra problemas distintos de cobertura, importe, fecha y atribución. En los cortes examinados, las órdenes y cargos tienen representación en auditoría por sus claves agrupadas. Sin embargo, algunas reglas impiden llegar a pago, hay bases de honorario en cero y existe una discrepancia importante entre el médico propuesto por la auditoría y el anestesiólogo registrado en cirugía. Estos hallazgos no permiten calcular todavía un total adicional adeudado.

## Alcance y límites de la medición

Se excluyeron los grupos de catálogo Farmacia, Estudios de Laboratorio, Imagenología y Almacén General. La clasificación utilizada es la del artículo en Vertical. Existen ultrasonidos en otros grupos; para una exclusión por tipo de estudio se necesitará una lista de conceptos, además del grupo.

Las comparaciones de existencia usan orden y artículo, o atención y artículo. Se contrastaron también las claves exactas CITA y SO para los casos con indicadores de ejecución. Las vistas no exponen SOLNNum ni PCBLNum; una coincidencia agrupada no acredita cantidades, identidad de cada línea ni el saldo pendiente de pago.

Las consultas se ejecutaron sobre una base activa, sin una transacción de instantánea común. Una aparente ausencia de la orden 41465 correspondió a una línea creada después de extraer la auditoría; la reconsulta confirmó su presencia. No se considera una omisión.

Las definiciones de UDR_HON_PAGO, UDR_HON_PAGO_Audit, V_HON_PAGO y V_HON_PAGO_AUDITORIA no son visibles para la cuenta de consulta. Los patrones descritos se verificaron con datos; la lógica SQL interna requiere revisión del responsable de Vertical.

## Órdenes de venta y servicios

Para órdenes creadas entre el 1 de agosto y el 30 de septiembre, dentro de los grupos incluidos:

| Medición | Resultado |
| --- | ---: |
| Órdenes distintas | 7,105 |
| Líneas de servicio SOLN | 7,215 |
| Líneas con representación en auditoría por orden y artículo | 7,215 |
| Líneas sin coincidencia en la vista de pago por orden y artículo | 2,937 |
| Líneas cuyo diagnóstico dice Incluido en V_HON_PAGO pero no están en pago | 534 |

Las 2,937 líneas no son honorarios adicionales autorizados. Incluyen citas sin llegada, citas futuras, cancelaciones y servicios sin evidencia de realización.

Las 534 líneas de la última fila pertenecen a 476 órdenes sin cita y tienen UDF_Realizado nulo. Tampoco aparecen en V_HON_PAGO, por lo que cambiar del nombre UDR al nombre V no las recuperaría. En el mismo conjunto, 80 líneas sin cita y con UDF_Realizado verdadero sí aparecen en pago. Esto sugiere que las vistas aplican condiciones diferentes de realización; hace falta el SQL de las vistas para confirmar la causa exacta.

De esas 534 líneas, 227 son de Escuela de Enfermería. Sólo 133 tienen médico en la orden y una tarifa única positiva. Incluso estas 133 necesitan validar prestación, beneficiario y tarifa: un indicador nulo no demuestra que el médico no trabajó, pero tampoco acredita que el servicio se realizó.

Ejemplos para revisión operativa:

| Orden | Línea | Servicio | Tarifa de catálogo | Hallazgo |
| --- | --- | --- | ---: | --- |
| 33319 | 36521 | SER0737 Exodoncia adulto | 250 | Sin cita ni marca de realizado; auditoría dice incluido y pago no lo contiene |
| 33405 | 36613 | SER0746 Limpieza dental | 200 | Mismo patrón; requiere confirmar realización |
| 33651 | 36876 | SER0640 Consulta ginecología | 225 | Mismo patrón; creación y fecha de auditoría son distintas |

Estos importes son referencias del catálogo, no determinaciones de deuda.

Evidencia: [líneas fuente](../scratch/vertical-honorarios-20260930/root/order-lines.json), [comparación de órdenes](../scratch/vertical-honorarios-20260930/root/analysis-order-lines.json), [contraste de las cuatro vistas](../scratch/vertical-honorarios-20260930/schema/compare-views.json).

## Servicios identificados para Contact Center

Se revisaron los códigos proporcionados por el área. En V_IT son servicios de consulta externa y en UT_Honorarios aparecen estas referencias:

| Código | Concepto | Tarifa de referencia |
| --- | --- | ---: |
| SER1467 | Cuota de recuperación Afirma Medicina Interna | 225 |
| SER1470 | Cuota de recuperación Afirma Nutrición | 200 |
| SER1471 | Cuota de recuperación Afirma Psicología | 250 |

Estos nombres confirman los servicios y el convenio Afirma, pero no indican por sí solos el canal remoto ni prueban el honorario que corresponde al médico.

SER1471 es el concepto Afirma Psicología; SER0616, “Cuota de recuperación consulta Psicología”, es un código distinto. Deben mantenerse separados en la conciliación.

En órdenes creadas entre enero y septiembre de 2026 se localizaron **39 líneas** de esos conceptos —36 de SER1470 en abril y tres de SER1471 entre abril y mayo— con orden en estado PR o CM, sin UDF_Realizado, sin cita PCAP vinculada dentro del corte y sin coincidencia por orden y concepto en UDR_HON_PAGO. La auditoría las marca como elegibles y les asigna el motivo “Incluido en V_HON_PAGO”. Esto evidencia una discrepancia entre el diagnóstico de auditoría y la salida de pago, pero no demuestra que las 39 consultas se hayan impartido.

Como contraste, en agosto y septiembre aparecen órdenes de SER1470 y SER1471 con UDF_Realizado verdadero que sí están representadas en pago. La evidencia apunta a que falta una señal de realización para ciertos renglones de Contact Center; si se confirma una sesión completada, que no exista una llegada presencial no debería descartarla.

No se encontró en el esquema consultado un objeto ni un campo llamado Contact Center, teleconsulta, modalidad virtual o atención en línea. La plataforma externa puede conservar ese dato; hace falta conciliar su resultado de sesión —realizada, cancelada o sin respuesta— con la orden. Las líneas sin esa confirmación deben seguir como candidatas pendientes, no tratarse como deuda confirmada.

Se revisó también UT_APIT, la lista asociada a la validación de artículos de cita que expone V_PCAP_Consultas. Tiene 92 artículos habilitados. Entre los códigos de psicología aparece SER0616, pero no SER1467, SER1470 ni SER1471. En las citas psicológicas examinadas de agosto y septiembre, PCAP_ItemCode y UTAPIT_ItemCode aparecen vacíos y ArticuloValidoUTAPIT figura como “No”, incluso en citas con PCAP_ST SH y UDF_Ejecutada verdadero. Para los tres códigos Afirma, las citas enlazadas que sí aparecen en el corte están reservadas o canceladas; no hay ninguna marcada como llegada y ejecutada.

Esto vuelve plausible tu pista: una vía podría consistir en habilitar los artículos de Contact Center para citas. Sin embargo, el campo de artículo no se está poblando en las citas psicológicas revisadas y los 39 renglones ausentes no tienen cita enlazada. Por ello, agregar los tres códigos a UT_APIT por sí solo no resolvería ni demostraría la realización de las consultas en línea. Se necesita comprobar el proceso de Contact Center y conservar su resultado de sesión.

Evidencia: [catálogo y tarifas de referencia](../scratch/vertical-honorarios-20260930/root/contact_center_catalog.json), [órdenes y cobertura por estado](../scratch/vertical-honorarios-20260930/root/contact_center_orders.json), [candidatos elegibles sin marca y sin pago](../scratch/vertical-honorarios-20260930/root/contact_center_unflagged_candidates.json), [estados de citas enlazadas](../scratch/vertical-honorarios-20260930/root/contact_center_appointments.json), [lista UT_APIT](../scratch/vertical-honorarios-20260930/root/appointment_item_catalog.json), [artículos de cita y ejecución psicológica](../scratch/vertical-honorarios-20260930/root/psych_view_status.json), [mapeo entre Contact Center y artículos de cita](../scratch/vertical-honorarios-20260930/root/contact_center_appointment_mapping.json).

## Servicios presentes con honorario en cero

Al incorporar citas de agosto y septiembre aunque su orden se hubiera creado antes, se localizaron 102 líneas con indicadores de ejecución del episodio o de la orden, presentes en pago, con BaseImporte cero y SinTabulador igual a uno:

| Código | Concepto | Líneas |
| --- | --- | ---: |
| SER0624 | Cuota de recuperación preconsulta | 75 |
| SER0647 | Ultrasonido de crecimiento | 19 |
| SER0649 | Ultrasonido de primer trimestre | 8 |

Aquí el servicio existe en la vista de pago, pero no existe una base utilizable. Hace falta definir si cada concepto genera honorario y cuál es la tarifa autorizada. Los ultrasonidos están clasificados fuera del grupo Imagenología; si la exclusión solicitada abarca todo estudio de imagen, deberán excluirse por concepto.

En el universo contrastado no se encontraron líneas con los indicadores de ejecución definidos que estuvieran completamente ausentes de ambas vistas. Esta conclusión está limitada a registros identificables y a marcas de ejecución de cita o cabecera: no demuestra que todos los servicios realmente prestados estén registrados o marcados, ni acredita ejecución independiente de cada línea de una orden.

Evidencia: [bases cero y revisión de captura](../scratch/vertical-honorarios-20260930/root/targeted-findings.json), [conciliación de citas y órdenes](../scratch/vertical-honorarios-20260930/root/service-reconciliation.json).

## Los cargos clínicos necesitan una fuente adicional

Las órdenes de venta no contienen toda la actividad clínica. Se revisaron los cargos PCBL con LineType CH y artículos de tipo servicio, por ChargeDate:

| Medición | Agosto | Septiembre |
| --- | ---: | ---: |
| Cargos de servicios dentro del alcance | 2,390 | 2,450 |
| Con tarifa única positiva | 420 | 430 |
| Con tarifa positiva y atención cerrada | 375 | 405 |
| Con clave atención y artículo presente en auditoría | 2,390 | 2,450 |
| Con esa clave presente en pago | 51 | 0 |

En septiembre, los motivos de auditoría de esos cargos se distribuyen entre 1,753 conceptos fuera del tabulador, 290 atenciones no cerradas y 407 cargos bloqueados por la regla que exige la combinación de SER1281 Honorarios Médicos y los conceptos de anestesia SER1259 a SER1262.

Esto requiere revisar la regla por atención con el responsable funcional. Un cargo de anestesia puede tener tarifa y atención cerrada y aun así quedar fuera por la ausencia del otro concepto exigido. La existencia del cargo y de una tarifa tampoco acredita por sí sola una obligación de pago; algunos servicios corresponden al hospital o usan importes nominales de 1.

Ninguno de los cargos clínicos del corte tiene un vínculo poblado a SONum o SOLNNum, ni se recupera por PCIT, PCPRIT o PCPR. No es posible recuperar esta rama con un simple JOIN a las órdenes. Debe conservarse como una fuente propia, con PCBLNum como identificador del cargo y conciliación explícita cuando aparezcan vínculos verificables.

Evidencia: [resultados de cargos](../scratch/vertical-honorarios-20260930/clinical/06_findings.json), [consulta de cargos](../scratch/vertical-honorarios-20260930/clinical/04_charge_snapshot.sql).

## El beneficiario depende del rol clínico

SO.PR_RQ identifica al solicitante. SOLN no tiene un médico por línea. Para las citas, el vínculo que sí está poblado es PCAP.SONum hacia SO.SONum; SO.PCAPNum está vacío en las órdenes examinadas.

En el conjunto conciliado existen 239 líneas con indicadores de ejecución y diferencia entre el solicitante de la orden y el médico de la cita. Las vistas de pago conservan al médico de la cita y registran MatchMedico igual a cero. Son diferencias de rol, no 239 errores de pago demostrados. Reemplazar al beneficiario por SO.PR_RQ de forma general reasignaría servicios.

El hallazgo de anestesia exige más atención. PCFRPR registra la participación en el procedimiento mediante SurgeryRole. Para los conceptos SER1259 a SER1262:

| Medición | Agosto | Septiembre |
| --- | ---: | ---: |
| Cargos de anestesia | 76 | 59 |
| Con un anestesiólogo único en el rol AN | 64 | 49 |
| De éstos, PR_TX y PR_PC difieren del anestesiólogo | 64 | 49 |
| Médico propuesto por V_HON_PAGO_AUDITORIA coincide con AN | 0 | 0 |

Ejemplo: la atención 5288, estancia o procedimiento PCFR8883, concepto SER1260, tiene PR_TX y PR_PC iguales a 4. El rol AN identifica al prestador 25, pero la auditoría propone al 4. En la atención 5260 y PCFR8852, el rol AN identifica al 233, mientras la auditoría propone al 54.

Se debe validar esa participación y el convenio del médico para determinar el beneficiario. Cambiar globalmente de médico principal a médico del cargo tampoco resolvería estos casos. Los roles SURGEON, AN y AY permiten proponer cirujano, anestesiólogo y ayudante de forma separada; los casos sin rol o con varios participantes necesitan revisión.

Evidencia: [conteos de anestesia](../scratch/vertical-honorarios-20260930/clinical/08_anesthesia_counts.json), [contraste con la auditoría alternativa](../scratch/vertical-honorarios-20260930/clinical/12_anesthesia_audit_findings.json), [médico de cita y solicitante](../scratch/vertical-honorarios-20260930/schema/providerExamples.json).

## Fechas y tabuladores que afectan el resultado

Buscar sólo órdenes creadas durante el mes perdería servicios. Entre las líneas con cita SH y ejecutada, 1,387 de agosto y 1,285 de septiembre tienen una orden creada antes del mes correspondiente. En sentido inverso, las órdenes creadas en septiembre incluyen 1,039 líneas con cita de octubre todavía reservada.

Deben conservarse por separado la fecha de creación, fecha programada de cita, fecha del cargo, fecha de ejecución si existe y fecha de atención. PCAP.FromDate es una fecha de cita; ChargeDate es fecha de cargo. La regla de corte debe indicar qué fecha utiliza y por qué. En los cargos clínicos, 264 de agosto y 108 de septiembre tienen una fecha de atención de otro mes.

UT_Honorarios contiene 226 registros para 223 códigos y no tiene columnas de médico ni vigencia. SER0521 aparece con importes 1 y 1,500; SER1277 con 600 y 1,000; SER0655 tiene dos registros de 1,000. SER0713 tiene importe 1 y una nota que indica que el precio cambia según el médico. SER0570 tiene una nota con importes distintos según prestador. Por tanto, código único e importe positivo no bastan para validar una tarifa.

El tabulador nativo PRIT sí dispone de campos de médico, vigencia y monto o porcentaje, pero está vacío; PRMF y PRMFIT también. No se encontró en estas tablas una liquidación completa ya resuelta que sustituya las vistas actuales.

Evidencia: [fechas de citas](../scratch/vertical-honorarios-20260930/schema/appointmentServiceEvidence.json), [estructura y contenido del tabulador](../scratch/vertical-honorarios-20260930/schema/tariffStructure.json).

## Propuesta para un registro completo de candidatos

La unidad central debe ser la prestación y sus participantes médicos, con estas fuentes y evidencias:

| Componente | Función propuesta |
| --- | --- |
| SO y SOLN | Registrar cada línea de servicio, aun sin tarifa o médico confirmado |
| PCAP | Asociar cita, médico, fecha y marcas de llegada y ejecución |
| PCBL | Incorporar cargos clínicos vigentes que no están ligados a una orden |
| PCFRCP y PCFRPR | Aportar evidencia de procedimiento y participación por rol |
| Tabulador aprobado | Resolver importe por servicio, médico, rol, convenio y vigencia |
| Vistas de honorarios | Contrastar representación, reglas e importes del cálculo existente |
| Revisión BI y comprobantes de pago | Registrar autorización, aplicación de pagos y saldo por obligación |

SOLNNum identifica una línea de venta, pero una línea puede estar relacionada con citas de distintos episodios. La orden 13260 tiene la misma línea asociada a citas de abril y agosto. Para contar prestaciones se necesita conservar SOLNNum y la cita o episodio; repetir automáticamente la cantidad de la orden por cada cita podría duplicar unidades. Esa relación requiere una regla funcional de asignación.

La participación médica debe conservar PRNum y rol, además del nombre mostrado. Los estados deben ser independientes: localizado, realización documentada o pendiente, médico confirmado o en conflicto, tarifa definida o pendiente, autorizado y pagado. Una base desconocida debe mostrarse como importe pendiente, con el servicio visible para revisión.

El reporte debe conciliar líneas y cantidades desde las fuentes, mostrar por qué un candidato no llega a autorización y permitir revisar el documento original. Los servicios hospitalarios sin honorario médico deben tener una exclusión explícita; ItemType S también contiene conceptos de escuela, estancia e insumos. Las facturas o pagos contables deberán aplicarse a las obligaciones identificadas, evitando crear una segunda prestación por el mismo servicio.

## Prioridad de implementación

1. Crear una conciliación de candidatos desde SOLN y PCBL, con los identificadores originales, fechas y estados, sin depender de que UDR los acepte.
2. Presentar las excepciones de mayor valor operativo: servicio sin marca de realización, base cero, tarifa ambigua, médico discrepante, anestesia con rol documentado y bloqueo por la combinación de conceptos de la atención.
3. Validar con Contabilidad y el responsable de Vertical la regla de la combinación SER1281 y anestesia, las tarifas nominales o específicas por médico, y quién debe acreditar la realización cuando falta la marca.
4. Contrastar el resultado con un médico y mes cuyo pago esperado ya se conozca, antes de sustituir el cálculo utilizado para liquidar.

Esta investigación entrega una ruta para medir cobertura y localizar causas. El total adicional a pagar seguirá pendiente hasta confirmar prestación, beneficiario, tarifa y pagos previos de cada candidato. No se modificaron datos ni reglas de pago durante la exploración.
