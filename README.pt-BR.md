# Compass Browser

Navegador para Windows e plataforma de apps Rust sob demanda.

[Download](https://github.com/tavimxlseven/mare-browser/releases/latest) · [Documentação](docs/README.md) · [Contribuir](CONTRIBUTING.md) · [English](README.md)

O Compass Browser usa Rust, Tao e Wry no host e WebView2 para renderizar páginas. Inclui abas, favoritos, histórico, navegação privada, leitor, downloads e bloqueio de anúncios e rastreadores com o motor Rust do Brave.

A loja inicial oferece Notas, Calculadora, o app de música e o Discord web oficial dentro do navegador. O processamento de cada app ocorre em um worker Rust separado, iniciado ao abrir e encerrado ao fechar sua aba. As páginas abertas são preservadas; mídia em reprodução continua ao trocar de aba. Os processos do WebView2 continuam fazendo parte do navegador.

O [app de música](docs/SPOTIFY.md) importa metadados públicos, organiza a biblioteca, reproduz arquivos locais e integra o Sunnify CLI sem janela ou configuração separada. O login opcional para importar a conta ainda precisa de um Client ID Spotify. O Rich Presence já usa o Application ID registrado do Compass Browser e teve seu handshake aceito pelo Discord Canary; a exibição no perfil ainda requer validação manual. O Discord usa login normal no site oficial, em uma aba persistente, sem coleta de token. O monitor interno de tarefas reúne host, WebView2 e apps, com RAM e CPU reais. Consulte [componentes e licenças](docs/COMPONENTS.md). Ainda não há comparação de desempenho com o cliente oficial. A distribuição de apps de terceiros está no [roadmap](docs/ROADMAP.md).

## Executar

Baixe o instalador `Mare-Setup-<versão>-x64.exe` em [Releases](https://github.com/tavimxlseven/mare-browser/releases/latest), instale e abra pelo atalho. O setup inclui os componentes de música e prepara o WebView2 oficial quando necessário. Requer Windows 10/11 x64; a instalação do runtime requer internet.

A partir da 0.5.0, o Compass Browser busca versões estáveis ao iniciar e baixa o novo setup em segundo plano, com verificação SHA-256. A instalação acontece ao fechar normalmente ou pelo botão **Reiniciar e atualizar**. Os Ajustes permitem desligar a busca automática; **Mais opções → Buscar atualizações** continua disponível. O perfil e a biblioteca ficam fora da pasta de instalação.

Para desenvolver:

```powershell
git clone https://github.com/tavimxlseven/mare-browser.git
cd mare-browser
.\scripts\run.ps1
.\scripts\check.ps1
.\scripts\build.ps1 -Release
```

Consulte o [README principal](README.md) para requisitos, estrutura e licenças.


Consulte também: [extensões da Chrome Web Store](docs/EXTENSIONS.md), [permanência do perfil e dos logins nas atualizações](docs/PROFILE.md) e [configuração de IDs de integração](docs/INTEGRATIONS.md). O login Spotify está adiado na 0.3.2; playlists por link e reprodução de músicas baixadas continuam disponíveis.
