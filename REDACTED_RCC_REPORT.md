# Report for the hostel RCC: ARP spoofing on the hostel LAN

**From:** resident (diagnosing intermittent "connected, no internet" drops with the RCC's permission)
**Date of incident:** Wednesday 2026-10-28, 05:34:03 – at least 05:36:35 (MYT)
**Network:** hostel wired LAN `10.255.16.0/20`, gateway `10.255.31.254` (MikroTik, MAC `xx-xx-xx-xx-xx-xx`)

---

## What happened, in one paragraph

At 05:34:03 a device on the hostel LAN began sending ARP replies saying **"10.255.31.254 is at `xx-xx-xx-xx-xx-xx`"**. In other words, it pretended to be the hostel router. My laptop believed it and sent all its internet traffic to that device, which **dropped all of it**. I had no internet for 150 seconds until I unplugged. At the same time, at least two other devices on the LAN (`10.255.23.47` and `10.255.22.125`) were repeatedly broadcasting "who has 10.255.31.254?", so they had lost the router too. This is **ARP spoofing**, the technique used by tools such as NetCut, WiFiKill, arpspoof and Bettercap to cut other users off or slow them down. It matches the "everyone's internet dies for a few minutes, then comes back" complaints in the hostel.

## The device to look for

| | |
|---|---|
| **MAC address** | **`xx-xx-xx-xx-xx-xx`** (randomized / locally administered: typical of a phone or laptop with MAC randomization, or a spoofing tool) |
| **IP address** | **`10.255.18.145`** (the same MAC, seen in my laptop's ARP table) |
| **Seen active** | 2026-10-28 05:34:03 – 05:36:35 MYT (I left the LAN at 05:36:35, so it may have run longer) |
| **Behaviour** | sends unicast ARP replies claiming the gateway IP `10.255.31.254`; forwards nothing (blackholes victims) |

## Evidence (logs available on request)

All captured automatically by a monitoring tool on my laptop (packet capture taken with Windows' built-in `pktmon`):

1. **Gateway MAC changed** from the MikroTik's `xx-xx-xx-xx-xx-xx` to `xx-xx-xx-xx-xx-xx` at 05:34:03. Pings to the gateway, 1.1.1.1 and 8.8.8.8 all failed from 05:34:04, and DNS from 05:34:06.
2. **ARP table during the outage:**
   ```
   10.255.31.254   xx-xx-xx-xx-xx-xx
   10.255.18.145   xx-xx-xx-xx-xx-xx
   ```
   The gateway IP and `10.255.18.145` point to the same network card.
3. **Packet capture, 05:34:54 – 05:35:09:**
   - `xx-xx-xx-xx-xx-xx > (my laptop)  ARP Reply 10.255.31.254 is-at xx-xx-xx-xx-xx-xx`, at 05:34:59.750 and 05:35:06.246
   - 71 IP packets from my laptop went to `xx-xx-xx-xx-xx-xx`. **Zero** came back.
   - The real MikroTik MAC `xx-xx-xx-xx-xx-xx` was not seen at all.
   - `10.255.23.47` (`xx-xx-xx-xx-xx-xx`) and `10.255.22.125` (`xx-xx-xx-xx-xx-xx`) broadcast "who-has 10.255.31.254" repeatedly at the same time.
4. My network card showed no errors and the link stayed up the whole time, so this was not a cable, port or laptop fault.

## How to find it on the MikroTik

```
/ip dhcp-server lease print where address=10.255.18.145
/ip dhcp-server lease print where mac-address=xx:xx:xx:xx:xx:xx
/interface bridge host print where mac-address=xx:xx:xx:xx:xx:xx
/ip arp print where mac-address=xx:xx:xx:xx:xx:xx
/log print where message~"xx:xx:xx:xx:xx:xx"
```

The **bridge host** entry shows the switch port or AP interface the device sits on. The **lease** may include a hostname. If the MikroTik has a "conflict" or ARP log, look for `10.255.31.254` being claimed by a MAC other than `xx:xx:xx:xx:xx:xx`.

## Recommended protection (so it can't happen again)

In rough order of effort:

1. **Client isolation** on all access points and switch ports, if the hardware supports it. Residents then can't send frames to each other, which stops ARP spoofing as well as many other attacks, and costs nothing for normal internet use.
2. **Make the router ignore unauthorised ARP:**
   - on the DHCP server: `add-arp=yes` (ARP entries are created for leases)
   - on the LAN bridge/interface: `arp=reply-only`

   The router then only talks to MACs it handed a lease to. This protects the router's side of the traffic (downloads to residents).
3. **DHCP snooping plus ARP inspection** on managed switches, if available. The switch drops ARP replies that don't match a DHCP lease, which protects residents' side too.
4. Optionally, log and alert when anything other than `xx:xx:xx:xx:xx:xx` claims `10.255.31.254`.

The fastest stop-gap is to **find and disconnect the device**: block `xx:xx:xx:xx:xx:xx` and speak to the room. Using such tools on a shared network is typically against the hostel's/university's IT rules.

## What I've done on my side

- Briefly pinned the real gateway MAC on my laptop (a static ARP entry, so it ignores fake replies). I then removed it on purpose, so the next occurrence can be captured and confirmed unprotected.
- Running a monitor that logs any device claiming to be the gateway, with exact timestamps. I can send you future occurrences (MAC, IP, time) if that helps catch it.

Happy to share the raw logs and packet capture.
