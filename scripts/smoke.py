"""Exercise the running Docker deployment in DEMO ONLY, including restart persistence."""

import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base-url", default="http://127.0.0.1:8088")
parser.add_argument("--project-name")
parser.add_argument("--compose-file", default="compose.yaml")
args = parser.parse_args()
base = args.base_url.rstrip("/")
compose = ["docker", "compose", "-f", args.compose_file]
if args.project_name:
    compose += ["-p", args.project_name]


def call(path, data=None, method=None):
    request = urllib.request.Request(
        base + path,
        data=json.dumps(data).encode() if data is not None else None,
        method=method,
    )
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def wait_for_health():
    deadline = time.monotonic() + 25
    while True:
        try:
            assert call("/health")["status"] == "ok"
            break
        except (OSError, AssertionError):
            if time.monotonic() > deadline:
                raise
            time.sleep(0.3)


wait_for_health()
assert call("/api/status")["mode"] == "demo", (
    "This test refuses to write to a live mixer"
)
assert len(call("/api/catalog")) == 1417
hook = None
try:
    hook = call(
        "/api/hooks",
        {
            "name": "Docker smoke test",
            "commands": [{"path": "strip.0.mix.fader", "value": -8}],
            "allow_get": False,
        },
    )
    assert call("/hooks/" + hook["id"], method="POST")["results"][0]["value"] == -8
    assert len(call("/api/catalog")) == 1417
    subprocess.run(compose + ["restart", "xair"], check=True, capture_output=True)
    wait_for_health()
    assert hook["id"] in call("/api/hooks")
    assert call("/hooks/" + hook["id"], method="POST")["results"][0]["value"] == -8
    assert call("/api/status")["mode"] == "demo"
    print(
        "PASS: login-free container access, 1417 controls, webhook execution, restart persistence, and health"
    )
finally:
    if hook:
        call("/api/hooks/" + hook["id"], method="DELETE")
    call("/api/command", {"path": "strip.0.mix.fader", "value": -12})
