# Winnow icon generator.
#
# Draws the icon family from one vector definition rather than resizing a single
# raster, because a browser toolbar renders it at 16px and detail that reads
# beautifully at 128px turns to mush there.
#
# Detail is dropped as the canvas shrinks -- this is optical sizing, the same
# reason real icon sets ship different artwork per size:
#   128 / 48 : funnel + the grain passing through + chaff being deflected
#        32  : funnel + grain
#        16  : funnel only, with thicker proportions
#
# Usage:  powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1

Add-Type -AssemblyName System.Drawing

$dir = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$green = [System.Drawing.Color]::FromArgb(18, 92, 51)    # #125c33
$mint  = [System.Drawing.Color]::FromArgb(227, 245, 234) # #e3f5ea

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  if ($r -le 0) { $p.AddRectangle((New-Object System.Drawing.RectangleF($x, $y, $w, $h))); return $p }
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

foreach ($s in @(16, 32, 48, 128)) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  # --- background
  $bg = New-Object System.Drawing.SolidBrush($green)
  $bgPath = New-RoundedRect 0 0 $s $s ([float]($s * 0.22))
  $g.FillPath($bg, $bgPath)

  $fg = New-Object System.Drawing.SolidBrush($mint)
  $u = [float]$s   # unit: all geometry expressed as a fraction of the canvas

  # At 16px the mark must be fatter and taller to survive; at larger sizes it
  # sits higher to leave room for the grain below.
  $small = $s -le 16
  $funnelTop    = if ($small) { 0.24 } else { 0.30 }
  $funnelLeft   = if ($small) { 0.13 } else { 0.16 }
  $funnelRight  = 1.0 - $funnelLeft
  $barHeight    = if ($small) { 0.11 } else { 0.075 }
  $coneBottom   = if ($small) { 0.60 } else { 0.60 }
  $stemHalf     = if ($small) { 0.09 } else { 0.065 }
  $stemBottom   = if ($small) { 0.80 } else { 0.745 }

  # --- funnel bar
  $g.FillPath($fg, (New-RoundedRect ($funnelLeft * $u) ($funnelTop * $u) `
      (($funnelRight - $funnelLeft) * $u) ($barHeight * $u) ([float]($s * 0.03))))

  # --- funnel cone
  # Overlap the bar slightly: two abutting antialiased fills leave a visible
  # hairline seam where their edges blend against the background.
  $coneTop = $funnelTop + $barHeight - 0.012
  $cone = New-Object System.Drawing.Drawing2D.GraphicsPath
  # Must be an explicitly typed PointF[]; PowerShell otherwise hands AddPolygon
  # an Object[] and it binds against the Point overload.
  [System.Drawing.PointF[]]$conePoints = @(
    (New-Object System.Drawing.PointF([float]($funnelLeft * $u), [float]($coneTop * $u))),
    (New-Object System.Drawing.PointF([float]($funnelRight * $u), [float]($coneTop * $u))),
    (New-Object System.Drawing.PointF([float](( 0.5 + $stemHalf) * $u), [float]($coneBottom * $u))),
    (New-Object System.Drawing.PointF([float](( 0.5 - $stemHalf) * $u), [float]($coneBottom * $u)))
  )
  $cone.AddPolygon($conePoints)
  $g.FillPath($fg, $cone)

  # --- stem
  $g.FillPath($fg, (New-RoundedRect ((0.5 - $stemHalf) * $u) (($coneBottom - 0.01) * $u) `
      (($stemHalf * 2) * $u) (($stemBottom - $coneBottom + 0.01) * $u) ([float]($s * 0.025))))

  # --- grain passing through (32px and up)
  if ($s -ge 32) {
    $r = [float]($s * 0.055)
    foreach ($x in @(0.34, 0.5, 0.66)) {
      $g.FillEllipse($fg, [float](($x * $u) - $r), [float]((0.885 * $u) - $r), $r * 2, $r * 2)
    }
  }

  # --- chaff being deflected (48px and up only: too fine to read below that)
  if ($s -ge 48) {
    $r = [float]($s * 0.048)
    # two pieces thrown clear to the upper right
    $g.FillEllipse($fg, [float]((0.845 * $u) - $r), [float]((0.185 * $u) - $r), $r * 2, $r * 2)
    $g.FillEllipse($fg, [float]((0.90 * $u) - $r * 0.8), [float]((0.345 * $u) - $r * 0.8), $r * 1.6, $r * 1.6)
    # and one to the upper left, so the mark reads as sorting rather than drifting
    $g.FillEllipse($fg, [float]((0.155 * $u) - $r * 0.8), [float]((0.185 * $u) - $r * 0.8), $r * 1.6, $r * 1.6)
  }

  $g.Dispose()
  $bmp.Save((Join-Path $dir "icon$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote icon$s.png"
}

Write-Host "`nIcons written to $dir"
Write-Host "Check icon16.png at actual size before committing -- if it is not"
Write-Host "instantly recognisable in the toolbar, the mark is still too complex."
