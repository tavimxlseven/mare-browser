# Verificação do Maré

Este documento separa o que deve ser verificado dos resultados efetivamente registrados. Uma inspeção de código ou do binário não substitui o teste de uma janela nativa em execução.

## Verificações automatizadas

No PowerShell:

```powershell
.\scripts\check.ps1
```

O script executa `cargo fmt --all --check`, Clippy com warnings tratados como erros, compila/executa testes Rust e `node --check ui/app.js`. Os testes do modelo e armazenamento cobrem normalização de URLs, ciclo de abas, histórico, sessão privada, IDs, restauração e round-trip no disco, incluindo dados inválidos.

A CI repete formatação, Clippy e testes em Windows, gera a build otimizada e publica o artefato. A existência do workflow no repositório não implica que uma execução já terminou com sucesso.

## Smoke nativo sugerido

Use um diretório descartável para não misturar navegação pessoal e testes:

```powershell
$env:MARE_DATA_DIR = 'D:\DevCache\mare-smoke-profile'
.\scripts\run.ps1
```

Feche instâncias anteriores que usem o mesmo diretório antes de iniciar. Faça também uma rodada com a build otimizada e com a pasta portátil em um local diferente do checkout.

| Fluxo | Passos e resultado esperado |
| --- | --- |
| Inicialização | Abrir uma janela nativa, conferir toolbar e página inicial; redimensionar sem sobreposição do conteúdo |
| Navegação real | Acessar `https://example.com`, verificar título/URL, seguir um link e usar voltar/avançar/recarregar |
| Pesquisa | Digitar uma consulta com espaços e acentos; repetir após trocar o mecanismo em Ajustes |
| Abas | Criar, alternar, duplicar, fixar, arrastar, fechar e reabrir uma aba; fechar a última deve deixar uma página inicial |
| Visão geral | Conferir cartões com os títulos das abas; ativar/fechar uma aba pelo cartão |
| Favoritos | Adicionar, editar, pesquisar, abrir e remover; reiniciar para verificar persistência |
| Histórico | Visitar dois sites, pesquisar entradas e limpar com confirmação |
| Modo de leitura | Abrir uma página com artigo, ativar o leitor, conferir títulos/texto, ampliar/reduzir e fechar; não deve executar conteúdo extraído nem criar arquivo offline |
| Lista de Leitura | Adicionar link, marcar lido/não lido e remover; conferir após reiniciar |
| Privada | Visitar um endereço exclusivo em uma aba privada, fechar e reiniciar; não deve entrar no histórico nem na sessão comum |
| Sessão | Restaurar abas comuns após reiniciar; desativar a opção e conferir abertura limpa |
| Menus e foco | Abrir sidebar, sugestões, diálogos e menu sobre uma página remota; conteúdo nativo não deve cobrir esses elementos |
| Busca/zoom/impressão | Buscar um termo da página, avançar/voltar resultados, mudar/restaurar zoom e abrir o diálogo de impressão |
| Downloads | Usar um arquivo pequeno de teste servido por HTTP local; conferir conclusão, arquivo real, revelação e erro de arquivo ausente |
| Aparência | Alternar claro, escuro, sistema e os quatro fundos; conferir persistência e contraste |
| Teclado | Conferir atalhos com foco na interface e com foco na página, foco visível e fechamento de diálogos com Escape |
| Dados dos sites | Em perfil descartável, criar dado web de teste, limpar em Ajustes e conferir o efeito no motor |
| Falha de perfil | Com o aplicativo fechado, usar JSON inválido em um perfil de teste; conferir aviso e conservação dos dados originais |
| Sem rede | Induzir falha de navegação e conferir se menus/abas continuam operando |
| Pacote | Rodar `dist\Mare\Mare.exe` fora do repositório, com WebView2 instalado; build GNU precisa da DLL distribuída |

