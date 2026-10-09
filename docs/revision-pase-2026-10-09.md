# Revisión del pase: análisis de reportes y consultas puntuales

Revisión local del 9 de octubre de 2026.

El asistente de Crear reporte personalizado admite condiciones por importes, intervalos, datos faltantes, agrupaciones, conteos de filas o valores distintos, sumas expresamente habilitadas y orden. Conserva el análisis durante aclaraciones y cambios de período; el backend valida cada operación contra el catálogo autorizado. No se agregaron tarjetas al selector manual de temas.

Las consultas puntuales permiten precisar cuenta o número de paciente y consultar sus estados registrados sin exigir una fecha de ingreso inventada. Una cuenta exacta puede reunir facturas, aplicaciones de cobros, saldo, alta médica, cierre y cargos o insumos. Se exige acceso a cada fuente; los estados clínicos y financieros no se sustituyen entre sí. Un nombre de paciente requiere precisar su identificador.

El resultado agregado utiliza sus propias columnas en pantalla y Excel. Las condiciones y totales se conservan en «Mis reportes», sus copias y las asignaciones. La ejecución asignada mantiene definición fija y comprueba nuevamente la autorización y la configuración después de consultar.

La revisión independiente corrigió dos límites relevantes: los indicadores de fuente incompleta se conservan hasta impedir un total parcial, y las identidades numéricas equivalentes no inflan los conteos ni duplican importes. Las sumas monetarias con moneda explícita separan esa dimensión; importes o monedas desconocidos dejan el total sin información. No se suman saldos de cabecera repetidos por cargo/convenio ni saldos del pagador enriquecido.

Validación local:

- **696 pruebas aprobadas en 36 suites** de reportes, Mar-IA, fuentes, permisos, asignaciones y arranque productivo. Evidencia: `tmp/report-analytics-final-backend-20261009.log`.
- **Tres integraciones de navegador aprobadas:** asistente, constructor manual y Mar-IA. Incluyen 120 grupos, paginación, Excel completo, guardado/copia/asignados, cambios de configuración y bloqueo de exportación tras fallo, monedas canónicas y consultas exactas con fechas opcionales.
- **PostgreSQL aislado aprobado:** análisis JSONB, columnas de medidas, cambios de definición y revocación. Se eliminó el esquema de prueba. Evidencia: `tmp/assistant-analysis-integration-20261009.log`.
- **ESLint sin errores** en los servicios y pantallas revisados; permanecen advertencias conocidas del proyecto.

Se utilizaron datos hospitalarios sintéticos y adaptadores simulados. Estas pruebas no certifican facturas o pagos de una cuenta real ni una instalación remota. Los detalles y ejemplos están en [Análisis y consultas de cuentas](asistente-analisis-y-casos-2026-10-09.md).

El pase se regenera íntegro con `build_deploy.ps1`, conserva el anterior bajo `tmp/pase-anterior-*`, y se verifica con `pase_a_produccion/verificar_pase.ps1` y `production-package.cjs verify pase_a_produccion --source`. Incluye también la recuperación de archivos iniciales de estadísticas ausentes que impedían el arranque, sin reemplazar históricos existentes. Consultar [la revisión del 8 de octubre](revision-pase-2026-10-08.md).

## Revisión posterior de preparación del pase

El contraste del paquete previo con las fuentes actuales detectó el nuevo servicio de reapertura de cuentas ausente, ambos documentos del mapa ausentes y cambios posteriores de backend y frontend. Por ello ese paquete, aunque conservaba sus hashes internos, no estaba listo para transferir. La actualización debe distribuir el frontend recompilado y todo el backend actual, incluido `accountReopening.service.js`.

Se corrigió el filtro del empaquetador para excluir `tmp` y `temp` a cualquier profundidad: el pase anterior incluía 105 archivos temporales de caché y resultados de pruebas. Los archivos de trabajo se conservan en el proyecto; sólo se excluyen de la distribución. Se actualizan los instructivos del pase y los apartados del mapa sobre revisión y reapertura de cuentas, permisos, acciones e inventario HTTP, con la misma fecha de corte del 9 de octubre de 2026 en Markdown y PDF.

Validación de esta revisión:

- **174 pruebas de backend aprobadas en 9 suites**, sobre referencias iniciales, runtime, instancia, conflicto de puerto, salud, revisión SAP y preparación/ejecución de reapertura. Las operaciones de cuentas utilizan adaptadores simulados y respaldos temporales. Evidencia: `tmp/pase-readiness-backend-tests-20261009.log`.
- **8 pruebas de empaquetado aprobadas**, incluida la exclusión de temporales y la conservación de configuración e históricos existentes. Evidencia: `tmp/pase-readiness-package-tests-20261009.log`.
- **Integración de navegador de reapertura aprobada**, con los permisos vigentes y comprobación del RBAC real, confirmación, caducidad, conflictos, resultado incierto y recuperación por consulta, móvil y tema oscuro. Todas sus API utilizan datos ficticios. Evidencia: `tmp/pase-readiness-reapertura-browser-20261009.log` y `tmp/account-review/`.

La entrega se prepara con `build_deploy.ps1` y se comprueba mediante los dos verificadores indicados arriba, incluido el contraste `--source`. La instalación requiere npm en el servidor y las conexiones y permisos de base correspondientes. La cuenta de Windows que ejecuta la reapertura debe poder guardar y verificar el respaldo en la carpeta configurada. Un `/health` correcto no acredita por sí solo SAP, Vertical, SITI ni todas las funciones de DW o ML.

Hay un requisito operativo pendiente en la inspección de Vertical documentada el 9 de octubre: la conexión no tenía `VIEW DEFINITION`. El servicio bloquea la reapertura si no puede verificar completamente los metadatos y las relaciones. Esa autorización corresponde al responsable de la base; ni las pruebas simuladas ni la regeneración del pase prueban que ya esté concedida en producción.

Para instalarlo en SERVIDORCALIDAD, copiar el pase completo, ejecutar `instalar.bat`, reiniciar `iniciar_produccion.bat` y recargar con Ctrl+F5. La preparación y verificación local no aplican cambios al servidor.
