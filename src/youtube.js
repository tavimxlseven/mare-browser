// Maré-owned YouTube response filtering. Enabled only on YouTube and by site policy.
(() => {
  if (
    !/(^|\.)youtube\.com$/.test(location.hostname) ||
    window.__mareYoutubeShield
  )
    return;
  let policy = __MARE_YOUTUBE_POLICY__,
    observer,
    timer,
    style;
  const host = () => location.hostname.toLowerCase();
  const active = () =>
    policy.enabled &&
    /(^|\.)youtube\.com$/.test(host()) &&
    !policy.exceptions.includes(host());
  const parse = JSON.parse,
    fetchOriginal = window.fetch;
  function clean(value) {
    if (!active() || !value || typeof value !== "object") return value;
    const queue = [value];
    let seen = 0;
    while (queue.length && ++seen < 20000) {
      const o = queue.pop();
      if (!o || typeof o !== "object") continue;
      for (const key of [
        "adPlacements",
        "playerAds",
        "adSlots",
        "adBreakHeartbeatParams",
      ])
        delete o[key];
      for (const v of Object.values(o))
        if (v && typeof v === "object") queue.push(v);
    }
    return value;
  }
  JSON.parse = function (text, ...args) {
    const v = Reflect.apply(parse, JSON, [text, ...args]);
    return typeof text === "string" &&
      /"(?:adPlacements|playerAds|adSlots)"\s*:/.test(text)
      ? clean(v)
      : v;
  };
  if (fetchOriginal)
    window.fetch = async function (...args) {
      const response = await Reflect.apply(fetchOriginal, this, args);
      if (
        active() &&
        /\/youtubei\/v1\/(?:player|next)(?:\?|$)/.test(response.url)
      ) {
        const read = response.json.bind(response);
        response.json = async () => clean(await read());
      }
      return response;
    };
  for (const name of ["ytInitialPlayerResponse", "ytInitialData"]) {
    const desc = Object.getOwnPropertyDescriptor(window, name);
    if (desc && !desc.configurable) continue;
    let value = window[name];
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (v) => {
        value = clean(v);
      },
    });
    if (value) clean(value);
  }
  function tick() {
    timer = null;
    if (!active()) return;
    const player = document.querySelector("#movie_player.ad-showing");
    if (player) {
      const skip = player.querySelector(
        ".ytp-ad-skip-button,.ytp-skip-ad-button,.ytp-ad-skip-button-modern",
      );
      if (skip && !skip.disabled && skip.getClientRects().length) skip.click();
    }
  }
  function refresh() {
    observer?.disconnect();
    observer = null;
    if (timer) clearTimeout(timer);
    timer = null;
    style?.remove();
    if (!active()) return;
    style = document.createElement("style");
    style.id = "__mare_youtube_css";
    style.textContent =
      "ytd-ad-slot-renderer,ytd-display-ad-renderer,ytd-in-feed-ad-layout-renderer,ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer{display:none!important}";
    (document.head || document.documentElement)?.append(style);
    for (const n of ["ytInitialPlayerResponse", "ytInitialData"])
      clean(window[n]);
    if (document.documentElement) {
      observer = new MutationObserver(() => {
        if (!timer) timer = setTimeout(tick, 120);
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    tick();
  }
  window.__mareYoutubeShield = {
    configure: (value) => {
      policy = value;
      refresh();
    },
  };
  if (document.documentElement) refresh();
  else addEventListener("DOMContentLoaded", refresh, { once: true });
})();
