$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath 'D:\DevTools\cargo\bin\cargo.exe') {
    $env:CARGO_HOME = 'D:\DevTools\cargo'
    $env:RUSTUP_HOME = 'D:\DevTools\rustup'
    $env:CARGO_TARGET_DIR = 'D:\DevCache\mare-target'
    $env:PATH = 'D:\DevTools\cargo\bin;' + $env:PATH
    if (Test-Path -LiteralPath 'D:\DevTools\mingw\mingw64\bin') {
        $env:PATH = 'D:\DevTools\mingw\mingw64\bin;' + $env:PATH
    }
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'Instale Rust (rustup.rs) e as ferramentas C++ do Windows, ou configure cargo no PATH.'
}
if (Test-Path -LiteralPath 'D:\DevCache') {
    $env:TEMP = 'D:\DevCache'
    $env:TMP = 'D:\DevCache'
}

function Copy-WebViewLoader([string]$Destination) {
    if ((rustc -vV | Select-String 'host:').ToString() -notmatch 'windows-gnu') { return }
    $cargoDirectory = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE '.cargo' }
    $loader = Get-ChildItem -Path "$cargoDirectory\registry\src\*\webview2-com-sys-*\x64\WebView2Loader.dll" -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1
    if (-not $loader) { throw 'WebView2Loader.dll ausente. Execute cargo fetch e tente novamente.' }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -LiteralPath $loader.FullName -Destination $Destination -Force
}
