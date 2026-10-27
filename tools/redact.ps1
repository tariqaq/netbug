# redact.ps1 - regenerate REDACTED_<name>.md for every gitignored .md in the repo root.
# The copy is identical to the original except that PII is replaced with "xxx":
#   - every MAC address (aa-bb-cc-dd-ee-ff / aa:bb:...) -> xx-xx-xx-xx-xx-xx
#   - every literal string listed in redact.local.txt (gitignored), longest first
# Fails if any PII is still present in an output file.
#
# Usage: pwsh -File tools/redact.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$listFile = Join-Path $root 'redact.local.txt'
if (-not (Test-Path $listFile)) { throw "missing $listFile" }

$terms = [IO.File]::ReadAllLines($listFile, [Text.Encoding]::UTF8) |
    Where-Object { $_.Trim() -and -not $_.StartsWith('#') } |
    Sort-Object Length -Descending
$macRegex = '(?i)\b[0-9a-f]{2}([-:])(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}\b'
$utf8 = New-Object Text.UTF8Encoding($false)

Push-Location $root
try {
    $sources = Get-ChildItem -File -Filter *.md |
        Where-Object { $_.Name -notlike 'REDACTED_*' } |
        Where-Object { git check-ignore -q $_.Name; $LASTEXITCODE -eq 0 }

    foreach ($src in $sources) {
        $text = [IO.File]::ReadAllText($src.FullName, $utf8)
        $text = [regex]::Replace($text, $macRegex, { param($m) "xx$($m.Groups[1].Value)xx$($m.Groups[1].Value)xx$($m.Groups[1].Value)xx$($m.Groups[1].Value)xx$($m.Groups[1].Value)xx" })
        foreach ($t in $terms) { $text = $text.Replace($t, 'xxx') }

        $leaks = @($terms | Where-Object { $text.Contains($_) })
        if ([regex]::IsMatch($text, $macRegex)) { $leaks += 'MAC address' }
        if ($leaks) { throw "PII still present in redacted $($src.Name): $($leaks -join ', ')" }

        $out = Join-Path $root ('REDACTED_' + $src.Name)
        [IO.File]::WriteAllText($out, $text, $utf8)
        "wrote REDACTED_$($src.Name)"
    }
}
finally { Pop-Location }
