# X AIR Control for Stream Deck+

I built this companion plugin so I can use Stream Deck+ dials as physical mixer controls. It talks directly to my X AIR Control web server's HTTP API.

## Install

1. Download [the `.streamDeckPlugin` installer](releases/com.dylanmaniatakes.xair-control.streamDeckPlugin). On GitHub, use **Download raw file** if the link opens a file preview.
2. Double-click it and follow Stream Deck's installation prompt.
3. Find **X AIR Control → Mixer Fader** in the action list and drag it onto a **dial**, not a regular key.
4. In the action's settings, enter the address of the X AIR Control web app, for example `http://your-docker-server:8088`.
5. Click **Connect & load channels**, choose an input or another fader, and click **Save dial**.

Repeat these steps for each dial you want to assign. Settings belong to the dial, so different dials can control different channels or servers. The connection test only reads the server; it does not change mixer settings.

The plugin requires **Stream Deck+**, the Stream Deck desktop application **6.6 or later**, and **macOS 13+ or Windows 10+**. The plugin uses the desktop app's bundled Node.js runtime; users do not need to install Node.js or Python. It runs on the computer attached to the Stream Deck, while the mixer web app can stay on a separate Docker server. This is a dial-only action.

## Dial controls

| Gesture | Result |
| --- | --- |
| Turn clockwise / counterclockwise | Raise / lower the selected fader; default 1 dB per tick. |
| Press and release | Toggle channel mute. |
| Hold the dial down while turning | Fine adjustment; default 0.1 dB per tick. Releasing after this does not toggle mute. |
| Tap the touch display | Request a fresh reading. |

The touch display shows the current mixer channel name, level in dB, and mute state. It refreshes about once a second when idle and after adjustments. Its bar shows **fader position**, not audio/VU level. Mixer names are used; web-only layout aliases do not rename the dial display.

Input, bus, FX-send, FX-return, aux-return, and main LR faders are discovered from the server's catalog. The current API does not expose a DCA fader, so it is not listed. Web layout visibility does not limit the plugin's channel list.

You can choose normal and fine adjustment sizes from 0.1 to 10 dB. Changes stop at the API's −90 dB and +10 dB limits. The −90 dB floor is displayed as −∞. Turning a muted channel changes its fader without unmuting it.

## Connection and behavior

- Enter the **web server URL**, not the mixer's IP or a webhook URL. `localhost` only works when the web server is on the same computer as Stream Deck.
- The plugin uses `/api/status`, `/api/catalog`, `/api/read`, and `/api/command`.
- Channel discovery shows whether the server is in demo or live mode. In demo mode, the dial changes simulated values only.
- HTTP and HTTPS base URLs are supported, including a reverse-proxy path prefix. HTTPS needs a certificate trusted by the runtime. Redirects, embedded credentials, and authentication gateways are not supported by this version.
- Fast turns are combined in short batches. Adjustments use relative API increments, and queued operations for the same server/channel are serialized. Other apps can still change the mixer concurrently; a change right at a limit can be rejected instead of overwriting someone else's setting.
- Failed or uncertain commands are **not automatically retried**. After a timeout, it check the mixer state before repeating the gesture. Pending turns are discarded on a failed command, action removal, or settings change; commands already in flight may have reached the server.
- The plugin stores the server address and channel in Stream Deck's local action settings. 

## Troubleshooting

| What I see | What I check |
| --- | --- |
| No Mixer Fader action | Update/restart Stream Deck and check that the plugin installed. Look in the dial action list. |
| Set the server URL | Enter the URL, load the channel list, and save the dial. |
| Server unavailable | Open that same web URL on the Stream Deck computer; check its firewall and networking. |
| Mixer control unavailable | Check the web app's Connection page and whether the channel exists on that model. |
| Command uncertain / failed | Check the actual level or mute state before repeating the command. |
| Display changes but no audio changes | Check whether the server is in demo mode and whether the mixer channel is muted or routed to the intended output. |

## Build from source

For development, I use Node.js 20 or newer and npm. From this directory:

```sh
npm ci
npm test
npm run validate
npm run pack
```

`npm test` builds the runtime and runs the tests. `npm run validate` runs Elgato's manifest/file validation. `npm run pack` builds and packages the installer into `releases/` and updates `releases/SHA256SUMS`.

The source is in `src/`. The manifest, settings interface, and icons are in `com.dylanmaniatakes.xair-control.sdPlugin/`.

For an optional development install, run `npx streamdeck link com.dylanmaniatakes.xair-control.sdPlugin` after building. That links this checkout into the local Stream Deck application. Use the packaged installer for normal installation.

## Tests and limitations

The automated tests cover channel discovery, event handling, tick batching, fine adjustment, press-to-mute, limit clamping, multiple dials, settings changes, external updates, failure handling, and the actual bundled runtime connected to a mock Stream Deck WebSocket server. The client also has an integration test against the real Docker app in **demo mode**:

```sh
# From the repository root; creates an isolated, disposable demo deployment.
BIND_ADDRESS=127.0.0.1 WEB_PORT=18091 \
  docker compose -p xair-streamdeck-test up -d --build

# Once the web app is ready:
cd streamdeck
node tests/demo.mjs http://127.0.0.1:18091
```

The integration test refuses a live connection and restores its demo values afterward. Clean up from the repository root with `docker compose -p xair-streamdeck-test down -v`.

The settings interface has been tested through a local mock Stream Deck bridge, including channel discovery and saving at a narrow inspector width. That establishes browser/protocol behavior, **not a physical Stream Deck+ test**. Version 1.0.1 was also installed in the macOS Stream Deck desktop app and successfully loaded 24 live mixer faders through an HTTPS reverse proxy. Actual dial/touch hardware operation and Windows runtime behavior still need verification. No live mixer settings were changed during plugin testing.

## License

I release the plugin under the repository's [MIT license](../LICENSE). The packaged WebSocket dependency, `ws`, is MIT licensed; its notice is included as `WS-LICENSE` in the plugin installer. The Elgato CLI and esbuild are development tools, not bundled runtime dependencies. This is an independent plugin, not an official Elgato, Behringer, or Midas product.
