# Pase actualizado — 6 de octubre de 2026

El paquete `pase_a_produccion` se prepara desde el estado completo del proyecto, incluidos los archivos nuevos y los cambios que todavía no están confirmados en Git. La referencia exacta de lo distribuido es `MANIFIESTO.json`, con el origen, tamaño y SHA256 de cada archivo y las entradas utilizadas para compilar el frontend.

## Cambios incluidos

- **Honorarios médicos:** catálogo y tarifas, servicios y aprobaciones, ficha fiscal, cierres, pagos, ajustes, Excel y PDF; incorpora la navegación vigente y la corrección que descarta respuestas de un historial fiscal cuando el usuario ya cambió de médico.
- **Auditoría de honorarios de Vertical:** nueva consulta con fechas, filtros, resumen, detalle de las 30 columnas originales, paginación y descarga del Excel completo del filtro. Las listas de médicos, grupos y orígenes se cargan al abrir la pestaña y se actualizan al cambiar las fechas, antes de consultar los registros. Excluye los códigos FAR/ALM y todos los grupos de farmacia o almacenes, incluidos sus acentos y variantes, de registros, totales, opciones y Excel. También excluye códigos SER u otros pertenecientes a esos grupos. Conserva los valores ausentes y las filas repetidas de los demás servicios; exige el permiso existente de honorarios. Consulta [el alcance de esta auditoría](auditoria-honorarios-vertical.md).
- **Resto de la plataforma:** todos los cambios actuales en tableros, reportes SAP y Vertical, asistente de reportes, revisión de cuentas, administración, permisos, avisos, inventarios, farmacia y exportaciones. Se distribuye el backend activo completo y se compila toda la aplicación del frontend.
- **Operación:** runtime incluido, dependencias con su archivo de bloqueo, esquemas SQL, preparación de estructuras de honorarios, recursos institucionales, manuales y herramientas de instalación, arranque y verificación.

Antes de regenerar el pase se detectaron el servicio y la documentación de la nueva auditoría ausentes, la ruta de honorarios distinta y cuatro entradas del frontend nuevas o modificadas. Los recursos compilados también diferían. Por ello se genera nuevamente el paquete completo y se conservan los paquetes anteriores en `tmp/pase-anterior-*`.

## Verificación de esta actualización

- Backend completo, en la revisión general previa a la exclusión FAR/ALM: **31 suites y 405 pruebas aprobadas**, sin fallos ni pruebas omitidas; incluye la consulta independiente de opciones y sus permisos.
- Exclusión de códigos y grupos de inventarios: **10 pruebas de servicio y rutas aprobadas** y **28 combinaciones ficticias comprobadas en SQL Server** con el filtro del servicio. Verifica códigos SER en almacenes/farmacia, variantes, acentos, minúsculas, plurales y grupos clínicos conservados. La consulta real de opciones de septiembre devuelve 25 grupos y **cero grupos de farmacia o almacenes**, sin modificar datos ni guardar información de pacientes.
- Lógica del frontend: **35 pruebas aprobadas**, incluida la paridad de importes entre pantalla y servidor en 1,039,896 combinaciones.
- Empaquetado e instalación: **6 pruebas aprobadas**; comprueban el inventario, los imports, las dependencias, la detección de archivos ausentes o alterados y la conservación de la configuración y el historial existentes.
- Navegador, auditoría: carga de las tres listas antes de consultar registros, eliminación de las opciones de farmacia y almacenes, actualización por fechas, reintento y periodo sin opciones; pestaña, filtros, detalle de 30 columnas, paginación, Excel completo, pantalla móvil, ausencia de resultados, errores y cancelación aprobados.
- Navegador, honorarios: estados, aprobaciones, exportaciones, SAP no disponible y búsqueda paginada con **12,796 registros ficticios** aprobados.

Los recorridos de navegador utilizan respuestas y datos ficticios; no consultan ni modifican SAP, Vertical ni los datos productivos. La comprobación real adicional se limitó a leer las opciones de grupos para verificar la exclusión de inventarios. Los logs de esta ejecución permanecen en `tmp/release-2026-10-06/` y no se distribuyen. Las demás comprobaciones de conexiones reales documentadas en revisiones anteriores no se repitieron para este empaquetado.

La preparación con `build_deploy.ps1` recompila el frontend y verifica el paquete antes y después de sustituir la carpeta del pase. La verificación final exige coincidencia con todas las fuentes actuales, imports locales y dependencias completas, y ausencia de recursos compilados faltantes. `verificar_pase.ps1` permite comprobar de nuevo la integridad de la carpeta antes de transferirla.

## Aplicación en el servidor

Sigue [README_PRODUCCION.md](../README_PRODUCCION.md): conserva el respaldo y la configuración del servidor, verifica el pase, copia su contenido completo, ejecuta `instalar.bat` y reinicia con `iniciar_produccion.bat`. Después comprueba el estado del servidor y los módulos con un usuario autorizado.

La nueva auditoría de Vertical no requiere migraciones. El script `backend/scripts/migrate-honorarios.js` sigue incluido para preparar las estructuras de BI necesarias si la instalación aún no tiene las anteriores actualizaciones de honorarios. No ejecutes los seeds ni restaures una base de desarrollo para aplicar este pase.

El paquete excluye credenciales, cargas de usuarios, dependencias locales, volcados de bases, temporales y logs. Los datos iniciales se incluyen separados y se instalan sólo cuando faltan. Esta preparación actualiza la carpeta local del pase; la instalación y la comprobación operativa en SERVIDORCALIDAD se realizan al aplicarlo allí.
