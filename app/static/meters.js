// Meter telemetry runs independently of slow property reads and never sends controls.
(() => {
  let frame = null;
  let receivedAt = 0;
  const percent = (db) =>
    `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
  const textDb = (db) => (db <= -120 ? "−∞" : db.toFixed(1));

  function paint() {
    const age = frame
      ? performance.now() - receivedAt + (frame.age_ms ?? 1000)
      : Infinity;
    const fresh = frame?.available && age <= 1000;
    for (const meter of document.querySelectorAll("[data-vu-root]")) {
      const root = meter.dataset.vuRoot;
      const channel = fresh ? frame.channels[root] : null;
      meter.classList.toggle("stale", !channel);
      meter.classList.toggle(
        "near-clip",
        !!channel?.peak_dbfs.some((db) => db >= -1),
      );
      [...meter.children].forEach((lane, i) => {
        const db = channel?.dbfs[i];
        const peak = channel?.peak_dbfs[i];
        lane.style.setProperty(
          "--vu-level",
          db === undefined ? "0%" : percent(db),
        );
        lane.style.setProperty(
          "--vu-peak",
          peak === undefined ? "0%" : percent(peak),
        );
        if (db === undefined) lane.removeAttribute("aria-valuenow");
        else
          lane.setAttribute(
            "aria-valuenow",
            Math.max(-60, Math.min(0, db)).toFixed(1),
          );
        lane.setAttribute(
          "aria-valuetext",
          db === undefined ? "Meter unavailable" : `${textDb(db)} dBFS`,
        );
      });
      const readout = document.querySelector(`[data-vu-reading="${root}"]`);
      if (readout) {
        readout.querySelector("output").textContent = channel
          ? textDb(Math.max(...channel.dbfs))
          : "—";
        readout.classList.toggle(
          "near-clip",
          !!channel?.peak_dbfs.some((db) => db >= -1),
        );
        readout.title = channel
          ? `${channel.tap === "pre" ? "Pre-fader" : "Post-fader"} · ${channel.dbfs.map((db, i) => `${channel.dbfs.length === 2 ? (i ? "R " : "L ") : ""}${textDb(db)} dBFS`).join(" / ")}${channel.peak_dbfs.some((db) => db >= -1) ? " · Near full scale (≥ −1 dBFS)" : ""}`
          : "No fresh meter data";
      }
    }
    const badge = document.querySelector("#meter-status");
    if (badge) {
      badge.textContent = fresh
        ? "● Live meters"
        : frame?.mode === "demo"
          ? "No audio in demo"
          : "○ Meters unavailable";
      badge.classList.toggle("live", !!fresh);
    }
  }

  async function poll() {
    if (!document.hidden && document.querySelector("[data-vu-root]")) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 900);
      try {
        const response = await fetch("/api/meters", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Meter request failed");
        frame = await response.json();
        receivedAt = performance.now();
      } catch {
        frame = null;
      } finally {
        clearTimeout(timeout);
      }
      paint();
    }
    setTimeout(poll, 100);
  }

  // A frozen connection must never leave apparently-live bars on screen.
  setInterval(paint, 200);
  poll();
})();
