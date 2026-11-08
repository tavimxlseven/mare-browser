/* Native browser tools share the chrome's IPC; no remote page gets these APIs. */
window.createResourceDashboard = function (panel) {
  let history = [],
    range = 60000;
  const mount = document.createElement("section");
  mount.className = "resource-dashboard";
  mount.innerHTML =
    '<nav aria-label="Período do histórico"><strong>Histórico do Maré</strong><button data-range="60000" aria-pressed="true">1 min</button><button data-range="300000" aria-pressed="false">5 min</button><button data-range="900000" aria-pressed="false">15 min</button><small>Amostras coletadas enquanto este painel está aberto</small></nav><div class="resource-charts"><article><header><h3>CPU</h3><span>% da capacidade total do PC</span></header><div data-chart="cpu"></div></article><article><header><h3>RAM privada</h3><span>Memória residente exclusiva do Maré</span></header><div data-chart="ram"></div></article></div><article class="resource-groups"><h3>Por componente</h3><div></div></article>';
  panel.querySelector(".resource-totals").after(mount);
  function plot(field, values, max) {
    const target = mount.querySelector('[data-chart="' + field + '"]');
    if (values.length < 2) {
      target.innerHTML =
        '<p class="chart-empty">Coletando as primeiras amostras…</p>';
      return;
    }
    const first = values[0].at,
      last = values.at(-1).at;
    const points = values.map((value) => [
      ((value.at - first) / Math.max(1, last - first)) * 560,
      130 - (Math.min(max, value[field]) / max) * 118,
    ]);
    const path = points
      .map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1))
      .join(" ");
    const label = new Date(last).toLocaleTimeString("pt-BR");
    target.innerHTML =
      '<svg viewBox="0 0 560 154" role="img" aria-label="Histórico de ' +
      (field === "cpu" ? "CPU" : "RAM privada") +
      '"><defs><linearGradient id="history-' +
      field +
      '" x2="0" y2="1"><stop stop-color="currentColor" stop-opacity=".35"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><path class="chart-grid" d="M0 12H560M0 71H560M0 130H560"/><path d="' +
      path +
      'L560 130L0 130Z" fill="url(#history-' +
      field +
      ')"/><path class="chart-line" d="' +
      path +
      '"/><text x="0" y="150">' +
      new Date(first).toLocaleTimeString("pt-BR") +
      '</text><text x="560" y="150" text-anchor="end">' +
      label +
      '</text><text x="555" y="11" text-anchor="end">' +
      Math.ceil(max) +
      (field === "cpu" ? "%" : " MiB") +
      "</text></svg>";
  }
  function render() {
    const values = history.filter((v) => v.at >= Date.now() - range);
    plot(
      "cpu",
      values.filter((v) => v.cpu != null),
      100,
    );
    plot(
      "ram",
      values.filter((v) => v.ram != null),
      Math.max(64, ...values.map((v) => v.ram || 0)) * 1.15,
    );
  }
  mount.querySelectorAll("[data-range]").forEach(
    (button) =>
      (button.onclick = () => {
        range = Number(button.dataset.range);
        mount
          .querySelectorAll("[data-range]")
          .forEach((other) =>
            other.setAttribute("aria-pressed", String(other === button)),
          );
        render();
      }),
  );
  return {
    update(result) {
      history.push({
        at: result.sampled_at,
        cpu: result.totals.cpu_percent ?? null,
        ram:
          result.totals.private_working_set_bytes == null
            ? null
            : result.totals.private_working_set_bytes / 1048576,
      });
      history = history.slice(-450);
      render();
      const groups = new Map();
      for (const row of result.processes) {
        const g = groups.get(row.group) || { ram: 0, cpu: 0 };
        g.ram += row.private_working_set_bytes || 0;
        g.cpu += row.cpu_percent || 0;
        groups.set(row.group, g);
      }
      const max = Math.max(1, ...[...groups.values()].map((v) => v.ram));
      const list = mount.querySelector(".resource-groups>div");
      list.replaceChildren();
      for (const [name, value] of groups) {
        const row = document.createElement("div");
        row.className = "resource-group-meter";
        const label = document.createElement("strong");
        label.textContent = name;
        const meter = document.createElement("progress");
        meter.max = max;
        meter.value = value.ram;
        meter.ariaLabel = "RAM de " + name;
        const amount = document.createElement("span");
        amount.textContent =
          (value.ram / 1048576).toFixed(1) +
          " MiB · " +
          value.cpu.toFixed(1) +
          "% CPU";
        row.append(label, meter, amount);
        list.append(row);
      }
    },
  };
};

