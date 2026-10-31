# snapshot.ps1 - detailed network state dump, launched by netbug.exe when an
# outage starts, lag lasts 5 s, UDP usage gets high, the gateway MAC changes or
# ARP spoofing is seen (at most once per 60 s), so it can afford heavier commands.
# With admin rights a packet capture (ARP + traffic to/from the gateway and 1.1.1.1) starts first
# and runs until every probe is done, so it covers the problem while it is still going on.
# netbug pauses its continuous ARP capture just before and saves its ARP from the 15 min before
# as <name>.ring.txt (-NoCapture: netbug couldn't hand over pktmon, so no capture here).

param([Parameter(Mandatory)][string]$Out, [switch]$NoCapture)

$ErrorActionPreference = 'SilentlyContinue'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
$capture = $isAdmin -and -not $NoCapture
$cfg = Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1
$gw = $cfg.IPv4DefaultGateway.NextHop
$me = @($cfg.IPv4Address.IPAddress)[0]
$etl = [IO.Path]::ChangeExtension($Out, '.etl')
if ($capture) {
    pktmon stop 2>&1 | Out-Null
    pktmon filter remove | Out-Null
    pktmon filter add arp -d ARP | Out-Null
    pktmon filter add gw -i $gw | Out-Null
    pktmon filter add cf -i 1.1.1.1 | Out-Null
    # default file size on purpose: pktmon files with a small --file-size silently lose most frames
    pktmon start --capture --comp nics --pkt-size 128 --file-name $etl | Out-Null
    $capStart = Get-Date
}

