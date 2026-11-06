# Filter data

Maré bundles unmodified snapshots of **EasyList** and **EasyPrivacy**, by
**The EasyList authors (https://easylist.to/)**. Source URLs, upstream versions,
commit identifiers, byte sizes and SHA-256 hashes are recorded in
[`provenance.json`](provenance.json).

These two lists are used under **Creative Commons Attribution-ShareAlike 3.0
Unported**, the alternative license expressly offered by their authors. The
complete license is [`CC-BY-SA-3.0.txt`](CC-BY-SA-3.0.txt). Their data is separate
from the MIT-licensed Maré integration code. The original list headers remain
intact. No upstream list modifications were made.

- [EasyList licensing policy](https://easylist.to/pages/licence.html)
- [EasyList source](https://easylist.to/easylist/easylist.txt)
- [EasyPrivacy source](https://easylist.to/easylist/easyprivacy.txt)

The **adblock-rust** library is authored by Brave contributors and is used
unmodified under **MPL-2.0**. Its license is copied in
[`adblock-MPL-2.0.txt`](adblock-MPL-2.0.txt); source is available at
https://github.com/brave/adblock-rust (crate version 0.13.5).

Filter matching does not provide all Brave Shields features. Maré blocks matched
HTTP/HTTPS requests in WebView2 and applies supported CSS hiding selectors after
load. Scriptlets, procedural cosmetic actions, resource replacements, CNAME
uncloaking, fingerprint defenses and DRM/ad-stream manipulation are not part of
this integration. WebView2 must support `ICoreWebView2_22` for the interceptor.

Lists are snapshots shipped with this release. They are not silently downloaded
or updated while browsing. Refreshing them requires a reviewed source update and
corresponding provenance/license records. No browsing URLs are sent to list
providers.
