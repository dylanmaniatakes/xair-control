// Destination-focused presentation. All writes use the existing control handlers.
let sendDestination = "",
  sendPage = "sources",
  fxSlot = "0";
function sendName(i) {
  const n = roots("bus").length;
  return Layouts.label(
    `send.${i}`,
    i < n ? displayRoot(`bus.${i}`) : `FX ${i - n + 1}`,
  );
}
// Ordered X AIR type table: pmaillot/X32-Behringer, XAirSetScene.h (Xfxtyp4).
const fxAlgorithms = [
  "Hall reverb",
  "Ambience",
  "Rich plate",
  "Room reverb",
  "Chamber reverb",
  "Plate reverb",
  "Vintage reverb",
  "Vintage room",
  "Gated reverb",
  "Reverse reverb",
  "Stereo delay",
  "3-tap delay",
  "4-tap delay",
  "Chorus",
  "Flanger",
  "Phaser",
  "Dimension chorus",
  "Mood filter",
  "Rotary speaker",
  "Tremolo / panner",
  "Sub octaver",
  "Delay + reverb",
  "Chorus + reverb",
  "Flanger + reverb",
  "Delay + chorus",
  "Delay + flanger",
  "Modulation delay",
  "GEQ2",
  "GEQ",
  "TEQ2",
  "TEQ",
  "DES2",
  "DES",
  "P1A",
  "P1A2",
  "PQ5",
  "PQ5S",
  "WAVD",
  "LIM",
  "CMB",
  "CMB2",
  "FAC",
  "FAC1M",
  "FAC2",
  "LEC",
  "LEC2",
  "Ultimo compressor",
  "Dual Ultimo compressor",
  "ENH2",
  "ENH",
  "EXC2",
  "EXC",
  "IMG",
  "EDI",
  "SON",
  "AMP2",
  "AMP",
  "DRV2",
  "DRV",
  "PIT2",
  "PIT",
];
function friendlyControl(path, label) {
  if (path.endsWith(".eq.mode"))
    return control(
      {
        ...meta[path],
        label,
        optionLabels: ["Parametric EQ", "Graphic EQ", "True EQ"],
      },
      true,
    );
  if (/^fx\.\d+\.type$/.test(path))
    return control(
      {
        ...meta[path],
        label: "Effect algorithm",
        type: "enum",
        options: Array.from({ length: 128 }, (_, i) => i),
        optionLabels: Array.from(
          { length: 128 },
          (_, i) => fxAlgorithms[i] || `Algorithm ${i} (unlisted)`,
        ),
      },
      true,
    );
  return meta[path] ? control({ ...meta[path], label }, true) : "";
}
function controlSection(heading, description, body) {
  return `<section class="card workflow-card"><h2>${esc(heading)}</h2><p class="muted">${esc(description)}</p>${body}</section>`;
}
function sourceControls(index, kinds) {
  const list = Layouts.visible(
    kinds.flatMap((k) => (k === "auxreturn" ? [k] : roots(k))),
  );
  return `<div class="control-grid">${list.map((r) => friendlyControl(`${r}.send.${index}.level`, displayRoot(r))).join("") || "<p>No visible sources. Use Edit layout to show channels.</p>"}</div>`;
}
function renderBusWorkspace(c) {
  const n = roots("bus").length;
  const destinations = Layouts.visible(
    Array.from({ length: n + 4 }, (_, i) => `send.${i}`),
  );
  if (!destinations.includes(`send.${sendDestination}`))
    sendDestination = destinations[0]?.split(".")[1] || "";
  c.innerHTML = title(
    "Choose a destination, build its mix, and shape its sound.",
  );
  if (!destinations.length) {
    c.innerHTML +=
      '<div class="card">All destinations are hidden. Use Edit layout or Show all.</div>';
    return;
  }
  const i = Number(sendDestination),
    isBus = i < n,
    root = isBus ? `bus.${i}` : `fxsend.${i - n}`;
  const pages = isBus
    ? [
        ["sources", "Input sends"],
        ["eq", "Bus EQ"],
        ["geq", "Graphic EQ"],
        ["dyn", "Dynamics"],
        ["insert", "Insert effect"],
        ["returns", "FX returns"],
      ]
    : [
        ["sources", "Input sends"],
        ["rack", "Effect & return"],
      ];
  if (!pages.some(([key]) => key === sendPage)) sendPage = "sources";
  c.innerHTML += `<div class="toolbar"><label>Destination<select id="send-dest">${destinations
    .map((id) => {
      const index = id.split(".")[1];
      return `<option value="${index}" ${index === sendDestination ? "selected" : ""}>${esc(sendName(Number(index)))}</option>`;
    })
    .join(
      "",
    )}</select></label><span class="hint">${isBus ? "Processing here affects the whole bus mix." : "Send channels into this shared effect, then blend its return."}</span></div><div class="signal-flow"><span>Input sends</span><b>→</b><span>${esc(sendName(i))}</span><b>→</b><span>${isBus ? "Bus output" : "Effect → stereo return"}</span></div><div class="destination-workspace"><aside class="destination-master">${strip(root)}<small>Destination master level</small></aside><div class="destination-body"><div class="detail-tabs">${pages.map(([key, label]) => `<button data-send-page="${key}" class="${key === sendPage ? "active" : ""}">${label}</button>`).join("")}</div><div id="destination-panel"></div></div></div>`;
  const panel = $("#destination-panel");
  if (sendPage === "sources")
    panel.innerHTML = controlSection(
      "Build the mix",
      `How much of each source reaches ${sendName(i)}. These controls do not move the source's main fader.`,
      sourceControls(i, ["strip", "auxreturn"]),
    );
  if (sendPage === "returns")
    panel.innerHTML =
      controlSection(
        "Blend effects into this bus",
        "These levels add existing processed FX returns to this bus. To process the entire bus instead, use Insert effect.",
        sourceControls(i, ["fxreturn"]),
      ) + '<button class="quiet" data-open-rack="0">Open FX rack →</button>';
  if (["eq", "geq", "dyn", "insert"].includes(sendPage)) {
    selected = root;
    tab = sendPage;
    panel.innerHTML = '<section class="detail" id="inspector"></section>';
    renderInspector();
    if (sendPage === "geq")
      panel.insertAdjacentHTML(
        "afterbegin",
        '<p class="hint">Choose Graphic EQ or True EQ under Bus EQ → EQ mode to use these bands.</p>',
      );
    panel.querySelector(".detail-tabs").remove();
  }
  if (sendPage === "rack") panel.innerHTML = fxSlotPanel(String(i - n));
  $("#send-dest").onchange = () => {
    sendDestination = $("#send-dest").value;
    generation++;
    renderBusWorkspace(c);
    paint();
    refresh();
  };
}
function fxSlotPanel(index) {
  const root = `fxreturn.${index}`;
  return (
    controlSection(
      `FX ${Number(index) + 1} engine`,
      "This engine is shared. Changing its algorithm affects every channel or bus using this slot.",
      `<div class="control-grid">${friendlyControl(`fx.${index}.type`, "Algorithm ID")}${friendlyControl(`fx.${index}.insert`, "Insert mode")}</div><p class="hint">Insert mode uses this slot for channel/bus inserts; disable it for shared send/return use. Algorithm-specific parameters are not exposed by the Python API.</p>`,
    ) +
    controlSection(
      "Return to your mix",
      "Control the processed signal coming back from this effect. Bus return levels are available under Sends & buses → FX returns.",
      `<div class="control-grid">${friendlyControl(`${root}.mix.fader`, "Return level")}${friendlyControl(`${root}.mute`, "Mute return")}${friendlyControl(`${root}.mix.lr`, "Send return to main LR")}</div><button class="quiet" data-process-root="${root}">Return EQ & processing →</button>`,
    )
  );
}
function renderFxWorkspace(c) {
  const slots = roots("fx")
    .map((r) => r.split(".")[1])
    .filter(
      (i) =>
        Layouts.isVisible(`fxsend.${i}`) || Layouts.isVisible(`fxreturn.${i}`),
    );
  if (!slots.includes(fxSlot)) fxSlot = slots[0];
  c.innerHTML = title(
    "Keep each effect engine, its input mix, and its return together.",
  );
  if (!slots.length) {
    c.innerHTML +=
      '<div class="card">All FX slots are hidden. Use Edit layout or Show all.</div>';
    return;
  }
  c.innerHTML += `<div class="toolbar"><label>Effect slot<select id="fx-slot">${slots.map((i) => `<option value="${i}" ${i === fxSlot ? "selected" : ""}>FX ${Number(i) + 1}</option>`).join("")}</select></label><button class="quiet" data-open-send="${roots("bus").length + Number(fxSlot)}">Input sends →</button></div><div class="signal-flow"><span>Channel sends</span><b>→</b><span>FX ${Number(fxSlot) + 1}</span><b>→</b><span>Stereo return → main / buses</span></div>${fxSlotPanel(fxSlot)}<div class="card"><h2>Use an effect on a bus</h2><p>Choose a bus to EQ its full mix, insert an effect, or blend an FX return into it.</p><div class="toolbar">${
    Layouts.visible(roots("bus"))
      .filter((r) => Layouts.isVisible(`send.${r.split(".")[1]}`))
      .map(
        (r) =>
          `<button class="quiet" data-open-send="${r.split(".")[1]}" data-start-page="insert">${esc(displayRoot(r))} →</button>`,
      )
      .join("") || "<p>Buses are hidden in this layout.</p>"
  }</div></div>`;
  $("#fx-slot").onchange = () => {
    fxSlot = $("#fx-slot").value;
    generation++;
    renderFxWorkspace(c);
    paint();
    refresh();
  };
}
function processingBody(fields, root, group) {
  const items = fields.filter((m) => m.path.startsWith(`${root}.${group}.`));
  if (group === "eq") {
    const common = items.filter(
      (m) => m.path.slice(root.length + 1).split(".").length === 2,
    );
    const bands = ["low", "low2", "lomid", "himid", "high2", "high"].filter(
      (b) => items.some((m) => m.path.startsWith(`${root}.eq.${b}.`)),
    );
    return `<p class="hint">Enable EQ, choose its mode, then adjust each band. Set applies one value at a time.</p><div class="control-grid">${common.map((m) => friendlyControl(m.path, m.path.endsWith(".on") ? "EQ enabled" : "EQ mode")).join("")}</div><div class="eq-bands">${bands.map((b, i) => `<section class="eq-band"><h3>Band ${i + 1} <small>${{ low: "Low", low2: "Low-mid", lomid: "Mid-low", himid: "Mid-high", high2: "High-mid", high: "High" }[b]}</small></h3>${["frequency", "gain", "quality", "type"].map((key) => friendlyControl(`${root}.eq.${b}.${key}`, { frequency: "Frequency", gain: "Gain", quality: "Width (Q)", type: "Filter shape" }[key])).join("")}</section>`).join("")}</div>`;
  }
  if (group === "insert")
    return `<div class="routing-help"><h3>Process the whole ${root.startsWith("bus.") ? "bus" : "channel"}</h3><p>An insert applies an FX engine to this signal. For a shared reverb or delay blended into a bus, use its FX returns instead.</p><p>In the FX rack, enable Insert mode for your chosen engine. Then select its slot here, press Set, and enable this insert. Slots are shared with other channels; changing an engine can affect them too.</p></div><div class="control-grid">${friendlyControl(`${root}.insert.sel`, "FX slot / side")}${friendlyControl(`${root}.insert.on`, "Insert enabled")}</div><p class="hint">A and B select the two sides of an FX slot. Choose an algorithm appropriate for insert use.</p><button class="quiet" data-open-rack="0">Configure FX engines →</button>`;
  return `<div class="control-grid">${items.map(control).join("")}</div>`;
}
