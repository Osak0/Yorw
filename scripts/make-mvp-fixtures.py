"""Self-authored, redistributable workflow samples; not real papers or a model benchmark."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import textwrap
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject


def write_pdf(path, title, pages, *, encrypted=False, columns=False):
    writer = PdfWriter()
    writer.add_metadata({'/Title':title,'/Author':'Yorw self-authored synthetic fixture'})
    font = writer._add_object(DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')}))
    for text in pages:
        page = writer.add_blank_page(width=612,height=792)
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
        commands = []
        blocks = [text] if not columns else [text[:len(text)//2],text[len(text)//2:]]
        for index, block in enumerate(blocks):
            if not block:
                continue
            commands.append(f'BT /F1 11 Tf {40+index*285} 740 Td 15 TL')
            lines = textwrap.wrap(block,width=40 if columns else 85)
            for line in lines:
                escaped = line.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
                commands.append(f'({escaped}) Tj T*')
            commands.append('ET')
        content = DecodedStreamObject()
        content.set_data('\n'.join(commands).encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(content)
    if encrypted:
        writer.encrypt('fixture-password')
    writer.write(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    parser.add_argument('--enrichment-docx', action='store_true', help='Also generate the Chinese synthetic event budget DOCX')
    args = parser.parse_args()
    output = args.output.resolve()
    # Preserve earlier evidence and avoid overwriting any user-selected file.
    output.mkdir(parents=True,exist_ok=False)
    spec = json.loads((Path(__file__).parents[1]/'services/api/tests/fixtures/retrieval.json').read_text(encoding='utf-8'))
    files = []
    documents = [
        ('fixture.pdf','Reader fixture',['Yorw fixed English fixture evidence.']*2,False),
        ('SyntheticStudyA.pdf','Synthetic study A',spec['documents']['A'],False),
        ('SyntheticStudyB.pdf','Synthetic study B',spec['documents']['B'],False),
        ('SyntheticStudyC.pdf','Synthetic long two-column study C',[
            f'Page {i}. Synthetic calibration study. This text is not a research result. '+
            ('A model prediction must be compared with its visual evidence. Uncertainty and calibration need independent validation. '*8)
            for i in range(1,19)],True),
        ('SyntheticStudyD.pdf','Synthetic study D',[
            'Synthetic image reliability study. Missing images cannot be inferred from extracted text.',
            'The fictional study uses a separate test split. No actual patients or measurements are present.',
            'A synthetic limitation: a text-only parser cannot describe the shape or arrow in a figure.'],False)]
    for name,title,pages,columns in documents:
        path = output/name
        write_pdf(path,title,pages,columns=columns)
        files.append({'name':name,'title':title,'pages':len(pages),'sha256':sha256(path.read_bytes()).hexdigest()})
    if args.enrichment_docx:
        from zipfile import ZipFile
        from xml.sax.saxutils import escape
        paragraphs = ['活动名称：新生杯。', '活动总额：946.2元。', '这是 Yorw 自编写的活动决算测试材料，不是真实用户文件。']
        path = output/'phase2.docx'
        with ZipFile(path, 'w') as archive:
            archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + ''.join('<w:p><w:r><w:t>'+escape(text)+'</w:t></w:r></w:p>' for text in paragraphs) + '</w:body></w:document>')
        files.append({'name':path.name,'title':'Synthetic event budget','sha256':sha256(path.read_bytes()).hexdigest()})
    negative = output/'negative';negative.mkdir()
    write_pdf(negative/'encrypted.pdf','Encrypted fixture',['Encrypted fixture'],encrypted=True)
    write_pdf(negative/'no-text.pdf','No-text fixture',[''])
    (negative/'broken.pdf').write_bytes(b'%PDF-1.7 broken fixture')
    (output/'manifest.json').write_text(json.dumps({'description':__doc__,'files':files,'retrieval_cases':spec['cases'],'limitations':'Cross-language recall and factual quality require real provider review; these samples only exercise the workflow.'},ensure_ascii=False,indent=2),encoding='utf-8')
    (output/'README.txt').write_text('Yorw self-authored synthetic workflow samples. Not real research results.\nImport the five root PDFs to exercise reading, notes and Wiki.\nnegative/ contains encrypted, no-text and broken examples.\nmanifest.json records SHA-256 and twelve retrieval review cases.\nNo user papers, keys or patient data are included.\n',encoding='utf-8')
    print(f'Created 5 synthetic text PDFs and 3 negative fixtures in {output}')


if __name__ == '__main__':
    main()
