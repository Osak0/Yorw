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
def test_authentication_health_and_parent_eof(frozen):
    executable = ROOT / "dist/yorw-api/yorw-api.exe"
    if frozen and not executable.exists():
        pytest.skip("Build backend first")
    command = [str(executable)] if frozen else [sys.executable, "-m", "yorw_api"]
    child = subprocess.Popen(command, cwd=ROOT / "src", stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        token = "t" * 64
        child.stdin.write(json.dumps({"token": token}) + "\n")
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
        assert health["ready"] and health["schema_version"] == 0
        assert "token" not in health
        for headers in [{}, {"Authorization": "Bearer invalid"}]:
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=2)
            assert error.value.code == 401
        child.stdin.close()
        assert child.wait(timeout=8) == 0
    finally:
        if child.poll() is None:
            child.kill()
        child.wait(timeout=5)
