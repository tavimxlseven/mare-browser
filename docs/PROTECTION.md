# Content protection

Maré uses the unmodified [adblock-rust 0.13.5](https://github.com/brave/adblock-rust)
engine with bundled EasyList and EasyPrivacy snapshots. Protection is enabled by
default for normal and private tabs. It is built into the Rust host; it is not a
Chrome extension and does not require Pie AdBlock.

## Request enforcement

On Windows, each remote WebView is created at `about:blank`. Before its first
remote navigation, Maré registers a WebView2 `WebResourceRequested` handler using
`ICoreWebView2_22` and all request contexts/source kinds. Matching HTTP/HTTPS
requests receive an empty local `403` response before the request reaches the
origin. This covers matched page resources and supported frame/worker requests,
including scripts, images, stylesheets, fonts, media and fetch/XHR requests.

The engine receives the request URL, method, resource type and available
referrer. A missing referrer falls back to the top-level page. Allow rules and
request-type/third-party conditions are evaluated by the engine. Other URL
schemes pass through this filter.

The Shield panel reports the actual count of successfully blocked responses for
the current tab/document. Reloading or navigating resets that count. UI
notifications are throttled to at most ten per second per tab; snapshots read
the current counter. Counts and request URLs are not written to browsing
history by this module.

## Site controls

- The global switch enables or disables filtering.
- The site switch adds or removes the current exact hostname from the local
  exception list. It applies to resources loaded within that top-level site,
  including third-party frames. It does not allow an advertising domain across
  unrelated sites.
- Changing a switch reloads the active page to request previously blocked resources or
  remove CSS hiding. Private tabs use the same explicit global/site settings,
  while their visit history remains private.
- Unsupported WebView2 runtimes report protection as unavailable instead of
  presenting an active Shield without an interceptor. If the required request
  interceptor cannot be attached, Maré does not open that remote page; update the
  runtime before retrying.

## Cosmetic filtering

After load, bounded collections of existing DOM classes and IDs are passed to
the Rust engine. Domain-specific selectors and relevant generic selectors are
applied through a local CSS stylesheet, respecting cosmetic exceptions and
`generichide` rules. Selector syntax is checked by the browser. This does not run
JavaScript downloaded from a filter list.

The first version does not continuously observe dynamically inserted DOM
elements. New content is still subject to network filtering, but additional
cosmetic selectors can require another page load.

## Filter lifecycle and licensing

The release contains fixed, unmodified snapshots, version **202611060034 UTC**.
The source URLs, upstream commits, hashes and exact licenses are in
[`assets/filters`](../assets/filters/README.md). A source update and a new release
are required to change the bundled lists. There is no background updater or
remote request logging.

The lists are distributed under their authors' CC BY-SA 3.0 alternative license.
The engine retains its MPL-2.0 license. Maré's original integration remains MIT.
The portable distribution includes the relevant full license texts and source
links in `THIRD_PARTY_LICENSES.txt` and `THIRD_PARTY_NOTICES.md`.

## Scope

This integration is not full Brave Shields parity. It does not implement
fingerprint randomization, CNAME uncloaking, scriptlet injection, procedural
cosmetic actions, replacement resources or DRM/ad-stream modification. It does
not promise to remove every advertisement or prevent every form of tracking.
WebView2's networking behavior and the bundled rule coverage remain relevant.

## Verification

Unit tests cover request types and first-party conditions, rule exceptions,
global/site policy, counter resets, cosmetic rules and known ad/tracker requests
against the real bundled lists. A native smoke fixture can serve
`/ads/cbr.js`: the bundled EasyList contains a script-specific rule for that path.
The server should observe no request with protection active and receive the
request after the current site is allowed and reloaded.
