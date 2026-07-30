$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath 'Sofia.lnk'
$TargetPath = 'powershell.exe'
$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$($PSCommandPath.Replace('create-shortcut.ps1', 'start-alya.ps1'))`""
$WorkingDirectory = Split-Path -Parent $PSCommandPath

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetPath
$Shortcut.Arguments = $Arguments
$Shortcut.WorkingDirectory = $WorkingDirectory
$Shortcut.Description = 'Sofia Assistente'
$Shortcut.IconLocation = '%SystemRoot%\System32\shell32.dll, 13'
$Shortcut.Save()

Write-Host "Atalho criado na area de trabalho: $ShortcutPath"
