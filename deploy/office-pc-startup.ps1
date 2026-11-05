# Keeps Canvas running on the office PC: starts the WSL production distro when
# Windows starts (and again at logon as a fallback) and holds it open, because
# WSL stops a distro that has nothing attached to it.
#
# Run once from PowerShell opened with "Run as administrator":
#   powershell -ExecutionPolicy Bypass -File deploy\office-pc-startup.ps1
$ErrorActionPreference = "Stop"

$taskName = "Canvas production"
$distro = "Ubuntu-24.04"
$windowsUser = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d $distro -u canvas -- sleep infinity"
$triggers = @(
  (New-ScheduledTaskTrigger -AtStartup),
  (New-ScheduledTaskTrigger -AtLogOn -User $windowsUser)
)
# S4U: runs without anyone logged in and without storing the Windows password.
$principal = New-ScheduledTaskPrincipal -UserId $windowsUser -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Registered the '$taskName' task for $windowsUser."
Write-Host "Test it with a real restart: Canvas should come back without anyone logging in."
