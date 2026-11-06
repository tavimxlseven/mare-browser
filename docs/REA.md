# Investigação com REA

## O que foi usado

[REA — Reverse Engineer Anything](https://github.com/morluto/rea), pacote oficial `rea-agents` versão **6.8.0**, foi instalado isoladamente em `D:\DevTools\rea` e executado por CLI com Node **24.22.1**. O npm usou cache em `D:\DevCache\npm`. Não foi configurado MCP e não foi necessário alterar a configuração do agente ou o perfil do usuário.

O pacote veio de `https://registry.npmjs.org/rea-agents/-/rea-agents-6.8.0.tgz`. A origem, a integridade publicada pelo registry e o SHA-256 do arquivo adquirido estão em [research/toolchain.json](research/toolchain.json). A instalação local desativou scripts de ciclo de vida. REA é uma ferramenta de investigação; não é uma dependência de runtime do Maré nem o motor que renderiza páginas.

## Comandos efetivamente executados

```powershell
node D:\DevTools\rea\node_modules\rea-agents\scripts\rea.mjs --help
node D:\DevTools\rea\node_modules\rea-agents\scripts\rea.mjs --version --format json
node D:\DevTools\rea\node_modules\rea-agents\scripts\rea.mjs inspect-desktop-application --help
node D:\DevTools\rea\node_modules\rea-agents\scripts\rea.mjs inspect-desktop-application 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application\156.0.4314.58' --max_entries 1500 --max_probe_bytes 2097152 --format json
```

O último comando terminou com código **0**. Alvo: diretório do Microsoft Edge WebView2 Runtime **156.0.4314.58** instalado no Windows. Não foram lidos perfis de navegação, cookies ou histórico. Não se anexou depurador e não se iniciou o programa alvo.

Os comandos foram executados com caches temporários apontando para D:

```powershell
$env:npm_config_cache = 'D:\DevCache\npm'
$env:XDG_CACHE_HOME = 'D:\DevCache\rea'
$env:XDG_CONFIG_HOME = 'D:\DevTools\rea\config'
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\DevCache\playwright'
$env:TEMP = 'D:\DevCache\temp'
$env:TMP = 'D:\DevCache\temp'
```

## Resultado observado

| Medida | Resultado |
| --- | --- |
| Entradas examinadas | 963 |
| Arquivos cujos cabeçalhos foram inspecionados | 45 |
| Total de bytes lidos | 14.992 |
| Limites configurados | 1.500 entradas / 2.097.152 bytes |
| Cobertura declarada pela ferramenta | `complete-within-scan` |
| Candidatos de runtime classificados automaticamente | Nenhum |

Foram observados cabeçalhos PE, inclusive imagens x86/x64, em componentes como `msedgewebview2.exe` e `EmbeddedBrowserWebView.dll`. Isso não prova código carregado, compatibilidade funcional nem quais recursos o Maré consegue executar. A ferramenta não classificou esse diretório como um candidato de runtime; o nome do produto vem do diretório de instalação selecionado e da documentação do WebView2.

A [projeção sanitizada](research/webview2-installation.sanitized.json) conserva a identidade da evidência original, o SHA-256 do relatório bruto, parâmetros, cobertura, fatos dos arquivos examinados e limitações. Identificadores de dispositivo/inode, datas do sistema de arquivos e o inventário não examinado foram omitidos. Essa projeção é um documento de pesquisa derivado, não um bundle Evidence original válido para reimportação. O relatório bruto fica fora do repositório, no diretório local da ferramenta.

`complete-within-scan` descreve a varredura delimitada. Não significa que todos os bytes dos arquivos foram lidos ou que o aplicativo foi integralmente compreendido.

## Inspeção estática do Maré

Também foi executado, sem iniciar o programa alvo:

```powershell
node D:\DevTools\rea\node_modules\rea-agents\scripts\rea.mjs inspect-pe-imports 'D:\DevCache\mare-target\debug\mare-browser.exe' --max-file-bytes 104857600 --format json
```

O comando terminou com código **0** sobre um snapshot intermediário de desenvolvimento: **68.136.331 bytes**, SHA-256 `2adeb67fccad5943ce570ea0da21f0c6e5512aac54904f8fb962ae2dfee71296`. O limite de leitura foi aumentado para 100 MiB porque a build debug excedia o padrão de 64 MiB do REA.

O REA observou formato PE x86_64, **33 DLLs**, **349 imports** e **zero delay imports**, com cobertura `complete` para a tabela de imports. Entre os imports aparecem `WebView2Loader.dll`, `CreateCoreWebView2EnvironmentWithOptions` e `GetAvailableCoreWebView2BrowserVersionString`. Essa observação sustenta a dependência do loader nessa build GNU; não prova que uma chamada foi executada, que uma DLL foi carregada ou que todos os fluxos da interface funcionam.

A [projeção sanitizada dos imports](research/mare-pe-imports.sanitized.json) preserva o hash da build e os nomes importados, omitindo caminho local, offsets/RVAs e valores de thunk. É uma inspeção de um arquivo específico, anterior a eventuais correções e recompilações. Não representa uma certificação da release final nem uma verificação do Safari.

## Limites da referência Safari

O ambiente de desenvolvimento é Windows. Não havia uma instalação de **Safari para Mac** disponível, e não foi feita descompilação nem inspeção binária do Safari. O REA não foi usado para gerar uma suposta comparação de pixels ou equivalência funcional com esse aplicativo.

A observação web do REA usa CDP e exige um navegador da família Chrome, conforme [browser-observation.md](https://github.com/morluto/rea/blob/main/docs/browser-observation.md). Essa capacidade não fornece acesso à interface nativa do Safari no macOS.

A interface do Maré foi implementada de forma independente a partir dos fluxos visíveis descritos pela documentação pública da Apple. Foram referências:

- [Manual do Safari para Mac](https://support.apple.com/pt-br/guide/safari/welcome/mac)
- [Personalizar a janela e os layouts de abas](https://support.apple.com/pt-br/guide/safari/ibrw1012/27.0/mac/27)
- [Grupos de abas](https://support.apple.com/pt-br/guide/safari/ibrwa2d73908/mac)
- [Perfis](https://support.apple.com/pt-br/105100)
- [Atalhos de teclado](https://support.apple.com/pt-br/guide/safari/cpsh003/27.0/mac/27)

Não há vínculo com a Apple nem uso de código ou recursos visuais proprietários do Safari. Serviços como iCloud, Chaves, Apple Pay e Handoff não foram reconstruídos.

## Reproduzir a investigação

Use as instruções oficiais de [instalação](https://github.com/morluto/rea/blob/main/docs/installation.md), a versão fixada registrada no relatório e o [fluxo de inspeção de diretórios](https://github.com/morluto/rea/blob/main/docs/desktop-applications.md). Se o WebView2 tiver outra versão, selecione o diretório correspondente e registre essa diferença. Não reutilize o relatório desta máquina como prova do estado de outra instalação.

Novas inspeções devem especificar uma pergunta e um alvo delimitado. Antes de publicar resultados, remova dados pessoais e descreva tanto os fatos observados quanto os pontos não examinados. A saída `--help` usada está em [research/rea-help.txt](research/rea-help.txt) e [research/rea-inspect-help.txt](research/rea-inspect-help.txt).
