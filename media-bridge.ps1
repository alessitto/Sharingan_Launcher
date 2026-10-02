# Puente con los controles multimedia de Windows (SMTC): lo mismo que sale
# en el panel de volumen de Windows. Funciona con Spotify de escritorio sin
# iniciar sesión ni API de desarrollador.
# Salida: una línea JSON por segundo con el estado. Entrada (stdin): una
# orden por línea: toggle | next | prev | seek <segundos>.
$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, [Type]$type) {
  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

# Se prefiere Spotify; si no está, la sesión que Windows considere actual.
function Get-Session {
  $all = @($mgr.GetSessions())
  $sp = $all | Where-Object { $_.SourceAppUserModelId -like "*Spotify*" } | Select-Object -First 1
  if ($sp) { return $sp }
  return $mgr.GetCurrentSession()
}

function Get-Cover($props) {
  if (-not $props.Thumbnail) { return $null }
  $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  if (-not $stream -or $stream.Size -eq 0) { return $null }
  $reader = [Windows.Storage.Streams.DataReader]::new($stream.GetInputStreamAt(0))
  Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) | Out-Null
  $bytes = New-Object byte[] $stream.Size
  $reader.ReadBytes($bytes)
  $reader.Dispose()
  $stream.Dispose()
  $type = if ($stream.ContentType) { $stream.ContentType } else { "image/png" }
  return "data:$type;base64," + [Convert]::ToBase64String($bytes)
}

# Console.In.ReadLineAsync bloquea en Windows PowerShell: se lee el stream
# en crudo con BeginRead (corre en otro hilo) y se parten las líneas aquí.
$stdin = [Console]::OpenStandardInput()
$buf = New-Object byte[] 1024
$pending = $stdin.BeginRead($buf, 0, $buf.Length, $null, $null)
$acc = ""
$lastKey = ""

while ($true) {
  if ($pending.IsCompleted) {
    $n = $stdin.EndRead($pending)
    if ($n -le 0) { break } # se cerró la app
    $acc += [System.Text.Encoding]::UTF8.GetString($buf, 0, $n)
    $pending = $stdin.BeginRead($buf, 0, $buf.Length, $null, $null)
    $lines = $acc.Split("`n")
    $acc = $lines[-1]
    $s = Get-Session
    $cmds = if ($lines.Count -gt 1) { $lines[0..($lines.Count - 2)] } else { @() }
    foreach ($cmd in $cmds) {
      if (-not $s -or -not $cmd.Trim()) { continue }
      $parts = $cmd.Trim().Split(" ")
      switch ($parts[0]) {
        "toggle" { $s.TryTogglePlayPauseAsync() | Out-Null }
        "next" { $s.TrySkipNextAsync() | Out-Null }
        "prev" { $s.TrySkipPreviousAsync() | Out-Null }
        "seek" { $s.TryChangePlaybackPositionAsync([long]([double]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture) * 10000000)) | Out-Null }
      }
    }
    Start-Sleep -Milliseconds 150
  }

  $s = Get-Session
  if (-not $s) {
    [Console]::Out.WriteLine('{"active":false}')
  } else {
    $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $tl = $s.GetTimelineProperties()
    $pb = $s.GetPlaybackInfo()
    $key = "$($props.Artist)|$($props.Title)"
    # La carátula solo se manda cuando cambia la canción (es pesada).
    $coverOut = $null
    if ($key -ne $lastKey) {
      $lastKey = $key
      $coverOut = Get-Cover $props
      if (-not $coverOut) { $coverOut = "" }
    }
    $state = [ordered]@{
      active   = $true
      app      = $s.SourceAppUserModelId
      title    = $props.Title
      artist   = $props.Artist
      album    = $props.AlbumTitle
      playing  = ($pb.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)
      position = $tl.Position.TotalSeconds
      duration = $tl.EndTime.TotalSeconds
      updated  = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
      cover    = $coverOut
    }
    [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()

  # Un segundo entre lecturas, pero atendiendo órdenes al momento.
  for ($i = 0; $i -lt 10 -and -not $pending.IsCompleted; $i++) { Start-Sleep -Milliseconds 100 }
}
