# Asistente de reportes: diagnóstico en producción

La captura del 6 de octubre de 2026 muestra que el asistente pasó a la búsqueda guiada después de un fallo del proveedor de IA. Ese mensaje se presenta cuando existe una clave configurada; por sí solo no distingue permisos, modelo, cuota, red, tiempo de espera o respuesta inválida.

El backend registra ahora una categoría del fallo, el proveedor, un identificador reconocido del modelo y, cuando corresponde, el código HTTP o un código de red permitido. No registra claves, URLs configuradas, texto de errores, cuerpos de respuesta, solicitudes ni datos de pacientes. Los nombres de modelos personalizados se muestran como `configured`. El usuario sigue viendo la búsqueda guiada y puede completar el reporte.

## Registro productivo recibido

El usuario aportó un registro productivo con `provider: gemini`, `model: gemini-3.7-flash`, `category: capacity` y `httpStatus: 503`, tras aproximadamente nueve segundos. El registro identifica el resultado del último intento; no contiene el cuerpo de error ni permite reconstruir todos los modelos intentados.

Google describe HTTP 503 como indisponibilidad temporal por sobrecarga o caída del servicio y recomienda reintentar con espera creciente. El registro es compatible con esa condición. No basta para concluir que la clave esté caducada, que se agotó la cuota o cuál fue la causa interna del proveedor. Referencias oficiales: [códigos de error de Gemini](https://ai.google.dev/gemini-api/docs/api-errors) y [estrategia de reintentos](https://ai.google.dev/gemini-api/docs/troubleshooting).

## Continuidad del trabajo

El objetivo es conservar la solicitud, las fechas y los permisos del usuario y permitir que siga preparando su reporte con la búsqueda guiada cuando la IA falle o esté ocupada. La configuración se valida contra los temas y columnas autorizados antes de ejecutar consultas. La ejecución del reporte también necesita que SAP o Vertical estén disponibles.

Los reintentos, las alternativas de modelo, las reservas en otros proveedores y los límites de espera pueden mejorar la recuperación ante fallos temporales. No garantizan la disponibilidad de Google, OpenAI o DeepSeek ni que una respuesta de IA se complete en cada solicitud. La aplicación debe finalizar con una opción útil de búsqueda guiada cuando no pueda recuperar la IA dentro de su presupuesto de espera.

## Recuperación y límites implementados

Con cualquier proveedor, e incluso sin una clave, una solicitud ya entendida y completa se prepara con la interpretación local, sin esperar una llamada al proveedor ni mostrar un aviso de caída. La pregunta obligatoria sobre el origen SAP/Vertical de las órdenes de venta también se resuelve localmente. Se conservan las validaciones del catálogo, los datos solicitados, las fechas y los permisos. El comando de comprobación fuerza internamente una llamada a IA para verificar la conexión; la ruta del chat no acepta esa opción desde el navegador.

Si una aclaración contiene un borrador validado, el acceso a la configuración manual conserva ese borrador para los permisos vigentes. El usuario debe completar o ajustar el tema, las columnas y las fechas antes de generar. Si una solicitud no entendida o no disponible no tiene borrador, se abre el catálogo para elegir un tema; no se reutiliza el reporte anterior. Abrir esa configuración no ejecuta el borrador ni presenta un resultado anterior como respuesta al pedido pendiente; la conversación conserva su historial, contexto y aclaración para continuar el seguimiento. Si se revocó el permiso o el borrador ya no es válido, se pide elegir un tema disponible.

Cuando hace falta IA, toda la operación comparte un plazo de 25 segundos: todos los proveedores intentados, lectura del cuerpo JSON, descubrimiento de modelos y esperas entre reintentos. El tiempo restante se reparte entre los proveedores que faltan: con dos, el primero recibe unos 12,5 segundos; con tres, unos 8,33 segundos. El tiempo que no utilice un proveedor queda para los siguientes. Una llamada o un cuerpo bloqueado del primero no puede consumir todo el plazo y dejar sin oportunidad al respaldo.

En el endpoint oficial de Gemini hay como máximo tres solicitudes de generación dentro de su presupuesto. Ante HTTP 503, se puede probar otro Flash estable y, en el último intento, se prioriza un Flash Lite estable. HTTP 429 mantiene un solo reintento; otros proveedores y endpoints personalizados mantienen como máximo dos solicitudes de generación. Las alternativas automáticas excluyen Pro y modelos de vista previa. El descubrimiento automático de una configuración Flash Lite sólo busca Flash Lite. La lista explícita `REPORT_AI_GEMINI_FALLBACK_MODELS` admite nombres Flash o Flash Lite estables, incluso Flash desde una configuración Lite si el administrador lo indica; eso puede cambiar la familia y el consumo del modelo. Un nombre válido por formato no acredita su disponibilidad en la cuenta: se comprueba al intentar la llamada o listar modelos.

La reserva entre proveedores sólo se habilita con `REPORT_AI_FALLBACK_PROVIDERS` y claves propias configuradas. Después de un fallo que termina en búsqueda guiada se prueba el siguiente proveedor habilitado. Una respuesta de IA válida que pide aclaración o indica que un reporte no está permitido o no está disponible detiene los intentos; no se consulta otra IA para evadir esas condiciones. Toda propuesta conserva la misma validación de temas, columnas, fechas y permisos.

Las esperas de Gemini crecen de aproximadamente uno a dos segundos y añaden hasta 200 milisegundos de variación. Se respeta un `Retry-After` válido; si no cabe en el plazo restante, se pasa a la búsqueda guiada sin adelantar la siguiente solicitud. El descubrimiento consulta una sola vez la lista por operación cuando hace falta; la lista válida se conserva 15 minutos y se refresca si un modelo guardado devuelve 404. Un modelo alternativo exitoso se conserva hasta una hora después de recibir y validar su respuesta. Los fallos y las respuestas inválidas no se guardan como éxitos.

El proceso admite hasta dos operaciones simultáneas por proveedor, incluyendo descubrimiento, lectura y validación. Cuando ambos lugares están ocupados, ese proveedor devuelve búsqueda guiada inmediatamente; no se acumula en una cola y, si existe una reserva habilitada, puede probarse dentro del plazo restante. Los modelos Gemini que responden 503 quedan en enfriamiento durante 30 segundos para evitar insistir sobre ellos desde las solicitudes siguientes. En ambos casos locales, el aviso indica que la IA está ocupada y ofrece la guía, sin atribuir una caída de conexión. Los cachés separan endpoint, modelo y credencial sin exponerla. Estos límites y cachés pertenecen a cada proceso; varias instancias del backend suman su propio tráfico.

Con reservas habilitadas, un fallo completo de configuración, credenciales, acceso, modelo, cuota, capacidad, respuesta del proveedor, red, tiempo de espera o formato suspende esa configuración de proveedor durante 30 segundos. Las solicitudes siguientes pueden pasar directamente a una reserva, sin repetir toda la espera del proveedor que acaba de fallar; al vencer ese período una nueva solicitud puede comprobarlo de nuevo. La ocupación local y el enfriamiento de un modelo no abren esa suspensión de proveedor. El estado se separa también por credencial; no comparte un bloqueo entre claves distintas. El comprobador prueba cada configuración directamente para conocer su estado actual.

## Comprobar desde el servidor

Desde la raíz de la instalación, con sus dependencias de backend instaladas, ejecuta en PowerShell:

```powershell
.\.runtime\node.exe backend\scripts\check-report-ai.js
$LASTEXITCODE
```

Si la instalación no contiene el runtime portable, utiliza `node backend\scripts\check-report-ai.js` con Node 20 o superior. El comando carga `backend/.env` independientemente del directorio actual; las variables ya definidas en el proceso tienen precedencia, igual que en el backend. No modifica la configuración, la base de datos, SAP, Vertical ni los archivos del servidor.

La comprobación hace una llamada real al proveedor primario configurado y puede consumir una pequeña cantidad de su cuota. Prueba directamente esa configuración, sin permitir que otro proveedor o la preparación local oculten su fallo. Envía solamente una solicitud fija de inventario de demostración y un catálogo ficticio con dos columnas. No consulta el catálogo hospitalario ni envía registros. No imprime la respuesta del modelo. No requiere iniciar el servidor web.

| Salida | Significado |
| --- | --- |
| Código `0`, `engine: ai`, `status: ready` | El proveedor respondió y el asistente preparó el reporte ficticio. |
| Código `2`, `engine: guided` | Faltó configuración o falló el proveedor; la búsqueda guiada quedó disponible. Revisa `category`. |
| Código `3`, `engine: ai` | Hubo respuesta de IA, pero no completó el reporte ficticio. |

| Categoría | Próxima comprobación |
| --- | --- |
| `missing_key` | Verifica que la instalación o su proceso tenga una clave del proveedor esperado. |
| `configuration`, `configuration_file` | Revisa la configuración del endpoint o el acceso local al archivo, según corresponda. |
| `credentials` / HTTP `401` | Revisa la vigencia de la clave en la cuenta del proveedor. |
| `access` / HTTP `403` | Revisa permisos, restricciones de la clave y acceso al servicio. |
| `model` / HTTP `404` | Revisa el modelo configurado y su disponibilidad para esa cuenta. |
| `rate_limit` / HTTP `429` | Revisa cuota y límites de solicitudes en el proveedor. |
| `capacity` / HTTP `503`, `provider` | Revisa el estado del servicio del proveedor y repite la comprobación cuando corresponda. |
| `network`, `timeout` | Revisa DNS, salida HTTPS, proxy y certificados desde el servidor. El código de red, si aparece, precisa el tipo de fallo. |
| `response_format` | El proveedor no devolvió la respuesta JSON que espera el asistente. |
| `client_busy` | Las dos operaciones locales de ese proveedor están ocupadas. Continúa con la búsqueda guiada o vuelve a intentar cuando terminen. |
| `cooldown` | Un modelo está en enfriamiento por un 503 reciente o, con reservas habilitadas, el proveedor está suspendido temporalmente tras un fallo. Continúa con la búsqueda guiada o vuelve a intentar tras unos segundos. |
| `unavailable`, `diagnostic_failed` | Revisa el entorno de ejecución y repite la comprobación; el detalle arbitrario se omite para proteger los datos. |

El código selecciona la primera clave disponible en este orden: Gemini, DeepSeek, OpenAI. `LLM_BASE_URL`, si existe, prevalece sobre el endpoint predeterminado del primario; `AZURE_OPENAI_ENDPOINT` mantiene su uso previo para un primario OpenAI cuando no existe ese override. Comprueba que las variables conservadas corresponden al mismo proveedor. El pase conserva el `.env` productivo; reemplazar `.env.example` no cambia esa configuración. La documentación de octubre dejó `gemini-3.5-flash-lite` como modelo validado en desarrollo; esta nota no confirma su disponibilidad para la cuenta productiva.

## Configurar y comprobar las reservas antes de liberar

Las reservas están deshabilitadas si `REPORT_AI_FALLBACK_PROVIDERS` está ausente o vacío. La presencia de otra clave no autoriza enviarle la conversación. El administrador habilita sólo los proveedores previstos, con sus credenciales válidas del servidor: por ejemplo `REPORT_AI_FALLBACK_PROVIDERS=openai,deepseek`, o únicamente `openai` si ésa es la reserva instalada. Se respeta el orden configurado, se omiten duplicados y nombres no admitidos, y sólo se incluyen proveedores con su propia clave. Los nombres admitidos son `gemini`, `deepseek` y `openai`; el primario conserva la prioridad anterior.

Cada reserva usa su endpoint oficial y su modelo propio: `GEMINI_API_KEY` / `GEMINI_MODEL`, `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` u `OPENAI_API_KEY` / `OPENAI_MODEL`. Una reserva no hereda `LLM_BASE_URL` ni `AZURE_OPENAI_ENDPOINT` del primario. Para una reserva OpenAI se necesita una clave de OpenAI nativo; una clave Azure guardada en la variable legacy no acredita acceso a `api.openai.com`. No pegues claves en chats, capturas ni registros de comprobación. Usa el procedimiento de configuración protegido del servidor y conserva su `.env` durante el pase.

Después de configurar las reservas, ejecuta en el servidor de destino:

```powershell
.\.runtime\node.exe backend\scripts\check-report-ai.js --reserves
$LASTEXITCODE
```

La opción prueba por separado cada configuración habilitada con el mismo catálogo ficticio; no permite que una reserva buena o una respuesta guiada oculten el fallo de otra. Muestra únicamente diagnósticos permitidos y los conteos `configuredCount`, `readyCount` y `officialProviderCount`. Sólo devuelve código `0` y `status: ready` si **todos** responden con `engine: ai`, `status: ready` y hay **al menos dos proveedores oficiales distintos** entre Gemini, DeepSeek y OpenAI. Dos claves del mismo proveedor, un endpoint personalizado, una reserva sin clave, una respuesta incompleta o un fallo de credenciales no satisfacen esa comprobación. Los demás resultados devuelven código `2`, `status: incomplete`; los argumentos desconocidos también se rechazan sin enviar solicitudes ni imprimir su contenido.

Esta comprobación debe pasar en el servidor real antes de liberar con reservas habilitadas. Un éxito único de Gemini no demuestra la reserva; un error 401 requiere corregir la credencial, no añadir más reintentos. La preparación guiada continúa disponible si todos los proveedores fallan, pero no acredita que la redundancia de IA esté operativa.

Después de copiar la actualización o cambiar la configuración, detén la instancia del backend y vuelve a iniciarla. Abrir el lanzador mientras sigue activa puede reutilizar el proceso anterior y mantener su código/configuración cargados. Recarga la página con Ctrl + F5.

## Evidencia y alcance

El 6 de octubre de 2026 pasaron **272 pruebas de backend en doce suites**, incluyendo intención, asistente, rutas, diagnóstico, recuperación, configuración de proveedores, reservas, límites de concurrencia, enfriamiento y catálogos SAP/Vertical. Las pruebas automatizadas usan respuestas y errores simulados y verifican también el plazo compartido entre proveedores, promesas que ignoran la cancelación, cuerpos JSON o listados bloqueados, invalidación de caché tras 404, aislamiento de credenciales y endpoints, suspensión temporal de proveedores fallidos y nueva comprobación tras 30 segundos, ocultación de datos sensibles, detención ante respuestas de IA no permitidas y que el comando de diagnóstico pruebe cada configuración real sin aprobar mediante la interpretación local o una reserva distinta. Estas pruebas no llaman a proveedores ni acreditan la red o las credenciales de SERVIDORCALIDAD.

Pasaron también las **dos integraciones finales de navegador**, del asistente y del constructor, con datos ficticios: conservación de solicitud pendiente, fechas y columnas, selección de fuente, limpieza del aviso anterior y configuración manual desde una aclaración. Se verificó que una solicitud no disponible sin plan abre el catálogo, no reutiliza el reporte anterior ni dispara una consulta; volver al chat conserva el historial y el contexto para aplicar un seguimiento. Las solicitudes reconocidas usaron la preparación local sin llamadas al proveedor, aunque hubiera una clave ficticia configurada. Esta evidencia comprueba el flujo simulado de la aplicación; no es una consulta productiva.

Ese mismo día se ejecutó el comprobador real desde el entorno de desarrollo con salida de red permitida. La comprobación individual terminó con código `0`, `engine: ai`, `status: ready`, `provider: gemini`, `model: gemini-3.5-flash-lite`, `category: available` y HTTP `200`, en aproximadamente **2,26 segundos**. Se envió sólo el catálogo ficticio de dos campos, sin consultar bases de datos ni enviar registros hospitalarios. La ejecución previa dentro de un entorno con red restringida había devuelto `network`; esa restricción local no acredita un fallo de Google ni del servidor productivo.

La comprobación real posterior con `--reserves` habilitó OpenAI sólo mediante una variable temporal del proceso hijo, sin modificar `.env`. Gemini `gemini-3.5-flash-lite` respondió HTTP `200`, `ai`, `ready`; OpenAI `gpt-4o` respondió HTTP `401`, `credentials`, y terminó con búsqueda guiada. La salida fue código `2`, `status: incomplete`, `configuredCount: 2`, `readyCount: 1`, `officialProviderCount: 1`. Se usó exclusivamente el catálogo ficticio y no se consultaron bases de datos ni se enviaron registros hospitalarios. La clave OpenAI presente en desarrollo no fue aceptada para esa llamada: **no se aprobó la liberación con reservas**. Debe configurarse una credencial válida y comprobarse desde el servidor productivo; la prueba no establece el estado general de OpenAI ni el de sus credenciales productivas.

El registro productivo recibido acredita el fallo HTTP 503 observado; la recuperación con esta actualización en SERVIDORCALIDAD sigue pendiente de comprobar. Una salida exitosa acredita esa llamada y ese entorno en ese momento. La prueba con catálogo pequeño puede pasar mientras otra solicitud con el catálogo completo falla; el chat utiliza además los permisos y los temas de cada usuario. La disponibilidad de un modelo en el listado tampoco garantiza capacidad para generar una respuesta en ese momento.
