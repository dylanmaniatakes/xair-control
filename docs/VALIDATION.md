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
