# Componentes externos

O código original do Maré é MIT. Os componentes abaixo conservam seus próprios termos e não recebem a licença MIT do Maré. Nenhum binário desses projetos é versionado neste repositório ou instalado como aplicativo separado no sistema.

| Componente | Versão | Origem | SHA256 do artefato |
| --- | --- | --- | --- |
| Sunnify Windows CLI | 2.6.0 | [Release original](https://github.com/sunnypatell/sunnify-spotify-downloader/releases/tag/v2.6.0) | `abb16d22cabebf99d82c3eaf8ca60a0b5511dd99eb86b17f16d53d7077fb57ba` |
| larperCord Windows ZIP | 0.6.0 | [Release original](https://github.com/RshaCuDeVidro/larperCord/releases/tag/v0.6.0) | `c6d9c1e3b93aa555392fc084ad5f17eec7c0fc7e76e09f13b5898906075b1871` |

`scripts/components.ps1` adquire os artefatos originais, verifica esses hashes e prepara `dist/Mare/components/`. Não altera o código desses componentes. O download é uma etapa de montagem do pacote; quem usa o pacote local completo só vê a interface do Maré.

## Sunnify

A [licença própria do Sunnify](https://github.com/sunnypatell/sunnify-spotify-downloader/blob/v2.6.0/LICENSE) permite uso/distribuição gratuitos com atribuição, sem modificação do software e sem inclusão em produto comercial. Não é a licença MIT nem uma licença que permita livremente modificar esse componente. O arquivo original acompanha o binário em `components/sunnify/LICENSE.txt`.

O Maré invoca somente a CLI documentada e não incorpora código-fonte modificado. O pacote original inclui Python, Qt, yt-dlp, FFmpeg e outros componentes, com seus próprios termos. Não se deve apresentar todo o conjunto de terceiros como código MIT ou um port integral para Rust.

## larperCord

O README upstream informa que a licença do código principal ainda está **“Not decided yet”**. A integração local usa o binário original adquirido diretamente do autor; os artefatos públicos do Maré não devem redistribuir esse binário sem esclarecer a licença/permissão com o autor. O código MIT do adaptador e o script de aquisição ficam disponíveis no repositório. A CI do Maré gera apenas o artefato do host Rust.

O cliente usa Zig, SDL3 e Dear ImGui. A interface é uma janela nativa incorporada na área do app por HWND/SetParent; não é um iframe, uma cópia em HTML nem um cliente reescrito em Rust. O worker e o cliente permanecem abertos enquanto sua aba existir e são encerrados ao fechá-la.

O perfil do cliente fica em `MARE_DATA_DIR/apps/discord/config/` e o cache em `apps/discord/cache/`. O Maré não importa tokens de outro Discord instalado. Login é realizado manualmente dentro do próprio cliente. A validação desta integração usou `--demo --no-live`, com dados do modo de teste explicitamente identificados, sem autenticar uma conta real.

O upstream informa que clientes de terceiros violam os termos do Discord e podem provocar restrições na conta. Essa limitação pertence ao cliente escolhido e deve ser considerada antes de fazer login. [Documentação original](https://github.com/RshaCuDeVidro/larperCord).