Para downloads, prefira um servidor loopback sob controle do teste; não use cookies, credenciais ou arquivos particulares como fixture. Arquivos de teste e perfis descartáveis não devem entrar no Git.

## Limites de segurança a verificar

- Uma página remota não deve invocar comandos privilegiados da interface ou abrir arquivos locais por IPC.
- Esquemas como `javascript:`, `file:` e `data:` não devem ser aceitos como navegação web externa.
- Mensagens inválidas ou excessivamente grandes devem ser ignoradas sem encerrar a janela.
- Downloads só podem ser abertos/revelados a partir da pasta de destino esperada; arquivos executáveis não devem ser executados automaticamente.
- Sessões privadas e registros de downloads privados devem ser excluídos do estado persistido; o arquivo baixado continua no disco por ação do usuário.

Esses casos são critérios de verificação, não uma declaração de auditoria independente ou de ausência de vulnerabilidades.

## Inspeções estáticas com REA

As inspeções efetivamente executadas estão em [REA.md](REA.md) e `research/`. Incluem diretório do WebView2 e a tabela de imports PE de um snapshot de desenvolvimento do Maré. Nenhum desses comandos iniciou o executável. O hash da evidência identifica aquela build específica e pode mudar após correções.

## Testes de apps e proteção

Depois de abrir uma instância com perfil descartável e endpoint CDP local, execute os scripts sequencialmente:

```powershell
node scripts/smoke.mjs --cdp=http://127.0.0.1:9240 --profile=D:\DevCache\mare-v020-tabs-qa
node scripts/platform-smoke.mjs --cdp=http://127.0.0.1:9240 --profile=D:\DevCache\mare-v020-tabs-qa
```

O segundo script verifica bloqueio de solicitação antes de alcançar o servidor HTTP, controles por site/global, coexistência de workers Rust, trabalho em segundo plano, fechamento de uma aba sem encerrar outra, notas persistentes e conservação do documento da aba web. Ele requer um perfil exclusivo de QA e restaura configurações e apps instalados ao terminar.

Para verificar o caminho de execução dos workers no binário otimizado, sem abrir janela:

```powershell
.\scripts\build.ps1 -Release
node scripts/worker-smoke.mjs --exe=dist/Mare/Mare.exe
```

Esse teste usa processos reais, pipes e um diretório temporário próprio. Verifica protocolo, cálculos, erros recuperáveis, persistência das notas e saída por EOF. A CI executa essa etapa após compilar a versão MSVC.

## Smoke automatizado da janela nativa

O script `scripts/smoke.mjs` usa Node 24+ sem pacotes npm. Ele se conecta ao CDP de uma instância já aberta do Maré, cria um servidor HTTP loopback com fixtures e verifica o motor nativo, estado persistido e bytes de download. Deve usar um perfil descartável exclusivo, pois limpa cookies/dados dos sites durante a verificação.

Exemplo de inicialização no PowerShell:

```powershell
$env:MARE_DATA_DIR = 'D:\DevCache\mare-native-qa-final'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9227'
.\scripts\run.ps1
node .\scripts\smoke.mjs --cdp=http://127.0.0.1:9227 --profile=D:\DevCache\mare-native-qa-final
```

O script exige endereço CDP loopback e caminho absoluto de perfil identificado como QA/smoke. A ajuda pode ser consultada com `node .\scripts\smoke.mjs --help`. Essa execução aciona o host por comandos da interface via CDP; não representa uma cobertura de todos os cliques, sites ou estados visuais.

## Validação 0.3.0

Windows x64, Rust 1.99.1 GNU e WebView2 156.0.4314.58. Perfil descartável `D:\DevCache\mare-v030-integration-qa`, CDP loopback em `127.0.0.1:9251`.

