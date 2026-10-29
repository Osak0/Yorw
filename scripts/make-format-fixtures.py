"""Generate self-written multi-format fixtures for v0.3.0 parser verification.

Outputs only synthetic documents; never real papers. The target directory must
not exist so earlier evidence is preserved. DOC is produced only when a
LibreOffice executable is available (user-installed).
"""
from __future__ import annotations

import argparse
from io import BytesIO
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
import zlib

from pypdf import PdfWriter
from pypdf.generic import (DecodedStreamObject, DictionaryObject, NameObject,
                           NumberObject)

FONT = {
    'A': ('01110', '10001', '10001', '11111', '10001', '10001', '10001'),
    'B': ('11110', '10001', '10001', '11110', '10001', '10001', '11110'),
    'C': ('01110', '10001', '10000', '10000', '10000', '10001', '01110'),
    'D': ('11110', '10001', '10001', '10001', '10001', '10001', '11110'),
    'E': ('11111', '10000', '10000', '11110', '10000', '10000', '11111'),
    'F': ('11111', '10000', '10000', '11110', '10000', '10000', '10000'),
    'G': ('01110', '10001', '10000', '10111', '10001', '10001', '01110'),
    'H': ('10001', '10001', '10001', '11111', '10001', '10001', '10001'),
    'I': ('01110', '00100', '00100', '00100', '00100', '00100', '01110'),
    'J': ('00111', '00010', '00010', '00010', '00010', '10010', '01100'),
    'K': ('10001', '10010', '10100', '11000', '10100', '10010', '10001'),
    'L': ('10000', '10000', '10000', '10000', '10000', '10000', '11111'),
    'M': ('10001', '11011', '10101', '10101', '10001', '10001', '10001'),
    'N': ('10001', '11001', '10101', '10011', '10001', '10001', '10001'),
    'O': ('01110', '10001', '10001', '10001', '10001', '10001', '01110'),
    'P': ('11110', '10001', '10001', '11110', '10000', '10000', '10000'),
    'Q': ('01110', '10001', '10001', '10001', '10101', '10010', '01101'),
    'R': ('11110', '10001', '10001', '11110', '10100', '10010', '10001'),
    'S': ('01111', '10000', '10000', '01110', '00001', '00001', '11110'),
    'T': ('11111', '00100', '00100', '00100', '00100', '00100', '00100'),
    'U': ('10001', '10001', '10001', '10001', '10001', '10001', '01110'),
    'V': ('10001', '10001', '10001', '10001', '10001', '01010', '00100'),
    'W': ('10001', '10001', '10001', '10101', '10101', '10101', '01010'),
    'X': ('10001', '10001', '01010', '00100', '01010', '10001', '10001'),
    'Y': ('10001', '10001', '01010', '00100', '00100', '00100', '00100'),
    'Z': ('11111', '00001', '00010', '00100', '01000', '10000', '11111'),
    '0': ('01110', '10001', '10011', '10101', '11001', '10001', '01110'),
    '1': ('00100', '01100', '00100', '00100', '00100', '00100', '01110'),
    '2': ('01110', '10001', '00001', '00010', '00100', '01000', '11111'),
    '3': ('11111', '00010', '00100', '00010', '00001', '10001', '01110'),
    '4': ('00010', '00110', '01010', '10010', '11111', '00010', '00010'),
    '5': ('11111', '10000', '11110', '00001', '00001', '10001', '01110'),
    '6': ('00110', '01000', '10000', '11110', '10001', '10001', '01110'),
    '7': ('11111', '00001', '00010', '00100', '01000', '01000', '01000'),
    '8': ('01110', '10001', '10001', '01110', '10001', '10001', '01110'),
    '9': ('01110', '10001', '10001', '01111', '00001', '00010', '01100'),
}

DOCX_DOCUMENT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Fixture Document</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Methods</w:t></w:r></w:p>
    <w:p><w:r><w:t>This is a self-written DOCX fixture for Yorw parsing tests.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First list item</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Second list item</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Results</w:t></w:r></w:p>
    <w:p><w:r><w:t>The fixture table follows.</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
      <w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Metric</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Recall</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>0.8</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:p><w:r><w:t>End of fixture.</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body>
</w:document>
'''

DOCX_STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>
'''

