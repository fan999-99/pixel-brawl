$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$bootstrapNode = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $bootstrapNode (Join-Path $taskRoot 'prepare-downloads.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Official download preparation failed.' }

$toolsDirectory = Join-Path $taskRoot 'tools'
New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
$nodeDirectory = Join-Path $toolsDirectory 'node-v24.22.1-win-x64'
if (-not (Test-Path -LiteralPath $nodeDirectory)) {
    Expand-Archive -LiteralPath (Join-Path $taskRoot 'downloads\node-v24.22.1-win-x64.zip') -DestinationPath $toolsDirectory
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
