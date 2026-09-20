import pytest
from pydantic import ValidationError

from app.layouts import Layout, validate_layout


def test_layout_validation_and_model_boundaries():
    saved = validate_layout(
        Layout(
            name="Ham shack",
            model="XR12",
            hidden=["send.2", "strip.1"],
            order=["strip.6", "strip.0"],
            labels={"strip.0": "Voice"},
        )
    )
    assert saved["labels"] == {"strip.0": "Voice"}
    with pytest.raises(ValueError):
        validate_layout(Layout(name="Bad", model="XR12", hidden=["bus.5"]))
    with pytest.raises(ValidationError):
        Layout(name=" ", model="XR12")
    with pytest.raises(ValidationError):
        Layout(name="Bad", model="XR12", order=["strip.0", "strip.0"])
    with pytest.raises(ValidationError):
        Layout(name="Bad", model="XR12", labels={"strip.0": "x" * 33})
