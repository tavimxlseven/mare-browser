param([string]$Destination = (Join-Path $PSScriptRoot '..\dist\Mare\components\music'))
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\environment.ps1"
$Destination=[IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$downloader=Join-Path $Destination 'yt-dlp.exe'
if(-not(Test-Path -LiteralPath $downloader) -or (Get-FileHash -LiteralPath $downloader -Algorithm SHA256).Hash -ne 'F5389D3698ECDE4EF06F4E6B1CE0294FE9AC1396228C8990B8D3416D6D177A7D'){
  Invoke-WebRequest 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe' -OutFile $downloader
}
if((Get-FileHash -LiteralPath $downloader -Algorithm SHA256).Hash -ne 'F5389D3698ECDE4EF06F4E6B1CE0294FE9AC1396228C8990B8D3416D6D177A7D'){throw 'Hash inesperado do componente de busca.'}
$deno=Join-Path $Destination 'deno.exe'
if(-not(Test-Path -LiteralPath $deno) -or (Get-FileHash -LiteralPath $deno -Algorithm SHA256).Hash -ne '924397800533D3EB0ED0C889B20AD70E18B970D93ACD8135BC043F425E528266'){
  $archive=Join-Path ([IO.Path]::GetTempPath()) "mare-deno-v2.9.8-$PID.zip"
  try{
    Invoke-WebRequest 'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip' -OutFile $archive
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne 'CBA84B26E0DF5AE7F74FC66B86A95B866872A86292EBD84FA1E959927EDD93BF'){throw 'Hash inesperado do runtime de busca.'}
    Expand-Archive -LiteralPath $archive -DestinationPath $Destination -Force
  }finally{if(Test-Path -LiteralPath $archive){Remove-Item -LiteralPath $archive -Force}}
}
if((Get-FileHash -LiteralPath $deno -Algorithm SHA256).Hash -ne '924397800533D3EB0ED0C889B20AD70E18B970D93ACD8135BC043F425E528266'){throw 'Executável Deno inesperado.'}
Invoke-WebRequest 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.26/LICENSE' -OutFile (Join-Path $Destination 'yt-dlp-LICENSE.txt')
Invoke-WebRequest 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.26/THIRD_PARTY_LICENSES.txt' -OutFile (Join-Path $Destination 'yt-dlp-THIRD-PARTY-LICENSES.txt')
Invoke-WebRequest 'https://raw.githubusercontent.com/denoland/deno/v2.9.8/LICENSE.md' -OutFile (Join-Path $Destination 'deno-LICENSE.txt')
Write-Host 'Componentes de busca preparados; nenhum aplicativo foi instalado no sistema.'

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "..\docs\MUSIC-SOURCES.txt") -Destination (Join-Path $Destination "SOURCE-CODE.txt") -Force
