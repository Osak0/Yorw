"""Builtin TXT, Markdown, DOCX and DOC parsers on self-written fixtures."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
from threading import Event
import zipfile

import pytest

from yorw_api.parsing import ParseError, ParseRequest
from yorw_api.parsing.defaults import default_registry
from yorw_api.parsing.doc import DocParser, find_soffice
from yorw_api.parsing.docx import DocxParser
from yorw_api.parsing.markdown import MarkdownParser
from yorw_api.parsing.text import TextParser

SCRIPT = Path(__file__).resolve().parents[3] / 'scripts' / 'make-format-fixtures.py'
spec = importlib.util.spec_from_file_location('yorw_format_fixtures', SCRIPT)
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


def request(path: Path, format: str | None = None, identity='00000000-0000-0000-0000-000000000001', version=1):
    return ParseRequest(path=path, document_id=identity, extraction_version=version,
                        format=format or path.suffix.lstrip('.'), original_name=path.name)


def test_text_parser_paragraphs_offsets_and_encoding(tmp_path):
    path = tmp_path / 'fixture.txt'
    path.write_text('First paragraph.\n\nSecond paragraph.\n\nThird.', encoding='utf-8')
    result = TextParser().parse(request(path), Event())
    assert result.status == 'ready' and len(result.blocks) == 3
    assert [block.type for block in result.blocks] == ['paragraph', 'paragraph', 'paragraph']
    assert [block.text for block in result.blocks] == ['First paragraph.', 'Second paragraph.', 'Third.']
    assert all(block.physical_page is None and block.location.kind == 'block' for block in result.blocks)
    assert result.blocks[0].location.start_offset == 0
    assert result.blocks[1].location.start_offset == 18

    chinese = tmp_path / 'chinese.txt'
    chinese.write_bytes('第一段。\n\n第二段。'.encode('gb18030'))
    parsed = TextParser().parse(request(chinese), Event())
    assert '第一段' in parsed.blocks[0].text
    assert any(item.code == 'TEXT_ENCODING_INFERRED' for item in parsed.warnings)
    assert 'gb18030' in parsed.summary


def test_text_parser_rejects_undecodable_and_empty(tmp_path):
    invalid = tmp_path / 'invalid.txt'
    invalid.write_bytes(b'\xff\xff\xff')
    with pytest.raises(ParseError) as error:
        TextParser().parse(request(invalid), Event())
    assert error.value.code == 'DECODE_FAILED'
    empty = tmp_path / 'empty.txt'
    empty.write_bytes(b'')
    parsed = TextParser().parse(request(empty), Event())
    assert parsed.status == 'unsupported' and parsed.warning == 'NO_TEXT'


def test_markdown_parser_structure_and_locations(tmp_path):
    path = tmp_path / 'fixture.md'
    path.write_text('''# Fixture Markdown

Intro paragraph.

## Methods

- First item
- Second item

| Metric | Value |
| --- | --- |
| Recall | 0.8 |

```python
print('fixture')
```

## Results

Final paragraph.
''', encoding='utf-8')
    result = MarkdownParser().parse(request(path), Event())
    assert result.status == 'ready' and result.metadata.title == 'Fixture Markdown'
    assert [block.type for block in result.blocks] == [
        'heading', 'paragraph', 'heading', 'list_item', 'list_item', 'table', 'code', 'heading', 'paragraph']
    assert result.blocks[2].heading_level == 2
    assert result.blocks[2].section_path == ['Fixture Markdown']
    assert result.blocks[3].section_path == ['Fixture Markdown', 'Methods']
    assert result.blocks[5].text.startswith('| Metric')
    assert result.blocks[7].section_path == ['Fixture Markdown']
    assert result.blocks[8].section_path == ['Fixture Markdown', 'Results']
    assert all(block.physical_page is None for block in result.blocks)
    assert result.blocks[0].location.start_offset == 0


def test_docx_parser_headings_lists_tables_and_metadata(tmp_path):
    path = tmp_path / 'fixture.docx'
    path.write_bytes(fixtures.docx_bytes())
    result = DocxParser().parse(request(path), Event())
    assert result.status == 'ready' and result.metadata.title == 'Fixture Document'
    assert [block.type for block in result.blocks] == [
        'heading', 'paragraph', 'list_item', 'list_item', 'heading', 'paragraph', 'table', 'paragraph']
    assert result.blocks[0].text == 'Methods' and result.blocks[0].heading_level == 1
    assert result.blocks[2].text == '1. First list item'
    assert result.blocks[3].text == '2. Second list item'
    assert 'Metric | Value' in result.blocks[6].text and 'Recall | 0.8' in result.blocks[6].text
    assert result.blocks[4].section_path == []
    assert result.blocks[7].section_path == ['Results']
    assert all(block.physical_page is None for block in result.blocks)


def test_docx_parser_rejects_invalid_packages(tmp_path):
    invalid = tmp_path / 'invalid.docx'
    invalid.write_bytes(b'not a zip')
    with pytest.raises(ParseError) as error:
        DocxParser().parse(request(invalid), Event())
    assert error.value.code == 'INVALID_FILE'
    incomplete = tmp_path / 'incomplete.docx'
    with zipfile.ZipFile(incomplete, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
    with pytest.raises(ParseError) as error:
        DocxParser().parse(request(incomplete), Event())
    assert error.value.code == 'INVALID_FILE'


def test_default_registry_reports_all_builtin_formats():
    states = {item.format: item.state for item in default_registry().capabilities()}
    assert states['pdf'] == 'builtin' and states['txt'] == 'builtin'
    assert states['md'] == 'builtin' and states['docx'] == 'builtin'
    assert states['doc'] in ('builtin', 'component_missing')


def test_doc_parser_converts_with_libreoffice(tmp_path):
    soffice = find_soffice()
    docx = tmp_path / 'fixture.docx'
    docx.write_bytes(fixtures.docx_bytes())
    if not soffice:
        parser = DocParser()
        assert parser.capabilities()[0].state == 'component_missing'
        with pytest.raises(ParseError) as error:
            parser.parse(request(docx, 'doc'), Event())
        assert error.value.code == 'COMPONENT_MISSING'
        pytest.skip('LibreOffice is not installed')
    profile = tmp_path / 'profile'
    converted = subprocess.run(
        [soffice, '--headless', '--safe-mode', '--norestore', '--nolockcheck',
         f'-env:UserInstallation={profile.as_uri()}', '--convert-to', 'doc',
         '--outdir', str(tmp_path), str(docx)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    doc = tmp_path / 'fixture.doc'
    if converted.returncode != 0 or not doc.is_file():
        pytest.skip(f'LibreOffice DOC conversion unavailable: {converted.stderr[-500:]!r}')
    result = DocParser(soffice=soffice).parse(request(doc), Event())
    assert result.format == 'doc' and result.media_type == 'application/msword'
    assert result.status in ('ready', 'partial')
    assert any(block.type == 'heading' for block in result.blocks)
    assert any(block.type == 'table' for block in result.blocks)
    assert any(item.code == 'DOC_CONVERTED' for item in result.warnings)
