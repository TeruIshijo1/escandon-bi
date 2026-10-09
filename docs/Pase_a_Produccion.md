# Pase a producción

El procedimiento vigente está en [README_PRODUCCION.md](../README_PRODUCCION.md). La revisión actual está en [revision-pase-2026-10-09.md](revision-pase-2026-10-09.md), con la revisión general en [revision-pase-2026-10-08.md](revision-pase-2026-10-08.md). Incluye todos los cambios actuales de frontend y backend; la evidencia anterior de estadísticos y su Excel completo está en [revision-pase-final-2026-10-07.md](revision-pase-final-2026-10-07.md).

En desarrollo, `build_deploy.ps1` recompila el frontend y prepara `pase_a_produccion` con todo el backend activo, el runtime, esquemas, recursos y documentación, incluido el mapa e instructivo en Markdown y PDF. Conserva el pase anterior y comprueba el paquete con hashes y referencias de ejecución. Excluye las carpetas temporales `tmp` y `temp`, también cuando están anidadas dentro del backend.

Dentro del pase, `verificar_pase.ps1` comprueba su integridad antes de transferirlo. `instalar.bat` instala dependencias del backend sin reemplazar la configuración ni restaurar bases. `iniciar_produccion.bat` sirve API y frontend en el puerto 5173.
