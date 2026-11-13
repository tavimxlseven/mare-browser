# Noise Music para Android

Cliente instalável por APK para Android 8 ou superior. A versão 0.2 usa telas Android nativas para login, biblioteca, busca, playlists, fila e player, sem WebView. Usa a mesma conta e biblioteca do webapp. A reprodução é feita pelo Media3/ExoPlayer em um `MediaSessionService`, com fila nativa, foco de áudio, controles na notificação e tela bloqueada, detecção de desconexão de fones e serviço separado da tela do aplicativo. Não depende do Samsung Internet ou Chrome para mudar de música.

Na primeira abertura, informe o endereço HTTPS da sua instalação e entre na sua conta Noise Music. Nenhum servidor, usuário, senha ou sessão é embutido no APK público. A sessão é cifrada por uma chave do Android Keystore; a senha não é persistida. Downloads feitos pela PWA continuam no navegador. Downloads feitos no APK 0.1 permanecem no cache nativo ao instalar a atualização com a mesma assinatura. Será necessário entrar novamente uma vez ao migrar do cliente antigo.

O botão **Salvar no aparelho** envia as faixas já preparadas ao serviço de downloads nativo, com até duas transferências simultâneas e cache privado separado por servidor e conta. O cache é usado pelo player sem conexão. Faixas ainda em preparação continuam na fila do servidor; abra o aplicativo para iniciar sua transferência quando estiverem prontas. Downloads ativos e áudio podem continuar ao sair da tela. Forçar a parada do aplicativo, reiniciar o sistema ou restrições do fabricante podem interromper os serviços. A versão inicial não restaura reprodução automaticamente após reiniciar o Android. O controle de outros dispositivos continua disponível pela interface enquanto ela está aberta.

Não há ponte JavaScript ou execução de páginas no cliente novo. As requisições usam a origem HTTPS informada no login. A navegação e a reprodução de downloads são locais; busca, importação e preparação de áudio ainda usam o servidor. Backups e transferência automática de dados pelo Android estão desabilitados; sessões e downloads pertencem ao usuário que os criou.

## Compilar

Use JDK 17, Gradle 8.11.1, Android SDK 35 e Build Tools 35.0.0. Defina `ANDROID_HOME` para seu SDK e execute a partir da raiz:

```sh
gradle -p android testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
```

O APK de desenvolvimento fica em `android/app/build/outputs/apk/debug/app-debug.apk`. A CI verifica o código e disponibiliza esse artefato para testes. A distribuição pública usa uma assinatura de lançamento privada e estável, sem incluir o keystore no repositório.

Para lançamento, configure `MARE_ANDROID_KEYSTORE` com o caminho absoluto do keystore, `MARE_ANDROID_STORE_PASSWORD` com a senha e o alias `mare`. Execute `gradle -p android assembleRelease`. Mantenha a mesma chave entre atualizações para preservar a instalação, login e downloads. Guarde uma cópia privada da chave: perdê-la impede atualizar a instalação existente.

## Verificar

`node scripts/music-native-check.cjs` verifica a ponte, separação por conta, fila, progresso e adoção de uma transição executada pelo serviço.

Com um emulador/dispositivo de teste conectado, execute `gradle -p android connectedDebugAndroidTest`. O teste instrumental gera duas faixas WAV locais, inicia o serviço de áudio, envia a tela para segundo plano, apaga a tela e verifica a continuidade na segunda faixa. Não acessa contas ou músicas reais. Ainda é necessário validar a versão distribuída em aparelhos físicos, especialmente sob as políticas de bateria do fabricante.

Referências: [serviço de reprodução em segundo plano](https://developer.android.com/media/media3/session/background-playback), [WebViewCompat](https://developer.android.com/reference/androidx/webkit/WebViewCompat).

## Limites da versão nativa inicial

Não reproduz todas as funções do Spotify ou Apple Music. Edição de capa, wallpapers, letras e controle de outros aparelhos ainda não estão disponíveis nas telas Android. Essas funções do webapp não são removidas. A versão nativa oferece busca, importação, criação e renomeação de playlists, curtidas, inclusão em playlist, fila com tocar a seguir, reordenação por botão, repetição, aleatório, exclusão, download e reprodução offline. A preparação direta de áudio no Android ainda não foi implementada.
