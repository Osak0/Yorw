"""Docling external-process adapter: protocol, limits, cancellation and JSON mapping."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import threading
import time

import pytest

from yorw_api.parsing import ParseError, ParseRequest
from yorw_api.parsing.docling import DoclingConfig, DoclingParser


def fixture_document():
    bbox = {"l": 0, "t": 0, "r": 10, "b": 10, "coord_origin": "BOTTOMLEFT"}
    def prov(page):
        return [{"page_no": page, "bbox": bbox, "charspan": [0, 10]}]
    texts = [
        {"self_ref": "#/texts/0", "label": "title", "text": "Fixture Study", "prov": []},
        {"self_ref": "#/texts/1", "label": "section_header", "text": "Methods", "level": 1, "prov": prov(1)},
        {"self_ref": "#/texts/2", "label": "text", "text": "First paragraph.", "prov": prov(1)},
        {"self_ref": "#/texts/3", "label": "list_item", "text": "Bullet one", "prov": prov(2)},
        {"self_ref": "#/texts/4", "label": "section_header", "text": "Results", "level": 1, "prov": prov(2)},
        {"self_ref": "#/texts/5", "label": "text", "text": "Second paragraph.", "prov": prov(2)},
    ]
    tables = [{
        "self_ref": "#/tables/0", "label": "table", "prov": prov(2),
        "data": {"num_rows": 1, "num_cols": 2, "table_cells": [
            {"text": "A", "start_row_offset_idx": 0, "start_col_offset_idx": 0},
            {"text": "B", "start_row_offset_idx": 0, "start_col_offset_idx": 1},
        ]},
    }]
    pictures = [{"self_ref": "#/pictures/0", "label": "picture", "prov": prov(2)}]
    return {
        "schema_name": "DoclingDocument", "version": "1.0.0", "name": "fixture",
        "body": {"self_ref": "#/body", "children": [
            {"$ref": "#/texts/0"}, {"$ref": "#/texts/1"}, {"$ref": "#/texts/2"},
            {"$ref": "#/groups/0"}, {"$ref": "#/texts/4"}, {"$ref": "#/texts/5"},
            {"$ref": "#/tables/0"}, {"$ref": "#/pictures/0"},
        ]},
        "groups": [{"self_ref": "#/groups/0", "name": "list", "children": [{"$ref": "#/texts/3"}]}],
        "texts": texts, "tables": tables, "pictures": pictures,
        "pages": {"1": {"page_no": 1, "size": {"width": 100, "height": 100}},
                  "2": {"page_no": 2, "size": {"width": 100, "height": 100}}},
    }


def fake_script(tmp_path: Path, *, sleep=0, fail=False, huge=False, dump_env=False, marker=False) -> Path:
    fixture = tmp_path / "docling-fixture.json"
    fixture.write_text(json.dumps(fixture_document()), encoding="utf-8")
    script = tmp_path / "fake_docling.py"
    lines = [
        "import json, os, pathlib, sys, time",
        "args = sys.argv[1:]",
        f"base = pathlib.Path({str(tmp_path)!r})",
        "if '--version' in args:",
        "    print('docling 9.9.9')",
        "    sys.exit(0)",
        "(base / 'argv.json').write_text(json.dumps(args), encoding='utf-8')",
    ]
    if dump_env:
        lines.append("(base / 'env.json').write_text(json.dumps(sorted(os.environ)), encoding='utf-8')")
    if marker:
        lines.append("(base / 'started').write_text('1', encoding='utf-8')")
    lines.append(f"time.sleep({sleep!r})")
    if fail:
        lines += ["print('fixture parser failed', file=sys.stderr)", "sys.exit(3)"]
    lines += [
        "output = pathlib.Path(args[args.index('--output') + 1])",
        "output.mkdir(parents=True, exist_ok=True)",
        "stem = pathlib.Path(args[-1]).stem",
    ]
    if huge:
        lines += [
            "if True:",
            "    (output / (stem + '.json')).write_text('{\"name\":\"' + 'x' * 100000 + '\"}', encoding='utf-8')",
            "    sys.exit(0)",
        ]
    lines.append(f"(output / (stem + '.json')).write_text(pathlib.Path({str(fixture)!r}).read_text(encoding='utf-8'), encoding='utf-8')")
    script.write_text("\n".join(lines), encoding="utf-8")
    return script


def config(tmp_path: Path, script: Path, **values) -> DoclingConfig:
    values.setdefault("timeout_seconds", 20)
    values.setdefault("libreoffice_executable", str(tmp_path / "missing-soffice.exe"))
    return DoclingConfig(executable=sys.executable, prefix_args=[str(script)], **values)


def parse_request(tmp_path: Path, suffix: str) -> ParseRequest:
    path = tmp_path / f"fixture.{suffix}"
    path.write_bytes(b"fixture input")
    return ParseRequest(path=path, document_id="00000000-0000-0000-0000-000000000001",
                        extraction_version=1, format=suffix, original_name=path.name)


def test_capabilities_report_external_component_missing_and_version(tmp_path):
    script = fake_script(tmp_path)
    parser = DoclingParser(config(tmp_path, script))
    states = {item.format: item.state for item in parser.capabilities()}
    assert states == {"pdf": "external", "docx": "external", "md": "external", "doc": "component_missing"}
    assert "9.9.9" in parser.capabilities()[0].detail

    missing = DoclingParser(DoclingConfig(executable=str(tmp_path / "missing-docling.exe")))
    assert {item.state for item in missing.capabilities()} == {"component_missing"}
    with pytest.raises(ParseError) as error:
        missing.parse(parse_request(tmp_path, "pdf"), threading.Event())
    assert error.value.code == "COMPONENT_MISSING"


def test_pdf_conversion_keeps_pages_sections_tables_and_warnings(tmp_path):
    script = fake_script(tmp_path)
    parser = DoclingParser(config(tmp_path, script))
    result = parser.parse(parse_request(tmp_path, "pdf"), threading.Event())
    assert result.status == "partial" and result.warning == "PARTIAL_TEXT"
    assert result.page_count == 2 and result.metadata.title == "Fixture Study"
    assert [block.type for block in result.blocks] == ["heading", "paragraph", "list_item", "heading", "paragraph", "table"]
    assert [block.physical_page for block in result.blocks] == [1, 1, 2, 2, 2, 2]
    assert [block.section_path for block in result.blocks] == [[], ["Methods"], ["Methods"], [], ["Results"], ["Results"]]
    assert result.blocks[0].heading_level == 1
    assert "A" in result.blocks[-1].text and "B" in result.blocks[-1].text
    assert any(item.code == "PICTURE_SKIPPED" for item in result.warnings)
    argv = json.loads((tmp_path / "argv.json").read_text(encoding="utf-8"))
    assert "--to" in argv and argv[argv.index("--to") + 1] == "json"
    assert "--output" in argv and "--ocr" in argv


def test_non_pdf_conversion_does_not_fabricate_pages(tmp_path):
    script = fake_script(tmp_path)
    result = DoclingParser(config(tmp_path, script)).parse(parse_request(tmp_path, "docx"), threading.Event())
    assert result.page_count is None
    assert all(block.physical_page is None and block.location.kind == "block" for block in result.blocks)
    argv = json.loads((tmp_path / "argv.json").read_text(encoding="utf-8"))
    assert "--ocr" not in argv


def test_timeout_kills_the_process(tmp_path):
    script = fake_script(tmp_path, sleep=10)
    parser = DoclingParser(config(tmp_path, script, timeout_seconds=0.4))
    started = time.monotonic()
    with pytest.raises(ParseError) as error:
        parser.parse(parse_request(tmp_path, "pdf"), threading.Event())
    assert error.value.code == "TIMEOUT"
    assert time.monotonic() - started < 5


def test_cancel_stops_a_running_process(tmp_path):
    script = fake_script(tmp_path, sleep=10, marker=True)
    parser = DoclingParser(config(tmp_path, script, timeout_seconds=20))
    cancel = threading.Event()
    result: list[BaseException] = []

    def run():
        try:
            parser.parse(parse_request(tmp_path, "pdf"), cancel)
        except BaseException as error:  # noqa: BLE001 - test observes the boundary
            result.append(error)

    thread = threading.Thread(target=run)
    thread.start()
    deadline = time.monotonic() + 10
    while not (tmp_path / "started").exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    cancel.set()
    thread.join(timeout=10)
    assert not thread.is_alive()
    assert isinstance(result[0], ParseError) and result[0].code == "CANCELLED"


def test_output_limit_and_parser_failure_are_standard_errors(tmp_path):
    huge_dir = tmp_path / "huge"
    huge_dir.mkdir()
    huge = fake_script(huge_dir, huge=True)
    parser = DoclingParser(config(huge_dir, huge, max_output_bytes=1000))
    with pytest.raises(ParseError) as error:
        parser.parse(parse_request(huge_dir, "pdf"), threading.Event())
    assert error.value.code == "OUTPUT_TOO_LARGE"

    fail_dir = tmp_path / "fail"
    fail_dir.mkdir()
    failed = fake_script(fail_dir, fail=True)
    parser = DoclingParser(config(fail_dir, failed))
    with pytest.raises(ParseError) as error:
        parser.parse(parse_request(fail_dir, "pdf"), threading.Event())
    assert error.value.code == "PARSER_FAILED"
    assert error.value.diagnostic["exit_code"] == 3
    assert "fixture parser failed" in error.value.diagnostic["stderr"]


def test_child_environment_is_sanitized(tmp_path, monkeypatch):
    monkeypatch.setenv("YORW_SECRET_TOKEN", "do-not-leak")
    script = fake_script(tmp_path, dump_env=True)
    DoclingParser(config(tmp_path, script)).parse(parse_request(tmp_path, "pdf"), threading.Event())
    names = json.loads((tmp_path / "env.json").read_text(encoding="utf-8"))
    assert "YORW_SECRET_TOKEN" not in names
    assert "PATH" in names


def test_doc_capability_requires_libreoffice(tmp_path):
    script = fake_script(tmp_path)
    soffice = tmp_path / "soffice.exe"
    soffice.write_bytes(b"fixture")
    parser = DoclingParser(config(tmp_path, script, libreoffice_executable=str(soffice)))
    assert {item.format: item.state for item in parser.capabilities()}["doc"] == "external"
