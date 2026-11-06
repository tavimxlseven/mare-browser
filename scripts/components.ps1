param([string]$Destination = (Join-Path $PSScriptRoot '..\dist\Mare\components'))
$ErrorActionPreference = 'Stop'
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$assets = @(
    @{Name='sunnify\Sunnify.exe'; Url='https://github.com/sunnypatell/sunnify-spotify-downloader/releases/download/v2.6.0/Sunnify-Windows-CLI.exe'; Hash='abb16d22cabebf99d82c3eaf8ca60a0b5511dd99eb86b17f16d53d7077fb57ba'}
)
foreach ($asset in $assets) {
    $path = Join-Path $Destination $asset.Name
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    if (-not (Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $asset.Hash) {
        Invoke-WebRequest -Uri $asset.Url -OutFile ($path + '.download')
        if ((Get-FileHash -LiteralPath ($path + '.download') -Algorithm SHA256).Hash -ne $asset.Hash) { throw 'Componente recebido com hash inesperado.' }
        Move-Item -LiteralPath ($path + '.download') -Destination $path -Force
    }
    if ($path.EndsWith('.zip')) { Expand-Archive -LiteralPath $path -DestinationPath (Split-Path -Parent $path) -Force }
}
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/sunnypatell/sunnify-spotify-downloader/v2.6.0/LICENSE' -OutFile (Join-Path $Destination 'sunnify\LICENSE.txt')
& "$PSScriptRoot\music-components.ps1" -Destination (Join-Path $Destination 'music')
Write-Host 'Componentes de música preparados; Discord usa o site oficial dentro do Maré.'
