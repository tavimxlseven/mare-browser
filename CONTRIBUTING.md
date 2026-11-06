# Contribuir com o Maré

Use uma issue para descrever bugs com passos reproduzíveis, versão do Windows e versão do WebView2. Para mudanças maiores, explique primeiro o problema e o comportamento esperado.

## Desenvolvimento

1. Configure o ambiente descrito no README.
2. Crie uma branch para a alteração.
3. Mantenha o código Rust, a interface e a documentação coerentes.
4. Execute as verificações abaixo e inclua os resultados no pull request.

```powershell
cargo fmt --all --check
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo test --all-targets --locked
```

Teste navegação em sites reais e os fluxos afetados: criação e fechamento de abas, voltar/avançar, downloads, mudança de tamanho, foco de teclado e persistência após reiniciar. Para alterações visuais, inclua uma captura real e informe a resolução e a escala da tela.

## Limites de confiança

A interface interna e páginas remotas devem permanecer separadas. Páginas visitadas não podem receber os comandos privilegiados da interface. Valide URLs, mensagens IPC, caminhos de arquivos e dados lidos do disco antes de usá-los.

Não envie perfis de navegação, cookies, histórico pessoal, tokens, executáveis de terceiros, caches de build ou dumps brutos de ferramentas. Evidências públicas de investigação devem ser pequenas, revisadas, sanitizadas e descrever os limites do que foi observado.

Use recursos visuais originais ou com licença compatível. Não adicione marcas ou assets proprietários da Apple. Contribuições são distribuídas sob a licença MIT do projeto.
