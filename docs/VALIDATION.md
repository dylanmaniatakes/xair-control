# Validation and support boundaries

I distinguish simulator tests from hardware checks. A passing simulator test does not establish audible behavior or compatibility with every physical model.

## Automated checks

46 tests pass on the local ARM64 development environment and in an AMD64 Docker image under emulation. The suite covers the upstream writable-control catalog for XR12, XR16, XR18, and MR18, validation, fader conversions, EQ shapes, insert selections, mute behavior, layout persistence, webhook lifecycle, and login-free local access. Fresh installations are checked for demo mode and a loopback placeholder address.

Local UDP simulator tests exercise actual OSC encoding, address-correlated replies, writes/readback, bounded timeouts, bus effects, and meter subscriptions. Meter tests cover decoding, peak hold, freshness, renewal, and malformed packets. Layout API tests guard against mixer commands.

The Docker smoke script checks a separate demo deployment: health, catalog access, webhook execution, and persistence across a container restart. It refuses to operate in live mode. Python lint and JavaScript syntax checks are also run.

## Browser and physical checks

Desktop and phone-size layouts have been checked for mixing, metering, layout editing, bus EQ, FX returns, and rack navigation. Layout selection survived a page reload and container restart.

Physical read-only checks have been performed on an XR12 reporting XR12W, firmware 1.22. Identity, names, colors, selected control values, insert state, and continuously changing meter packets were observed. The app recognizes XR12W as XR12.

Physical mixer writes, audible processing, other physical mixer models, and third-party Stream Deck/Home Assistant installations have not been validated. Algorithm-specific FX parameters are not implemented by the pinned Python API. Some library controls may not exist on a given model or channel; failed reads remain visibly unavailable.

## Public deployment preparation

Both Compose definitions are parsed by Docker Compose. The GitHub-context definition is also exercised with a local source override in an isolated demo stack. A separate `docker run` deployment is checked with fresh storage. Runtime packages are pinned; the base image is `python:3.12-slim`.

The intended public GitHub URL cannot be tested end-to-end until the repository is published. Remote builds require network access to GitHub, the base-image registry, and Python package indexes. The AMD64 image builds successfully and runs under Docker emulation with the documented read-only filesystem and non-root user. A separate AMD64 `docker run` instance passed checks for demo defaults, catalog access, an EQ command/readback, and layout persistence across a restart. A physical AMD64 production host has not been tested.

No local connection files, webhook tokens, hardware screenshots, or private network addresses are included in the release files.

## Stream Deck+ companion

The companion installer passes Elgato CLI validation and packaging. Fifteen automated plugin tests pass on the development runtime and under Node 20 in Docker, including a real WebSocket exchange with the bundled plugin process. They cover tick batching, fine turns, mute presses, endpoint clamping, multiple dials, settings invalidation, polling external changes, and uncertain-command handling without retries.

The plugin client also passed discovery, relative/fine level changes, mute, and readback checks against an isolated Docker deployment of the real app in demo mode. The property inspector was exercised in a browser through a mock Stream Deck bridge: discovery returned 24 faders, per-dial settings were submitted, and the narrow panel had no horizontal overflow.

The staged installer was inspected for runtime/source parity, included MIT notices, checksum accuracy, and absence of personal connection details. Version 1.0.1 was installed in the actual macOS Stream Deck app; its settings panel successfully discovered 24 live mixer faders through an HTTPS reverse proxy. A regression test covers distinct inspector and action identifiers, which previously caused Stream Deck to reject discovery messages. Physical Stream Deck+ dials/touch feedback and Windows execution remain unverified. No live mixer settings were changed. See the [plugin guide](../streamdeck/README.md) for installation and rebuild instructions.
