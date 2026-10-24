"""Private desktop service: configuration and lifetime are owned by stdin."""
import json
import secrets
import socket
import sqlite3
import sys
import threading
from pathlib import Path
from contextlib import asynccontextmanager
from .storage.workspace import Workspace
from .storage.database import Database, MigrationError
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def create_app(token: str, database: Database) -> FastAPI:
    from .library import Library, router as library_router
    library = Library(database)
    from .search import Search, router as search_router
    search = Search(library)
    from .chat import Chat, router as chat_router
    chat = Chat(search)
    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            chat.close()
            search.close()
            library.close()
            database.close()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        code = error.detail if isinstance(error.detail, str) and error.detail.isupper() else "REQUEST_FAILED"
        return JSONResponse(status_code=error.status_code, content={"error": {"code": code, "message": code, "retryable": False}, "request_id": str(uuid4())})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return JSONResponse(status_code=422, content={"error": {"code": "INVALID_CONFIG", "message": "Invalid request fields", "retryable": False}, "request_id": str(uuid4())})

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if not secrets.compare_digest(request.headers.get("authorization", ""), "Bearer " + token):
            return JSONResponse(status_code=401, content={"error": {"code": "UNAUTHORIZED", "message": "Session authentication required", "retryable": False}, "request_id": str(uuid4())})
        return await call_next(request)

    @app.get("/v1/health")
    async def health():
        return {"api_version": "1", "ready": True, "schema_version": database.version,
                "providers": {"chat": False, "embedding": False}}
    @app.get("/v1/workspace")
    def workspace_info():
        return database.workspace_info()
    from .providers import router
    app.include_router(router(database))
    app.include_router(library_router(library))
    from .notes import router as notes_router
    app.include_router(notes_router(database))
    app.include_router(search_router(search))
    app.include_router(chat_router(chat))
    from .garden import router as garden_router
    app.include_router(garden_router(database))
    return app


def main():
    config = json.loads(sys.stdin.readline())
    token = config.get("token", "")
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError("Invalid startup configuration")
    # Check the bundled runtime as well as the development interpreter.
    with sqlite3.connect(":memory:") as db:
        db.execute("CREATE VIRTUAL TABLE probe USING fts5(text)")
    try:
        workspace = Workspace(Path(config["workspace_path"]))
        database = Database(workspace)
    except Exception as error:
        code = str(error) if isinstance(error, MigrationError) else "WORKSPACE_OPEN_FAILED"
        print(json.dumps({"type": "startup_error", "code": code}), flush=True)
        return
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(create_app(token, database), log_level="warning", access_log=False))

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
