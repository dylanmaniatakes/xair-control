# Using X AIR Control

I keep mixing, processing, and automation in one browser interface. This guide covers the controls available after installation.

## Mix and process

- **Mixer:** input, bus, FX-send and return banks; main LR stays visible beside the scrollable channel bank. Channel names, colors, levels, and mute states load from the mixer and refresh automatically. Select a channel for its processing controls. Faders use the mixer’s nonlinear dB curve and send on release. Numeric fields have an explicit **Set** button.
- **Channel inspector:** configuration, gate, dynamics, insert, parametric EQ, graphic EQ where exposed, main assignment, DCA/mute membership, automix, and send levels.
- **Sends & buses:** choose a destination and keep its master fader and meter beside Input sends, Bus EQ, Graphic EQ, Dynamics, Insert effect, and FX returns. Display names and layout visibility are respected.
- **FX rack:** choose an effect slot, select an algorithm by name, set send/insert mode, and control its return. Quick links connect the rack to input sends, return processing, and bus inserts.
- **Groups:** DCA controls, four mute groups, and channel membership masks. Membership values use bits `1`, `2`, `4`, `8`; for example `5` selects groups 1 and 3.
- **All controls:** choose any channel/module, including headamps and global configuration, and filter its controls. Phantom power changes ask for confirmation in the browser.
- **OSC console:** low-level query/send, with JSON scalar or array arguments. Raw sends are reported as sent, not verified.

Control values refresh every 2.5 seconds. Live signal meters use a separate OSC subscription and refresh in the browser up to 10 times per second. Values that time out show an error and are disabled in the UI. Unsupported properties are retried after a 30-second backoff so one missing endpoint does not prevent access to other controls. Large reads have a four-second work budget and resume on subsequent refreshes.

## EQ and effects on a bus

Open **Sends & buses**, choose your named bus, and use **Input sends** to build its mix. The master fader and live meter stay beside the processing controls.

- **Bus EQ** groups the six bands in frequency order, with frequency, gain, width, and named filter shapes. Enable EQ and select its mode; press Set to apply an individual value. Graphic EQ has its own tab.
- **Insert effect** processes the bus signal with an FX slot. Configure the algorithm and enable that engine's Insert mode in **FX rack**, select the slot/side on the bus, press Set, then enable the bus insert. FX slots are shared; mode and algorithm changes affect their other users.
- **FX returns** blends existing processed effects into the bus instead of inserting an engine across it. For shared effects, disable the engine's Insert mode and set the source sends into that FX destination.

