# arpwatch.ps1 - launched by netbug.exe every 5 min. Captures 10 s of ARP on the NICs with
# pktmon (needs admin) and prints "<mac> <count>" for every MAC that claimed the gateway IP,
# either as an ARP reply ("<gw> is-at <mac>") or as an ARP request sent from the gateway IP.
# netbug compares the MACs with the known gateway MAC. pktmon captures at the NIC driver, so it
# also sees spoofed replies that Windows ignores because the gateway's ARP entry is pinned.

param(
    [Parameter(Mandatory)][string]$Gw,
    [Parameter(Mandatory)][string]$Work   # path prefix for the temporary .etl/.txt, deleted afterwards
)

$ErrorActionPreference = 'SilentlyContinue'
$etl = "$Work.etl"; $txt = "$Work.txt"

pktmon stop 2>&1 | Out-Null
pktmon filter remove | Out-Null
pktmon filter add arp -d ARP | Out-Null
pktmon start --capture --comp nics --pkt-size 64 --file-name $etl | Out-Null
Start-Sleep 10
pktmon stop | Out-Null
pktmon filter remove | Out-Null
pktmon etl2txt $etl --out $txt | Out-Null

$gwRe = [regex]::Escape($Gw)
$claims = @{}
# pktmon logs each frame at two driver components, so every frame shows up twice in a row
# (header line, frame line, header line, same frame line): skip a frame line equal to the last one
$prev = ''
foreach ($line in [IO.File]::ReadLines($txt)) {
    if (-not $line.StartsWith("`t")) { continue }   # header lines start with "[cpu]"
    if ($line -eq $prev) { continue }
    $prev = $line
    $mac = $null
    if ($line -match "Reply $gwRe is-at ((?:[0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2})") { $mac = $Matches[1] }
    elseif ($line -match "^\s*((?:[0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2}) > .*Request who-has \S+ (?:\(\S+\) )?tell $gwRe,") { $mac = $Matches[1] }
    if ($mac) { $claims[$mac.ToUpper()]++ }
}
Remove-Item $etl, $txt -Force

foreach ($k in $claims.Keys) { "$k $($claims[$k])" }
