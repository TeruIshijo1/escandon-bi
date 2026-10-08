# Revisión general y pase — 7 de octubre de 2026

El pase se regenera desde el estado completo de trabajo, con archivos modificados y nuevos. Incluye todo el backend activo y una compilación nueva de toda la aplicación. `MANIFIESTO.json` identifica los archivos distribuidos, sus fuentes y SHA256, así como las entradas utilizadas para compilar el frontend. La carpeta local del pase anterior queda conservada en `tmp/pase-anterior-*`.

## Alcance revisado

- **Honorarios:** catálogo y tarifas, fuentes clínicas, aprobaciones y concurrencia, fichas fiscales, cálculos en centavos, cierres, pagos, ajustes, auditoría de Vertical, Excel y PDF. Se conserva la separación de folios y la autorización por servicio y tarifa; configurar el catálogo no aprueba una atención.
- **Reportes y cuentas:** catálogos SAP y Vertical, permisos, consultas, filtros, columnas, paginación, plantillas, Excel, asistente de reportes y revisión de cuentas. El catálogo actual contiene **64 módulos: 39 SAP y 25 Vertical**, distribuidos en 19 categorías.
- **IA:** configuración por proveedor, reservas explícitas, reintentos, recuperación, validación de respuestas y diagnóstico sin claves ni resultados de pacientes.
- **Interfaz general:** tableros y áreas, filtros, temas claro y oscuro, pantallas móviles, administración, sesión, permisos, avisos, inventarios, farmacia y exportaciones.
- **Operación:** arranque y comprobación de instancia, runtime incluido, manifiestos de dependencias, instalador, inventario y verificación del paquete, documentación y manuales.

## Cambios y correcciones incluidos

1. Junto al médico aparecen **Descargar PDF detallado** y **Descargar PDF resumido**. Ambos incluyen únicamente sus servicios aprobados y respetan los filtros; el detallado agrega pacientes y folios. No requieren completar un cierre para consultar las aprobaciones.
2. En Catálogo y precios, los servicios completos muestran **Configurados** en verde. Un servicio incluido sin tarifa mantiene **Falta tarifa** en ámbar; los excluidos e inactivos no aparecen como configurados.
3. El encabezado del médico distribuye los botones sin comprimir su nombre en pantallas medianas y conserva la presentación móvil.
4. Si una sincronización desactiva un servicio después de preparar su aprobación, la transacción rechaza el guardado. No crea una revisión ni un registro de historial nuevos.
5. Los reportes mantienen el orden solicitado de columnas en la respuesta, la caché, la tabla y el Excel. Consultas con órdenes distintos de columnas no comparten metadatos incorrectos.
6. Los reportes del catálogo SAP siguen la continuación de una página vacía cuando todavía hay más resultados. Un límite de 100 páginas impide una continuación indefinida y señala el resultado como incompleto. Las consultas anteriores conservan su aviso de resultado incompleto cuando se detienen con una continuación pendiente.
7. Las consultas canceladas conservan su señal de cancelación; no se convierten en un aviso de fallo de conexión.
8. Se corrigieron etiquetas de texto en las pantallas generales y etiquetas cortadas de los gráficos de cartera. Los porcentajes caben en las donas y los nombres completos permanecen en la leyenda.
9. Al guardar una aprobación individual o múltiple, los servicios pasan a **Aprobados** y **Pagos y PDF** y salen inmediatamente de **Por revisar** y de **Aprobar pendientes**. Se conservan al consultar de nuevo, incluso si faltan datos fiscales. En **Todos** pueden consultarse como historial, sin seleccionarlos ni volver a aprobarlos. Se conservan las acciones explícitas para excluir un aprobado abierto o devolverlo a revisión. Si no puede leerse el estado guardado, la pantalla solicita reintentar y no presenta los servicios como nuevos pendientes.

También se incluyen las modificaciones anteriores aún pendientes de Git: navegación y operación de honorarios, auditoría de Vertical con exclusión de farmacia y almacenes, constructor y asistente de reportes, revisión de cuentas, presentación de tableros y avisos comprensibles. Véase [la revisión del 6 de octubre](revision-pase-2026-10-06.md) para su contexto; las comprobaciones actuales son las indicadas aquí.

## Comprobaciones actuales

