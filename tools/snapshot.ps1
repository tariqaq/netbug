# snapshot.ps1 - detailed network state dump, launched by netbug.exe when an
# outage starts, lag lasts 5 s, UDP usage gets high, the gateway MAC changes or
# arpwatch sees ARP spoofing (at most once per 60 s), so it can afford heavier commands.

param([Parameter(Mandatory)][string]$Out)

$ErrorActionPreference = 'SilentlyContinue'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

& {
    "==== snapshot $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  admin=$isAdmin ===="

    "`n--- adapters ---"
    Get-NetAdapter | Where-Object Status -ne 'Not Present' |
        Format-Table Name, InterfaceDescription, Status, LinkSpeed, MacAddress -AutoSize | Out-String -Width 220

    "`n--- connection profiles (NCSI) ---"
    Get-NetConnectionProfile | Format-Table InterfaceAlias, Name, IPv4Connectivity, IPv6Connectivity -AutoSize | Out-String

    "`n--- ip config ---"
    Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Out-String -Width 220

    $gw = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1).IPv4DefaultGateway.NextHop

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
    foreach ($t in @($gw, '1.1.1.1', '8.8.8.8', '180.74.19.193')) {
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

    if ($isAdmin) {
        "`n--- 15 s packet capture: ARP + traffic to/from gateway and 1.1.1.1 (pktmon) ---"
        $etl = [IO.Path]::ChangeExtension($Out, '.etl')
        pktmon stop 2>&1 | Out-Null
        pktmon filter remove | Out-Null
        pktmon filter add arp -d ARP | Out-Null
        pktmon filter add gw -i $gw | Out-Null
        pktmon filter add cf -i 1.1.1.1 | Out-Null
        pktmon start --capture --comp nics --pkt-size 128 --file-name $etl | Out-Null
        Start-Sleep 1
        1..5 | ForEach-Object { ping -n 1 -w 500 1.1.1.1 | Out-Null; ping -n 1 -w 500 $gw | Out-Null; Start-Sleep 2 }
        pktmon stop | Out-Null
        pktmon filter remove | Out-Null
        $pkt = [IO.Path]::ChangeExtension($Out, '.pkt.txt')
        pktmon etl2txt $etl --out $pkt | Out-Null
        "saved: $etl"

        # same rule as arpwatch.ps1: every MAC that claimed the gateway IP (frames are logged twice)
        "`n--- who claimed to be the gateway $gw in the capture (more than one MAC = ARP spoofing) ---"
        $gwRe = [regex]::Escape($gw); $claims = @{}; $prev = ''
        foreach ($line in [IO.File]::ReadLines($pkt)) {
            if (-not $line.StartsWith("`t") -or $line -eq $prev) { continue }
            $prev = $line; $mac = $null
            if ($line -match "Reply $gwRe is-at ((?:[0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2})") { $mac = $Matches[1] }
            elseif ($line -match "^\s*((?:[0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2}) > .*Request who-has \S+ (?:\(\S+\) )?tell $gwRe,") { $mac = $Matches[1] }
            if ($mac) { $claims[$mac.ToUpper()]++ }
        }
        if ($claims.Count) { foreach ($k in $claims.Keys) { "{0}  {1} frame(s)" -f $k, $claims[$k] } } else { "nobody (no ARP for the gateway seen)" }
    }
} *> $Out