| Verificação local | Resultado |
| --- | --- |
| Formatação, Clippy e sintaxe JavaScript | Aprovados |
| Testes Rust, incluindo vetor PKCE RFC7636 | 24 aprovados |
| Navegador / apps e proteção | 7 / 5 grupos aprovados |
| Workers Notas e Calculadora | 4 grupos aprovados com processos e pipes reais |
| Spotify: links, persistência e metadados online | Aprovados |
| Áudio local Windows | WAV silencioso próprio: tocar, pausar, seek, volume, retomar, parar |
| Sunnify original 2.6.0 | Versão e metadados reais; início sem janela e cancelamento com encerramento do processo |
| Discord IPC isolado | Handshake, Listening, faixa real do teste, timestamps e limpeza ao pausar |
| Integração da interface | 5 grupos aprovados, sem exceções JavaScript |

Os cinco grupos da interface verificaram: página nativa ainda visível ao abrir Shield/Compartilhar/Mais/Downloads, importação por formulário e capa sob CSP, reprodução local contínua ao trocar abas, janela real do larperCord incorporada no host e encerramento de cliente/worker ao fechar somente sua aba. O teste do larperCord usou `--demo --no-live`, sem conta real. A visibilidade da página veio do controlador WebView2 real, e o vínculo nativo do larperCord foi confirmado pelo HWND pai.

```powershell
node scripts/spotify-smoke.mjs --exe=dist/Mare/Mare.exe
node scripts/spotify-smoke.mjs --exe=dist/Mare/Mare.exe --online --audio --components
```

Não foram testados um download completo de áudio externo, login com conta Spotify real ou Rich Presence em um perfil real. Essas limitações não são substituídas por dados simulados na aplicação. Não há benchmark comparativo de consumo. A aprovação local não implica conclusão da CI hospedada.
## Validação 0.2.0

Windows x64, Rust 1.99.1, toolchain GNU local e WebView2 156.0.4314.58. A verificação integrada usou o perfil descartável `D:\DevCache\mare-v020-tabs-qa` e CDP em `127.0.0.1:9240`.

| Verificação | Resultado |
| --- | --- |
| Formatação e Clippy `-D warnings` | Aprovados |
| Testes Rust | 21 aprovados |
| Smoke do navegador | 7 grupos aprovados |
| Smoke de apps e proteção | 5 grupos aprovados |
| Workers no executável release | 4 grupos aprovados, com processos e pipes reais |
| Regressões da interface em fixtures | 20 aprovadas, sem exceções JavaScript |
| Interações na janela nativa | 7 aprovadas, incluindo Ctrl+Tab e fechamento isolado |
| Pacote GNU otimizado | Executável de 8.018.944 bytes; DLL de 160.880 bytes |

O servidor HTTP de teste não recebeu `/ads/cbr.js` com proteção ativa e recebeu a solicitação após a exceção por site. Os testes também verificaram controles globais, persistência da configuração e resposta de requests permitidos.

Os apps Notas e Calculadora mantiveram dois PIDs reais simultâneos. Pedidos em segundo plano não alteraram o app selecionado; selecionar uma aba existente reutilizou seu PID. Fechar Notas manteve Calculadora em execução e conservou a última gravação. Selecionar uma aba web manteve o worker aberto e retomou o mesmo documento, verificado por heartbeat e contagem de solicitações HTML. Fechar todas as abas de apps levou o contador de workers a zero.

As capturas em `screenshots/` foram feitas na interface nativa com o host Rust e workers reais. As 20 regressões em fixtures complementam essas verificações; não são apresentadas como testes de rede ou de processos.

