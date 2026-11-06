# Verificação do Maré 0.1.0

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

## Resultados da sessão

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

