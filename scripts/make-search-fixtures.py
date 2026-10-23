"""Generate tiny, self-authored PDFs for manual retrieval review; never reads user papers."""
import argparse
from hashlib import sha256
import json
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path, help='Directory for synthetic fixtures and manifest')
args = parser.parse_args()
source = Path(__file__).resolve().parents[1] / 'services/api/tests/fixtures/retrieval.json'
fixture = json.loads(source.read_text(encoding='utf-8'))
args.output.mkdir(parents=True, exist_ok=True)
manifest = {'fixture':fixture, 'files':[]}
for name,pages in fixture['documents'].items():
    writer = PdfWriter()
    writer.add_metadata({'/Title': f'Yorw synthetic retrieval {name}', '/Author': 'Yorw fixture'})
    font = DictionaryObject({NameObject('/Type'):NameObject('/Font'), NameObject('/Subtype'):NameObject('/Type1'), NameObject('/BaseFont'):NameObject('/Helvetica')})
    font_id = writer._add_object(font)
    for text in pages:
        page = writer.add_blank_page(width=612,height=792)
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font_id})})
        import textwrap
        lines = ['Yorw synthetic fixture. Not a research result.', ''] + textwrap.wrap(text,width=75)
        commands = ['BT /F1 12 Tf 40 720 Td 18 TL']
        for line in lines:
            escaped = line.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
            commands.append(f'({escaped}) Tj T*')
        commands.append('ET')
        stream = DecodedStreamObject(); stream.set_data('\n'.join(commands).encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(stream)
    target = args.output / f'SyntheticStudy{name}.pdf'
    if target.exists():
        raise SystemExit(f'Fixture already exists: {target}; choose a new output directory')
    writer.write(target)
    manifest['files'].append({'name':target.name, 'sha256':sha256(target.read_bytes()).hexdigest()})
(args.output / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Wrote {len(manifest["files"])} synthetic PDFs and manifest to {args.output.resolve()}')
