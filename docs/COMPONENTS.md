# Componentes externos

O código original do Maré é MIT. Os componentes abaixo conservam seus próprios termos e não recebem a licença MIT do Maré. Nenhum binário desses projetos é versionado neste repositório ou instalado como aplicativo separado no sistema.

| Componente | Versão | Origem | SHA256 do artefato |
| --- | --- | --- | --- |
| Sunnify Windows CLI | 2.6.0 | [Release original](https://github.com/sunnypatell/sunnify-spotify-downloader/releases/tag/v2.6.0) | `abb16d22cabebf99d82c3eaf8ca60a0b5511dd99eb86b17f16d53d7077fb57ba` |
| larperCord Windows ZIP (histórico, até 0.3.2) | 0.6.0 | [Release original](https://github.com/RshaCuDeVidro/larperCord/releases/tag/v0.6.0) | `c6d9c1e3b93aa555392fc084ad5f17eec7c0fc7e76e09f13b5898906075b1871` |

`scripts/components.ps1` adquire os componentes atuais de música, verifica hashes e prepara `dist/Mare/components/`. Não altera o código desses componentes. O download é uma etapa de montagem do pacote; quem usa o pacote local completo só vê a interface do Maré.

## Sunnify

A [licença própria do Sunnify](https://github.com/sunnypatell/sunnify-spotify-downloader/blob/v2.6.0/LICENSE) permite uso/distribuição gratuitos com atribuição, sem modificação do software e sem inclusão em produto comercial. Não é a licença MIT nem uma licença que permita livremente modificar esse componente. O arquivo original acompanha o binário em `components/sunnify/LICENSE.txt`.

O Maré invoca somente a CLI documentada e não incorpora código-fonte modificado. O pacote original inclui Python, Qt, yt-dlp, FFmpeg e outros componentes, com seus próprios termos. Não se deve apresentar todo o conjunto de terceiros como código MIT ou um port integral para Rust.

## larperCord — integração histórica (até 0.3.2)

O README upstream informa que a licença do código principal ainda está **“Not decided yet”**. O script público adquire o binário original diretamente do autor; os artefatos públicos do Maré não devem redistribuir esse binário sem esclarecer a licença/permissão com o autor. O código MIT do adaptador e o script de aquisição ficam disponíveis no repositório. A CI do Maré gera um instalador com o host Rust, o Sunnify original e o bootstrapper oficial do WebView2. O larperCord adaptado não é incluído no instalador público.

O cliente usa Zig, SDL3 e Dear ImGui. A interface é uma janela nativa incorporada na área do app por HWND/SetParent; não é um iframe, uma cópia em HTML nem um cliente reescrito em Rust. O worker e o cliente permanecem abertos enquanto sua aba existir e são encerrados ao fechá-la.

O perfil do cliente fica em `MARE_DATA_DIR/apps/discord/config/` e o cache em `apps/discord/cache/`. O Maré não importa tokens de outro Discord instalado. Login é realizado manualmente dentro do próprio cliente, que pode guardar a sessão no cofre de credenciais do Windows. O adaptador remove o prefixo de caminho verbatim antes de passar as pastas ao cliente; sem isso, o salvamento do perfil falhava ao acrescentar separadores. A validação desta integração usou `--demo --no-live`, com dados do modo de teste explicitamente identificados, sem autenticar uma conta real.

O upstream informa que clientes de terceiros violam os termos do Discord e podem provocar restrições na conta. Essa limitação pertence ao cliente escolhido e deve ser considerada antes de fazer login. [Documentação original](https://github.com/RshaCuDeVidro/larperCord).
## Adaptação local do cliente de chat

A instalação de desenvolvimento 0.3.1 usa uma compilação local do commit upstream `202198b8988f3c7ec9583b37e95e39d0713d895d`, identificada como `0.6.0-mare1`. Ela remove a página e a consulta automática de atualizações, impede o relançamento como janela independente, encerra ao fechar a aba e oculta a entrada de demonstração no modo incorporado. A abertura usa `LARPER_HIDDEN` antes de anexar a janela ao host.

SHA256 do executável local: `23bbdd6459c8c2d408f027673d44c8be937a8c34b0b81cf123de8154ff11be71`. Toolchain Zig 0.17.0, alvo Windows GNU, otimização fast. Fonte de trabalho em `D:\DevTools\larpercord-mare-src`; nenhuma cópia modificada de código ou binário larperCord é publicada no repositório ou artefato do Maré enquanto a licença principal estiver indefinida. O script público de aquisição continua preparando a release original, não esta adaptação local.

O adaptador do Maré usa o mesmo diretório de perfil em todas as aberturas e dá até 2,5 segundos para saída normal do cliente. Variáveis herdadas de QA e token não são fornecidas ao cliente. Demonstração só é permitida em build debug, perfil explicitamente QA e configuração de teste. A persistência de uma conta autenticada precisa de validação manual; o teste não acessa o cofre de credenciais do usuário.

A adaptação local 0.3.2 usa uma superfície opaca no modo incorporado, além de retirar os estilos de janela de aplicativo/layered no reparenting. Isso evita misturar a renderização do cliente com a página por baixo. Essa adaptação continua restrita à instalação de desenvolvimento.

## Componentes de busca da 0.3.3

| Componente | Versão | SHA256 do executável |
| --- | --- | --- |
| yt-dlp original Windows | 2026.10.26 | f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d |
| Deno original Windows | 2.9.8 | 924397800533d3eb0ed0c889b20ad70e18b970d93acd8135bc043f425e528266 |

O script music-components.ps1 adquire artefatos e licenças de tags fixas oficiais, valida hashes e prepara components/music. O setup inclui os originais sem modificação. O executável Windows do yt-dlp é uma distribuição combinada GPLv3+; o código do projeto yt-dlp é Unlicense. Os caminhos para fontes e instruções de compilação acompanham o pacote em SOURCE-CODE.txt. Deno possui termos próprios; os textos e avisos originais acompanham o pacote. A consulta inicia um processo sem janela, com prazo e tamanho de resposta limitados; downloads iniciam apenas sob solicitação e o Job Object encerra descendentes ao cancelar/fechar. Não são usados cookies de outro cliente, login Spotify ou extração de token Discord.

Na 0.3.3, o catálogo usa o Discord web oficial; scripts/components.ps1 não adquire mais larperCord. Arquivos locais legados não são apagados. Nenhum binário Discord é redistribuído.
