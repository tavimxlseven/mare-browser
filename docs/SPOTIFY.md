# Música no Maré

O app reúne uma biblioteca de links Spotify, downloads em segundo plano e reprodução de arquivos locais. A interface compartilha a WebView dos controles do navegador; o processamento de biblioteca, IPC e controle de áudio ocorre no worker Rust. A reprodução local usa os componentes multimídia do Windows.

![Música no Maré](screenshots/spotify.png)

## Disponível

- Títulos e capas reais de links públicos pelo oEmbed do Spotify.
- Pesquisa local, curtidas e coleções locais, sem modificar playlists da conta.
- Biblioteca unificada de links e músicas baixadas, com play na própria faixa, confirmação do download e fila. Downloads repetidos são bloqueados tanto na interface quanto no worker.
- Áudio local com reproduzir/pausar, posição, duração e volume. O worker continua aberto ao alternar abas e encerra ao fechar a aba do app.
- Sunnify CLI 2.6.0 incluído no pacote local completo, sem janela, instalação separada, ajuste de PATH ou configuração pelo usuário. O botão de baixar fornece os parâmetros e a pasta de destino.
- Estado, erros reais e cancelamento de download na interface. Arquivos já concluídos são preservados. Um Job Object encerra os processos auxiliares; o diretório temporário de extração de cada execução é removido depois do encerramento.
- Play em uma faixa ainda não baixada aguarda o downloader terminar e o arquivo ser indexado. O player interpola a posição visual entre amostras nativas; nenhum áudio é reproduzido de um arquivo em gravação. Spicetify continua pertencendo ao cliente oficial.

O Sunnify consulta metadados Spotify e busca o áudio correspondente no YouTube, com seu próprio matcher, yt-dlp, FFmpeg e gravador de tags. Ele **não baixa o fluxo de áudio do Spotify**. O resultado e a disponibilidade dependem da fonte e da rede; falhas são mostradas sem inventar um arquivo ou uma reprodução. Use downloads para conteúdo que você pode baixar. O binário original do Sunnify não foi modificado.

## Conta Spotify opcional

Há suporte a OAuth Authorization Code com PKCE, callback loopback em `http://127.0.0.1:43821/callback` e permissões somente de leitura: `playlist-read-private`, `playlist-read-collaborative` e `user-library-read`. O login ocorre no site oficial em uma aba privada. A senha nunca entra na interface local do Maré. O callback verifica o estado da sessão e expira após três minutos.

Após autorizar, o worker importa automaticamente playlists e músicas curtidas, com paginação limitada a 500 itens de cada categoria por importação. A interface informa truncamento quando há mais itens. A biblioteca existente é preservada se a gravação excederia os limites. Os tokens ficam apenas na memória do worker; reiniciar o app ou expirar o token exige conectar novamente. Desconectar cancela operações de conta, descarta o token e mantém os links locais já importados.

**Esta instalação ainda não possui Client ID registrado.** O fluxo com uma conta real não foi validado. O mantenedor precisa registrar um aplicativo elegível no Spotify, configurar a URI acima e fornecer `MARE_SPOTIFY_CLIENT_ID` ao compilar. Não existe login simulado nem uso do Client ID de outro cliente. As regras de conta, acesso e quotas do Spotify continuam aplicáveis. Downloads e arquivos locais funcionam independentemente desse login.

## Discord Rich Presence

O worker implementa o protocolo IPC local do Discord, com handshake, atividade do tipo Listening, nome da faixa, artista, timestamps e limpeza ao pausar/parar/sair. Não usa token de usuário nem self-bot. O compartilhamento é opcional nas configurações de música. O Application ID público do Maré é `1568194392156668016`, incluído como padrão. Uma build pode substituí-lo por `MARE_DISCORD_CLIENT_ID`. O nome da atividade depende desse aplicativo registrado; não é o selo oficial do Spotify.

O protocolo foi validado com servidor IPC isolado, faixa WAV silenciosa e o worker real, sem contatar uma conta Discord. O handshake com o Application ID do Maré foi aceito pelo Discord Canary instalado. Essa verificação não publicou uma faixa de teste nem confirmou visualmente a atividade em um perfil real. O Discord desktop precisa estar aberto e o compartilhamento de atividades habilitado. O larperCord é uma integração separada e não é tratado como servidor RPC oficial.

## Dados e componentes

Os dados ficam em `MARE_DATA_DIR/apps/spotify/`: `library.json`, `downloaded.json`, `completed-downloads.json`, `presence.json`, `audio/` e temporários em `runtime/`. Não são lidos tokens, cookies ou arquivos do Spotify/Spicetify instalado. Nenhum componente fechado é mantido residente pelo Maré.

A biblioteca de links aceita até 1000 itens, 20 coleções e 512 KiB serializados. O índice de arquivos locais aceita até 2000 faixas e 1 MiB. O protocolo de apps é limitado a 2 MiB por mensagem. As atualizações periódicas do player enviam a biblioteca local apenas quando sua revisão muda.

O executável do Sunnify ocupa aproximadamente 158 MB no disco, além dos arquivos temporários durante uma operação; Rust não elimina o tamanho ou o custo desse componente Python/Qt empacotado. Ele sai da memória ao terminar/cancelar. Não há benchmark comparativo de RAM/CPU com o Spotify oficial.

Para preparar os componentes originais em uma build de desenvolvimento:

```powershell
.\scripts\components.ps1
.\scripts\build.ps1 -Release
```

O script baixa versões fixas dos repositórios originais e verifica SHA256. Os componentes não são incluídos no Git. Consulte [COMPONENTS.md](COMPONENTS.md) para origem, versões e licenças.

## Verificação

```powershell
node scripts/spotify-smoke.mjs --exe=dist/Mare/Mare.exe
node scripts/spotify-smoke.mjs --exe=dist/Mare/Mare.exe --online --audio --components
```

`--audio` usa WAV silencioso próprio; exige os componentes multimídia do Windows. `--components` inicia e cancela imediatamente o downloader para verificar seu ciclo de vida, sem baixar áudio externo. `--online` verifica metadados públicos. Essas verificações não equivalem a um download de áudio completo nem a um login de conta real.

Fontes: [Sunnify CLI](https://github.com/sunnypatell/sunnify-spotify-downloader/blob/v2.6.0/docs/CLI.md), [Spotify oEmbed](https://developer.spotify.com/documentation/embeds/reference/oembed), [Spotify PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [Discord RPC](https://docs.discord.com/developers/topics/rpc).
