# Convert panel captures into Chrome Web Store screenshots.
#
# The store requires exactly 1280x800 (or 640x400) and rejects PNGs with an
# alpha channel, which is what Windows screenshots carry by default. Rescaling
# to fit distorts nothing; the remainder is padded with the panel's own
# background so the result reads as a deliberate frame rather than a crop.
#
# Usage:  pwsh -File tools/make-store-screenshots.ps1
# Output: docs/screenshots/*.png  (1280x800, 24-bit, no alpha)

Add-Type -AssemblyName System.Drawing

$src = Join-Path $env:USERPROFILE 'OneDrive\Pictures\Screenshots'
$out = Join-Path $PSScriptRoot '..\docs\screenshots'
New-Item -ItemType Directory -Force -Path $out | Out-Null

# Ordered as they should appear in the listing: the measured call first, then
# the two real detections, so a reviewer sees restraint before accusation.
$shots = [ordered]@{
  '1-questionable'   = 'Screenshot 2026-07-27 215933.png'
  '2-manipulated'    = 'Screenshot 2026-07-27 220203.png'
  '3-hijack-pattern' = 'Screenshot 2026-07-27 220316.png'
  '4-detail'         = 'Screenshot 2026-07-27 220214.png'
  '5-detail-b'       = 'Screenshot 2026-07-27 220230.png'
}

# NOTE: PowerShell variable names are case-insensitive, so $w and $W are the
# same variable. Naming the locals below $w/$h silently overwrote these two and
# every image after the first was drawn onto a canvas sized by the previous one.
$frameW, $frameH = 1280, 800
$pad = [System.Drawing.Color]::FromArgb(22, 24, 29)   # --bg, the panel's own dark

foreach ($name in $shots.Keys) {
  $path = Join-Path $src $shots[$name]
  if (-not (Test-Path $path)) { Write-Warning "missing: $($shots[$name])"; continue }

  $img = [System.Drawing.Image]::FromFile($path)
  try {
    # Format24bppRgb: no alpha channel, which the store rejects.
    $canvas = New-Object System.Drawing.Bitmap($frameW, $frameH, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $g.Clear($pad)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

      # Fit inside the frame, never upscale past 1:1 — enlarging a screenshot
      # past its native size just makes the text look soft.
      $scale = [Math]::Min([Math]::Min($frameW / $img.Width, $frameH / $img.Height), 1.0)
      $drawW = [int]($img.Width * $scale)
      $drawH = [int]($img.Height * $scale)
      $g.DrawImage($img, [int](($frameW - $drawW) / 2), [int](($frameH - $drawH) / 2), $drawW, $drawH)
    } finally { $g.Dispose() }

    $dest = Join-Path $out "$name.png"
    $canvas.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvasW, $canvasH = $canvas.Width, $canvas.Height
    $canvas.Dispose()
    Write-Host ("  {0,-18} {1}x{2} -> {3}x{4}" -f $name, $img.Width, $img.Height, $canvasW, $canvasH)
  } finally { $img.Dispose() }
}

Write-Host "`nWritten to docs/screenshots/"
