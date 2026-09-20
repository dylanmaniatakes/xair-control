const $ = (id) => document.getElementById(id);
let socket,
  context,
  action,
  requestId = 0,
  discoveredServer = "",
  discoveredRoots = new Set(),
  savedRoot = "strip.0";
const send = (message) => {
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
};
window.connectElgatoStreamDeckSocket = (
  port,
  uuid,
  event,
  info,
  actionInfo,
) => {
  const details = JSON.parse(actionInfo);
  // Inspector commands use its registration UUID; Stream Deck routes them to the action.
  context = uuid;
  action = details.action;
  const settings = details.payload.settings || {};
  savedRoot = settings.root || "strip.0";
  $("server").value = settings.server || "";
  $("step").value = settings.step ?? 1;
  $("fine").value = settings.fine ?? 0.1;
  $("root").replaceChildren(new Option(savedRoot, savedRoot));
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen = () => {
    send({ event, uuid });
    if (settings.server) discover();
  };
  socket.onmessage = (e) => {
    const message = JSON.parse(e.data);
    if (
      message.event !== "sendToPropertyInspector" ||
      message.payload.requestId !== requestId
    )
      return;
    const result = message.payload;
    $("discover").disabled = false;
    if (result.error) {
      $("status").textContent = result.error;
      return;
    }
    discoveredServer = $("server").value.trim();
    discoveredRoots = new Set(result.channels.map((c) => c.root));
    $("root").replaceChildren(
      ...result.channels.map((c) => new Option(c.label, c.root)),
    );
    if (discoveredRoots.has(savedRoot)) $("root").value = savedRoot;
    $("status").textContent =
      `Connected · ${result.mode === "demo" ? "DEMO simulator" : "Live mixer"} · ${result.channels.length} faders`;
  };
};
function discover() {
  if (!$("server").reportValidity()) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    $("status").textContent = "Open these settings inside Stream Deck.";
    return;
  }
  discoveredRoots.clear();
  const id = ++requestId;
  $("discover").disabled = true;
  $("status").textContent = "Loading channels…";
  send({
    event: "sendToPlugin",
    action,
    context,
    payload: {
      event: "discover",
      server: $("server").value.trim(),
      requestId: id,
    },
  });
  setTimeout(() => {
    if (id === requestId && $("discover").disabled) {
      $("discover").disabled = false;
      $("status").textContent = "Connection timed out. Try again.";
    }
  }, 10000);
}
$("discover").onclick = discover;
$("server").oninput = () => {
  requestId++;
  discoveredRoots.clear();
  $("discover").disabled = false;
};
$("settings").onsubmit = (e) => {
  e.preventDefault();
  if (
    $("server").value.trim() !== discoveredServer ||
    !discoveredRoots.has($("root").value)
  ) {
    $("status").textContent = "Connect & load channels before saving.";
    return;
  }
  savedRoot = $("root").value;
  send({
    event: "setSettings",
    action,
    context,
    payload: {
      server: discoveredServer,
      root: savedRoot,
      step: Number($("step").value),
      fine: Number($("fine").value),
    },
  });
  $("status").textContent = "Dial saved.";
};
