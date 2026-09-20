const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let catalog = [],
  meta = {},
  values = {},
  errors = {},
  status = {},
  view = "mixer",
  bank = "inputs",
  selected = "strip.0",
  tab = "mix",
  polling = false,
  generation = 0,
  hooks = {};
const titles = {
  mixer: "Mixer",
  sends: "Sends & buses",
  effects: "FX rack",
  groups: "Groups",
  controls: "All controls",
  hooks: "Webhooks",
  osc: "OSC console",
  settings: "Connection",
};
const groupNames = {
  config: "Channel setup",
  mix: "Mix",
  preamp: "Preamp",
  gate: "Gate",
  dyn: "Dynamics",
  insert: "Insert",
  eq: "Equalizer",
  geq: "Graphic EQ",
  group: "Groups",
  automix: "Automix",
  send: "Sends",
  general: "General",
};
async function api(path, body, method) {
  const response = await fetch(path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = await response.json();
  if (!response.ok) {
    throw Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail),
    );
  }
  return data;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => ($("#toast").hidden = true), 5500);
}
function channelName(root) {
  return Layouts.label(
    root,
    values[root + (root.startsWith("dca.") ? ".name" : ".config.name")] || "",
  );
}
function displayRoot(root) {
  const name = channelName(root);
  return name ? `${labelRoot(root)} · ${name}` : labelRoot(root);
}
function labelRoot(root) {
  if (root === "lr") return "Main LR";
  if (root === "auxreturn") return "Aux return";
  if (root === "config") return "Mixer configuration";
  const [kind, index] = root.split(".");
  const names = {
    strip: "Input",
    bus: "Bus",
    fx: "FX engine",
    fxsend: "FX send",
    fxreturn: "FX return",
    dca: "DCA",
    headamp: "Headamp",
  };
  return `${names[kind] || kind} ${Number(index) + 1}`;
}
function rootOf(path) {
  const p = path.split(".");
  return /^\d+$/.test(p[1]) ? p.slice(0, 2).join(".") : p[0];
}
function roots(kind) {
  return [
    ...new Set(
      catalog
        .filter((m) => m.path.startsWith(kind + "."))
        .map((m) => rootOf(m.path)),
    ),
  ];
}
function title(description, action = "") {
  return `<div class="title-row"><div><div class="eyebrow">YOUR SOUND, UNDER CONTROL</div><h1>${titles[view]}</h1><p>${description}</p></div>${action}</div>${status.mode === "demo" ? '<div class="demo-note"><span>◌</span> Demo workspace · Controls operate a simulator. No audio or mixer hardware is connected.</div>' : ""}`;
}
function readValue(path) {
  return values[path];
}
function dbToPosition(v) {
  return v >= -10
    ? (v + 30) / 40
    : v >= -30
      ? (v + 50) / 80
      : v >= -60
        ? (v + 70) / 160
        : (v + 90) / 480;
}
function positionToDb(v) {
  return (
    Math.round(
      (v >= 0.5
        ? v * 40 - 30
        : v >= 0.25
          ? v * 80 - 50
          : v >= 0.0625
            ? v * 160 - 70
            : v * 480 - 90) * 10,
    ) / 10
  );
}
function db(value) {
  return value === undefined
    ? "—"
    : value <= -90
      ? "−∞"
      : Number(value).toFixed(1);
}
function rootOptions(list, current) {
  return list
    .map(
      (r) =>
        `<option value="${r}" ${r === current ? "selected" : ""}>${esc(displayRoot(r))}</option>`,
    )
    .join("");
}
async function init() {
  try {
    status = await api("/api/status");
    catalog = await api("/api/catalog");
    meta = Object.fromEntries(catalog.map((m) => [m.path, m]));
    values = {};
    errors = {};
    $("#shell").hidden = false;
    const namePaths = catalog
      .filter((m) => /\.(?:name|color)$/.test(m.path))
      .map((m) => m.path);
    for (let i = 0; i < namePaths.length; i += 100) {
      const snapshot = await api("/api/read", {
        paths: namePaths.slice(i, i + 100),
      });
      Object.assign(values, snapshot.values);
    }
    await Layouts.load(status.model);
    render();
    await refresh();
  } catch (e) {
    $("#content").textContent = "Could not load the mixer. Refresh to retry.";
    toast(e.message);
  }
}
function updateStatus() {
  const demo = status.mode === "demo";
  $("#connection-status").textContent = demo
    ? "◌ Demo mode"
    : status.connected
      ? "● Mixer responding"
      : "○ No recent reply";
  $("#connection-status").classList.toggle("live", !demo && status.connected);
  $("#device-model").textContent = status.model;
  $("#device-name").textContent = status.mixer_name || "Digital mixing console";
  $("#foot-status").textContent =
    `${status.model} · ${demo ? "Simulator" : status.ip} · ${catalog.length.toLocaleString()} available controls`;
}
function render() {
  generation++;
  $("#crumb").textContent = titles[view];
  $$("#nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view),
  );
  updateStatus();
  const c = $("#content");
  if (view === "mixer") renderMixer(c);
  if (view === "sends") renderSends(c);
  if (view === "effects") renderEffects(c);
  if (view === "groups") renderGroups(c);
  if (view === "controls") renderAll(c);
  if (view === "hooks") renderHooks(c);
  if (view === "osc") renderOSC(c);
  if (view === "settings") renderSettings(c);
  paint();
}
function meterMarkup(root) {
  const stereo =
    root === "lr" || root === "auxreturn" || root.startsWith("fxreturn.");
  const tap = root === "lr" ? "post-fader" : "pre-fader";
  return `<div class="vu-meter stale" data-vu-root="${root}" title="${tap} signal in dBFS${stereo ? " · Left / Right" : ""}">${Array.from({ length: stereo ? 2 : 1 }, (_, i) => `<div class="vu-lane" role="meter" aria-label="${esc(labelRoot(root))} ${tap} ${stereo ? (i ? "right" : "left") : "signal"}" aria-valuemin="-60" aria-valuemax="0" aria-valuetext="Waiting for meter data"><i class="vu-fill"></i><i class="vu-peak"></i></div>`).join("")}</div>`;
}
function strip(root, master = false) {
  const fader = root + ".mix.fader",
    mute = root + ".mute",
    name = root + ".config.name";
  return `<article class="strip ${master ? "master" : ""} ${selected === root ? "selected" : ""}" data-root="${root}"><div class="channel-number">${master ? "MAIN" : esc(labelRoot(root).toUpperCase())}</div><button class="strip-title" data-select="${root}" data-name="${name}" title="Open channel processing">${esc(channelName(root) || labelRoot(root))}</button><small>${master ? "STEREO OUTPUT" : "CHANNEL STRIP"}</small><div class="fader-well"><div class="scale"><span>+10</span><span>0</span><span>−20</span><span>−40</span><span>−∞</span></div><input type="range" min="0" max="1" step="0.0025" data-fader="${fader}" aria-label="${esc(labelRoot(root))} fader" disabled>${meterMarkup(root)}</div><div class="vu-reading" data-vu-reading="${root}" title="${master ? "Post-fader output" : "Pre-fader signal; remains active when muted"}"><span>${master ? "POST" : "PRE"}</span><output>—</output><span>dBFS</span></div><output class="level-value" data-db="${fader}">—</output><button class="mute-btn" data-mute="${mute}" disabled>MUTE</button></article>`;
}
function renderMixer(c) {
  let list =
    bank === "inputs"
      ? roots("strip")
      : bank === "buses"
        ? roots("bus")
        : [...roots("fxsend"), ...roots("fxreturn"), "auxreturn"];
  list = Layouts.visible(list);
  if (
    !list.includes(selected) &&
    !(selected === "lr" && Layouts.isVisible("lr"))
  )
    selected = list[0] || (Layouts.isVisible("lr") ? "lr" : "");
  c.innerHTML =
    title(
      "A clear view of your mix. Select a channel to shape its sound.",
      '<button class="quiet" id="jump-hook">⌘ Create a control</button>',
    ) +
    `<div class="toolbar"><div class="segmented">${[
      ["inputs", "Inputs"],
      ["buses", "Buses"],
      ["returns", "FX & returns"],
    ]
      .map(
        ([id, label]) =>
          `<button data-bank="${id}" class="${bank === id ? "active" : ""}">${label}</button>`,
      )
      .join(
        "",
      )}</div><span class="meter-status" id="meter-status">Waiting for meters</span><span class="hint">Signal: pre-fader · Main LR: post-fader</span></div><div class="desk"><div class="strips">${list.map((r) => strip(r)).join("") || '<p class="empty">All strips in this bank are hidden. Use Edit layout or Show all.</p>'}</div>${Layouts.isVisible("lr") ? strip("lr", true) : ""}</div><section class="detail" id="inspector"></section>`;
  renderInspector();
}
function renderInspector() {
  const target = $("#inspector");
  if (!target) return;
  if (!selected) {
    target.hidden = true;
    return;
  }
  target.hidden = false;
  const fields = catalog.filter(
    (m) =>
      rootOf(m.path) === selected &&
      (!m.path.includes(".send.") ||
        Layouts.isVisible("send." + m.path.split(".send.")[1].split(".")[0])),
  );
  const groups = [
    ...new Set(
      fields.map((m) =>
        m.path.slice(selected.length + 1).split(".").length === 1
          ? "general"
          : m.path.slice(selected.length + 1).split(".")[0],
      ),
    ),
  ];
  if (!groups.includes(tab)) tab = groups[0];
  target.innerHTML = `<div class="section-heading"><div><h2 data-selected-name>${esc(channelName(selected) || labelRoot(selected))}</h2><small>${esc(labelRoot(selected))} · Channel processing</small></div>${selected.startsWith("bus.") && view !== "sends" ? `<button class="quiet" data-open-send="${selected.split(".")[1]}" data-start-page="eq">Bus sends & processing →</button>` : ""}<button class="quiet" data-hook-root="${selected}">⌘ Webhook</button></div><div class="detail-tabs">${groups.map((g) => `<button data-tab="${g}" class="${g === tab ? "active" : ""}">${groupNames[g] || g}</button>`).join("")}</div><div class="control-grid">${fields
    .filter((m) => {
      const rest = m.path.slice(selected.length + 1);
      return tab === "general"
        ? !rest.includes(".")
        : rest.startsWith(tab + ".");
    })
    .sort((a, b) => {
      if (!a.path.includes(".send.") || !b.path.includes(".send.")) return 0;
      const ids = Layouts.visible(
        Array.from({ length: roots("bus").length + 4 }, (_, i) => `send.${i}`),
      );
      return (
        ids.indexOf("send." + a.path.split(".send.")[1].split(".")[0]) -
        ids.indexOf("send." + b.path.split(".send.")[1].split(".")[0])
      );
    })
    .map(control)
    .join("")}</div>`;
  if (["eq", "insert"].includes(tab))
    target.querySelector(".control-grid").outerHTML = processingBody(
      fields,
      selected,
      tab,
    );
}
function control(m, keepLabel = false) {
  if (!m) return "";
  const rest = m.path.split(".");
  let name = m.label;
  if (keepLabel !== true && rest.includes("eq") && rest.length > 4)
    name = rest.at(-2) + " · " + name;
  if (keepLabel !== true && rest.includes("send"))
    name = `To ${sendName(Number(rest.at(-2)))}`;
  return `<div class="control"><label>${esc(name)}${m.unit ? " <small>" + m.unit + "</small>" : ""}</label><div class="control-input">${m.type === "bool" ? `<button class="toggle" data-toggle="${m.path}" disabled>Unknown</button>` : m.type === "enum" ? `<select data-field="${m.path}" aria-label="${esc(m.path)}" disabled>${m.options.map((o, i) => `<option value="${esc(o)}">${esc(m.optionLabels?.[i] || o)}</option>`).join("")}</select><button data-save="${m.path}" disabled>Set</button>` : `<input data-field="${m.path}" aria-label="${esc(m.path)}" type="${m.type === "string" ? "text" : "number"}" ${m.type === "number" ? `min="${m.min}" max="${m.max}" step="${m.step}"` : `maxlength="${m.maxLength}"`} disabled><button data-save="${m.path}" disabled>Set</button>`}</div><span class="control-path" title="${m.path}">${m.path}</span><div class="control-error" data-error="${m.path}"></div></div>`;
}
function renderSends(c) {
  renderBusWorkspace(c);
}
function renderEffects(c) {
  renderFxWorkspace(c);
}
function renderGroups(c) {
  c.innerHTML =
    title("Control DCA groups, mute groups, and channel assignments.") +
    `<div class="card"><h2>DCA groups</h2><div class="control-grid">${catalog
      .filter((m) => m.path.startsWith("dca."))
      .map(control)
      .join(
        "",
      )}</div></div><div class="card"><h2>Mute groups</h2><div class="control-grid">${catalog
      .filter((m) => m.path.startsWith("config.mute_group."))
      .map(control)
      .join(
        "",
      )}</div></div><div class="card"><h2>Channel assignments</h2><p>DCA and mute memberships are bitmasks: 1, 2, 4, and 8. Add them to select multiple groups.</p><div class="control-grid">${catalog
      .filter((m) => m.path.startsWith("strip.") && m.path.includes(".group."))
      .map(control)
      .join("")}</div></div>`;
}
function renderAll(c) {
  const allRoots = [...new Set(catalog.map((m) => rootOf(m.path)))];
  c.innerHTML =
    title(
      "Every writable property exposed by the Python API, organized by channel.",
    ) +
    `<div class="toolbar"><label>Channel or module<select id="all-root">${rootOptions(allRoots, selected)}</select></label><input class="search" id="control-search" placeholder="Filter controls, e.g. threshold" aria-label="Filter controls"></div><div class="control-grid" id="all-grid"></div>`;
  const fill = () => {
    selected = $("#all-root").value;
    const q = $("#control-search").value.toLowerCase();
    $("#all-grid").innerHTML = catalog
      .filter(
        (m) => rootOf(m.path) === selected && m.path.toLowerCase().includes(q),
      )
      .map(control)
      .join("");
    refresh();
  };
  $("#all-root").onchange = fill;
  $("#control-search").oninput = fill;
  fill();
}
async function renderHooks(c) {
  c.innerHTML =
    title(
      "One button. Your action. Connect Stream Deck and Home Assistant.",
      '<button class="primary" id="new-hook">+ New webhook</button>',
    ) +
    '<div id="hook-list"></div><div class="card"><h2>Made for your custom controls</h2><p>Use an HTTP request action on Stream Deck: select POST and paste the private URL. No body is needed. For URL-only plugins, explicitly enable GET when creating the webhook.</p><p class="muted">Advanced clients can create multi-action webhooks through <code>POST /api/hooks</code>. Actions run in order and stop on failure; completed changes are not rolled back.</p></div>';
  try {
    hooks = await api("/api/hooks");
    if (view !== "hooks") return;
    $("#hook-list").innerHTML = Object.entries(hooks).length
      ? Object.entries(hooks)
          .map(
            ([id, h]) =>
              `<div class="card hook-card"><span class="empty-symbol">⌘</span><div class="hook-info"><h2>${esc(h.name)} <span class="pill">${esc(h.mode.toUpperCase())}</span></h2><p>${h.commands.map((cmd) => esc(`${cmd.operation} ${cmd.path}${cmd.value !== null ? " → " + cmd.value : ""}`)).join("<br>")}</p><code>${esc(location.origin + "/hooks/" + id)}</code><small>${h.allow_get ? "POST or GET" : "POST"} · ${esc(h.model)}</small></div><button class="quiet" data-copy-hook="${id}">Copy URL</button><button class="quiet" data-delete-hook="${id}">Delete</button></div>`,
          )
          .join("")
      : '<div class="card empty"><div class="empty-symbol">⌘</div><h2>Your mixer, one tap away.</h2><p>Create your first webhook to mute a mic, set a level,<br>or switch a mixer control from your Stream Deck.</p><button class="primary" id="first-hook">Create a webhook</button></div>';
  } catch (e) {
    toast(e.message);
  }
}
function renderOSC(c) {
  c.innerHTML =
    title(
      "Direct access to the library’s low-level OSC send and query functions.",
    ) +
    `<div class="two-cols"><form class="card" id="osc-form"><h2>OSC request</h2><div class="form-grid"><label class="wide">Address<input id="osc-address" value="/xinfo" required pattern="/[A-Za-z0-9_./-]+"></label><label>Operation<select id="osc-op"><option value="query">Query (read only)</option><option value="send">Send</option></select></label><label class="wide">Value (JSON string, number, boolean, array, or null)<textarea id="osc-value">null</textarea></label></div><button class="primary">Run request</button><p class="muted">Raw sends bypass the typed control validation. A sent packet does not prove that the mixer accepted it.</p></form><div class="card"><h2>Response</h2><pre id="osc-result">Ready for a request.</pre></div></div>`;
  $("#osc-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const operation = $("#osc-op").value;
      if (
        operation === "send" &&
        !confirm("Send this raw OSC command to the current mixer?")
      )
        return;
      const r = await api("/api/osc", {
        address: $("#osc-address").value,
        operation,
        value: JSON.parse($("#osc-value").value),
      });
      $("#osc-result").textContent = JSON.stringify(r, null, 2);
    } catch (e) {
      $("#osc-result").textContent = e.message;
    }
  };
}
function renderSettings(c) {
  c.innerHTML =
    title("Connect to your mixer over your local network.") +
    `<div class="two-cols"><form class="card" id="connection-form"><h2>Mixer connection</h2><div class="form-grid"><label>Mode<select id="conn-mode"><option value="demo">Demo simulator</option><option value="live">Live mixer</option></select></label><label>Mixer model<select id="conn-model">${["XR12", "XR16", "XR18", "MR18"].map((m) => `<option>${m}</option>`).join("")}</select></label><label>Mixer IP address<input id="conn-ip" value="${esc(status.ip)}" required></label><label>OSC UDP port<input id="conn-port" type="number" value="${status.port}" min="1" max="65535" required></label></div><button class="primary" id="connect-button">Save & connect</button><p class="muted">Connecting sends a read-only identity query. It does not apply demo values or recall mixer settings.</p><p id="connection-result" role="status"></p></form><div class="card"><h2>Network & access</h2><p>Your Docker host needs a route to the mixer’s network. The mixer uses UDP 10024 and replies to the source port.</p><p>Webhooks work through the web server’s HTTP port. Publish that port on your trusted LAN for Stream Deck and Home Assistant.</p><p class="muted">This local console opens without a login. All devices that can reach its HTTP port can control the mixer. Webhook URLs can be revoked by deleting them.</p><h3>API documentation</h3><p><a href="/docs" target="_blank" rel="noreferrer">Open interactive API reference ↗</a></p></div></div><div class="card"><h2>Recent activity</h2><div id="activity">Loading…</div></div>`;
  $("#conn-mode").value = status.mode;
  $("#conn-model").value = status.model;
  $("#connection-form").onsubmit = async (e) => {
    e.preventDefault();
    $("#connect-button").disabled = true;
    try {
      await api(
        "/api/connection",
        {
          mode: $("#conn-mode").value,
          model: $("#conn-model").value,
          ip: $("#conn-ip").value,
          port: Number($("#conn-port").value),
        },
        "PUT",
      );
      await init();
      toast("Connection saved");
    } catch (e) {
      $("#connection-result").textContent = e.message;
    } finally {
      if ($("#connect-button")) $("#connect-button").disabled = false;
    }
  };
  api("/api/activity")
    .then((events) => {
      if ($("#activity"))
        $("#activity").innerHTML = events.length
          ? `<table><tbody>${events
              .slice(0, 15)
              .map(
                (e) =>
                  `<tr><td>${new Date(e.time * 1000).toLocaleTimeString()}</td><td>${esc(e.action)}</td><td>${esc(e.detail)}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : "<p>No actions yet.</p>";
    })
    .catch((e) => toast(e.message));
}
function pathsOnScreen() {
  return [
    ...new Set(
      $$("[data-field],[data-toggle],[data-fader],[data-mute],[data-name]").map(
        (e) =>
          e.dataset.field ||
          e.dataset.toggle ||
          e.dataset.fader ||
          e.dataset.mute ||
          e.dataset.name,
      ),
    ),
  ];
}
async function refresh() {
  if (polling || !catalog.length) return;
  polling = true;
  const gen = generation;
  try {
    const paths = [
      ...new Set([
        ...pathsOnScreen(),
        ...catalog
          .filter((m) => /\.(?:name|color)$/.test(m.path))
          .map((m) => m.path),
      ]),
    ];
    for (let i = 0; i < paths.length; i += 100) {
      const r = await api("/api/read", { paths: paths.slice(i, i + 100) });
      if (gen !== generation) break;
      Object.assign(values, r.values);
      for (const p of paths.slice(i, i + 100)) {
        delete errors[p];
        if (r.errors[p]) {
          errors[p] = r.errors[p];
          delete values[p];
        }
      }
      paint();
    }
    status = await api("/api/status");
    updateStatus();
  } catch (e) {
    for (const p of pathsOnScreen()) {
      delete values[p];
      errors[p] = "Server unavailable";
    }
    status.connected = false;
    paint();
    updateStatus();
    toast(e.message);
  } finally {
    polling = false;
  }
}
function paint() {
  const focused = document.activeElement;
  $$("[data-field]").forEach((e) => {
    const p = e.dataset.field;
    const known = p in values;
    e.disabled = !known;
    if (e !== focused && !e.dataset.dirty && known) e.value = values[p];
  });
  $$("[data-save]").forEach((e) => (e.disabled = !(e.dataset.save in values)));
  $$("[data-toggle],[data-mute]").forEach((e) => {
    const p = e.dataset.toggle || e.dataset.mute,
      known = p in values;
    e.disabled = !known;
    e.classList.toggle(e.dataset.mute ? "muted" : "enabled", !!values[p]);
    e.setAttribute("aria-pressed", String(!!values[p]));
    e.textContent = e.dataset.mute
      ? values[p]
        ? "MUTED"
        : "MUTE"
      : known
        ? values[p]
          ? "Enabled"
          : "Disabled"
        : "Unknown";
  });
  $$("[data-fader]").forEach((e) => {
    const p = e.dataset.fader;
    e.disabled = !(p in values);
    if (e !== focused && !e.dataset.dragging)
      e.value = dbToPosition(values[p] ?? -90);
  });
  $$("[data-db]").forEach(
    (e) => (e.textContent = db(values[e.dataset.db]) + " dB"),
  );
  $$("[data-name]").forEach(
    (e) =>
      (e.textContent =
        channelName(rootOf(e.dataset.name)) ||
        labelRoot(rootOf(e.dataset.name))),
  );
  const palette = [
    "#809099",
    "#d77171",
    "#80b78a",
    "#d1b968",
    "#7b98d8",
    "#b889cf",
    "#7ec1c3",
    "#d1d6d9",
  ];
  $$(".strip[data-root]").forEach((el) => {
    const color = values[el.dataset.root + ".config.color"];
    if (Number.isInteger(color))
      el.style.setProperty("--strip-color", palette[color % 8]);
  });
  $$("[data-selected-name]").forEach(
    (el) => (el.textContent = channelName(selected) || labelRoot(selected)),
  );
  $$("#all-root option,#effect-root option,#hook-target option").forEach(
    (el) => (el.textContent = displayRoot(el.value)),
  );
  $$("[data-error]").forEach(
    (e) => (e.textContent = errors[e.dataset.error] || ""),
  );
}
async function send(path, operation, value) {
  if (
    meta[path]?.warning &&
    !confirm(meta[path].warning + " Apply this change?")
  )
    return;
  try {
    const r = await api("/api/command", { path, operation, value });
    values[path] = r.value;
    // A mute write only changes its inverse on/off alias. Keep unrelated
    // names, colors, and faders visible while the next state read runs.
    const root = rootOf(path);
    const aliases =
      path === root + ".mute"
        ? [root + ".mix.on", root + ".on"]
        : path === root + ".mix.on" || path === root + ".on"
          ? [root + ".mute"]
          : [];
    for (const alias of aliases) {
      if (meta[alias]) values[alias] = !r.value;
    }
    $$("[data-field]")
      .filter((e) => e.dataset.field === path)
      .forEach((e) => delete e.dataset.dirty);
    paint();
    await refresh();
    toast(
      "Control read back from " +
        (status.mode === "demo" ? "simulator" : "mixer"),
    );
  } catch (e) {
    toast(e.message);
    await refresh();
  }
}
function fieldValue(path, el) {
  const m = meta[path];
  if (m.type === "enum") return m.options.find((v) => String(v) === el.value);
  return m.type === "number" ? Number(el.value) : el.value;
}
function hookControls(path) {
  const root = $("#hook-target").value;
  $("#hook-path").innerHTML = catalog
    .filter((m) => rootOf(m.path) === root)
    .map(
      (m) =>
        `<option value="${m.path}">${esc(m.path.slice(root.length + 1))}</option>`,
    )
    .join("");
  if (path && meta[path]) $("#hook-path").value = path;
  $("#hook-operation").value =
    meta[$("#hook-path").value].type === "bool" ? "toggle" : "set";
  hookValue();
}
function openHook(path) {
  const selectedPath = path && meta[path] ? path : "strip.0.mute";
  $("#hook-target").innerHTML = rootOptions(
    [...new Set(catalog.map((m) => rootOf(m.path)))],
    rootOf(selectedPath),
  );
  $("#hook-name").value = "";
  $("#hook-get").checked = false;
  hookControls(selectedPath);
  $("#hook-dialog").showModal();
}
function hookValue() {
  const m = meta[$("#hook-path").value],
    op = $("#hook-operation").value;
  $("#hook-value").innerHTML =
    op === "toggle"
      ? ""
      : `<label>Value ${m.unit || ""}${m.type === "bool" ? '<select id="hook-val"><option value="true">True</option><option value="false">False</option></select>' : m.type === "enum" && op === "set" ? `<select id="hook-val">${m.options.map((o, i) => `<option value="${esc(o)}">${esc(m.optionLabels?.[i] || o)}</option>`).join("")}</select>` : `<input id="hook-val" required type="${m.type === "string" ? "text" : "number"}" step="any" value="${esc(values[m.path] ?? (op === "increment" ? 1 : (m.min ?? "")))}">`}</label>`;
}
$("#refresh").onclick = refresh;
$("#nav").onclick = (e) => {
  const b = e.target.closest("[data-view]");
  if (!b || !catalog.length) return;
  view = b.dataset.view;
  render();
  refresh();
};
$("#content").addEventListener("input", (e) => {
  if (e.target.dataset.field) e.target.dataset.dirty = "1";
  if (e.target.dataset.fader) {
    e.target.dataset.dragging = "1";
    const out = $(`[data-db="${e.target.dataset.fader}"]`);
    if (out) out.textContent = db(positionToDb(Number(e.target.value))) + " dB";
  }
});
$("#content").addEventListener("change", (e) => {
  if (e.target.dataset.fader) {
    delete e.target.dataset.dragging;
    send(e.target.dataset.fader, "set", positionToDb(Number(e.target.value)));
  }
});
$("#content").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.sendPage) {
    sendPage = d.sendPage;
    render();
    refresh();
  }
  if (d.openSend !== undefined) {
    sendDestination = d.openSend;
    sendPage = d.startPage || "sources";
    view = "sends";
    render();
    refresh();
  }
  if (d.openRack !== undefined) {
    fxSlot = d.openRack;
    view = "effects";
    render();
    refresh();
  }
  if (d.processRoot) {
    selected = d.processRoot;
    bank = "returns";
    tab = "eq";
    view = "mixer";
    render();
    refresh();
  }
  if (d.bank) {
    bank = d.bank;
    render();
    refresh();
  }
  if (d.select) {
    selected = d.select;
    tab = "mix";
    render();
    refresh();
  }
  if (d.tab) {
    tab = d.tab;
    if (view === "sends") sendPage = d.tab;
    generation++;
    renderInspector();
    refresh();
  }
  if (d.toggle || d.mute) send(d.toggle || d.mute, "toggle");
  if (d.save) {
    const el = $(`[data-field="${d.save}"]`);
    if (el.reportValidity()) send(d.save, "set", fieldValue(d.save, el));
  }
  if (d.hookRoot) openHook(d.hookRoot + ".mute");
  if (["new-hook", "first-hook", "jump-hook"].includes(b.id))
    openHook("strip.0.mute");
  if (d.copyHook) {
    try {
      await navigator.clipboard.writeText(
        location.origin + "/hooks/" + d.copyHook,
      );
      toast("Webhook URL copied");
    } catch {
      toast("Select and copy the URL shown on the card.");
    }
  }
  if (
    d.deleteHook &&
    confirm("Delete this webhook? Its URL will stop working.")
  ) {
    try {
      await api("/api/hooks/" + d.deleteHook, null, "DELETE");
      render();
    } catch (e) {
      toast(e.message);
    }
  }
});
$("#close-hook").onclick = () => $("#hook-dialog").close();
$("#hook-target").onchange = () => hookControls();
$("#hook-path").onchange = () => {
  $("#hook-operation").value =
    meta[$("#hook-path").value].type === "bool" ? "toggle" : "set";
  hookValue();
};
$("#hook-operation").onchange = hookValue;
$("#hook-form").onsubmit = async (e) => {
  e.preventDefault();
  const path = $("#hook-path").value,
    operation = $("#hook-operation").value,
    m = meta[path];
  let value = null;
  if (operation !== "toggle") {
    const el = $("#hook-val");
    value =
      m.type === "bool"
        ? el.value === "true"
        : operation === "increment"
          ? Number(el.value)
          : fieldValue(path, el);
  }
  try {
    await api("/api/hooks", {
      name: $("#hook-name").value,
      commands: [{ path, operation, value }],
      allow_get: $("#hook-get").checked,
    });
    $("#hook-dialog").close();
    view = "hooks";
    render();
    toast("Webhook created");
  } catch (e) {
    toast(e.message);
  }
};
setInterval(() => {
  if (!document.hidden && !$("#hook-dialog").open && !$("#layout-dialog")?.open)
    refresh();
}, 2500);
init();
