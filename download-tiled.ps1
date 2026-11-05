$ErrorActionPreference = 'Stop'
$targetDirectory = Join-Path $PSScriptRoot 'downloads'
$targetFile = Join-Path $targetDirectory 'Tiled-1.12.2-Windows-x64.msi'
$temporaryFile = $targetFile + '.powershell.part'
$expectedHash = '11a0e6c97cc105e07a57ea9995f2704617986722de4ab699d286dab0d2becc3f'
if (-not (Test-Path -LiteralPath $targetFile)) {
    Invoke-WebRequest -Uri 'https://github.com/mapeditor/tiled/releases/download/v1.12.2/Tiled-1.12.2_Windows-10%2B_x86_64.msi' -OutFile $temporaryFile -TimeoutSec 90
    $actualHash = (Get-FileHash -LiteralPath $temporaryFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) { throw 'Tiled SHA256 verification failed.' }
    Move-Item -LiteralPath $temporaryFile -Destination $targetFile
}
if ((Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Existing Tiled file differs from the official SHA256.' }
$manifestPath = Join-Path $PSScriptRoot 'download-manifest.json'
if (Test-Path -LiteralPath $manifestPath) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $tiled = $manifest.files | Where-Object name -eq 'Tiled-1.12.2-Windows-x64.msi'
    $tiled.verified = $true
    $tiled | Add-Member -NotePropertyName bytes -NotePropertyValue (Get-Item -LiteralPath $targetFile).Length -Force
    $tiled.PSObject.Properties.Remove('error')
    $manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding utf8
}
Get-Item -LiteralPath $targetFile | Select-Object Name,Length
