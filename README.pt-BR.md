# Maré

Navegador para Windows e plataforma de apps Rust sob demanda.

[Download](https://github.com/tavimxlseven/mare-browser/releases/latest) · [Documentação](docs/README.md) · [Contribuir](CONTRIBUTING.md) · [English](README.md)

O Maré usa Rust, Tao e Wry no host e WebView2 para renderizar páginas. Inclui abas, favoritos, histórico, navegação privada, leitor, downloads e bloqueio de anúncios e rastreadores com o motor Rust do Brave.

A loja inicial oferece Notas e Calculadora. O processamento de cada app ocorre em um worker Rust separado, iniciado ao abrir e encerrado ao fechar sua aba. As páginas abertas são preservadas; abas ocultas podem ser suspensas pelo motor. Os processos do WebView2 continuam fazendo parte do navegador.

O cliente Spotify e a distribuição de apps de terceiros estão no [roadmap](docs/ROADMAP.md). Ainda não há reprodução Spotify nem comparação de desempenho com seu cliente oficial.

## Executar

Baixe e extraia o ZIP de [Releases](https://github.com/tavimxlseven/mare-browser/releases/latest). Abra `Mare.exe`, mantendo os demais arquivos da pasta. Requer Windows 10/11 x64 e WebView2 Runtime.

Para desenvolver:

```powershell
git clone https://github.com/tavimxlseven/mare-browser.git
cd mare-browser
.\scripts\run.ps1
.\scripts\check.ps1
.\scripts\build.ps1 -Release
```

Consulte o [README principal](README.md) para requisitos, estrutura e licenças.
