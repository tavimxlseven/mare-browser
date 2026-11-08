param([string]$BinaryDirectory, [string]$Compiler)
. "$PSScriptRoot\environment.ps1"
. "$PSScriptRoot\github-asset.ps1"
if (-not $BinaryDirectory) { $BinaryDirectory=Join-Path $(if($env:CARGO_TARGET_DIR){$env:CARGO_TARGET_DIR}else{Join-Path $projectRoot 'target'}) 'release' }
if (-not $Compiler) { $Compiler=@('D:\DevTools\InnoSetup\ISCC.exe',"${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe","$env:ProgramFiles\Inno Setup 7\ISCC.exe","$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1 }
if (-not $Compiler) { throw 'Compilador Inno Setup não encontrado. O build Windows do GitHub inclui esse compilador.' }
$payload=Join-Path $projectRoot 'dist\InstallerPayload'
$app=Join-Path $payload 'app'
New-Item -ItemType Directory -Force -Path $app | Out-Null
Copy-Item -LiteralPath (Join-Path $BinaryDirectory 'mare-browser.exe') -Destination (Join-Path $app 'Mare.exe') -Force
$loader=Join-Path $BinaryDirectory 'WebView2Loader.dll'
if(Test-Path -LiteralPath $loader){Copy-Item -LiteralPath $loader -Destination $app -Force}
foreach($file in @('LICENSE','README.md','THIRD_PARTY_NOTICES.md','THIRD_PARTY_LICENSES.txt')){Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $app -Force}
$icon=Get-ChildItem -Path (Join-Path $BinaryDirectory 'build\mare-browser-*\out\mare.ico') | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $icon){throw 'Ícone compilado ausente.'};Copy-Item -LiteralPath $icon.FullName -Destination (Join-Path $payload 'mare.ico') -Force
$sunnify=Join-Path $app 'components\sunnify';New-Item -ItemType Directory -Force -Path $sunnify | Out-Null
& "$PSScriptRoot\music-components.ps1" -Destination (Join-Path $app 'components\music')
$exe=Join-Path $sunnify 'Sunnify.exe';$hash='abb16d22cabebf99d82c3eaf8ca60a0b5511dd99eb86b17f16d53d7077fb57ba'
if(-not(Test-Path -LiteralPath $exe)){Save-GitHubReleaseAsset 'sunnypatell/sunnify-spotify-downloader' 'v2.6.0' 'Sunnify-Windows-CLI.exe' $exe}
if((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $hash){throw 'Hash do Sunnify inesperado.'}
Invoke-WebRequest 'https://raw.githubusercontent.com/sunnypatell/sunnify-spotify-downloader/v2.6.0/LICENSE' -OutFile (Join-Path $sunnify 'LICENSE.txt')
$bootstrap=Join-Path $payload 'MicrosoftEdgeWebview2Setup.exe'
Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrap
$signature=Get-AuthenticodeSignature -LiteralPath $bootstrap
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'Assinatura do instalador WebView2 inválida.'}
$version=(Get-Content (Join-Path $projectRoot 'Cargo.toml') | Select-String '^version = "([^"]+)"' | Select-Object -First 1).Matches.Groups[1].Value
& $Compiler "/DMareVersion=$version" "/DPayload=$payload" (Join-Path $projectRoot 'installer\mare.iss')
if($LASTEXITCODE -ne 0){throw 'O instalador não foi compilado.'}
$output=Join-Path $projectRoot "dist\Release\Mare-Setup-$version-x64.exe"
$sum=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
"$sum  $([IO.Path]::GetFileName($output))" | Set-Content -Encoding ascii (Join-Path (Split-Path -Parent $output) 'SHA256SUMS.txt')
Write-Host "Instalador: $output"

Copy-Item -LiteralPath (Join-Path $projectRoot "docs\MUSIC-SOURCES.txt") -Destination (Join-Path (Split-Path -Parent $output) "MUSIC-SOURCES.txt") -Force
