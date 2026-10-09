# Instrucciones del proyecto

## Mantener vigente el mapa de la plataforma

Por instrucción del usuario del 9 de octubre de 2026, cada incorporación o cambio en la plataforma debe incluir la revisión y actualización de su mapa e instructivo:

- Fuente editable: `docs/Mapa_Instructivo_Plataforma_y_Origen_Datos.md`.
- Documento de consulta: `docs/Mapa_Plataforma_Hospital_Escandon_BI.pdf`.

Antes de dar por terminado un cambio:

1. Revisar todos los apartados afectados: módulos, submódulos, pestañas, tableros, KPI, filtros, acciones, descargas, permisos, asistentes y catálogos de reportes. Incluir también funciones declaradas, configurables o sin pantalla montada; indicar su estado.
2. Actualizar el Markdown con la información que se puede consultar, los pasos de uso, las fórmulas y la procedencia precisa en Vertical, SAP, SITI o la gestión interna BI. Ajustar referencias, inventarios, conteos y fecha de corte según el código vigente. No omitir apartados ni atribuir fuentes sin evidencia.
3. Regenerar el PDF desde el Markdown actualizado en la misma ruta y con el mismo nombre. Conservar una presentación legible, el índice y la cobertura completa, incluidos los anexos. Las modificaciones locales de ambos documentos forman parte del trabajo autorizado de mantenimiento.
4. Comprobar que el PDF abre, que contiene las secciones modificadas y los anexos finales, y revisar visualmente las páginas afectadas para detectar tablas o texto recortados. Mantener la misma fecha de corte en ambos documentos.
5. Informar qué apartados se actualizaron. Si la generación o verificación del PDF queda bloqueada, explicarlo; no presentar el PDF anterior como actualizado.

Los fragmentos y ensambladores de `outputs/mapa-plataforma-2026-10-09/` corresponden al inventario inicial. Si se reutilizan, actualizar primero los fragmentos y las expectativas de cobertura; no sobrescribir documentación vigente con contenido o conteos antiguos.

El PDF entregado inicialmente fue exportado con Pandoc/LaTeX, pero su plantilla y comando de exportación no están guardados en el repositorio. Al establecer un generador reproducible, conservar su código y configuración en el proyecto, y verificar contenido y presentación antes de reemplazar el PDF. No modificar el PDF sólo para cambiar su fecha cuando no hay cambios documentales.
