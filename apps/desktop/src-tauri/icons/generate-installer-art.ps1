# Run on Windows after updating icon.png to refresh the installer artwork.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$output = Join-Path $PSScriptRoot 'installer'
[System.IO.Directory]::CreateDirectory($output) | Out-Null
$logo = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot 'icon.png'))

function Write-Art($name, $width, $height, $darkWidth, $x, $y, $size) {
    $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(11, 17, 32))
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        if ($darkWidth -gt 0) {
            $graphics.FillRectangle($brush, 0, 0, $darkWidth, $height)
        }
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($logo, $x, $y, $size, $size)
        $bitmap.Save((Join-Path $output $name), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
        $brush.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

try {
    Write-Art 'nsis-header.bmp' 150 57 0 96 4 49
    Write-Art 'nsis-sidebar.bmp' 164 314 164 18 78 128
    Write-Art 'wix-banner.bmp' 493 58 0 435 4 50
    # WiX places the welcome/completion text to the right of the artwork.
    Write-Art 'wix-dialog.bmp' 493 312 164 18 78 128
} finally {
    $logo.Dispose()
}
