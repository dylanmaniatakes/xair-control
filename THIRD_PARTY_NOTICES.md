# Third-party notices

I use the following projects and references. The project's MIT license does not replace third-party licenses.

- **xair-api-python / xair-api 2.4.3**: MIT, copyright Peter Dikant and Onyx and Iris. Installed as a dependency, with its license included in the Python distribution. [Source](https://github.com/onyx-and-iris/xair-api-python).
- **FastAPI, Uvicorn, python-osc, and transitive dependencies**: installed from the pinned packages in `requirements.lock`. Their package distributions carry their respective licenses.
- **Swagger UI 5.17.14**: bundled under `app/static/vendor`, Apache License 2.0. The license is retained at [SWAGGER-LICENSE](app/static/vendor/SWAGGER-LICENSE). [Source](https://github.com/swagger-api/swagger-ui).
- **X AIR protocol facts**: effect ordering, EQ shapes, and slot labels were checked against [Patrick-Gilles Maillot's X AIR tables](https://github.com/pmaillot/X32-Behringer/blob/master/XAirSetScene.h). Meter framing was checked against [xair-api-go's protocol documentation](https://github.com/stblassitude/xair-api-go/blob/main/WIRE_PROTOCOL.md). These are references; their program implementations are not bundled.

Behringer, Midas, X AIR, Stream Deck, Docker, and other product names belong to their respective owners. Their use identifies compatibility and does not imply endorsement.
