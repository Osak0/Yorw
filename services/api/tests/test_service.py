import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

@pytest.mark.parametrize("frozen", [False, True])
def test_authentication_health_and_parent_eof(frozen, tmp_path):
    executable = ROOT / "dist/yorw-api/yorw-api.exe"
    if frozen and not executable.exists():
        pytest.skip("Build backend first")
    command = [str(executable)] if frozen else [sys.executable, "-m", "yorw_api"]
    child = subprocess.Popen(command, cwd=ROOT / "src", stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        token = "t" * 64
        child.stdin.write(json.dumps({"token": token, "workspace_path": str(tmp_path / "workspace")}) + "\n")
        child.stdin.flush()
        handshake = json.loads(child.stdout.readline())
        url = f"http://127.0.0.1:{handshake['port']}/v1/health"
        for _ in range(100):
            try:
                request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
                with urllib.request.urlopen(request, timeout=1) as response:
                    health = json.load(response)
                break
            except (OSError, urllib.error.URLError):
                time.sleep(.1)
        else:
            pytest.fail("Backend readiness timed out")
        assert health["ready"] and health["schema_version"] == 16
        assert "token" not in health
        with urllib.request.urlopen(urllib.request.Request(url.replace('/health', '/workspace'), headers={"Authorization": "Bearer " + token}), timeout=2) as response:
            info = json.load(response)
        assert info["schema_version"] == 16
        assert "workspace_path" not in info
        assert (tmp_path / "workspace/yorw.sqlite3").exists()
        for headers in [{}, {"Authorization": "Bearer invalid"}]:
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=2)
            assert error.value.code == 401
        provider_url = url.replace('/health', '/providers')
        for kind in ('chat', 'embedding'):
            payload = {"base_url": "https://api.deepseek.com" if kind == 'chat' else "https://example.com/v1", "model": "deepseek-flash" if kind == 'chat' else "fixture-embedding", "version": 0}
            request = urllib.request.Request(provider_url + '/' + kind, data=json.dumps(payload).encode(), method='PUT', headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=2) as response:
                assert json.load(response)['version'] == 1
            with pytest.raises(urllib.error.HTTPError) as conflict:
                urllib.request.urlopen(request, timeout=2)
            assert conflict.value.code == 409
        with urllib.request.urlopen(urllib.request.Request(provider_url, headers={"Authorization": "Bearer " + token}), timeout=2) as response:
            configs = json.load(response)['items']
        assert {item['kind'] for item in configs} == {'chat', 'embedding'}
        assert all('key' not in item for item in configs)
        from io import BytesIO
        from pypdf import PdfWriter
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.add_blank_page(width=100, height=100)
        pdf = BytesIO()
        writer.write(pdf)
        boundary = 'yorw-fixture-boundary'
        upload = ('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="fixture.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode() + pdf.getvalue() + ('\r\n--' + boundary + '--\r\n').encode()
        documents_url = url.replace('/health', '/documents')
        request = urllib.request.Request(documents_url + '/import', data=upload, headers={"Authorization": "Bearer " + token, "Content-Type": "multipart/form-data; boundary=" + boundary})
        with urllib.request.urlopen(request, timeout=5) as response:
            imported = json.load(response)
        identity = imported['document']['id']
        for _ in range(100):
            with urllib.request.urlopen(urllib.request.Request(documents_url + '/' + identity, headers={"Authorization": "Bearer " + token}), timeout=2) as response:
                document = json.load(response)
            if document['extraction_status'] not in ('pending', 'running'):
                break
            time.sleep(.05)
        assert document['extraction_status'] == 'unsupported' and document['warning'] == 'NO_TEXT_NO_OCR'
        with urllib.request.urlopen(request, timeout=5) as response:
            assert json.load(response)['deduplicated']
        request = urllib.request.Request(documents_url + '/' + identity, data=json.dumps({'version': document['version'], 'title': 'Manual fixture', 'authors': ['Fixture'], 'year': 2026}).encode(), method='PATCH', headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=2) as response:
            edited = json.load(response)
        assert edited['title'] == 'Manual fixture'
        with urllib.request.urlopen(urllib.request.Request(documents_url + '/' + identity + '/file', headers={"Authorization": "Bearer " + token}), timeout=2) as response:
            assert response.read() == pdf.getvalue()
        position_request = urllib.request.Request(documents_url + '/' + identity + '/position', data=json.dumps({'page': 2}).encode(), method='PATCH', headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(position_request, timeout=2) as response:
            assert json.load(response)['page'] == 2
        with urllib.request.urlopen(urllib.request.Request(documents_url + '/' + identity, headers={"Authorization": "Bearer " + token}), timeout=2) as response:
            positioned = json.load(response)
        assert positioned['last_page'] == 2 and positioned['version'] == edited['version']
        invalid_position = urllib.request.Request(documents_url + '/' + identity + '/position', data=json.dumps({'page': 3}).encode(), method='PATCH', headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with pytest.raises(urllib.error.HTTPError) as invalid:
            urllib.request.urlopen(invalid_position, timeout=2)
        assert invalid.value.code == 422
        from uuid import uuid4
        note_id = str(uuid4())
        notes_url = url.replace('/health', '/notes')
        note_payload = {'id': note_id, 'document_id': identity, 'body_md': '# Restart fixture\n\n中文笔记'}
        note_request = urllib.request.Request(notes_url, data=json.dumps(note_payload).encode(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(note_request, timeout=2) as response:
            note = json.load(response)
        assert note['version'] == 1 and note['sources'] == []
        note_update = urllib.request.Request(notes_url + '/' + note_id, data=json.dumps({'body_md': 'Saved after edit 中文', 'version': 1}).encode(), method='PATCH', headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(note_update, timeout=2) as response:
            assert json.load(response)['version'] == 2
        with pytest.raises(urllib.error.HTTPError) as conflict:
            urllib.request.urlopen(note_update, timeout=2)
        assert conflict.value.code == 409
        request = urllib.request.Request(documents_url + '/' + identity + '?version=' + str(edited['version']), method='DELETE', headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(request, timeout=2) as response:
            assert json.load(response)['removed']
        assert not (tmp_path / 'workspace/documents' / (identity + '.pdf')).exists()
        child.stdin.close()
        assert child.wait(timeout=8) == 0
        # A new process reopens the same workspace; removal retains historical notes.
        child = subprocess.Popen(command, cwd=ROOT / "src", stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        child.stdin.write(json.dumps({"token": token, "workspace_path": str(tmp_path / "workspace")}) + "\n")
        child.stdin.flush()
        restart = json.loads(child.stdout.readline())
        restarted_url = f"http://127.0.0.1:{restart['port']}/v1/notes?document_id={identity}"
        for _ in range(100):
            try:
                with urllib.request.urlopen(urllib.request.Request(restarted_url, headers={"Authorization": "Bearer " + token}), timeout=1) as response:
                    restored = json.load(response)['items']
                break
            except (OSError, urllib.error.URLError):
                time.sleep(.1)
        else:
            pytest.fail('Restarted notes endpoint did not become ready')
        assert len(restored) == 1 and restored[0]['body_md'] == 'Saved after edit 中文'
        assert restored[0]['version'] == 2 and not restored[0]['document_available']
        child.stdin.close()
        assert child.wait(timeout=8) == 0
    finally:
        if child.poll() is None:
            child.kill()
        child.wait(timeout=5)


def test_newer_database_is_reported_without_ready(tmp_path):
    import sqlite3
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    path = workspace / "yorw.sqlite3"
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA user_version=99")
    before = path.read_bytes()
    result = subprocess.run([sys.executable, "-m", "yorw_api"], cwd=ROOT / "src", input=json.dumps({"token": "t" * 64, "workspace_path": str(workspace)}) + "\n", capture_output=True, text=True, timeout=10)
    assert json.loads(result.stdout) == {"type": "startup_error", "code": "DATABASE_TOO_NEW"}
    assert path.read_bytes() == before
