"""Contract tests for the versioned document parser boundary (v0.3.0 step 1)."""
from io import BytesIO
from pathlib import Path
from threading import Event

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from yorw_api.parsing import (
    Capability,
    ContentBlock,
    DocumentParser,
    ParseError,
    ParseRequest,
    ParseResult,
    ParserRegistry,
    SourceEvidence,
    SourceLocation,
    evidence_ref,
    stable_block_id,
)
from yorw_api.parsing.pdf import PdfParser


def pdf_bytes(text='Yorw fixed English fixture evidence.'):
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=400)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    content = DecodedStreamObject()
    content.set_data(f'BT /F1 12 Tf 20 200 Td ({text}) Tj ET'.encode())
    page[NameObject('/Contents')] = writer._add_object(content)
    writer.add_metadata({'/Title': 'Fixture title', '/Author': 'Fixture Author'})
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


class FakeMarkdownParser:
    """A non-PDF parser proves the contract is not page-specific."""

    name = 'fake-markdown'
    version = '1'

    def capabilities(self):
        return [Capability(format='md', media_type='text/markdown', state='builtin', parser=self.name)]

    def parse(self, request: ParseRequest, cancel: Event) -> ParseResult:
        if cancel.is_set():
            raise ParseError('CANCELLED')
        sections = [['Methods'], ['Methods', 'Results']]
        texts = ['We measured the fixture.', 'The fixture improved.']
        blocks = [ContentBlock(
            id=stable_block_id(request.document_id, request.extraction_version, index),
            ordinal=index, type='paragraph', text=text, section_path=sections[index],
            location=SourceLocation(kind='block', block_ordinal=index, start_offset=sum(map(len, texts[:index])), end_offset=sum(map(len, texts[:index + 1]))),
        ) for index, text in enumerate(texts)]
        return ParseResult(format='md', media_type='text/markdown', parser_name=self.name, parser_version=self.version,
                           config_fingerprint='fixture', status='ready', summary='2 blocks', metadata={'title': 'Markdown fixture'},
                           page_count=None, blocks=blocks)


class FakeExternalParser:
    def __init__(self, available: bool):
        self.available = available
        self.name, self.version = 'fake-docling', '1'

    def capabilities(self):
        return [Capability(format='docx', media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                           state='external' if self.available else 'component_missing', parser=self.name,
                           detail='external fixture', install_hint=None if self.available else 'install docling')]

    def parse(self, request: ParseRequest, cancel: Event) -> ParseResult:
        raise AssertionError('registry must not call an unavailable parser')


def request(tmp_path: Path, name: str, identity='00000000-0000-0000-0000-000000000001', version=1):
    path = tmp_path / name
    path.write_bytes(b'fixture')
    return ParseRequest(path=path, document_id=identity, extraction_version=version, format=path.suffix.lstrip('.').lower(), original_name=name)


def test_stable_block_id_is_deterministic_and_versioned():
    identity = '00000000-0000-0000-0000-000000000001'
    first = stable_block_id(identity, 1, 0)
    assert first == stable_block_id(identity, 1, 0)
    assert first != stable_block_id(identity, 2, 0)
    assert first != stable_block_id(identity, 1, 1)


def test_pdf_parser_uses_physical_pages_and_keeps_legacy_evidence(tmp_path):
    path = tmp_path / 'fixture.pdf'
    path.write_bytes(pdf_bytes())
    parsed = PdfParser().parse(ParseRequest(path=path, document_id='00000000-0000-0000-0000-000000000001',
                                            extraction_version=3, format='pdf', original_name='fixture.pdf'), Event())
    assert parsed.status == 'ready' and parsed.page_count == 1 and parsed.format == 'pdf'
    assert parsed.metadata.title == 'Fixture title' and parsed.metadata.authors == ['Fixture Author']
    block = parsed.blocks[0]
    assert block.type == 'page' and block.physical_page == 1
    assert block.location.kind == 'page' and block.location.physical_page == 1
    evidence = evidence_ref(block, document_id='00000000-0000-0000-0000-000000000001',
                            document_title='Fixture title', extraction_version=3)
    assert evidence['physical_page'] == 1 and evidence['extraction_version'] == 3
    assert evidence['block_id'] == block.id
    legacy = SourceEvidence.model_validate({'document_id': evidence['document_id'], 'chunk_id': 'legacy-chunk',
                                            'physical_page': 1, 'quote': block.text, 'extraction_version': 3})
    assert legacy.chunk_id == 'legacy-chunk' and legacy.block_id is None


def test_non_pdf_result_has_sections_and_no_fabricated_pages(tmp_path):
    parsed = FakeMarkdownParser().parse(request(tmp_path, 'fixture.md'), Event())
    assert parsed.page_count is None
    assert [block.section_path for block in parsed.blocks] == [['Methods'], ['Methods', 'Results']]
    assert all(block.physical_page is None and block.location.kind == 'block' for block in parsed.blocks)
    evidence = evidence_ref(parsed.blocks[1], document_id='00000000-0000-0000-0000-000000000001',
                            document_title='Markdown fixture', extraction_version=1)
    assert evidence['physical_page'] is None and evidence['section_path'] == ['Methods', 'Results']


def test_registry_reports_capability_states_and_refuses_missing_components(tmp_path):
    registry = ParserRegistry([PdfParser(), FakeMarkdownParser(), FakeExternalParser(False)])
    states = {item.format: item.state for item in registry.capabilities()}
    assert states == {'pdf': 'builtin', 'md': 'builtin', 'docx': 'component_missing', 'doc': 'unsupported', 'txt': 'unsupported'}
    with pytest.raises(ParseError) as unavailable:
        registry.parse(request(tmp_path, 'fixture.docx'))
    assert unavailable.value.code == 'COMPONENT_MISSING'


def test_registry_returns_contract_only_and_standard_cancel_error(tmp_path):
    parser = FakeMarkdownParser()
    registry = ParserRegistry([parser])
    parsed = registry.parse(request(tmp_path, 'fixture.md'))
    assert isinstance(parsed, ParseResult)
    assert isinstance(parsed.blocks[0], ContentBlock)
    cancel = Event(); cancel.set()
    with pytest.raises(ParseError) as cancelled:
        registry.parse(request(tmp_path, 'fixture.md'), cancel)
    assert cancelled.value.code == 'CANCELLED'


def test_pdf_parser_reports_encrypted_and_blank_files_as_standard_errors(tmp_path):
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.encrypt('password')
    encrypted = tmp_path / 'encrypted.pdf'
    stream = BytesIO(); writer.write(stream); encrypted.write_bytes(stream.getvalue())
    with pytest.raises(ParseError) as error:
        PdfParser().parse(ParseRequest(path=encrypted, document_id='00000000-0000-0000-0000-000000000001',
                                       extraction_version=1, format='pdf', original_name='encrypted.pdf'), Event())
    assert error.value.code == 'ENCRYPTED_PDF'

    blank = PdfWriter(); blank.add_blank_page(width=100, height=100)
    blank_stream = BytesIO(); blank.write(blank_stream)
    blank_path = tmp_path / 'blank.pdf'; blank_path.write_bytes(blank_stream.getvalue())
    parsed = PdfParser().parse(ParseRequest(path=blank_path, document_id='00000000-0000-0000-0000-000000000001',
                                            extraction_version=1, format='pdf', original_name='blank.pdf'), Event())
    assert parsed.status == 'unsupported' and parsed.warning == 'NO_TEXT_NO_OCR' and parsed.blocks == []
