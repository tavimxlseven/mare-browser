"use strict";
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
// The renderer never receives this object, executable paths or a generic spawn API.
class Bridge extends EventEmitter {
  constructor(exe, profile) {
    super();
    this.seq = 0;
    this.pending = new Map();
    this.buffer = "";
    this.child = spawn(exe, ["--linux-host", profile], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 16 * 1024 * 1024) {
        this.child.kill();
        return;
      }
      for (let pos; (pos = this.buffer.indexOf("\n")) >= 0; ) {
        const line = this.buffer.slice(0, pos);
        this.buffer = this.buffer.slice(pos + 1);
        let v;
        try {
          v = JSON.parse(line);
        } catch {
          this.child.kill();
          return;
        }
        if (v.kind === "ready") this.resolveReady(v.apps);
        else if (v.kind === "app") this.emit("app", v);
        else {
          const pending = this.pending.get(v.seq);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(v.seq);
            v.error
              ? pending.reject(Error(v.error))
              : pending.resolve(v.result);
          }
        }
      }
    });
    this.child.stderr.on("data", () => {}); // Never dump personal paths or account responses into browser logs.
    const failed = () => {
      const error = Error(
        "O serviço nativo encerrou. Reabra o Compass para reconectar.",
      );
      this.rejectReady(error);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      this.pending.clear();
      this.emit("closed");
    };
    this.child.once("error", failed);
    this.child.once("exit", failed);
    this.child.stdin.on("error", () => {});
  }
  request(value) {
    if (this.child.exitCode !== null || this.child.killed)
      return Promise.reject(Error("Serviço nativo indisponível."));
    if (this.pending.size >= 512)
      return Promise.reject(Error("Aguarde as operações em andamento."));
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(Error("O serviço nativo demorou a responder."));
      }, 10000);
      this.pending.set(seq, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...value, seq }) + "\n");
    });
  }
  async close() {
    this.child.stdin.end();
    await new Promise((resolve) => {
      if (this.child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 4000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
module.exports = { Bridge };