& {
    "==== snapshot $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  admin=$isAdmin ===="

    "`n--- adapters ---"
    Get-NetAdapter | Where-Object Status -ne 'Not Present' |
        Format-Table Name, InterfaceDescription, Status, LinkSpeed, MacAddress -AutoSize | Out-String -Width 220

    "`n--- connection profiles (NCSI) ---"
    Get-NetConnectionProfile | Format-Table InterfaceAlias, Name, IPv4Connectivity, IPv6Connectivity -AutoSize | Out-String

    "`n--- ip config ---"
    Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Out-String -Width 220

    "`n--- neighbors (non-unreachable; Permanent only for the gateway = pinned) ---"
    Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.State -ne 'Unreachable' -and ($_.State -ne 'Permanent' -or $_.IPAddress -eq $gw) } |
        Format-Table InterfaceAlias, IPAddress, LinkLayerAddress, State -AutoSize | Out-String

    "`n--- adapter counters (2 reads, 3 s apart) ---"
    $a = Get-NetAdapterStatistics | Where-Object Name -match 'Ethernet|Wi-Fi'
    Start-Sleep 3
    $b = Get-NetAdapterStatistics | Where-Object Name -match 'Ethernet|Wi-Fi'
    foreach ($x in $b) {
        $y = $a | Where-Object Name -eq $x.Name
        "{0}: +tx {1} pkts, +rx {2} pkts, rx_err {3}, rx_disc {4}, tx_err {5}, tx_disc {6}" -f $x.Name,
            ($x.SentUnicastPackets - $y.SentUnicastPackets), ($x.ReceivedUnicastPackets - $y.ReceivedUnicastPackets),
            $x.ReceivedPacketErrors, $x.ReceivedDiscardedPackets, $x.OutboundPacketErrors, $x.OutboundDiscardedPackets
    }

    "`n--- probes ---"
    "gateway $gw"
    # ping.exe, not Test-Connection: -TimeoutSeconds doesn't exist in Windows PowerShell 5.1
    foreach ($t in @($gw, '1.1.1.1', '8.8.8.8')) {
        $r = ping -n 3 -w 1000 $t | Select-String 'Reply from .*time'
        "ping {0}: {1}/3 ok  {2}" -f $t, @($r).Count, (($r | ForEach-Object { ($_ -replace '.*time[=<]', '' -replace ' .*', '') }) -join ' ')
    }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $d = Resolve-DnsName google.com -Server $gw -DnsOnly -QuickTimeout -ErrorAction SilentlyContinue
    "dns via gw: $(if ($d) { 'ok' } else { 'FAIL' }) in $($sw.ElapsedMilliseconds) ms"
    foreach ($h in 'www.google.com', 'discord.com') {
        $r = Test-NetConnection $h -Port 443 -WarningAction SilentlyContinue
        "tcp ${h}:443 -> $($r.TcpTestSucceeded) ($($r.RemoteAddress))"
    }

    "`n--- tracert 1.1.1.1 ---"
    tracert -d -w 700 -h 6 1.1.1.1

    "`n--- UDP endpoints per process ---"
    $udp = Get-NetUDPEndpoint
    "total: $($udp.Count)"
    $udp | Group-Object OwningProcess | Sort-Object Count -Descending | Select-Object -First 10 Count,
        @{ n = 'Proc'; e = { (Get-Process -Id $_.Name).Name } } | Format-Table -AutoSize | Out-String

    "`n--- TCP states ---"
    Get-NetTCPConnection | Group-Object State | Format-Table Count, Name -AutoSize | Out-String

    "`n--- system events, last 3 min ---"
    Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = (Get-Date).AddMinutes(-3) } |
        Where-Object { $_.ProviderName -match 'Tcpip|Dhcp|DNS|rtucx|NDIS|USB|Kernel-PnP|Netwtw|Kernel-Power' } |
        Format-Table @{ n = 't'; e = { $_.TimeCreated.ToString('HH:mm:ss') } }, ProviderName, Id,
            @{ n = 'msg'; e = { ($_.Message -split "`n")[0] } } -AutoSize | Out-String -Width 250

    if ($capture) {
        # keep the capture going a few more seconds after the probes, for at least 15 s in all
        $left = 15 - ((Get-Date) - $capStart).TotalSeconds
        if ($left -gt 0) { Start-Sleep -Seconds ([Math]::Ceiling($left)) }
        pktmon stop | Out-Null
        pktmon filter remove | Out-Null
        "`n--- packet capture: ARP + traffic to/from gateway and 1.1.1.1 (pktmon), $($capStart.ToString('HH:mm:ss'))-$((Get-Date).ToString('HH:mm:ss')) ---"
        $pkt = [IO.Path]::ChangeExtension($Out, '.pkt.txt')
        pktmon etl2txt $etl --out $pkt | Out-Null
        "saved: $etl"
        $ring = [IO.Path]::ChangeExtension($Out, '.ring.txt')
        if (Test-Path $ring) { "ARP from the minutes before (netbug's continuous capture): $ring" }

        # same rules as netbug's ARP watch (arpwatch.ps1): every MAC that claimed the gateway IP or
        # this laptop's IP. This laptop's own MAC claims its own IP with every ARP request it sends.
        $lines = & (Join-Path $PSScriptRoot 'arpwatch.ps1') -Etl $etl -Gw $gw -Me $me -NoDelete
        $own = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).NetAdapter.MacAddress
        "`n--- who claimed to be the gateway $gw in the capture (more than one MAC = ARP spoofing) ---"
        $g = @($lines | Where-Object { $_ -like 'gw *' })
        if ($g.Count) { foreach ($l in $g) { $p = $l -split ' '; "{0}  {1} frame(s), {2}-{3}" -f $p[1], $p[2], $p[3], $p[4] } } else { "nobody (no ARP for the gateway seen)" }
        "`n--- who claimed to be this laptop $me in the capture (any MAC other than $own = someone poisoning the router about this laptop) ---"
        $m = @($lines | Where-Object { $_ -like 'me *' })
        if ($m.Count) { foreach ($l in $m) { $p = $l -split ' '; "{0}  {1} frame(s), {2}-{3}{4}" -f $p[1], $p[2], $p[3], $p[4], $(if ($p[1] -eq $own) { '  (this laptop)' } else { '  <-- NOT this laptop' }) } } else { "nobody (no ARP for this laptop seen)" }
    }
} *> $Out
