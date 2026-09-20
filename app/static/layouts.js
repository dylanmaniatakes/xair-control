// Presentation preferences only. Never call a mixer command endpoint here.
const Layouts = (() => {
  let saved = {},
    active = "",
    model = "",
    draft = null,
    editingId = "",
    section = "inputs",
    dragId = null;
  const defaults = () => ({
    name: "Full mixer",
    model,
    hidden: [],
    order: [],
    labels: {},
  });
  const current = () =>
    saved[active]?.model === model ? saved[active] : defaults();
  const storageKey = () => `xair-layout-${model}`;
  const ordered = (items, layout = current()) =>
    [...items].sort((a, b) => {
      const rank = (id) =>
        layout.order.includes(id)
          ? layout.order.indexOf(id)
          : layout.order.length + items.indexOf(id);
      return rank(a) - rank(b);
    });
  const visible = (items) =>
    ordered(items).filter((id) => !current().hidden.includes(id));
  const label = (id, fallback) => current().labels[id] || fallback;
  function groups() {
    return {
      inputs: roots("strip"),
      buses: roots("bus"),
      returns: [...roots("fxsend"), ...roots("fxreturn"), "auxreturn", "lr"],
      sends: Array.from(
        { length: roots("bus").length + 4 },
        (_, i) => `send.${i}`,
      ),
    };
  }
  function itemName(id) {
    if (id.startsWith("send.")) {
      const i = Number(id.split(".")[1]),
        count = roots("bus").length;
      return i < count
        ? `Send to ${displayRoot("bus." + i)}`
        : `Send to FX ${i - count + 1}`;
    }
    return displayRoot(id);
  }
  async function load(nextModel) {
    model = nextModel;
    saved = await api("/api/layouts");
    try {
      active = localStorage.getItem(storageKey()) || "";
    } catch {
      active = "";
    }
    if (saved[active]?.model !== model) active = "";
    mount();
  }
  function mount() {
    let bar = document.querySelector("#layout-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "layout-bar";
      document.querySelector("header").after(bar);
    }
    bar.innerHTML = `<label>Layout <select id="layout-select" aria-label="Active layout"><option value="">Full mixer</option>${Object.entries(
      saved,
    )
      .filter(([, l]) => l.model === model)
      .map(
        ([id, l]) =>
          `<option value="${id}" ${id === active ? "selected" : ""}>${esc(l.name)}</option>`,
      )
      .join(
        "",
      )}</select></label><button class="quiet" id="edit-layout">✎ Edit layout</button><span class="layout-summary">${current().hidden.length ? current().hidden.length + " hidden" : "All controls visible"}</span><button class="quiet" id="layout-show-all">Show all</button>`;
    $("#layout-select").onchange = () => activate($("#layout-select").value);
    $("#edit-layout").onclick = open;
    $("#layout-show-all").onclick = () => activate("");
  }
  function activate(id) {
    active = id;
    try {
      localStorage.setItem(storageKey(), active);
    } catch {}
    mount();
    render();
    refresh();
  }
  function open() {
    editingId = active;
    draft = structuredClone(current());
    if (!active) draft.name = "My layout";
    section =
      view === "sends"
        ? "sends"
        : bank === "buses"
          ? "buses"
          : bank === "returns"
            ? "returns"
            : "inputs";
    let dialog = $("#layout-dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "layout-dialog";
      document.body.append(dialog);
    }
    dialog.innerHTML = `<form id="layout-form"><div class="section-heading"><div><h2>Edit layout</h2><small>Only your interface changes. Audio routing and levels stay as they are.</small></div><button type="button" class="quiet" id="layout-cancel">✕</button></div><div class="layout-name-row"><label>Layout name<input id="layout-name" value="${esc(draft.name)}" maxlength="60" required></label><button type="button" class="quiet" id="draft-show-all">Show all items</button></div><div class="detail-tabs" id="layout-tabs"></div><p class="muted">Check items to show them. Drag the grip or use the arrows to reorder. Display names are optional and never rename mixer channels.</p><div id="layout-items"></div><div class="layout-actions"><button type="button" class="quiet" id="layout-delete" ${editingId ? "" : "hidden"}>Delete layout</button><span></span><button type="button" class="quiet" id="layout-copy" ${editingId ? "" : "hidden"}>Save as new</button><button type="button" class="quiet" id="layout-discard">Cancel</button><button class="primary" id="layout-save">Save layout</button></div><p id="layout-error" role="alert"></p></form>`;
    $("#layout-cancel").onclick = $("#layout-discard").onclick = () =>
      dialog.close();
    $("#draft-show-all").onclick = () => {
      draft.hidden = [];
      draw();
    };
    $("#layout-form").onsubmit = (e) => {
      e.preventDefault();
      save(false);
    };
    $("#layout-copy").onclick = () => {
      if ($("#layout-form").reportValidity()) save(true);
    };
    $("#layout-delete").onclick = async () => {
      if (!confirm("Delete this saved layout? Mixer settings will not change."))
        return;
      try {
        await api("/api/layouts/" + editingId, null, "DELETE");
        delete saved[editingId];
        dialog.close();
        activate("");
      } catch (e) {
        $("#layout-error").textContent = e.message;
      }
    };
    draw();
    dialog.showModal();
  }
  function draw() {
    const labels = {
      inputs: "Inputs",
      buses: "Buses",
      returns: "FX, returns & main",
      sends: "Send destinations",
    };
    $("#layout-tabs").innerHTML = Object.entries(labels)
      .map(
        ([id, name]) =>
          `<button type="button" data-layout-section="${id}" class="${section === id ? "active" : ""}">${name}</button>`,
      )
      .join("");
    $("#layout-tabs").onclick = (e) => {
      const b = e.target.closest("[data-layout-section]");
      if (b) {
        section = b.dataset.layoutSection;
        draw();
      }
    };
    const ids = ordered(groups()[section], draft);
    $("#layout-items").innerHTML = ids
      .map(
        (id, i) =>
          `<div class="layout-item ${draft.hidden.includes(id) ? "is-hidden" : ""}" data-layout-item="${id}"><span class="drag-grip" draggable="true" data-drag-id="${id}" title="Drag to reorder">⠿</span><label class="check"><input type="checkbox" data-visible-id="${id}" ${draft.hidden.includes(id) ? "" : "checked"} aria-label="Show ${esc(itemName(id))}"><span>${esc(itemName(id))}<small>${id}</small></span></label><input class="display-name" data-label-id="${id}" aria-label="Display name for ${esc(itemName(id))}" maxlength="32" placeholder="Mixer name" value="${esc(draft.labels[id] || "")}"><button type="button" class="quiet" data-move-id="${id}" data-direction="-1" aria-label="Move ${esc(itemName(id))} up" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="quiet" data-move-id="${id}" data-direction="1" aria-label="Move ${esc(itemName(id))} down" ${i === ids.length - 1 ? "disabled" : ""}>↓</button></div>`,
      )
      .join("");
    const list = $("#layout-items");
    list.onchange = (e) => {
      if (e.target.dataset.visibleId) {
        const id = e.target.dataset.visibleId;
        draft.hidden = draft.hidden.filter((x) => x !== id);
        if (!e.target.checked) draft.hidden.push(id);
        e.target
          .closest(".layout-item")
          .classList.toggle("is-hidden", !e.target.checked);
      }
    };
    list.oninput = (e) => {
      if (e.target.dataset.labelId)
        draft.labels[e.target.dataset.labelId] = e.target.value;
    };
    list.onclick = (e) => {
      const b = e.target.closest("[data-move-id]");
      if (b) {
        const from = ids.indexOf(b.dataset.moveId);
        reorder(ids, from, from + Number(b.dataset.direction));
      }
    };
    list.ondragstart = (e) => {
      const grip = e.target.closest("[data-drag-id]");
      if (!grip) return;
      dragId = grip.dataset.dragId;
      e.dataTransfer.setData("text/plain", dragId);
      e.dataTransfer.effectAllowed = "move";
    };
    list.ondragover = (e) => {
      if (dragId && e.target.closest("[data-layout-item]")) e.preventDefault();
    };
    list.ondrop = (e) => {
      const row = e.target.closest("[data-layout-item]");
      if (!row || !dragId) return;
      e.preventDefault();
      reorder(ids, ids.indexOf(dragId), ids.indexOf(row.dataset.layoutItem));
      dragId = null;
    };
    list.ondragend = () => {
      dragId = null;
    };
  }
  function reorder(ids, from, to) {
    if (from < 0 || to < 0 || to >= ids.length) return;
    const updated = [...ids];
    updated.splice(to, 0, updated.splice(from, 1)[0]);
    draft.order = [
      ...draft.order.filter((id) => !ids.includes(id)),
      ...updated,
    ];
    draw();
  }
  async function save(copy) {
    const name = $("#layout-name").value.trim();
    if (!name) {
      $("#layout-error").textContent = "Enter a layout name";
      return;
    }
    $("#layout-save").disabled = true;
    $("#layout-copy").disabled = true;
    try {
      draft.name = name;
      const id = copy ? "" : editingId;
      const result = await api(
        "/api/layouts" + (id ? "/" + id : ""),
        draft,
        id ? "PUT" : "POST",
      );
      saved[result.id] = result;
      $("#layout-dialog").close();
      activate(result.id);
      toast("Layout saved. Mixer settings unchanged.");
    } catch (e) {
      $("#layout-error").textContent = e.message;
    } finally {
      $("#layout-save").disabled = false;
      $("#layout-copy").disabled = false;
    }
  }
  return {
    load,
    visible,
    label,
    isVisible: (id) => !current().hidden.includes(id),
    open,
  };
})();
