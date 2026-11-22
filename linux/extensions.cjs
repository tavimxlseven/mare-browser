"use strict";

const { BrowserWindow } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const run = promisify(execFile);
const validId = (id) => typeof id === "string" && /^[a-p]{32}$/.test(id);

class Extensions {
  constructor(session, directory, worker) {
    this.session = session;
    this.directory = directory;
    this.worker = worker;
    this.items = new Map();
    this.popups = new Map();
    this.prepared = null;
    this.busy = false;
  }

  folder(id) {
    return path.join(this.directory, id);
  }

  async restore() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (/^\.(review|removed)-[a-z0-9]+$/i.test(entry.name)) {
        await fs.rm(this.folder(entry.name), { recursive: true, force: true }).catch(() => {});
        continue;
      }
      if (!validId(entry.name)) continue;
      const id = entry.name;
      try {
        const item = JSON.parse(await fs.readFile(path.join(this.folder(id), "extension.json"), "utf8"));
        if (item.id !== id || typeof item.name !== "string") continue;
        this.items.set(id, item);
        if (item.enabled) await this.load(id);
      } catch {
        // Keep the entry so the user can remove it or retry enabling it.
      }
    }
  }

  list() {
    return [...this.items.values()].map((item) => ({
      ...item,
      enabled: !!this.session.extensions.getExtension(item.id),
    }));
  }

  async prepare(input) {
    if (typeof input !== "string" || input.length > 8192)
      throw Error("Cole o link da extensão na Chrome Web Store.");
    await this.cancel();
    const directory = await fs.mkdtemp(path.join(this.directory, ".review-"));
    try {
      const { stdout } = await run(this.worker, ["--prepare-extension", directory, input], {
        timeout: 95000,
        maxBuffer: 512 * 1024,
      }).catch(() => { throw Error("Não foi possível verificar o pacote da extensão."); });
      const result = JSON.parse(stdout);
      if (result.error) throw Error(result.error);
      const { id, summary, folder } = result;
      if (!validId(id) || id !== summary?.id || folder !== "pending-" + id)
        throw Error("Pacote inválido.");
      if (this.items.has(id)) throw Error("Esta extensão já está instalada.");
      this.prepared = { directory, summary };
      return summary;
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async cancel() {
    if (!this.prepared) return;
    const { directory } = this.prepared;
    this.prepared = null;
    await fs.rm(directory, { recursive: true, force: true });
  }

  async load(id) {
    const extension = await this.session.extensions.loadExtension(
      path.join(this.folder(id), "pending-" + id),
      { allowFileAccess: false },
    );
    if (extension.id !== id) {
      this.session.extensions.removeExtension(extension.id);
      throw Error("O Chromium retornou um ID diferente do pacote verificado.");
    }
  }

  async install() {
    if (!this.prepared) throw Error("Verifique a extensão antes de instalar.");
    const { directory, summary } = this.prepared;
    const item = { ...summary, enabled: true };
    const folder = this.folder(item.id);
    await this.writeItem(item, directory);
    await fs.rename(directory, folder);
    this.prepared = null;
    try {
      await this.load(item.id);
      this.items.set(item.id, item);
    } catch {
      await fs.rm(folder, { recursive: true, force: true });
      throw Error("O Chromium não conseguiu carregar esta extensão.");
    }
  }

  async writeItem(item, directory = this.folder(item.id)) {
    const file = path.join(directory, "extension.json");
    await fs.writeFile(file + ".tmp", JSON.stringify(item), { mode: 0o600 });
    await fs.rename(file + ".tmp", file);
  }

  unload(id) {
    this.popups.get(id)?.destroy();
    if (this.session.extensions.getExtension(id)) this.session.extensions.removeExtension(id);
  }

  async setEnabled(id, enabled) {
    const item = this.items.get(id);
    if (!item) throw Error("Extensão não encontrada.");
    const next = { ...item, enabled };
    if (enabled && !this.session.extensions.getExtension(id)) await this.load(id);
    try {
      await this.writeItem(next);
    } catch (error) {
      if (enabled && !item.enabled) this.unload(id);
      throw error;
    }
    if (!enabled) this.unload(id);
    this.items.set(id, next);
  }

  async remove(id) {
    if (!this.items.has(id)) throw Error("Extensão não encontrada.");
    const directory = await fs.mkdtemp(path.join(this.directory, ".removed-"));
    const target = path.join(directory, id);
    await fs.rename(this.folder(id), target);
    this.unload(id);
    this.items.delete(id);
    await fs.rm(directory, { recursive: true, force: true });
  }

  async open(id, parent, openTab) {
    const item = this.items.get(id);
    if (!item?.popup || !this.session.extensions.getExtension(id))
      throw Error("Ative uma extensão com painel para abri-la.");
    const existing = this.popups.get(id);
    if (existing) {
      existing.focus();
      return;
    }
    const base = "chrome-extension://" + id + "/";
    const url = new URL(item.popup, base);
    if (!url.href.startsWith(base)) throw Error("Endereço inválido para o painel da extensão.");
    const popup = new BrowserWindow({
      parent,
      show: false,
      width: 460,
      height: 600,
      title: item.name,
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.popups.set(id, popup);
    popup.on("closed", () => this.popups.delete(id));
    popup.webContents.on("will-frame-navigate", (event) => {
      if (event.isMainFrame && !event.url.startsWith(base)) event.preventDefault();
    });
    popup.webContents.on("will-redirect", (event, target) => {
      if (!target.startsWith(base)) event.preventDefault();
    });
    popup.webContents.setWindowOpenHandler(({ url: target }) => {
      openTab(target);
      return { action: "deny" };
    });
    try {
      await popup.loadURL(url.href);
      if (!popup.isDestroyed()) popup.show();
    } catch (error) {
      if (!popup.isDestroyed()) popup.destroy();
      throw error;
    }
  }
}

module.exports = { Extensions };
