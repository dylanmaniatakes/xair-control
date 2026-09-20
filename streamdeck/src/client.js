export function configuration(settings = {}) {
  let url;
  try {
    url = new URL(settings.server);
  } catch {
    throw Error("Set the server URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Use an HTTP(S) URL without credentials or query parameters");
  const root = settings.root || "strip.0";
  if (!/^(?:(?:strip|bus|fxsend|fxreturn)\.\d{1,2}|lr|auxreturn)$/.test(root))
    throw Error("Choose a mixer channel");
  const step = Number(settings.step ?? 1),
    fine = Number(settings.fine ?? 0.1);
  if (![step, fine].every((n) => Number.isFinite(n) && n >= 0.1 && n <= 10))
    throw Error("Adjustment must be 0.1–10 dB");
  return { server: url.href.replace(/\/$/, ""), root, step, fine };
}
export async function request(server, path, body, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(server + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(2500),
      redirect: "error",
    });
  } catch {
    throw Error(
      body && path === "/api/command"
        ? "Command uncertain; check mixer"
        : "Server unavailable",
    );
  }
  if (!response.ok)
    throw Error(
      path === "/api/command"
        ? "Command failed; check mixer"
        : "Server rejected request",
    );
  return response.json();
}
export async function readState(config, fetcher = fetch) {
  const p = config.root;
  const r = await request(
    config.server,
    "/api/read",
    { paths: [`${p}.mix.fader`, `${p}.mute`, `${p}.config.name`] },
    fetcher,
  );
  const level = r.values?.[`${p}.mix.fader`],
    mute = r.values?.[`${p}.mute`];
  if (!Number.isFinite(level) || typeof mute !== "boolean")
    throw Error("Mixer control unavailable");
  return { level, mute, name: r.values[`${p}.config.name`] || rootLabel(p) };
}
export function rootLabel(root) {
  if (root === "lr") return "Main LR";
  if (root === "auxreturn") return "Aux return";
  const [kind, n] = root.split(".");
  return `${{ strip: "Input", bus: "Bus", fxsend: "FX send", fxreturn: "FX return" }[kind]} ${Number(n) + 1}`;
}
// Query then send a relative increment; never overwrite a level with a cached absolute value.
// No automatic retries: a timeout may follow a successfully applied command.
export async function adjust(
  config,
  delta,
  fetcher = fetch,
  stillCurrent = () => true,
) {
  const state = await readState(config, fetcher);
  if (!stillCurrent()) return;
  const target = Math.max(
    -90,
    Math.min(10, Math.round((state.level + delta) * 10) / 10),
  );
  const change = Math.round((target - state.level) * 10) / 10;
  if (change)
    await request(
      config.server,
      "/api/command",
      {
        path: `${config.root}.mix.fader`,
        operation: "increment",
        value: change,
      },
      fetcher,
    );
}
export async function toggle(config, fetcher = fetch) {
  await request(
    config.server,
    "/api/command",
    { path: `${config.root}.mute`, operation: "toggle" },
    fetcher,
  );
}
export async function channels(server, fetcher = fetch) {
  const status = await request(server, "/api/status", undefined, fetcher);
  const catalog = await request(server, "/api/catalog", undefined, fetcher);
  const roots = catalog
    .filter((m) => m.path.endsWith(".mix.fader"))
    .map((m) => m.path.slice(0, -10));
  const names = await request(
    server,
    "/api/read",
    { paths: roots.map((r) => `${r}.config.name`) },
    fetcher,
  );
  return {
    mode: status.mode,
    channels: roots.map((root) => ({
      root,
      label: `${rootLabel(root)}${names.values?.[`${root}.config.name`] ? " · " + names.values[`${root}.config.name`] : ""}`,
    })),
  };
}
export function feedback(state) {
  const value = state.level <= -90 ? "−∞ dB" : `${state.level.toFixed(1)} dB`;
  // Same piecewise fader scale used by the web app, shown as position (not VU).
  const db = state.level,
    position =
      db >= -10
        ? (db + 30) / 40
        : db >= -30
          ? (db + 50) / 80
          : db >= -60
            ? (db + 70) / 160
            : (db + 90) / 480;
  return {
    title: state.name,
    value: state.mute ? `MUTED · ${value}` : value,
    indicator: Math.max(0, Math.min(100, position * 100)),
  };
}
