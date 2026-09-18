$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$runtimeNode = (Get-Command node.exe).Source
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (([version](& $runtimeNode -p 'process.versions.node')).Major -lt 22) {
  if (Test-Path -LiteralPath $bundledNode) { $runtimeNode = $bundledNode } else { throw 'Install Node.js 22.12 or later to build. Running the packaged application does not need Node.js.' }
}
$env:PATH = (Split-Path -Parent $runtimeNode) + ';' + $env:PATH
$env:ELECTRON_CACHE = Join-Path $PWD '.cache\electron'
$env:ELECTRON_BUILDER_CACHE = Join-Path $PWD '.cache\electron-builder'
& $runtimeNode node_modules\typescript\bin\tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw 'Type check failed' }
& $runtimeNode node_modules\electron-vite\bin\electron-vite.js build
if ($LASTEXITCODE -ne 0) { throw 'Application build failed' }
& $runtimeNode node_modules\electron-builder\cli.js --win nsis --x64
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }
