import ipaddress
import json
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .catalog import validate
from .layouts import Layout, validate_layout
from .mixer import Mixer

DATA = Path(os.getenv("DATA_DIR", "./data"))
DATA.mkdir(parents=True, exist_ok=True)
STORE_LOCK = threading.RLock()
STATE_LOCK = threading.RLock()


def persist(name, value):
    with STORE_LOCK:
        target = DATA / name
        temp = DATA / (name + ".tmp")
        temp.write_text(json.dumps(value, indent=2))
        temp.chmod(0o600)
        temp.replace(target)


def load(name, default):
    path = DATA / name
    return json.loads(path.read_text()) if path.exists() else default


settings = load(
    "settings.json",
    {"model": "XR12", "mode": "demo", "ip": "127.0.0.1", "port": 10024},
)
mixer = Mixer(**settings)
hooks = load("hooks.json", {})
activity = []
layouts = load("layouts.json", {})


@asynccontextmanager
async def lifespan(app):
    yield
    mixer.close()


app = FastAPI(
    title="X AIR Control",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)


def log_event(action, detail, ok=True):
    activity.insert(
        0, {"time": time.time(), "action": action, "detail": detail, "ok": ok}
    )
    del activity[100:]


class Command(BaseModel):
    path: str
    operation: Literal["set", "toggle", "increment"] = "set"
    value: Any = None


class ReadRequest(BaseModel):
    paths: list[str] = Field(max_length=100)


class Connection(BaseModel):
    model: Literal["XR12", "XR16", "XR18", "MR18"] = "XR12"
    mode: Literal["demo", "live"] = "demo"
    ip: str
    port: int = Field(default=10024, ge=1, le=65535)