Não foi feito benchmark comparativo de consumo com Spotify, Discord ou outros navegadores. A [CI Windows da versão 0.2.0](https://github.com/tavimxlseven/mare-browser/actions/runs/42142491228) terminou com `completed / success` para o commit `6bcf237ebbc0ebe29c61ae2a9989c6cb4a03061c`. A execução aprovou formatação, Clippy, testes Rust, sintaxe JavaScript, build release MSVC, quatro verificações CLI dos workers nativos, empacotamento e upload do artefato.

## Validação 0.1.0

Registro de **5 de novembro de 2026**, fuso **America/Sao_Paulo**. Ambiente local: Windows x64, Rust **1.99.1**, target **x86_64-pc-windows-gnu**, WebView2 Runtime **156.0.4314.58**. O perfil do smoke final foi `D:\DevCache\mare-native-qa-final`.

| Verificação executada | Resultado |
| --- | --- |
| Formatação Rust | Aprovada |
| Clippy com `-D warnings` | Aprovado, sem warnings |
| Testes Rust | 11 aprovados, 0 falhas |
| Sintaxe de `ui/app.js` | Aprovada |
| Build release Windows GNU | Concluída; executável de 1.574.400 bytes e loader de 160.880 bytes |
| Inspeção da janela nativa | Página inicial e navegação real para `https://example.com` confirmadas |
| Leitor no tema escuro | Texto e controles conferidos visualmente em uma página da documentação oficial do Rust |
| Smoke de integração nativo | 7 verificações aprovadas |

As sete verificações aprovadas pelo smoke foram:

1. Navegação HTTP real e título do documento.
2. Voltar e avançar pelo histórico nativo.
3. Preservação de títulos idênticos ao navegar entre URLs diferentes.
4. Persistência de favoritos, Lista de Leitura, histórico de visitas e sessão comum.
5. Isolamento bidirecional de cookies entre navegação comum e privada, com exclusão da sessão privada no JSON.
6. Download nativo de anexo, contenção do destino e igualdade exata dos bytes recebidos.
7. Limpeza assíncrona de cookies e dados dos sites no perfil comum.

A inspeção REA permanece vinculada ao snapshot debug e ao hash documentados em [REA.md](REA.md), não ao executável otimizado final. A CI Windows hospedada no GitHub foi concluída com sucesso para o código no commit `a059ae7b32bdd09a2a14d3d85ee9f31932251972` (`a059ae7`), tanto na [execução da branch main](https://github.com/tavimxlseven/mare-browser/actions/runs/42136216044) quanto na [execução da tag v0.1.0](https://github.com/tavimxlseven/mare-browser/actions/runs/42136247073). Ambas terminaram com `completed / success`, cobrindo formatação, Clippy, testes, sintaxe JavaScript, build release MSVC e upload do artefato. Builds macOS/Linux não foram verificadas nesta sessão. O roteiro manual mais amplo deste documento continua útil para ampliar a cobertura; os resultados acima não implicam que cada linha desse roteiro foi exercitada.

## Validação 0.3.1

- Formatação, Clippy sem warnings, sintaxe JavaScript e 27 testes Rust aprovados.
- Navegação nativa: 7 grupos; proteção e ciclo de apps: 5 grupos aprovados.
- Regressão de redimensionamento em quatro tamanhos nativos após destruição de um WebView filho, comparando limites reais dos controladores e dimensões da interface.
- WAV próprio em página HTTP loopback continuou avançando ao abrir Spotify, sem pausa nem evento visibilitychange para oculto.
- Monitor coletou host, WebView2 e worker Spotify, sem PIDs duplicados. Valores de memória vêm do Windows, não de estimativa por aba.
- Worker de música: áudio nativo, persistência de download confirmado e reutilização sem novo processo; solicitações repetidas reutilizaram o downloader ativo; cancelamento encerrou o processo.
- Protocolo Rich Presence aprovado em IPC isolado. O Discord Canary real aceitou o handshake com `1568194392156668016`, sem publicar uma faixa de teste. Exibição visual no perfil ainda não foi confirmada.
- Cliente larperCord local incorporado com HWND pai real e sem barras extras. A ordem das janelas foi conferida visualmente sobre uma página web mantida viva.

Não houve login automatizado nem leitura de credenciais. Login persistente do larperCord e importação de uma conta Spotify real permanecem verificações manuais. Não foi realizado benchmark de consumo nem download integral de áudio externo.


## Validação 0.3.2

- 32 testes Rust, formatação, Clippy sem warnings e verificação JavaScript aprovados; um teste de rede opt-in também verificou um CRX3 público da Chrome Web Store.
- Pacote sintético assinado: identidade da extensão, rejeição de arquivo adulterado, extração e manutenção do ID foram verificadas sem executar código externo.
- Smoke integrado: favicons, mídia em segundo plano, exclusão de áudio, alternância rápida de abas, fechamento de app e botão de desempenho.
- Instalação real de Google Translate em perfil isolado, persistência após reabrir, desativação e remoção aprovadas. Isso valida a instalação; não equivale a testar todas as funções da extensão ou todas as APIs do Chrome.
- Abas públicas, cookie persistente HttpOnly próprio, localStorage e IndexedDB sobreviveram à reabertura com o executável em outra pasta. Não foram lidos cookies, senhas ou tokens de contas reais.
- Áudio local da build otimizada e exclusão de download durante reprodução aprovados com WAV silencioso próprio.
- IPC Discord isolado: Application ID compartilhado, Listening, artista, capa, timestamps e limpeza ao pausar aprovados. O teste não publicou atividade em perfil real.
- O caminho verbatim do Windows reproduziu a falha de salvamento do cliente de chat; o caminho convertido e uma credencial sintética no cofre Windows passaram. Reautenticação com conta real continua sendo validação manual.

Para repetir o smoke integrado, use Node 24+, WebView2 instalado, uma build local e um perfil descartável novo. Ele baixa e instala uma extensão pública apenas nesse perfil, remove-a no fim e não autentica contas:

```powershell
node scripts/release-smoke.mjs --exe=dist/Mare/Mare.exe --profile=D:\DevCache\mare-release-smoke-qa
```

A porta local 9260 precisa estar livre. O teste usa áudio silencioso e não mede o sinal sonoro nem FPS. A continuidade foi verificada em uma página própria que pausa ao ficar oculta; não representa uma cobertura de todas as condições de YouTube, Twitch e Kick. Não há benchmark comparativo de desempenho.

## Validação 0.3.3

A prévia de interface usou 170 faixas fictícias, com aviso visível e sem reprodução de áudio. Foram verificados: fila com 169 faixas seguintes após iniciar a primeira, menu de faixa e detalhes, busca com resultados de teste, persistência de largura/compactação após recarregar, janela de 800×620 e fila flutuante sem transbordamento horizontal. Não houve erros de console nessa verificação. O teste puro scripts/music-queue-smoke.cjs cobre 170 faixas únicas, histórico, repetição, reordenação, remoção e descarte de arquivos indisponíveis.

O cenário scripts/spotify-smoke.mjs foi ampliado para associação a várias playlists, remoção seletiva e renomeação. A opção --catalog testa a busca pública real e a persistência de um resultado escolhido, sem baixar áudio. A consulta de rede é opt-in e aparece como etapa separada na CI, pois pode ser bloqueada pelo provedor; seu resultado deve ser consultado antes de afirmar validação online.

O Windows deste ambiente passou a bloquear o compilador e a nova build não assinada por Application Control. A validação Rust e dos workers usa o runner Windows do GitHub. A build nova não foi executada na sessão gráfica deste computador, e o Maré já aberto foi preservado. Não foram desativadas políticas nem feitas tentativas de contorná-las. Login e chamadas Discord com conta real, áudio externo audível e Rich Presence em perfil real continuam fora dessa validação.

Runner Windows da implementação (run 42269203239): formatação e Clippy aprovados; 33 testes Rust passaram, 0 falharam e 1 teste de rede opcional ficou ignorado. A fila de 170 músicas e os workers reais passaram. A busca pública real por música retornou resultados, permitiu adicionar um resultado e preservou título/canal após reiniciar o worker, sem baixar áudio. A inspeção PE da build MSVC confirmou a ausência de imports VCRUNTIME/MSVCP; o runtime C++ está vinculado estaticamente.
