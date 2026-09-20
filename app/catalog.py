"""Discover every writable property from the pinned upstream object graph."""

import inspect
import math

ROOTS = (
    "strip",
    "lr",
    "bus",
    "fx",
    "fxsend",
    "fxreturn",
    "auxreturn",
    "dca",
    "config",
    "headamp",
)
BOOLS = set(
    [
        "on",
        "mute",
        "phantom",
        "usbinput",
        "invert",
        "highpasson",
        "lr",
        "filteron",
        "auto",
        "link_eq",
        "link_dyn",
        "link_fader_mute",
        "amixenable",
        "amixlock",
        "chmode",
        "busmode",
        "dim",
        "mono",
        "dimfpl",
    ]
)
RANGES = {
    "color": (0, 15),
    "inputsource": (0, 18),
    "usbreturn": (0, 18),
    "usbtrim": (-18, 18),
    "highpassfilter": (20, 400),
    "range": (3, 60),
    "attack": (0, 120),
    "hold": (0.02, 2000),
    "release": (5, 4000),
    "keysource": (0, 22),
    "filtertype": (0, 8),
    "filterfreq": (20, 20000),
    "ratio": (0, 11),
    "knee": (0, 5),
    "mgain": (0, 24),
    "mix": (0, 100),
    "sel": (0, 4),
    "frequency": (20, 20000),
    "quality": (0.3, 10),
    "fader": (-90, 10),
    "level": (-90, 10),
    "dca": (0, 15),
    "weight": (-12, 12),
    "source": (0, 14),
    "sourcetrim": (-18, 18),
    "dimgain": (-40, 0),
}
INTS = set(
    [
        "color",
        "inputsource",
        "usbreturn",
        "highpassfilter",
        "range",
        "attack",
        "release",
        "keysource",
        "filtertype",
        "ratio",
        "knee",
        "mix",
        "sel",
        "type",
        "dca",
        "group",
        "source",
        "dimgain",
    ]
)
RATIOS = [1.1, 1.3, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 20, 100]


def metadata(path):
    name = path.split(".")[-1]
    result = {
        "path": path,
        "label": name.replace("_", " ").capitalize(),
        "type": "number",
        "step": 0.1,
    }
    if name in BOOLS or name.startswith(("chlink", "buslink")):
        result["type"] = "bool"
    if ".group." in path:
        result.update(type="number", min=0, max=15, step=1)
    elif name == "name":
        result.update(type="string", maxLength=12)
    elif name == "mode":
        result.update(
            type="enum",
            options=["exp2", "exp3", "exp4", "gate", "duck"]
            if ".gate." in path
            else ["comp", "exp"]
            if ".dyn." in path
            else ["peq", "geq", "teq"],
        )
    elif name in ("det", "env"):
        result.update(
            type="enum", options=["peak", "rms"] if name == "det" else ["lin", "log"]
        )
    elif result["type"] == "number":
        if name in RANGES:
            result["min"], result["max"] = RANGES[name]
        elif name == "threshold":
            result.update(min=-80 if ".gate." in path else -60, max=0)
        elif name == "gain":
            result.update(
                min=-12 if path.startswith("headamp.") else -15,
                max=60 if path.startswith("headamp.") else 15,
            )
        elif name.startswith("slider_"):
            result.update(min=-15, max=15)
        elif name == "group":
            result.update(min=0, max=2)
        elif name == "type":
            result.update(min=0, max=127 if path.startswith("fx.") else 5)
        else:
            raise ValueError(f"No metadata for {path}")
        result["step"] = 1 if name in INTS else 0.01 if name == "hold" else 0.1
    if name == "sel" and ".insert." in path:
        labels = ["Off"] + (
            [f"FX {i}" for i in range(1, 5)]
            if path.startswith("lr.")
            else [f"FX {i} · {side}" for i in range(1, 5) for side in ("A", "B")]
        )
        result.update(
            type="enum", options=list(range(len(labels))), optionLabels=labels
        )
    if name == "type" and ".eq." in path:
        result.update(
            type="enum",
            options=list(range(6)),
            optionLabels=[
                "Low cut",
                "Low shelf",
                "Parametric",
                "Vintage",
                "High shelf",
                "High cut",
            ],
        )
    if name == "ratio":
        result.update(
            type="enum",
            options=list(range(12)),
            optionLabels=[f"{x}:1" for x in RATIOS],
        )
    if name == "phantom":
        result["warning"] = (
            "48 V phantom power changes the electrical supply to connected equipment."
        )
    if name in (
        "fader",
        "level",
        "gain",
        "threshold",
        "weight",
        "mgain",
        "usbtrim",
        "sourcetrim",
        "dimgain",
    ) or name.startswith("slider_"):
        result["unit"] = "dB"
    if name in ("frequency", "filterfreq", "highpassfilter"):
        result["unit"] = "Hz"
    if name in ("attack", "hold", "release"):
        result["unit"] = "ms"
    return result


def discover(remote):
    bindings = {}

    def visit(obj, path):
        if isinstance(obj, tuple):
            for i, child in enumerate(obj):
                visit(child, f"{path}.{i}")
            return
        for name in dir(obj):
            if name.startswith("_"):
                continue
            attr = inspect.getattr_static(obj, name)
            childpath = f"{path}.{name}"
            if isinstance(attr, property):
                # Config's dynamic subclasses inherit two unrelated top-level controls.
                if path.startswith(
                    ("config.monitor", "config.mute_group")
                ) and name in ("amixenable", "amixlock"):
                    continue
                if attr.fset:
                    bindings[childpath] = (obj, name, metadata(childpath))
            elif isinstance(attr, tuple) or (
                not inspect.isclass(attr)
                and hasattr(attr, "__dict__")
                and "_remote" in vars(attr)
                and not callable(attr)
            ):
                visit(attr, childpath)

    for root in ROOTS:
        visit(getattr(remote, root), root)
    return bindings


def validate(meta, value):
    kind = meta["type"]
    if kind == "bool":
        if type(value) is not bool:
            raise ValueError("Expected true or false")
    elif kind == "string":
        if (
            not isinstance(value, str)
            or len(value) > meta["maxLength"]
            or any(ord(c) < 32 for c in value)
        ):
            raise ValueError(f"Expected text up to {meta['maxLength']} characters")
    elif kind == "enum":
        if type(value) is bool or value not in meta["options"]:
            raise ValueError(f"Expected one of {meta['options']}")
        value = next(option for option in meta["options"] if option == value)
    else:
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError("Expected a finite number")
        if not meta["min"] <= value <= meta["max"]:
            raise ValueError(f"Expected {meta['min']} to {meta['max']}")
        if meta["step"] == 1 and int(value) != value:
            raise ValueError("Expected an integer")
        if meta["step"] == 1:
            value = int(value)
    return value
