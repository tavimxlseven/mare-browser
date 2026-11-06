# Maré Browser

**Maré 0.1.0** é um navegador desktop de código aberto em Rust, com uma interface inspirada no Safari do Mac. A versão inicial foi desenvolvida e testada no Windows e usa o WebView2 para acessar sites reais.

É uma implementação independente, sem vínculo com a Apple. Não inclui código ou recursos proprietários do Safari e não promete equivalência completa com o navegador da Apple.

![Página inicial do Maré, capturada no aplicativo Windows](docs/screenshots/start-light.png)

## Recursos implementados

- Navegação HTTP/HTTPS, campo único para endereço e pesquisa, sugestões locais de favoritos/histórico e escolha entre DuckDuckGo, Google e Bing.
- Abas com criação, fechamento, duplicação, fixação, reordenação por arraste, reabertura de abas comuns fechadas e visão geral em cartões.
- Voltar, avançar, recarregar, interromper carregamento, zoom, busca de texto na página e impressão pelo motor nativo.
- Modo de leitura textual para a página carregada, com ajuste do tamanho do texto.
- Favoritos com edição e remoção, histórico pesquisável e Lista de Leitura com marcação de lido/não lido.
- Downloads com estado de conclusão/falha e acesso à pasta de destino pelo Explorador.
- Abas privadas via modo incógnito do WebView2; essas abas e seu histórico não entram na sessão JSON persistida.
- Restauração opcional de abas comuns, temas claro/escuro/sistema, quatro fundos próprios para a página inicial e barra lateral.
- Atalhos de teclado, menus e controles próprios de janela.

A visão geral usa cartões com títulos e ícones, não capturas reais dos sites. O modo de leitura extrai texto da página carregada e não salva uma cópia offline; a seleção do conteúdo pode variar entre sites. A Lista de Leitura salva links; não baixa páginas para leitura offline. Downloads ainda não têm pausa, retomada nem medição de progresso por bytes. Arquivos baixados em abas privadas continuam existindo no disco.

## Executar no Windows

Requisitos: Windows 10/11, [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) e uma toolchain Rust estável 1.88 ou posterior. O caminho convencional usa MSVC, Visual Studio Build Tools com desenvolvimento desktop em C++ e Windows SDK.

Neste ambiente, a compilação local usa `x86_64-pc-windows-gnu` com MinGW, pois MSVC não estava instalado. O projeto, toolchain, cache e dados foram colocados em D: para reduzir a ocupação do disco C:.

```powershell
Set-Location D:\Projetos\mare-browser
.\scripts\run.ps1
```

Os scripts detectam `D:\DevTools\cargo`, `D:\DevTools\rustup` e MinGW em `D:\DevTools\mingw\mingw64\bin` quando disponíveis, com build em `D:\DevCache\mare-target`. Em outras máquinas, usam o Cargo encontrado no `PATH`. Eles não instalam a toolchain automaticamente.

Para compilar e executar a versão otimizada:

```powershell
.\scripts\build.ps1 -Release
.\scripts\run.ps1 -Release
```

A pasta portátil é `dist\Mare`, com `Mare.exe` e, quando necessário para a build GNU, `WebView2Loader.dll`. Essa pasta é gerada localmente e não entra no Git. O executável incorpora a interface; não precisa de Node ou de um servidor frontend para funcionar. WebView2 continua sendo um requisito do sistema.

Se já tiver as ferramentas no `PATH`, os comandos Cargo também funcionam:

```powershell
cargo run --locked
cargo build --release --locked
```

## Dados locais

No Windows com disco D: disponível, o padrão é **`D:\MareBrowserData`**. Para escolher outro diretório antes de iniciar:

```powershell
$env:MARE_DATA_DIR = 'D:\MeusDados\Mare'
.\scripts\run.ps1
```

Sem D: e sem variável configurada, o fallback é `mare-data` ao lado do executável. O diretório contém `state.json`, os dados do WebView e `Downloads`. Favoritos, histórico, lista de leitura, configurações e sessão comum são armazenados localmente em JSON sem criptografia própria. Não envie essa pasta ao GitHub.

Abas privadas não são restauradas. Favoritos ou itens de leitura salvos explicitamente continuam disponíveis. O modo privado não torna a conexão anônima para sites ou provedores de rede.

## Desenvolvimento e verificação

```powershell
.\scripts\check.ps1
```

Esse script verifica formatação e Clippy, compila/executa testes Rust e verifica a sintaxe de `ui/app.js`. Consulte [docs/TESTING.md](docs/TESTING.md) para os testes manuais e os resultados registrados.

O workflow do GitHub executa as verificações e a build em Windows com MSVC e disponibiliza um artefato de release da execução. Um artefato de CI não é um instalador assinado. O workflow só pode ser observado após o código ser enviado ao GitHub.

## Arquitetura e investigação

O host usa Rust + Tao + Wry. A interface HTML/CSS/JavaScript local fica separada das WebViews das páginas. No Windows, o motor é Microsoft Edge WebView2; não é um motor de renderização inteiramente escrito em Rust. Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

O [REA](https://github.com/morluto/rea) foi usado por CLI para inspeções estáticas reais do WebView2 e de um executável de desenvolvimento do Maré. Evidências sanitizadas, comandos e limitações estão em [docs/REA.md](docs/REA.md). Não havia Safari para Mac disponível neste ambiente; não foi feita engenharia reversa binária desse aplicativo.

## Limites desta versão

Ainda não há integração com iCloud, Chaves/Keychain, Apple Pay, Handoff, Private Relay ou Apple Intelligence. Também não há gerenciador próprio de senhas, extensões de Safari/Chrome, páginas offline, grupos de abas ou múltiplos perfis de usuário.

A compatibilidade de sites, mídia, permissões e recursos web depende do WebView2. macOS e Linux não foram validados nesta versão. A versão 0.1.0 é uma base funcional em evolução, sem auditoria independente de segurança.

## Código aberto

[Repositório público](https://github.com/tavimxlseven/mare-browser). Licença [MIT](LICENSE). As dependências e o loader possuem seus [avisos de terceiros](THIRD_PARTY_NOTICES.md), com textos completos em [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). Para colaborar, leia [CONTRIBUTING.md](CONTRIBUTING.md) e [SECURITY.md](SECURITY.md).
