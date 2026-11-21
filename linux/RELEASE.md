Primeira versão **preview do Compass Browser para Ubuntu 24.04 ou mais recente,
Intel/AMD 64 bits**, com Noise Music integrado.

Baixe `compass-browser_0.6.4-1_amd64.deb` e instale:

```sh
sudo apt install ./compass-browser_0.6.4-1_amd64.deb
```

Abra Compass Browser pelo menu de aplicativos. O pacote inclui Chromium e os
componentes nativos do Noise; não é necessário instalar Rust ou WebView2.
Histórico, cookies, logins e biblioteca ficam separados por usuário do Linux.
Entre com a mesma conta do Noise usada no celular para acessar sua biblioteca.

Inclui abas normais e privadas, favoritos, histórico, lista de leitura, downloads
com progresso, proteção de rede, Notas, Calculadora e a interface atual do Noise.

**Limitações desta preview:** sem extensões da Chrome Web Store, sem Widevine
incluído e sem o servidor opcional de pareamento LAN. Atualização pelo novo `.deb`;
não há instalação automática nesta versão Linux. Controle do Noise pela conta é
preservado. Testado em Ubuntu 24.04/Xvfb; Wayland e áudio em hardware real ainda
precisam de validação. As fontes online de música dependem da disponibilidade dos
serviços e da sessão configurada no servidor.

O arquivo `SHA256SUMS` permite conferir a integridade do instalador.
