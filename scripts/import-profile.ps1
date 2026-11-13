param([Parameter(Mandatory=$true)][string]$From)
$ErrorActionPreference = 'Stop'
if (Get-Process Mare,mare-browser -ErrorAction SilentlyContinue) {
    throw 'Feche todas as janelas do Maré antes de importar o perfil.'
}
$sourceProfile = (Resolve-Path -LiteralPath $From).Path
$targetProfile = Join-Path $env:LOCALAPPDATA 'MareBrowser\User Data'
if (-not (Test-Path -LiteralPath (Join-Path $sourceProfile 'state.json'))) {
    throw 'A origem não contém um perfil Maré com state.json.'
}
if (Test-Path -LiteralPath $targetProfile) {
    throw 'O destino já existe. A importação não sobrescreve nem mescla perfis.'
}
if ((Get-Item -LiteralPath $sourceProfile).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'A origem não pode ser um link ou junção.'
}
# A user must explicitly choose their legacy profile; never import another Windows user's data automatically.
if (Get-ChildItem -LiteralPath $sourceProfile -Recurse -Force | Where-Object {
    $_.Attributes -band [IO.FileAttributes]::ReparsePoint
}) { throw 'A origem contém links ou junções; importação cancelada.' }
$stagingProfile = $targetProfile + '.import-' + [Guid]::NewGuid().ToString('N')
New-Item -ItemType Directory -Path $stagingProfile -Force | Out-Null
Get-ChildItem -LiteralPath $sourceProfile -Force | Copy-Item -Destination $stagingProfile -Recurse
[IO.Directory]::Move($stagingProfile, $targetProfile)
Write-Output 'Perfil copiado para o usuário atual. O perfil original foi preservado. Logins protegidos pelo Windows podem exigir nova autenticação.'
