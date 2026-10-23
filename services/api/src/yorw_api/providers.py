"""Small OpenAI-compatible connection probe; never logs upstream bodies or keys."""
import json
import math
import socket
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from .storage.database import Database

Kind = Literal["chat", "embedding"]

class ProviderConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    base_url: str = Field(min_length=1, max_length=2048)
    model: str = Field(min_length=1, max_length=200)
    version: int = Field(ge=0)

    @field_validator("base_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        url = urlsplit(value)
        if (url.scheme != "https" and not (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"})) or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("Use an HTTPS API base URL, or HTTP loopback for local models")
        return value.rstrip("/")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class ProbeError(Exception):
    def __init__(self, code: str):
        self.code = code


def probe(kind: str, config: dict, key: str, timeout: float = 15) -> dict:
    if not key:
        raise ProbeError("KEY_MISSING")
    payload = {"model": config["model"]}
    payload.update({"messages": [{"role": "user", "content": "Reply OK."}], "stream": False} if kind == "chat" else {"input": ["Yorw connection test"], "encoding_format": "float"})
    if kind == 'embedding' and urlsplit(config['base_url']).hostname == 'open.bigmodel.cn':
        payload.pop('encoding_format', None)
    if kind == "chat" and urlsplit(config["base_url"]).hostname == "api.deepseek.com":
        payload.update({"thinking": {"type": "disabled"}, "max_tokens": 32})
    path = "/chat/completions" if kind == "chat" else "/embeddings"
    request = urllib.request.Request(config["base_url"] + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout) as response:
            body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ProbeError("RESPONSE_TOO_LARGE")
        data = json.loads(body)
        if kind == "chat":
            content = data["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise ValueError()
            return {"ok": True, "code": "CONNECTED"}
        vector = data["data"][0]["embedding"]
        if not isinstance(vector, list) or not vector or not all(type(x) in (int, float) and math.isfinite(x) for x in vector):
            raise ValueError()
        return {"ok": True, "code": "CONNECTED", "dimension": len(vector)}
    except urllib.error.HTTPError as error:
        raise ProbeError({402: "INSUFFICIENT_BALANCE", 401: "AUTH_FAILED", 403: "AUTH_FAILED", 404: "MODEL_OR_ENDPOINT_NOT_FOUND", 429: "RATE_LIMITED"}.get(error.code, "UPSTREAM_HTTP_ERROR")) from None
    except (TimeoutError, socket.timeout):
        raise ProbeError("TIMEOUT") from None
    except urllib.error.URLError as error:
        raise ProbeError("TIMEOUT" if isinstance(error.reason, TimeoutError) else "NETWORK_ERROR") from None
    except (ValueError, KeyError, IndexError, TypeError):
        raise ProbeError("INVALID_RESPONSE") from None


def router(database: Database) -> APIRouter:
    routes = APIRouter(prefix="/v1/providers")
    def configs():
        with database.lock:
            rows = database.connection.execute("SELECT kind, base_url, model, version FROM provider_configs ORDER BY kind").fetchall()
        return [dict(zip(("kind", "base_url", "model", "version"), row)) for row in rows]

    @routes.get("")
    def get_configs():
        return {"items": configs()}

    @routes.put("/{kind}")
    def save(kind: Kind, config: ProviderConfig):
        with database.write() as db:
            old = db.execute("SELECT version FROM provider_configs WHERE kind=?", (kind,)).fetchone()
            if (old[0] if old else 0) != config.version:
                raise HTTPException(409, detail="CONFIG_CONFLICT")
            db.execute("INSERT INTO provider_configs(kind,base_url,model,version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(kind) DO UPDATE SET base_url=excluded.base_url,model=excluded.model,version=excluded.version,updated_at=excluded.updated_at", (kind, config.base_url, config.model, config.version + 1, datetime.now(timezone.utc).isoformat()))
        return next(item for item in configs() if item["kind"] == kind)

    @routes.post("/{kind}/test")
    def test(kind: Kind, x_provider_key: str = Header(default="")):
        config = next((item for item in configs() if item["kind"] == kind), None)
        if not config:
            return {"ok": False, "code": "CONFIG_MISSING"}
        try:
            return probe(kind, config, x_provider_key)
        except ProbeError as error:
            return {"ok": False, "code": error.code}
    return routes
