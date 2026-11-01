# render5.ps1 - the final v5 renders: out/incident-v5-redacted.mp4 (default props) and out/incident-v5-full.mp4 (data.local.json).
# 1080p60 HEVC 8-bit on NVENC (CRF 18), the PCM mix through a 2-pass loudnorm (-14 LUFS, -1.5 dBTP), AAC 320k 48 kHz, .mp4 tagged hvc1.
# Needs an ffmpeg with hevc_nvenc: $env:FFMPEG, else C:\Program Files\FFmpeg\bin\ffmpeg.exe. NETBUG_MB (motion-blur samples) defaults to 4.
# Run: pwsh -File scripts/render5.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot)
$ff = if ($env:FFMPEG) { $env:FFMPEG } else { 'C:\Program Files\FFmpeg\bin\ffmpeg.exe' }
$env:KINETOGRAPH_FFMPEG = $ff
if (-not $env:NETBUG_MB) { $env:NETBUG_MB = '4' }
$jobs = @(@{ name = 'incident-v5-redacted'; props = $null })
if (Test-Path data.local.json) {   # the full cut needs the gitignored real values
  $jobs += @{ name = 'incident-v5-full'; props = (Get-Content data.local.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 10) }
}
foreach ($j in $jobs) {
  $mov = "out/$($j.name).mov"; $mp4 = "out/$($j.name).mp4"
  $a = @('kinetograph', 'render', 'src/v5/index.tsx', '-o', $mov, '--codec', 'h265', '--encoder', 'hevc_nvenc', '--crf', '18',
            '--pixel-format', 'yuv420p', '--audio-codec', 'pcm', '--concurrency', '2')
  if ($j.props) { $a += @('--props', $j.props) }
  $t = Get-Date; & npx @a; if ($LASTEXITCODE) { throw "render failed: $($j.name)" }
  "render $($j.name): $([int]((Get-Date) - $t).TotalSeconds) s"
  $m = (& $ff -hide_banner -i $mov -map 0:a -af 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json' -f null - 2>&1 | Out-String)
  $js = ($m.Substring($m.LastIndexOf('{')) -split '}')[0] + '}' | ConvertFrom-Json
  $ln = "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$($js.input_i):measured_TP=$($js.input_tp):measured_LRA=$($js.input_lra):measured_thresh=$($js.input_thresh):offset=$($js.target_offset):linear=true"
  & $ff -hide_banner -v error -y -i $mov -map 0:v -map 0:a -c:v copy -tag:v hvc1 -af "$ln,aresample=48000" -c:a aac -b:a 320k -ar 48000 -movflags +faststart $mp4
  if ($LASTEXITCODE) { throw "mux failed: $($j.name)" }
  Remove-Item $mov
  "done $mp4"
}



