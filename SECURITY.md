# Segurança

O Maré está em desenvolvimento e não passou por uma auditoria independente de segurança. As páginas são executadas pelo WebView do sistema; mantenha Windows e WebView2 atualizados.

## Relatar uma vulnerabilidade

Use o [relato privado de vulnerabilidade](https://github.com/tavimxlseven/mare-browser/security/advisories/new). O canal está habilitado no repositório. Não publique cookies, credenciais, histórico, dados de sessão ou detalhes de exploração em uma issue pública.

Inclua a versão do Maré, do Windows e do WebView2, o impacto e passos mínimos de reprodução com dados fictícios. Relatórios sobre o motor WebView2 também podem exigir encaminhamento ao fornecedor responsável.

## Fronteiras relevantes

- A interface local tem comandos do aplicativo; páginas remotas não devem ter acesso a essa autoridade.
- URLs externas, pop-ups, downloads e qualquer IPC são entradas não confiáveis.
- Histórico, favoritos, sessões e dados do motor permanecem na máquina. A navegação e buscas naturalmente contatam os sites e o mecanismo escolhido.
- Não há infraestrutura de sincronização do Maré ou gerenciamento de senhas próprio.
- O catálogo atual só executa workers embutidos e permitidos pelo host. Um worker separado tem as permissões do usuário do Windows; não constitui uma sandbox para código de terceiros.
- Filtros de anúncios e rastreadores não substituem as proteções de segurança do motor de navegação.

Nenhuma versão possui promessa de suporte de longo prazo; correções são feitas na branch principal.
