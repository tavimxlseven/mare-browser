param([switch]$Release)
. "$PSScriptRoot\environment.ps1"
Push-Location $projectRoot
try {
    $arguments = @('build', '--locked')
    if ($Release) { $arguments += '--release' }
    & cargo @arguments
    if ($LASTEXITCODE -ne 0) { throw 'A compilação falhou.' }
    $targetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $projectRoot 'target' }
    $profile = if ($Release) { 'release' } else { 'debug' }
    $buildDirectory = Join-Path $targetRoot $profile
    Copy-WebViewLoader $buildDirectory
    if ($Release) {
        $portable = Join-Path $projectRoot 'dist\Mare'
        New-Item -ItemType Directory -Path $portable -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $buildDirectory 'mare-browser.exe') -Destination (Join-Path $portable 'Mare.exe') -Force
        Copy-WebViewLoader $portable
        Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE'),(Join-Path $projectRoot 'README.md') -Destination $portable -Force
        Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md'),(Join-Path $projectRoot 'THIRD_PARTY_LICENSES.txt') -Destination $portable -Force
        Write-Host "Pronto: $portable\Mare.exe"
    } else { Write-Host "Pronto: $buildDirectory\mare-browser.exe" }
} finally { Pop-Location }
