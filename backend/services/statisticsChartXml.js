'use strict';

const path = require('node:path').posix;
const JSZip = require('jszip');

const NS = {
  relationships: 'http://schemas.openxmlformats.org/package/2006/relationships',
  officeRelationships: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  drawing: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  main: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  chart: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
};
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL_TYPE = `${NS.officeRelationships}/`;
const CHART_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const DRAWING_TYPE = 'application/vnd.openxmlformats-officedocument.drawing+xml';

function xml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

function unxml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === '#') return String.fromCodePoint(parseInt(entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1), entity[1].toLowerCase() === 'x' ? 16 : 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()];
  });
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/gs)].map(match => [match[1], unxml(match[3])]));
}

// Only insert new OOXML nodes. Existing worksheet/drawing metadata is retained,
// including namespaces, hyperlinks, print settings, images and extensions.
function structure(source) {
  if (/<!DOCTYPE/i.test(source)) throw new Error('OOXML con DTD no admitido.');
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?([A-Za-z_][\w:.-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  const stack = [], children = [];
  let root = null, closingIndex = -1;
  for (const match of source.matchAll(tokens)) {
    if (!match[1]) continue;
    const tag = match[0], name = match[1], closing = tag.startsWith('</'), selfClosing = /\/\s*>$/.test(tag);
    if (closing) {
      if (stack.pop() !== name) throw new Error('Estructura XML incompatible.');
      if (!stack.length) closingIndex = match.index;
      continue;
    }
    if (!stack.length) {
      if (root) throw new Error('XML con más de una raíz.');
      root = { name, tag, index: match.index, end: match.index + tag.length, selfClosing };
    } else if (stack.length === 1) children.push({ name, localName: name.split(':').pop(), tag, index: match.index });
    if (!selfClosing) stack.push(name);
  }
  if (!root || stack.length || (!root.selfClosing && closingIndex < 0)) throw new Error('Parte XML incompleta.');
  return { root, children, closingIndex };
}

function append(source, fragment, before = []) {
  const doc = structure(source);
  if (doc.root.selfClosing) return source.slice(0, doc.root.end - 2) + '>' + fragment + `</${doc.root.name}>` + source.slice(doc.root.end);
  const next = doc.children.find(child => before.includes(child.localName));
  const index = next ? next.index : doc.closingIndex;
  return source.slice(0, index) + fragment + source.slice(index);
}

function leaf(source, name, values) {
  const rootName = structure(source).root.name;
  const prefix = rootName.includes(':') ? rootName.slice(0, rootName.indexOf(':') + 1) : '';
  return `<${prefix}${name} ${Object.entries(values).map(([key, value]) => `${key}="${xml(value)}"`).join(' ')}/>`;
}

function relationships(source) {
  const rows = structure(source).children.filter(child => child.localName === 'Relationship').map(child => attributes(child.tag));
  if (new Set(rows.map(row => row.Id)).size !== rows.length) throw new Error('Relaciones OOXML con identificadores duplicados.');
  return rows;
}

function nextRelationshipId(source) {
  const used = new Set(relationships(source).map(row => row.Id));
  let index = 1;
  while (used.has(`rId${index}`)) index += 1;
  return `rId${index}`;
}

function newRelationships() {
  return `${XML_HEADER}<Relationships xmlns="${NS.relationships}"></Relationships>`;
}

function relPath(part) { return path.join(path.dirname(part), '_rels', path.basename(part) + '.rels'); }

function targetPath(part, relationship) {
  if (relationship.TargetMode === 'External' || !relationship.Target || /[\\?#]/.test(relationship.Target)) throw new Error('La relación de hoja o dibujo debe ser interna.');
  const target = path.normalize(relationship.Target.startsWith('/') ? relationship.Target.slice(1) : path.join(path.dirname(part), relationship.Target));
  if (target.startsWith('../')) throw new Error('Relación fuera del paquete Excel.');
  return target;
}

function columnNumber(column) {
  return [...column].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

function formula(reference) {
  if (typeof reference !== 'string' || /[\[\]\r\n]/.test(reference)) throw new Error('El gráfico requiere una referencia interna de celdas.');
  const match = reference.replace(/^=/, '').match(/^('(?:[^']|'')+'|[^'!]+)!\$?([A-Z]{1,3})\$?([1-9]\d*):\$?([A-Z]{1,3})\$?([1-9]\d*)$/i);
  if (!match) throw new Error('La referencia del gráfico debe ser un rango de doce celdas.');
  const [, sheet, startColumn, startRow, endColumn, endRow] = match;
  const cols = [columnNumber(startColumn.toUpperCase()), columnNumber(endColumn.toUpperCase())];
  const rows = [Number(startRow), Number(endRow)];
  if (cols.some(col => col > 16384) || rows.some(row => row > 1048576) ||
      !((cols[0] === cols[1] && rows[1] - rows[0] === 11) || (rows[0] === rows[1] && cols[1] - cols[0] === 11))) {
    throw new Error('La referencia del gráfico debe cubrir doce meses consecutivos.');
  }
  return `${sheet}!$${startColumn.toUpperCase()}$${startRow}:$${endColumn.toUpperCase()}$${endRow}`;
}

function validateChart(chart) {
  if (!chart || !Number.isInteger(chart.sheetIndex) || chart.sheetIndex < 1) throw new Error('sheetIndex debe ser un índice de hoja basado en uno.');
  if (!Array.isArray(chart.categoryValues) || chart.categoryValues.length !== 12 || chart.categoryValues.some(value => typeof value !== 'string')) throw new Error('El gráfico necesita doce nombres de mes.');
  if (!Array.isArray(chart.series) || !chart.series.length) throw new Error('El gráfico necesita al menos una serie.');
  formula(chart.categoriesFormula);
  for (const series of chart.series) {
    if (!series || typeof series.name !== 'string' || !series.name.trim() || !Array.isArray(series.values) || series.values.length !== 12 ||
        series.values.some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('Cada serie necesita doce números o valores nulos.');
    if (typeof series.color !== 'string' || !/^#?[0-9a-f]{6}$/i.test(series.color)) throw new Error('Color de serie hexadecimal inválido.');
    formula(series.formula);
  }
  const { from, to } = chart.anchor || {};
  if (![from, to].every(point => point && Number.isInteger(point.col) && Number.isInteger(point.row) && point.col >= 0 && point.col <= 16383 && point.row >= 0 && point.row <= 1048575) || to.col <= from.col || to.row <= from.row) throw new Error('El gráfico necesita un anclaje rectangular de celdas basado en cero.');
}

function richText(text, size = 1000) {
  const textColor = '<a:solidFill><a:srgbClr val="475569"/></a:solidFill>';
  return `<a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}">${textColor}<a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:r><a:rPr lang="es-MX" sz="${size}">${textColor}<a:latin typeface="Calibri"/></a:rPr><a:t>${xml(text)}</a:t></a:r><a:endParaRPr lang="es-MX"/></a:p>`;
}

function title(text, size = 1200) {
  return `<c:title><c:tx><c:rich>${richText(text, size)}</c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function chartXml(chart, chartIndex) {
  const categoryId = 100000 + chartIndex * 2, valueId = categoryId + 1;
  const money = String(chart.unit).trim().toUpperCase() === 'MXN';
  const numberFormat = money ? '#,##0" MXN"' : '#,##0';
  const years = chart.series.map(series => /^\d{4}$/.test(series.name) ? Number(series.name) : null);
  const latest = years.some(year => year !== null) ? years.lastIndexOf(Math.max(...years.filter(year => year !== null))) : chart.series.length - 1;
  const categories = `<c:strRef><c:f>${xml(formula(chart.categoriesFormula))}</c:f><c:strCache><c:ptCount val="12"/>${chart.categoryValues.map((value, index) => `<c:pt idx="${index}"><c:v>${xml(value)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`;
  const series = chart.series.map((item, index) => {
    const color = item.color.replace(/^#/, '').toUpperCase();
    // The cache keeps twelve slots but omits unavailable points. A real zero
    // stays an explicit point; Excel can edit/recalculate the linked cells.
    const points = item.values.map((value, slot) => value === null ? '' : `<c:pt idx="${slot}"><c:v>${Object.is(value, -0) ? 0 : value}</c:v></c:pt>`).join('');
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xml(item.name)}</c:v></c:tx><c:spPr><a:ln w="${index === latest ? 31750 : 19050}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:prstDash val="solid"/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="${index === latest ? 5 : 4}"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr></c:marker><c:cat>${categories}</c:cat><c:val><c:numRef><c:f>${xml(formula(item.formula))}</c:f><c:numCache><c:formatCode>${money ? '#,##0.00' : '#,##0.########'}</c:formatCode><c:ptCount val="12"/>${points}</c:numCache></c:numRef></c:val><c:smooth val="0"/></c:ser>`;
  }).join('');
  const textStyle = `<c:txPr>${richText('', 1000)}</c:txPr>`;
  const axisLine = '<c:spPr><a:ln><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln></c:spPr>';
  const axes = `<c:catAx><c:axId val="${categoryId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisLine}${textStyle}<c:crossAx val="${valueId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="1"/></c:catAx><c:valAx><c:axId val="${valueId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>${chart.unit ? title(chart.unit, 1000) : ''}<c:numFmt formatCode="${xml(numberFormat)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisLine}${textStyle}<c:crossAx val="${categoryId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const legend = chart.legend === true ? `<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/>${textStyle}</c:legend>` : '';
  return `${XML_HEADER}<c:chartSpace xmlns:c="${NS.chart}" xmlns:a="${NS.main}" xmlns:r="${NS.officeRelationships}"><c:date1904 val="0"/><c:lang val="es-MX"/><c:roundedCorners val="0"/><c:chart>${title(chart.title || '')}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:smooth val="0"/><c:axId val="${categoryId}"/><c:axId val="${valueId}"/></c:lineChart>${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`;
}

function anchorXml(chart, relationshipId, shapeId) {
  const marker = (name, point) => `<xdr:${name}><xdr:col>${point.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${point.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${name}>`;
  return `<xdr:twoCellAnchor xmlns:xdr="${NS.drawing}" xmlns:a="${NS.main}" editAs="oneCell">${marker('from', chart.anchor.from)}${marker('to', chart.anchor.to)}<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${shapeId}" name="${xml(chart.title || `Gráfico ${shapeId}`)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS.chart}"><c:chart xmlns:c="${NS.chart}" xmlns:r="${NS.officeRelationships}" r:id="${relationshipId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

/** Attach native editable line charts to an ExcelJS XLSX buffer.
 * Worksheet indexes are one-based; anchor column/row indexes are zero-based.
 * Source values remain in cells; this helper never writes cells or a chart table.
 */
async function attachLineCharts(buffer, charts) {
  if (!Array.isArray(charts)) throw new Error('Se requiere una lista de gráficos.');
  if (!charts.length) return Buffer.from(buffer);
  charts.forEach(validateChart);
  const zip = await JSZip.loadAsync(buffer);
  async function read(part) {
    const entry = zip.file(part);
    if (!entry) throw new Error(`Falta la parte OOXML ${part}.`);
    return entry.async('string');
  }
  const workbookPart = 'xl/workbook.xml';
  const workbook = await read(workbookPart), workbookRels = relationships(await read(relPath(workbookPart)));
  const sheets = structure(workbook).children.find(child => child.localName === 'sheets');
  if (!sheets) throw new Error('El libro no contiene hojas.');
  const sheetTags = [...workbook.slice(sheets.index).matchAll(/<(?:\w+:)?sheet\s+(?:[^>"']|"[^"]*"|'[^']*')*\/?\s*>/g)].map(match => attributes(match[0]));
  let types = await read('[Content_Types].xml');
  function addContentType(part, contentType) {
    const override = structure(types).children.filter(child => child.localName === 'Override').map(child => attributes(child.tag)).filter(row => row.PartName === '/' + part);
    if (override.length > 1 || override.some(row => row.ContentType !== contentType)) throw new Error('Tipo de parte OOXML en conflicto.');
    if (!override.length) types = append(types, leaf(types, 'Override', { PartName: '/' + part, ContentType: contentType }));
  }
  function unusedPart(directory, base) {
    let index = 1;
    while (zip.file(`${directory}/${base}${index}.xml`) || zip.file(relPath(`${directory}/${base}${index}.xml`))) index += 1;
    return { part: `${directory}/${base}${index}.xml`, index };
  }
  const drawings = new Map();
  for (const chart of charts) {
    const sheet = sheetTags[chart.sheetIndex - 1];
    if (!sheet) throw new Error(`No existe la hoja ${chart.sheetIndex}.`);
    const relation = workbookRels.find(row => row.Id === sheet['r:id']);
    if (!relation || relation.Type !== REL_TYPE + 'worksheet') throw new Error('El destino del gráfico debe ser una hoja de celdas.');
    const sheetPart = targetPath(workbookPart, relation);
    let drawing = drawings.get(sheetPart);
    if (!drawing) {
      let worksheet = await read(sheetPart);
      let sheetRels = zip.file(relPath(sheetPart)) ? await read(relPath(sheetPart)) : newRelationships();
      const existing = structure(worksheet).children.filter(child => child.localName === 'drawing');
      if (existing.length > 1) throw new Error('La hoja contiene más de un dibujo principal.');
      let drawingPart;
      if (existing.length) {
        const id = attributes(existing[0].tag)['r:id'];
        const drawingRelation = relationships(sheetRels).find(row => row.Id === id);
        if (!drawingRelation || drawingRelation.Type !== REL_TYPE + 'drawing') throw new Error('Dibujo sin relación interna válida.');
        drawingPart = targetPath(sheetPart, drawingRelation);
      } else {
        drawingPart = unusedPart('xl/drawings', 'drawing').part;
        const id = nextRelationshipId(sheetRels);
        sheetRels = append(sheetRels, leaf(sheetRels, 'Relationship', { Id: id, Type: REL_TYPE + 'drawing', Target: path.relative(path.dirname(sheetPart), drawingPart) }));
        worksheet = append(worksheet, leaf(worksheet, 'drawing', { 'xmlns:r': NS.officeRelationships, 'r:id': id }), ['legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst']);
        zip.file(sheetPart, worksheet);
        zip.file(relPath(sheetPart), sheetRels);
        zip.file(drawingPart, `${XML_HEADER}<xdr:wsDr xmlns:xdr="${NS.drawing}" xmlns:a="${NS.main}"></xdr:wsDr>`);
      }
      drawing = { part: drawingPart, xml: await read(drawingPart), rels: zip.file(relPath(drawingPart)) ? await read(relPath(drawingPart)) : newRelationships() };
      drawings.set(sheetPart, drawing);
      addContentType(drawingPart, DRAWING_TYPE);
    }
    const chartPart = unusedPart('xl/charts', 'chart');
    const id = nextRelationshipId(drawing.rels);
    drawing.rels = append(drawing.rels, leaf(drawing.rels, 'Relationship', { Id: id, Type: REL_TYPE + 'chart', Target: path.relative(path.dirname(drawing.part), chartPart.part) }));
    const shapeIds = [...drawing.xml.matchAll(/<(?:\w+:)?cNvPr\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)].map(match => Number(attributes(match[0]).id));
    const shapeId = Math.max(0, ...shapeIds.filter(Number.isFinite)) + 1;
    drawing.xml = append(drawing.xml, anchorXml(chart, id, shapeId), ['extLst']);
    zip.file(chartPart.part, chartXml(chart, chartPart.index));
    zip.file(drawing.part, drawing.xml);
    zip.file(relPath(drawing.part), drawing.rels);
    addContentType(chartPart.part, CHART_TYPE);
  }
  zip.file('[Content_Types].xml', types);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

module.exports = { attachLineCharts };
