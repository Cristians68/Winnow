# Chrome Web Store promotional tiles.
#
# Both are optional to publish; the small tile is what appears alongside the
# listing in some store placements, and the marquee is only used if Google ever
# features the item. Cheap to have, so both are generated here.
#
# Same funnel mark and brand green as the icon, drawn at tile scale rather than
# resized from a bitmap — see make-icons.ps1 for why detail has to be redrawn
# per size rather than scaled.
#
# Usage:  pwsh -File tools/make-promo-tiles.ps1
# Output: docs/promo/small-440x280.png, docs/promo/marquee-1400x560.png

Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\docs\promo'
New-Item -ItemType Directory -Force -Path $out | Out-Null

$green = [System.Drawing.Color]::FromArgb(18, 92, 51)     # #125c33
$mint  = [System.Drawing.Color]::FromArgb(227, 245, 234)  # #e3f5ea
$body  = [System.Drawing.Color]::FromArgb(178, 214, 191)  # softer mint for the tagline

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# The funnel, drawn into a square of side $s at ($ox,$oy). Proportions match the
# panel mark: fat bar, thick stem, no grain or chaff dots — those only read at
# 32px and 48px upward and add noise below that.
function Draw-Mark($g, [float]$ox, [float]$oy, [float]$s, $fill) {
  $brush = New-Object System.Drawing.SolidBrush($fill)
  $g.FillPath($brush, (New-RoundedRect ($ox + 0.13 * $s) ($oy + 0.24 * $s) (0.74 * $s) (0.11 * $s) (0.035 * $s)))

  [System.Drawing.PointF[]]$cone = @(
    (New-Object System.Drawing.PointF([float]($ox + 0.13 * $s), [float]($oy + 0.338 * $s))),
    (New-Object System.Drawing.PointF([float]($ox + 0.87 * $s), [float]($oy + 0.338 * $s))),
    (New-Object System.Drawing.PointF([float]($ox + 0.59 * $s), [float]($oy + 0.62 * $s))),
    (New-Object System.Drawing.PointF([float]($ox + 0.41 * $s), [float]($oy + 0.62 * $s)))
  )
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddPolygon($cone)
  $g.FillPath($brush, $path)

  $g.FillPath($brush, (New-RoundedRect ($ox + 0.41 * $s) ($oy + 0.61 * $s) (0.18 * $s) (0.19 * $s) (0.03 * $s)))
  $brush.Dispose()
}

function New-Tile([int]$w, [int]$h, [string]$file, [float]$markSize, [float]$titleSize, [float]$tagSize) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.Clear($green)

  $titleFont = New-Object System.Drawing.Font('Segoe UI', $titleSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $tagFont   = New-Object System.Drawing.Font('Segoe UI', $tagSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $titleBrush = New-Object System.Drawing.SolidBrush($mint)
  $tagBrush   = New-Object System.Drawing.SolidBrush($body)

  $title = 'Winnow'
  $tag   = 'What the reviews actually say'

  $titleSz = $g.MeasureString($title, $titleFont)
  $tagSz   = $g.MeasureString($tag, $tagFont)

  # Mark and wordmark centred as one lockup, tagline beneath.
  $gap = $markSize * 0.28
  $lockupW = $markSize + $gap + $titleSz.Width
  $lockupX = ($w - $lockupW) / 2
  $blockH = $markSize + ($tagSz.Height * 1.9)
  $top = ($h - $blockH) / 2

  Draw-Mark $g $lockupX $top $markSize $mint
  $g.DrawString($title, $titleFont, $titleBrush,
    [float]($lockupX + $markSize + $gap), [float]($top + ($markSize - $titleSz.Height) / 2))
  $g.DrawString($tag, $tagFont, $tagBrush,
    [float](($w - $tagSz.Width) / 2), [float]($top + $markSize + ($tagSz.Height * 0.55)))

  $dest = Join-Path $out $file
  $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host ("  {0,-22} {1}x{2}" -f $file, $bmp.Width, $bmp.Height)

  foreach ($d in @($titleFont, $tagFont, $titleBrush, $tagBrush, $g, $bmp)) { $d.Dispose() }
}

New-Tile 440 280 'small-440x280.png' 78 46 17
New-Tile 1400 560 'marquee-1400x560.png' 190 116 42

Write-Host "`nWritten to docs/promo/"
