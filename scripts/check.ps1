. "$PSScriptRoot\environment.ps1"
Push-Location $projectRoot
try {
    cargo fmt --all --check
    if ($LASTEXITCODE -ne 0) { throw 'Formatação inválida.' }
    cargo clippy --all-targets --locked -- -D warnings
    if ($LASTEXITCODE -ne 0) { throw 'Clippy encontrou problemas.' }
    cargo test --all-targets --locked --no-run
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar os testes.' }
    $targetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $projectRoot 'target' }
    Copy-WebViewLoader (Join-Path $targetRoot 'debug\deps')
    cargo test --all-targets --locked
    if ($LASTEXITCODE -ne 0) { throw 'Os testes falharam.' }
    node --check ui/app.js
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript inválido.' }
    node --check src/reader.js
    if ($LASTEXITCODE -ne 0) { throw 'Código do leitor inválido.' }
    node --check scripts/smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Script de integração inválido.' }
    node --check scripts/platform-smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Script da plataforma inválido.' }
    node --check scripts/worker-smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Script dos workers inválido.' }
} finally { Pop-Location }
