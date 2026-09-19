$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$compiler = if ($env:VM_CXX) { $env:VM_CXX } elseif (Test-Path 'D:\CLion 2021.3.4\bin\mingw\bin\g++.exe') { 'D:\CLion 2021.3.4\bin\mingw\bin\g++.exe' } else { (Get-Command g++.exe).Source }
$env:PATH = (Split-Path -Parent $compiler) + ';' + $env:PATH
$ffmpegFolder = Get-ChildItem native\vendor -Directory | Where-Object Name -Like 'ffmpeg-*' | Select-Object -First 1
if (!$ffmpegFolder) {
  Expand-Archive -LiteralPath native\vendor\ffmpeg.zip -DestinationPath native\vendor
  $ffmpegFolder = Get-ChildItem native\vendor -Directory | Where-Object Name -Like 'ffmpeg-*' | Select-Object -First 1
}
New-Item -ItemType Directory -Force native\bin | Out-Null
& $compiler -std=c++17 -O2 -static-libgcc -static-libstdc++ native\player-host\main.cpp -o native\bin\vm-player-host.exe -luser32 -lgdi32
if ($LASTEXITCODE -ne 0) { throw 'vm-player-host compilation failed' }
& $compiler -std=c++17 -O2 -static-libgcc -static-libstdc++ native\filesystem\main.cpp -o native\bin\vm-fs.exe -lbcrypt
if ($LASTEXITCODE -ne 0) { throw 'vm-fs compilation failed' }
& $compiler -std=c++17 -O2 -static-libgcc -static-libstdc++ native\media\main.cpp -I "$($ffmpegFolder.FullName)\include" -L "$($ffmpegFolder.FullName)\lib" -o native\bin\vm-media.exe -lavformat -lavcodec -lavutil -lswscale
if ($LASTEXITCODE -ne 0) { throw 'vm-media compilation failed' }
Copy-Item -Path "$($ffmpegFolder.FullName)\bin\*.dll" -Destination native\bin
Copy-Item -LiteralPath native\vendor\manifest.json -Destination native\bin\ffmpeg-manifest.json
Get-ChildItem -LiteralPath $ffmpegFolder.FullName -Filter 'LICENSE*' | Copy-Item -Destination native\bin
$runtimeDir = Split-Path -Parent $compiler
Get-ChildItem -LiteralPath $runtimeDir -Filter 'libwinpthread-1.dll' | Copy-Item -Destination native\bin
Write-Output 'Native components built.'
