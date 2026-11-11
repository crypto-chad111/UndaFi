# Removes the UndaFi shortcuts. Your settings and layout are not touched.
$paths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'UndaFi.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'UndaFi.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Stop UndaFi.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Startup')) 'UndaFi.lnk')
)
foreach ($p in $paths) { if (Test-Path $p) { Remove-Item $p } }
Write-Host 'The UndaFi shortcuts are removed. The app folder and your settings are still there.'
