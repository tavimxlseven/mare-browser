# Perfil, logins e atualizações

Os dados do usuário pertencem ao perfil, e não à pasta do executável. O instalador usa o mesmo AppId e o mesmo diretório de programa entre versões; substituir o programa não apaga o perfil. A desinstalação não remove os dados de navegação.

## Onde ficam os dados

O padrão no Windows é `%LOCALAPPDATA%\MareBrowser\User Data`, separado por usuário e por instalação do Windows, independentemente da existência de D:. O diretório do programa e o disco usado para desenvolvimento não escolhem o perfil. `MARE_DATA_DIR`, quando definido explicitamente, continua escolhendo outra pasta.

Versões até 0.5.4 podiam usar `D:\MareBrowserData` automaticamente. Esse diretório compartilhado não é mais lido ou importado automaticamente: ele pode pertencer a outra instalação ou usuário. Para importar seu próprio perfil antigo, feche todas as janelas do Maré e execute `powershell -ExecutionPolicy Bypass -File scripts/import-profile.ps1 -From 'D:\MareBrowserData'` a partir do código-fonte. O script só copia para um destino novo, recusa links e junções, não mescla perfis e preserva a origem. Cookies protegidos por outro usuário/Windows podem exigir novo login. Um perfil novo começa vazio até uma importação explícita.

| Pasta ou arquivo | Conteúdo |
| --- | --- |
| `state.json` | Abas públicas restauráveis, favoritos, histórico, preferências e registros de downloads |
| `web-profile/` | Perfil WebView2 dos sites: cookies, armazenamento local, IndexedDB, permissões e dados de login mantidos pelo runtime |
| `interface/` | Perfil separado dos controles locais do Maré |
| `apps/spotify/` | Biblioteca, áudio baixado, capas e preferências de presença |
| `apps/discord/` | Dados legados do antigo adaptador, preservados sem migração de credenciais |
| `extensions/` | Pacotes de extensões instaladas |

Na 0.3.3, o Discord usa o site oficial no perfil público `web-profile/`. Entre normalmente na primeira abertura; os dados de sessão são mantidos pelo WebView2. A atualização não importa tokens do larperCord nem de outro Discord instalado e não apaga os dados antigos. As regras de expiração da sessão continuam sendo do Discord.

## Atualizar sem perder o perfil

- Feche o Maré antes de executar o novo setup. O instalador também tenta fechar arquivos em uso.
- Instale normalmente sobre a versão anterior. Não exclua `web-profile/`, `interface/` ou o diretório de dados.
- Se usa `MARE_DATA_DIR`, mantenha o mesmo valor ao atualizar e ao abrir pelo atalho.
- Não use uma pasta que contenha o número da versão como perfil: isso criaria um perfil diferente a cada atualização.
- Para backup, feche o Maré e aguarde seus processos WebView2 terminarem; copie a pasta de dados inteira para um local privado. Não publique esse backup em issues ou no GitHub.

Os dados de login podem ser vinculados ao usuário do Windows e protegidos pelo sistema. Copiar um perfil para outro computador ou outra conta Windows não garante que as credenciais possam ser usadas. Não compartilhe um único perfil simultaneamente entre processos ou usuários distintos.

## Google e outros sites

Cookies persistentes e armazenamento dos sites ficam no mesmo perfil WebView2 após reiniciar ou atualizar o Maré. O navegador não exige um login Google novo apenas por mudar seu executável. Porém, o serviço pode expirar/revogar uma sessão, pedir autenticação novamente, usar cookies apenas de sessão ou recusar autenticação em navegadores incorporados. Maré não contorna esses controles e não importa logins do Chrome/Edge instalado.

Uma sessão de site salva e uma senha salva são coisas diferentes. O WebView2 gerencia seus próprios recursos de preenchimento e credenciais; não existe sincronização de senhas com uma conta Google no Maré. Abas privadas não entram na sessão pública persistida e não devem ser usadas quando a intenção é manter login.

## Gravação e recuperação

O estado público é gravado em uma fila, agrupando eventos próximos para não executar `fsync` durante cada troca de aba. Ao fechar normalmente, o navegador drena essa fila. A escrita usa arquivo temporário na mesma pasta e substituição atômica. Uma queda abrupta antes da última gravação pode perder as alterações mais recentes, sem transformar abas privadas em histórico público.

Um `state.json` inválido é preservado com nome de recuperação antes de criar um estado novo; erros de gravação são informados na interface. Não apague um perfil para corrigir uma falha sem fazer uma cópia privada primeiro.

Referência: [gerenciamento da pasta de dados do WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder).
