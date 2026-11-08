# Public upstream assets only. Callers verify their pinned SHA-256 after download.
function Save-GitHubReleaseAsset {
    param(
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][string]$Tag,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Destination
    )
    if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' -or $Name -match '[/\\]') {
        throw 'Identificação de componente inválida.'
    }
    $tagPath = [Uri]::EscapeDataString($Tag)
    $namePath = [Uri]::EscapeDataString($Name)
    try {
        Invoke-WebRequest "https://github.com/$Repository/releases/download/$tagPath/$namePath" -OutFile $Destination -TimeoutSec 180 -MaximumRetryCount 2 -RetryIntervalSec 2 -ErrorAction Stop
    } catch {
        Write-Host "Repetindo transferência de $Name pela API pública do GitHub."
        $headers = @{Accept='application/vnd.github+json'; 'User-Agent'='Mare-Release-Build'}
        $release = Invoke-RestMethod "https://api.github.com/repos/$Repository/releases/tags/$tagPath" -Headers $headers -TimeoutSec 30 -MaximumRetryCount 2 -RetryIntervalSec 2
        $assets = @($release.assets | Where-Object name -CEQ $Name)
        if ($assets.Count -ne 1 -or $assets[0].id -notmatch '^\d+$') { throw 'Componente ausente na release original.' }
        $headers.Accept = 'application/octet-stream'
        Invoke-WebRequest "https://api.github.com/repos/$Repository/releases/assets/$($assets[0].id)" -Headers $headers -OutFile $Destination -TimeoutSec 180 -MaximumRetryCount 3 -RetryIntervalSec 2
    }
}
