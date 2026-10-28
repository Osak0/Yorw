"""Run the user-installed Docling adapter against synthetic format fixtures.

Usage:
  services/api/.venv/Scripts/python.exe scripts/verify-docling.py \
    --executable C:/Users/<you>/.local/bin/docling.exe \
    --samples .cache/docling-fixtures \
    --report .cache/docling-report-<new>.json

This never installs Docling or downloads models. A first Docling run may
download models according to the user's own Docling configuration.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from threading import Event
from time import monotonic
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services' / 'api' / 'src'))

from yorw_api.parsing import ParseError, ParseRequest  # noqa: E402
from yorw_api.parsing.docling import DoclingConfig, DoclingParser  # noqa: E402

FORMATS = {'pdf', 'docx', 'doc', 'md', 'txt'}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--executable', required=True)
    parser.add_argument('--samples', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--libreoffice', default=None)
    parser.add_argument('--timeout', type=float, default=600)
    parser.add_argument('--no-ocr', action='store_true')
    parser.add_argument('--prefix-arg', action='append', default=[])
    args = parser.parse_args()
    if not args.samples.is_dir():
        print('samples directory does not exist', file=sys.stderr)
        return 2
    if args.report.exists():
        print('report already exists; choose a new path', file=sys.stderr)
        return 2
    config = DoclingConfig(executable=args.executable, prefix_args=args.prefix_arg,
                           libreoffice_executable=args.libreoffice,
                           timeout_seconds=args.timeout, ocr=not args.no_ocr)
    docling = DoclingParser(config)
    capabilities = [item.model_dump(mode='json') for item in docling.capabilities()]
    items = []
    for path in sorted(args.samples.iterdir()):
        format = path.suffix.lower().lstrip('.')
        if not path.is_file() or format not in FORMATS:
            continue
        request = ParseRequest(path=path, document_id=str(uuid4()), extraction_version=1,
                               format=format, original_name=path.name)
        started = monotonic()
        try:
            result = docling.parse(request, Event())
            items.append({
                'file': path.name, 'format': format, 'ok': True,
                'status': result.status, 'warning': result.warning,
                'parser': result.parser_name, 'parser_version': result.parser_version,
                'page_count': result.page_count, 'blocks': len(result.blocks),
                'block_types': sorted({block.type for block in result.blocks}),
                'section_paths': sorted({tuple(block.section_path) for block in result.blocks})[:20],
                'physical_pages': sorted({block.physical_page for block in result.blocks if block.physical_page}),
                'warnings': [item.code for item in result.warnings],
                'preview': result.blocks[0].text[:80] if result.blocks else '',
                'elapsed_seconds': round(monotonic() - started, 3),
            })
        except ParseError as error:
            items.append({'file': path.name, 'format': format, 'ok': False,
                          'code': error.code, 'message': error.message,
                          'retryable': error.retryable, 'diagnostic': error.diagnostic,
                          'elapsed_seconds': round(monotonic() - started, 3)})
    report = {
        'created_at': datetime.now(timezone.utc).isoformat(),
        'executable': args.executable,
        'ocr': not args.no_ocr,
        'timeout_seconds': args.timeout,
        'capabilities': capabilities,
        'items': items,
        'note': 'Synthetic fixtures only; Docling output quality is not a paper-quality claim.',
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open('x', encoding='utf-8') as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
    for item in items:
        print(f"{item['file']}: {item.get('status') or item.get('code')} "
              f"{item.get('blocks', '')} blocks; {item['elapsed_seconds']}s")
    print(f'report: {args.report}')
    formats = {item['format'] for item in items if item.get('ok')}
    return 0 if formats == FORMATS else 1


if __name__ == '__main__':
    raise SystemExit(main())
