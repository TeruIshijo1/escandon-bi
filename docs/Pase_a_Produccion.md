# Pase a producción

El procedimiento vigente está en [README_PRODUCCION.md](../README_PRODUCCION.md), que resume el estado actual de frontend y backend.

En desarrollo, `build_deploy.ps1` recompila el frontend y prepara `pase_a_produccion` con el backend activo, el runtime, esquemas, recursos y documentación operativa vigente. El pase conserva el mapa editable en Markdown, pero no incluye el PDF de consulta, revisiones históricas, evidencias ni borradores. El proceso conserva el pase anterior y comprueba hashes y referencias de ejecución.

Dentro del pase, `verificar_pase.ps1` comprueba su integridad antes de transferirlo. `instalar.bat` instala dependencias del backend sin reemplazar la configuración ni restaurar bases. `iniciar_produccion.bat` sirve API y frontend en el puerto 5173.
