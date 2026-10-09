"""Check text bounds on every PDF page without changing the document."""
import argparse
import hashlib
import json
from pathlib import Path

import pdfplumber

parser = argparse.ArgumentParser()
parser.add_argument('--pdf', required=True)
parser.add_argument('--output')
parser.add_argument('--tolerance', type=float, default=0.5, help='Coordinate tolerance in points.')
args = parser.parse_args()
file = Path(args.pdf).resolve()
outside_count = 0
characters = 0
samples = []
page_count = 0
with pdfplumber.open(file) as pdf:
    for page in pdf.pages:
        page_count += 1
        left, top, right, bottom = page.bbox
        for char in page.chars:
            characters += 1
            bounds = [char['x0'], char['top'], char['x1'], char['bottom']]
            outside = (bounds[0] < left - args.tolerance or bounds[1] < top - args.tolerance
                       or bounds[2] > right + args.tolerance or bounds[3] > bottom + args.tolerance)
            if outside:
                outside_count += 1
                if len(samples) < 100:
                    samples.append({'page': page.page_number, 'character': char['text'], 'bounds': bounds})
        page.close()
report = {'pdf': str(file), 'pdfHash': hashlib.sha256(file.read_bytes()).hexdigest(), 'pages': page_count,
          'characters': characters, 'outsidePageCount': outside_count, 'samples': samples,
          'passed': outside_count == 0, 'tolerancePoints': args.tolerance,
          'scope': 'Character bounds on every page. Visual review is also required to detect overlaps and poor layout.'}
if args.output:
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps({key: report[key] for key in ['pages', 'characters', 'outsidePageCount', 'passed']}, ensure_ascii=True))
raise SystemExit(0 if report['passed'] else 1)
