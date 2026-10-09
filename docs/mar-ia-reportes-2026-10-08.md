# MAR-IA y reportes: actualización del 8 de octubre de 2026

## Qué funciona

MAR-IA usa el mismo intérprete validado que el generador de reportes para solicitudes de reportes, períodos históricos y cambios de columnas o filtros. Por ejemplo:

1. «Necesito las cirugías de septiembre con paciente médico procedimiento».
2. «Nomás las cerradas».
3. «Mejor del primero al quince».

El período, las columnas y los filtros se aplican a la consulta real. Si faltan fechas o hay datos ambiguos, pregunta antes de consultar. Las listas de columnas sin comas incluyen procedimiento sin confundirlo con un nombre propio. No se ejecutan fórmulas, uniones ni columnas inventadas.

El chat muestra el reporte preparado, permite responder aclaraciones, reintentar una consulta fallida y empezar una nueva conversación. Sólo manda al backend el contexto mínimo del reporte; los indicadores y las filas mostradas no forman parte del historial enviado al modelo. La vista previa muestra hasta veinte filas; cada consulta del chat obtiene como máximo doscientos registros. El mensaje indica cuándo el resultado está limitado. Para el detalle completo y Excel se usa el generador de reportes.

Las consultas operativas existentes, como recetas pendientes, devoluciones del día, censo y stock, conservan su flujo. Las consultas de reportes requieren los permisos de tema del generador y respetan el perfil IA explícito. Se verifica nuevamente el acceso antes de leer datos.

Se corrigieron las comprobaciones de permisos en los resúmenes y las redirecciones de búsqueda. Los usuarios sin autorización no reciben nombres ni importes por esas búsquedas. La ruta del chat valida pregunta, historial, contexto y aclaraciones y admite veinte solicitudes por minuto y usuario. Los errores públicos de la ruta no muestran detalles del servidor.

## Conexión Gemini y nivel gratuito

La configuración local selecciona Gemini con `gemini-3.5-flash-lite`. La prueba real del 8 de octubre con catálogo y solicitud ficticios devolvió HTTP 402; la consulta de modelos devolvió HTTP 200 e incluyó ese modelo. Listar modelos no prueba que se puedan generar respuestas.

Google describe HTTP 402 como saldo prepago agotado y recomienda no reintentar hasta resolverlo. Las claves heredan el nivel y la facturación del proyecto; crear otra clave en el mismo proyecto no resuelve ese estado. El modelo tiene nivel gratuito, sujeto a las cuotas del proyecto. Para mantener uso gratuito, revisar en Google AI Studio que la clave corresponda a un proyecto en **Free Tier**. No se cambió la cuenta de Google ni se activaron pagos desde esta actualización.

Referencias oficiales: [errores de Gemini](https://ai.google.dev/gemini-api/docs/api-errors), [proyectos y facturación](https://ai.google.dev/gemini-api/docs/billing#projects-and-api-keys), [precios del modelo](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite).

El aviso de HTTP 402 ahora indica revisar el proyecto y la facturación. El generador sigue preparando solicitudes reconocidas mediante interpretación local aunque la IA esté indisponible; una solicitud no entendida requiere aclaración y no se presenta como resultado correcto.

No se envían filas del hospital en estos flujos de IA, pero el texto libre del usuario sí puede enviarse cuando se necesita el proveedor. No se deben escribir datos personales ni confidenciales al usar el nivel gratuito. [Condiciones de Gemini](https://ai.google.dev/gemini-api/terms).

## Instalación y comprobación en el servidor

1. Copiar el paquete completo actualizado `pase_a_produccion` e instalarlo con `instalar.bat`, siguiendo la guía de producción del proyecto. Se conserva el `.env` existente del servidor; el paquete no transporta la clave local.
2. Comprobar que `GEMINI_API_KEY` corresponda a la clave del proyecto previsto y que `GEMINI_MODEL=gemini-3.5-flash-lite`. No publicar ni pegar la clave en conversaciones, capturas o bitácoras.
3. Reiniciar el backend con `iniciar_produccion.bat` y recargar el navegador con Ctrl+F5.
4. En una terminal situada en la carpeta `backend` instalada, ejecutar `node scripts/check-report-ai.js`. Envía sólo una petición y catálogo ficticios, sin consultar bases del hospital. Debe devolver `engine: ai`, `status: ready` y código de salida 0. `guided` con `billing` indica que el reporte local funciona pero Gemini sigue bloqueado.
5. Con un usuario autorizado, probar una consulta de cirugías por un período conocido y comparar sus fechas y filtros con el generador. Ajustar a cerradas y comprobar que se conserva el período. Probar también un perfil restringido.

## Evidencia y límites

Las pruebas de backend cubren interpretación, seguimiento, fechas inválidas, permisos revocados, consulta vacía, límites y reintento. Las pruebas de navegador usan respuestas y registros ficticios y verifican aclaraciones, contexto mínimo, historial sin filas o indicadores, cancelación, nueva conversación y pantalla móvil. No prueban acceso real a SAP/Vertical ni instalación en producción.

La clave fue agregada por el usuario al servidor, pero no se ejecutó desde aquí una comprobación de esa instalación. Un paquete verificado localmente no confirma que esté instalado ni que la cuenta de Gemini productiva permita generar respuestas.
