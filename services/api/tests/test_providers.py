import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest
from pydantic import ValidationError

from yorw_api.providers import ProviderConfig, ProbeError, probe

@pytest.fixture
def upstream():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert self.headers["Authorization"] == "Bearer fixture-key"
            if data["model"] == "unauthorized":
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b"sensitive provider error fixture-key")
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({"choices": [{"message": {"content": "OK"}}]} if self.path.endswith("/chat/completions") else {"data": [{"embedding": [0.2, 0.4]}]}).encode())
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()


def test_chat_embedding_and_redacted_auth_failure(upstream):
    config = {"base_url": upstream, "model": "fixture"}
    assert probe("chat", config, "fixture-key")["ok"]
    assert probe("embedding", config, "fixture-key")["dimension"] == 2
    with pytest.raises(ProbeError) as error:
        probe("chat", {**config, "model": "unauthorized"}, "fixture-key")
    assert error.value.code == "AUTH_FAILED"
    assert "fixture-key" not in str(error.value)
    with pytest.raises(ProbeError) as error:
        probe("chat", config, "")
    assert error.value.code == "KEY_MISSING"


@pytest.mark.parametrize("url", ["http://example.com", "https://key@example.com", "https://example.com?key=secret", "file:///tmp/example"])
def test_unsafe_or_secret_bearing_urls_are_rejected(url):
    with pytest.raises(ValidationError):
        ProviderConfig(base_url=url, model="model", version=0)
