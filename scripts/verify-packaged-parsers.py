"""Verify the packaged frozen backend's builtin and external parser paths.

This is acceptance evidence, not a product command. It starts the bundled
yorw-api executable, enables the user-installed Docling adapter, imports a
DOCX and a scanned PDF, and records block/page results.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request


def api(base: str, token: str, path: str, method: str = 'GET', body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    request = urllib.request.Request(base + path, data=data, method=method,
                                     headers={'Authorization': 'Bearer ' + token,
                                              'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def upload(base: str, token: str, path: Path):
    boundary = '----yorw-packaged-parser-verify'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
            'Content-Type: application/octet-stream\r\n\r\n').encode('utf-8') + path.read_bytes() + \
           f'\r\n--{boundary}--\r\n'.encode('utf-8')
    request = urllib.request.Request(base + '/v1/documents/import', data=body, method='POST',
                                     headers={'Authorization': 'Bearer ' + token,
                                              'Content-Type': 'multipart/form-data; boundary=' + boundary})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--backend', required=True)
    parser.add_argument('--samples', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--docling', required=True)
    parser.add_argument('--libreoffice', required=True)
    args = parser.parse_args()
    if args.report.exists():
        print('report path already exists', file=sys.stderr)
        return 2
    args.workspace.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ)
    environment['PATH'] = str(Path(args.libreoffice).parent) + os.pathsep + environment.get('PATH', '')
    environment.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')
    environment.setdefault('HF_HUB_DISABLE_XET', '1')
    child = subprocess.Popen([args.backend], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, env=environment)
    token = 'v' * 64
    try:
        child.stdin.write(json.dumps({'token': token, 'workspace_path': str(args.workspace.resolve())}) + '\n')
        child.stdin.flush()
        handshake = json.loads(child.stdout.readline())
        if handshake.get('type') != 'listening':
            raise RuntimeError(f'startup failed: {handshake}')
        base = f"http://127.0.0.1:{handshake['port']}"
        for _ in range(100):
            try:
                api(base, token, '/v1/health')
                break
            except (OSError, urllib.error.URLError):
                time.sleep(.1)
        current = api(base, token, '/v1/parsers')['settings']
        settings = {'enhanced_enabled': True, 'docling_executable': args.docling,
                    'docling_prefix': [], 'libreoffice_executable': args.libreoffice,
                    'timeout_seconds': 600, 'ocr_enabled': True, 'ocr_mode': 'full_page',
                    'ocr_engine': 'rapidocr', 'version': current['version']}
        api(base, token, '/v1/parsers', 'PUT', settings)
        capabilities = api(base, token, '/v1/parsers')['capabilities']
        items = []
        for name in ('fixture.docx', 'fixture-scanned.pdf'):
            path = args.samples / name
            imported = upload(base, token, path)
            identity = imported['document']['id']
            deadline = time.monotonic() + 240
            document = imported['document']
            while time.monotonic() < deadline:
                document = api(base, token, f'/v1/documents/{identity}')
                if document.get('parse_status') not in ('pending', 'running'):
                    break
                time.sleep(.2)
            blocks = api(base, token, f'/v1/documents/{identity}/blocks')['items']
            items.append({
                'file': name, 'format': document.get('format'),
                'parser_name': document.get('parser_name'),
                'parser_version': document.get('parser_version'),
                'parse_status': document.get('parse_status'),
                'parse_warning': document.get('parse_warning'),
                'block_count': len(blocks),
                'block_types': sorted({block['block_type'] for block in blocks}),
                'physical_pages': sorted({block['physical_page'] for block in blocks if block['physical_page']}),
                'preview': blocks[0]['text'][:120] if blocks else '',
            })
        report = {'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  'backend': args.backend, 'docling': args.docling,
                  'settings': settings, 'capabilities': capabilities, 'items': items}
        args.report.parent.mkdir(parents=True, exist_ok=True)
        with args.report.open('x', encoding='utf-8') as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
        for item in items:
            print(f"{item['file']}: {item['parse_status']} {item['block_count']} blocks "
                  f"({item['parser_name']}) pages={item['physical_pages']}")
        ok = all(item['parse_status'] in ('ready', 'partial') and item['block_count']
                 and item['parser_name'] == 'docling' for item in items)
        return 0 if ok else 1
    finally:
        try:
            child.stdin.write('shutdown\n')
            child.stdin.flush()
            child.wait(timeout=10)
        except Exception:
            child.kill()


if __name__ == '__main__':
    raise SystemExit(main())
