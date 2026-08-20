$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "trg-remote.cs"
$output = Join-Path ([Environment]::GetFolderPath("Desktop")) "TRG-Remote.exe"
$backup = Join-Path ([Environment]::GetFolderPath("Desktop")) "TRG-Remote.pre-store-switch.exe"
$candidate = Join-Path ([Environment]::GetFolderPath("Desktop")) "TRG-Remote.new.exe"

if ((Test-Path -LiteralPath $output) -and -not (Test-Path -LiteralPath $backup)) {
    Copy-Item -LiteralPath $output -Destination $backup
}

Add-Type -Path $source -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $candidate -OutputType WindowsApplication
if (-not (Test-Path -LiteralPath $candidate)) {
    throw "The replacement TRG Remote executable was not created."
}
Move-Item -LiteralPath $candidate -Destination $output -Force
Write-Output "Built $output"
