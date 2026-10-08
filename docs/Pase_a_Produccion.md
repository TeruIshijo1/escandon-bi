# Pase a producción

El procedimiento vigente está en [README_PRODUCCION.md](../README_PRODUCCION.md). La revisión final está en [revision-pase-final-2026-10-07.md](revision-pase-final-2026-10-07.md). Incluye todos los cambios actuales, los estadísticos mensuales y su Excel completo, además de [las modificaciones de honorarios, reportes y tableros ya revisadas](revision-pase-2026-10-07.md).

En desarrollo, `build_deploy.ps1` recompila el frontend y prepara `pase_a_produccion` con todo el backend activo, el runtime, esquemas, recursos y documentación. Conserva el pase anterior y comprueba el paquete con hashes y referencias de ejecución.

Dentro del pase, `verificar_pase.ps1` comprueba su integridad antes de transferirlo. `instalar.bat` instala dependencias del backend sin reemplazar la configuración ni restaurar bases. `iniciar_produccion.bat` sirve API y frontend en el puerto 5173.
