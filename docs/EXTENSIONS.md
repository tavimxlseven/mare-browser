# Extensões da Chrome Web Store

O Maré aceita pacotes públicos **Manifest V3** da Chrome Web Store pelo gerenciador de extensões. A execução é fornecida pelo Microsoft WebView2 e depende das APIs que esse runtime implementa.

## Instalar

1. Abra a página da extensão na [Chrome Web Store](https://chromewebstore.google.com/).
2. Clique no ícone de extensões na barra do Maré, ao lado do desempenho.
3. Cole o link da extensão, ou use o endereço já preenchido da página aberta.
4. Clique em **Verificar extensão**. O Maré baixa o CRX3 em segundo plano, verifica a assinatura e mostra nome, versão e permissões declaradas.
5. Revise o acesso solicitado e clique em **Adicionar ao Maré**. Recarregue as páginas já abertas.

O botão “Adicionar ao Chrome” do site pertence à integração do Google Chrome. No Maré, use o gerenciador acima. Extensões pagas, privadas ou cuja distribuição exige autenticação não são suportadas por esse fluxo.

## Gerenciar

O mesmo painel permite ativar, desativar e remover extensões. **Abrir** aparece quando a extensão declara uma página de ação; ela abre em uma aba própria. A janela padrão de popup do Chrome, os badges e a barra de ações do Chrome não são reproduzidos automaticamente pelo WebView2.

As pastas ficam em `extensions/` dentro do perfil do Maré, fora do diretório do programa. O registro pertence ao perfil público do WebView2 e permanece após reabrir ou atualizar o navegador. Esta versão não oferece autorização de extensões em abas privadas nem atualização automática dos pacotes: remova e instale novamente para atualizar uma extensão.

## Verificação e limites

- Somente IDs e URLs válidos da loja são aceitos; o endereço de download é construído pelo Maré.
- O pacote precisa corresponder ao ID solicitado e possuir assinaturas válidas do desenvolvedor e da chave de publicação da Chrome Web Store.
- O arquivo é verificado antes de ser extraído. Caminhos que saem da pasta, links simbólicos e pacotes acima dos limites são rejeitados.
- Limites: 64 MiB compactados, 256 MiB extraídos e 8.000 entradas.
- O manifesto recebe a chave pública verificada para manter o ID original ao carregar a extensão descompactada. Nenhuma permissão adicional é incluída.

Compatibilidade com o Chrome não significa compatibilidade completa com o WebView2. APIs de navegador, integração com outros programas, login, lojas e interfaces específicas podem não funcionar. O runtime informa falhas de instalação, e o painel não deve apresentar uma extensão recusada como instalada.

Referências: [Extensões no perfil WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2profile7), [opção de ambiente](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environmentoptions6), [formato CRX3](https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/crx3.proto).
