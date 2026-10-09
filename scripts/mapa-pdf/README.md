# Exportación reproducible del mapa de la plataforma

El generador lee directamente el Markdown vigente. No utiliza los fragmentos históricos de `outputs/` ni modifica el documento fuente. Produce un candidato PDF, sus tokens de Markdown y un informe de cobertura; el PDF de consulta sólo debe reemplazarse después de revisar el informe y las páginas renderizadas.

```powershell
node scripts/mapa-pdf/generate.mjs --source docs/Mapa_Instructivo_Plataforma_y_Origen_Datos.md --output tmp/pdfs/mapa-2026-10-09/updated-map.pdf
```

Dependencias: Node.js con `marked`; Python con `reportlab` y `pypdf`. Se descubre primero la dependencia del proyecto y después el runtime de escritorio ubicado bajo el directorio personal. Pueden indicarse rutas con `MAPA_PDF_MARKED`, `MAPA_PDF_PYTHON`, `CODEX_PRIMARY_RUNTIME`, `CODEX_RUNTIME_NODE_MODULES` y `CODEX_RUNTIME_PYTHON`. `MAPA_PDF_FONT_DIR` permite indicar otra carpeta de fuentes; en Windows se utiliza la carpeta Fonts del sistema. La presentación, fecha de corte y nombres de fuentes se conservan en `config.json`.

La exportación utiliza tamaño Carta, márgenes de 42 puntos y texto Arial legible. Conserva todos los encabezados, párrafos, listas, tablas, bloques de código, referencias y anexos. El índice original mantiene sus enlaces internos; cada encabezado dispone de marcador de navegación. Las tablas con cinco o más columnas se convierten en fichas por fila con todas las etiquetas y valores, para evitar columnas diminutas o texto recortado.

El informe `updated-map.qa.json` incluye huella del Markdown, inventario de encabezados y sus páginas, los 696 IDs del catálogo con su página, enlaces y anclas, cobertura de cada segmento de texto, versiones de las bibliotecas, fuentes y caracteres faltantes. Comprueba también que los destinos internos del PDF existen y que el número de marcadores coincide con los encabezados. Una diferencia de cobertura, un tipo de token no soportado o un carácter sin fuente produce una comprobación fallida. Las filas de las tablas normales se conservan enteras entre páginas; las fichas de los catálogos permiten que los párrafos largos continúen en la siguiente.

La cobertura automática no sustituye la revisión visual. Renderizar y revisar la portada, el índice, las páginas de los apartados modificados, una ficha extensa y los anexos finales antes de reemplazar el documento de consulta. Sus páginas se encuentran en `headingPages` y `catalogPages` del informe.

Como control adicional, `check-layout.py` utiliza `pdfplumber` para comprobar los límites de cada carácter en todas las páginas y guardar un reporte, sin modificar el PDF:

```powershell
python scripts/mapa-pdf/check-layout.py --pdf tmp/pdfs/mapa-2026-10-09/updated-map.pdf --output tmp/pdfs/mapa-2026-10-09/layout-qa.json
```

Este control detecta texto fuera del área de página; la revisión visual sigue siendo necesaria para detectar superposiciones o una distribución poco legible.

Si el Markdown cambia durante la generación, el comando termina con código 2 y debe repetirse. La fecha de corte se comprueba contra el Markdown. Para inspeccionar los tokens sin exportar: `--tokens-only true`.
