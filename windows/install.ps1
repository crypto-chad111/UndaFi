# Creates the UndaFi shortcuts. Run it through install.bat.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

function New-UndaFiShortcut($path, $script, $extra, $description) {
  $s = $shell.CreateShortcut($path)
  $s.TargetPath = $wscript
  $s.Arguments = ('"{0}" {1}' -f (Join-Path $root "windows\$script"), $extra).Trim()
  $s.WorkingDirectory = $root
  $s.IconLocation = (Join-Path $root 'windows\undafi.ico')
  $s.Description = $description
  $s.Save()
}

$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$startup = [Environment]::GetFolderPath('Startup')

New-UndaFiShortcut (Join-Path $desktop 'UndaFi.lnk') 'launch.vbs' '' 'Open UndaFi'
New-UndaFiShortcut (Join-Path $programs 'UndaFi.lnk') 'launch.vbs' '' 'Open UndaFi'
New-UndaFiShortcut (Join-Path $programs 'Stop UndaFi.lnk') 'stop.vbs' '' 'Stop UndaFi'
Write-Host ''
Write-Host 'Done: "UndaFi" is on your Desktop and in the Start menu.'
Write-Host '      "Stop UndaFi" is in the Start menu.'
Write-Host ''

$answer = Read-Host 'Also start UndaFi by itself when Windows starts? (y/n)'
$auto = Join-Path $startup 'UndaFi.lnk'
if ($answer -match '^[yY]') {
  New-UndaFiShortcut $auto 'launch.vbs' 'quiet' 'Start UndaFi with Windows'
  Write-Host 'UndaFi will now start with Windows, without opening the dashboard.'
} elseif (Test-Path $auto) {
  Remove-Item $auto
  Write-Host 'UndaFi will no longer start with Windows.'
}
