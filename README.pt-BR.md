# Maré

Navegador para Windows e plataforma de apps Rust sob demanda.

[Download](https://github.com/tavimxlseven/mare-browser/releases/latest) · [Documentação](docs/README.md) · [Contribuir](CONTRIBUTING.md) · [English](README.md)

O Maré usa Rust, Tao e Wry no host e WebView2 para renderizar páginas. Inclui abas, favoritos, histórico, navegação privada, leitor, downloads e bloqueio de anúncios e rastreadores com o motor Rust do Brave.

A loja inicial oferece Notas, Calculadora, o app de música e um adaptador experimental para o larperCord. O processamento de cada app ocorre em um worker Rust separado, iniciado ao abrir e encerrado ao fechar sua aba. As páginas abertas são preservadas; abas ocultas podem ser suspensas pelo motor. Os processos do WebView2 continuam fazendo parte do navegador.

O [app de música](docs/SPOTIFY.md) importa metadados públicos, organiza a biblioteca, reproduz arquivos locais e integra o Sunnify CLI sem janela ou configuração separada. O login opcional para importar a conta ainda precisa de um Client ID Spotify. O Rich Presence já usa o Application ID registrado do Maré e teve seu handshake aceito pelo Discord Canary; a exibição no perfil ainda requer validação manual. A integração larperCord incorpora o cliente Zig/SDL em uma aba. O monitor interno de tarefas reúne host, WebView2 e apps, com RAM e CPU reais. Consulte [componentes e licenças](docs/COMPONENTS.md). Ainda não há comparação de desempenho com o cliente oficial. A distribuição de apps de terceiros está no [roadmap](docs/ROADMAP.md).

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
