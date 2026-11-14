param(
  [Parameter(Mandatory=$true)][int]$ExpectedProcessId,
  [Parameter(Mandatory=$true)][string]$OutputFile
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PresentationProbe {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
}
'@
[PresentationProbe]::SetProcessDPIAware() | Out-Null
[uint32]$foregroundProcessId = 0
[PresentationProbe]::GetWindowThreadProcessId([PresentationProbe]::GetForegroundWindow(), [ref]$foregroundProcessId) | Out-Null
if ($foregroundProcessId -ne $ExpectedProcessId) {
  throw 'The diagnostic window must be in the foreground on the primary monitor; rerun without switching applications.'
}
$width = [PresentationProbe]::GetSystemMetrics(0)
$height = [PresentationProbe]::GetSystemMetrics(1)
$bitmap = [System.Drawing.Bitmap]::new($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size)
  $left = $bitmap.GetPixel([int]($width / 4), [int]($height / 2))
  $right = $bitmap.GetPixel([int]($width * 3 / 4), [int]($height / 2))
  $bitmap.Save($OutputFile)
  @{ width=$width; height=$height; left=@($left.R,$left.G,$left.B); right=@($right.R,$right.G,$right.B) } | ConvertTo-Json -Compress
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
