import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app import main

    main = importlib.reload(main)
    with TestClient(main.app) as client:
        yield client


def test_local_access_and_static(client):
    assert client.get("/health").status_code == 200
    assert client.get("/").status_code == 200
    assert client.get("/api/catalog", headers={"Authorization": ""}).status_code == 200
    assert (
        client.post(
            "/api/command",
            headers={"Authorization": ""},
            json={"path": "strip.0.mute", "value": True},
        ).status_code
        == 200
    )
    assert len(client.get("/api/catalog").json()) == 1417


def test_read_set_toggle_increment(client):
    def command(**kwargs):
        return client.post("/api/command", json=kwargs)

    assert command(path="strip.0.mix.fader", value=-20).json()["value"] == -20
    assert (
        command(path="strip.0.mix.fader", operation="increment", value=2).json()[
            "value"
        ]
        == -18
    )
    assert command(path="strip.0.mute", operation="toggle").json()["value"] is True
    assert command(path="strip.0.mix.fader", value=100).status_code == 422
    assert command(path="__dict__", value={}).status_code == 422
    result = client.post(
        "/api/read", json={"paths": ["strip.0.mix.fader", "invalid"]}
    ).json()
    assert result["values"]["strip.0.mix.fader"] == -18
    assert "invalid" in result["errors"]


def test_webhook_auth_methods_persistence_revocation(client):
    payload = {
        "name": "Mic toggle",
        "commands": [{"path": "strip.0.mute", "operation": "toggle"}],
    }
    response = client.post("/api/hooks", json=payload)
    assert response.status_code == 200
    hook_id = response.json()["id"]
    assert client.get("/hooks/" + hook_id).status_code == 405
    result = client.post("/hooks/" + hook_id, headers={"Authorization": ""})
    assert result.status_code == 200
    assert result.json()["results"][0]["value"] is True
    from app import main

    assert hook_id in main.load("hooks.json", {})
    assert client.delete("/api/hooks/" + hook_id).status_code == 200
    assert client.post("/hooks/" + hook_id).status_code == 404


def test_webhook_partial_failure_and_mode_binding(client):
    hook = client.post(
        "/api/hooks",
        json={
            "name": "Bounded steps",
            "allow_get": True,
            "commands": [
                {"path": "strip.0.mix.fader", "value": 9},
                {"path": "strip.0.mix.fader", "operation": "increment", "value": 2},
            ],
        },
    ).json()
    r = client.get("/hooks/" + hook["id"])
    assert r.status_code == 422
    assert len(r.json()["detail"]["completed"]) == 1
    assert r.json()["detail"]["atomic"] is False
    from app import main

    main.hooks[hook["id"]]["mode"] = "live"
    assert client.post("/hooks/" + hook["id"]).status_code == 409


def test_raw_osc_and_connection_validation(client):
    assert (
        client.post("/api/osc", json={"address": "/xinfo"}).json()["value"][2] == "XR12"
    )
    assert (
        client.post(
            "/api/osc",
            json={"address": "/ch/01/mix/on", "operation": "send", "value": 0},
        ).json()["verified"]
        is False
    )
    assert (
        client.post("/api/read", json={"paths": ["strip.0.mute"]}).json()["values"][
            "strip.0.mute"
        ]
        is True
    )
    assert client.post("/api/osc", json={"address": "oops"}).status_code == 422
    assert (
        client.put(
            "/api/connection", json={"mode": "live", "model": "XR12", "ip": "invalid"}
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/connection", json={"mode": "demo", "model": "XR16", "ip": "127.0.0.1"}
        ).status_code
        == 200
    )
    assert client.get("/api/status").json()["model"] == "XR16"


def test_live_identity_names_and_model_alias_read_only(client):
    from test_mixer import SimulatedMixer

    from app import main

    sim = SimulatedMixer(main.mixer.wire)
    sim.wire["/ch/01/config/name"] = ("Mic",)
    original_reply = sim.reply

    def identity_reply(client_address, address, values):
        if address == "/xinfo":
            values = ("127.0.0.1", "Test XR12", "XR12W", "1.22")
        return original_reply(client_address, address, values)

    sim.reply = identity_reply
    try:
        payload = {
            "mode": "live",
            "model": "XR12",
            "ip": "127.0.0.1",
            "port": sim.server.server_address[1],
        }
        response = client.put("/api/connection", json=payload)
        assert response.status_code == 200
        status = client.get("/api/status").json()
        assert status["mixer_name"] == "Test XR12"
        assert status["reported_model"] == "XR12W"
        assert status["firmware"] == "1.22"
        read = client.post(
            "/api/read",
            json={
                "paths": [
                    "strip.0.config.name",
                    "strip.0.config.color",
                    "strip.0.mix.fader",
                    "strip.0.mute",
                ]
            },
        )
        assert read.json()["values"]["strip.0.config.name"] == "Mic"
        assert not read.json()["errors"]
        assert (
            client.put("/api/connection", json={**payload, "model": "XR18"}).status_code
            == 502
        )
        assert client.get("/api/status").json()["model"] == "XR12"
        assert sim.writes == []
    finally:
        sim.close()


def test_meter_endpoint_does_not_fabricate_demo_audio(client):
    response = client.get("/api/meters")
    assert response.status_code == 200
    assert response.json()["mode"] == "demo"
    assert response.json()["available"] is False
    assert response.json()["channels"] == {}


def test_layout_crud_persistence_without_mixer_access(client, monkeypatch):
    from app import main

    def forbidden(*args, **kwargs):
        raise AssertionError("Layout editing must not access mixer transport")

    monkeypatch.setattr(main.mixer.remote, "send", forbidden)
    monkeypatch.setattr(main.mixer.remote, "query", forbidden)
    payload = {
        "name": "Ham shack",
        "model": "XR12",
        "hidden": ["send.2", "strip.5"],
        "order": ["strip.6", "strip.0"],
        "labels": {"strip.0": "My mic"},
    }
    r = client.post("/api/layouts", json=payload)
    assert r.status_code == 200
    ident = r.json()["id"]
    assert client.get("/api/layouts").json()[ident]["hidden"] == payload["hidden"]
    assert main.load("layouts.json", {})[ident]["labels"] == payload["labels"]
    r = client.put("/api/layouts/" + ident, json={**payload, "hidden": []})
    assert r.status_code == 200
    assert not main.load("layouts.json", {})[ident]["hidden"]
    assert (
        client.post(
            "/api/layouts", json={**payload, "hidden": ["strip.99"]}
        ).status_code
        == 422
    )
    assert client.delete("/api/layouts/" + ident).status_code == 200
    assert ident not in main.load("layouts.json", {})
    assert client.put("/api/layouts/" + ident, json=payload).status_code == 404


def test_fresh_install_starts_without_a_private_mixer_address(client):
    status = client.get("/api/status").json()
    assert status["mode"] == "demo"
    assert status["ip"] == "127.0.0.1"
