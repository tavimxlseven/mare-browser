param([switch]$Release)
. "$PSScriptRoot\environment.ps1"
& "$PSScriptRoot\build.ps1" -Release:$Release
$targetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $projectRoot 'target' }
$profile = if ($Release) { 'release' } else { 'debug' }
Start-Process -FilePath (Join-Path $targetRoot "$profile\mare-browser.exe") -WorkingDirectory $projectRoot
