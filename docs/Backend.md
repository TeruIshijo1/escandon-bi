---
actualizado: 2026-10-01
---

# Backend (Node.js / Express)

Servidor que maneja la lógica de negocio, seguridad y acceso a datos.

## Responsabilidades
- Exponer endpoints REST para el [[Frontend]].
- Gestionar la autenticación y validación de roles mediante JWT.
- Conectarse y extraer datos de la [[Database]].
- Proveer los datos necesarios para renderizar el [[Grafico_BI]].
- Ejecutar los procesos ETL y lógica del asistente IA (RAG).

## Módulos Clave
- **Controladores y Rutas**: `auth`, `dashboard`, `audit`, `export`, `ai`.
- **Servicios**: `etl.service.js`, `bi.service.js`, `rag.service.js`.
- **Base de Datos**: Configuración en `db.js` y `pg-db.js` conectando a PostgreSQL (ver [[Database]]).


## Runtime y arranque en Windows

La versión recomendada está fijada en `.nvmrc`: Node 24.21.0. El arranque utiliza
`backend/scripts/start-server.js`; en Windows prefiere `.runtime/node.exe` y en
otras plataformas conserva el Node que ejecuta el comando. La instalación global
no se modifica. El runtime local y sus binarios están excluidos de Git.

Desde la raíz, `powershell -ExecutionPolicy Bypass -File scripts/prepare-node-runtime.ps1`
descarga el ejecutable portable desde nodejs.org y verifica su SHA256 contra
`SHASUMS256.txt` antes de activarlo. Para Windows ARM64 agrega `-Architecture arm64`.
Después puede comprobarse sin abrir conexiones con
`cd backend` y `npm run runtime:check`.

`iniciar.bat`, `iniciar_produccion.bat` y `npm start` usan el launcher.
`npm run dev` utiliza el modo watch de Node con el mismo runtime. Los archivos
batch agregan el portable al PATH únicamente durante su ejecución, también para Vite.
El launcher resuelve las rutas desde el proyecto, conserva el cwd del backend
para `.env`, propaga la salida y las señales de detención, y no descarga archivos
ni reinicia el proceso automáticamente. Si el portable falla, muestra el error.

En Windows se rechaza Node 24.0–24.15 cuando no hay un portable válido. Existen
reportes de cierres nativos durante conexiones TCP en esas versiones:
[nodejs/node#63620](https://github.com/nodejs/node/issues/63620).
El cierre reportado el 1 de octubre de 2026 tuvo código 3221226505
(`0xC0000409`); posteriormente Vite mostró ECONNRESET y ECONNREFUSED.
El código indica un cierre nativo, pero no demuestra su causa. Una prueba aislada
de 60 segundos completó sin fallo en Node 24.15.0: la incidencia original no se
ha reproducido. El cambio de runtime es una mitigación ante el defecto reportado,
no evidencia de que se haya identificado el origen exacto. No se modificaron ETLs.


Validación local (2026-10-01): 37 pruebas pasaron en cinco suites (arranque y honorarios).
La prueba de conexiones aisladas completó 50,556 solicitudes en 60 segundos con
Node 24.21.0. La selección del runtime y la sintaxis de JavaScript/PowerShell quedaron
verificadas; esas pruebas se ejecutaron sin consultar sistemas clínicos. La revisión
automática rechazó inicialmente iniciar el backend por sus efectos de sincronización
en bases compartidas. El usuario autorizó explícitamente el arranque y la sincronización
el 1 de octubre de 2026.

La primera instancia de recuperación se inició a las 09:34 con Node 24.21.0 portable, en el puerto 4000.
Se verificó /health con estado y PostgreSQL OK. El endpoint de honorarios devolvió
401 sin credenciales tanto directamente como a través del proxy Vite, confirmando
que la conexión funciona y la autenticación se mantiene. Las sincronizaciones iniciales
de censo, consumos, traslados, quirófano, tableros, almacén y dataset ML finalizaron.
El ciclo de tableros completó en 98.2 segundos. El proceso seguía disponible tras
terminar el ciclo de almacén/ML, sin errores nuevos en el registro durante la comprobación.
La causa exacta del cierre original continúa sin confirmarse.

Validación independiente adicional: 100 de 100 solicitudes secuenciales a /health
respondieron HTTP 200, con estado y PostgreSQL OK. La comprobación del proceso
confirmó que el servidor del puerto 4000 ejecuta .runtime/node.exe, versión 24.21.0.

## Arranque cuando el backend ya está activo (2026-10-01)

El cierre por EADDRINUSE reportado después de la recuperación se debió a que
la instancia iniciada durante la comprobación seguía ocupando el puerto 4000.
El launcher comprueba /health antes de abrir otro servidor. Reutiliza únicamente
un backend sano de este servicio, la misma instalación y el mismo entorno;
identifica la instalación con un hash de su carpeta canónica. /health expone
service, installationId y environment junto con sus campos existentes.

La comprobación de red se ejecuta en el runtime seguro: si npm usa el Node global,
el launcher se reejecuta primero en el portable. --check continúa sin conexiones.
Si el backend está inicializando PostgreSQL espera de forma acotada; si el puerto
pertenece a otro servicio, otra instalación o entorno, o la instancia está degradada,
explica el conflicto sin crear ni detener procesos. --watch exige cerrar la instancia
existente para poder iniciar la recarga automática.

Cuando reutiliza una instancia, npm start termina correctamente con código 0;
Vite puede continuar y utiliza ese backend. Cerrar la nueva consola no detiene
la instancia reutilizada. El servidor también espera a obtener el puerto antes
de conectar a PostgreSQL e iniciar sus ETLs, para proteger las carreras entre
arranques simultáneos. La sugerencia de cerrar todos los procesos node.exe fue retirada.

Se reinició únicamente la instancia creada para la comprobación anterior,
verificando PID, padre, ejecutable, fecha y puerto antes de detenerla. A las 09:49
el backend actualizado respondió sano. Un segundo npm start terminó con código 0,
conservó el mismo PID y dejó exactamente una instancia de server.js.

Validación: 34 pruebas de arranque, identidad, salud y conflicto de puerto pasaron.
La prueba del puerto ocupado usa la misma dirección de escucha que server.js en
Windows y comprobó cero conexiones al PostgreSQL simulado y ninguna inicialización
ETL del proceso que pierde el puerto. Las pruebas usan únicamente fixtures locales.