class Hook(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    commands: list[Command] = Field(min_length=1, max_length=32)
    allow_get: bool = False


class Raw(BaseModel):
    address: str = Field(pattern=r"^/[A-Za-z0-9_./-]{1,127}$")
    operation: Literal["query", "send"] = "query"
    value: Any = None


def check_command(command):
    if command.path not in mixer.bindings:
        raise HTTPException(422, "Unknown control path")
    meta = mixer.bindings[command.path][2]
    try:
        if command.operation == "set":
            validate(meta, command.value)
        elif command.operation == "toggle" and meta["type"] != "bool":
            raise ValueError("Toggle requires a boolean")
        elif command.operation == "increment":
            import math

            if (
                meta["type"] != "number"
                or type(command.value) not in (int, float)
                or not math.isfinite(command.value)
            ):
                raise ValueError(
                    "Increment requires a finite number and numeric control"
                )
    except ValueError as e:
        raise HTTPException(422, str(e))


def execute(command):
    check_command(command)
    try:
        result = mixer.apply(command.path, command.operation, command.value)
        log_event(command.operation, command.path)
        return result
    except (TimeoutError, OSError) as e:
        log_event(command.operation, f"{command.path}: {e}", False)
        raise HTTPException(
            504, f"{e}. A write may have been sent; check the mixer before retrying."
        )
    except (ValueError, IndexError, TypeError) as e:
        raise HTTPException(422, str(e))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/status")
def status():
    with STATE_LOCK, mixer.lock:
        mixer.probe()
        return {
            **settings,
            **mixer.identity,
            "last_seen": mixer.last_seen,
            "last_error": mixer.last_error,
            "connected": mixer.mode == "demo" or time.time() - mixer.last_seen < 10,
            "controls": len(mixer.bindings),
        }


@app.get("/api/layouts")
def list_layouts():
    with STORE_LOCK:
        return dict(layouts)


@app.post("/api/layouts")
def create_layout(req: Layout):
    try:
        document = validate_layout(req)
    except ValueError as e:
        raise HTTPException(422, str(e))
    with STORE_LOCK:
        layout_id = secrets.token_urlsafe(12)
        layouts[layout_id] = document
        persist("layouts.json", layouts)
        return {"id": layout_id, **document}


@app.put("/api/layouts/{layout_id}")
def update_layout(layout_id: str, req: Layout):
    try:
        document = validate_layout(req)
    except ValueError as e:
        raise HTTPException(422, str(e))
    with STORE_LOCK:
        if layout_id not in layouts:
            raise HTTPException(404, "Unknown layout")
        layouts[layout_id] = document
        persist("layouts.json", layouts)
    return {"id": layout_id, **document}


@app.delete("/api/layouts/{layout_id}")
def delete_layout(layout_id: str):
    with STORE_LOCK:
        if layout_id not in layouts:
            raise HTTPException(404, "Unknown layout")
        del layouts[layout_id]
        persist("layouts.json", layouts)
    return {"deleted": True}


@app.get("/api/meters")
def meters():
    # This independent telemetry snapshot must not queue behind OSC property reads.
    current = mixer
    return current.meters.snapshot()


@app.get("/api/catalog")
def catalog():
    with STATE_LOCK:
        return [binding[2] for binding in mixer.bindings.values()]


@app.post("/api/read")
def read(req: ReadRequest):
    values, errors = {}, {}
    with STATE_LOCK, mixer.lock:
        deadline = time.monotonic() + 4
        for path in req.paths:
            if time.monotonic() > deadline:
                errors[path] = "Deferred; awaiting next refresh"
                continue
            failure = mixer.failures.get(path)
            if failure and time.monotonic() - failure[0] < 30:
                errors[path] = failure[1]
                continue
            if path not in mixer.bindings:
                errors[path] = "Unknown control"
                continue
            try:
                values[path] = mixer.read(path)
            except (TimeoutError, OSError, ValueError, IndexError, TypeError) as e:
                errors[path] = str(e)
                mixer.failures[path] = (time.monotonic(), str(e))
                if (
                    isinstance(e, (TimeoutError, OSError))
                    and time.time() - mixer.last_seen > 10
                ):
                    for remaining in req.paths:
                        if remaining not in values and remaining not in errors:
                            errors[remaining] = "Not read after timeout"
                    break
    return {"values": values, "errors": errors, "time": time.time()}


@app.post("/api/command")
def command(req: Command):
    with STATE_LOCK, mixer.lock:
        return execute(req)


@app.put("/api/connection")
def connection(req: Connection):
    global mixer, settings
    try:
        ipaddress.ip_address(req.ip)
    except ValueError:
        raise HTTPException(422, "Enter an IPv4 or IPv6 address")
    if ":" in req.ip:
        raise HTTPException(422, "OSC transport requires IPv4")
    with STATE_LOCK:
        candidate = Mixer(**req.model_dump())
        try:
            info = candidate.remote.query("/xinfo")
            if req.mode == "live" and (
                len(info) < 3 or str(info[2]).upper().removesuffix("W") != req.model
            ):
                raise ValueError(
                    f"Mixer model reply does not match {req.model}: {info}"
                )
        except (TimeoutError, OSError, ValueError) as e:
            candidate.close()
            raise HTTPException(502, str(e))
        mixer.close()
        mixer = candidate
        settings = req.model_dump()
        persist("settings.json", settings)
        log_event("connection", f"{req.mode} / {req.model}")
        return {"settings": settings, "info": info}


@app.post("/api/osc")
def osc(req: Raw):
    if req.value is not None:
        values = req.value if isinstance(req.value, list) else [req.value]
        import math

        if len(values) > 64 or any(
            type(v) not in (str, float, int, bool)
            or (isinstance(v, str) and len(v) > 1024)
            or (
                type(v) in (float, int)
                and (not math.isfinite(v) or abs(v) > 2147483647)
            )
            for v in values
        ):
            raise HTTPException(422, "Invalid OSC arguments")
    with STATE_LOCK, mixer.lock:
        try:
            if req.operation == "query":
                return {"value": mixer.remote.query(req.address)}
            mixer.remote.send(req.address, req.value)
            log_event("OSC send", req.address)
            return {"status": "sent", "verified": False}
        except (TimeoutError, OSError) as e:
            raise HTTPException(504, str(e))


@app.get("/api/hooks")
def list_hooks():
    with STORE_LOCK:
        return hooks


@app.post("/api/hooks")
def create_hook(req: Hook):
    with STATE_LOCK, STORE_LOCK:
        for cmd in req.commands:
            check_command(cmd)
        hook_id = secrets.token_urlsafe(24)
        hooks[hook_id] = {
            **req.model_dump(),
            "model": mixer.model,
            "mode": mixer.mode,
            "ip": mixer.ip,
            "port": mixer.port,
        }
        persist("hooks.json", hooks)
        return {"id": hook_id, **hooks[hook_id]}


@app.delete("/api/hooks/{hook_id}")
def delete_hook(hook_id: str):
    with STORE_LOCK:
        if hook_id not in hooks:
            raise HTTPException(404, "Unknown webhook")
        del hooks[hook_id]
        persist("hooks.json", hooks)
    return {"deleted": True}


@app.get("/hooks/{hook_id}")
@app.post("/hooks/{hook_id}")
def run_hook(hook_id: str, request: Request):
    with STATE_LOCK, mixer.lock, STORE_LOCK:
        hook = hooks.get(hook_id)
        if not hook:
            raise HTTPException(404, "Unknown webhook")
        if request.method == "GET" and not hook["allow_get"]:
            raise HTTPException(405, "Use POST for this webhook")
        if (
            hook["model"] != mixer.model
            or hook["mode"] != mixer.mode
            or (
                mixer.mode == "live"
                and (hook.get("ip") != mixer.ip or hook.get("port") != mixer.port)
            )
        ):
            raise HTTPException(
                409,
                "Webhook belongs to a different connection; recreate it for this mixer and mode",
            )
        commands = [Command(**c) for c in hook["commands"]]
        for cmd in commands:
            check_command(cmd)
        results = []
        for cmd in commands:
            try:
                results.append(execute(cmd))
            except HTTPException as e:
                raise HTTPException(
                    e.status_code,
                    {
                        "message": e.detail,
                        "completed": results,
                        "failed_path": cmd.path,
                        "atomic": False,
                    },
                )
        return {"results": results, "mode": mixer.mode}


@app.get("/api/activity")
def events():
    return activity


@app.middleware("http")
async def headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'"
    )
    return response


STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/docs", include_in_schema=False)
def docs():
    return FileResponse(STATIC / "docs.html")
