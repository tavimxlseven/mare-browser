# IDs de aplicativos e integrações

## Discord Rich Presence

Quem usa o Maré não precisa criar um bot, fornecer token nem cadastrar um aplicativo. O Application ID público padrão, `1568194392156668016`, identifica o **Maré**, e pode ser usado em instalações de usuários diferentes.

Para compartilhar uma música:

1. Abra o Discord desktop e entre na sua conta.
2. Nas configurações do Discord, permita o compartilhamento de atividades.
3. No app de música do Maré, abra as configurações e habilite **Mostrar música no meu perfil**.
4. Reproduza uma faixa baixada. Pausar, parar ou fechar o app limpa a atividade.

O cliente envia atividade do tipo Listening, artista, faixa, duração e a capa da música quando disponível. A forma exata do cartão e o nome do aplicativo são controlados pelo Discord. Esta integração não recebe o selo oficial do Spotify. O Discord web incorporado não substitui o servidor IPC do Discord desktop.

### Configurar uma distribuição própria

1. Crie uma aplicação no [Discord Developer Portal](https://discord.com/developers/applications).
2. Em **General Information**, copie o **Application ID**. Não é necessário criar um bot.
3. Configure o nome e o ícone da aplicação. O nome registrado pode aparecer no cartão da atividade.
4. Antes de compilar, defina o ID público:

```powershell
$env:MARE_DISCORD_CLIENT_ID = 'SEU_APPLICATION_ID_PUBLICO'
.\scripts\build.ps1 -Release
```

As preferências locais de presença ficam em `apps/spotify/presence.json`; um override já salvo tem precedência sobre o padrão da build. Não coloque Client Secret, token de bot ou token de usuário nessa variável. Para diagnosticar, abra o Discord antes do Maré e consulte o estado mostrado nas configurações de música.

## Spotify — login adiado nesta versão

O login de conta está fora da interface da release 0.3.3 por decisão do mantenedor. Nenhum Client ID Spotify foi incluído como padrão. Importação por links públicos, playlists, downloads e áudio local continuam disponíveis sem conectar uma conta.

O código experimental de autorização usa Authorization Code com PKCE, sem Client Secret. Para uma futura build que volte a expor essa integração:

1. Registre uma aplicação elegível no [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Cadastre exatamente `http://127.0.0.1:43821/callback` entre as Redirect URIs.
3. Forneça o Client ID público por `MARE_SPOTIFY_CLIENT_ID` antes da compilação e habilite a entrada de conta na interface após validar a integração.
4. Em Development Mode, adicione cada conta de teste à lista de usuários autorizados.

As regras oficiais consultadas para esta release exigem Premium para o proprietário da aplicação em Development Mode e permitem até cinco usuários autorizados. Um usuário pode concluir o login e ainda receber HTTP 403 se não estiver autorizado. Cada usuário do Maré não precisa de seu próprio Client ID; o ID pertence à distribuição do aplicativo. Acesso público mais amplo depende das condições e da aprovação do Spotify.

Não versione segredos ou tokens. Um Client ID público não fornece, por si só, acesso a uma conta nem reprodução de áudio do Spotify.

Referências: [Discord Rich Presence](https://docs.discord.com/developers/platform/rich-presence), [Discord IPC](https://docs.discord.com/developers/topics/rpc), [Spotify PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [Spotify quotas](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

## Biblioteca entre PC e celular

O pareamento usa a conta do Maré Música; não depende de login Spotify, bot ou Application ID. No celular, abra **Ajustes → PC e celular → Conectar um PC**. No PC, abra **Ajustes de música → Conexões → PC e celular** e informe o endereço HTTPS do seu servidor e o código temporário.

As playlists e músicas adicionadas no PC são sincronizadas por conta e solicitam preparação no servidor para o celular. A busca e o download de áudio no PC continuam locais. O controle e a transferência de reprodução exigem os dois aplicativos abertos e conectados. O iOS pode suspender o webapp em segundo plano.

A credencial do PC fica protegida pelo DPAPI do Windows em `apps/spotify/cloud-session.bin`. Desconectar revoga a credencial no servidor e remove a cópia local. Não publique esse arquivo, `cloud-events.json`, a pasta de dados ou endereços privados do servidor.
