import { setTimeout as delay } from "node:timers/promises";
export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.errors = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.method === "Runtime.exceptionThrown")
        this.errors.push(m.params.exceptionDetails.text);
      if (!m.id) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    };
  }
  call(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("CDP timeout " + method));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
  ipc(value) {
    return this.eval(
      `window.ipc.postMessage(${JSON.stringify(JSON.stringify(value))});true`,
    );
  }
  click(selector) {
    return this.eval(
      `document.querySelector(${JSON.stringify(selector)}).click();true`,
    );
  }
  close() {
    this.ws.close();
  }
}
export async function connect(port = 9251) {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) =>
    r.json(),
  );
  for (const target of list.filter((t) => t.type === "page")) {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const c = new CDP(ws);
    if (await c.eval("Boolean(window.mare?.receive&&window.ipc?.postMessage)"))
      return c;
    c.close();
  }
  throw Error("UI not found");
}
export async function until(label, test, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await test();
    if (result) return result;
    await delay(90);
  }
  throw Error("Timeout " + label);
}
