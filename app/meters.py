"""X AIR bank 1: little-endian int32 count + 40 int16 levels (1/256 dB).

The wire bank always uses the XR18 layout, including unused XR12 positions.
Meter subscriptions request telemetry only; they do not modify mixer controls.
"""

import struct
import threading
import time

ADDRESS = "/meters/1"
STALE_AFTER = 1.0


def decode_bank(blob):
    if not isinstance(blob, bytes) or len(blob) != 84:
        raise ValueError("Expected an 84-byte X AIR meter bank")
    if struct.unpack_from("<i", blob)[0] != 40:
        raise ValueError("Expected 40 meter values")
    return [value / 256 for value in struct.unpack_from("<40h", blob, 4)]


def channel_map(levels, strips, buses):
    # Fixed wire offsets, NOT offsets based on the model's physical channel count.
    channels = {f"strip.{i}": [levels[i]] for i in range(strips)}
    channels["auxreturn"] = levels[16:18]
    channels.update(
        {f"fxreturn.{i}": levels[18 + 2 * i : 20 + 2 * i] for i in range(4)}
    )
    channels.update({f"bus.{i}": [levels[26 + i]] for i in range(buses)})
    channels.update({f"fxsend.{i}": [levels[32 + i]] for i in range(4)})
    channels["lr"] = levels[36:38]
    return channels


class MeterStream:
    def __init__(self, remote, mode, strips, buses, renew_interval=5, idle_after=3):
        self.remote = remote
        self.mode, self.strips, self.buses = mode, strips, buses
        self.renew_interval, self.idle_after = renew_interval, idle_after
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.closed = False
        self.active_until = 0
        self.last_request = 0
        self.last_frame = None
        self.sequence = 0
        self.invalid_frames = 0
        self.last_error = None
        self.levels = None
        self.peaks = None
        self.peak_until = [0.0] * 40
        self.worker = None
        if mode == "live":
            self.worker = threading.Thread(
                target=self.run, daemon=True, name="xair-meters"
            )
            self.worker.start()

    def receive(self, blob):
        try:
            levels = decode_bank(blob)
        except ValueError:
            with self.lock:
                self.invalid_frames += 1
            return
        now = time.monotonic()
        with self.lock:
            if self.closed:
                return
            fresh = self.last_frame is not None and now - self.last_frame <= STALE_AFTER
            elapsed = now - self.last_frame if fresh else 0
            if not fresh:
                self.peaks = levels[:]
                self.peak_until = [now + 1] * 40
            else:
                for i, level in enumerate(levels):
                    if level >= self.peaks[i]:
                        self.peaks[i] = level
                        self.peak_until[i] = now + 1
                    elif now > self.peak_until[i]:
                        self.peaks[i] = max(level, self.peaks[i] - 18 * elapsed)
            self.levels = levels
            self.last_frame = now
            self.sequence += 1
            self.last_error = None

    def snapshot(self):
        now = time.monotonic()
        with self.lock:
            if self.mode == "live" and not self.closed:
                self.active_until = now + self.idle_after
                self.wake.set()
            age = None if self.last_frame is None else max(0, now - self.last_frame)
            fresh = not self.closed and age is not None and age <= STALE_AFTER
            result = {
                "available": fresh,
                "mode": self.mode,
                "sequence": self.sequence,
                "age_ms": None if age is None else round(age * 1000),
                "invalid_frames": self.invalid_frames,
                "source": ADDRESS,
                "unit": "dBFS",
                "channels": {},
                "reason": None
                if fresh
                else "No simulated audio"
                if self.mode == "demo"
                else "Waiting for meter data",
            }
            if fresh:
                mapped = channel_map(self.levels, self.strips, self.buses)
                peaks = channel_map(self.peaks, self.strips, self.buses)
                result["channels"] = {
                    root: {
                        "dbfs": values,
                        "peak_dbfs": peaks[root],
                        "tap": "post" if root == "lr" else "pre",
                    }
                    for root, values in mapped.items()
                }
            return result

    def run(self):
        while not self.stop.is_set():
            now = time.monotonic()
            with self.lock:
                due = (
                    now < self.active_until
                    and now - self.last_request >= self.renew_interval
                )
                if due:
                    self.last_request = now
            if due:
                try:
                    # Repeating the subscription renews its ~10s mixer-side lifetime.
                    self.remote.send("/meters", [ADDRESS, 1])
                except OSError as e:
                    with self.lock:
                        self.last_error = str(e)
            self.wake.wait(timeout=min(0.25, self.renew_interval))
            self.wake.clear()

    def close(self):
        with self.lock:
            self.closed = True
        self.stop.set()
        self.wake.set()
        if self.worker:
            self.worker.join(timeout=2)
