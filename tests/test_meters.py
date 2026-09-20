import struct
import threading
import time
from types import SimpleNamespace

import pytest
from test_mixer import SimulatedMixer

from app.meters import MeterStream, channel_map, decode_bank
from app.mixer import Mixer


def blob(values):
    return struct.pack("<i40h", 40, *[round(value * 256) for value in values])


def test_wire_decoding_and_fixed_xr12_offsets():
    levels = [-float(i) for i in range(40)]
    decoded = decode_bank(blob(levels))
    assert decoded == levels
    mapped = channel_map(decoded, 12, 2)
    assert mapped["strip.11"] == [-11]
    assert "strip.12" not in mapped
    assert mapped["auxreturn"] == [-16, -17]
    assert mapped["fxreturn.3"] == [-24, -25]
    assert mapped["bus.1"] == [-27]
    assert "bus.2" not in mapped
    assert mapped["fxsend.0"] == [-32]
    assert mapped["fxsend.3"] == [-35]
    assert mapped["lr"] == [-36, -37]


@pytest.mark.parametrize(
    "payload",
    [
        None,
        "",
        b"",
        b"\0" * 83,
        b"\0" * 85,
        struct.pack("<i40h", 39, *([0] * 40)),
        struct.pack(">i40h", 40, *([0] * 40)),
    ],
)
def test_malformed_meter_blobs_are_rejected(payload):
    with pytest.raises(ValueError):
        decode_bank(payload)


def test_stale_frames_and_peak_hold():
    stream = MeterStream(None, "demo", 12, 2)
    assert stream.snapshot()["channels"] == {}
    try:
        stream.receive(blob([-12.5] * 40))
        stream.receive(blob([-30] * 40))
        frame = stream.snapshot()
        assert frame["channels"]["strip.0"]["dbfs"] == [-30]
        assert frame["channels"]["strip.0"]["peak_dbfs"] == [-12.5]
        assert frame["channels"]["lr"]["tap"] == "post"
        assert frame["channels"]["strip.0"]["tap"] == "pre"
        stream.receive(b"bad")
        assert stream.snapshot()["invalid_frames"] == 1
        assert stream.snapshot()["sequence"] == 2
        stream.last_frame = time.monotonic() - 2
        assert not stream.snapshot()["available"]
        assert stream.snapshot()["channels"] == {}
        stream.receive(blob([-128] * 40))
        assert stream.snapshot()["channels"]["strip.0"]["peak_dbfs"] == [-128]
    finally:
        stream.close()
    assert not stream.snapshot()["available"]


def test_subscription_renews_and_stops_when_viewer_leaves():
    sent = []
    notified = threading.Event()

    def send(address, args):
        sent.append((address, args))
        notified.set()

    stream = MeterStream(
        SimpleNamespace(send=send), "live", 12, 2, renew_interval=0.05, idle_after=0.14
    )
    try:
        assert not notified.wait(0.06), "No subscription without a viewer"
        stream.snapshot()
        assert notified.wait(0.5)
        notified.clear()
        assert notified.wait(0.5), "Subscription must renew"
        assert all(request == ("/meters", ["/meters/1", 1]) for request in sent)
        time.sleep(0.2)
        count = len(sent)
        time.sleep(0.1)
        assert len(sent) == count, "No renewal after viewer expires"
    finally:
        stream.close()
    assert not stream.worker.is_alive()


class MeterSimulator(SimulatedMixer):
    def handle(self, client, address, *args):
        if address == "/meters":
            self.reply(client, "/meters/1", (blob([-24.5] * 40),))
        else:
            # Interleaved meter frames must not satisfy a property query.
            self.reply(client, "/meters/1", (blob([-20] * 40),))
            super().handle(client, address, *args)


def test_real_udp_meter_subscription_and_control_query_isolation():
    sim = MeterSimulator({"/ch/01/mix/fader": (0.5,)})
    mixer = Mixer(mode="live", ip="127.0.0.1", port=sim.server.server_address[1])
    try:
        mixer.meters.snapshot()
        deadline = time.monotonic() + 1
        while not mixer.meters.snapshot()["available"] and time.monotonic() < deadline:
            time.sleep(0.01)
        frame = mixer.meters.snapshot()
        assert frame["available"]
        assert frame["channels"]["strip.0"]["dbfs"] == [-24.5]
        assert mixer.read("strip.0.mix.fader") == -10
        assert "/meters/1" not in mixer.responses
        assert sim.writes == [], "Meter subscriptions must not change controls"
    finally:
        mixer.close()
        sim.close()
