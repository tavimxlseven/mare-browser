# Avisos de terceiros — Maré Browser 0.3.2

O código original do Maré usa a licença MIT em `LICENSE`. Dependências mantêm suas próprias licenças. Os textos completos de licença, copyright e avisos estão em `THIRD_PARTY_LICENSES.txt` e acompanham a distribuição portátil.

## Componentes principais

| Componente | Versão resolvida | Licença declarada | Origem |
| --- | --- | --- | --- |
| adblock | 0.13.5 | MPL-2.0 | [Upstream](https://github.com/brave/adblock-rust/) |
| getrandom | 0.3.4 | MIT OR Apache-2.0 | [Upstream](https://github.com/rust-random/getrandom) |
| serde | 1.0.229 | MIT OR Apache-2.0 | [Upstream](https://github.com/serde-rs/serde) |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | [Upstream](https://github.com/serde-rs/json) |
| tao | 0.37.2 | Apache-2.0 | [Upstream](https://github.com/tauri-apps/tao) |
| url | 2.5.8 | MIT OR Apache-2.0 | [Upstream](https://github.com/servo/rust-url) |
| webview2-com | 0.39.1 | MIT | [Upstream](https://github.com/wravery/webview2-rs) |
| windows | 0.62.2 | MIT OR Apache-2.0 | [Upstream](https://github.com/microsoft/windows-rs) |
| wry | 0.57.1 | Apache-2.0 OR MIT | [Upstream](https://github.com/tauri-apps/wry) |
| rodio | 0.21.1 | MIT OR Apache-2.0 | [Upstream](https://github.com/RustAudio/rodio) |
| cpal | 0.16.0 | Apache-2.0 | [Upstream](https://github.com/RustAudio/cpal) |
| symphonia | 0.5.5 | MPL-2.0 | [Upstream](https://github.com/pdeljanov/Symphonia) |
| winresource | 0.1.34 | MIT | [Upstream](https://github.com/BenjaminRi/winresource) |
| Rust Standard Library | 1.99.1 | MIT / Apache-2.0, com avisos de componentes incorporados | [Rust](https://github.com/rust-lang/rust/tree/58cf8f9c35b355199727627d07ae34a4e2846d67) |
| WebView2Loader.dll x64 | 1.0.3800.47 | Licença Microsoft incluída no SDK | [NuGet oficial](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3800.47) |

## Proteção e dados de filtros

O motor `adblock-rust 0.13.5`, desenvolvido pelos contribuidores do Brave, é usado sem modificações sob MPL-2.0. Fonte correspondente: [crate versionado](https://crates.io/crates/adblock/0.13.5) e [repositório upstream](https://github.com/brave/adblock-rust). A licença MPL-2.0 completa está em `THIRD_PARTY_LICENSES.txt`.

Os snapshots não modificados de EasyList e EasyPrivacy são de **The EasyList authors (https://easylist.to/)** e são distribuídos separadamente sob **CC BY-SA 3.0 Unported**, a alternativa oferecida na [política oficial](https://easylist.to/pages/licence.html). A licença completa acompanha o pacote. Versões, hashes e commits estão em [`assets/filters/provenance.json`](assets/filters/provenance.json); as fontes completas dos filtros estão [no repositório do Maré](https://github.com/tavimxlseven/mare-browser/tree/v0.2.0/assets/filters). Nenhuma modificação foi feita nesses snapshots. Esses termos se aplicam aos dados dos filtros, preservados separadamente do código original do Maré.

## Microsoft WebView2

O `WebView2Loader.dll` x64 redistribuído pela build GNU veio de `webview2-com-sys 0.39.1`. Sua versão de arquivo é 1.0.3800.47 e seu SHA-256 é `86545b66cdb0603bc26b626fb9ad610cb6e71f28d468f5ea66df23b03dda96d5`.

Foi adquirido o pacote oficial `Microsoft.Web.WebView2 1.0.3800.47` do endpoint NuGet abaixo e verificada a igualdade de hash entre os dois loaders:

[Microsoft.Web.WebView2 1.0.3800.47 — pacote](https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.3800.47/microsoft.web.webview2.1.0.3800.47.nupkg)

Os arquivos `LICENSE.txt` e `NOTICE.txt` desse pacote foram preservados integralmente em `THIRD_PARTY_LICENSES.txt`. O WebView2 Runtime é um requisito instalado no sistema e não está incluído no pacote portátil. A licença do Maré não substitui os termos desse componente.

## Dependências transitivas

A lista abaixo contém os **168 crates externos** alcançáveis a partir do pacote raiz no grafo retornado por Cargo com filtro Windows GNU. Inclui dependências de build/macros para conservar os avisos mesmo quando partes não são ligadas ao executável.

| Crate | Versão | Licença declarada |
| --- | --- | --- |
| adblock | 0.13.5 | MPL-2.0 |
| addr | 0.15.6 | MIT/Apache-2.0 |
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| aho-corasick | 1.1.5 | Unlicense OR MIT |
| arrayvec | 0.7.8 | MIT OR Apache-2.0 |
| audio_thread_priority | 0.33.0 | MPL-2.0 |
| autocfg | 1.5.1 | Apache-2.0 OR MIT |
| base64 | 0.22.1 | MIT OR Apache-2.0 |
| bitflags | 1.3.2 | MIT/Apache-2.0 |
| bitflags | 2.13.2 | MIT OR Apache-2.0 |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 |
| bumpalo | 3.20.3 | MIT OR Apache-2.0 |
| bytemuck | 1.25.2 | Zlib OR Apache-2.0 OR MIT |
| bytes | 1.12.1 | MIT |
| cc | 1.11.0 | MIT OR Apache-2.0 |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 |
| cookie | 0.18.2 | MIT OR Apache-2.0 |
| core_detect | 1.0.0 | MIT/Apache-2.0 |
| cpal | 0.16.0 | Apache-2.0 |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 |
| crc32fast | 1.5.4 | MIT OR Apache-2.0 |
| crossbeam-channel | 0.5.17 | MIT OR Apache-2.0 |
| crossbeam-utils | 0.8.23 | MIT OR Apache-2.0 |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 |
| dasp_sample | 0.11.0 | MIT OR Apache-2.0 |
| deranged | 0.5.9 | MIT OR Apache-2.0 |
| digest | 0.10.7 | MIT OR Apache-2.0 |
| displaydoc | 0.2.7 | MIT OR Apache-2.0 |
| dpi | 0.1.2 | Apache-2.0 AND MIT |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| either | 1.19.0 | MIT OR Apache-2.0 |
| encoding_rs | 0.8.44 | (Apache-2.0 OR MIT) AND BSD-3-Clause |
| equivalent | 1.0.3 | Apache-2.0 OR MIT |
| extended | 0.1.0 | MIT |
| find-msvc-tools | 0.1.15 | MIT OR Apache-2.0 |
| flatbuffers | 25.12.19 | Apache-2.0 |
| flate2 | 1.1.11 | MIT OR Apache-2.0 |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 |
| generic-array | 0.14.7 | MIT |
| getrandom | 0.2.17 | MIT OR Apache-2.0 |
| getrandom | 0.3.4 | MIT OR Apache-2.0 |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 |
| http | 1.5.0 | MIT OR Apache-2.0 |
| icu_collections | 2.4.0 | Unicode-3.0 |
| icu_locale_core | 2.4.0 | Unicode-3.0 |
| icu_normalizer | 2.4.0 | Unicode-3.0 |
| icu_normalizer_data | 2.4.0 | Unicode-3.0 |
| icu_properties | 2.4.0 | Unicode-3.0 |
| icu_properties_data | 2.4.0 | Unicode-3.0 |
| icu_provider | 2.4.0 | Unicode-3.0 |
| idna | 1.1.0 | MIT OR Apache-2.0 |
| idna_adapter | 1.2.2 | Apache-2.0 OR MIT |
| indexmap | 2.14.2 | Apache-2.0 OR MIT |
| itertools | 0.14.0 | MIT OR Apache-2.0 |
| itoa | 1.0.18 | MIT OR Apache-2.0 |
| lazy_static | 1.5.1 | MIT OR Apache-2.0 |
| libc | 0.2.191 | MIT OR Apache-2.0 |
| litemap | 0.8.3 | Unicode-3.0 |
| lock_api | 0.4.14 | MIT OR Apache-2.0 |
| log | 0.4.35 | MIT OR Apache-2.0 |
| memchr | 2.8.3 | Unlicense OR MIT |
| miniz_oxide | 0.9.1 | MIT OR Zlib OR Apache-2.0 |
| multiversion_no_op | 1.0.0 | Apache-2.0 OR MIT |
| num-bigint | 0.4.8 | MIT OR Apache-2.0 |
| num-conv | 0.2.2 | MIT OR Apache-2.0 |
| num-integer | 0.1.47 | MIT OR Apache-2.0 |
| num-rational | 0.4.2 | MIT OR Apache-2.0 |
| num-traits | 0.2.19 | MIT OR Apache-2.0 |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 |
| potential_utf | 0.1.6 | Unicode-3.0 |
| powerfmt | 0.2.1 | MIT OR Apache-2.0 |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 |
| psl | 2.1.247 | MIT/Apache-2.0 |
| psl-types | 2.0.11 | MIT/Apache-2.0 |
| quote | 1.0.47 | MIT OR Apache-2.0 |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib |
| regex | 1.13.1 | MIT OR Apache-2.0 |
| regex-automata | 0.4.18 | MIT OR Apache-2.0 |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 |
| ring | 0.17.14 | Apache-2.0 AND ISC |
| rodio | 0.21.1 | MIT OR Apache-2.0 |
| rustc_version | 0.4.1 | MIT OR Apache-2.0 |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT |
| rustversion | 1.0.23 | MIT OR Apache-2.0 |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 |
| seahash | 4.1.0 | MIT |
| semver | 1.0.28 | MIT OR Apache-2.0 |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_core | 1.0.229 | MIT OR Apache-2.0 |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.154 | MIT OR Apache-2.0 |
| serde_spanned | 1.1.2 | MIT OR Apache-2.0 |
| sha2 | 0.10.9 | MIT OR Apache-2.0 |
| shlex | 2.0.1 | MIT OR Apache-2.0 |
| simd-adler32 | 0.3.10 | MIT |
| simdutf8 | 0.1.5 | MIT OR Apache-2.0 |
| smallvec | 1.16.4 | MIT OR Apache-2.0 |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 |
| symphonia | 0.5.5 | MPL-2.0 |
| symphonia-bundle-mp3 | 0.5.5 | MPL-2.0 |
| symphonia-codec-aac | 0.5.5 | MPL-2.0 |
| symphonia-codec-pcm | 0.5.5 | MPL-2.0 |
| symphonia-core | 0.5.5 | MPL-2.0 |
| symphonia-format-isomp4 | 0.5.5 | MPL-2.0 |
| symphonia-format-riff | 0.5.5 | MPL-2.0 |
| symphonia-metadata | 0.5.5 | MPL-2.0 |
| symphonia-utils-xiph | 0.5.5 | MPL-2.0 |
| syn | 2.0.119 | MIT OR Apache-2.0 |
| syn | 3.0.9 | MIT OR Apache-2.0 |
| synstructure | 0.14.0 | MIT |
| tao | 0.37.2 | Apache-2.0 |
| thiserror | 1.0.69 | MIT OR Apache-2.0 |
| thiserror | 2.0.21 | MIT OR Apache-2.0 |
| thiserror-impl | 1.0.69 | MIT OR Apache-2.0 |
| thiserror-impl | 2.0.21 | MIT OR Apache-2.0 |
| time | 0.3.55 | MIT OR Apache-2.0 |
| time-core | 0.1.9 | MIT OR Apache-2.0 |
| time-macros | 0.2.32 | MIT OR Apache-2.0 |
| tinystr | 0.8.5 | Unicode-3.0 |
| toml | 1.2.0+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_datetime | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_parser | 1.1.5+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_writer | 1.2.0+spec-1.1.0 | MIT OR Apache-2.0 |
| typenum | 1.20.1 | MIT OR Apache-2.0 |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 |
| untrusted | 0.9.0 | ISC |
| url | 2.5.8 | MIT OR Apache-2.0 |
| utf_types | 1.0.0 | Apache-2.0 OR MIT |
| utf8_iter | 1.1.0 | Apache-2.0 OR MIT |
| version_check | 0.9.5 | MIT/Apache-2.0 |
| webview2-com | 0.39.1 | MIT |
| webview2-com-macros | 0.8.1 | MIT |
| webview2-com-sys | 0.39.1 | MIT |
| windows | 0.54.0 | MIT OR Apache-2.0 |
| windows | 0.62.2 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.52.6 | MIT OR Apache-2.0 |
| windows-collections | 0.3.2 | MIT OR Apache-2.0 |
| windows-core | 0.54.0 | MIT OR Apache-2.0 |
| windows-core | 0.62.2 | MIT OR Apache-2.0 |
| windows-future | 0.3.2 | MIT OR Apache-2.0 |
| windows-implement | 0.60.2 | MIT OR Apache-2.0 |
| windows-interface | 0.59.3 | MIT OR Apache-2.0 |
| windows-link | 0.2.1 | MIT OR Apache-2.0 |
| windows-numerics | 0.3.1 | MIT OR Apache-2.0 |
| windows-result | 0.1.2 | MIT OR Apache-2.0 |
| windows-result | 0.4.1 | MIT OR Apache-2.0 |
| windows-strings | 0.5.1 | MIT OR Apache-2.0 |
| windows-sys | 0.59.0 | MIT OR Apache-2.0 |
| windows-targets | 0.52.6 | MIT OR Apache-2.0 |
| windows-threading | 0.2.1 | MIT OR Apache-2.0 |
| windows-version | 0.1.7 | MIT OR Apache-2.0 |
| winnow | 1.0.5 | MIT |
| winresource | 0.1.34 | MIT |
| writeable | 0.6.4 | Unicode-3.0 |
| wry | 0.57.1 | Apache-2.0 OR MIT |
| yoke | 0.8.4 | Unicode-3.0 |
| yoke-derive | 0.8.4 | Unicode-3.0 |
| zerofrom | 0.1.8 | Unicode-3.0 |
| zerofrom-derive | 0.1.8 | Unicode-3.0 |
| zerotrie | 0.2.5 | Unicode-3.0 |
| zerovec | 0.11.9 | Unicode-3.0 |
| zerovec-derive | 0.11.7 | Unicode-3.0 |
| zip | 2.6.1 | MIT |
| zmij | 1.0.23 | MIT |
| zopfli | 0.8.4 | Apache-2.0 |

## Origem dos textos e atualização

As licenças dos crates vieram dos arquivos `LICENSE`, `COPYING`, `NOTICE` e equivalentes nos pacotes oficiais resolvidos por `Cargo.lock`. Textos idênticos foram agrupados, preservando a associação com todos os crates correspondentes. Os três crates `webview2-com*` omitem o arquivo de licença em seus pacotes; a licença MIT foi obtida do [workspace upstream no commit registrado no pacote](https://github.com/wravery/webview2-rs/blob/edc2caf886175ccaebe86078c9cfe1ae2a187328/LICENSE).

O pacote `flatbuffers 25.12.19` não contém o arquivo de licença; o texto Apache-2.0 foi obtido do [commit upstream registrado no pacote](https://github.com/google/flatbuffers/blob/7e163021e59cca4f8e1e35a7c828b5c6b7915953/LICENSE). `seahash 4.1.0` declara MIT no manifesto e lista ticki e Tom Almeida como autores, mas não inclui um texto de licença no pacote nem em seu commit de publicação; o texto MIT foi preservado do [upstream no commit 74c0218](https://gitlab.redox-os.org/redox-os/seahash/-/blob/74c02182146d1edd7c91a9e6eddefc7390682a70/LICENSE).

Os avisos da biblioteca padrão vieram do `COPYRIGHT-library.html` completo distribuído com a toolchain Rust 1.99.1 usada nesta build. Os textos MIT/Apache e copyright também foram obtidos do commit oficial dessa versão. A build GNU conserva ainda os avisos do runtime MinGW-w64 e a GCC Runtime Library Exception com seu texto GPL acompanhante, conforme os arquivos incluídos com a toolchain de compilação.

O inventário pode ser reproduzido com:

```powershell
cargo metadata --locked --filter-platform x86_64-pc-windows-gnu --format-version 1
```

Ao atualizar dependências, toolchain, arquitetura ou loader, regenere os avisos antes de distribuir outra build. Não são distribuídos Node, npm, REA, o compilador Rust ou o executável GCC com o pacote portátil.

## Componentes externos opcionais

O inventário Rust acima não concede a licença MIT aos componentes de música/chat. O pacote local completo também contém o Sunnify CLI original 2.6.0, de Sunny Patel, sob licença própria sem permissão de modificação e com restrição comercial. O texto original acompanha `components/sunnify/LICENSE.txt`. O larperCord 0.6.0 é adquirido diretamente do autor para a integração local; o README upstream ainda não define uma licença para o código principal, portanto seus binários não fazem parte dos artefatos públicos do Maré. Consulte [origem e termos dos componentes](docs/COMPONENTS.md).
