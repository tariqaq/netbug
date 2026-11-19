# build.ps1 - builds netbug.exe with the page, font and scripts embedded, plus the known router MACs from
# tools\routers.local.txt (gitignored) when that file exists. The release exe is built with this script.
#   -Out <path>   where to write the exe (default tools\netbug.exe); the assembly is always named netbug
param([string]$Out = (Join-Path $PSScriptRoot 'netbug.exe'))

$ErrorActionPreference = 'Stop'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$Out = [IO.Path]::GetFullPath($Out)
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
Push-Location $PSScriptRoot
try {
    $resources = @(
        '/resource:dashboard.html,netbug.dashboard.html',
        '/resource:fonts\inter.woff2,netbug.inter.woff2',
        '/resource:arpwatch.ps1,netbug.arpwatch.ps1',
        '/resource:snapshot.ps1,netbug.snapshot.ps1')
    if (Test-Path 'routers.local.txt') { $resources += '/resource:routers.local.txt,netbug.routers.txt' }
    else { Write-Warning 'tools\routers.local.txt not found: the Router MAC dropdown will only list the pinned and checked MACs' }
    $refs = @('/r:System.IO.Compression.dll', '/r:System.Management.dll')
    # /out names the file; the assembly name stays netbug whatever the file is called (the updater checks it)
    & $csc /nologo /target:winexe /optimize /out:$Out $refs $resources netbug.cs
    if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
    $name = [Reflection.AssemblyName]::GetAssemblyName($Out)
    if ($name.Name -ne 'netbug') {
        # csc takes the assembly name from the file name: build as netbug.exe in a temp folder, then move it
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ('netbug-build-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory $tmp | Out-Null
        & $csc /nologo /target:winexe /optimize /out:(Join-Path $tmp 'netbug.exe') $refs $resources netbug.cs
        if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
        Move-Item (Join-Path $tmp 'netbug.exe') $Out -Force
        Remove-Item $tmp -Recurse -Force
        $name = [Reflection.AssemblyName]::GetAssemblyName($Out)
    }
    "built $Out : $($name.Name) $($name.Version), routers list " + $(if (Test-Path 'routers.local.txt') { 'embedded' } else { 'not embedded' })
} finally { Pop-Location }
