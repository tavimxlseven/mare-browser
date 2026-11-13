# Maré Música para Android

Cliente instalável por APK para Android 8 ou superior. A interface usa o mesmo servidor e a mesma conta do webapp. A reprodução é feita pelo Media3/ExoPlayer em um `MediaSessionService`, com fila nativa, foco de áudio, controles na notificação e tela bloqueada, detecção de desconexão de fones e serviço separado da tela do aplicativo. Não depende do Samsung Internet ou Chrome para mudar de música.

Na primeira abertura, informe o endereço HTTPS da sua instalação e entre na sua conta Maré. Nenhum servidor, usuário, senha ou sessão é embutido no APK público. O login permanece no armazenamento privado do WebView. Downloads do navegador/PWA anterior não são transferidos automaticamente para o aplicativo: salve novamente as faixas desejadas dentro do APK.

O botão **Salvar no aparelho** envia as faixas já preparadas ao serviço de downloads nativo, com até duas transferências simultâneas e cache privado separado por servidor e conta. O cache é usado pelo player sem conexão. Faixas ainda em preparação continuam na fila do servidor; abra o aplicativo para iniciar sua transferência quando estiverem prontas. Downloads ativos e áudio podem continuar ao sair da tela. Forçar a parada do aplicativo, reiniciar o sistema ou restrições do fabricante podem interromper os serviços. A versão inicial não restaura reprodução automaticamente após reiniciar o Android. O controle de outros dispositivos continua disponível pela interface enquanto ela está aberta.

O host restringe a ponte JavaScript à origem HTTPS escolhida e ao documento principal. Conteúdo externo abre fora do aplicativo. A ponte não entrega cookies HttpOnly ao JavaScript, acesso arbitrário a arquivos ou execução de comandos do sistema. Backups e transferência automática de dados pelo Android estão desabilitados; sessões e downloads pertencem ao usuário que os criou.

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