window.createDownloadCenter = function (panel, { send, icon, esc, status }) {
  let items = [],
    filter = "all",
    term = "";
  const samples = new Map();
  const categories = [
    ["all", "Todos"],
    ["active", "Em andamento"],
    ["completed", "Concluídos"],
    ["failed", "Interrompidos"],
    ["image", "Imagens"],
    ["video", "Vídeos"],
    ["audio", "Áudio"],
    ["app", "Aplicativos"],
    ["archive", "Compactados"],
    ["document", "Documentos"],
  ];
  const bytes = (n) =>
    n >= 1073741824
      ? (n / 1073741824).toFixed(2) + " GB"
      : n >= 1048576
        ? (n / 1048576).toFixed(1) + " MB"
        : n >= 1024
          ? Math.round(n / 1024) + " KB"
          : n + " B";
  const active = (item) =>
    ["choosing", "downloading", "paused", "pending", "started"].includes(
      item.status,
    );
  const kind = (item) => {
    const ext = item.filename.split(".").at(-1).toLowerCase();
    return /^(png|jpe?g|gif|webp|avif|svg|ico)$/.test(ext)
      ? "image"
      : /^(mp4|webm|mkv|mov|avi)$/.test(ext)
        ? "video"
        : /^(mp3|m4a|wav|flac|ogg|opus)$/.test(ext)
          ? "audio"
          : /^(exe|msi|msix|appx|apk)$/.test(ext)
            ? "app"
            : /^(zip|7z|rar|tar|gz|bz2)$/.test(ext)
              ? "archive"
              : "document";
  };
  const matches = (item, key) =>
    key === "all" ||
    (key === "active" && active(item)) ||
    (key === "completed" && ["completed", "concluído"].includes(item.status)) ||
    (key === "failed" &&
      !active(item) &&
      !["completed", "concluído"].includes(item.status)) ||
    kind(item) === key;
  panel.innerHTML =
    '<aside class="downloads-sidebar"><h3>Sua biblioteca de arquivos</h3><nav aria-label="Filtrar downloads"></nav></aside><section class="downloads-main"><div class="downloads-toolbar"><label>' +
    icon("search") +
    '<input type="search" aria-label="Buscar downloads" placeholder="Buscar pelo nome do arquivo"></label><button class="button" data-clear>Limpar encerrados</button></div><p class="downloads-summary" role="status"></p><div class="downloads-list"></div></section>';
  const nav = panel.querySelector("nav"),
    list = panel.querySelector(".downloads-list");
  for (const [key, name] of categories) {
    const button = document.createElement("button");
    button.dataset.filter = key;
    button.innerHTML = "<span>" + name + "</span><small>0</small>";
    button.onclick = () => {
      filter = key;
      render();
    };
    nav.append(button);
  }
  panel.querySelector("input").oninput = (event) => {
    term = event.target.value.toLocaleLowerCase();
    render();
  };
  panel.querySelector("[data-clear]").onclick = () =>
    send({ cmd: "clear_downloads" });
  function render() {
    for (const button of nav.children) {
      button.setAttribute(
        "aria-pressed",
        String(filter === button.dataset.filter),
      );
      button.querySelector("small").textContent = items.filter((item) =>
        matches(item, button.dataset.filter),
      ).length;
    }
    const showing = items.filter(
      (item) =>
        matches(item, filter) &&
        item.filename.toLocaleLowerCase().includes(term),
    );
    panel.querySelector(".downloads-summary").textContent =
      items.filter(active).length +
      " em andamento · " +
      items.length +
      " no histórico";
    panel.querySelector("[data-clear]").disabled = !items.some(
      (item) => !active(item),
    );
    const live = new Set(showing.map((item) => String(item.id)));
    for (const card of [...list.children])
      if (!live.has(card.dataset.downloadId)) card.remove();
    for (const item of showing) {
      let card = list.querySelector('[data-download-id="' + item.id + '"]');
      if (!card) {
        card = document.createElement("article");
        card.className = "download-card";
        card.dataset.downloadId = item.id;
        list.append(card);
      }
      const structure = JSON.stringify([
        item.filename,
        item.path,
        item.status,
        item.resumable,
        item.error,
      ]);
      if (card.dataset.structure !== structure) {
        card.dataset.structure = structure;
        card.innerHTML =
          '<div class="download-card-header"><span class="download-file-icon">' +
          icon(
            kind(item) === "audio"
              ? "music"
              : kind(item) === "image"
                ? "image"
                : "download",
          ) +
          "</span><div><h3>" +
          esc(item.filename) +
          '</h3><small class="download-path" title="' +
          esc(item.path || "") +
          '">' +
          esc(item.path || "Escolha uma pasta para salvar") +
          '</small></div><div class="download-card-actions">' +
          (item.status === "downloading"
            ? '<button class="icon-button" data-action="pause_download" aria-label="Pausar download">' +
              icon("pause") +
              '</button><button class="icon-button" data-action="cancel_download" aria-label="Cancelar download">' +
              icon("close") +
              "</button>"
            : "") +
          (item.resumable
            ? '<button class="icon-button" data-action="resume_download" aria-label="Retomar download">' +
              icon("play") +
              '</button><button class="icon-button" data-action="cancel_download" aria-label="Cancelar download">' +
              icon("close") +
              "</button>"
            : "") +
          (["completed", "concluído"].includes(item.status)
            ? '<button class="icon-button" data-action="open_download" aria-label="Abrir arquivo">' +
              icon("external") +
              '</button><button class="icon-button" data-action="reveal_download" aria-label="Mostrar na pasta">' +
              icon("folder") +
              "</button>"
            : "") +
          (!active(item)
            ? '<button class="icon-button" data-action="forget_download" aria-label="Remover do histórico">' +
              icon("trash") +
              "</button>"
            : "") +
          '</div></div><div class="download-metrics"><span>' +
          esc(item.error || status(item.status)) +
          '</span><span data-speed></span><span data-size></span></div><progress aria-label="Progresso de ' +
          esc(item.filename) +
          '"></progress><div class="download-progress-caption"></div>';
        card
          .querySelectorAll("[data-action]")
          .forEach(
            (button) =>
              (button.onclick = () =>
                send({ cmd: button.dataset.action, id: item.id })),
          );
      }
      const now = performance.now();
      let sample = samples.get(item.id);
      if (!sample) {
        sample = { at: now, bytes: item.received, speed: 0 };
        samples.set(item.id, sample);
      }
      if (now - sample.at > 500) {
        sample.speed = Math.max(
          0,
          (item.received - sample.bytes) / ((now - sample.at) / 1000),
        );
        sample.at = now;
        sample.bytes = item.received;
      }
      card.querySelector("[data-speed]").textContent =
        item.status === "downloading" && sample.speed > 0
          ? bytes(sample.speed) + "/s"
          : "";
      card.querySelector("[data-size]").textContent =
        bytes(item.received || 0) +
        (item.total ? " de " + bytes(item.total) : "");
      const meter = card.querySelector("progress");
      meter.hidden = !active(item);
      if (item.total) {
        meter.max = item.total;
        meter.value = item.received;
      } else meter.removeAttribute("value");
      const remaining =
        item.total && sample.speed > 0
          ? Math.ceil((item.total - item.received) / sample.speed)
          : null;
      card.querySelector(".download-progress-caption").textContent =
        item.status === "downloading"
          ? (item.total
              ? Math.min(100, Math.floor((item.received / item.total) * 100)) +
                "%"
              : "Tamanho informado pelo servidor durante a transferência") +
            (remaining > 0
              ? " · cerca de " +
                (remaining > 60
                  ? Math.ceil(remaining / 60) + " min"
                  : remaining + " s")
              : "")
          : "";
    }
    if (!showing.length) {
      list.innerHTML =
        '<div class="downloads-empty">' +
        icon("download") +
        "<h3>Nenhum download aqui</h3><p>Os arquivos desta categoria aparecem aqui.</p></div>";
    }
    for (const id of samples.keys())
      if (!items.some((item) => item.id === id)) samples.delete(id);
  }
  return {
    update(value) {
      items = [...value].sort((a, b) => b.id - a.id);
      render();
    },
  };
};

