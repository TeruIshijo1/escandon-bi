# Pase completo de frontend y backend — revisión final del 7 de octubre de 2026

Este pase se prepara desde todas las fuentes actuales del proyecto, incluidos archivos nuevos y modificaciones pendientes de Git. El frontend se recompila completo; el backend activo se distribuye completo. El manifiesto registra los hashes de los archivos y de las entradas de compilación para comprobar coincidencia con el proyecto.

## Cambios incluidos

Se incluyen honorarios, mensualidades de jefes de área, fichas fiscales, aprobaciones, cierres y pagos, auditoría, PDF y Excel; constructor y asistente de reportes SAP/Vertical; revisión de cuentas; tableros, navegación, sesión, permisos, avisos y presentación. El contexto está en [la revisión general anterior](revision-pase-2026-10-07.md).

También se incluyen todos los cambios de [estadísticos mensuales](estadisticos-mensuales-2026-10-07.md): servicios de urgencias, estancia y terapia; VaSeguro; procedimientos con ingreso y salida en el mismo día; estudios e ingresos de imagen y laboratorio; rankings separados de los diez médicos de hospitalización y urgencias; y Excel completo con fechas inclusivas, 22 hojas, detalles, criterios y conciliación manual.

La corrección de descarga consulta primero el catálogo de SAP, pagina los documentos de 200 en 200 y comparte una cola de lecturas. No entrega resultados parciales si falla una página. El histórico se carga cuando se solicita, las consultas pendientes no se expulsan de la caché y la pantalla explica que la generación puede tardar varios minutos. La solicitud autenticada de septiembre respondió HTTP 200 en 209.329 segundos durante la comprobación previa con fuentes reales.

## Corrección encontrada al preparar el paquete

Los estadísticos importan `excel_stats_history.json` y `statistics_manual_controls.json`. El paquete conserva esas referencias en `initial-data/backend/data`, y el instalador las activa sólo si no existen. Se corrigió el auditor de imports para reconocer estos recursos que se preparan durante la instalación; sigue rechazando imports ausentes de código y módulos disponibles únicamente como dependencias de desarrollo.

Dos pruebas nuevas comprueban los imports exactos de ambos JSON, la detección de cada recurso ausente, su carga después de instalar, la conservación del histórico existente y una segunda instalación sin sobrescribirlo. No se incorporan credenciales ni se sustituye la base del servidor.

## Comprobaciones

- Backend: 44 suites y 614 pruebas Jest aprobadas; 160 archivos JavaScript/CJS con sintaxis válida.
- Frontend: 44 pruebas de lógica aprobadas, incluida la paridad monetaria del cliente y servidor en 1,039,896 combinaciones.
- Empaquetado e instalación: 8 pruebas aprobadas.
- Navegador: las 18 suites de integración existentes del frontend aprobadas. Incluyen honorarios, fijos mensuales, PDF y Excel, reportes, reapertura de cuentas, estadísticos, avisos, 9 áreas y 12 tableros en escritorio/móvil y temas claro/oscuro.
- PostgreSQL: gestión de honorarios y mensualidades comprobadas en esquemas temporales aislados, eliminados al terminar; cero esquemas temporales restantes en esa revisión.
- Análisis estático: cero errores en frontend y backend. Se conservan 576 advertencias de frontend y 108 de backend, principalmente variables/imports sin uso. Estas advertencias no impiden compilar; no se presentan como errores funcionales.
- `git diff --check`: sin errores de espacios o marcadores de conflicto.

Los logs actuales se conservan en `tmp/release-final-2026-10-07/`, fuera del pase. La preparación usa `build_deploy.ps1`, `pase_a_produccion/verificar_pase.ps1` y `production-package.cjs verify pase_a_produccion --source`. El pase previo se conserva en `tmp/pase-anterior-*`.

## Límites y aplicación

La revisión de empaquetado confirma coincidencia con las fuentes locales y recursos necesarios para instalar. Las pruebas automatizadas de sistemas externos utilizan respuestas controladas y PostgreSQL aislado. Las lecturas reales de los estadísticos se documentan por separado; no prueban todos los módulos contra el servidor productivo.

Los nacimientos permanecen sin total confirmado por falta de evidencia del lugar de nacimiento. La diferencia de laboratorio de septiembre permanece visible para revisión documental. Estos pendientes de conciliación no se ocultan ni se sustituyen por ceros; véase [su evidencia y alcance](estadisticos-mensuales-2026-10-07.md).

Aplica el contenido completo del pase siguiendo [README_PRODUCCION.md](../README_PRODUCCION.md), ejecuta `instalar.bat`, reinicia el backend productivo y recarga la pantalla. Preparar y verificar este paquete local no lo instala en SERVIDORCALIDAD ni aplica cambios a SAP o Vertical.