DOCX_NUMBERING = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>
'''


def bitmap(text: str, scale: int = 10) -> tuple[int, int, bytes]:
    width = (len(text) * 6 + 2) * scale
    height = 10 * scale
    pixels = bytearray([255] * (width * height))
    for index, character in enumerate(text.upper()):
        glyph = FONT.get(character)
        if not glyph:
            continue
        left = (1 + index * 6) * scale
        top = 2 * scale
        for row, line in enumerate(glyph):
            for column, bit in enumerate(line):
                if bit != '1':
                    continue
                for y in range(row * scale, (row + 1) * scale):
                    start = (top + y) * width + left + column * scale
                    pixels[start:start + scale] = b'\x00' * scale
    return width, height, bytes(pixels)


def scanned_pdf(text: str) -> bytes:
    width, height, pixels = bitmap(text)
    writer = PdfWriter()
    page = writer.add_blank_page(width=width, height=height)
    image = DecodedStreamObject()
    image.set_data(zlib.compress(pixels))
    image[NameObject('/Type')] = NameObject('/XObject')
    image[NameObject('/Subtype')] = NameObject('/Image')
    image[NameObject('/Width')] = NumberObject(width)
    image[NameObject('/Height')] = NumberObject(height)
    image[NameObject('/ColorSpace')] = NameObject('/DeviceGray')
    image[NameObject('/BitsPerComponent')] = NumberObject(8)
    image[NameObject('/Filter')] = NameObject('/FlateDecode')
    image_ref = writer._add_object(image)
    page[NameObject('/Resources')] = DictionaryObject({
        NameObject('/XObject'): DictionaryObject({NameObject('/Im0'): image_ref})})
    content = DecodedStreamObject()
    content.set_data(f'q {width} 0 0 {height} 0 0 cm /Im0 Do Q'.encode())
    page[NameObject('/Contents')] = writer._add_object(content)
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


def text_pdf(text: str) -> bytes:
    writer = PdfWriter()
    page = writer.add_blank_page(width=400, height=200)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                             NameObject('/Subtype'): NameObject('/Type1'),
                             NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({
        NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    content = DecodedStreamObject()
    content.set_data(f'BT /F1 12 Tf 20 100 Td ({text}) Tj ET'.encode())
    page[NameObject('/Contents')] = writer._add_object(content)
    writer.add_metadata({'/Title': 'Fixture text PDF', '/Author': 'Yorw fixtures'})
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


def docx_bytes() -> bytes:
    stream = BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>''')
        archive.writestr('_rels/.rels', '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>''')
        archive.writestr('word/_rels/document.xml.rels', '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>''')
        archive.writestr('word/document.xml', DOCX_DOCUMENT)
        archive.writestr('word/styles.xml', DOCX_STYLES)
        archive.writestr('word/numbering.xml', DOCX_NUMBERING)
    return stream.getvalue()


def find_soffice(configured: str | None) -> str | None:
    if configured:
        path = Path(configured)
        return str(path) if path.is_file() else None
    found = shutil.which('soffice')
    if found:
        return found
    import os
    for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
        base = os.environ.get(variable)
        if base and (Path(base) / 'LibreOffice' / 'program' / 'soffice.exe').is_file():
            return str(Path(base) / 'LibreOffice' / 'program' / 'soffice.exe')
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--soffice', default=None)
    args = parser.parse_args()
    if args.output.exists():
        print('output directory already exists; choose a new one', file=sys.stderr)
        return 2
    args.output.mkdir(parents=True)
    (args.output / 'fixture.md').write_text('''# Fixture Markdown

Intro paragraph with **bold** and `code`.

## Methods

- First item
- Second item

### Details

1. Ordered one
2. Ordered two

| Metric | Value |
| --- | --- |
| Recall | 0.8 |
| MRR | 0.6 |

```python
print('fixture')
```

## Results

Final paragraph.
''', encoding='utf-8')
    (args.output / 'fixture.txt').write_text('''Fixture TXT
This is a self-written plain text fixture.

Methods

First paragraph in methods. Second sentence in methods.

Results
Final paragraph.
''', encoding='utf-8')
    (args.output / 'fixture.docx').write_bytes(docx_bytes())
    (args.output / 'fixture-text.pdf').write_bytes(text_pdf('Yorw fixed English fixture evidence.'))
    (args.output / 'fixture-scanned.pdf').write_bytes(scanned_pdf('YORW SCANNED OCR FIXTURE'))
    soffice = find_soffice(args.soffice)
    if soffice:
        result = subprocess.run([soffice, '--headless', '--convert-to', 'doc',
                                 '--outdir', str(args.output), str(args.output / 'fixture.docx')],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        generated = args.output / 'fixture.doc'
        if result.returncode == 0 and generated.is_file():
            print(f'DOC generated: {generated}')
        else:
            print('DOC conversion failed; DOC verification skipped', file=sys.stderr)
    else:
        print('LibreOffice not found; DOC verification skipped', file=sys.stderr)
    for path in sorted(args.output.iterdir()):
        print(f'{path.name}\t{path.stat().st_size} bytes')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
