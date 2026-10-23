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
        assert health["ready"] and health["schema_version"] == 2
        assert "token" not in health
        with urllib.request.urlopen(urllib.request.Request(url.replace('/health', '/workspace'), headers={"Authorization": "Bearer " + token}), timeout=2) as response:
            info = json.load(response)
        assert info["schema_version"] == 2
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