- **Backend:** 39 suites y **566 pruebas aprobadas**, sin fallos ni omisiones, incluida la ampliación de jefes de área.
- **Lógica del frontend:** **39 pruebas aprobadas**, incluida la paridad de pantalla y servidor en 1,039,896 combinaciones de tarifa y cantidad, y la suma de consultas y pago fijo con y sin impuestos.
- **Empaquetado e instalación:** **6 pruebas aprobadas**, con detección de archivos ausentes o alterados, imports y dependencias, y conservación de configuración e historial existentes.
- **Navegador:** 9 suites de honorarios, 3 de reportes/cuentas y 3 de tableros/avisos. Comprueban descargas reales de PDF y Excel, estados, permisos, filtros, búsqueda paginada, cancelaciones y tamaños de pantalla.
- **PostgreSQL:** integración de administración y revisión de honorarios en esquemas temporales, incluida la desactivación entre preparación y aprobación. Después de guardar y volver a leer 50 aprobaciones, el cálculo real del cliente conserva los 50 aprobados, sin pendientes ni decisiones vencidas. El recorrido de honorarios desde navegador también utiliza API y PostgreSQL aislados.
- **Transición de aprobaciones:** pruebas de aprobación individual, parcial y por médico, retiro inmediato de pendientes, historial sin reaprobación, recarga con estados guardados y recuperación tras un fallo de lectura. Los aprobados permanecen visibles aunque su cálculo fiscal esté pendiente.
- **Jefes de área:** panel probado en escritorio, móvil y tema oscuro; seis propuestas con identidad confirmada; altas, edición por vigencia, baja, conflictos y permisos. Recorrido nuevo de navegador con API y PostgreSQL temporales: fijo opcional completo sin consultas, cortes parciales del mismo mes, PDF y cierre sin duplicación. Integración PostgreSQL mensual específica y ambas regresiones de gestión y revisiones aprobadas. PDF de aprobados y de pago renderizados y revisados.
- **Revisión de presentación:** temas claro/oscuro; 12 tableros generales en escritorio y móvil; 9 áreas en cuatro anchos; nombre del médico y botones PDF a 1180, 390 y 320 píxeles; etiquetas de gráficos dentro de sus límites.
- **Código y herramientas:** sintaxis de los 101 archivos JavaScript activos del backend, análisis sintáctico de las tres herramientas PowerShell y `git diff --check` aprobados.
- **Manual:** HTML y PDF actualizados; ocho capturas cargadas, nueve páginas renderizadas y revisadas, con los nombres nuevos de las descargas y la explicación de Configurados en verde.

Los logs y el inventario de revisión se conservan localmente en `tmp/release-2026-10-07/`; no se distribuyen. Las pruebas de sistemas externos usan respuestas ficticias. PostgreSQL se comprobó exclusivamente con estructuras temporales de pruebas. Esta ejecución no acredita funcionamiento contra SAP, Vertical ni proveedores de IA productivos y no modifica SERVIDORCALIDAD.

## Preparación y aplicación

La ampliación posterior agrega [pagos fijos mensuales de jefes de área](honorarios-jefes-de-area.md): tabla editable vinculada al directorio existente, importe antes de impuestos, vigencias por mes y decisión explícita para incluir el pago completo. Los fijos se suman a las atenciones aprobadas, participan en el cálculo fiscal, PDF, cierre, pagos y ajustes, y se identifican una sola vez por médico y mes. Las comprobaciones específicas de esta ampliación se registran junto a las pruebas locales del pase.

`build_deploy.ps1` valida el runtime, recompila el frontend, prepara el paquete completo y verifica su inventario, hashes, imports, dependencias y referencias compiladas antes y después de actualizar `pase_a_produccion`. La verificación final con `--source` debe confirmar coincidencia con todas las fuentes actuales. No basta con copiar los últimos componentes editados.

Aplica el pase siguiendo [README_PRODUCCION.md](../README_PRODUCCION.md): respalda la instalación y PostgreSQL, detén la instancia, verifica el paquete antes de mezclarlo con el servidor, copia todo su contenido, ejecuta `instalar.bat` y arranca `iniciar_produccion.bat`. Se conservan `backend/.env`, cargas, historiales y modelos existentes. Los datos iniciales se copian sólo si faltan. No ejecutes seeds ni restaures la base de desarrollo para actualizar.

La ampliación de jefes de área agrega tablas de configuración e historial de pagos fijos. Se incluye `backend/scripts/migrate-honorarios.js`, que prepara el esquema de BI de forma idempotente y conserva los datos existentes. No modifica SAP ni Vertical.

Después del reinicio, comprueba `/health`, inicio de sesión y acceso autorizado, las dos descargas PDF, los estados del catálogo, el orden de columnas y los gráficos claro/oscuro y móviles. En un entorno de prueba, aprueba una atención y comprueba que sale de Por revisar y aparece en Aprobados y Pagos y PDF, también después de recargar la consulta. Revisa por separado la disponibilidad real de SAP, Vertical y el proveedor de IA configurado. Usa un entorno de prueba para registrar pagos durante la validación; una descarga no realiza una transferencia.

Si hay que revertir el código, detén la instancia y recupera el respaldo de la instalación conservando los datos productivos. El paquete anterior archivado permite recuperar el pase local, pero no sustituye el respaldo del servidor ni de su base.
