# Discord dentro do Maré

A partir da 0.3.3, o item Discord da loja abre **https://discord.com/app** em uma aba do próprio navegador. A tela e o login pertencem ao Discord. Não é necessário copiar token, iniciar larperCord ou instalar outro cliente para usar essa aba.

## Uso e sessão

Abra Discord na loja e entre normalmente, inclusive por QR Code quando oferecido. Abrir novamente o item reutiliza a aba existente. Fechar a aba encerra sua página; o perfil público do WebView2 mantém os dados de sessão entre reinícios e atualizações. Uma sessão expirada ou revogada pelo serviço pode exigir novo login.

A integração não lê tokens de outros clientes nem migra credenciais do larperCord. Os dados antigos são preservados. O login Spotify continua adiado e não interfere no Discord.

## Recursos e permissões

Mensagens, servidores e os demais recursos são os fornecidos pelo cliente web oficial. Câmera, microfone, notificações e leitura da área de transferência exigem uma escolha explícita no Maré. Verifique a origem mostrada no pedido. A opção de lembrar salva a decisão no perfil WebView2. O Windows também pode exigir permissões próprias de câmera/microfone.

Chamadas, compartilhamento de tela, atalhos globais e notificações dependem do suporte do Discord web e do WebView2; não há promessa de paridade com todas as integrações do cliente desktop. O Maré não injeta um cliente alternativo nem modifica a autenticação do serviço. Login e chamadas com conta real ainda precisam de validação manual.

## Rich Presence da música

O cliente web não disponibiliza o servidor IPC local do Discord desktop. Para publicar a atividade do player Maré, mantenha o Discord desktop aberto e habilite o compartilhamento de atividades. Todos usam o Application ID público do Maré; não é necessário criar bot nem informar um ID próprio. Veja [configuração](INTEGRATIONS.md).

## Consumo

A aba compartilha o runtime WebView2 do navegador e não inicia Electron, Zig ou um worker Discord separado. Isso evita um segundo runtime de cliente; o consumo real ainda depende dos servidores, chamadas e conteúdo abertos. Consulte o botão de performance do Maré para os valores da sessão. Não foi feito benchmark comparativo.
