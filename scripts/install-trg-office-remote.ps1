$ErrorActionPreference = "Stop"

$launcherScript = Join-Path $PSScriptRoot "trg-office-remote.ps1"
if (-not (Test-Path -LiteralPath $launcherScript)) {
    throw "TRG Office Remote launcher was not found: $launcherScript"
}

$powerShell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$shell = New-Object -ComObject WScript.Shell
$shortcutLocations = @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("Startup")
)

foreach ($location in $shortcutLocations) {
    if (-not (Test-Path -LiteralPath $location)) {
        throw "Windows shortcut location was not found: $location"
    }

    $shortcutPath = Join-Path $location "TRG Office Remote.lnk"
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powerShell
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$launcherScript`""
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.Description = "Open the Tobacco Road Games Office Remote"
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
    $shortcut.Save()
}

Write-Output "TRG Office Remote desktop and startup shortcuts installed."
