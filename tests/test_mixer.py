import threading
import time

import pytest
from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_message_builder import OscMessageBuilder
from pythonosc.osc_server import BlockingOSCUDPServer

from app.catalog import ROOTS
from app.mixer import Mixer


@pytest.fixture
def demo():
    mixer = Mixer()
    yield mixer
    mixer.close()


def test_every_upstream_writable_property_has_control(demo):
    found = set()

    def walk(obj, prefix):
        if isinstance(obj, tuple):
            for i, part in enumerate(obj):
                walk(part, f"{prefix}.{i}")
            return
        for cls in type(obj).__mro__:
            for key, value in vars(cls).items():
                if isinstance(value, property) and value.fset:
                    if not (
                        prefix.startswith(("config.monitor", "config.mute_group"))
                        and key in ("amixenable", "amixlock")
                    ):
                        found.add(f"{prefix}.{key}")
                elif not key.startswith("_") and (
                    isinstance(value, tuple) or hasattr(value, "_remote")
                ):
                    walk(value, f"{prefix}.{key}")

    for root in ROOTS:
        walk(getattr(demo.remote, root), root)
    assert set(demo.bindings) == found | {f"fx.{i}.insert" for i in range(4)}
    assert len(found) == 1413


@pytest.mark.parametrize(
    "model,count,buses",
    [("XR12", 12, 2), ("XR16", 16, 4), ("XR18", 16, 6), ("MR18", 16, 6)],
)
def test_model_dimensions(model, count, buses):
    m = Mixer(model=model)
    assert len(m.remote.strip) == count
    assert len(m.remote.bus) == buses
    assert len(m.remote.strip[0].send) == buses + 4
    for path in m.bindings:
        value = m.read(path)
        assert value is not None, path
    m.close()


def test_all_properties_round_trip(demo):
    for path, (_, _, meta) in demo.bindings.items():
        value = demo.read(path)
        result = demo.apply(path, value=value)
        assert (
            result["value"] == pytest.approx(value, abs=0.2)
            if isinstance(value, (int, float))
            else result["value"] == value
        )


@pytest.mark.parametrize(
    "db,wire", [(-90, 0), (-60, 0.0625), (-30, 0.25), (-10, 0.5), (0, 0.75), (10, 1)]
)
def test_fader_protocol_conversion(demo, db, wire):
    result = demo.apply("strip.0.mix.fader", value=db)
    assert demo.wire["/ch/01/mix/fader"][0] == pytest.approx(wire)
    assert result["value"] == db


def test_mute_and_ratio_are_symmetric(demo):
    demo.apply("strip.0.mute", value=True)
    assert demo.read("strip.0.mix.on") is False
    demo.apply("strip.0.mute", "toggle")
    assert demo.read("strip.0.mix.on") is True
    demo.apply("strip.0.dyn.ratio", value=7)
    assert demo.wire["/ch/01/dyn/ratio"] == (7,)
    assert demo.read("strip.0.dyn.ratio") == 7
    demo.apply("config.amixenable", value=True)
    assert demo.read("config.amixenable") is True


@pytest.mark.parametrize(
    "path,value",
    [
        ("strip.0.mix.fader", 11),
        ("strip.0.mix.fader", float("nan")),
        ("strip.0.mute", "false"),
        ("strip.0.dyn.ratio", 12),
        ("strip.0.config.color", 1.2),
        ("headamp.0.gain", 61),
        ("strip.0.eq.low.frequency", 0),
        ("strip.0.config.name", "x" * 13),
    ],
)
def test_invalid_values_cannot_send(demo, path, value):
    before = dict(demo.wire)
    with pytest.raises(ValueError):
        demo.apply(path, value=value)
    assert before == demo.wire


class SimulatedMixer:
    def __init__(self, wire):
        self.wire = dict(wire)
        self.writes = []
        self.ignore = False
        dispatcher = Dispatcher()
        dispatcher.set_default_handler(self.handle, needs_reply_address=True)
        self.server = BlockingOSCUDPServer(("127.0.0.1", 0), dispatcher)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def reply(self, client, address, values):
        builder = OscMessageBuilder(address=address)
        for value in values:
            builder.add_arg(value)
        self.server.socket.sendto(builder.build().dgram, client)

    def handle(self, client, address, *args):
        if args:
            self.wire[address] = args
            self.writes.append((address, args))
            return
        # An unsolicited packet must never satisfy a different query.
        self.reply(client, "/unrelated", (999,))
        if self.ignore:
            return
        self.reply(
            client,
            address,
            ("127.0.0.1", "UDP simulator", "XR12", "1.0")
            if address == "/xinfo"
            else self.wire.get(address, (0,)),
        )

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


def test_real_udp_serialization_correlation_and_disconnect(demo):
    sim = SimulatedMixer(demo.wire)
    real = Mixer(mode="live", ip="127.0.0.1", port=sim.server.server_address[1])
    try:
        assert real.remote.query("/xinfo")[2] == "XR12"
        assert sim.writes == []
        assert real.apply("strip.0.mix.fader", value=-6)["value"] == -6
        assert sim.writes[-1][0] == "/ch/01/mix/fader"
        assert sim.writes[-1][1][0] == pytest.approx(0.6)
        assert real.apply("strip.0.mute", "toggle")["value"] is True
        sim.ignore = True
        start = time.monotonic()
        with pytest.raises(TimeoutError):
            real.read("strip.0.mix.fader")
        assert time.monotonic() - start < 1.2
    finally:
        real.close()
        sim.close()


def test_numeric_enum_is_encoded_as_integer(demo):
    demo.apply("strip.0.dyn.ratio", value=7.0)
    assert type(demo.wire["/ch/01/dyn/ratio"][0]) is int


def test_fx_insert_mode_and_selection(demo):
    demo.apply("fx.2.insert", value=True)
    assert demo.wire["/fx/3/insert"] == (1,)
    assert demo.read("fx.2.insert") is True
    demo.apply("bus.0.insert.sel", value=8)
    assert demo.wire["/bus/1/insert/sel"] == (8,)
    assert demo.read("bus.0.insert.sel") == 8
    with pytest.raises(ValueError):
        demo.apply("lr.insert.sel", value=8)


def test_bus_effect_controls_over_udp(demo):
    sim = SimulatedMixer(demo.wire)
    real = Mixer(mode="live", ip="127.0.0.1", port=sim.server.server_address[1])
    try:
        for path, value, address in [
            ("fx.1.insert", True, "/fx/2/insert"),
            ("bus.0.insert.sel", 3, "/bus/1/insert/sel"),
            ("bus.0.insert.on", True, "/bus/1/insert/on"),
            ("bus.0.eq.low.type", 2, "/bus/1/eq/1/type"),
            ("bus.0.eq.low.gain", -3, "/bus/1/eq/1/g"),
            ("fxreturn.1.send.0.level", -12, "/rtn/2/mix/01/level"),
        ]:
            assert real.apply(path, value=value)["value"] == pytest.approx(value)
            assert sim.writes[-1][0] == address
    finally:
        real.close()
        sim.close()
