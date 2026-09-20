import {
  configuration,
  readState,
  adjust,
  toggle,
  channels,
  feedback,
} from "./client.js";
export class Controller {
  constructor(send, { fetcher = fetch, pollMs = 1000, batchMs = 60 } = {}) {
    this.send = send;
    this.fetcher = fetcher;
    this.batchMs = batchMs;
    this.states = new Map();
    this.queues = new Map();
    this.timer = setInterval(() => {
      for (const s of this.states.values()) this.poll(s);
    }, pollMs);
    this.timer.unref?.();
  }
  close() {
    clearInterval(this.timer);
    for (const s of this.states.values()) {
      s.dead = true;
      clearTimeout(s.timer);
    }
    this.states.clear();
  }
  current(s) {
    return !s.dead && this.states.get(s.context) === s;
  }
  output(s, payload) {
    if (this.current(s))
      this.send({ event: "setFeedback", context: s.context, payload });
  }
  error(s, e) {
    this.output(s, { title: "X AIR Control", value: e.message, indicator: 0 });
  }
  async serial(s, fn) {
    const key = `${s.config.server}|${s.config.root}`;
    const before = this.queues.get(key) || Promise.resolve();
    const next = before
      .catch(() => {})
      .then(() => (this.current(s) ? fn() : undefined));
    this.queues.set(key, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(key) === next) this.queues.delete(key);
    }
  }
  configure(context, settings) {
    const previous = this.states.get(context);
    if (previous) {
      previous.dead = true;
      clearTimeout(previous.timer);
    }
    const s = { context, settings, pending: 0, dead: false, turned: false };
    this.states.set(context, s);
    try {
      s.config = configuration(settings);
      this.poll(s);
    } catch (e) {
      this.error(s, e);
    }
  }
  async poll(s) {
    if (!s.config || s.polling || s.busy || s.pending) return;
    s.polling = true;
    try {
      await this.serial(s, async () =>
        this.output(s, feedback(await readState(s.config, this.fetcher))),
      );
    } catch (e) {
      this.error(s, e);
    } finally {
      s.polling = false;
    }
  }
  async flush(s) {
    if (s.busy || !this.current(s)) return;
    s.busy = true;
    try {
      while (s.pending && this.current(s)) {
        const delta = s.pending;
        s.pending = 0;
        await this.serial(s, () =>
          adjust(s.config, delta, this.fetcher, () => this.current(s)),
        );
      }
      await this.serial(s, async () =>
        this.output(s, feedback(await readState(s.config, this.fetcher))),
      );
    } catch (e) {
      s.pending = 0;
      this.error(s, e);
    } finally {
      s.busy = false;
    }
  }
  handle(message) {
    const { event, context, payload = {} } = message;
    if (event === "willAppear" || event === "didReceiveSettings") {
      this.configure(context, payload.settings || {});
      return;
    }
    if (event === "willDisappear") {
      const s = this.states.get(context);
      if (s) {
        s.dead = true;
        clearTimeout(s.timer);
      }
      this.states.delete(context);
      return;
    }
    if (event === "sendToPlugin" && payload.event === "discover") {
      // Connection testing is read-only and uses unsaved inspector values.
      this.discover(context, payload);
      return;
    }
    const s = this.states.get(context);
    if (!s?.config) return;
    if (event === "dialDown") s.turned = false;
    if (event === "dialRotate") {
      if (!Number.isInteger(payload.ticks) || Math.abs(payload.ticks) > 1000)
        return;
      if (payload.pressed) s.turned = true;
      s.pending +=
        payload.ticks * (payload.pressed ? s.config.fine : s.config.step);
      if (!s.timer)
        s.timer = setTimeout(() => {
          s.timer = undefined;
          this.flush(s);
        }, this.batchMs);
    }
    if (event === "dialUp" && !s.turned) {
      this.serial(s, () => toggle(s.config, this.fetcher))
        .then(() => this.poll(s))
        .catch((e) => this.error(s, e));
    }
    if (event === "touchTap") this.poll(s);
  }
  async discover(context, payload) {
    try {
      const config = configuration({ server: payload.server });
      const result = await channels(config.server, this.fetcher);
      this.send({
        event: "sendToPropertyInspector",
        context,
        payload: { requestId: payload.requestId, ...result },
      });
    } catch (e) {
      this.send({
        event: "sendToPropertyInspector",
        context,
        payload: { requestId: payload.requestId, error: e.message },
      });
    }
  }
}
