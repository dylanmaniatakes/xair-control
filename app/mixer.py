"""Upstream conversions with serialized, address-correlated OSC replies."""

import threading
import time

import xair_api

from .catalog import RATIOS, discover, validate
from .meters import ADDRESS, MeterStream


class EffectMode:
    """FX slot insert/send mode, absent from the upstream object graph."""

    def __init__(self, remote, index):
        self.remote, self.address = remote, f"/fx/{index + 1}/insert"

    @property
    def insert(self):
        return self.remote.query(self.address)[0] == 1

    @insert.setter
    def insert(self, value):
        self.remote.send(self.address, int(value))


class Mixer:
    def __init__(self, model="XR12", mode="demo", ip="127.0.0.1", port=10024):
        self.model, self.mode, self.ip, self.port = model, mode, ip, port
        self.lock = threading.RLock()
        self.condition = threading.Condition()
        self.responses = {}
        self.last_seen = 0
        self.last_error = None
        self.identity = {}
        self.last_probe = 0
        self.failures = {}
        self.remote = xair_api.connect(model, ip=ip, port=port)
        self.bindings = discover(self.remote)
        for i in range(4):
            path = f"fx.{i}.insert"
            self.bindings[path] = (
                EffectMode(self.remote, i),
                "insert",
                {"path": path, "label": "Insert mode", "type": "bool"},
            )
        self.wire = {}
        self.meters = MeterStream(
            self.remote, mode, len(self.remote.strip), len(self.remote.bus)
        )
        if mode == "demo":
            self.remote.send = self.demo_send
            self.remote.query = self.demo_query
            self.seed()
        else:
            # Upstream's query returns the last packet, regardless of address.
            # Correlate replies to their requested address and never reuse stale data.
            self.remote.server.verify_request = lambda request, client: (
                client[0] == self.ip
            )
            self.remote.msg_handler = self.receive
            self.remote.server.dispatcher.set_default_handler(self.receive)
            self.remote.query = self.query
            self.worker = threading.Thread(target=self.remote.run_server, daemon=True)
            self.worker.start()
        # Fix upstream's amixenable getter querying /config/mute.
        config_cls = type(self.remote.config)
        original = config_cls.amixenable
        config_cls.amixenable = property(
            lambda obj: obj.getter("amixenable")[0] == 1, original.fset
        )

    def seed(self):
        for path, (obj, name, meta) in self.bindings.items():
            if name == "mute" and ".group." not in path:
                continue
            kind = meta["type"]
            value = (
                False
                if kind == "bool"
                else ""
                if kind == "string"
                else meta["options"][0]
                if kind == "enum"
                else max(meta["min"], min(0, meta["max"]))
            )
            if name == "on":
                value = True
            if name in ("fader", "level"):
                value = -12.0
            if name == "name":
                root = path.split(".")
                value = f"Input {int(root[1]) + 1:02}" if root[0] == "strip" else ""
            if name == "frequency":
                value = 1000.0
            if name == "quality":
                value = 1.0
            setattr(obj, name, value)
        self.last_seen = time.time()

    def demo_send(self, address, value=None):
        if value is not None:
            self.wire[address] = tuple(value) if isinstance(value, list) else (value,)

    def demo_query(self, address):
        if address == "/xinfo":
            return ("127.0.0.1", "Demo mixer", self.model, "simulator")
        return self.wire.get(address, (0,))

    def receive(self, address, *values):
        if address == ADDRESS:
            self.meters.receive(values[0] if len(values) == 1 else None)
            return
        with self.condition:
            self.responses[address] = (time.monotonic(), values)
            if address == "/xinfo" and len(values) >= 4:
                self.identity = {
                    "mixer_name": str(values[1]),
                    "reported_model": str(values[2]),
                    "firmware": str(values[3]),
                }
            self.last_seen = time.time()
            self.condition.notify_all()

    def query(self, address):
        with self.condition:
            for _ in range(2):
                started = time.monotonic()
                self.remote.send(address)
                if self.condition.wait_for(
                    lambda: self.responses.get(address, (0,))[0] >= started, timeout=0.3
                ):
                    self.last_error = None
                    return self.responses[address][1]
            self.last_error = f"No reply for {address}"
            raise TimeoutError(self.last_error)

    def probe(self):
        if time.monotonic() - self.last_probe < 5:
            return
        self.last_probe = time.monotonic()
        try:
            info = self.remote.query("/xinfo")
            if len(info) >= 4:
                self.identity = {
                    "mixer_name": str(info[1]),
                    "reported_model": str(info[2]),
                    "firmware": str(info[3]),
                }
        except (TimeoutError, OSError):
            pass

    def read(self, path):
        obj, name, _ = self.bindings[path]
        if name == "hold":
            from xair_api.util import log_get

            return round(log_get(0.02, 2000, obj.getter("hold")[0]), 2)
        value = getattr(obj, name)
        # Upstream ratio reads a ratio but writes an index; expose stable indices.
        if name == "ratio":
            value = RATIOS.index(value)
        return value

    def apply(self, path, operation="set", value=None):
        obj, name, meta = self.bindings[path]
        if operation == "toggle":
            if meta["type"] != "bool":
                raise ValueError("Toggle requires a boolean control")
            value = not self.read(path)
        elif operation == "increment":
            if meta["type"] != "number":
                raise ValueError("Increment requires a numeric control")
            if type(value) not in (int, float):
                raise ValueError("Increment requires a number")
            value = self.read(path) + value
        value = validate(meta, value)
        setattr(obj, name, value)
        actual = self.read(path)
        # Integer and logarithmic conversions can round; report actual values.
        return {
            "path": path,
            "requested": value,
            "value": actual,
            "status": "read_back",
        }

    def close(self):
        self.meters.close()
        if self.mode != "demo":
            self.remote.server.shutdown()
            self.worker.join(timeout=2)
        self.remote.server.server_close()
