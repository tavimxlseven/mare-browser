# Segurança

O Maré está em desenvolvimento e não passou por uma auditoria independente de segurança. As páginas são executadas pelo WebView do sistema; mantenha Windows e WebView2 atualizados.

## Relatar uma vulnerabilidade

Use o recurso privado **Security → Advisories → Report a vulnerability** do repositório, quando estiver habilitado. Não publique cookies, credenciais, histórico, dados de sessão ou detalhes de exploração em uma issue pública.

Se o canal privado ainda não estiver disponível, abra uma issue contendo apenas um pedido de contato privado, sem os detalhes da vulnerabilidade. Não há um endereço de segurança separado publicado neste momento.

Inclua a versão do Maré, do Windows e do WebView2, o impacto e passos mínimos de reprodução com dados fictícios. Relatórios sobre o motor WebView2 também podem exigir encaminhamento ao fornecedor responsável.

## Fronteiras relevantes

- A interface local tem comandos do aplicativo; páginas remotas não devem ter acesso a essa autoridade.
- URLs externas, pop-ups, downloads e qualquer IPC são entradas não confiáveis.
- Histórico, favoritos, sessões e dados do motor permanecem na máquina. A navegação e buscas naturalmente contatam os sites e o mecanismo escolhido.
- Não há infraestrutura de sincronização do Maré ou gerenciamento de senhas próprio.

Nenhuma versão possui promessa de suporte de longo prazo; correções são feitas na branch principal.
