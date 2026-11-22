# arpwatch.ps1 - reads a pktmon capture file and prints who claimed the gateway IP and this laptop's IP.
# Used by snapshot.ps1 on its own capture. (netbug's continuous ARP watch applies the same rules in
# netbug.cs, Analyze.) pktmon captures at the NIC driver, so it also sees spoofed replies that Windows
# ignores because the gateway's ARP entry is pinned.
#   -Etl <file>   the capture; deleted afterwards unless -NoDelete
# Output, one line each:
#   frames <n>                         ARP frames in the capture
#   gw <mac> <n> <first> <last>        a MAC that claimed the gateway IP -Gw: an ARP reply
#                                      "<gw> is-at <mac>" or an ARP request sent from the gateway IP
#   me <mac> <n> <first> <last>        a MAC that claimed this laptop's IP -Me, the same way. This
#                                      laptop's own MAC shows up here too: its own ARP requests.

param(
    [Parameter(Mandatory)][string]$Etl,
    [string]$Gw,
    [string]$Me,
    [switch]$NoDelete
)

$ErrorActionPreference = 'SilentlyContinue'

function Read-Capture([string]$file) {
    if (-not (Test-Path $file)) { 'frames 0'; return }
    $txt = "$file.txt"
    pktmon etl2txt $file --out $txt | Out-Null
    if (-not (Test-Path $txt)) {
        if (-not $NoDelete) { Remove-Item $file -Force }
        'frames 0'; return
    }
    $mac = '((?:[0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2})'
    $rules = @()
    foreach ($kv in @(@('gw', $Gw), @('me', $Me))) {
        if (-not $kv[1]) { continue }
        $ip = [regex]::Escape($kv[1])
        $rules += , @($kv[0], [regex]"Reply $ip is-at $mac", [regex]"^\s*$mac > .*Request who-has \S+ (?:\(\S+\) )?tell $ip,")
    }
    $claims = @{}
    $frames = 0; $prev = ''; $time = ''; $sec = 0.0; $prevSec = -1.0
    try {
        foreach ($line in [IO.File]::ReadLines($txt)) {
            # header lines ("[cpu]...::2026-11-01 02:35:31.450248500 [Microsoft-Windows-PktMon] ...") carry the time
            if (-not $line.StartsWith("`t")) {
                if ($line -match '::\d{4}-\d\d-\d\d ((\d\d):(\d\d):(\d\d\.\d+))') {
                    $time = $Matches[1].Substring(0, [Math]::Min(12, $Matches[1].Length))
                    $sec = [int]$Matches[2] * 3600 + [int]$Matches[3] * 60 + [double]::Parse($Matches[4], [Globalization.CultureInfo]::InvariantCulture)
                }
                continue
            }
            # pktmon logs each frame at two driver components, microseconds apart: skip a frame line equal
            # to the last one within 5 ms (handles midnight wrap; repeated requests further apart still count)
            $diff = [Math]::Abs($sec - $prevSec)
            if ($diff -gt 43200) { $diff = 86400 - $diff }
            if ($line -eq $prev -and $diff -lt 0.005) { continue }
            $prev = $line; $prevSec = $sec
            if ($line -notmatch 'ARP') { continue }
            $frames++
            foreach ($r in $rules) {
                $m = $r[1].Match($line); if (-not $m.Success) { $m = $r[2].Match($line) }
                if ($m.Success) {
                    $k = $r[0] + ' ' + $m.Groups[1].Value.ToUpper()
                    $t = $time.Substring(0, [Math]::Min(8, $time.Length))
                    if ($claims.ContainsKey($k)) { $claims[$k][0]++; $claims[$k][2] = $t } else { $claims[$k] = @(1, $t, $t) }
                }
            }
        }
    } finally {
        if (Test-Path $txt) { Remove-Item $txt -Force }
        if (-not $NoDelete -and (Test-Path $file)) { Remove-Item $file -Force }
    }
    "frames $frames"
    foreach ($k in $claims.Keys) { '{0} {1} {2} {3}' -f $k, $claims[$k][0], $claims[$k][1], $claims[$k][2] }
}

Read-Capture $Etl
