"""Display-only layout documents; this module has no mixer transport access."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Layout(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    model: Literal["XR12", "XR16", "XR18", "MR18"]
    hidden: list[str] = Field(default_factory=list, max_length=128)
    order: list[str] = Field(default_factory=list, max_length=128)
    labels: dict[str, str] = Field(default_factory=dict, max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Enter a layout name")
        return value

    @field_validator("hidden", "order")
    @classmethod
    def unique_items(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Duplicate layout item")
        return value

    @field_validator("labels")
    @classmethod
    def clean_labels(cls, labels):
        if any(len(v) > 32 or any(ord(c) < 32 for c in v) for v in labels.values()):
            raise ValueError("Display names must be at most 32 printable characters")
        return {k: v.strip() for k, v in labels.items() if v.strip()}


def allowed_items(model):
    strips, buses = {
        "XR12": (12, 2),
        "XR16": (16, 4),
        "XR18": (16, 6),
        "MR18": (16, 6),
    }[model]
    return [
        *[f"strip.{i}" for i in range(strips)],
        *[f"bus.{i}" for i in range(buses)],
        *[f"fxsend.{i}" for i in range(4)],
        *[f"fxreturn.{i}" for i in range(4)],
        "auxreturn",
        "lr",
        *[f"send.{i}" for i in range(buses + 4)],
    ]


def validate_layout(layout):
    allowed = set(allowed_items(layout.model))
    if (set(layout.hidden) | set(layout.order) | set(layout.labels)) - allowed:
        raise ValueError("Unknown layout item for this model")
    return layout.model_dump()
