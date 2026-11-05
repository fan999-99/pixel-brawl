$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$downloadsDirectory = Join-Path $taskRoot 'downloads'
$zipName = 'node-v24.22.1-win-x64.zip'
$zipFile = Join-Path $downloadsDirectory $zipName
$checksumFile = Join-Path $downloadsDirectory 'Node-SHASUMS256.txt'
$checksumLine = Get-Content -LiteralPath $checksumFile | Where-Object { $_ -match ('\s+' + [regex]::Escape($zipName) + '$') }
if (-not $checksumLine) { throw 'Official Node SHA256 is missing.' }
$expectedHash = ($checksumLine -split '\s+')[0].ToLowerInvariant()
if (-not (Test-Path -LiteralPath $zipFile)) {
    Write-Output 'Downloading the official portable Node.js archive.'
    Invoke-WebRequest -Uri ('https://nodejs.org/dist/v24.22.1/' + $zipName) -OutFile ($zipFile + '.powershell.part') -TimeoutSec 180
    if ((Get-FileHash -LiteralPath ($zipFile + '.powershell.part') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Node SHA256 verification failed.' }
    Move-Item -LiteralPath ($zipFile + '.powershell.part') -Destination $zipFile
}
if ((Get-FileHash -LiteralPath $zipFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Existing Node archive differs from the official SHA256.' }
Write-Output 'Portable Node.js archive verified.'
& (Join-Path $taskRoot 'download-tiled.ps1')

$manifestPath = Join-Path $taskRoot 'download-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$nodeRecord = $manifest.files | Where-Object name -eq $zipName
$nodeRecord.verified = $true
$nodeRecord | Add-Member -NotePropertyName bytes -NotePropertyValue (Get-Item -LiteralPath $zipFile).Length -Force
$nodeRecord.PSObject.Properties.Remove('error')
$manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding utf8

$toolsDirectory = Join-Path $taskRoot 'tools'
New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
$nodeDirectory = Join-Path $toolsDirectory 'node-v24.22.1-win-x64'
if (-not (Test-Path -LiteralPath $nodeDirectory)) {
    Expand-Archive -LiteralPath $zipFile -DestinationPath $toolsDirectory
}
$nodeExecutable = Join-Path $nodeDirectory 'node.exe'
$npmEntry = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
$previousPath = $env:PATH
try {
    $env:PATH = $nodeDirectory + ';' + $previousPath
    Push-Location (Join-Path $taskRoot 'project')
    try {
        & $nodeExecutable $npmEntry install --ignore-scripts --no-fund --no-audit --cache (Join-Path $taskRoot '.npm-cache')
        if ($LASTEXITCODE -ne 0) { throw 'Project dependency download failed.' }
        & $nodeExecutable (Join-Path $taskRoot 'verify-tools.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Downloaded tool verification failed.' }
    } finally { Pop-Location }
} finally { $env:PATH = $previousPath }
