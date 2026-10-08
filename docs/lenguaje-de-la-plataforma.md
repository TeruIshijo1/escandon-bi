# Textos para las personas que usan la plataforma

Las instrucciones, ayudas, botones, avisos y encabezados de archivos deben entenderse sin conocimientos de sistemas.

- Explicar la tarea: “Elige los servicios que se pagarán” y “Registra la tarifa”.
- Usar “actualizar”, “existencias”, “enlace”, “historial de actividad” y “servicio”.
- No mostrar tablas, campos internos, consultas, errores de programación o nombres de procesos en los avisos.
- En un error, explicar qué no se pudo hacer y cuál es el siguiente paso. Conservar las validaciones concretas, como las fechas que deben corregirse.
- Mantener los términos médicos y contables necesarios, los importes, los folios y las notas registradas por las personas.

`frontend/src/utils/userMessages.js` adapta los avisos recibidos y errores de conexión antes de mostrarlos. `backend/middleware/publicMessages.middleware.js` evita que los avisos de las respuestas expongan detalles técnicos. Los detalles para investigar fallas permanecen en los registros del servidor.

Estas ayudas no sustituyen la redacción clara en el componente o servicio que origina el mensaje.