Algorithm-specific parameters such as decay and delay time are not exposed by the pinned Python API. The rack provides algorithm selection, routing mode, and return controls; it does not claim a complete algorithm editor. Unlisted algorithm IDs remain accessible. FX algorithm ordering, EQ shapes, and slot-side labels are based on the [X AIR protocol tables](https://github.com/pmaillot/X32-Behringer/blob/master/XAirSetScene.h).

## Customize your layout

Click **Edit layout** above the workspace to show or hide inputs, buses, FX/returns, main LR, and send destinations. Reorder items using the drag grips or arrow buttons, and optionally give them display names. Choose **Save layout**, or **Save as new** to keep multiple named layouts.

Hidden send destinations disappear from the Sends page and channel inspector. These are display preferences only: hiding a send does not disable it, mute audio, or change routing. Display names do not rename mixer channels, and webhook paths remain unchanged. All controls remains available for complete access.

Layouts are scoped to the mixer model and saved in the Docker data volume. Each browser remembers its selected layout. **Show all** returns to the full mixer without deleting saved layouts; **Show all items** inside the editor clears the draft's visibility restrictions. Cancel discards unsaved edits.

The layout API supports `GET /api/layouts`, `POST /api/layouts`, and `PUT`/`DELETE /api/layouts/{id}`. See `/docs` for the request schema.

## Live fader meters

Every fader strip has a live signal bar and a dBFS readout. Main LR and FX/aux returns have separate left/right bars. The bar displays −60 to 0 dBFS; the numeric readout also shows quieter signals. Green/yellow/red segments and a one-second peak-hold marker make signal and near-full-scale peaks easy to see.

Input, bus, FX-send, and return meters use **pre-fader** signal: a muted or lowered channel can still show incoming audio. Main LR is **post-fader**. These taps are labeled PRE/POST next to the readouts. Meter data comes from the mixer's `/meters/1` subscription, independently of fader positions. An XR12 test device delivered about 20 OSC frames per second; browser snapshots update up to 10 times per second.

The meter subscription renews while a visible mixer bank is being viewed. Stale data older than one second clears the bars and displays an unavailable state. Demo mode shows no audio meter activity rather than fabricated levels. `GET /api/meters` exposes the latest per-strip `dbfs`, `peak_dbfs`, `tap`, frame sequence, and age for custom dashboards.

The decoder follows the X AIR bank layout (40 little-endian signed 16-bit values in 1/256-dB units), with fixed wire positions even on the smaller XR12. Reference: [X AIR meter wire format and bank layout](https://github.com/stblassitude/xair-api-go/blob/main/WIRE_PROTOCOL.md#1a-meter-blocks-meters), independently checked against live XR12 packets.

## Webhooks and Stream Deck

1. Open **Webhooks → New webhook**.
2. Choose a channel/module and control, then **Set value**, **Toggle**, or **Adjust by**.
3. Copy the generated private URL.
4. Configure a Stream Deck HTTP-request action to send **POST** to that URL. It needs no request body or authentication header.

For a plugin that only opens URLs, enable **Allow GET requests** when creating the webhook. GET is otherwise rejected. Use the Docker host’s reachable LAN IP instead of `localhost` for buttons on other computers. No Stream Deck plugin is bundled.

A webhook URL is a bearer secret. Delete it to revoke access. Hooks are bound to their model and mode, and live hooks also to the mixer IP/port. Demo hooks cannot operate a live connection. Recreate a hook after changing its connection target. Toggle/increment actions are not idempotent: disable automatic HTTP retries for these actions. Explicit set actions are a better choice when retries are unavoidable.

The UI creates single-action hooks. The API also accepts up to 32 ordered commands per hook. Batches stop at the first failure and return completed results; they are not atomic and are not rolled back.

## HTTP API

The self-hosted [interactive API reference](http://localhost:8088/docs) includes request schemas and can be used without authentication. `/openapi.json` is also available.

These local endpoints do not require an authorization header:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status` | Mode, model, last reply time, connection status |
| `GET /api/meters` | Latest live signal meters and freshness |
| `GET /api/catalog` | All allowed property paths, types, ranges, and options |
| `POST /api/read` | Read up to 100 paths, returning values and per-path errors |
| `POST /api/command` | Set, toggle, or increment a property |
| `PUT /api/connection` | Validate identity and save a connection |
| `POST /api/osc` | Low-level OSC query or send |
| `GET/POST /api/hooks` | List or create webhooks |
| `DELETE /api/hooks/{id}` | Revoke a webhook |
| `GET /api/activity` | Last 100 actions in the current process |

`GET /health` reports web-server health, not mixer connectivity. `POST /hooks/{id}` needs its secret URL; GET must be enabled per hook.

Paths mirror the Python API with **zero-based indices**: `strip.0` is input 1, `bus.0` is bus 1. For XR12, sends `0–1` target buses 1–2; sends `2–5` target FX 1–4. Values use human units (dB, Hz, ms), not normalized OSC floats. `-90` is the library’s fader-off floor, displayed as −∞.

Set input 1 to −12 dB:

```json
{"path":"strip.0.mix.fader","operation":"set","value":-12}
```

Toggle input 1 mute:

```json
{"path":"strip.0.mute","operation":"toggle"}
```

Create an ordered two-action webhook via `POST /api/hooks`:

```json
{
  "name": "Microphone ready",
  "allow_get": false,
  "commands": [
    {"path":"strip.0.mix.fader","operation":"set","value":-12},
    {"path":"strip.0.mute","operation":"set","value":false}
  ]
}
```

For Home Assistant, the generated URL can be used directly:

```yaml
rest_command:
  mixer_microphone:
    url: !secret mixer_microphone_webhook
    method: POST
```

Use `POST /api/osc` for raw commands. Example read body: `{"address":"/xinfo","operation":"query"}`. Example write body: `{"address":"/ch/01/mix/on","operation":"send","value":1}`. A write followed by a timeout might still have reached the mixer; check its state before retrying.
