param([string]$Deck, [string]$Out)
# Opens a copy of the deck in PowerPoint (read-only, no window), writes each slide as a 1280x720 picture, and writes the notes and animation effects of each slide to info.json.
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Out | Out-Null
$copy = Join-Path $Out "deck-copy.pptx"
Copy-Item -LiteralPath $Deck -Destination $copy -Force
$app = New-Object -ComObject PowerPoint.Application
try {
  $pres = $app.Presentations.Open($copy, -1, 0, 0)
  $info = @()
  foreach ($s in $pres.Slides) {
    $png = Join-Path $Out ("slide-{0:000}.png" -f $s.SlideIndex)
    $s.Export($png, "PNG", 1280, 720)
    $notes = ""
    try { foreach ($sh in $s.NotesPage.Shapes) { if ($sh.Type -eq 14 -and $sh.PlaceholderFormat.Type -eq 2) { $notes = $sh.TextFrame.TextRange.Text } } } catch {}
    $effects = @()
    try {
      foreach ($e in $s.TimeLine.MainSequence) {
        $effects += [pscustomobject]@{ shape = $e.Shape.Name; type = [int]$e.EffectType; exit = [bool]$e.Exit; trigger = [int]$e.Timing.TriggerType; delay = [double]$e.Timing.TriggerDelayTime; duration = [double]$e.Timing.Duration }
      }
    } catch {}
    $info += [pscustomobject]@{ index = $s.SlideIndex; name = $s.Name; notes = $notes; transition = [int]$s.SlideShowTransition.EntryEffect; effects = $effects }
  }
  $info | ConvertTo-Json -Depth 6 | Out-File -Encoding utf8 (Join-Path $Out "info.json")
  $pres.Close()
} finally { $app.Quit() }
"exported " + $info.Count