window.attachNotesStudio = function (
  root,
  { notes, selected, flush, update, dirty, notify, icon, changed },
) {
  let query = "",
    filter = "all",
    date = null,
    month = new Date(),
    preview = false;
  const sidebar = root.querySelector(".notes-sidebar"),
    editor = root.querySelector(".note-editor");
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Buscar nas notas";
  search.ariaLabel = "Buscar nas notas";
  search.className = "notes-search";
  sidebar.querySelector(".notes-heading").after(search);
  const filters = document.createElement("nav");
  filters.className = "notes-filters";
  filters.innerHTML =
    '<button data-note-filter="all" aria-pressed="true">Todas as notas</button><button data-note-filter="pinned" aria-pressed="false">Fixadas</button><button data-note-filter="tasks" aria-pressed="false">Com tarefas</button>';
  search.after(filters);
  const rail = document.createElement("aside");
  rail.className = "notes-context";
  rail.innerHTML =
    '<div class="notes-calendar"><header><button data-month="-1" aria-label="Mês anterior">' +
    icon("back") +
    '</button><strong></strong><button data-month="1" aria-label="Próximo mês">' +
    icon("forward") +
    '</button></header><div class="calendar-week">D S T Q Q S S</div><div class="calendar-days"></div><button data-today>Hoje</button></div><section><h3>Esta nota</h3><button data-pin>' +
    icon("pin") +
    ' Fixar nota</button><div class="note-stats"></div></section>';
  root.querySelector(".notes-layout").append(rail);
  const toolbar = document.createElement("div");
  toolbar.className = "note-format-toolbar";
  toolbar.innerHTML =
    '<div><button data-wrap="bold" aria-label="Negrito"><strong>B</strong></button><button data-wrap="italic" aria-label="Itálico"><em>I</em></button><button data-wrap="heading" aria-label="Título">H</button><button data-wrap="task" aria-label="Inserir tarefa">' +
    icon("check") +
    '</button><button data-wrap="bullet" aria-label="Inserir lista">' +
    icon("list") +
    '</button></div><button data-preview aria-pressed="false">Prévia</button>';
  editor.querySelector("#note-title").after(toolbar);
  const rendered = document.createElement("div");
  rendered.className = "note-preview";
  rendered.hidden = true;
  editor.append(rendered);
  const body = root.querySelector("#note-body");
  function calendar() {
    rail.querySelector("header strong").textContent = month.toLocaleDateString(
      "pt-BR",
      { month: "long", year: "numeric" },
    );
    const grid = rail.querySelector(".calendar-days");
    grid.replaceChildren();
    const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    for (let i = 0; i < first; i++) grid.append(document.createElement("span"));
    const days = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate();
    for (let day = 1; day <= days; day++) {
      const button = document.createElement("button");
      button.textContent = day;
      const value = new Date(
        month.getFullYear(),
        month.getMonth(),
        day,
      ).toLocaleDateString("pt-BR");
      button.setAttribute("aria-pressed", String(value === date));
      button.onclick = () => {
        date = date === value ? null : value;
        changed();
        calendar();
      };
      grid.append(button);
    }
  }
  function renderPreview() {
    const inline = (node, text) => {
      const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
      for (const part of parts) {
        if (part.startsWith("**") && part.endsWith("**")) {
          const strong = document.createElement("strong");
          strong.textContent = part.slice(2, -2);
          node.append(strong);
        } else if (part.startsWith("*") && part.endsWith("*")) {
          const em = document.createElement("em");
          em.textContent = part.slice(1, -1);
          node.append(em);
        } else node.append(document.createTextNode(part));
      }
    };
    rendered.replaceChildren();
    for (const [index, line] of body.value.split("\n").entries()) {
      const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s*(.*)/);
      const h = line.match(/^(#{1,3})\s+(.*)/);
      const row = document.createElement(h ? "h" + h[1].length : "p");
      if (task) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = task[1].toLowerCase() === "x";
        box.ariaLabel = task[2];
        box.onchange = () => {
          const lines = body.value.split("\n");
          lines[index] = lines[index].replace(
            /\[[ xX]\]/,
            box.checked ? "[x]" : "[ ]",
          );
          body.value = lines.join("\n");
          dirty();
        };
        row.append(box);
        inline(row, task[2]);
      } else inline(row, h ? h[2] : line.replace(/^\s*[-*]\s/, "• "));
      rendered.append(row);
    }
  }
  function refresh() {
    const text = body.value;
    rail.querySelector(".note-stats").textContent =
      text.trim().split(/\s+/).filter(Boolean).length +
      " palavras · " +
      text.length +
      " caracteres";
    const current = notes().find((n) => n.id === selected());
    rail
      .querySelector("[data-pin]")
      .setAttribute("aria-pressed", String(!!current?.pinned));
    rail.querySelector("[data-pin]").innerHTML =
      icon("pin") + (current?.pinned ? " Desafixar nota" : " Fixar nota");
    if (preview) renderPreview();
  }
  search.oninput = () => {
    query = search.value.toLocaleLowerCase();
    changed();
  };
  filters.querySelectorAll("[data-note-filter]").forEach(
    (button) =>
      (button.onclick = () => {
        filter = button.dataset.noteFilter;
        filters
          .querySelectorAll("button")
          .forEach((other) =>
            other.setAttribute("aria-pressed", String(other === button)),
          );
        date = null;
        changed();
        calendar();
      }),
  );
  toolbar.querySelectorAll("[data-wrap]").forEach(
    (button) =>
      (button.onclick = () => {
        const a = body.selectionStart,
          b = body.selectionEnd,
          text = body.value.slice(a, b) || "texto";
        const type = button.dataset.wrap;
        const insert =
          type === "bold"
            ? "**" + text + "**"
            : type === "italic"
              ? "*" + text + "*"
              : type === "heading"
                ? "## " + text
                : type === "task"
                  ? "- [ ] " + text
                  : "- " + text;
        body.setRangeText(insert, a, b, "select");
        body.focus();
        dirty();
        refresh();
      }),
  );
  toolbar.querySelector("[data-preview]").onclick = (event) => {
    preview = !preview;
    event.currentTarget.setAttribute("aria-pressed", String(preview));
    body.hidden = preview;
    rendered.hidden = !preview;
    refresh();
  };
  rail.querySelectorAll("[data-month]").forEach(
    (button) =>
      (button.onclick = () => {
        month = new Date(
          month.getFullYear(),
          month.getMonth() + Number(button.dataset.month),
          1,
        );
        calendar();
      }),
  );
  rail.querySelector("[data-today]").onclick = () => {
    month = new Date();
    date = new Date().toLocaleDateString("pt-BR");
    changed();
    calendar();
  };
  rail.querySelector("[data-pin]").onclick = async () => {
    try {
      await flush();
      const n = notes().find((n) => n.id === selected());
      if (n) await update({ id: n.id, pinned: !n.pinned });
      refresh();
    } catch (error) {
      notify(error.message);
    }
  };
  body.addEventListener("input", refresh);
  calendar();
  refresh();
  return {
    refresh,
    filter(items) {
      return items
        .filter(
          (n) =>
            (n.title + " " + n.body).toLocaleLowerCase().includes(query) &&
            (!date ||
              new Date(n.updated_at).toLocaleDateString("pt-BR") === date) &&
            (filter === "all" ||
              (filter === "pinned" && n.pinned) ||
              (filter === "tasks" && /^\s*[-*]\s+\[[ xX]\]/m.test(n.body))),
        )
        .sort(
          (a, b) =>
            Number(!!b.pinned) - Number(!!a.pinned) ||
            b.updated_at - a.updated_at,
        );
    },
  };
};
