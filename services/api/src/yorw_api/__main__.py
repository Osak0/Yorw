"""Private desktop service: configuration and lifetime are owned by stdin."""
import json
import secrets
import socket
import sqlite3
import sys
import threading
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


def create_app(token: str) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if not secrets.compare_digest(request.headers.get("authorization", ""), "Bearer " + token):
            return JSONResponse(status_code=401, content={"error": {"code": "UNAUTHORIZED", "message": "Session authentication required", "retryable": False}, "request_id": str(uuid4())})
        return await call_next(request)

    @app.get("/v1/health")
    async def health():
        return {"api_version": "1", "ready": True, "schema_version": 0,
                "providers": {"chat": False, "embedding": False}}
    return app


def main():
    config = json.loads(sys.stdin.readline())
    token = config.get("token", "")
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError("Invalid startup configuration")
    # Check the bundled runtime as well as the development interpreter.
    with sqlite3.connect(":memory:") as db:
        db.execute("CREATE VIRTUAL TABLE probe USING fts5(text)")
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(create_app(token), log_level="warning", access_log=False))

    def watch_parent():
        # EOF also shuts down the service after an unexpected desktop exit.
        sys.stdin.readline()
        server.should_exit = True
    threading.Thread(target=watch_parent, daemon=True).start()
    print(json.dumps({"type": "listening", "port": sock.getsockname()[1]}), flush=True)
    try:
        server.run(sockets=[sock])
    finally:
        sock.close()


if __name__ == "__main__":
    main()
