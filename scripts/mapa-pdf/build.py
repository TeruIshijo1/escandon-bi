"""Render the current complete Markdown token tree; fail on lost content."""
import argparse
import hashlib
import html
import importlib.metadata
import json
import os
import re
from pathlib import Path
from collections import Counter

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, LongTable, TableStyle, Flowable
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('--tokens', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--config', required=True)
args = parser.parse_args()
payload = json.loads(Path(args.tokens).read_text(encoding='utf-8'))
config = json.loads(Path(args.config).read_text(encoding='utf-8'))
if config['pageSize'] != 'LETTER':
    raise RuntimeError('El generador requiere pageSize LETTER.')
output = Path(args.output)
page_width, page_height = letter
margin = config['marginPoints']
width = page_width - 2 * margin
navy, teal, text_color = (colors.HexColor(config[key]) for key in ['navy', 'teal', 'text'])

font_directory = Path(os.environ.get('MAPA_PDF_FONT_DIR') or Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts')
font_names = {'regular': 'MapArial', 'bold': 'MapArialBold', 'italic': 'MapArialItalic',
              'boldItalic': 'MapArialBoldItalic', 'mono': 'MapConsolas', 'unicode': 'MapUnicode'}
font_paths = {}
font_glyphs = {}
for role, filename in config['fonts'].items():
    file = font_directory / filename
    if not file.exists():
        raise RuntimeError(f'Falta la fuente {filename}; configura MAPA_PDF_FONT_DIR.')
    name = font_names[role]
    pdfmetrics.registerFont(TTFont(name, str(file)))
    font_paths[role] = str(file)
    font_glyphs[name] = {code for code, glyph in pdfmetrics.getFont(name).face.charToGlyph.items() if glyph}
pdfmetrics.registerFontFamily(font_names['regular'], normal=font_names['regular'], bold=font_names['bold'],
                            italic=font_names['italic'], boldItalic=font_names['boldItalic'])

body = ParagraphStyle('body', fontName=font_names['regular'], fontSize=config['bodyFontSize'],
                      leading=config['bodyLeading'], textColor=text_color, spaceAfter=7, splitLongWords=True,
                      allowWidows=False, allowOrphans=False)
table_body = ParagraphStyle('table_body', parent=body, fontSize=config['tableFontSize'],
                            leading=config['tableLeading'], spaceAfter=2)
table_head = ParagraphStyle('table_head', parent=table_body, fontName=font_names['bold'], textColor=navy)
code_style = ParagraphStyle('code', parent=body, fontName=font_names['mono'], fontSize=9.1, leading=12.2,
                            backColor=colors.HexColor('#f3f6f7'), borderPadding=7, spaceBefore=4, spaceAfter=9)
label_style = ParagraphStyle('label', parent=body, fontName=font_names['bold'], textColor=navy,
                             spaceAfter=3, keepWithNext=True)
headings = {
    1: ParagraphStyle('h1', parent=body, fontName=font_names['bold'], fontSize=21, leading=26, textColor=navy,
                      spaceBefore=7, spaceAfter=15, keepWithNext=True),
    2: ParagraphStyle('h2', parent=body, fontName=font_names['bold'], fontSize=15.6, leading=20, textColor=navy,
                      spaceBefore=15, spaceAfter=9, keepWithNext=True),
    3: ParagraphStyle('h3', parent=body, fontName=font_names['bold'], fontSize=12.3, leading=16, textColor=navy,
                      spaceBefore=11, spaceAfter=6, keepWithNext=True),
    4: ParagraphStyle('h4', parent=body, fontName=font_names['bold'], fontSize=10.9, leading=14.5, textColor=navy,
                      spaceBefore=9, spaceAfter=5, keepWithNext=True),
}
segments = []
heading_registry = []
anchors_seen = []
link_registry = []
unsupported_tokens = Counter()
unsupported_characters = Counter()
font_fallbacks = Counter()
table_registry = []
catalog_registry = []
pending_anchors = []

def normalize(value):
    # Typographic hyphens are normalized consistently in rendering and QA.
    return str(value).translate(str.maketrans({'\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-',
                                             '\u00a0': ' ', '\u200b': '', '\ufeff': ''}))

def styled_text(value, font=None):
    font = font or font_names['regular']
    result = []
    current_font, run = None, []
    for character in normalize(html.unescape(str(value))):
        code = ord(character)
        if character in '\n\r\t':
            selected = font
        elif code in font_glyphs[font]:
            selected = font
        elif code in font_glyphs[font_names['unicode']]:
            selected = font_names['unicode']
            font_fallbacks[character] += 1
        else:
            unsupported_characters[character] += 1
            selected = font
        if selected != current_font and run:
            escaped = html.escape(''.join(run), quote=False).replace('\n', '<br/>').replace('\r', '').replace('\t', '    ')
            result.append(f'<font name="{current_font}">{escaped}</font>')
            run = []
        current_font = selected
        run.append(character)
    if run:
        escaped = html.escape(''.join(run), quote=False).replace('\n', '<br/>').replace('\r', '').replace('\t', '    ')
        result.append(f'<font name="{current_font}">{escaped}</font>')
    return ''.join(result)

def inline(tokens, font=None):
    font = font or font_names['regular']
    markup, plain = [], []
    for token in tokens or []:
        kind = token['type']
        if kind in ('text', 'escape'):
            if token.get('tokens'):
                formatted, text = inline(token['tokens'], font)
            else:
                text = normalize(html.unescape(token.get('text', '')))
                formatted = styled_text(text, font)
        elif kind == 'codespan':
            text = normalize(html.unescape(token.get('text', '')))
            formatted = f'<font size="9.1">{styled_text(text, font_names["mono"])}</font>'
        elif kind in ('strong', 'em', 'del'):
            selected_font = font_names['bold'] if kind == 'strong' else font_names['italic'] if kind == 'em' else font
            formatted, text = inline(token.get('tokens', []), selected_font)
            if kind == 'del':
                formatted = f'<strike>{formatted}</strike>'
        elif kind == 'link':
            formatted, text = inline(token.get('tokens', []), font)
            href = html.unescape(token.get('href', ''))
            if href.startswith('#') or href.startswith(('http://', 'https://', 'mailto:')):
                formatted = f'<link href="{html.escape(href, quote=True)}" color="#00767c">{formatted}</link>'
                link_registry.append(href)
        elif kind == 'br':
            formatted, text = '<br/>', '\n'
        elif kind == 'html':
            raw = token.get('raw', token.get('text', ''))
            ids = re.findall(r'<a\s+id=[\"\']([^\"\']+)', raw)
            pending_anchors.extend(ids)
            if re.fullmatch(r'\s*</?a\b[^>]*>\s*', raw):
                formatted, text = '', ''
            elif re.fullmatch(r'\s*<br\s*/?>\s*', raw):
                formatted, text = '<br/>', '\n'
            else:
                # Preserve visible text of other inline HTML; anchors are not prose.
                text = normalize(html.unescape(re.sub(r'<[^>]*>', '', raw)))
                formatted = styled_text(text, font)
        elif kind == 'checkbox':
            text = '[x] ' if token.get('checked') else '[ ] '
            formatted = styled_text(text, font)
        else:
            unsupported_tokens[f'inline:{kind}'] += 1
            text = normalize(token.get('text', token.get('raw', '')))
            formatted = styled_text(text, font)
        markup.append(formatted)
        plain.append(text)
    return ''.join(markup), ''.join(plain)

def paragraph(markup, plain, style=body, category='paragraph'):
    if plain.strip():
        segments.append({'type': category, 'text': plain})
    return Paragraph(markup or '&#160;', style)

class Cover(Flowable):
    def __init__(self):
        super().__init__()
        self.width, self.height = width, page_height - 2 * margin - 2
    def draw(self):
        canvas = self.canv
        canvas.setStrokeColor(teal)
        canvas.setLineWidth(.8)
        canvas.line(0, self.height - 83, width, self.height - 83)
        canvas.setFillColor(navy)
        canvas.setFont(font_names['bold'], 12.3)
        canvas.drawString(0, self.height - 136, 'PLATAFORMA HOSPITAL ESCANDÓN BI')
        canvas.setFillColor(colors.black)
        canvas.setFont(font_names['bold'], 27)
        canvas.drawString(0, self.height - 222, 'Mapa e instructivo')
        canvas.setFont(font_names['regular'], 16)
        canvas.drawString(0, self.height - 259, 'de la plataforma y el origen de sus datos')
        canvas.setFont(font_names['regular'], 12)
        canvas.drawString(0, self.height - 316, 'Guía de consulta funcional y técnica')
        canvas.drawString(0, 153, f'Fecha de corte: {config["cutoffDate"]}')
        canvas.line(0, 105, width, 105)
        footer = Paragraph(styled_text('Documento orientado a facilitar la navegación, la lectura de indicadores y el rastreo de las fuentes de información.'),
                           ParagraphStyle('cover_footer', parent=body, fontSize=9.5, leading=13))
        footer.wrap(width, 80)
        footer.drawOn(canvas, 0, 40)

class MapDocument(SimpleDocTemplate):
    def __init__(self, *values, **options):
        super().__init__(*values, **options)
        self.heading_pages = []
        self.catalog_pages = []
        self.previous_outline_level = -1
    def afterFlowable(self, flowable):
        catalog = getattr(flowable, '_map_catalog', None)
        if catalog:
            self.catalog_pages.append({**catalog, 'page': self.page})
        info = getattr(flowable, '_map_heading', None)
        if not info:
            return
        for destination in info['anchors']:
            self.canv.bookmarkPage(destination)
        level = min(max(info['depth'] - 2, 0), self.previous_outline_level + 1)
        self.canv.addOutlineEntry(info['title'], info['anchors'][0], level=level, closed=level > 1)
        self.previous_outline_level = level
        self.heading_pages.append({**info, 'page': self.page})

def decorate(canvas, document):
    if document.page == 1:
        return
    canvas.saveState()
    canvas.setFont(font_names['regular'], 8.1)
    canvas.setFillColor(navy)
    canvas.drawString(margin, page_height - 27, config['runningTitle'])
    canvas.setStrokeColor(colors.HexColor('#d5e1e5'))
    canvas.setLineWidth(.45)
    canvas.line(margin, page_height - 32, page_width - margin, page_height - 32)
    canvas.line(margin, 32, page_width - margin, 32)
    canvas.setFillColor(colors.HexColor('#53656e'))
    canvas.drawString(margin, 21, f'Fecha de corte: {config["cutoffDate"]}')
    canvas.drawRightString(page_width - margin, 21, f'Página {document.page}')
    canvas.restoreState()

def render_table(token, story):
    cells = token['header']
    header = [inline(cell.get('tokens', [])) for cell in cells]
    rows = [[inline(cell.get('tokens', [])) for cell in row] for row in token['rows']]
    table_registry.append({'columns': len(header), 'rows': len(rows), 'mode': 'cards' if len(header) >= config['wideTableColumns'] else 'table'})
    if len(header) >= config['wideTableColumns']:
        for index, row in enumerate(rows):
            story.append(Spacer(1, 4))
            for column, ((label_markup, label_plain), (value_markup, value_plain)) in enumerate(zip(header, row)):
                story.append(paragraph(label_markup, label_plain, label_style, 'table_header'))
                value = paragraph(value_markup, value_plain, body, 'table_cell')
                if column == 0 and header[0][1].startswith('ID / nombre'):
                    identifiers = [part['text'] for part in token['rows'][index][0].get('tokens', []) if part['type'] == 'codespan']
                    if len(identifiers) != 1:
                        raise RuntimeError('Una ficha del catálogo no tiene un identificador único.')
                    entry = {'id': identifiers[0], 'group': 'reports' if len(header) == 6 else 'assistantCapabilities'}
                    catalog_registry.append(entry)
                    value._map_catalog = entry
                story.append(value)
            story.append(Spacer(1, 9))
        return
    count = len(header)
    if count == 2:
        widths = [width * .30, width * .70]
    elif count == 3:
        widths = [width * .24, width * .35, width * .41]
    elif count == 4:
        widths = [width * .15, width * .29, width * .33, width * .23]
    else:
        widths = [width / count] * count
    data = [[paragraph(markup, plain, table_head, 'table_header') for markup, plain in header]]
    data.extend([[paragraph(markup, plain, table_body, 'table_cell') for markup, plain in row] for row in rows])
    table = LongTable(data, colWidths=widths, repeatRows=1, hAlign='LEFT', splitByRow=1, splitInRow=0)
    table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8f0f3')),
                               ('GRID', (0, 0), (-1, -1), .35, colors.HexColor('#c8d7de')),
                               ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f7f9fa')]),
                               ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                               ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    story.append(table)
    story.append(Spacer(1, 8))

def render(tokens, story, list_depth=0):
    for token in tokens:
        kind = token['type']
        if kind == 'space':
            continue
        if kind == 'heading':
            markup, plain = inline(token.get('tokens', []), font_names['bold'])
            destination = f'heading-{len(heading_registry) + 1:04d}'
            anchors = list(dict.fromkeys([*pending_anchors, destination]))
            pending_anchors.clear()
            anchors_seen.extend(anchors)
            info = {'depth': token['depth'], 'title': plain, 'anchors': anchors}
            heading_registry.append(info)
            flow = paragraph(markup, plain, headings.get(token['depth'], headings[4]), 'heading')
            flow._map_heading = info
            story.append(flow)
        elif kind in ('paragraph', 'text'):
            markup, plain = inline(token.get('tokens', [{'type': 'text', 'text': token.get('text', '')}]))
            if plain.strip():
                story.append(paragraph(markup, plain))
        elif kind == 'table':
            render_table(token, story)
        elif kind == 'list':
            start = token.get('start', 1) or 1
            for index, item in enumerate(token.get('items', [])):
                prefix = f'{start + index}. ' if token.get('ordered') else '- '
                if item.get('task'):
                    prefix += '[x] ' if item.get('checked') else '[ ] '
                # Marked emits a standalone checkbox token before the task text;
                # its value is already included in the list prefix.
                item_tokens = [part for part in item.get('tokens', []) if not (item.get('task') and part['type'] == 'checkbox')]
                for position, item_token in enumerate(item_tokens):
                    if item_token['type'] in ('text', 'paragraph'):
                        markup, plain = inline(item_token.get('tokens', [{'type': 'text', 'text': item_token.get('text', '')}]))
                        style = ParagraphStyle(f'list_{list_depth}', parent=body, leftIndent=13 + list_depth * 12,
                                               firstLineIndent=-10, spaceAfter=4)
                        story.append(paragraph(styled_text(prefix) + markup if position == 0 else markup,
                                               prefix + plain if position == 0 else plain, style, 'list_item'))
                    else:
                        render([item_token], story, list_depth + 1)
            story.append(Spacer(1, 3))
        elif kind == 'blockquote':
            render(token.get('tokens', []), story, list_depth)
        elif kind == 'code':
            text = normalize(token.get('text', ''))
            story.append(paragraph(styled_text(text, font_names['mono']), text, code_style, 'code'))
        elif kind == 'checkbox':
            text = '[x]' if token.get('checked') else '[ ]'
            story.append(paragraph(styled_text(text), text, body, 'checkbox'))
        elif kind == 'hr':
            story.append(Spacer(1, 6))
        elif kind == 'html':
            markup, plain = inline([token])
            if plain.strip():
                story.append(paragraph(markup, plain))
        else:
            unsupported_tokens[f'block:{kind}'] += 1

story = [Cover(), PageBreak()]
render(payload['tokens'], story)
missing_anchors = sorted(set(payload['anchors']) - set(anchors_seen))
missing_links = sorted({link[1:] for link in link_registry if link.startswith('#')} - set(anchors_seen))
if missing_anchors or missing_links or unsupported_tokens or unsupported_characters:
    report = {'missingAnchors': missing_anchors, 'missingLinkTargets': missing_links,
              'unsupportedTokens': dict(unsupported_tokens), 'unsupportedCharacters': {f'U+{ord(key):04X}': value for key, value in unsupported_characters.items()}}
    output.with_suffix('.preflight.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    raise RuntimeError(f'Preflight fallido: {report}')
markdown = Path(payload['source']).read_text(encoding='utf-8')
if config['cutoffDate'] not in markdown:
    raise RuntimeError('La fecha de corte configurada no coincide con el Markdown.')
# SimpleDocTemplate adds six points of frame padding on each side. Compensate
# for that padding so the actual text and tables keep the configured margins.
document = MapDocument(str(output), pagesize=letter, leftMargin=margin - 6, rightMargin=margin - 6,
                       topMargin=margin - 6, bottomMargin=margin - 6, title=config['title'], author='Hospital Escandón BI',
                       subject=f'Mapa completo de la plataforma. Corte: {config["cutoffDate"]}')
document.build(story, onFirstPage=decorate, onLaterPages=decorate)
reader = PdfReader(str(output))
page_texts = [page.extract_text() or '' for page in reader.pages]
body_page_texts = []
for page_number, page_text in enumerate(page_texts, 1):
    decoration = f'{config["runningTitle"]}\nFecha de corte: {config["cutoffDate"]}\nPágina {page_number}\n'
    body_page_texts.append(page_text[len(decoration):] if page_text.startswith(decoration) else page_text)

def compact(value):
    return re.sub(r'\s+', '', normalize(html.unescape(value))).replace('\u00ad', '')

pdf_compact = compact('\n'.join(body_page_texts))
def outline_count(entries):
    return sum(outline_count(entry) if isinstance(entry, list) else 1 for entry in entries)

pdf_outline_count = outline_count(reader.outline)
page_references = {page.indirect_reference.idnum for page in reader.pages}
internal_links, invalid_internal_links = 0, []
for page_number, page in enumerate(reader.pages, 1):
    for reference in page.get('/Annots', []):
        annotation = reference.get_object()
        destination = annotation.get('/Dest')
        if destination is None:
            continue
        internal_links += 1
        if not isinstance(destination, list) or not destination or getattr(destination[0], 'idnum', None) not in page_references:
            invalid_internal_links.append(page_number)
missing_segments = []
for index, segment in enumerate(segments):
    expected = compact(segment['text'])
    if expected and expected not in pdf_compact:
        missing_segments.append({'index': index, 'type': segment['type'], 'length': len(segment['text']),
                                 'text': segment['text'][:400]})
qa = {'source': payload['source'], 'sourceHash': payload['sourceHash'], 'output': str(output),
      'pdfHash': hashlib.sha256(output.read_bytes()).hexdigest(),
      'cutoffDate': config['cutoffDate'], 'pages': len(reader.pages), 'headingCount': len(heading_registry),
      'sourceAnchorCount': len(payload['anchors']), 'sourceAnchorsPreserved': not missing_anchors,
      'headingPages': document.heading_pages, 'tables': table_registry,
      'catalogCounts': dict(Counter(entry['group'] for entry in catalog_registry)),
      'catalogPages': document.catalog_pages,
      'missingCatalogIds': [entry['id'] for entry in catalog_registry if compact(entry['id']) not in pdf_compact],
      'pdfOutlineCount': pdf_outline_count, 'internalLinkCount': internal_links,
      'invalidInternalLinks': invalid_internal_links,
      'runtimeVersions': {'reportlab': importlib.metadata.version('reportlab'), 'pypdf': importlib.metadata.version('pypdf')},
      'segments': len(segments), 'missingSegments': missing_segments, 'missingLinkTargets': missing_links,
      'unsupportedTokens': dict(unsupported_tokens), 'unsupportedCharacters': {},
      'fontFallbacks': {f'U+{ord(key):04X}': value for key, value in font_fallbacks.items()},
      'fonts': font_paths, 'contentCoveragePassed': not missing_segments and not invalid_internal_links and pdf_outline_count == len(heading_registry),
      'finalPageText': page_texts[-1], 'visualReviewRequired': True}
qa_file = output.with_suffix('.qa.json')
qa_file.write_text(json.dumps(qa, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'pdf': str(output), 'qa': str(qa_file), 'pages': qa['pages'], 'headings': qa['headingCount'],
                  'anchors': qa['sourceAnchorCount'], 'segments': qa['segments'], 'missingSegments': len(missing_segments)}, ensure_ascii=True))
if not qa['contentCoveragePassed'] or qa['missingCatalogIds']:
    raise SystemExit(3)
