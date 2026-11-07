# Controle do player pelo celular

O controle remoto do Maré funciona na mesma rede Wi-Fi IPv4 privada. A música continua sendo reproduzida no PC; o celular controla a reprodução pelo navegador, sem instalar outro app.

## Conectar

1. Abra o app de música no Maré e entre em **Configurações de música**.
2. Em **Controlar pelo celular**, clique em **Ativar na Wi-Fi**.
3. Abra no navegador do celular um dos endereços locais mostrados. Escolha o endereço da rede Wi-Fi se o PC também tiver VPN ou adaptadores virtuais.
4. Digite o código de oito dígitos exibido no Maré. O código vale por cinco minutos; **Renovar código** gera outro.

O painel oferece reproduzir/pausar, anterior/próxima, posição e volume. Anterior/próxima seguem a fila do app, inclusive sua ordem aleatória. Título, artista, capa e posição vêm do estado real do player. O painel não toca áudio no celular.

**Desconectar este celular** revoga sua sessão. **Desativar controle**, fechar a aba do app ou sair do Maré encerra o servidor. O recurso não é ligado automaticamente ao reabrir o navegador; endereço/porta e pareamento podem mudar entre execuções.

## Rede e permissões

- PC e celular precisam alcançar um ao outro na mesma rede. Redes de convidados podem isolar os dispositivos.
- O Windows pode solicitar autorização de rede para o Maré. O programa não altera o firewall automaticamente; uma regra bloqueada pode impedir o acesso.
- Não é um serviço de controle pela internet. Não configura encaminhamento de portas, túneis, UPnP ou acesso em nuvem. Só aceita conexões IPv4 locais/privadas e nomes de host IP compatíveis.
- A conexão local usa **HTTP, sem TLS**. Use uma Wi-Fi confiável. A sessão depende de código temporário e token de acesso; ela não deve ser compartilhada com outras pessoas.

## Dados e limites

O endpoint de estado expõe somente informações do player e da faixa atual. Não oferece arquivos de áudio, biblioteca completa, caminhos do disco, abas do navegador, credenciais ou cookies. Os comandos aceitos são limitados ao player; não há execução de comandos, downloads ou remoção de arquivos pelo celular.

O código expira em cinco minutos. Há limite de tentativas e até quatro sessões por execução; cada sessão dura no máximo oito horas. Tokens ficam na memória do servidor e na sessão da aba do celular, não no perfil persistente do Maré. A página não usa scripts externos, analytics ou fontes remotas; capas podem ser carregadas das CDNs permitidas.

O listener roda em uma thread sob demanda e usa estado em cache, com atualização limitada. Parar o controle não aguarda uma conexão HTTP lenta na thread da interface. O consumo em uma chamada ou rede específica deve ser medido; não há benchmark comparativo divulgado.

## Verificação realizada

Testes TCP em loopback cobrem pareamento, expiração, limites, origem externa, autenticação, comandos inválidos, remoção de sessão e ausência de dados de perfil na resposta. O painel foi exercitado em DOM isolado, sem renderização de navegador ou celular físico. Essa validação não substitui testes no aparelho e na configuração de Wi-Fi/firewall do usuário.
